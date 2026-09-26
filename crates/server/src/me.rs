use std::cell::Cell;

use serde::{Deserialize, Serialize};
use worker::{SqlStorage, SqlStorageValue};

use crate::store::{migrate_with, run};

pub const MAX_BOARDS: usize = 200;
pub const MAX_THUMBNAIL_BYTES: usize = 24 * 1024;
pub const MAX_NAME_CHARS: usize = 200;
pub const PNG_DATA_URL: &str = "data:image/png;base64,";

pub const MIGRATIONS: &[&[&str]] = &[&["CREATE TABLE my_board (
        board_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_opened INTEGER NOT NULL,
        thumbnail TEXT NOT NULL
    )"]];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyBoard {
    pub board_id: String,
    pub name: String,
    pub last_opened: u64,
    pub thumbnail: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoardPatch {
    pub name: Option<String>,
    pub last_opened: Option<u64>,
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    ThumbnailTooLarge,
    ThumbnailNotPng,
    NameTooLong,
}

impl Refusal {
    pub fn status(self) -> u16 {
        match self {
            Refusal::ThumbnailTooLarge => 413,
            Refusal::ThumbnailNotPng | Refusal::NameTooLong => 400,
        }
    }

    pub fn reason(self) -> &'static str {
        match self {
            Refusal::ThumbnailTooLarge => "ThumbnailTooLarge",
            Refusal::ThumbnailNotPng => "ThumbnailNotPng",
            Refusal::NameTooLong => "NameTooLong",
        }
    }

    pub fn message(self) -> String {
        match self {
            Refusal::ThumbnailTooLarge => {
                format!("a thumbnail may be at most {MAX_THUMBNAIL_BYTES} bytes")
            }
            Refusal::ThumbnailNotPng => format!("a thumbnail must be a {PNG_DATA_URL} URL"),
            Refusal::NameTooLong => {
                format!("a board name may be at most {MAX_NAME_CHARS} characters")
            }
        }
    }
}

pub trait BoardIndexStore {
    fn get(&self, board_id: &str) -> Result<Option<MyBoard>, String>;
    fn put(&self, board: &MyBoard) -> Result<(), String>;
    fn delete(&self, board_id: &str) -> Result<(), String>;
    fn all(&self) -> Result<Vec<MyBoard>, String>;
    /// Every row's id and last_opened, without the thumbnails.
    fn ages(&self) -> Result<Vec<(String, u64)>, String>;
}

fn check(patch: &BoardPatch) -> Result<(), Refusal> {
    if let Some(thumbnail) = patch.thumbnail.as_deref().filter(|t| !t.is_empty()) {
        if thumbnail.len() > MAX_THUMBNAIL_BYTES {
            return Err(Refusal::ThumbnailTooLarge);
        }
        if !thumbnail.starts_with(PNG_DATA_URL) {
            return Err(Refusal::ThumbnailNotPng);
        }
    }
    if patch
        .name
        .as_deref()
        .is_some_and(|name| name.chars().count() > MAX_NAME_CHARS)
    {
        return Err(Refusal::NameTooLong);
    }
    Ok(())
}

fn newest_first(a: &(String, u64), b: &(String, u64)) -> std::cmp::Ordering {
    b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0))
}

pub struct UserBoards<S> {
    store: S,
}

impl<S: BoardIndexStore> UserBoards<S> {
    pub fn new(store: S) -> Self {
        UserBoards { store }
    }

    pub fn list(&self) -> Result<Vec<MyBoard>, String> {
        let mut boards = self.store.all()?;
        boards.sort_by(|a, b| {
            b.last_opened
                .cmp(&a.last_opened)
                .then_with(|| a.board_id.cmp(&b.board_id))
        });
        Ok(boards)
    }

    pub fn upsert(
        &self,
        board_id: &str,
        patch: BoardPatch,
        now_ms: u64,
    ) -> Result<Result<MyBoard, Refusal>, String> {
        if let Err(refusal) = check(&patch) {
            return Ok(Err(refusal));
        }
        let existing = self.store.get(board_id)?;
        let last_opened = match (&existing, patch.last_opened) {
            (Some(old), Some(given)) => old.last_opened.max(given),
            (Some(old), None) => old.last_opened,
            (None, Some(given)) => given,
            (None, None) => now_ms,
        };
        let board = MyBoard {
            board_id: board_id.to_owned(),
            name: patch
                .name
                .or_else(|| existing.as_ref().map(|old| old.name.clone()))
                .unwrap_or_else(|| board_id.to_owned()),
            last_opened,
            thumbnail: patch
                .thumbnail
                .or_else(|| existing.map(|old| old.thumbnail))
                .unwrap_or_default(),
        };
        self.store.put(&board)?;
        let mut ages = self.store.ages()?;
        ages.sort_by(newest_first);
        for (evicted, _) in ages.iter().skip(MAX_BOARDS) {
            self.store.delete(evicted)?;
        }
        Ok(Ok(board))
    }

    pub fn remove(&self, board_id: &str) -> Result<(), String> {
        self.store.delete(board_id)
    }
}

pub struct SqlBoardIndex {
    sql: SqlStorage,
    migrated: Cell<bool>,
}

fn integer(value: i64) -> Result<u64, String> {
    u64::try_from(value).map_err(|e| e.to_string())
}

fn board_of(row: &[SqlStorageValue]) -> Result<MyBoard, String> {
    match row {
        [
            SqlStorageValue::String(board_id),
            SqlStorageValue::String(name),
            SqlStorageValue::Integer(last_opened),
            SqlStorageValue::String(thumbnail),
        ] => Ok(MyBoard {
            board_id: board_id.clone(),
            name: name.clone(),
            last_opened: integer(*last_opened)?,
            thumbnail: thumbnail.clone(),
        }),
        other => Err(format!("my_board returned a malformed row: {other:?}")),
    }
}

impl SqlBoardIndex {
    pub fn new(sql: SqlStorage) -> Self {
        SqlBoardIndex {
            sql,
            migrated: Cell::new(false),
        }
    }

    fn rows(
        &self,
        query: &str,
        bindings: Vec<SqlStorageValue>,
    ) -> Result<Vec<Vec<SqlStorageValue>>, String> {
        self.migrate()?;
        self.sql
            .exec(query, bindings)
            .map_err(|e| e.to_string())?
            .raw()
            .map(|row| row.map_err(|e| e.to_string()))
            .collect()
    }

    fn migrate(&self) -> Result<(), String> {
        if !self.migrated.get() {
            migrate_with(&self.sql, MIGRATIONS)?;
            self.migrated.set(true);
        }
        Ok(())
    }
}

impl BoardIndexStore for SqlBoardIndex {
    fn get(&self, board_id: &str) -> Result<Option<MyBoard>, String> {
        self.rows(
            "SELECT board_id, name, last_opened, thumbnail FROM my_board WHERE board_id = ?",
            vec![board_id.into()],
        )?
        .first()
        .map(|row| board_of(row))
        .transpose()
    }

    fn put(&self, board: &MyBoard) -> Result<(), String> {
        self.migrate()?;
        let last_opened = i64::try_from(board.last_opened).map_err(|e| e.to_string())?;
        run(
            &self.sql,
            "INSERT INTO my_board (board_id, name, last_opened, thumbnail) VALUES (?, ?, ?, ?)
             ON CONFLICT (board_id)
             DO UPDATE SET name = excluded.name, last_opened = excluded.last_opened,
                           thumbnail = excluded.thumbnail",
            vec![
                board.board_id.as_str().into(),
                board.name.as_str().into(),
                last_opened.into(),
                board.thumbnail.as_str().into(),
            ],
        )
    }

    fn delete(&self, board_id: &str) -> Result<(), String> {
        self.migrate()?;
        run(
            &self.sql,
            "DELETE FROM my_board WHERE board_id = ?",
            vec![board_id.into()],
        )
    }

    fn all(&self) -> Result<Vec<MyBoard>, String> {
        self.rows(
            "SELECT board_id, name, last_opened, thumbnail FROM my_board",
            vec![],
        )?
        .iter()
        .map(|row| board_of(row))
        .collect()
    }

    fn ages(&self) -> Result<Vec<(String, u64)>, String> {
        self.rows("SELECT board_id, last_opened FROM my_board", vec![])?
            .iter()
            .map(|row| match row.as_slice() {
                [
                    SqlStorageValue::String(board_id),
                    SqlStorageValue::Integer(last_opened),
                ] => Ok((board_id.clone(), integer(*last_opened)?)),
                other => Err(format!("my_board returned a malformed row: {other:?}")),
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use super::*;

    #[derive(Default)]
    struct MemoryIndex {
        rows: RefCell<HashMap<String, MyBoard>>,
    }

    impl BoardIndexStore for &MemoryIndex {
        fn get(&self, board_id: &str) -> Result<Option<MyBoard>, String> {
            Ok(self.rows.borrow().get(board_id).cloned())
        }
        fn put(&self, board: &MyBoard) -> Result<(), String> {
            self.rows
                .borrow_mut()
                .insert(board.board_id.clone(), board.clone());
            Ok(())
        }
        fn delete(&self, board_id: &str) -> Result<(), String> {
            self.rows.borrow_mut().remove(board_id);
            Ok(())
        }
        fn all(&self) -> Result<Vec<MyBoard>, String> {
            Ok(self.rows.borrow().values().cloned().collect())
        }
        fn ages(&self) -> Result<Vec<(String, u64)>, String> {
            Ok(self
                .rows
                .borrow()
                .values()
                .map(|b| (b.board_id.clone(), b.last_opened))
                .collect())
        }
    }

    fn opened(at: u64) -> BoardPatch {
        BoardPatch {
            last_opened: Some(at),
            ..BoardPatch::default()
        }
    }

    fn ids(boards: &UserBoards<&MemoryIndex>) -> Vec<String> {
        boards
            .list()
            .unwrap()
            .into_iter()
            .map(|b| b.board_id)
            .collect()
    }

    #[test]
    fn lists_newest_first_and_a_reopen_moves_to_the_front() {
        let memory = MemoryIndex::default();
        let boards = UserBoards::new(&memory);
        for (id, at) in [("a", 1), ("b", 3), ("c", 2)] {
            boards.upsert(id, opened(at), 0).unwrap().unwrap();
        }
        assert_eq!(ids(&boards), ["b", "c", "a"]);
        boards.upsert("a", opened(4), 0).unwrap().unwrap();
        assert_eq!(ids(&boards), ["a", "b", "c"]);
    }

    #[test]
    fn a_rename_keeps_recency_and_a_stale_open_never_moves_back() {
        let memory = MemoryIndex::default();
        let boards = UserBoards::new(&memory);
        boards.upsert("a", opened(5), 0).unwrap().unwrap();
        let renamed = BoardPatch {
            name: Some("Sketchbook".into()),
            ..BoardPatch::default()
        };
        let board = boards.upsert("a", renamed, 99).unwrap().unwrap();
        assert_eq!((board.name.as_str(), board.last_opened), ("Sketchbook", 5));
        let board = boards.upsert("a", opened(2), 0).unwrap().unwrap();
        assert_eq!((board.name.as_str(), board.last_opened), ("Sketchbook", 5));
    }

    #[test]
    fn a_new_board_defaults_its_name_and_time() {
        let memory = MemoryIndex::default();
        let boards = UserBoards::new(&memory);
        let board = boards
            .upsert("fresh", BoardPatch::default(), 42)
            .unwrap()
            .unwrap();
        assert_eq!(
            board,
            MyBoard {
                board_id: "fresh".into(),
                name: "fresh".into(),
                last_opened: 42,
                thumbnail: String::new(),
            }
        );
    }

    #[test]
    fn caps_the_list_by_dropping_the_oldest() {
        let memory = MemoryIndex::default();
        let boards = UserBoards::new(&memory);
        for at in 0..MAX_BOARDS as u64 {
            boards
                .upsert(&format!("b{at}"), opened(at), 0)
                .unwrap()
                .unwrap();
        }
        boards.upsert("newest", opened(1_000), 0).unwrap().unwrap();
        let listed = ids(&boards);
        assert_eq!(listed.len(), MAX_BOARDS);
        assert_eq!(listed[0], "newest");
        assert!(!listed.contains(&"b0".to_string()));
        assert!(listed.contains(&"b1".to_string()));
    }

    #[test]
    fn rejects_a_thumbnail_over_the_limit() {
        let memory = MemoryIndex::default();
        let boards = UserBoards::new(&memory);
        let fits = format!(
            "{PNG_DATA_URL}{}",
            "A".repeat(MAX_THUMBNAIL_BYTES - PNG_DATA_URL.len())
        );
        let patch = |thumbnail: &str| BoardPatch {
            thumbnail: Some(thumbnail.to_owned()),
            ..BoardPatch::default()
        };
        assert!(boards.upsert("a", patch(&fits), 1).unwrap().is_ok());
        let too_large = format!("{fits}A");
        assert_eq!(
            boards.upsert("a", patch(&too_large), 2).unwrap(),
            Err(Refusal::ThumbnailTooLarge)
        );
        assert_eq!(
            boards
                .upsert("a", patch("data:image/jpeg;base64,AA"), 3)
                .unwrap(),
            Err(Refusal::ThumbnailNotPng)
        );
        assert_eq!(boards.list().unwrap()[0].thumbnail, fits);
    }
}
