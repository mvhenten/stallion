use serde::{Deserialize, Serialize};

pub const MAX_POINTS: usize = 4096;
pub const MAX_TEXT: usize = 4096;
pub const MAX_OBJECT_ID: usize = 64;
pub const ZOOM_RANGE: std::ops::RangeInclusive<i32> = -40..=40;
pub const MAX_COLOUR: u8 = 5;
pub const MAX_RGB: u32 = 0xFF_FFFF;
pub const WIDTH_RANGE: std::ops::RangeInclusive<f64> = 0.5..=96.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bbox {
    #[serde(rename = "minX")]
    pub min_x: f64,
    #[serde(rename = "minY")]
    pub min_y: f64,
    #[serde(rename = "maxX")]
    pub max_x: f64,
    #[serde(rename = "maxY")]
    pub max_y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PencilSize {
    Small,
    Medium,
    Large,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum StrokeStyle {
    #[default]
    Pen,
    Highlighter,
    Dashed,
    Uniform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    Line,
    Arrow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShapeFill {
    None,
    Tint,
}

pub type Point = (f64, f64, f64);

pub type ShapePoint = (f64, f64);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Stroke {
    pub object_id: String,
    pub native_zoom: i32,
    pub bbox: Bbox,
    pub colour: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgb: Option<u32>,
    pub size: PencilSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default)]
    pub style: StrokeStyle,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Shape {
    pub object_id: String,
    pub native_zoom: i32,
    pub bbox: Bbox,
    pub colour: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgb: Option<u32>,
    pub size: PencilSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default)]
    pub style: StrokeStyle,
    pub kind: ShapeKind,
    pub start: ShapePoint,
    pub end: ShapePoint,
    pub fill: ShapeFill,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Text {
    pub object_id: String,
    pub native_zoom: i32,
    pub bbox: Bbox,
    pub colour: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgb: Option<u32>,
    pub size: PencilSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StallionObject {
    Stroke(Stroke),
    Shape(Shape),
    Text(Text),
}

struct Common<'a> {
    object_id: &'a str,
    native_zoom: i32,
    bbox: &'a Bbox,
    colour: u8,
    rgb: Option<u32>,
    width: Option<f64>,
}

impl StallionObject {
    pub fn object_id(&self) -> &str {
        self.common().object_id
    }

    pub fn bbox(&self) -> &Bbox {
        self.common().bbox
    }

    fn common(&self) -> Common<'_> {
        match self {
            StallionObject::Stroke(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: o.colour,
                rgb: o.rgb,
                width: o.width,
            },
            StallionObject::Shape(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: o.colour,
                rgb: o.rgb,
                width: o.width,
            },
            StallionObject::Text(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: o.colour,
                rgb: o.rgb,
                width: o.width,
            },
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        let common = self.common();
        let id = common.object_id;
        let id_ok = !id.is_empty()
            && id.len() <= MAX_OBJECT_ID
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
        if !id_ok {
            return Err(format!("objectId {id:?} must match [0-9A-Za-z_-]{{1,64}}"));
        }
        if !ZOOM_RANGE.contains(&common.native_zoom) {
            return Err(format!(
                "nativeZoom {} is outside -40..40",
                common.native_zoom
            ));
        }
        if common.colour > MAX_COLOUR {
            return Err(format!("colour {} is outside 0..5", common.colour));
        }
        if let Some(rgb) = common.rgb.filter(|&rgb| rgb > MAX_RGB) {
            return Err(format!("rgb {rgb:#x} is outside 0..0xFFFFFF"));
        }
        if let Some(width) = common.width.filter(|width| !WIDTH_RANGE.contains(width)) {
            return Err(format!("width {width} is outside 0.5..96"));
        }
        let b = common.bbox;
        if ![b.min_x, b.min_y, b.max_x, b.max_y]
            .iter()
            .all(|v| v.is_finite())
        {
            return Err("bbox must be finite".into());
        }
        match self {
            StallionObject::Stroke(s) => validate_points(&s.points),
            StallionObject::Shape(s) => {
                if ![s.start.0, s.start.1, s.end.0, s.end.1]
                    .iter()
                    .all(|v| v.is_finite())
                {
                    return Err("shape start and end must be finite".into());
                }
                Ok(())
            }
            StallionObject::Text(t) => {
                let len = t.text.encode_utf16().count();
                if len == 0 || len > MAX_TEXT {
                    return Err(format!("text length {len} is outside 1..{MAX_TEXT}"));
                }
                Ok(())
            }
        }
    }
}

fn validate_points(points: &[Point]) -> Result<(), String> {
    if points.is_empty() || points.len() > MAX_POINTS {
        return Err(format!(
            "points length {} is outside 1..{MAX_POINTS}",
            points.len()
        ));
    }
    for &(x, y, pressure) in points {
        if !x.is_finite() || !y.is_finite() {
            return Err("points must be finite".into());
        }
        if !(0.0..=1.0).contains(&pressure) {
            return Err(format!("pressure {pressure} is outside 0..1"));
        }
    }
    Ok(())
}

pub fn decode(bytes: &[u8]) -> Result<StallionObject, String> {
    let object: StallionObject =
        ciborium::from_reader(bytes).map_err(|e| format!("invalid object: {e}"))?;
    object.validate()?;
    Ok(object)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/stroke.cbor.hex"
        ))
    }

    fn shape_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/shape.cbor.hex"
        ))
    }

    fn legacy_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/stroke-legacy.cbor.hex"
        ))
    }

    fn from_hex(text: &str) -> Vec<u8> {
        let hex = text.trim();
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect()
    }

    fn golden_stroke(
        colour: u8,
        rgb: Option<u32>,
        width: Option<f64>,
        style: StrokeStyle,
    ) -> StallionObject {
        StallionObject::Stroke(Stroke {
            object_id: "stroke-0001".into(),
            native_zoom: -3,
            bbox: Bbox {
                min_x: 10.0,
                min_y: 12.5,
                max_x: 42.0,
                max_y: 30.25,
            },
            colour,
            rgb,
            size: PencilSize::Medium,
            width,
            style,
            points: vec![(10.0, 12.5, 0.5), (26.0, 20.0, 0.75), (42.0, 30.25, 1.0)],
        })
    }

    #[test]
    fn decodes_the_golden_stroke_fixture() {
        assert_eq!(
            decode(&fixture()),
            Ok(golden_stroke(
                0,
                Some(0x12_3456),
                Some(12.5),
                StrokeStyle::Highlighter
            ))
        );
    }

    #[test]
    fn decodes_the_legacy_stroke_fixture_without_rgb_width_or_style_as_pen() {
        assert_eq!(
            decode(&legacy_fixture()),
            Ok(golden_stroke(2, None, None, StrokeStyle::Pen))
        );
    }

    #[test]
    fn round_trips_every_stroke_style_and_rejects_an_unknown_one() {
        for style in [
            StrokeStyle::Pen,
            StrokeStyle::Highlighter,
            StrokeStyle::Dashed,
            StrokeStyle::Uniform,
        ] {
            let stroke = golden_stroke(0, Some(0x12_3456), Some(12.5), style);
            let mut bytes = Vec::new();
            ciborium::into_writer(&stroke, &mut bytes).unwrap();
            assert_eq!(decode(&bytes), Ok(stroke));
        }
        let mut unknown = fixture();
        let at = unknown
            .windows(11)
            .position(|w| w == b"Highlighter")
            .unwrap();
        unknown[at..at + 11].copy_from_slice(b"Highlightxr");
        assert!(decode(&unknown).is_err());
    }

    fn golden_shape() -> Shape {
        Shape {
            object_id: "shape-0001".into(),
            native_zoom: 0,
            bbox: Bbox {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 256.0,
                max_y: 128.0,
            },
            colour: 5,
            rgb: Some(0x8E_4EC6),
            size: PencilSize::Large,
            width: Some(20.0),
            style: StrokeStyle::Dashed,
            kind: ShapeKind::Arrow,
            start: (240.5, 12.0),
            end: (16.0, 116.25),
            fill: ShapeFill::Tint,
        }
    }

    fn encode(object: StallionObject) -> Vec<u8> {
        let mut bytes = Vec::new();
        ciborium::into_writer(&object, &mut bytes).unwrap();
        bytes
    }

    #[test]
    fn decodes_the_golden_shape_fixture() {
        assert_eq!(
            decode(&shape_fixture()),
            Ok(StallionObject::Shape(golden_shape()))
        );
    }

    #[test]
    fn round_trips_every_shape_kind_and_fill() {
        for kind in [
            ShapeKind::Rectangle,
            ShapeKind::Ellipse,
            ShapeKind::Line,
            ShapeKind::Arrow,
        ] {
            for fill in [ShapeFill::None, ShapeFill::Tint] {
                let shape = StallionObject::Shape(Shape {
                    kind,
                    fill,
                    ..golden_shape()
                });
                assert_eq!(decode(&encode(shape.clone())), Ok(shape));
            }
        }
    }

    #[test]
    fn rejects_a_shape_with_a_bad_point_or_width() {
        let not_finite = Shape {
            end: (f64::INFINITY, 0.0),
            ..golden_shape()
        };
        assert!(
            decode(&encode(StallionObject::Shape(not_finite)))
                .unwrap_err()
                .contains("start and end")
        );
        let too_wide = Shape {
            width: Some(96.5),
            ..golden_shape()
        };
        assert!(
            decode(&encode(StallionObject::Shape(too_wide)))
                .unwrap_err()
                .contains("width")
        );
    }

    #[test]
    fn rejects_an_unknown_shape_kind() {
        let mut unknown = shape_fixture();
        let at = unknown.windows(5).position(|w| w == b"Arrow").unwrap();
        unknown[at..at + 5].copy_from_slice(b"Arrox");
        assert!(decode(&unknown).is_err());
    }

    #[test]
    fn rejects_an_rgb_above_0xffffff() {
        let StallionObject::Stroke(mut stroke) = decode(&fixture()).unwrap() else {
            unreachable!()
        };
        stroke.rgb = Some(MAX_RGB + 1);
        let mut bytes = Vec::new();
        ciborium::into_writer(&StallionObject::Stroke(stroke), &mut bytes).unwrap();
        assert!(decode(&bytes).unwrap_err().contains("rgb"));
    }

    #[test]
    fn rejects_a_width_outside_half_to_96_or_not_finite() {
        for width in [0.4, 96.5, f64::INFINITY, f64::NAN] {
            let StallionObject::Stroke(mut stroke) = decode(&fixture()).unwrap() else {
                unreachable!()
            };
            stroke.width = Some(width);
            let mut bytes = Vec::new();
            ciborium::into_writer(&StallionObject::Stroke(stroke), &mut bytes).unwrap();
            assert!(decode(&bytes).unwrap_err().contains("width"), "{width}");
        }
    }

    #[test]
    fn accepts_a_width_at_either_bound() {
        for width in [0.5, 96.0] {
            let StallionObject::Stroke(mut stroke) = decode(&fixture()).unwrap() else {
                unreachable!()
            };
            stroke.width = Some(width);
            let mut bytes = Vec::new();
            ciborium::into_writer(&StallionObject::Stroke(stroke), &mut bytes).unwrap();
            assert!(decode(&bytes).is_ok(), "{width}");
        }
    }

    #[test]
    fn rejects_an_out_of_range_colour() {
        let StallionObject::Stroke(mut stroke) = decode(&fixture()).unwrap() else {
            unreachable!()
        };
        stroke.colour = 6;
        let mut bytes = Vec::new();
        ciborium::into_writer(&StallionObject::Stroke(stroke), &mut bytes).unwrap();
        assert!(decode(&bytes).unwrap_err().contains("colour"));
    }
}
