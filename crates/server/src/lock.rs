use std::cell::Cell;

use worker::{SqlStorage, SqlStorageValue};

use crate::store::{migrate, run};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lock {
    pub pin_hash: String,
    pub generation: u64,
}

impl Lock {
    pub fn is_locked(&self) -> bool {
        !self.pin_hash.is_empty()
    }
}

pub struct SqlLockStore {
    sql: SqlStorage,
    migrated: Cell<bool>,
}

fn integer(value: i64) -> Result<u64, String> {
    u64::try_from(value).map_err(|e| e.to_string())
}

impl SqlLockStore {
    pub fn new(sql: SqlStorage) -> Self {
        SqlLockStore {
            sql,
            migrated: Cell::new(false),
        }
    }

    fn migrate(&self) -> Result<(), String> {
        if !self.migrated.get() {
            migrate(&self.sql)?;
            self.migrated.set(true);
        }
        Ok(())
    }

    fn row(
        &self,
        query: &str,
        bindings: Vec<SqlStorageValue>,
    ) -> Result<Option<Vec<SqlStorageValue>>, String> {
        self.migrate()?;
        self.sql
            .exec(query, bindings)
            .map_err(|e| e.to_string())?
            .raw()
            .next()
            .transpose()
            .map_err(|e| e.to_string())
    }

    pub fn lock(&self) -> Result<Lock, String> {
        match self
            .row(
                "SELECT pin_hash, generation FROM board_lock WHERE lock_id = 1",
                vec![],
            )?
            .as_deref()
        {
            None => Ok(Lock {
                pin_hash: String::new(),
                generation: 0,
            }),
            Some(
                [
                    SqlStorageValue::String(pin_hash),
                    SqlStorageValue::Integer(generation),
                ],
            ) => Ok(Lock {
                pin_hash: pin_hash.clone(),
                generation: integer(*generation)?,
            }),
            Some(other) => Err(format!("board_lock returned a malformed row: {other:?}")),
        }
    }

    pub fn set_pin_hash(&self, pin_hash: &str) -> Result<Lock, String> {
        let next = Lock {
            pin_hash: pin_hash.to_owned(),
            generation: self.lock()?.generation + 1,
        };
        let generation = i64::try_from(next.generation).map_err(|e| e.to_string())?;
        run(
            &self.sql,
            "INSERT INTO board_lock (lock_id, pin_hash, generation) VALUES (1, ?, ?)
             ON CONFLICT (lock_id)
             DO UPDATE SET pin_hash = excluded.pin_hash, generation = excluded.generation",
            vec![pin_hash.into(), generation.into()],
        )?;
        Ok(next)
    }

    pub fn attempts(&self, client: &str) -> Result<Vec<u64>, String> {
        match self
            .row(
                "SELECT attempts FROM pin_attempt WHERE client = ?",
                vec![client.into()],
            )?
            .as_deref()
        {
            None => Ok(Vec::new()),
            Some([SqlStorageValue::String(attempts)]) => serde_json::from_str(attempts)
                .map_err(|e| format!("pin_attempt for {client:?} is not a JSON list: {e}")),
            Some(other) => Err(format!("pin_attempt returned a malformed row: {other:?}")),
        }
    }

    pub fn record_attempts(
        &self,
        client: &str,
        attempts: &[u64],
        now_ms: u64,
        window_ms: u64,
    ) -> Result<(), String> {
        let now = i64::try_from(now_ms).map_err(|e| e.to_string())?;
        let stale = i64::try_from(now_ms.saturating_sub(window_ms)).map_err(|e| e.to_string())?;
        let attempts = serde_json::to_string(attempts).map_err(|e| e.to_string())?;
        run(
            &self.sql,
            "DELETE FROM pin_attempt WHERE updated_at < ?",
            vec![stale.into()],
        )?;
        run(
            &self.sql,
            "INSERT INTO pin_attempt (client, attempts, updated_at) VALUES (?, ?, ?)
             ON CONFLICT (client)
             DO UPDATE SET attempts = excluded.attempts, updated_at = excluded.updated_at",
            vec![client.into(), attempts.into(), now.into()],
        )
    }
}
