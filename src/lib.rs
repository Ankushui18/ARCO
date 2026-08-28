//! X Native Engine Test Build v0.4
//!
//! The old ARCO/JS editor is a behavioral reference only. This crate is the
//! native product-side model + editing + render-preparation engine.
//!
//! v0.3 slice: scene graph, transforms, frames/groups/shapes, auto layout v1,
//! variables (color/number), components + fill overrides, prototype metadata,
//! dirty tracking, viewport culling, stress scenes, Vello encoding.
//!
//! v0.4 adds working slices of every roadmap phase that can run headless:
//! - Phase 0: owned strings everywhere (no &'static str in the model)
//! - Phase 2: hit testing, selection, move/resize/rotate, undo/redo,
//!   z-order, group/ungroup, align/distribute, snapping, constraints (editor.rs)
//! - Phase 3: real text rendering via a built-in vector stroke font (text.rs)
//! - Phase 4: linear/radial gradients, drop shadows, blend modes,
//!   per-corner radii
//! - Phase 5: auto layout v2 (cross-axis align, space-between, recursive,
//!   cross-axis hug), variables v2 (string/bool, modes, aliases),
//!   typed component overrides (fill + text)
//! - Phase 6/7: Document with multiple pages, .x JSON save/load, SVG export
//!   (fileio.rs)
//! - Phase 8: prototype playback state machine (editor.rs Player)
//! - Phase 9: uniform-grid spatial index (editor.rs SpatialGrid)
//! - Phase 10: version-history checkpoints, dev-mode CSS export

pub mod editor;
pub mod fileio;
pub mod text;

pub use std::f64::consts::PI;
use std::collections::HashMap;
use vello::kurbo::{Affine, Circle, Rect, RoundedRect, RoundedRectRadii, Shape};
pub use vello::peniko::Color;
use vello::peniko::{Blob, Brush, Fill, Format, Gradient, Image, Mix};
use vello::Scene;

// ------------------------------------------------------------- image assets

/// Phase 4.2: decoded image assets, keyed by the asset name that
/// `NodeKind::Image` references. Load PNGs once, render everywhere.
#[derive(Default)]
pub struct Assets { images: HashMap<String, Image> }
impl Assets {
    pub fn new() -> Self { Self::default() }
    /// Decode a PNG (any bit depth/color type png-crate supports -> RGBA8).
    pub fn load_png(&mut self, name: &str, path: &str) -> Result<(), String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let decoder = png::Decoder::new(std::io::BufReader::new(file));
        let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; reader.output_buffer_size().ok_or("bad png size")?];
        let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
        let (w, h) = (info.width, info.height);
        let rgba: Vec<u8> = match info.color_type {
            png::ColorType::Rgba => buf[..info.buffer_size()].to_vec(),
            png::ColorType::Rgb => buf[..info.buffer_size()].chunks(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
            png::ColorType::Grayscale => buf[..info.buffer_size()].iter().flat_map(|&g| [g, g, g, 255]).collect(),
            png::ColorType::GrayscaleAlpha => buf[..info.buffer_size()].chunks(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
            other => return Err(format!("unsupported color type {other:?}")),
        };
        self.images.insert(name.into(), Image::new(Blob::from(rgba), Format::Rgba8, w, h));
        Ok(())
    }
    pub fn get(&self, name: &str) -> Option<&Image> { self.images.get(name) }
    pub fn len(&self) -> usize { self.images.len() }
    pub fn is_empty(&self) -> bool { self.images.is_empty() }
}

// ---------------------------------------------------------------- transform

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform { pub x: f64, pub y: f64, pub rotation: f64, pub scale_x: f64, pub scale_y: f64 }
impl Default for Transform { fn default() -> Self { Self { x: 0.0, y: 0.0, rotation: 0.0, scale_x: 1.0, scale_y: 1.0 } } }
impl Transform {
    pub fn matrix(self, w: f64, h: f64) -> Affine {
        let (cx, cy) = (w / 2.0, h / 2.0);
        Affine::translate((self.x + cx, self.y + cy))
            * Affine::rotate(self.rotation)
            * Affine::scale_non_uniform(self.scale_x, self.scale_y)
            * Affine::translate((-cx, -cy))
    }
}

// -------------------------------------------------------------------- paint

/// Phase 4: gradients join solid and variable-bound paints.
#[derive(Debug, Clone, PartialEq)]
pub enum Paint {
    Solid(Color),
    Variable(String),
    LinearGradient { start: (f64, f64), end: (f64, f64), stops: Vec<(f32, Color)> },
    RadialGradient { center: (f64, f64), radius: f64, stops: Vec<(f32, Color)> },
}

#[derive(Debug, Clone, Copy, PartialEq)] pub struct Stroke { pub color: Color, pub width: f64 }
impl Default for Stroke { fn default() -> Self { Self { color: Color::BLACK, width: 0.0 } } }

/// Phase 4: blend modes. Applied as a Vello mix layer around the node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BlendKind { #[default] Normal, Multiply, Screen, Overlay, Darken, Lighten }
impl BlendKind {
    fn mix(self) -> Option<Mix> {
        match self {
            BlendKind::Normal => None,
            BlendKind::Multiply => Some(Mix::Multiply),
            BlendKind::Screen => Some(Mix::Screen),
            BlendKind::Overlay => Some(Mix::Overlay),
            BlendKind::Darken => Some(Mix::Darken),
            BlendKind::Lighten => Some(Mix::Lighten),
        }
    }
}

/// Phase 4: layer effects. DropShadow renders now (hard shadow — Vello 0.1
/// has no blur primitive; the blur radius widens the shadow instead).
/// The other three are modeled + serialized, awaiting a GPU blur subsystem.
#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    DropShadow { dx: f64, dy: f64, blur: f64, color: Color },
    InnerShadow { dx: f64, dy: f64, blur: f64, color: Color },
    LayerBlur { radius: f64 },
    BackgroundBlur { radius: f64 },
}

// -------------------------------------------------------------- constraints

/// Phase 2.12: resize constraints (how a child reacts when its frame resizes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HPin { #[default] Left, Right, CenterH, StretchH, ScaleH }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VPin { #[default] Top, Bottom, CenterV, StretchV, ScaleV }

// ------------------------------------------------------------------- layout

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LayoutDirection { Horizontal, #[default] Vertical }
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Sizing { #[default] Fixed, Hug }
/// Phase 5.1: cross-axis alignment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CrossAlign { #[default] Start, Center, End }

#[derive(Debug, Clone, PartialEq, Default)]
pub struct AutoLayout {
    pub direction: LayoutDirection,
    pub gap: f64,
    pub padding: f64,
    pub sizing: Sizing,
    pub gap_var: Option<String>,
    pub padding_var: Option<String>,
    /// Phase 5.1: cross-axis alignment of children.
    pub align: CrossAlign,
    /// Phase 5.1: distribute free main-axis space between children
    /// (overrides `gap` when the frame is Fixed-sized and children fit).
    pub space_between: bool,
}

// -------------------------------------------------------------------- nodes

/// Phase 2.6: editable vector path data. A vector node owns a list of
/// subpath commands in local coordinates — the pen tool's data model.
/// Rendered as a real filled (and optionally stroked) Vello path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathCmd {
    MoveTo(f64, f64),
    LineTo(f64, f64),
    /// Cubic bezier: control1, control2, endpoint.
    CurveTo(f64, f64, f64, f64, f64, f64),
    Close,
}

pub fn path_to_bez(cmds: &[PathCmd]) -> vello::kurbo::BezPath {
    let mut p = vello::kurbo::BezPath::new();
    for c in cmds {
        match *c {
            PathCmd::MoveTo(x, y) => p.move_to((x, y)),
            PathCmd::LineTo(x, y) => p.line_to((x, y)),
            PathCmd::CurveTo(x1, y1, x2, y2, x, y) => p.curve_to((x1, y1), (x2, y2), (x, y)),
            PathCmd::Close => p.close_path(),
        }
    }
    p
}

#[derive(Debug, Clone, PartialEq)]
pub enum NodeKind {
    Frame { layout: Option<AutoLayout> },
    Group,
    Rect { radius: f64 },
    Ellipse,
    Line,
    Text { text: String },
    Image { asset: String },
    Vector { path: Vec<PathCmd> },
    Component { name: String },
    Instance { component: String },
}

#[derive(Debug, Clone, PartialEq)] pub struct PrototypeAction { pub destination: String, pub transition_ms: u32 }

#[derive(Debug, Clone)]
pub struct Node {
    pub id: String,
    pub kind: NodeKind,
    pub w: f64,
    pub h: f64,
    pub transform: Transform,
    pub fill: Paint,
    pub stroke: Stroke,
    pub opacity: f32,
    pub children: Vec<Node>,
    pub dirty: bool,
    pub visible: bool,
    /// Phase 2: editor lock (excluded from hit testing).
    pub locked: bool,
    pub prototype: Option<PrototypeAction>,
    pub overrides: HashMap<String, String>,
    /// Phase 4.7: per-corner radii [tl, tr, br, bl]; overrides Rect's uniform radius.
    pub corner_radii: Option<[f64; 4]>,
    /// Phase 4: blend mode.
    pub blend: BlendKind,
    /// Phase 4: layer effects (shadows/blurs).
    pub effects: Vec<Effect>,
    /// Phase 2.12: resize constraints relative to the parent frame.
    pub pin: (HPin, VPin),
}

impl Node {
    fn base(id: &str, kind: NodeKind, x: f64, y: f64, w: f64, h: f64, fill: Paint) -> Self {
        Self {
            id: id.into(), kind, w, h,
            transform: Transform { x, y, ..Default::default() },
            fill, stroke: Stroke::default(), opacity: 1.0,
            children: vec![], dirty: true, visible: true, locked: false,
            prototype: None, overrides: HashMap::new(),
            corner_radii: None, blend: BlendKind::Normal, effects: vec![],
            pin: (HPin::Left, VPin::Top),
        }
    }
    pub fn frame(id: &str, w: f64, h: f64) -> Self { Self::base(id, NodeKind::Frame { layout: None }, 0.0, 0.0, w, h, Paint::Solid(Color::TRANSPARENT)) }
    pub fn group(id: &str, w: f64, h: f64) -> Self { Self::base(id, NodeKind::Group, 0.0, 0.0, w, h, Paint::Solid(Color::TRANSPARENT)) }
    pub fn rect(id: &str, x: f64, y: f64, w: f64, h: f64, fill: Color) -> Self { Self::base(id, NodeKind::Rect { radius: 0.0 }, x, y, w, h, Paint::Solid(fill)) }
    pub fn ellipse(id: &str, x: f64, y: f64, w: f64, h: f64, fill: Color) -> Self { Self::base(id, NodeKind::Ellipse, x, y, w, h, Paint::Solid(fill)) }
    pub fn line(id: &str, x: f64, y: f64, w: f64, h: f64, color: Color) -> Self { Self::base(id, NodeKind::Line, x, y, w, h, Paint::Solid(Color::TRANSPARENT)).stroke(Stroke { color, width: 2.0 }) }
    pub fn text(id: &str, x: f64, y: f64, w: f64, h: f64, text: &str) -> Self { Self::base(id, NodeKind::Text { text: text.into() }, x, y, w, h, Paint::Solid(Color::BLACK)) }
    pub fn image(id: &str, x: f64, y: f64, w: f64, h: f64, asset: &str) -> Self { Self::base(id, NodeKind::Image { asset: asset.into() }, x, y, w, h, Paint::Solid(Color::rgb8(0xdd, 0xdd, 0xdd))) }
    pub fn vector(id: &str, x: f64, y: f64, w: f64, h: f64, path: Vec<PathCmd>) -> Self { Self::base(id, NodeKind::Vector { path }, x, y, w, h, Paint::Solid(Color::BLACK)) }
    pub fn component(id: &str, name: &str, w: f64, h: f64) -> Self { Self::base(id, NodeKind::Component { name: name.into() }, 0.0, 0.0, w, h, Paint::Solid(Color::TRANSPARENT)) }
    pub fn instance(id: &str, component: &str, x: f64, y: f64, w: f64, h: f64) -> Self { Self::base(id, NodeKind::Instance { component: component.into() }, x, y, w, h, Paint::Solid(Color::TRANSPARENT)) }

    pub fn radius(mut self, r: f64) -> Self { if let NodeKind::Rect { .. } = self.kind { self.kind = NodeKind::Rect { radius: r } } self }
    pub fn corners(mut self, tl: f64, tr: f64, br: f64, bl: f64) -> Self { self.corner_radii = Some([tl, tr, br, bl]); self }
    pub fn rotate(mut self, r: f64) -> Self { self.transform.rotation = r; self }
    pub fn scale(mut self, x: f64, y: f64) -> Self { self.transform.scale_x = x; self.transform.scale_y = y; self }
    pub fn opacity(mut self, v: f32) -> Self { self.opacity = v.clamp(0.0, 1.0); self }
    pub fn stroke(mut self, s: Stroke) -> Self { self.stroke = s; self }
    pub fn fill_paint(mut self, p: Paint) -> Self { self.fill = p; self }
    pub fn blend(mut self, b: BlendKind) -> Self { self.blend = b; self }
    pub fn effect(mut self, e: Effect) -> Self { self.effects.push(e); self }
    pub fn pin(mut self, h: HPin, v: VPin) -> Self { self.pin = (h, v); self }
    pub fn locked(mut self, v: bool) -> Self { self.locked = v; self }
    pub fn child(mut self, n: Node) -> Self { self.children.push(n); self.dirty = true; self }
    pub fn prototype(mut self, destination: &str, transition_ms: u32) -> Self { self.prototype = Some(PrototypeAction { destination: destination.into(), transition_ms }); self }
    pub fn override_prop(mut self, key: &str, value: &str) -> Self { self.overrides.insert(key.into(), value.into()); self }
    pub fn auto_layout(mut self, layout: AutoLayout) -> Self { if let NodeKind::Frame { .. } = self.kind { self.kind = NodeKind::Frame { layout: Some(layout) } } self }
}

// ---------------------------------------------------------------- documents

/// Phase 6.5 / 7: a document is a set of pages plus its variable collection.
#[derive(Debug, Clone, Default)]
pub struct Document {
    pub pages: Vec<Node>,
    pub variables: Variables,
}
impl Document {
    pub fn new() -> Self { Self::default() }
    pub fn page(&self, id: &str) -> Option<&Node> { self.pages.iter().find(|p| p.id == id) }
    pub fn page_mut(&mut self, id: &str) -> Option<&mut Node> { self.pages.iter_mut().find(|p| p.id == id) }
}

// -------------------------------------------------------------------- stats

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)] pub struct SceneStats { pub nodes: usize, pub paths: usize, pub culled: usize, pub dirty_nodes: usize }
#[derive(Debug, Clone, Copy, PartialEq)] pub struct Viewport { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

fn intersects(a: Rect, b: Rect) -> bool { a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 }
pub(crate) fn bounds(world: Affine, w: f64, h: f64) -> Rect {
    let p = [
        world * vello::kurbo::Point::new(0.0, 0.0),
        world * vello::kurbo::Point::new(w, 0.0),
        world * vello::kurbo::Point::new(w, h),
        world * vello::kurbo::Point::new(0.0, h),
    ];
    let xs = p.iter().map(|p| p.x);
    let ys = p.iter().map(|p| p.y);
    Rect::new(
        xs.clone().fold(f64::INFINITY, f64::min),
        ys.clone().fold(f64::INFINITY, f64::min),
        xs.fold(f64::NEG_INFINITY, f64::max),
        ys.fold(f64::NEG_INFINITY, f64::max),
    )
}

// -------------------------------------------------------------- auto layout

/// Auto Layout v2: gap/padding variables, cross-axis alignment,
/// space-between, main-axis hug AND cross-axis hug.
pub fn apply_auto_layout(node: &mut Node, vars: &Variables) {
    let layout = match &node.kind { NodeKind::Frame { layout: Some(l) } => l.clone(), _ => return };
    let gap0 = layout.gap_var.as_deref().map(|n| vars.number(n, layout.gap)).unwrap_or(layout.gap);
    let padding = layout.padding_var.as_deref().map(|n| vars.number(n, layout.padding)).unwrap_or(layout.padding);

    let horizontal = layout.direction == LayoutDirection::Horizontal;
    let n = node.children.len();
    let content_main: f64 = node.children.iter().map(|c| if horizontal { c.w } else { c.h }).sum();
    let container_main = if horizontal { node.w } else { node.h };

    // space-between: distribute leftover space as gap (Fixed frames, 2+ children).
    let gap = if layout.space_between && layout.sizing == Sizing::Fixed && n > 1 {
        ((container_main - 2.0 * padding - content_main) / (n as f64 - 1.0)).max(0.0)
    } else { gap0 };

    let cross_extent = node.children.iter().map(|c| if horizontal { c.h } else { c.w }).fold(0.0f64, f64::max);
    let container_cross = if layout.sizing == Sizing::Hug { cross_extent + 2.0 * padding } else if horizontal { node.h } else { node.w };

    let mut cursor = padding;
    for child in &mut node.children {
        let child_cross = if horizontal { child.h } else { child.w };
        let cross_pos = match layout.align {
            CrossAlign::Start => padding,
            CrossAlign::Center => (container_cross - child_cross) / 2.0,
            CrossAlign::End => container_cross - padding - child_cross,
        };
        if horizontal {
            child.transform.x = cursor; child.transform.y = cross_pos;
            cursor += child.w + gap;
        } else {
            child.transform.y = cursor; child.transform.x = cross_pos;
            cursor += child.h + gap;
        }
        child.dirty = true;
    }
    if layout.sizing == Sizing::Hug {
        let main = if n > 0 { cursor - gap + padding } else { 2.0 * padding };
        if horizontal { node.w = main; node.h = container_cross; } else { node.h = main; node.w = container_cross; }
    }
    node.dirty = false;
}

/// Phase 5.1: recursive layout solve — children first (post-order), so a Hug
/// child reports its final size before the parent positions it.
pub fn apply_layout_recursive(node: &mut Node, vars: &Variables) {
    for child in &mut node.children { apply_layout_recursive(child, vars); }
    apply_auto_layout(node, vars);
}

// ---------------------------------------------------------------- variables

/// Variables v2 (Phase 5.4): color/number/string/bool storage, aliases
/// (var -> var, cycle-limited), and color modes (e.g. "light"/"dark").
/// Lookup order for colors: alias chain -> active mode table -> base table.
#[derive(Debug, Default, Clone)]
pub struct Variables {
    pub colors: HashMap<String, Color>,
    pub numbers: HashMap<String, f64>,
    pub strings: HashMap<String, String>,
    pub bools: HashMap<String, bool>,
    pub aliases: HashMap<String, String>,
    pub modes: HashMap<String, HashMap<String, Color>>,
    pub active_mode: Option<String>,
}
const MAX_ALIAS_DEPTH: u32 = 8;
impl Variables {
    fn resolve_name<'a>(&'a self, name: &'a str) -> &'a str {
        let mut cur = name;
        for _ in 0..MAX_ALIAS_DEPTH {
            match self.aliases.get(cur) { Some(next) => cur = next, None => break }
        }
        cur
    }
    pub fn color(&self, name: &str, fallback: Color) -> Color {
        let name = self.resolve_name(name);
        if let Some(mode) = &self.active_mode {
            if let Some(table) = self.modes.get(mode) {
                if let Some(c) = table.get(name) { return *c; }
            }
        }
        self.colors.get(name).copied().unwrap_or(fallback)
    }
    pub fn number(&self, name: &str, fallback: f64) -> f64 { self.numbers.get(self.resolve_name(name)).copied().unwrap_or(fallback) }
    pub fn string(&self, name: &str, fallback: &str) -> String { self.strings.get(self.resolve_name(name)).cloned().unwrap_or_else(|| fallback.to_string()) }
    pub fn boolean(&self, name: &str, fallback: bool) -> bool { self.bools.get(self.resolve_name(name)).copied().unwrap_or(fallback) }
}

fn paint_color(p: &Paint, vars: &Variables) -> Color {
    match p {
        Paint::Solid(c) => *c,
        Paint::Variable(n) => vars.color(n, Color::BLACK),
        Paint::LinearGradient { stops, .. } | Paint::RadialGradient { stops, .. } =>
            stops.first().map(|s| s.1).unwrap_or(Color::BLACK),
    }
}

fn paint_brush(p: &Paint, vars: &Variables) -> Brush {
    match p {
        Paint::Solid(c) => Brush::Solid(*c),
        Paint::Variable(n) => Brush::Solid(vars.color(n, Color::BLACK)),
        Paint::LinearGradient { start, end, stops } => Brush::Gradient(
            Gradient::new_linear((start.0, start.1), (end.0, end.1))
                .with_stops(stops.as_slice()),
        ),
        Paint::RadialGradient { center, radius, stops } => Brush::Gradient(
            Gradient::new_radial((center.0, center.1), *radius as f32)
                .with_stops(stops.as_slice()),
        ),
    }
}

/// Parses "#rrggbb" or "#rrggbbaa" into a Color.
pub fn parse_hex_color(s: &str) -> Option<Color> {
    let s = s.strip_prefix('#').unwrap_or(s);
    let (r, g, b, a) = match s.len() {
        6 => (u8::from_str_radix(&s[0..2], 16).ok()?, u8::from_str_radix(&s[2..4], 16).ok()?, u8::from_str_radix(&s[4..6], 16).ok()?, 255u8),
        8 => (u8::from_str_radix(&s[0..2], 16).ok()?, u8::from_str_radix(&s[2..4], 16).ok()?, u8::from_str_radix(&s[4..6], 16).ok()?, u8::from_str_radix(&s[6..8], 16).ok()?),
        _ => return None,
    };
    Some(Color::rgba8(r, g, b, a))
}
pub fn color_to_hex(c: Color) -> String {
    if c.a == 255 { format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b) } else { format!("#{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a) }
}

/// Typed instance overrides (Phase 5.3): an override value keyed by a node id
/// is either a hex color ("#12ab34") applied to that node's fill, or — new —
/// prefixed "text:" to replace a Text node's content.
fn effective_fill(node: &Node, overrides: &HashMap<String, String>, vars: &Variables) -> Color {
    if let Some(v) = overrides.get(&node.id) {
        if let Some(c) = parse_hex_color(v) { return c; }
    }
    paint_color(&node.fill, vars)
}
fn effective_brush(node: &Node, overrides: &HashMap<String, String>, vars: &Variables) -> Brush {
    if let Some(v) = overrides.get(&node.id) {
        if let Some(c) = parse_hex_color(v) { return Brush::Solid(c); }
    }
    paint_brush(&node.fill, vars)
}
fn effective_text<'a>(node: &'a Node, overrides: &'a HashMap<String, String>) -> Option<&'a str> {
    overrides.get(&node.id).and_then(|v| v.strip_prefix("text:"))
}

// --------------------------------------------------------------- components

pub type ComponentRegistry<'a> = HashMap<&'a str, &'a Node>;
fn collect_components<'a>(node: &'a Node, reg: &mut ComponentRegistry<'a>) {
    if let NodeKind::Component { name } = &node.kind { reg.insert(name.as_str(), node); }
    for child in &node.children { collect_components(child, reg); }
}
/// Guards against a component that (directly or transitively) instances itself.
const MAX_INSTANCE_DEPTH: u32 = 32;

// ----------------------------------------------------------------- encoding

pub fn build_scene(root: &Node, viewport: Option<Viewport>, vars: &Variables) -> (Scene, SceneStats) {
    build_scene_with_assets(root, viewport, vars, None)
}

/// Phase 4.2: like `build_scene`, but Image nodes whose `asset` is present
/// in `assets` render the actual decoded bitmap instead of a placeholder.
pub fn build_scene_with_assets(root: &Node, viewport: Option<Viewport>, vars: &Variables, assets: Option<&Assets>) -> (Scene, SceneStats) {
    let mut scene = Scene::new();
    let mut stats = SceneStats::default();
    let mut registry = ComponentRegistry::new();
    collect_components(root, &mut registry);
    let empty = HashMap::new();
    encode(&mut scene, root, Affine::IDENTITY, viewport, vars, &mut stats, &registry, &empty, 0, assets);
    (scene, stats)
}

fn shape_for_rect(node: &Node, radius: f64) -> vello::kurbo::BezPath {
    if let Some([tl, tr, br, bl]) = node.corner_radii {
        RoundedRect::from_rect(Rect::new(0.0, 0.0, node.w, node.h), RoundedRectRadii::new(tl, tr, br, bl)).into_path(0.1)
    } else if radius > 0.0 {
        RoundedRect::new(0.0, 0.0, node.w, node.h, radius).into_path(0.1)
    } else {
        Rect::new(0.0, 0.0, node.w, node.h).into_path(0.1)
    }
}

fn encode_drop_shadows(scene: &mut Scene, node: &Node, world: Affine, shape: &impl Shape, stats: &mut SceneStats) {
    for effect in &node.effects {
        if let Effect::DropShadow { dx, dy, blur, color } = effect {
            // No blur primitive in Vello 0.1: widen by the blur radius and
            // reduce alpha, which reads as a soft-ish shadow at small radii.
            let grow = blur * 0.5;
            let b = shape.bounding_box();
            let sx = if b.width() > 0.0 { (b.width() + grow * 2.0) / b.width() } else { 1.0 };
            let sy = if b.height() > 0.0 { (b.height() + grow * 2.0) / b.height() } else { 1.0 };
            let t = world * Affine::translate((dx - grow, dy - grow)) * Affine::scale_non_uniform(sx, sy);
            scene.fill(Fill::NonZero, t, color.with_alpha_factor(0.55 * node.opacity), None, shape);
            stats.paths += 1;
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn encode(scene: &mut Scene, node: &Node, parent: Affine, viewport: Option<Viewport>, vars: &Variables, stats: &mut SceneStats, registry: &ComponentRegistry, overrides: &HashMap<String, String>, depth: u32, assets: Option<&Assets>) {
    stats.nodes += 1;
    if node.dirty { stats.dirty_nodes += 1; }
    if !node.visible { return; }
    let world = parent * node.transform.matrix(node.w, node.h);
    let b = bounds(world, node.w, node.h);
    if let Some(v) = viewport {
        if !intersects(b, Rect::new(v.x, v.y, v.x + v.w, v.y + v.h)) { stats.culled += 1; return; }
    }

    // Phase 4: blend layer around this node + its subtree.
    let blend = node.blend.mix();
    if let Some(mix) = blend {
        scene.push_layer(mix, 1.0, Affine::IDENTITY, &b);
    }

    match &node.kind {
        NodeKind::Rect { radius } => {
            let shape = shape_for_rect(node, *radius);
            encode_drop_shadows(scene, node, world, &shape, stats);
            scene.fill(Fill::NonZero, world, &brush_with_alpha(effective_brush(node, overrides, vars), node.opacity), None, &shape);
            if node.stroke.width > 0.0 {
                scene.stroke(&vello::kurbo::Stroke::new(node.stroke.width), world, node.stroke.color.with_alpha_factor(node.opacity), None, &shape);
                stats.paths += 1;
            }
            stats.paths += 1;
        }
        NodeKind::Ellipse => {
            let r = node.w.min(node.h) / 2.0;
            let shape = Circle::new((r, r), r);
            let t = world * Affine::scale_non_uniform(node.w / node.h, 1.0);
            encode_drop_shadows(scene, node, t, &shape.into_path(0.1), stats);
            scene.fill(Fill::NonZero, t, &brush_with_alpha(effective_brush(node, overrides, vars), node.opacity), None, &shape);
            stats.paths += 1;
        }
        NodeKind::Line => {
            let shape = Rect::new(0.0, 0.0, node.w.max(node.stroke.width), node.stroke.width.max(1.0)).into_path(0.1);
            scene.fill(Fill::NonZero, world, node.stroke.color.with_alpha_factor(node.opacity), None, &shape);
            stats.paths += 1;
        }
        NodeKind::Image { asset } => {
            if let Some(img) = assets.and_then(|a| a.get(asset)) {
                // draw the decoded bitmap scaled into the node's box
                let sx = node.w / img.width as f64;
                let sy = node.h / img.height as f64;
                scene.draw_image(img, world * Affine::scale_non_uniform(sx, sy));
                stats.paths += 1;
            } else {
                let shape = Rect::new(0.0, 0.0, node.w, node.h).into_path(0.1);
                scene.fill(Fill::NonZero, world, &effective_brush(node, overrides, vars), None, &shape);
                stats.paths += 1;
            }
        }
        NodeKind::Text { text } => {
            // Phase 3: real vector text via the built-in stroke font.
            let content = effective_text(node, overrides).unwrap_or(text);
            let color = effective_fill(node, overrides, vars).with_alpha_factor(node.opacity);
            stats.paths += text::encode_text(scene, content, world, node.h, color);
        }
        NodeKind::Vector { path } => {
            // Phase 2.6: real editable vector paths render as filled shapes.
            if !path.is_empty() {
                let bez = path_to_bez(path);
                encode_drop_shadows(scene, node, world, &bez, stats);
                scene.fill(Fill::NonZero, world, &brush_with_alpha(effective_brush(node, overrides, vars), node.opacity), None, &bez);
                if node.stroke.width > 0.0 {
                    scene.stroke(&vello::kurbo::Stroke::new(node.stroke.width), world, node.stroke.color.with_alpha_factor(node.opacity), None, &bez);
                    stats.paths += 1;
                }
                stats.paths += 1;
            }
        }
        NodeKind::Instance { component } => {
            if depth < MAX_INSTANCE_DEPTH {
                if let Some(def) = registry.get(component.as_str()) {
                    for child in &def.children {
                        encode(scene, child, world, viewport, vars, stats, registry, &node.overrides, depth + 1, assets);
                    }
                }
            }
        }
        NodeKind::Frame { .. } => {
            // Frames draw their background fill when it isn't transparent
            // (matches Figma: frames have fills; groups do not).
            let color = effective_fill(node, overrides, vars);
            if color.a > 0 {
                let shape = Rect::new(0.0, 0.0, node.w, node.h).into_path(0.1);
                encode_drop_shadows(scene, node, world, &shape, stats);
                scene.fill(Fill::NonZero, world, &brush_with_alpha(effective_brush(node, overrides, vars), node.opacity), None, &shape);
                stats.paths += 1;
            }
        }
        NodeKind::Group | NodeKind::Component { .. } => {}
    }
    for child in &node.children { encode(scene, child, world, viewport, vars, stats, registry, overrides, depth, assets); }

    if blend.is_some() { scene.pop_layer(); }
}

fn brush_with_alpha(brush: Brush, alpha: f32) -> Brush {
    if alpha >= 1.0 { return brush; }
    match brush {
        Brush::Solid(c) => Brush::Solid(c.with_alpha_factor(alpha)),
        Brush::Gradient(mut g) => {
            for stop in g.stops.iter_mut() { stop.color = stop.color.with_alpha_factor(alpha); }
            Brush::Gradient(g)
        }
        other => other,
    }
}

// ------------------------------------------------------------------- stress

pub fn benchmark_scene(count: usize) -> Node {
    let mut root = Node::frame("benchmark", 4096.0, 4096.0);
    for i in 0..count {
        let x = ((i * 37) % 4000) as f64;
        let y = ((i * 71) % 4000) as f64;
        let w = 24.0 + (i % 80) as f64;
        let h = 24.0 + (i % 60) as f64;
        let n = if i % 4 == 0 {
            Node::ellipse(&format!("e-{i}"), x, y, w, h, Color::rgb8(0x22, 0x88, 0xee))
        } else if i % 7 == 0 {
            Node::line(&format!("l-{i}"), x, y, w, h, Color::BLACK)
        } else {
            Node::rect(&format!("r-{i}"), x, y, w, h, Color::rgb8(0xee, 0x66, 0x33)).radius((i % 12) as f64).rotate((i as f64 % 16.0) * PI / 32.0)
        };
        root.children.push(n)
    }
    root
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_model_has_expected_nodes() {
        let d = Node::frame("r", 500.0, 500.0)
            .child(Node::text("t", 0.0, 0.0, 100.0, 20.0, "hello"))
            .child(Node::image("i", 0.0, 30.0, 50.0, 50.0, "asset-1"))
            .child(Node::component("c", "Button", 100.0, 40.0))
            .child(Node::instance("x", "Button", 0.0, 90.0, 100.0, 40.0));
        assert_eq!(d.children.len(), 4)
    }

    #[test]
    fn auto_layout_positions_children() {
        let mut d = Node::frame("r", 100.0, 100.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, gap: 10.0, padding: 5.0, sizing: Sizing::Fixed, ..Default::default() })
            .child(Node::rect("a", 0.0, 0.0, 20.0, 20.0, Color::WHITE))
            .child(Node::rect("b", 0.0, 0.0, 30.0, 20.0, Color::WHITE));
        apply_auto_layout(&mut d, &Variables::default());
        assert_eq!(d.children[0].transform.x, 5.0);
        assert_eq!(d.children[1].transform.x, 35.0)
    }

    #[test]
    fn viewport_culls_offscreen_nodes() {
        let d = Node::frame("r", 1000.0, 1000.0)
            .child(Node::rect("on", 10.0, 10.0, 20.0, 20.0, Color::WHITE))
            .child(Node::rect("off", 900.0, 900.0, 20.0, 20.0, Color::WHITE));
        let (_, s) = build_scene(&d, Some(Viewport { x: 0.0, y: 0.0, w: 100.0, h: 100.0 }), &Variables::default());
        assert_eq!(s.paths, 1);
        assert_eq!(s.culled, 1)
    }

    #[test]
    fn rotation_and_radius_render() {
        let d = Node::rect("a", 0.0, 0.0, 40.0, 20.0, Color::WHITE).radius(8.0).rotate(1.0).opacity(0.5);
        let (scene, s) = build_scene(&d, None, &Variables::default());
        assert_eq!(s.paths, 1);
        assert_eq!(scene.encoding().n_paths, 1)
    }

    #[test]
    fn stress_10k() {
        let (_, s) = build_scene(&benchmark_scene(10_000), None, &Variables::default());
        assert_eq!(s.nodes, 10_001);
        assert_eq!(s.paths, 10_000)
    }

    #[test]
    fn number_variable_resolves_into_layout_gap() {
        let mut vars = Variables::default();
        vars.numbers.insert("gap".into(), 40.0);
        let mut d = Node::frame("r", 400.0, 100.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, gap: 10.0, padding: 0.0, gap_var: Some("gap".into()), ..Default::default() })
            .child(Node::rect("a", 0.0, 0.0, 20.0, 20.0, Color::WHITE))
            .child(Node::rect("b", 0.0, 0.0, 20.0, 20.0, Color::WHITE));
        apply_auto_layout(&mut d, &vars);
        assert_eq!(d.children[1].transform.x, 60.0); // 20 + 40, not 20 + 10
    }

    #[test]
    fn number_variable_missing_falls_back_to_literal() {
        let mut d = Node::frame("r", 400.0, 100.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, gap: 10.0, padding: 0.0, gap_var: Some("missing".into()), ..Default::default() })
            .child(Node::rect("a", 0.0, 0.0, 20.0, 20.0, Color::WHITE))
            .child(Node::rect("b", 0.0, 0.0, 20.0, 20.0, Color::WHITE));
        apply_auto_layout(&mut d, &Variables::default());
        assert_eq!(d.children[1].transform.x, 30.0);
    }

    #[test]
    fn instance_resolves_component_children_and_renders_them() {
        let mut master = Node::component("def", "Button", 100.0, 40.0)
            .child(Node::rect("bg", 0.0, 0.0, 100.0, 40.0, Color::BLACK));
        master.visible = false;
        let d = Node::frame("r", 500.0, 500.0)
            .child(master)
            .child(Node::instance("i1", "Button", 10.0, 10.0, 100.0, 40.0));
        let (_, s) = build_scene(&d, None, &Variables::default());
        assert_eq!(s.paths, 1); // the instance's resolved bg, master hidden
    }

    #[test]
    fn instance_override_changes_resolved_child_fill() {
        let bg = Node::rect("bg", 0.0, 0.0, 100.0, 40.0, Color::BLACK);
        let mut ovr = HashMap::new();
        ovr.insert("bg".to_string(), "#ff0000".to_string());
        let c = effective_fill(&bg, &ovr, &Variables::default());
        assert_eq!((c.r, c.g, c.b), (255, 0, 0));
    }

    #[test]
    fn self_referencing_instance_does_not_infinite_loop() {
        let master = Node::component("def", "Evil", 50.0, 50.0)
            .child(Node::instance("self", "Evil", 0.0, 0.0, 50.0, 50.0));
        let d = Node::frame("r", 500.0, 500.0)
            .child(master)
            .child(Node::instance("i", "Evil", 0.0, 0.0, 50.0, 50.0));
        let (_, s) = build_scene(&d, None, &Variables::default());
        assert!(s.nodes > 0); // terminated
    }

    // ---- v0.4 additions ----

    #[test]
    fn text_renders_real_paths() {
        let d = Node::text("t", 0.0, 0.0, 200.0, 24.0, "HELLO 123");
        let (scene, s) = build_scene(&d, None, &Variables::default());
        // "HELLO 123" = 8 visible glyphs (space is free) = 8 stroke paths
        assert_eq!(s.paths, 8);
        assert_eq!(scene.encoding().n_paths, 8);
    }

    #[test]
    fn text_override_replaces_content() {
        let label = Node::text("label", 0.0, 0.0, 100.0, 20.0, "OLD");
        let mut ovr = HashMap::new();
        ovr.insert("label".to_string(), "text:NEW".to_string());
        assert_eq!(effective_text(&label, &ovr), Some("NEW"));
    }

    #[test]
    fn gradient_paint_encodes() {
        let d = Node::rect("g", 0.0, 0.0, 100.0, 100.0, Color::WHITE)
            .fill_paint(Paint::LinearGradient { start: (0.0, 0.0), end: (100.0, 0.0), stops: vec![(0.0, Color::rgb8(255, 0, 0)), (1.0, Color::rgb8(0, 0, 255))] });
        let (scene, s) = build_scene(&d, None, &Variables::default());
        assert_eq!(s.paths, 1);
        assert_eq!(scene.encoding().n_paths, 1);
    }

    #[test]
    fn drop_shadow_adds_a_path() {
        let d = Node::rect("s", 0.0, 0.0, 100.0, 50.0, Color::WHITE)
            .effect(Effect::DropShadow { dx: 4.0, dy: 4.0, blur: 8.0, color: Color::BLACK });
        let (_, s) = build_scene(&d, None, &Variables::default());
        assert_eq!(s.paths, 2); // shadow + fill
    }

    #[test]
    fn blend_mode_pushes_layer() {
        let plain = Node::rect("p", 0.0, 0.0, 50.0, 50.0, Color::WHITE);
        let blended = Node::rect("b", 0.0, 0.0, 50.0, 50.0, Color::WHITE).blend(BlendKind::Multiply);
        let (s1, _) = build_scene(&plain, None, &Variables::default());
        let (s2, _) = build_scene(&blended, None, &Variables::default());
        // The mix layer adds a clip path to the encoding.
        assert!(s2.encoding().n_clips > s1.encoding().n_clips);
    }

    #[test]
    fn vector_node_renders_real_path() {
        let star = Node::vector("v", 0.0, 0.0, 100.0, 100.0, vec![
            PathCmd::MoveTo(50.0, 0.0),
            PathCmd::LineTo(61.0, 35.0),
            PathCmd::LineTo(98.0, 35.0),
            PathCmd::LineTo(68.0, 57.0),
            PathCmd::LineTo(79.0, 91.0),
            PathCmd::LineTo(50.0, 70.0),
            PathCmd::LineTo(21.0, 91.0),
            PathCmd::LineTo(32.0, 57.0),
            PathCmd::LineTo(2.0, 35.0),
            PathCmd::LineTo(39.0, 35.0),
            PathCmd::Close,
        ]);
        let (scene, s) = build_scene(&star, None, &Variables::default());
        assert_eq!(s.paths, 1);
        assert_eq!(scene.encoding().n_paths, 1);
        // empty vector renders nothing (no phantom paths)
        let empty = Node::vector("e", 0.0, 0.0, 10.0, 10.0, vec![]);
        let (_, s2) = build_scene(&empty, None, &Variables::default());
        assert_eq!(s2.paths, 0);
    }

    #[test]
    fn png_asset_decodes_and_renders() {
        // write a tiny 2x2 red PNG, decode via Assets, render via Image node
        let path = std::env::temp_dir().join("xnative_asset_test.png");
        {
            let f = std::fs::File::create(&path).unwrap();
            let mut enc = png::Encoder::new(std::io::BufWriter::new(f), 2, 2);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut w = enc.write_header().unwrap();
            w.write_image_data(&[255,0,0,255, 255,0,0,255, 255,0,0,255, 255,0,0,255]).unwrap();
        }
        let mut assets = Assets::new();
        assets.load_png("logo", path.to_str().unwrap()).expect("decode");
        assert_eq!(assets.len(), 1);
        assert_eq!(assets.get("logo").unwrap().width, 2);

        let d = Node::image("img", 0.0, 0.0, 100.0, 100.0, "logo");
        let (_, s) = build_scene_with_assets(&d, None, &Variables::default(), Some(&assets));
        assert_eq!(s.paths, 1);
        // without assets it still renders the placeholder (no panic)
        let (_, s2) = build_scene(&d, None, &Variables::default());
        assert_eq!(s2.paths, 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn per_corner_radii_render() {
        let d = Node::rect("c", 0.0, 0.0, 80.0, 40.0, Color::WHITE).corners(0.0, 20.0, 0.0, 20.0);
        let (_, s) = build_scene(&d, None, &Variables::default());
        assert_eq!(s.paths, 1);
    }

    #[test]
    fn layout_v2_cross_axis_center_and_space_between() {
        let mut d = Node::frame("r", 400.0, 100.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, padding: 0.0, align: CrossAlign::Center, space_between: true, ..Default::default() })
            .child(Node::rect("a", 0.0, 0.0, 50.0, 40.0, Color::WHITE))
            .child(Node::rect("b", 0.0, 0.0, 50.0, 60.0, Color::WHITE));
        apply_auto_layout(&mut d, &Variables::default());
        assert_eq!(d.children[0].transform.y, 30.0); // (100-40)/2
        assert_eq!(d.children[1].transform.y, 20.0); // (100-60)/2
        assert_eq!(d.children[1].transform.x, 350.0); // pushed to far edge
    }

    #[test]
    fn layout_v2_recursive_hug_propagates() {
        let inner = Node::frame("inner", 0.0, 0.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Vertical, gap: 10.0, padding: 5.0, sizing: Sizing::Hug, ..Default::default() })
            .child(Node::rect("a", 0.0, 0.0, 30.0, 20.0, Color::WHITE))
            .child(Node::rect("b", 0.0, 0.0, 30.0, 20.0, Color::WHITE));
        let mut outer = Node::frame("outer", 0.0, 0.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, gap: 0.0, padding: 0.0, sizing: Sizing::Hug, ..Default::default() })
            .child(inner);
        apply_layout_recursive(&mut outer, &Variables::default());
        // inner hugged: h = 5+20+10+20+5 = 60, w = 30+10 = 40
        assert_eq!(outer.children[0].h, 60.0);
        assert_eq!(outer.children[0].w, 40.0);
        // outer hugged around inner
        assert_eq!(outer.w, 40.0);
        assert_eq!(outer.h, 60.0);
    }

    #[test]
    fn variables_v2_modes_and_aliases() {
        let mut vars = Variables::default();
        vars.colors.insert("bg".into(), Color::rgb8(255, 255, 255));
        let mut dark = HashMap::new();
        dark.insert("bg".to_string(), Color::rgb8(0, 0, 0));
        vars.modes.insert("dark".into(), dark);
        vars.aliases.insert("surface".into(), "bg".into());

        // no mode: alias chases to base value
        assert_eq!(vars.color("surface", Color::TRANSPARENT).r, 255);
        // dark mode wins over base
        vars.active_mode = Some("dark".into());
        assert_eq!(vars.color("surface", Color::TRANSPARENT).r, 0);
        // strings + bools exist
        vars.strings.insert("brand".into(), "X Native".into());
        vars.bools.insert("beta".into(), true);
        assert_eq!(vars.string("brand", ""), "X Native");
        assert!(vars.boolean("beta", false));
    }

    #[test]
    fn alias_cycle_terminates() {
        let mut vars = Variables::default();
        vars.aliases.insert("a".into(), "b".into());
        vars.aliases.insert("b".into(), "a".into());
        // must not hang; falls back
        assert_eq!(vars.color("a", Color::rgb8(1, 2, 3)).r, 1);
    }
}
