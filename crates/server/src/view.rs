use serde::{Deserialize, Deserializer, Serialize};

use crate::store::TileCoord;

pub const TILE_SIZE: f64 = 256.0;
pub const MIN_LEVEL: i32 = -40;
pub const MAX_LEVEL: i32 = 40;
pub const LIVE_TILE_MIN_PX: f64 = 64.0;
pub const SUB_PIXEL_PX: f64 = 1.0;

pub const OBJECT_BUDGET: usize = 4096;
pub const MAX_VIEW_PX: f64 = 16384.0;
const MAX_SAFE_INDEX: f64 = 9_007_199_254_740_991.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Viewport {
    #[serde(deserialize_with = "number")]
    pub min_x: f64,
    #[serde(deserialize_with = "number")]
    pub min_y: f64,
    #[serde(deserialize_with = "number")]
    pub max_x: f64,
    #[serde(deserialize_with = "number")]
    pub max_y: f64,
    #[serde(deserialize_with = "number")]
    pub zoom: f64,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Number {
    Float(f64),
    Int(i64),
}

fn number<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    Ok(match Number::deserialize(deserializer)? {
        Number::Float(value) => value,
        Number::Int(value) => value as f64,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LevelRange {
    pub level: i32,
    pub min_tx: i64,
    pub min_ty: i64,
    pub max_tx: i64,
    pub max_ty: i64,
}

impl LevelRange {
    pub fn contains(&self, (level, tx, ty): TileCoord) -> bool {
        level == self.level
            && (self.min_tx..=self.max_tx).contains(&tx)
            && (self.min_ty..=self.max_ty).contains(&ty)
    }

    pub fn center(&self) -> (i64, i64) {
        (
            self.min_tx + (self.max_tx - self.min_tx) / 2,
            self.min_ty + (self.max_ty - self.min_ty) / 2,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewTiles {
    pub live: Vec<LevelRange>,
    pub snapshot: Vec<LevelRange>,
}

pub fn clamp_level(level: f64) -> i32 {
    level.clamp(f64::from(MIN_LEVEL), f64::from(MAX_LEVEL)) as i32
}

pub fn tile_world_size(level: i32) -> f64 {
    TILE_SIZE * 2f64.powi(level)
}

pub fn grid_origin(level: i32) -> f64 {
    if level == MAX_LEVEL {
        -tile_world_size(MAX_LEVEL) / 2.0
    } else {
        0.0
    }
}

pub fn tile_index(level: i32, coordinate: f64) -> Result<i64, String> {
    let index = ((coordinate - grid_origin(level)) / tile_world_size(level)).floor();
    if index.abs() > MAX_SAFE_INDEX {
        return Err(format!(
            "coordinate {coordinate} is out of range at level {level}"
        ));
    }
    Ok(index as i64)
}

fn level_for_screen_size(px: f64, zoom: f64) -> i32 {
    clamp_level((px / (TILE_SIZE * zoom)).log2().ceil())
}

pub fn finest_level(zoom: f64) -> i32 {
    level_for_screen_size(SUB_PIXEL_PX, zoom)
}

pub fn finest_live_level(zoom: f64) -> i32 {
    level_for_screen_size(LIVE_TILE_MIN_PX, zoom)
}

impl Viewport {
    pub fn decode(payload: &[u8]) -> Result<Viewport, String> {
        let viewport: Viewport =
            ciborium::from_reader(payload).map_err(|e| format!("invalid view payload: {e}"))?;
        viewport.validate()?;
        Ok(viewport)
    }

    fn validate(&self) -> Result<(), String> {
        let bound = tile_world_size(MAX_LEVEL) / 2.0;
        let coordinates = [self.min_x, self.min_y, self.max_x, self.max_y];
        if !coordinates
            .iter()
            .all(|c| c.is_finite() && c.abs() <= bound)
        {
            return Err(format!("view bounds must be finite and within ±{bound}"));
        }
        if !(self.zoom.is_finite() && self.zoom > 0.0) {
            return Err(format!(
                "zoom must be a positive finite number, got {}",
                self.zoom
            ));
        }
        if self.min_x > self.max_x || self.min_y > self.max_y {
            return Err("view bounds must have min <= max".into());
        }
        let (width, height) = (
            (self.max_x - self.min_x) * self.zoom,
            (self.max_y - self.min_y) * self.zoom,
        );
        if width > MAX_VIEW_PX || height > MAX_VIEW_PX {
            return Err(format!(
                "view is {width}x{height} px; the limit is {MAX_VIEW_PX} px a side"
            ));
        }
        self.tiles().map(|_| ())
    }

    pub fn level_range(&self, level: i32) -> Result<LevelRange, String> {
        Ok(LevelRange {
            level,
            min_tx: tile_index(level, self.min_x)?,
            min_ty: tile_index(level, self.min_y)?,
            max_tx: tile_index(level, self.max_x)?,
            max_ty: tile_index(level, self.max_y)?,
        })
    }

    pub fn tiles(&self) -> Result<ViewTiles, String> {
        let live_from = finest_live_level(self.zoom);
        let mut tiles = ViewTiles {
            live: Vec::new(),
            snapshot: Vec::new(),
        };
        for level in (MIN_LEVEL.max(finest_level(self.zoom))..=MAX_LEVEL).rev() {
            let range = self.level_range(level)?;
            if level >= live_from {
                tiles.live.push(range);
            } else {
                tiles.snapshot.push(range);
            }
        }
        Ok(tiles)
    }

    pub fn is_live(&self, coord: TileCoord) -> bool {
        let level = coord.0;
        (finest_live_level(self.zoom)..=MAX_LEVEL).contains(&level)
            && self
                .level_range(level)
                .is_ok_and(|range| range.contains(coord))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn constants_match_the_typescript_geometry_package() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/geometry/src/constants.ts"
        );
        let source = std::fs::read_to_string(path).unwrap();
        let typescript: BTreeMap<&str, f64> = source
            .lines()
            .filter_map(|line| line.strip_prefix("export const "))
            .map(|line| {
                let (name, value) = line.trim_end_matches(';').split_once(" = ").unwrap();
                (name, value.parse().unwrap())
            })
            .collect();
        let rust = BTreeMap::from([
            ("TILE_SIZE", TILE_SIZE),
            ("MIN_LEVEL", f64::from(MIN_LEVEL)),
            ("MAX_LEVEL", f64::from(MAX_LEVEL)),
            ("LIVE_TILE_MIN_PX", LIVE_TILE_MIN_PX),
            ("SUB_PIXEL_PX", SUB_PIXEL_PX),
        ]);
        assert_eq!(typescript, rust);
        assert_eq!(
            crate::object::ZOOM_RANGE,
            MIN_LEVEL..=MAX_LEVEL,
            "object zoom range drifted from the level range"
        );
    }

    #[test]
    fn splits_levels_into_a_live_band_and_snapshots_like_view_tiles() {
        let mut payload = Vec::new();
        let raw = ciborium::Value::Map(
            [
                ("minX", 0.into()),
                ("minY", 0.into()),
                ("maxX", 1024.into()),
                ("maxY", ciborium::Value::Float(768.0)),
                ("zoom", 1.into()),
            ]
            .into_iter()
            .map(|(k, v)| (ciborium::Value::Text(k.into()), v))
            .collect(),
        );
        ciborium::into_writer(&raw, &mut payload).unwrap();
        let view = Viewport::decode(&payload).unwrap();
        let tiles = view.tiles().unwrap();
        assert_eq!(tiles.live.first().unwrap().level, MAX_LEVEL);
        assert_eq!(tiles.live.last().unwrap().level, -2);
        let levels: Vec<i32> = tiles.snapshot.iter().map(|r| r.level).collect();
        assert_eq!(levels, [-3, -4, -5, -6, -7, -8]);
        assert_eq!(
            view.level_range(0).unwrap(),
            LevelRange {
                level: 0,
                min_tx: 0,
                min_ty: 0,
                max_tx: 4,
                max_ty: 3
            }
        );
        assert_eq!(view.level_range(MAX_LEVEL).unwrap().min_tx, 0);
        assert!(view.is_live((-2, 16, 12)));
        assert!(!view.is_live((-3, 0, 0)));
        assert!(!view.is_live((0, 5, 0)));

        let wide = Viewport { max_x: 1e6, ..view };
        assert!(wide.validate().is_err());
    }
}
