use std::cell::Cell;

use serde::Serialize;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct TileHint {
    pub level: i32,
    pub tx: i64,
    pub ty: i64,
    pub count: i64,
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
    /// Object counts per tile in `range`, nearest to `center` first, at most `cap` tiles.
    fn hints(
        &self,
        range: &LevelRange,
        center: (i64, i64),
        cap: usize,
    ) -> Result<Vec<TileHint>, String>;
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

pub const HINTS_QUERY: &str = "SELECT level, tx, ty, COUNT(*) AS n
    FROM object_index
    WHERE level = ? AND tx BETWEEN ? AND ? AND ty BETWEEN ? AND ?
    GROUP BY level, tx, ty
    ORDER BY MAX(ABS(tx - ?), ABS(ty - ?)), ty, tx
    LIMIT ?";

pub fn hints_bindings(
    range: &LevelRange,
    (cx, cy): (i64, i64),
    cap: usize,
) -> Result<[i64; 8], String> {
    Ok([
        i64::from(range.level),
        range.min_tx,
        range.max_tx,
        range.min_ty,
        range.max_ty,
        cx,
        cy,
        i64::try_from(cap).map_err(|e| e.to_string())?,
    ])
}

pub fn hint_from_row(row: [i64; 4]) -> Result<TileHint, String> {
    let [level, tx, ty, count] = row;
    Ok(TileHint {
        level: i32::try_from(level).map_err(|e| e.to_string())?,
        tx,
        ty,
        count,
    })
}

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

    fn hints(
        &self,
        range: &LevelRange,
        center: (i64, i64),
        cap: usize,
    ) -> Result<Vec<TileHint>, String> {
        self.migrate()?;
        let bindings: Vec<SqlStorageValue> = hints_bindings(range, center, cap)?
            .into_iter()
            .map(SqlStorageValue::from)
            .collect();
        let cursor = self
            .sql
            .exec(HINTS_QUERY, bindings)
            .map_err(|e| e.to_string())?;
        let mut hints = Vec::new();
        for row in cursor.raw() {
            let row = row.map_err(|e| e.to_string())?;
            let [
                SqlStorageValue::Integer(level),
                SqlStorageValue::Integer(tx),
                SqlStorageValue::Integer(ty),
                SqlStorageValue::Integer(count),
            ] = <[SqlStorageValue; 4]>::try_from(row)
                .map_err(|row| format!("hints query returned {row:?}"))?
            else {
                return Err(format!(
                    "hints query at level {} returned a malformed row",
                    range.level
                ));
            };
            hints.push(hint_from_row([level, tx, ty, count])?);
        }
        Ok(hints)
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

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::view::HINT_CAP;
    use rusqlite::Connection;

    fn seeded(objects: &[(TileCoord, usize)]) -> Connection {
        let db = Connection::open_in_memory().unwrap();
        for step in MIGRATIONS.iter().flat_map(|steps| steps.iter()) {
            db.execute(step, []).unwrap();
        }
        for &((level, tx, ty), count) in objects {
            for i in 0..count {
                db.execute(
                    "INSERT INTO object_index (level, tx, ty, object_id, bbox) VALUES (?, ?, ?, ?, '[0,0,1,1]')",
                    rusqlite::params![level, tx, ty, format!("o{level}:{tx}:{ty}:{i}")],
                )
                .unwrap();
            }
        }
        db
    }

    fn hints(db: &Connection, range: &LevelRange, center: (i64, i64), cap: usize) -> Vec<TileHint> {
        let bindings = hints_bindings(range, center, cap).unwrap();
        let mut statement = db.prepare(HINTS_QUERY).unwrap();
        statement
            .query_map(rusqlite::params_from_iter(bindings), |row| {
                Ok([row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?])
            })
            .unwrap()
            .map(|row| hint_from_row(row.unwrap()).unwrap())
            .collect()
    }

    const RANGE: LevelRange = LevelRange {
        level: -9,
        min_tx: 0,
        min_ty: 0,
        max_tx: 99,
        max_ty: 99,
    };

    #[test]
    fn hints_count_objects_per_tile_at_one_level_inside_the_range() {
        let db = seeded(&[
            ((-9, 10, 10), 3),
            ((-9, 12, 10), 1),
            ((-9, 200, 10), 5),
            ((-10, 10, 10), 7),
            ((-8, 5, 5), 2),
        ]);
        let hint = |tx, ty, count| TileHint {
            level: -9,
            tx,
            ty,
            count,
        };
        assert_eq!(
            hints(&db, &RANGE, (10, 10), HINT_CAP),
            [hint(10, 10, 3), hint(12, 10, 1)]
        );
    }

    #[test]
    fn hints_keep_the_tiles_nearest_the_centre_up_to_the_cap() {
        let tiles: Vec<(TileCoord, usize)> = (0..100)
            .flat_map(|tx| (0..30).map(move |ty| ((-9, tx, ty), 1)))
            .collect();
        let db = seeded(&tiles);
        let all = hints(&db, &RANGE, (50, 15), HINT_CAP);
        assert_eq!(all.len(), HINT_CAP);
        let ring = |h: &TileHint| (h.tx - 50).abs().max((h.ty - 15).abs());
        assert!(all.windows(2).all(|w| ring(&w[0]) <= ring(&w[1])));
        assert!(all.iter().all(|h| ring(h) <= 35));

        let few = hints(&db, &RANGE, (50, 15), 9);
        assert_eq!(few.len(), 9);
        assert!(few.iter().all(|h| ring(h) <= 1), "{few:?}");
    }
}
