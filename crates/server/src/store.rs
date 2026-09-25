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
    fn save(&self, record: &TileRecord) -> Result<(), String>;
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
