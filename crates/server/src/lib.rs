pub mod auth;
pub mod board;
pub mod frame;
pub mod object;
pub mod store;

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use worker::*;

use auth::{Access, AccessApp, Keys};
use board::{BoardSync, Session};
use frame::{Frame, FrameKind};
use store::SqlTileStore;

const BOARD_BINDING: &str = "BOARD";
const FLUSH_DELAY: Duration = Duration::from_secs(5);
const IDLE_MS: u64 = 60_000;

const USER_HEADER: &str = "X-Stallion-User";

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
            Ok(identity) => Caller::User(identity.email),
            Err(reason) => Caller::Denied(reason),
        },
    )
}

fn board_id(path: &str) -> Option<&str> {
    let id = path.strip_prefix("/api/boards/")?.strip_suffix("/ws")?;
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    valid.then_some(id)
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let user = match caller(&req, &env).await? {
        Caller::Denied(reason) => {
            console_log!("Access rejected the request: {reason}");
            return Response::error("unauthorized", 401);
        }
        Caller::Anonymous => String::new(),
        Caller::User(email) => email,
    };
    let url = req.url()?;
    let Some(id) = board_id(url.path()) else {
        return Response::error("expected /api/boards/{boardId}/ws", 404);
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
    board: RefCell<BoardSync<SqlTileStore>>,
    flush_armed: Cell<bool>,
}

impl Board {
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
    fn new(state: State, _env: Env) -> Self {
        let store = SqlTileStore::new(state.storage().sql());
        Board {
            state,
            board: RefCell::new(BoardSync::new(|| Date::now().as_millis(), store)),
            flush_armed: Cell::new(false),
        }
    }

    async fn fetch(&self, req: Request) -> Result<Response> {
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
    fn routes_only_board_websocket_paths() {
        assert_eq!(board_id("/api/boards/b-1/ws"), Some("b-1"));
        assert_eq!(board_id("/api/boards//ws"), None);
        assert_eq!(board_id("/api/boards/a/b/ws"), None);
        assert_eq!(board_id("/"), None);
    }
}
