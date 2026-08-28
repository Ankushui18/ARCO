//! Phase 3 slice: real text rendering, native, zero asset dependencies.
//!
//! This is a built-in vector "16-segment" stroke font: every glyph is a set
//! of line segments on a 4x6 design grid, stroked with round caps. It is
//! deliberately NOT a shaping engine — it exists so `NodeKind::Text` produces
//! actual visible, transformable, colorable vector paths through the exact
//! same Vello pipeline as every other node, instead of the v0.3 empty match
//! arm. The upgrade path to `parley`/`cosmic-text` swaps the glyph source;
//! everything else (encode call site, fills, overrides) stays.

use vello::kurbo::{Affine, BezPath, Cap, Join, Stroke};
use vello::peniko::Color;
use vello::Scene;

// Segment bit layout on the 4x6 grid (y down):
//   A1 A2   top halves        H I J    upper diagonals + center vertical
//   F     B  sides             G1 G2   middle halves
//   E     C                   K L M    lower diagonals + center vertical
//   D1 D2   bottom halves
const A1: u16 = 1 << 0;
const A2: u16 = 1 << 1;
const B: u16 = 1 << 2;
const C: u16 = 1 << 3;
const D1: u16 = 1 << 4;
const D2: u16 = 1 << 5;
const E: u16 = 1 << 6;
const F: u16 = 1 << 7;
const G1: u16 = 1 << 8;
const G2: u16 = 1 << 9;
const H: u16 = 1 << 10;
const I: u16 = 1 << 11;
const J: u16 = 1 << 12;
const K: u16 = 1 << 13;
const L: u16 = 1 << 14;
const M: u16 = 1 << 15;

const SEG_LINES: [(u16, (f64, f64, f64, f64)); 16] = [
    (A1, (0.0, 0.0, 2.0, 0.0)),
    (A2, (2.0, 0.0, 4.0, 0.0)),
    (B, (4.0, 0.0, 4.0, 3.0)),
    (C, (4.0, 3.0, 4.0, 6.0)),
    (D1, (0.0, 6.0, 2.0, 6.0)),
    (D2, (2.0, 6.0, 4.0, 6.0)),
    (E, (0.0, 3.0, 0.0, 6.0)),
    (F, (0.0, 0.0, 0.0, 3.0)),
    (G1, (0.0, 3.0, 2.0, 3.0)),
    (G2, (2.0, 3.0, 4.0, 3.0)),
    (H, (0.0, 0.0, 2.0, 3.0)),
    (I, (2.0, 0.0, 2.0, 3.0)),
    (J, (4.0, 0.0, 2.0, 3.0)),
    (K, (0.0, 6.0, 2.0, 3.0)),
    (L, (2.0, 3.0, 2.0, 6.0)),
    (M, (2.0, 3.0, 4.0, 6.0)),
];

fn glyph(c: char) -> Option<u16> {
    Some(match c.to_ascii_uppercase() {
        '0' => A1 | A2 | B | C | D1 | D2 | E | F | J | K,
        '1' => B | C,
        '2' => A1 | A2 | B | G1 | G2 | E | D1 | D2,
        '3' => A1 | A2 | B | C | D1 | D2 | G2,
        '4' => F | G1 | G2 | B | C,
        '5' => A1 | A2 | F | G1 | G2 | C | D1 | D2,
        '6' => A1 | A2 | F | E | D1 | D2 | C | G1 | G2,
        '7' => A1 | A2 | B | C,
        '8' => A1 | A2 | B | C | D1 | D2 | E | F | G1 | G2,
        '9' => A1 | A2 | B | C | D1 | D2 | F | G1 | G2,
        'A' => A1 | A2 | B | C | E | F | G1 | G2,
        'B' => A1 | A2 | B | C | D1 | D2 | I | L | G2,
        'C' => A1 | A2 | F | E | D1 | D2,
        'D' => A1 | A2 | B | C | D1 | D2 | I | L,
        'E' => A1 | A2 | F | E | D1 | D2 | G1 | G2,
        'F' => A1 | A2 | F | E | G1,
        'G' => A1 | A2 | F | E | D1 | D2 | C | G2,
        'H' => B | C | E | F | G1 | G2,
        'I' => A1 | A2 | I | L | D1 | D2,
        'J' => B | C | D1 | D2 | E,
        'K' => F | E | G1 | J | M,
        'L' => F | E | D1 | D2,
        'M' => F | E | H | J | B | C,
        'N' => F | E | H | M | B | C,
        'O' => A1 | A2 | B | C | D1 | D2 | E | F,
        'P' => A1 | A2 | B | F | E | G1 | G2,
        'Q' => A1 | A2 | B | C | D1 | D2 | E | F | M,
        'R' => A1 | A2 | B | F | E | G1 | G2 | M,
        'S' => A1 | A2 | F | G1 | G2 | C | D1 | D2,
        'T' => A1 | A2 | I | L,
        'U' => F | E | D1 | D2 | C | B,
        'V' => F | E | J,
        'W' => F | E | K | M | B | C,
        'X' => H | J | K | M,
        'Y' => H | J | L,
        'Z' => A1 | A2 | J | K | D1 | D2,
        '-' => G1 | G2,
        '+' => G1 | G2 | I | L,
        '/' => J | K,
        '=' => G1 | G2 | D1 | D2,
        '_' => D1 | D2,
        '*' => H | J | K | M | G1 | G2,
        _ => return None,
    })
}

/// Extra polyline data for glyphs that don't fit the segment model (dots).
fn dots(c: char) -> Option<&'static [(f64, f64, f64, f64)]> {
    match c {
        '.' => Some(&[(1.8, 5.6, 2.0, 6.0)]),
        ',' => Some(&[(2.0, 5.4, 1.6, 6.4)]),
        ':' => Some(&[(1.9, 1.6, 2.0, 2.0), (1.9, 4.2, 2.0, 4.6)]),
        '!' => Some(&[(2.0, 0.0, 2.0, 4.0), (1.9, 5.5, 2.0, 6.0)]),
        '\'' => Some(&[(2.0, 0.0, 2.0, 1.2)]),
        _ => None,
    }
}

const GRID_H: f64 = 6.0;
const GRID_W: f64 = 4.0;
const ADVANCE: f64 = GRID_W + 1.6;

/// Approximate rendered width of `text` at font size `size` (Phase 3.4:
/// lets auto layout / hug sizing account for text).
pub fn measure(text: &str, size: f64) -> f64 {
    let scale = size / (GRID_H + 1.0);
    text.chars().count() as f64 * ADVANCE * scale
}

/// Encode `text` into `scene` as stroked vector paths. `size` is the em
/// height (the node's `h` is used by the caller). Returns paths encoded.
pub fn encode_text(scene: &mut Scene, text: &str, world: Affine, size: f64, color: Color) -> usize {
    let scale = size / (GRID_H + 1.0);
    let stroke = Stroke::new((0.55 * scale).max(0.75))
        .with_caps(Cap::Round)
        .with_join(Join::Round);
    let mut pen_x = 0.0;
    let mut paths = 0usize;
    for ch in text.chars() {
        if ch == ' ' { pen_x += ADVANCE * scale; continue; }
        let mut path = BezPath::new();
        if let Some(mask) = glyph(ch) {
            for (bit, (x0, y0, x1, y1)) in SEG_LINES.iter() {
                if mask & bit != 0 {
                    path.move_to((x0 * scale, y0 * scale));
                    path.line_to((x1 * scale, y1 * scale));
                }
            }
        }
        if let Some(extra) = dots(ch) {
            for (x0, y0, x1, y1) in extra {
                path.move_to((x0 * scale, y0 * scale));
                path.line_to((x1 * scale, y1 * scale));
            }
        }
        if path.elements().is_empty() {
            // Unknown glyph -> hollow box (classic "tofu"), so missing
            // characters are visible rather than silently dropped.
            for (bit, (x0, y0, x1, y1)) in SEG_LINES.iter() {
                if (A1 | A2 | B | C | D1 | D2 | E | F) & bit != 0 {
                    path.move_to((x0 * scale, y0 * scale));
                    path.line_to((x1 * scale, y1 * scale));
                }
            }
        }
        scene.stroke(&stroke, world * Affine::translate((pen_x, 0.4 * scale)), color, None, &path);
        paths += 1;
        pen_x += ADVANCE * scale;
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_alnum_char_has_a_glyph() {
        for c in ('A'..='Z').chain('0'..='9') {
            assert!(glyph(c).is_some(), "missing glyph for {c}");
        }
    }

    #[test]
    fn lowercase_maps_to_uppercase() {
        assert_eq!(glyph('a'), glyph('A'));
    }

    #[test]
    fn measure_scales_linearly() {
        assert!(measure("AB", 20.0) > measure("A", 20.0));
        assert!((measure("AB", 40.0) - 2.0 * measure("AB", 20.0)).abs() < 1e-9);
    }

    #[test]
    fn encode_produces_one_path_per_visible_char() {
        let mut scene = Scene::new();
        let n = encode_text(&mut scene, "AB CD", Affine::IDENTITY, 24.0, Color::BLACK);
        assert_eq!(n, 4); // space is free
    }
}
