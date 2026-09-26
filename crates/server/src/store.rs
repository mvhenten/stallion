use std::cell::Cell;

use worker::{SqlStorage, SqlStorageValue};

use crate::object::Bbox;
use crate::view::LevelRange;

pub type TileCoord = (i32, i64, i64);

#[derive(Debug, Clone, PartialEq)]
pub struct TileRecord {
    pub coord: TileCoord,
    pub doc_state: Vec<u8>,
    pub updated_at: u64,
    pub objects: Vec<(String, Bbox)>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TileSnapshot {
    pub coord: TileCoord,
    pub doc_state: Vec<u8>,
    pub objects: usize,
}

pub trait TileStore {
    fn load(&self, coord: TileCoord) -> Result<Option<Vec<u8>>, String>;
    /// Writes every record or none. The Durable Object commits the synchronous writes of one
    /// event, with no await between them, as a single transaction.
    fn save_all(&self, records: &[TileRecord]) -> Result<(), String>;
    /// Tiles whose flushed index holds `object_id`.
    fn locate(&self, object_id: &str) -> Result<Vec<TileCoord>, String>;
    /// Tiles in `range` that hold objects, nearest to `center` first, cut before the
    /// running object count passes `budget`.
    fn range(
        &self,
        range: &LevelRange,
        center: (i64, i64),
        budget: usize,
    ) -> Result<Vec<TileSnapshot>, String>;
}

const RANGE_QUERY: &str = "SELECT c.tx, c.ty, t.doc_state, c.n FROM (
        SELECT tx, ty, n, SUM(n) OVER (ORDER BY ring, ty, tx ROWS UNBOUNDED PRECEDING) AS running
        FROM (
            SELECT tx, ty, COUNT(*) AS n, MAX(ABS(tx - ?), ABS(ty - ?)) AS ring
            FROM object_index
            WHERE level = ? AND tx BETWEEN ? AND ? AND ty BETWEEN ? AND ?
            GROUP BY tx, ty
        )
    ) c
    JOIN tile t ON t.level = ? AND t.tx = c.tx AND t.ty = c.ty
    WHERE c.running <= ?
    ORDER BY c.running";

pub const MIGRATIONS: &[&[&str]] = &[
    &[
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
    ],
    &["CREATE INDEX object_index_object ON object_index (object_id)"],
    &[
        "CREATE TABLE board_lock (
        lock_id INTEGER PRIMARY KEY CHECK (lock_id = 1),
        pin_hash TEXT NOT NULL,
        generation INTEGER NOT NULL
    )",
        "CREATE TABLE pin_attempt (
        client TEXT PRIMARY KEY,
        attempts TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    )",
    ],
];

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
        run(&self.sql, query, bindings)
    }

    fn save(&self, record: &TileRecord) -> Result<(), String> {
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

    fn migrate(&self) -> Result<(), String> {
        if !self.migrated.get() {
            migrate(&self.sql)?;
            self.migrated.set(true);
        }
        Ok(())
    }
}

pub fn run(sql: &SqlStorage, query: &str, bindings: Vec<SqlStorageValue>) -> Result<(), String> {
    let cursor = sql.exec(query, bindings).map_err(|e| e.to_string())?;
    for row in cursor.raw() {
        row.map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn migrate(sql: &SqlStorage) -> Result<(), String> {
    migrate_with(sql, MIGRATIONS)
}

pub fn migrate_with(sql: &SqlStorage, migrations: &[&[&str]]) -> Result<(), String> {
    run(
        sql,
        "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY)",
        vec![],
    )?;
    let current = sql
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
    for (index, steps) in migrations.iter().enumerate().skip(applied) {
        for step in *steps {
            run(sql, step, vec![])?;
        }
        let version = i64::try_from(index + 1).map_err(|e| e.to_string())?;
        run(
            sql,
            "INSERT INTO schema_migration (version) VALUES (?)",
            vec![version.into()],
        )?;
    }
    Ok(())
}

impl TileStore for SqlTileStore {
    fn save_all(&self, records: &[TileRecord]) -> Result<(), String> {
        self.migrate()?;
        for record in records {
            self.save(record)?;
        }
        Ok(())
    }

    fn locate(&self, object_id: &str) -> Result<Vec<TileCoord>, String> {
        self.migrate()?;
        let cursor = self
            .sql
            .exec(
                "SELECT level, tx, ty FROM object_index WHERE object_id = ?",
                vec![object_id.into()],
            )
            .map_err(|e| e.to_string())?;
        let mut found = Vec::new();
        for row in cursor.raw() {
            let row = row.map_err(|e| e.to_string())?;
            let [
                SqlStorageValue::Integer(level),
                SqlStorageValue::Integer(tx),
                SqlStorageValue::Integer(ty),
            ] = <[SqlStorageValue; 3]>::try_from(row)
                .map_err(|row| format!("locate query returned {row:?}"))?
            else {
                return Err(format!(
                    "locate query for {object_id:?} returned a malformed row"
                ));
            };
            found.push((i32::try_from(level).map_err(|e| e.to_string())?, tx, ty));
        }
        Ok(found)
    }

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

    fn range(
        &self,
        range: &LevelRange,
        (cx, cy): (i64, i64),
        budget: usize,
    ) -> Result<Vec<TileSnapshot>, String> {
        self.migrate()?;
        let budget = i64::try_from(budget).map_err(|e| e.to_string())?;
        let bindings: Vec<SqlStorageValue> = vec![
            cx.into(),
            cy.into(),
            range.level.into(),
            range.min_tx.into(),
            range.max_tx.into(),
            range.min_ty.into(),
            range.max_ty.into(),
            range.level.into(),
            budget.into(),
        ];
        let cursor = self
            .sql
            .exec(RANGE_QUERY, bindings)
            .map_err(|e| e.to_string())?;
        let mut tiles = Vec::new();
        for row in cursor.raw() {
            let row = row.map_err(|e| e.to_string())?;
            let [
                SqlStorageValue::Integer(tx),
                SqlStorageValue::Integer(ty),
                SqlStorageValue::Blob(doc_state),
                SqlStorageValue::Integer(objects),
            ] = <[SqlStorageValue; 4]>::try_from(row)
                .map_err(|row| format!("range query returned {row:?}"))?
            else {
                return Err(format!(
                    "range query at level {} returned a malformed row",
                    range.level
                ));
            };
            tiles.push(TileSnapshot {
                coord: (range.level, tx, ty),
                doc_state,
                objects: usize::try_from(objects).map_err(|e| e.to_string())?,
            });
        }
        Ok(tiles)
    }
}
