use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use yrs::encoding::read::Error as ReadError;
use yrs::sync::{Awareness, AwarenessUpdate, Clock, SyncMessage};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{Any, ClientID, Doc, Map, Out, ReadTxn, StateVector, Transact, Update};

use crate::frame::{BOARD_KEY, Frame, FrameKind, Move, parse_tile_key};
use crate::store::{TileCoord, TileHint, TileRecord, TileStore};
use crate::view::{HINT_CAP, OBJECT_BUDGET, Viewport};

pub const OBJECTS: &str = "objects";

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub tiles: BTreeSet<String>,
    pub clients: BTreeSet<u64>,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub view: Option<Viewport>,
}

impl Session {
    pub fn subscribed(&self, key: &str) -> bool {
        self.tiles.contains(key)
            || self
                .view
                .as_ref()
                .is_some_and(|view| parse_tile_key(key).is_ok_and(|coord| view.is_live(coord)))
    }
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
            Route::Tile(key) => !is_sender && session.subscribed(key),
            Route::Board => !is_sender,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outgoing {
    pub route: Route,
    pub frame: Frame,
}

enum Checked {
    Ready { introduced: Vec<String> },
    MissingDependencies,
}

struct Tile {
    doc: Doc,
    used_at: u64,
}

pub struct BoardSync<S> {
    awareness: Awareness,
    clock: Box<dyn Clock>,
    store: S,
    tiles: HashMap<String, Tile>,
    dirty: BTreeSet<String>,
}

fn read_error(e: ReadError) -> String {
    format!("invalid y-protocols payload: {e}")
}

impl<S: TileStore> BoardSync<S> {
    pub fn new<C: Clock + Clone + 'static>(clock: C, store: S) -> Self {
        BoardSync {
            awareness: Awareness::with_clock(Doc::new(), clock.clone()),
            clock: Box::new(clock),
            store,
            tiles: HashMap::new(),
            dirty: BTreeSet::new(),
        }
    }

    pub fn has_dirty(&self) -> bool {
        !self.dirty.is_empty()
    }

    pub fn flush(&mut self) -> Result<usize, String> {
        let now = self.clock.now();
        let records = self
            .dirty
            .iter()
            .filter_map(|key| self.tiles.get(key).map(|tile| compact(key, &tile.doc, now)))
            .collect::<Result<Vec<_>, _>>()?;
        if !records.is_empty() {
            self.store.save_all(&records)?;
        }
        let flushed = self.dirty.len();
        self.dirty.clear();
        Ok(flushed)
    }

    pub fn evict_idle(&mut self, idle_ms: u64) {
        let now = self.clock.now();
        let dirty = &self.dirty;
        self.tiles
            .retain(|key, tile| dirty.contains(key) || now.saturating_sub(tile.used_at) < idle_ms);
    }

    fn tile(&mut self, key: &str) -> Result<Doc, String> {
        let now = self.clock.now();
        if let Some(tile) = self.tiles.get_mut(key) {
            tile.used_at = now;
            return Ok(tile.doc.clone());
        }
        let state = self.store.load(parse_tile_key(key)?)?;
        self.cache(key, state.as_deref())
    }

    fn cache(&mut self, key: &str, state: Option<&[u8]>) -> Result<Doc, String> {
        let now = self.clock.now();
        if let Some(tile) = self.tiles.get_mut(key) {
            tile.used_at = now;
            return Ok(tile.doc.clone());
        }
        let doc = Doc::new();
        if let Some(state) = state {
            doc.transact_mut()
                .apply_update(decode_update(state)?)
                .map_err(|e| e.to_string())?;
        }
        self.tiles.insert(
            key.to_owned(),
            Tile {
                doc: doc.clone(),
                used_at: now,
            },
        );
        Ok(doc)
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
                let doc = self.tile(&frame.tile_key)?;
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
                let mut update = AwarenessUpdate::decode_v1(&frame.payload).map_err(read_error)?;
                let payload = if session.user.is_empty() {
                    frame.payload
                } else {
                    stamp_user(&mut update, &session.user)?;
                    update.encode_v1()
                };
                session
                    .clients
                    .extend(update.clients.keys().map(ClientID::get));
                self.awareness
                    .apply_update(update)
                    .map_err(|e| e.to_string())?;
                Ok(vec![Outgoing {
                    route: Route::Board,
                    frame: Frame::new(BOARD_KEY, FrameKind::Awareness, payload),
                }])
            }
            FrameKind::View => self.view(session, Viewport::decode(&frame.payload)?),
            FrameKind::Move => self.move_object(session, Move::decode(&frame.payload)?),
            FrameKind::Reject | FrameKind::Snapshot | FrameKind::Hints => {
                Err(format!("clients cannot send {:?}", frame.kind))
            }
        }
    }

    fn view(&mut self, session: &mut Session, viewport: Viewport) -> Result<Vec<Outgoing>, String> {
        let tiles = viewport.tiles()?;
        self.flush()?;
        let before = session.clone();
        session.view = Some(viewport);
        session
            .tiles
            .retain(|key| parse_tile_key(key).is_ok_and(|coord| viewport.is_live(coord)));
        let bands = tiles
            .live
            .iter()
            .map(|range| (range, true))
            .chain(tiles.snapshot.iter().map(|range| (range, false)));
        let mut remaining = OBJECT_BUDGET;
        let mut outgoing = Vec::new();
        for (range, live) in bands {
            if remaining == 0 {
                break;
            }
            for found in self.store.range(range, range.center(), remaining)? {
                remaining = remaining.saturating_sub(found.objects);
                let key = tile_key(found.coord);
                if live && before.subscribed(&key) {
                    continue;
                }
                if !live {
                    outgoing.push(reply(Frame::new(key, FrameKind::Snapshot, found.doc_state)));
                    continue;
                }
                let doc = self.cache(&key, Some(&found.doc_state))?;
                let txn = doc.transact();
                let state = txn.encode_state_as_update_v1(&StateVector::default());
                let step1 = SyncMessage::SyncStep1(txn.state_vector()).encode_v1();
                let step2 = SyncMessage::SyncStep2(state).encode_v1();
                outgoing.push(reply(Frame::new(key.clone(), FrameKind::Sync, step1)));
                outgoing.push(reply(Frame::new(key, FrameKind::Sync, step2)));
            }
        }
        let hints = match &tiles.hint {
            Some(range) => self.store.hints(range, range.center(), HINT_CAP)?,
            None => Vec::new(),
        };
        outgoing.push(reply(Frame::new(
            BOARD_KEY,
            FrameKind::Hints,
            encode_hints(&hints),
        )));
        Ok(outgoing)
    }

    fn sync(&mut self, session: &Session, frame: Frame) -> Result<Vec<Outgoing>, String> {
        let key = frame.tile_key;
        if !session.subscribed(&key) {
            return Err(format!("tile {key:?} is not subscribed"));
        }
        let doc = self.tile(&key)?;
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
                let Checked::Ready { introduced } = check(&doc, &update)? else {
                    return Ok(vec![step1(&key, &doc)]);
                };
                self.commit(&key, &doc, &update)?;
                let mut outgoing = vec![relay(&key, update)];
                for object_id in introduced {
                    if self.holder(&object_id, &[&key])?.is_some() {
                        outgoing.extend(self.evict(&key, &doc, &object_id));
                    }
                }
                Ok(outgoing)
            }
        }
    }

    /// Applies both halves of a cross-tile move or neither. A move wins over a concurrent edit
    /// that kept the object in the source tile, and the first of two concurrent moves wins.
    fn move_object(&mut self, session: &Session, moved: Move) -> Result<Vec<Outgoing>, String> {
        if moved.from_tile == moved.to_tile {
            return Err(format!(
                "a move needs two tiles, got {:?} twice",
                moved.to_tile
            ));
        }
        for key in [&moved.from_tile, &moved.to_tile] {
            if !session.subscribed(key) {
                return Err(format!("tile {key:?} is not subscribed"));
            }
        }
        let from = self.tile(&moved.from_tile)?;
        let to = self.tile(&moved.to_tile)?;
        let from_checked = check(&from, &moved.from_update)?;
        let to_checked = check(&to, &moved.to_update)?;
        let (Checked::Ready { .. }, Checked::Ready { .. }) = (from_checked, to_checked) else {
            return Ok(vec![
                step1(&moved.from_tile, &from),
                step1(&moved.to_tile, &to),
            ]);
        };
        let was_in_source = holds(&from, &moved.object_id);
        self.commit(&moved.from_tile, &from, &moved.from_update)?;
        self.commit(&moved.to_tile, &to, &moved.to_update)?;
        let mut outgoing = vec![
            relay(&moved.from_tile, moved.from_update),
            relay(&moved.to_tile, moved.to_update),
        ];
        if !holds(&to, &moved.object_id) {
            return Ok(outgoing);
        }
        outgoing.extend(self.evict(&moved.from_tile, &from, &moved.object_id));
        let elsewhere = self.holder(&moved.object_id, &[&moved.from_tile, &moved.to_tile])?;
        if !was_in_source && elsewhere.is_some() {
            outgoing.extend(self.evict(&moved.to_tile, &to, &moved.object_id));
        }
        Ok(outgoing)
    }

    fn commit(&mut self, key: &str, doc: &Doc, update: &[u8]) -> Result<(), String> {
        let update = decode_update(update)?;
        if update.is_empty() {
            return Ok(());
        }
        doc.transact_mut()
            .apply_update(update)
            .map_err(|e| e.to_string())?;
        self.dirty.insert(key.to_owned());
        Ok(())
    }

    fn evict(&mut self, key: &str, doc: &Doc, object_id: &str) -> Vec<Outgoing> {
        if !holds(doc, object_id) {
            return Vec::new();
        }
        let objects = doc.get_or_insert_map(OBJECTS);
        let update = {
            let mut txn = doc.transact_mut();
            objects.remove(&mut txn, object_id);
            txn.encode_update_v1()
        };
        self.dirty.insert(key.to_owned());
        let frame = Frame::new(
            key,
            FrameKind::Sync,
            SyncMessage::Update(update).encode_v1(),
        );
        vec![
            reply(frame.clone()),
            Outgoing {
                route: Route::Tile(key.to_owned()),
                frame,
            },
        ]
    }

    fn holder(&self, object_id: &str, except: &[&str]) -> Result<Option<String>, String> {
        let loaded = self
            .tiles
            .iter()
            .find(|(key, tile)| !except.contains(&key.as_str()) && holds(&tile.doc, object_id));
        if let Some((key, _)) = loaded {
            return Ok(Some(key.clone()));
        }
        Ok(self
            .store
            .locate(object_id)?
            .into_iter()
            .map(tile_key)
            .find(|key| !except.contains(&key.as_str()) && !self.tiles.contains_key(key)))
    }
}

fn holds(doc: &Doc, object_id: &str) -> bool {
    let txn = doc.transact();
    txn.get_map(OBJECTS)
        .is_some_and(|objects| objects.contains_key(&txn, object_id))
}

fn step1(key: &str, doc: &Doc) -> Outgoing {
    let step1 = SyncMessage::SyncStep1(doc.transact().state_vector());
    reply(Frame::new(key, FrameKind::Sync, step1.encode_v1()))
}

fn relay(key: &str, update: Vec<u8>) -> Outgoing {
    Outgoing {
        route: Route::Tile(key.to_owned()),
        frame: Frame::new(
            key,
            FrameKind::Sync,
            SyncMessage::Update(update).encode_v1(),
        ),
    }
}

pub fn compact(key: &str, doc: &Doc, updated_at: u64) -> Result<TileRecord, String> {
    let coord = parse_tile_key(key)?;
    let txn = doc.transact();
    let doc_state = txn.encode_state_as_update_v1(&StateVector::default());
    let mut objects = Vec::new();
    if let Some(map) = txn.get_map(OBJECTS) {
        for (object_id, value) in map.iter(&txn) {
            let Out::Any(Any::Buffer(bytes)) = value else {
                return Err(format!("object {object_id:?} must be a CBOR byte string"));
            };
            let object = crate::object::decode(&bytes)?;
            objects.push((object_id.to_owned(), object.bbox().clone()));
        }
    }
    objects.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(TileRecord {
        coord,
        doc_state,
        updated_at,
        objects,
    })
}

fn stamp_user(update: &mut AwarenessUpdate, user: &str) -> Result<(), String> {
    for entry in update.clients.values_mut() {
        let mut state: serde_json::Value = serde_json::from_str(&entry.json)
            .map_err(|e| format!("invalid awareness state: {e}"))?;
        let Some(fields) = state.as_object_mut() else {
            continue;
        };
        let identity = fields
            .entry("user")
            .or_insert_with(|| serde_json::Value::Object(Default::default()));
        if !identity.is_object() {
            *identity = serde_json::Value::Object(Default::default());
        }
        identity["name"] = user.into();
        entry.json = state.to_string().into();
    }
    Ok(())
}

fn tile_key((level, tx, ty): TileCoord) -> String {
    format!("{level}:{tx}:{ty}")
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

fn check(doc: &Doc, update: &[u8]) -> Result<Checked, String> {
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
        return Ok(Checked::MissingDependencies);
    }
    if let Some((name, _)) = txn.root_refs().find(|(name, _)| *name != OBJECTS) {
        return Err(format!(
            "unknown root type {name:?}; only {OBJECTS:?} is allowed"
        ));
    }
    let mut introduced = Vec::new();
    if let Some(objects) = txn.get_map(OBJECTS) {
        let before_txn = doc.transact();
        let before = before_txn.get_map(OBJECTS);
        for (object_id, value) in objects.iter(&txn) {
            let old = before
                .as_ref()
                .and_then(|map| map.get(&before_txn, object_id));
            if old.is_none() {
                introduced.push(object_id.to_owned());
            }
            if old.is_none_or(|old| old != value) {
                validate_entry(object_id, &value)?;
            }
        }
    }
    Ok(Checked::Ready { introduced })
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

fn encode_hints(hints: &[TileHint]) -> Vec<u8> {
    let mut bytes = Vec::new();
    ciborium::into_writer(hints, &mut bytes).expect("writing to a Vec cannot fail");
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::object::tests::fixture;
    use crate::store::TileSnapshot;
    use crate::view::LevelRange;
    use std::cell::RefCell;
    use std::rc::Rc;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU64, Ordering};

    const TILE: &str = "0:0:0";

    #[derive(Clone, Default)]
    struct MemoryStore {
        rows: Rc<RefCell<HashMap<TileCoord, TileRecord>>>,
        saves: Rc<RefCell<usize>>,
        batches: Rc<RefCell<Vec<usize>>>,
        queries: Rc<RefCell<Vec<i32>>>,
    }

    impl TileStore for MemoryStore {
        fn load(&self, coord: TileCoord) -> Result<Option<Vec<u8>>, String> {
            Ok(self.rows.borrow().get(&coord).map(|r| r.doc_state.clone()))
        }

        fn save_all(&self, records: &[TileRecord]) -> Result<(), String> {
            *self.saves.borrow_mut() += records.len();
            self.batches.borrow_mut().push(records.len());
            for record in records {
                self.rows.borrow_mut().insert(record.coord, record.clone());
            }
            Ok(())
        }

        fn locate(&self, object_id: &str) -> Result<Vec<TileCoord>, String> {
            Ok(self
                .rows
                .borrow()
                .values()
                .filter(|r| r.objects.iter().any(|(id, _)| id == object_id))
                .map(|r| r.coord)
                .collect())
        }

        fn range(
            &self,
            range: &LevelRange,
            (cx, cy): (i64, i64),
            budget: usize,
        ) -> Result<Vec<TileSnapshot>, String> {
            self.queries.borrow_mut().push(range.level);
            let rows = self.rows.borrow();
            let mut found: Vec<&TileRecord> = rows
                .values()
                .filter(|r| range.contains(r.coord) && !r.objects.is_empty())
                .collect();
            found.sort_by_key(|r| {
                let (_, tx, ty) = r.coord;
                ((tx - cx).abs().max((ty - cy).abs()), ty, tx)
            });
            let mut running = 0;
            Ok(found
                .into_iter()
                .take_while(|r| {
                    running += r.objects.len();
                    running <= budget
                })
                .map(|r| TileSnapshot {
                    coord: r.coord,
                    doc_state: r.doc_state.clone(),
                    objects: r.objects.len(),
                })
                .collect())
        }

        fn hints(
            &self,
            range: &LevelRange,
            (cx, cy): (i64, i64),
            cap: usize,
        ) -> Result<Vec<TileHint>, String> {
            let rows = self.rows.borrow();
            let mut found: Vec<&TileRecord> = rows
                .values()
                .filter(|r| range.contains(r.coord) && !r.objects.is_empty())
                .collect();
            found.sort_by_key(|r| {
                let (_, tx, ty) = r.coord;
                ((tx - cx).abs().max((ty - cy).abs()), ty, tx)
            });
            Ok(found
                .into_iter()
                .take(cap)
                .map(|r| TileHint {
                    level: r.coord.0,
                    tx: r.coord.1,
                    ty: r.coord.2,
                    count: r.objects.len() as i64,
                })
                .collect())
        }
    }

    fn view_frame(min_x: f64, min_y: f64, zoom: f64) -> Frame {
        let viewport = Viewport {
            min_x,
            min_y,
            max_x: min_x + 1024.0 / zoom,
            max_y: min_y + 768.0 / zoom,
            zoom,
        };
        let mut payload = Vec::new();
        ciborium::into_writer(&viewport, &mut payload).unwrap();
        Frame::new(BOARD_KEY, FrameKind::View, payload)
    }

    fn seed(store: &MemoryStore, coord: TileCoord, objects: usize) {
        let state = Doc::new()
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let bbox = crate::object::Bbox {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 1.0,
            max_y: 1.0,
        };
        let record = TileRecord {
            coord,
            doc_state: state,
            updated_at: 0,
            objects: (0..objects)
                .map(|i| (format!("o{i}"), bbox.clone()))
                .collect(),
        };
        store.rows.borrow_mut().insert(coord, record);
    }

    #[test]
    fn a_dense_view_stays_within_budget_and_keeps_coarse_objects() {
        let store = MemoryStore::default();
        let coarse = [
            ((3, 0, 0), 2),
            ((0, 1, 1), 3),
            ((-1, 2, 2), 4),
            ((-3, 5, 5), 5),
        ];
        for (coord, objects) in coarse {
            seed(&store, coord, objects);
        }
        seed(&store, (0, 100, 100), 1);
        for level in -8..=-4 {
            for i in 0..40 {
                seed(&store, (level, i, i), 200);
            }
        }
        let mut board = BoardSync::new(|| 0, store.clone());
        let mut session = Session::default();
        let out = board
            .receive(&mut session, view_frame(0.0, 0.0, 1.0))
            .unwrap();

        let rows = store.rows.borrow();
        let mut delivered: BTreeSet<TileCoord> = BTreeSet::new();
        for o in &out {
            assert_eq!(o.route, Route::Sender);
            if o.frame.kind == FrameKind::Hints {
                continue;
            }
            delivered.insert(parse_tile_key(&o.frame.tile_key).unwrap());
        }
        let total: usize = delivered.iter().map(|c| rows[c].objects.len()).sum();
        assert!(total <= OBJECT_BUDGET, "{total} objects over the budget");
        assert!(total > OBJECT_BUDGET / 2, "only {total} objects delivered");
        for (coord, _) in coarse {
            assert!(delivered.contains(&coord), "coarse tile {coord:?} dropped");
        }
        assert!(!delivered.contains(&(0, 100, 100)));

        let queries = store.queries.borrow();
        let levels: BTreeSet<i32> = queries.iter().copied().collect();
        assert_eq!(levels.len(), queries.len(), "a level was queried twice");
        assert!(queries.len() <= 49, "{} range queries", queries.len());
        assert!(queries.windows(2).all(|w| w[0] > w[1]), "not coarse first");

        let kinds: Vec<FrameKind> = out
            .iter()
            .filter(|o| o.frame.tile_key == "-3:5:5" || o.frame.tile_key == "0:1:1")
            .map(|o| o.frame.kind)
            .collect();
        assert_eq!(
            kinds,
            [FrameKind::Sync, FrameKind::Sync, FrameKind::Snapshot]
        );
    }

    #[test]
    fn a_view_subscribes_the_live_band_and_drops_tiles_that_left_it() {
        let store = MemoryStore::default();
        seed(&store, (0, 1, 1), 1);
        seed(&store, (-9, 3, 3), 2);
        seed(&store, (-10, 3, 3), 4);
        let mut board = BoardSync::new(|| 0, store);
        let mut session = Session::default();
        session.tiles.insert("0:1000:1000".into());
        let first = board
            .receive(&mut session, view_frame(0.0, 0.0, 1.0))
            .unwrap();
        assert_eq!(
            first.len(),
            3,
            "step 1 and step 2 for the one live tile, then hints"
        );
        let hints = &first[2].frame;
        assert_eq!(hints.kind, FrameKind::Hints);
        let decoded: Vec<ciborium::Value> = ciborium::from_reader(&hints.payload[..]).unwrap();
        assert_eq!(
            decoded,
            [hint_value(-9, 3, 3, 2)],
            "only the level below the cutoff"
        );

        assert!(session.subscribed("-2:16:12"));
        assert!(session.subscribed("40:0:0"));
        assert!(!session.subscribed("-3:0:0"), "a snapshot tile is live");
        assert!(!session.subscribed("0:1000:1000"));
        assert!(Route::Tile("0:1:1".into()).reaches(false, &session));
        let step1 = SyncMessage::SyncStep1(StateVector::default()).encode_v1();
        let sync = |key: &str| Frame::new(key, FrameKind::Sync, step1.clone());
        assert!(board.receive(&mut session, sync("-2:3:3")).is_ok());
        assert!(board.receive(&mut session, sync("-3:3:3")).is_err());

        let again = board
            .receive(&mut session, view_frame(0.0, 0.0, 1.0))
            .unwrap();
        let kinds: Vec<FrameKind> = again.iter().map(|o| o.frame.kind).collect();
        assert_eq!(
            kinds,
            [FrameKind::Hints],
            "a live tile was resent: {again:?}"
        );

        board
            .receive(&mut session, view_frame(1e6, 1e6, 1.0))
            .unwrap();
        assert!(!session.subscribed("0:1:1"));
        assert!(session.subscribed("0:3907:3907"));
    }

    fn hint_value(level: i64, tx: i64, ty: i64, count: i64) -> ciborium::Value {
        ciborium::Value::Map(
            [("level", level), ("tx", tx), ("ty", ty), ("count", count)]
                .into_iter()
                .map(|(k, v)| (ciborium::Value::Text(k.into()), v.into()))
                .collect(),
        )
    }

    fn board() -> BoardSync<MemoryStore> {
        BoardSync::new(|| 0, MemoryStore::default())
    }

    #[test]
    fn awareness_names_the_verified_user() {
        let mut board = board();
        let mut peer = Awareness::with_clock(Doc::with_client_id(7), || 0);
        peer.set_local_state_raw(r#"{"user":{"name":"spoof","color":"red"}}"#);
        let payload = peer.update().unwrap().encode_v1();
        let mut session = Session {
            user: "user@example.com".into(),
            ..Session::default()
        };
        let out = board
            .receive(
                &mut session,
                Frame::new(BOARD_KEY, FrameKind::Awareness, payload),
            )
            .unwrap();
        let update = AwarenessUpdate::decode_v1(&out[0].frame.payload).unwrap();
        let state: serde_json::Value =
            serde_json::from_str(&update.clients[&ClientID::new(7)].json).unwrap();
        assert_eq!(state["user"]["name"], "user@example.com");
        assert_eq!(state["user"]["color"], "red");
    }

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
        board: &mut BoardSync<MemoryStore>,
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

    fn pump(board: &mut BoardSync<MemoryStore>, clients: &mut [Client]) {
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

    fn connect(board: &mut BoardSync<MemoryStore>, clients: &mut [Client], i: usize) {
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
        let mut board = board();
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

    #[test]
    fn flushes_only_dirty_tiles_as_compacted_state_and_reloads_after_eviction() {
        let store = MemoryStore::default();
        let time = Arc::new(AtomicU64::new(0));
        let clock = {
            let time = time.clone();
            move || time.load(Ordering::SeqCst)
        };
        let mut board = BoardSync::new(clock.clone(), store.clone());
        let mut clients = [Client::new(), Client::new()];
        connect(&mut board, &mut clients, 0);
        assert!(!board.has_dirty(), "a subscribe must not dirty the tile");

        let mut sent = 0;
        for _ in 0..20 {
            let update = put(&clients[0], "stroke-0001", fixture());
            sent += update.payload.len();
            send(&mut board, &mut clients, 0, update).unwrap();
        }
        assert!(board.has_dirty());
        time.store(1_000, Ordering::SeqCst);
        assert_eq!(board.flush(), Ok(1));
        assert_eq!(board.flush(), Ok(0), "a clean tile was written again");
        assert_eq!(*store.saves.borrow(), 1);

        let record = store.rows.borrow()[&(0, 0, 0)].clone();
        assert_eq!(record.updated_at, 1_000);
        assert!(
            record.doc_state.len() < sent / 2,
            "state {} is not compacted against {sent} bytes of updates",
            record.doc_state.len()
        );
        assert_eq!(record.objects.len(), 1);
        assert_eq!(record.objects[0].0, "stroke-0001");
        assert_eq!(
            crate::store::bbox_json(&record.objects[0].1),
            "[10,12.5,42,30.25]"
        );

        time.store(59_999, Ordering::SeqCst);
        board.evict_idle(60_000);
        assert_eq!(board.tiles.len(), 1);
        time.store(60_000, Ordering::SeqCst);
        board.evict_idle(60_000);
        assert!(board.tiles.is_empty());

        connect(&mut board, &mut clients, 1);
        assert!(stored(&clients[1].doc, "stroke-0001").is_some());

        let mut restarted = BoardSync::new(clock, store.clone());
        let mut fresh = [Client::new()];
        connect(&mut restarted, &mut fresh, 0);
        assert!(stored(&fresh[0].doc, "stroke-0001").is_some());
        assert!(!restarted.has_dirty());
    }

    const SOURCE: &str = "0:0:0";
    const TARGET: &str = "1:-1:0";
    const STROKE: &str = "stroke-0001";

    struct Peer {
        session: Session,
        docs: HashMap<String, Doc>,
    }

    impl Peer {
        fn new() -> Self {
            let mut session = Session::default();
            session.tiles.extend([SOURCE.to_owned(), TARGET.to_owned()]);
            Peer {
                session,
                docs: [SOURCE, TARGET]
                    .into_iter()
                    .map(|key| (key.to_owned(), Doc::new()))
                    .collect(),
            }
        }

        fn edit(
            &self,
            key: &str,
            change: impl FnOnce(&mut yrs::TransactionMut, &yrs::MapRef),
        ) -> Vec<u8> {
            let doc = &self.docs[key];
            let objects = doc.get_or_insert_map(OBJECTS);
            let mut txn = doc.transact_mut();
            change(&mut txn, &objects);
            txn.encode_update_v1()
        }

        fn put(&self, key: &str) -> Vec<u8> {
            self.edit(key, |txn, objects| {
                objects.insert(txn, STROKE, Any::Buffer(fixture().into()));
            })
        }

        fn move_frame(&self) -> Frame {
            let moved = Move {
                object_id: STROKE.into(),
                from_tile: SOURCE.into(),
                to_tile: TARGET.into(),
                from_update: self.edit(SOURCE, |txn, objects| {
                    objects.remove(txn, STROKE);
                }),
                to_update: self.put(TARGET),
            };
            Frame::new(BOARD_KEY, FrameKind::Move, moved.encode())
        }

        fn holds(&self, key: &str) -> bool {
            holds(&self.docs[key], STROKE)
        }
    }

    fn update_frame(key: &str, update: Vec<u8>) -> Frame {
        Frame::new(
            key,
            FrameKind::Sync,
            SyncMessage::Update(update).encode_v1(),
        )
    }

    fn exchange(
        board: &mut BoardSync<MemoryStore>,
        peers: &mut [Peer],
        from: usize,
        frame: Frame,
    ) -> Result<(), String> {
        let wire = Frame::decode(&frame.encode()).unwrap();
        for out in board.receive(&mut peers[from].session, wire)? {
            for (i, peer) in peers.iter_mut().enumerate() {
                if !out.route.reaches(i == from, &peer.session) {
                    continue;
                }
                let SyncMessage::Update(update) =
                    SyncMessage::decode_v1(&out.frame.payload).unwrap()
                else {
                    panic!("unexpected {:?}", out.frame);
                };
                peer.docs[&out.frame.tile_key]
                    .transact_mut()
                    .apply_update(Update::decode_v1(&update).unwrap())
                    .unwrap();
            }
        }
        Ok(())
    }

    #[test]
    fn a_cross_tile_move_and_a_concurrent_edit_keep_the_object_exactly_once() {
        for edit_first in [false, true] {
            let store = MemoryStore::default();
            let mut board = BoardSync::new(|| 0, store.clone());
            let mut peers = [Peer::new(), Peer::new()];
            let created = peers[0].put(SOURCE);
            exchange(&mut board, &mut peers, 0, update_frame(SOURCE, created)).unwrap();
            assert!(peers[1].holds(SOURCE));
            board.flush().unwrap();

            let moved = peers[0].move_frame();
            let edited = update_frame(SOURCE, peers[1].put(SOURCE));
            if edit_first {
                exchange(&mut board, &mut peers, 1, edited).unwrap();
                exchange(&mut board, &mut peers, 0, moved).unwrap();
            } else {
                exchange(&mut board, &mut peers, 0, moved).unwrap();
                exchange(&mut board, &mut peers, 1, edited).unwrap();
            }

            for (i, peer) in peers.iter().enumerate() {
                assert!(
                    !peer.holds(SOURCE),
                    "peer {i} kept a duplicate (edit first: {edit_first})"
                );
                assert!(
                    peer.holds(TARGET),
                    "peer {i} lost the object (edit first: {edit_first})"
                );
            }
            store.batches.borrow_mut().clear();
            assert_eq!(board.flush(), Ok(2));
            assert_eq!(*store.batches.borrow(), [2], "both tiles in one write");
            assert_eq!(store.locate(STROKE).unwrap(), [(1, -1, 0)]);
        }
    }

    #[test]
    fn a_move_with_an_invalid_half_changes_neither_tile() {
        let mut board = board();
        let mut peers = [Peer::new()];
        let created = peers[0].put(SOURCE);
        exchange(&mut board, &mut peers, 0, update_frame(SOURCE, created)).unwrap();
        let mut moved = Move::decode(&peers[0].move_frame().payload).unwrap();
        moved.to_update = peers[0].edit(TARGET, |txn, objects| {
            objects.insert(txn, "stroke-0002", Any::Buffer(fixture().into()));
        });
        let frame = Frame::new(BOARD_KEY, FrameKind::Move, moved.encode());
        let error = exchange(&mut board, &mut peers, 0, frame).unwrap_err();
        assert!(error.contains("objectId"), "{error}");
        assert!(holds(&board.tile(SOURCE).unwrap(), STROKE));
        assert!(!holds(&board.tile(TARGET).unwrap(), STROKE));
    }
}
