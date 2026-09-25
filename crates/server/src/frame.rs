use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameKind {
    Subscribe,
    Unsubscribe,
    Sync,
    Awareness,
    Reject,
    View,
    Snapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub tile_key: String,
    pub kind: FrameKind,
    #[serde(with = "serde_bytes")]
    pub payload: Vec<u8>,
}

pub const BOARD_KEY: &str = "";

impl Frame {
    pub fn new(tile_key: impl Into<String>, kind: FrameKind, payload: Vec<u8>) -> Self {
        Frame {
            tile_key: tile_key.into(),
            kind,
            payload,
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        ciborium::into_writer(self, &mut bytes).expect("writing to a Vec cannot fail");
        bytes
    }

    pub fn decode(bytes: &[u8]) -> Result<Frame, String> {
        ciborium::from_reader(bytes).map_err(|e| format!("invalid frame: {e}"))
    }
}

pub fn parse_tile_key(key: &str) -> Result<(i32, i64, i64), String> {
    let invalid = || format!("tileKey {key:?} must be level:tx:ty");
    let mut parts = key.split(':');
    let (Some(level), Some(tx), Some(ty), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid());
    };
    let level: i32 = level.parse().map_err(|_| invalid())?;
    let tx: i64 = tx.parse().map_err(|_| invalid())?;
    let ty: i64 = ty.parse().map_err(|_| invalid())?;
    if !crate::object::ZOOM_RANGE.contains(&level) {
        return Err(format!("tileKey {key:?} has a level outside -40..40"));
    }
    if key != format!("{level}:{tx}:{ty}") {
        return Err(invalid());
    }
    Ok((level, tx, ty))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_golden_frame_fixture_from_the_client_codec() {
        let hex = include_str!("../../../packages/schema/fixtures/frame.cbor.hex").trim();
        let frame = Frame::new("-3:4:-5", FrameKind::Sync, vec![0, 1, 2]);
        let encoded: String = frame.encode().iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(encoded, hex);
        assert_eq!(Frame::decode(&frame.encode()), Ok(frame.clone()));
        let tagged = [
            &[0xa3][..],
            &frame.encode()[1..frame.encode().len() - 4],
            &[0xd8, 0x40, 0x43, 0, 1, 2],
        ]
        .concat();
        assert_eq!(Frame::decode(&tagged), Ok(frame));
    }

    #[test]
    fn rejects_unknown_kinds_and_malformed_tile_keys() {
        let mut bytes = Vec::new();
        use ciborium::Value;
        let raw = Value::Map(vec![
            (Value::Text("tileKey".into()), Value::Text(String::new())),
            (Value::Text("kind".into()), Value::Text("Nope".into())),
            (Value::Text("payload".into()), Value::Bytes(vec![])),
        ]);
        ciborium::into_writer(&raw, &mut bytes).unwrap();
        assert!(Frame::decode(&bytes).is_err());
        assert_eq!(parse_tile_key("0:1:-2"), Ok((0, 1, -2)));
        for key in ["", "0:1", "41:0:0", "0:01:0", "t:0:0:0"] {
            assert!(parse_tile_key(key).is_err(), "{key}");
        }
    }
}
