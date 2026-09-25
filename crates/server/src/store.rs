use std::cell::Cell;

use worker::{SqlStorage, SqlStorageValue};

use crate::object::Bbox;

pub type TileCoord = (i32, i64, i64);

#[derive(Debug, Clone, PartialEq)]
pub struct TileRecord {
    pub coord: TileCoord,
    pub doc_state: Vec<u8>,
    pub updated_at: u64,
    pub objects: Vec<(String, Bbox)>,
}

pub trait TileStore {
    fn load(&self, coord: TileCoord) -> Result<Option<Vec<u8>>, String>;
    fn save(&self, record: &TileRecord) -> Result<(), String>;
}

pub const MIGRATIONS: &[&[&str]] = &[&[
    "CREATE TABLE tile (
        level INTEGER NOT NULL,
        tx INTEGER NOT NULL,
        ty INTEGER NOT NULL,
        doc_state BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (level, tx, ty)
    )",
    "CREATE TABLE object_index (
        level INTEGER NOT NULL,
        tx INTEGER NOT NULL,
        ty INTEGER NOT NULL,
        object_id TEXT NOT NULL,
        bbox TEXT NOT NULL,
        PRIMARY KEY (level, tx, ty, object_id)
    )",
]];

pub fn bbox_json(bbox: &Bbox) -> String {
    format!(
        "[{},{},{},{}]",
        bbox.min_x, bbox.min_y, bbox.max_x, bbox.max_y
    )
}

pub struct SqlTileStore {
    sql: SqlStorage,
    migrated: Cell<bool>,
}

fn coord_bindings((level, tx, ty): TileCoord) -> Vec<SqlStorageValue> {
    vec![level.into(), tx.into(), ty.into()]
}

impl SqlTileStore {
    pub fn new(sql: SqlStorage) -> Self {
        SqlTileStore {
            sql,
            migrated: Cell::new(false),
        }
    }

    fn run(&self, query: &str, bindings: Vec<SqlStorageValue>) -> Result<(), String> {
        let cursor = self.sql.exec(query, bindings).map_err(|e| e.to_string())?;
        for row in cursor.raw() {
            row.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn migrate(&self) -> Result<(), String> {
        if self.migrated.get() {
            return Ok(());
        }
        self.run(
            "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY)",
            vec![],
        )?;
        let current = self
            .sql
            .exec(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migration",
                None,
            )
            .map_err(|e| e.to_string())?
            .raw()
            .next()
            .transpose()
            .map_err(|e| e.to_string())?;
        let applied = match current.as_deref() {
            Some([SqlStorageValue::Integer(v)]) => usize::try_from(*v).unwrap_or(0),
            _ => 0,
        };
        for (index, steps) in MIGRATIONS.iter().enumerate().skip(applied) {
            for step in *steps {
                self.run(step, vec![])?;
            }
            let version = i64::try_from(index + 1).map_err(|e| e.to_string())?;
            self.run(
                "INSERT INTO schema_migration (version) VALUES (?)",
                vec![version.into()],
            )?;
        }
        self.migrated.set(true);
        Ok(())
    }
}

impl TileStore for SqlTileStore {
    fn load(&self, coord: TileCoord) -> Result<Option<Vec<u8>>, String> {
        self.migrate()?;
        let row = self
            .sql
            .exec(
                "SELECT doc_state FROM tile WHERE level = ? AND tx = ? AND ty = ?",
                coord_bindings(coord),
            )
            .map_err(|e| e.to_string())?
            .raw()
            .next()
            .transpose()
            .map_err(|e| e.to_string())?;
        match row {
            None => Ok(None),
            Some(mut values) => match values.pop() {
                Some(SqlStorageValue::Blob(bytes)) => Ok(Some(bytes)),
                other => Err(format!(
                    "tile {coord:?} has a non-blob doc_state: {other:?}"
                )),
            },
        }
    }

    fn save(&self, record: &TileRecord) -> Result<(), String> {
        self.migrate()?;
        let updated_at = i64::try_from(record.updated_at).map_err(|e| e.to_string())?;
        let mut bindings = coord_bindings(record.coord);
        bindings.push(record.doc_state.clone().into());
        bindings.push(updated_at.into());
        self.run(
            "INSERT INTO tile (level, tx, ty, doc_state, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (level, tx, ty)
             DO UPDATE SET doc_state = excluded.doc_state, updated_at = excluded.updated_at",
            bindings,
        )?;
        self.run(
            "DELETE FROM object_index WHERE level = ? AND tx = ? AND ty = ?",
            coord_bindings(record.coord),
        )?;
        for (object_id, bbox) in &record.objects {
            let mut bindings = coord_bindings(record.coord);
            bindings.push(object_id.as_str().into());
            bindings.push(bbox_json(bbox).into());
            self.run(
                "INSERT INTO object_index (level, tx, ty, object_id, bbox) VALUES (?, ?, ?, ?, ?)",
                bindings,
            )?;
        }
        Ok(())
    }
}
