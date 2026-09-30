use serde::{Deserialize, Serialize};

pub const MAX_POINTS: usize = 4096;
pub const MAX_TEXT_BYTES: usize = 4096;
pub const MAX_WRAP_WIDTH: f64 = 256.0;
pub const MAX_STICKY_BYTES: usize = 4096;
pub const MAX_OBJECT_ID: usize = 64;
pub const ZOOM_RANGE: std::ops::RangeInclusive<i32> = -40..=40;
pub const MAX_COLOUR: u8 = 5;
pub const MAX_RGB: u32 = 0xFF_FFFF;
pub const WIDTH_RANGE: std::ops::RangeInclusive<f64> = 0.5..=96.0;
pub const MAX_HREF_BYTES: usize = 2048;

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

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextFont {
    #[default]
    Sans,
    Serif,
    Mono,
    Hand,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextFit {
    #[default]
    Fixed,
    Auto,
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
    pub rgb: u32,
    pub width: f64,
    pub wrap_width: f64,
    pub text: String,
    #[serde(default)]
    pub font: TextFont,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(default)]
    pub fit: TextFit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sticky {
    pub object_id: String,
    pub native_zoom: i32,
    pub bbox: Bbox,
    pub rgb: u32,
    pub background: u32,
    pub width: f64,
    pub text: String,
    #[serde(default)]
    pub font: TextFont,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(default)]
    pub fit: TextFit,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum StallionObject {
    Stroke(Stroke),
    Shape(Shape),
    Text(Text),
    Sticky(Sticky),
}

struct Common<'a> {
    object_id: &'a str,
    native_zoom: i32,
    bbox: &'a Bbox,
    colour: Option<u8>,
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
                colour: Some(o.colour),
                rgb: o.rgb,
                width: o.width,
            },
            StallionObject::Shape(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: Some(o.colour),
                rgb: o.rgb,
                width: o.width,
            },
            StallionObject::Text(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: None,
                rgb: Some(o.rgb),
                width: Some(o.width),
            },
            StallionObject::Sticky(o) => Common {
                object_id: &o.object_id,
                native_zoom: o.native_zoom,
                bbox: &o.bbox,
                colour: None,
                rgb: Some(o.rgb),
                width: Some(o.width),
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
        if let Some(colour) = common.colour.filter(|&colour| colour > MAX_COLOUR) {
            return Err(format!("colour {colour} is outside 0..5"));
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
                validate_href(t.href.as_deref())?;
                if !(t.wrap_width > 0.0 && t.wrap_width <= MAX_WRAP_WIDTH) {
                    return Err(format!(
                        "wrapWidth {} is outside 0..{MAX_WRAP_WIDTH}",
                        t.wrap_width
                    ));
                }
                let len = t.text.len();
                if len == 0 || len > MAX_TEXT_BYTES {
                    return Err(format!(
                        "text of {len} bytes is outside 1..{MAX_TEXT_BYTES}"
                    ));
                }
                Ok(())
            }
            StallionObject::Sticky(s) => {
                validate_href(s.href.as_deref())?;
                if s.background > MAX_RGB {
                    return Err(format!(
                        "background {:#x} is outside 0..0xFFFFFF",
                        s.background
                    ));
                }
                if s.text.len() > MAX_STICKY_BYTES {
                    return Err(format!(
                        "sticky text of {} bytes is over {MAX_STICKY_BYTES}",
                        s.text.len()
                    ));
                }
                Ok(())
            }
        }
    }
}

// Mirrors HREF_PATTERN in packages/schema/src/text-style.ts.
fn validate_href(href: Option<&str>) -> Result<(), String> {
    let Some(href) = href else {
        return Ok(());
    };
    if href.len() > MAX_HREF_BYTES {
        return Err(format!(
            "href of {} bytes is over {MAX_HREF_BYTES}",
            href.len()
        ));
    }
    let lower = href.to_ascii_lowercase();
    let rest = lower
        .strip_prefix("https://")
        .or_else(|| lower.strip_prefix("http://"))
        .ok_or("href must be an http or https URL")?;
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(host_end);
    if !valid_authority(authority) {
        return Err("href must name a host".into());
    }
    if !tail.bytes().all(|b| (b'!'..=b'~').contains(&b)) {
        return Err("href must be printable ASCII without spaces".into());
    }
    Ok(())
}

fn valid_authority(authority: &str) -> bool {
    let (host, port) = match authority.rfind(':') {
        Some(at) if !authority[at..].contains(']') => {
            (&authority[..at], Some(&authority[at + 1..]))
        }
        _ => (authority, None),
    };
    let port_ok =
        port.is_none_or(|p| (1..=5).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()));
    let host_ok = if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        !inner.is_empty()
            && inner
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b':' || b == b'.')
    } else {
        let labels = host.strip_suffix('.').unwrap_or(host);
        !labels.is_empty()
            && labels.split('.').all(|label| {
                !label.is_empty()
                    && label
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            })
    };
    port_ok && host_ok
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

    fn sticky_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/sticky.cbor.hex"
        ))
    }

    fn sticky_v2_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/sticky-v2.cbor.hex"
        ))
    }

    fn text_v2_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/text-v2.cbor.hex"
        ))
    }

    fn text_fixture() -> Vec<u8> {
        from_hex(include_str!(
            "../../../packages/schema/fixtures/text.cbor.hex"
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

    fn golden_sticky() -> Sticky {
        Sticky {
            object_id: "sticky-0001".into(),
            native_zoom: 1,
            bbox: Bbox {
                min_x: -40.0,
                min_y: 8.5,
                max_x: 160.0,
                max_y: 208.5,
            },
            rgb: 0x1F_2328,
            background: 0xF7_6B15,
            width: 18.0,
            text: "Buy milk\nand a very long line that wraps".into(),
            font: TextFont::Sans,
            bold: false,
            italic: false,
            href: None,
            fit: TextFit::Fixed,
        }
    }

    #[test]
    fn decodes_the_styled_sticky_and_text_fixtures() {
        assert_eq!(
            decode(&sticky_v2_fixture()),
            Ok(StallionObject::Sticky(Sticky {
                font: TextFont::Hand,
                bold: true,
                fit: TextFit::Auto,
                ..golden_sticky()
            }))
        );
        assert_eq!(
            decode(&text_v2_fixture()),
            Ok(StallionObject::Text(Text {
                font: TextFont::Serif,
                bold: true,
                italic: true,
                href: Some("https://example.com/a?b=c#d".into()),
                ..golden_text()
            }))
        );
    }

    #[test]
    fn accepts_http_links_and_rejects_bad_ones() {
        for href in [
            "http://example.com",
            "HTTPS://example.com:8080/a?b=c#d",
            "https://[::1]/x",
        ] {
            let text = StallionObject::Text(Text {
                href: Some(href.into()),
                ..golden_text()
            });
            assert_eq!(decode(&encode(text.clone())), Ok(text), "{href}");
        }
        let long = format!("https://example.com/{}", "a".repeat(MAX_HREF_BYTES));
        for href in [
            "javascript:alert(1)",
            "mailto:someone@example.com",
            "ftp://example.com/",
            "https://",
            "https:///path",
            "https://example.com/a b",
            "https://exämple.com/",
            "https://bad%20link/",
            "https://user@example.com/",
            "https://a..b/",
            "https://example.com:123456/",
            long.as_str(),
        ] {
            let sticky = StallionObject::Sticky(Sticky {
                href: Some(href.into()),
                ..golden_sticky()
            });
            let error = decode(&encode(sticky)).unwrap_err();
            assert!(error.contains("href"), "{href}: {error}");
        }
    }

    #[test]
    fn rejects_an_unknown_font_or_fit() {
        for (from, to) in [
            (b"Serif".as_slice(), b"Serix".as_slice()),
            (b"Fixed", b"Fixex"),
        ] {
            let mut unknown = text_v2_fixture();
            let at = unknown.windows(5).position(|w| w == from).unwrap();
            unknown[at..at + 5].copy_from_slice(to);
            assert!(decode(&unknown).is_err());
        }
    }

    #[test]
    fn decodes_the_golden_sticky_fixture() {
        assert_eq!(
            decode(&sticky_fixture()),
            Ok(StallionObject::Sticky(golden_sticky()))
        );
    }

    #[test]
    fn accepts_an_empty_sticky_and_one_at_the_byte_limit() {
        for text in [String::new(), "é".repeat(MAX_STICKY_BYTES / 2)] {
            let sticky = StallionObject::Sticky(Sticky {
                text,
                ..golden_sticky()
            });
            assert_eq!(decode(&encode(sticky.clone())), Ok(sticky));
        }
    }

    #[test]
    fn rejects_sticky_text_over_4096_bytes() {
        let over = Sticky {
            text: "é".repeat(MAX_STICKY_BYTES / 2) + "x",
            ..golden_sticky()
        };
        assert!(
            decode(&encode(StallionObject::Sticky(over)))
                .unwrap_err()
                .contains("4096")
        );
    }

    #[test]
    fn rejects_a_sticky_with_a_bad_background_or_font() {
        let background = Sticky {
            background: MAX_RGB + 1,
            ..golden_sticky()
        };
        assert!(
            decode(&encode(StallionObject::Sticky(background)))
                .unwrap_err()
                .contains("background")
        );
        let font = Sticky {
            width: 0.25,
            ..golden_sticky()
        };
        assert!(
            decode(&encode(StallionObject::Sticky(font)))
                .unwrap_err()
                .contains("width")
        );
    }

    fn golden_text() -> Text {
        Text {
            object_id: "text-0001".into(),
            native_zoom: -2,
            bbox: Bbox {
                min_x: 12.0,
                min_y: -8.0,
                max_x: 92.0,
                max_y: 23.2,
            },
            rgb: 0xE5_484D,
            width: 24.0,
            wrap_width: 160.0,
            text: "Plain text that wraps\nover lines".into(),
            font: TextFont::Sans,
            bold: false,
            italic: false,
            href: None,
            fit: TextFit::Fixed,
        }
    }

    #[test]
    fn decodes_the_golden_text_fixture() {
        assert_eq!(
            decode(&text_fixture()),
            Ok(StallionObject::Text(golden_text()))
        );
    }

    #[test]
    fn bounds_text_bytes_font_and_wrap_width() {
        let at_limit = StallionObject::Text(Text {
            text: "é".repeat(MAX_TEXT_BYTES / 2),
            wrap_width: MAX_WRAP_WIDTH,
            ..golden_text()
        });
        assert_eq!(decode(&encode(at_limit.clone())), Ok(at_limit));
        let rejected = [
            (
                Text {
                    text: String::new(),
                    ..golden_text()
                },
                "bytes",
            ),
            (
                Text {
                    text: "é".repeat(MAX_TEXT_BYTES / 2) + "x",
                    ..golden_text()
                },
                "bytes",
            ),
            (
                Text {
                    width: 96.5,
                    ..golden_text()
                },
                "width",
            ),
            (
                Text {
                    wrap_width: 0.0,
                    ..golden_text()
                },
                "wrapWidth",
            ),
            (
                Text {
                    wrap_width: 256.5,
                    ..golden_text()
                },
                "wrapWidth",
            ),
            (
                Text {
                    wrap_width: f64::NAN,
                    ..golden_text()
                },
                "wrapWidth",
            ),
        ];
        for (text, reason) in rejected {
            let error = decode(&encode(StallionObject::Text(text))).unwrap_err();
            assert!(error.contains(reason), "{error}");
        }
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
