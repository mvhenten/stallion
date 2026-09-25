use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use yrs::encoding::read::Error as ReadError;
use yrs::sync::{Awareness, AwarenessUpdate, Clock, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Any, ClientID, Doc, Map, Out, ReadTxn, StateVector, Transact, Update};

use crate::frame::{BOARD_KEY, Frame, FrameKind, parse_tile_key};

pub const OBJECTS: &str = "objects";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Session {
    pub tiles: BTreeSet<String>,
    pub clients: BTreeSet<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Route {
    Sender,
    Tile(String),
    Board,
}

impl Route {
    pub fn reaches(&self, is_sender: bool, session: &Session) -> bool {
        match self {
            Route::Sender => is_sender,
            Route::Tile(key) => !is_sender && session.tiles.contains(key),
            Route::Board => !is_sender,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub route: Route,
    pub frame: Frame,
}

enum Applied {
    Integrated,
    MissingDependencies,
}

pub struct BoardSync {
    awareness: Awareness,
    tiles: HashMap<String, Doc>,
}

fn read_error(e: ReadError) -> String {
    format!("invalid y-protocols payload: {e}")
}

impl BoardSync {
    pub fn new<C: Clock + 'static>(clock: C) -> Self {
        BoardSync {
            awareness: Awareness::with_clock(Doc::new(), clock),
            tiles: HashMap::new(),
        }
    }

    pub fn open(&self) -> Result<Vec<Frame>, String> {
        let update = self.awareness.update().map_err(|e| e.to_string())?;
        if update.clients.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vec![Frame::new(
            BOARD_KEY,
            FrameKind::Awareness,
            update.encode_v1(),
        )])
    }

    pub fn close(&mut self, session: &Session) -> Result<Vec<Outgoing>, String> {
        if session.clients.is_empty() {
            return Ok(Vec::new());
        }
        let clients: Vec<ClientID> = session.clients.iter().map(|&c| ClientID::new(c)).collect();
        for &client in &clients {
            self.awareness.remove_state(client);
        }
        let update = self
            .awareness
            .update_with_clients(clients)
            .map_err(|e| e.to_string())?;
        Ok(vec![Outgoing {
            route: Route::Board,
            frame: Frame::new(BOARD_KEY, FrameKind::Awareness, update.encode_v1()),
        }])
    }

    pub fn receive(
        &mut self,
        session: &mut Session,
        frame: Frame,
    ) -> Result<Vec<Outgoing>, String> {
        match frame.kind {
            FrameKind::Subscribe => {
                parse_tile_key(&frame.tile_key)?;
                let doc = self.tiles.entry(frame.tile_key.clone()).or_default();
                let step1 = SyncMessage::SyncStep1(doc.transact().state_vector()).encode_v1();
                session.tiles.insert(frame.tile_key.clone());
                Ok(vec![reply(Frame::new(
                    frame.tile_key,
                    FrameKind::Sync,
                    step1,
                ))])
            }
            FrameKind::Unsubscribe => {
                session.tiles.remove(&frame.tile_key);
                Ok(Vec::new())
            }
            FrameKind::Sync => self.sync(session, frame),
            FrameKind::Awareness => {
                let update = AwarenessUpdate::decode_v1(&frame.payload).map_err(read_error)?;
                session
                    .clients
                    .extend(update.clients.keys().map(ClientID::get));
                self.awareness
                    .apply_update(update)
                    .map_err(|e| e.to_string())?;
                Ok(vec![Outgoing {
                    route: Route::Board,
                    frame: Frame::new(BOARD_KEY, FrameKind::Awareness, frame.payload),
                }])
            }
            FrameKind::Reject => Err("clients cannot send Reject".into()),
        }
    }

    fn sync(&mut self, session: &Session, frame: Frame) -> Result<Vec<Outgoing>, String> {
        let key = frame.tile_key;
        if !session.tiles.contains(&key) {
            return Err(format!("tile {key:?} is not subscribed"));
        }
        let doc = self.tiles.entry(key.clone()).or_default();
        match SyncMessage::decode_v1(&frame.payload).map_err(read_error)? {
            SyncMessage::SyncStep1(sv) => {
                let step2 = SyncMessage::SyncStep2(doc.transact().encode_state_as_update_v1(&sv));
                Ok(vec![reply(Frame::new(
                    key,
                    FrameKind::Sync,
                    step2.encode_v1(),
                ))])
            }
            SyncMessage::SyncStep2(update) | SyncMessage::Update(update) => {
                match apply(doc, &update)? {
                    Applied::Integrated => {
                        let payload = SyncMessage::Update(update).encode_v1();
                        Ok(vec![Outgoing {
                            route: Route::Tile(key.clone()),
                            frame: Frame::new(key, FrameKind::Sync, payload),
                        }])
                    }
                    Applied::MissingDependencies => {
                        let step1 = SyncMessage::SyncStep1(doc.transact().state_vector());
                        Ok(vec![reply(Frame::new(
                            key,
                            FrameKind::Sync,
                            step1.encode_v1(),
                        ))])
                    }
                }
            }
        }
    }
}

fn reply(frame: Frame) -> Outgoing {
    Outgoing {
        route: Route::Sender,
        frame,
    }
}

fn decode_update(bytes: &[u8]) -> Result<Update, String> {
    Update::decode_v1(bytes).map_err(read_error)
}

fn apply(doc: &Doc, update: &[u8]) -> Result<Applied, String> {
    let trial = Doc::new();
    let current = doc
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    {
        let mut txn = trial.transact_mut();
        txn.apply_update(decode_update(&current)?)
            .map_err(|e| e.to_string())?;
        txn.apply_update(decode_update(update)?)
            .map_err(|e| e.to_string())?;
    }
    let txn = trial.transact();
    if txn.store().pending_update().is_some() || txn.store().pending_ds().is_some() {
        return Ok(Applied::MissingDependencies);
    }
    if let Some((name, _)) = txn.root_refs().find(|(name, _)| *name != OBJECTS) {
        return Err(format!(
            "unknown root type {name:?}; only {OBJECTS:?} is allowed"
        ));
    }
    if let Some(objects) = txn.get_map(OBJECTS) {
        let before_txn = doc.transact();
        let before = before_txn.get_map(OBJECTS);
        for (object_id, value) in objects.iter(&txn) {
            let unchanged = before
                .as_ref()
                .and_then(|map| map.get(&before_txn, object_id))
                .is_some_and(|old| old == value);
            if !unchanged {
                validate_entry(object_id, &value)?;
            }
        }
    }
    doc.transact_mut()
        .apply_update(decode_update(update)?)
        .map_err(|e| e.to_string())?;
    Ok(Applied::Integrated)
}

fn validate_entry(object_id: &str, value: &Out) -> Result<(), String> {
    let Out::Any(Any::Buffer(bytes)) = value else {
        return Err(format!("object {object_id:?} must be a CBOR byte string"));
    };
    let object = crate::object::decode(bytes).map_err(|e| format!("object {object_id:?}: {e}"))?;
    if object.object_id() != object_id {
        return Err(format!(
            "object stored under {object_id:?} has objectId {:?}",
            object.object_id()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::object::tests::fixture;

    const TILE: &str = "0:0:0";

    struct Client {
        doc: Doc,
        session: Session,
        inbox: Vec<Frame>,
    }

    impl Client {
        fn new() -> Self {
            Client {
                doc: Doc::new(),
                session: Session::default(),
                inbox: Vec::new(),
            }
        }

        fn handle(&mut self) -> Vec<Frame> {
            let mut replies = Vec::new();
            for frame in std::mem::take(&mut self.inbox) {
                if frame.kind != FrameKind::Sync {
                    continue;
                }
                match SyncMessage::decode_v1(&frame.payload).unwrap() {
                    SyncMessage::SyncStep1(sv) => {
                        let update = self.doc.transact().encode_state_as_update_v1(&sv);
                        replies.push(sync(SyncMessage::SyncStep2(update)));
                    }
                    SyncMessage::SyncStep2(u) | SyncMessage::Update(u) => {
                        self.doc
                            .transact_mut()
                            .apply_update(Update::decode_v1(&u).unwrap())
                            .unwrap();
                    }
                }
            }
            replies
        }
    }

    fn sync(message: SyncMessage) -> Frame {
        Frame::new(TILE, FrameKind::Sync, message.encode_v1())
    }

    fn send(
        board: &mut BoardSync,
        clients: &mut [Client],
        from: usize,
        frame: Frame,
    ) -> Result<(), String> {
        let wire = Frame::decode(&frame.encode()).unwrap();
        let outgoing = board.receive(&mut clients[from].session, wire)?;
        for out in outgoing {
            for (i, client) in clients.iter_mut().enumerate() {
                if out.route.reaches(i == from, &client.session) {
                    client.inbox.push(out.frame.clone());
                }
            }
        }
        Ok(())
    }

    fn pump(board: &mut BoardSync, clients: &mut [Client]) {
        loop {
            let pending: Vec<(usize, Vec<Frame>)> = clients
                .iter_mut()
                .enumerate()
                .map(|(i, c)| (i, c.handle()))
                .collect();
            if pending.iter().all(|(_, frames)| frames.is_empty()) {
                return;
            }
            for (i, frames) in pending {
                for frame in frames {
                    send(board, clients, i, frame).unwrap();
                }
            }
        }
    }

    fn connect(board: &mut BoardSync, clients: &mut [Client], i: usize) {
        send(
            board,
            clients,
            i,
            Frame::new(TILE, FrameKind::Subscribe, vec![]),
        )
        .unwrap();
        let sv = clients[i].doc.transact().state_vector();
        send(board, clients, i, sync(SyncMessage::SyncStep1(sv))).unwrap();
        pump(board, clients);
    }

    fn put(client: &Client, object_id: &str, bytes: Vec<u8>) -> Frame {
        let objects = client.doc.get_or_insert_map(OBJECTS);
        let mut txn = client.doc.transact_mut();
        let before = txn.state_vector();
        objects.insert(&mut txn, object_id, Any::Buffer(bytes.into()));
        sync(SyncMessage::Update(txn.encode_state_as_update_v1(&before)))
    }

    fn stored(doc: &Doc, object_id: &str) -> Option<Out> {
        let txn = doc.transact();
        txn.get_map(OBJECTS)?.get(&txn, object_id)
    }

    #[test]
    fn two_docs_converge_through_the_board_and_invalid_objects_are_rejected() {
        let mut board = BoardSync::new(|| 0);
        let mut clients = [Client::new(), Client::new(), Client::new()];
        put(&clients[0], "stroke-0001", fixture());
        connect(&mut board, &mut clients, 0);
        connect(&mut board, &mut clients, 1);
        assert!(stored(&clients[1].doc, "stroke-0001").is_some());

        let update = put(&clients[1], "stroke-0002", {
            let mut bytes = fixture();
            let at = bytes.windows(4).position(|w| w == b"0001").unwrap();
            bytes[at..at + 4].copy_from_slice(b"0002");
            bytes
        });
        send(&mut board, &mut clients, 1, update).unwrap();
        pump(&mut board, &mut clients);
        assert!(stored(&clients[0].doc, "stroke-0002").is_some());
        assert!(
            clients[2].inbox.is_empty(),
            "unsubscribed client got tile traffic"
        );

        let bad = put(&clients[0], "stroke-0003", fixture());
        let error = send(&mut board, &mut clients, 0, bad).unwrap_err();
        assert!(error.contains("objectId"), "{error}");
        assert!(stored(&clients[1].doc, "stroke-0003").is_none());

        let mut awareness = Awareness::with_clock(Doc::with_client_id(7), || 0);
        awareness.set_local_state_raw(r#"{"cursor":[1,2]}"#);
        let frame = Frame::new(
            BOARD_KEY,
            FrameKind::Awareness,
            awareness.update().unwrap().encode_v1(),
        );
        send(&mut board, &mut clients, 0, frame).unwrap();
        assert_eq!(clients[2].inbox.len(), 1);
        let closed = board.close(&clients[0].session).unwrap();
        let gone = AwarenessUpdate::decode_v1(&closed[0].frame.payload).unwrap();
        assert_eq!(&*gone.clients[&ClientID::new(7)].json, "null");
    }
}
