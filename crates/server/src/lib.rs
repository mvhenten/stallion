pub mod auth;
pub mod board;
pub mod frame;
pub mod lock;
pub mod object;
pub mod pin;
pub mod store;
pub mod view;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use worker::*;

use auth::{Access, AccessApp, Keys};
use board::{BoardSync, Session};
use frame::{Frame, FrameKind};
use lock::{Lock, SqlLockStore};
use pin::PinHash;
use serde::Deserialize;
use serde_json::json;
use store::SqlTileStore;

const BOARD_BINDING: &str = "BOARD";
const FLUSH_DELAY: Duration = Duration::from_secs(5);
const IDLE_MS: u64 = 60_000;

const USER_HEADER: &str = "X-Stallion-User";
const PASS_HEADER: &str = "X-Stallion-Pass";
const PASS_SECRET: &str = "BOARD_PASS_SECRET";
const PIN_CHANGED: u16 = 4003;

thread_local! {
    static ACCESS_KEYS: RefCell<Option<(u64, Rc<Keys>)>> = const { RefCell::new(None) };
    static LOGGED_DISABLED: Cell<bool> = const { Cell::new(false) };
}

enum Caller {
    Anonymous,
    User(String),
    Denied(String),
}

async fn access_keys(app: &AccessApp) -> Result<Rc<Keys>> {
    let now = Date::now().as_millis();
    let cached = ACCESS_KEYS.with_borrow(|cache| {
        cache
            .as_ref()
            .filter(|(fetched, _)| now.saturating_sub(*fetched) < auth::KEYS_TTL_MS)
            .map(|(_, keys)| keys.clone())
    });
    if let Some(keys) = cached {
        return Ok(keys);
    }
    let mut response = Fetch::Url(Url::parse(&app.certs_url())?).send().await?;
    if response.status_code() != 200 {
        return Err(Error::RustError(format!(
            "{} returned {}",
            app.certs_url(),
            response.status_code()
        )));
    }
    let keys = Rc::new(auth::parse_keys(&response.text().await?).map_err(Error::RustError)?);
    ACCESS_KEYS.set(Some((now, keys.clone())));
    Ok(keys)
}

async fn caller(req: &Request, env: &Env) -> Result<Caller> {
    let access = Access::from_vars(
        &env.var("ACCESS_TEAM_DOMAIN")?.to_string(),
        &env.var("ACCESS_AUD")?.to_string(),
    )
    .map_err(Error::RustError)?;
    let Access::Enabled(app) = access else {
        if !LOGGED_DISABLED.replace(true) {
            console_log!(
                "Cloudflare Access is disabled: ACCESS_TEAM_DOMAIN and ACCESS_AUD are empty"
            );
        }
        return Ok(Caller::Anonymous);
    };
    let assertion = req.headers().get(auth::ASSERTION_HEADER)?;
    let cookie = req.headers().get("Cookie")?;
    let Some(token) = auth::token(assertion.as_deref(), cookie.as_deref()) else {
        return Ok(Caller::Denied("no Access token".into()));
    };
    let keys = access_keys(&app).await?;
    Ok(
        match auth::verify(token, &keys, &app, Date::now().as_millis() / 1000) {
            Ok(identity) => Caller::User(identity.name),
            Err(reason) => Caller::Denied(reason),
        },
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Endpoint {
    Socket,
    Join,
    Pin,
}

fn board_route(path: &str) -> Option<(&str, Endpoint)> {
    let (id, action) = path.strip_prefix("/api/boards/")?.split_once('/')?;
    let endpoint = match action {
        "ws" => Endpoint::Socket,
        "join" => Endpoint::Join,
        "pin" => Endpoint::Pin,
        _ => return None,
    };
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    valid.then_some((id, endpoint))
}

fn refuse(status: u16, reason: &str, message: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({ "reason": reason, "message": message }))?.with_status(status))
}

#[derive(Deserialize)]
struct PinBody {
    pin: String,
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let user = match caller(&req, &env).await? {
        Caller::Denied(reason) => {
            console_log!("Access rejected the request: {reason}");
            return Response::error("unauthorized", 401);
        }
        Caller::Anonymous => String::new(),
        Caller::User(name) => name,
    };
    let url = req.url()?;
    let Some((id, _)) = board_route(url.path()) else {
        return Response::error("expected /api/boards/{boardId}/ws, /join or /pin", 404);
    };
    let forward = req.clone_mut()?;
    let headers = forward.headers();
    headers.delete(USER_HEADER)?;
    if !user.is_empty() {
        headers.set(USER_HEADER, &user)?;
    }
    env.durable_object(BOARD_BINDING)?
        .get_by_name(id)?
        .fetch_with_request(forward)
        .await
}

#[durable_object]
pub struct Board {
    state: State,
    env: Env,
    lock: SqlLockStore,
    board: RefCell<BoardSync<SqlTileStore>>,
    flush_armed: Cell<bool>,
}

impl Board {
    fn pass_secret(&self) -> Option<Vec<u8>> {
        self.env
            .secret(PASS_SECRET)
            .ok()
            .map(|secret| secret.to_string().into_bytes())
            .filter(|secret| !secret.is_empty())
    }

    fn missing_secret() -> Result<Response> {
        refuse(
            500,
            "PassSecretMissing",
            "the Worker has no BOARD_PASS_SECRET; run wrangler secret put BOARD_PASS_SECRET",
        )
    }

    fn check_pass(
        &self,
        board_id: &str,
        lock: &Lock,
        pass: Option<&str>,
    ) -> Result<Option<Response>> {
        if !lock.is_locked() {
            return Ok(None);
        }
        let Some(pass) = pass.filter(|pass| !pass.is_empty()) else {
            return refuse(403, "PinRequired", "this board is locked with a PIN").map(Some);
        };
        let Some(secret) = self.pass_secret() else {
            return Self::missing_secret().map(Some);
        };
        let now = Date::now().as_millis() / 1000;
        match pin::check_pass(&secret, pass, board_id, lock.generation, now) {
            Ok(()) => Ok(None),
            Err(error) => refuse(403, "PassInvalid", error.message()).map(Some),
        }
    }

    fn issued(&self, board_id: &str, lock: &Lock, pin_set: bool) -> Result<Response> {
        let Some(secret) = self.pass_secret() else {
            return Self::missing_secret();
        };
        let now = Date::now().as_millis() / 1000;
        let (pass, expires_at) = pin::issue_pass(&secret, board_id, lock.generation, now);
        Response::from_json(&json!({ "pinSet": pin_set, "pass": pass, "expiresAt": expires_at }))
    }

    fn client_key(req: &Request) -> Result<String> {
        if let Some(user) = req.headers().get(USER_HEADER)?.filter(|u| !u.is_empty()) {
            return Ok(format!("user:{user}"));
        }
        let ip = req.headers().get("CF-Connecting-IP")?.unwrap_or_default();
        Ok(format!("ip:{ip}"))
    }

    async fn upgrade(&self, req: Request, board_id: &str) -> Result<Response> {
        let url = req.url()?;
        let pass = url
            .query_pairs()
            .find(|(name, _)| name == "pass")
            .map(|(_, value)| value.into_owned());
        let lock = self.lock.lock().map_err(Error::RustError)?;
        if let Some(refused) = self.check_pass(board_id, &lock, pass.as_deref())? {
            return Ok(refused);
        }
        if req.headers().get("Upgrade")?.as_deref() != Some("websocket") {
            return Response::error("expected a websocket upgrade", 426);
        }
        let pair = WebSocketPair::new()?;
        self.state.accept_web_socket(&pair.server);
        let session = Session {
            user: req.headers().get(USER_HEADER)?.unwrap_or_default(),
            ..Session::default()
        };
        pair.server.serialize_attachment(session)?;
        let opening = self.board.borrow().open().map_err(Error::RustError)?;
        for frame in opening {
            pair.server.send_with_bytes(frame.encode())?;
        }
        Response::from_websocket(pair.client)
    }

    async fn join(&self, mut req: Request, board_id: &str) -> Result<Response> {
        let client = Self::client_key(&req)?;
        let now = Date::now().as_millis();
        let mut attempts = self.lock.attempts(&client).map_err(Error::RustError)?;
        let admitted = pin::admit(&mut attempts, now);
        self.lock
            .record_attempts(&client, &attempts, now, pin::WINDOW_MS)
            .map_err(Error::RustError)?;
        let left = match admitted {
            Ok(left) => left,
            Err(retry_after) => {
                let response = refuse(
                    429,
                    "RateLimited",
                    &format!("too many PIN attempts; try again in {retry_after} s"),
                )?;
                response
                    .headers()
                    .set("Retry-After", &retry_after.to_string())?;
                return Ok(response);
            }
        };
        let Ok(body) = req.json::<PinBody>().await else {
            return refuse(400, "InvalidPin", "send {\"pin\": \"<6 digits>\"}");
        };
        if let Err(reason) = pin::check_pin(&body.pin) {
            return refuse(400, "InvalidPin", &reason);
        }
        let lock = self.lock.lock().map_err(Error::RustError)?;
        if !lock.is_locked() {
            return self.issued(board_id, &lock, false);
        }
        let stored = PinHash::decode(&lock.pin_hash).map_err(Error::RustError)?;
        if !pin::verify_pin(&stored, &body.pin)
            .await
            .map_err(Error::RustError)?
        {
            let tries = if left == 1 { "try" } else { "tries" };
            return refuse(
                403,
                "WrongPin",
                &format!("wrong PIN; {left} {tries} left this minute"),
            );
        }
        self.issued(board_id, &lock, true)
    }

    async fn set_pin(&self, mut req: Request, board_id: &str) -> Result<Response> {
        let pass = req.headers().get(PASS_HEADER)?;
        let lock = self.lock.lock().map_err(Error::RustError)?;
        if let Some(refused) = self.check_pass(board_id, &lock, pass.as_deref())? {
            return Ok(refused);
        }
        let Ok(body) = req.json::<PinBody>().await else {
            return refuse(
                400,
                "InvalidPin",
                "send {\"pin\": \"<6 digits>\"} or an empty pin",
            );
        };
        if body.pin.is_empty() {
            self.lock.set_pin_hash("").map_err(Error::RustError)?;
            return Response::from_json(&json!({ "pinSet": false }));
        }
        if let Err(reason) = pin::check_pin(&body.pin) {
            return refuse(400, "InvalidPin", &reason);
        }
        if self.pass_secret().is_none() {
            return Self::missing_secret();
        }
        let hash = pin::hash_pin(&body.pin).await.map_err(Error::RustError)?;
        let lock = self
            .lock
            .set_pin_hash(&hash.encode())
            .map_err(Error::RustError)?;
        for ws in self.state.get_websockets() {
            ws.close(Some(PIN_CHANGED), Some("the board PIN changed"))?;
        }
        self.issued(board_id, &lock, true)
    }

    fn pin_state(&self) -> Result<Response> {
        let lock = self.lock.lock().map_err(Error::RustError)?;
        Response::from_json(&json!({ "pinSet": lock.is_locked() }))
    }

    fn session(ws: &WebSocket) -> Result<Session> {
        Ok(ws.deserialize_attachment()?.unwrap_or_default())
    }

    fn deliver(&self, sender: &WebSocket, outgoing: Vec<board::Outgoing>) -> Result<()> {
        if outgoing.is_empty() {
            return Ok(());
        }
        let sockets = self.state.get_websockets();
        for out in outgoing {
            let bytes = out.frame.encode();
            for ws in &sockets {
                if out.route.reaches(ws == sender, &Self::session(ws)?) {
                    ws.send_with_bytes(&bytes)?;
                }
            }
        }
        Ok(())
    }

    fn reject(ws: &WebSocket, tile_key: String, reason: String) -> Result<()> {
        let frame = Frame::new(tile_key, FrameKind::Reject, reason.into_bytes());
        ws.send_with_bytes(frame.encode())
    }

    fn leave(&self, ws: &WebSocket) -> Result<()> {
        let session = Self::session(ws)?;
        let outgoing = self
            .board
            .borrow_mut()
            .close(&session)
            .map_err(Error::RustError)?;
        self.deliver(ws, outgoing)
    }

    async fn arm_flush(&self) -> Result<()> {
        if self.flush_armed.get() || !self.board.borrow().has_dirty() {
            return Ok(());
        }
        self.flush_armed.set(true);
        let armed = self.state.storage().set_alarm(FLUSH_DELAY).await;
        if armed.is_err() {
            self.flush_armed.set(false);
        }
        armed
    }
}

impl DurableObject for Board {
    fn new(state: State, env: Env) -> Self {
        let store = SqlTileStore::new(state.storage().sql());
        let lock = SqlLockStore::new(state.storage().sql());
        Board {
            state,
            env,
            lock,
            board: RefCell::new(BoardSync::new(|| Date::now().as_millis(), store)),
            flush_armed: Cell::new(false),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
        let url = req.url()?;
        let Some((board_id, endpoint)) = board_route(url.path()) else {
            return Response::error("expected /api/boards/{boardId}/ws, /join or /pin", 404);
        };
        let board_id = board_id.to_owned();
        match (endpoint, req.method()) {
            (Endpoint::Socket, _) => self.upgrade(req, &board_id).await,
            (Endpoint::Join, Method::Post) => self.join(req, &board_id).await,
            (Endpoint::Pin, Method::Post) => self.set_pin(req, &board_id).await,
            (Endpoint::Pin, Method::Get) => self.pin_state(),
            _ => Response::error("method not allowed", 405),
        }
    }

    async fn websocket_message(
        &self,
        ws: WebSocket,
        message: WebSocketIncomingMessage,
    ) -> Result<()> {
        let WebSocketIncomingMessage::Binary(bytes) = message else {
            return ws.close(Some(1003), Some("frames are binary CBOR"));
        };
        let frame = match Frame::decode(&bytes) {
            Ok(frame) => frame,
            Err(reason) => return ws.close(Some(1007), Some(reason)),
        };
        let tile_key = frame.tile_key.clone();
        let mut session = Self::session(&ws)?;
        let result = self.board.borrow_mut().receive(&mut session, frame);
        match result {
            Ok(outgoing) => {
                ws.serialize_attachment(&session)?;
                self.deliver(&ws, outgoing)?;
                self.arm_flush().await
            }
            Err(reason) => Self::reject(&ws, tile_key, reason),
        }
    }

    async fn websocket_close(
        &self,
        ws: WebSocket,
        _code: usize,
        _reason: String,
        _was_clean: bool,
    ) -> Result<()> {
        self.leave(&ws)
    }

    async fn websocket_error(&self, ws: WebSocket, _error: Error) -> Result<()> {
        self.leave(&ws)
    }

    async fn alarm(&self) -> Result<Response> {
        self.flush_armed.set(false);
        let mut board = self.board.borrow_mut();
        let flushed = board.flush().map_err(Error::RustError)?;
        board.evict_idle(IDLE_MS);
        Response::ok(format!("flushed {flushed} tiles"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn routes_only_board_paths() {
        assert_eq!(
            board_route("/api/boards/b-1/ws"),
            Some(("b-1", Endpoint::Socket))
        );
        assert_eq!(
            board_route("/api/boards/b-1/join"),
            Some(("b-1", Endpoint::Join))
        );
        assert_eq!(
            board_route("/api/boards/b-1/pin"),
            Some(("b-1", Endpoint::Pin))
        );
        assert_eq!(board_route("/api/boards//ws"), None);
        assert_eq!(board_route("/api/boards/a/b/ws"), None);
        assert_eq!(board_route("/api/boards/a/other"), None);
        assert_eq!(board_route("/"), None);
    }
}
