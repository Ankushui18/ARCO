//! X Native — beta app shell.
//!
//! A working native design tool over the tested headless engine:
//! - Toolbar (left edge): Select / Frame / Rect / Ellipse / Line / Text
//!   tools — click to switch, or keys V / F / R / O / L / T.
//! - Drag on empty canvas with a shape tool: creates the node (undoable).
//! - Drag with Select on empty canvas: marquee selection.
//! - Resize handles on single selection: drag corners to resize.
//! - Layers panel (left): live document tree, click a row to select.
//! - Inspector (right): id/kind/x/y/w/h of selection + a color palette —
//!   click a swatch to recolor the selected node (undoable).
//! - Arrows nudge 1px (Shift = 10px), Ctrl+]/[ bring-front/send-back,
//!   Ctrl+Z/Shift+Z undo/redo, Ctrl+D duplicate, Del delete,
//!   Ctrl+S / Ctrl+O save/load document.x, Ctrl+E export SVG.
//! - Scroll pans, Ctrl+scroll zooms to cursor.
//!
//! All chrome is drawn with Vello itself — no UI toolkit; the same
//! renderer draws document and interface.

use arco_native::editor::{find, hit_test_rect, Editor};
use arco_native::fileio::{export_svg, load_x_file, save_x_file};
use arco_native::text::{encode_text, measure};
use arco_native::{
    build_scene, AutoLayout, Color, CrossAlign, Document, Effect, LayoutDirection, Node, Paint,
    Variables, PI,
};
use std::sync::Arc;
use vello::kurbo::{Affine, Point, Rect, Shape};
use vello::peniko::Fill;
use vello::{AaConfig, RenderParams, Renderer, RendererOptions, Scene};
use winit::dpi::PhysicalSize;
use winit::event::{ElementState, Event, MouseButton, MouseScrollDelta, WindowEvent};
use winit::event_loop::EventLoop;
use winit::keyboard::{Key, NamedKey};
use winit::window::WindowBuilder;

const DOC_PATH: &str = "document.x";
const SVG_PATH: &str = "export.svg";

// ---- chrome layout constants (Figma: bottom toolbar, left sidebar with
// pages+layers+assets, right properties panel with Design/Prototype tabs) ----
const TOOLBAR_W: f64 = 0.0; // tools live in the floating bottom bar now
const LAYERS_W: f64 = 240.0;
const BOTTOM_BAR_H: f64 = 40.0;
const INSPECTOR_W: f64 = 220.0;
const TOP_H: f64 = 34.0;
const ROW_H: f64 = 22.0;

const C_PANEL: Color = Color::rgb8(0x24, 0x26, 0x2b);
const C_PANEL_EDGE: Color = Color::rgb8(0x15, 0x16, 0x19);
const C_TEXT: Color = Color::rgb8(0xd6, 0xd8, 0xdd);
const C_DIM: Color = Color::rgb8(0x8f, 0x93, 0x9b);
const C_ACCENT: Color = Color::rgb8(0x0d, 0x99, 0xff);
const C_CANVAS: Color = Color::rgb8(0x1b, 0x1d, 0x21);
const C_HOVERBG: Color = Color::rgb8(0x33, 0x36, 0x3d);

/// Figma-style frame presets (name, w, h).
const FRAME_PRESETS: [(&str, f64, f64); 5] = [
    ("PHONE 390X844", 390.0, 844.0),
    ("TABLET 820X1180", 820.0, 1180.0),
    ("DESKTOP 1440X1024", 1440.0, 1024.0),
    ("WATCH 198X242", 198.0, 242.0),
    ("SLIDE 1920X1080", 1920.0, 1080.0),
];

const PALETTE: [Color; 8] = [
    Color::rgb8(0x0d, 0x99, 0xff),
    Color::rgb8(0xf2, 0x48, 0x22),
    Color::rgb8(0x2e, 0xcc, 0x71),
    Color::rgb8(0x9b, 0x59, 0xb6),
    Color::rgb8(0xff, 0xd7, 0x00),
    Color::rgb8(0xff, 0xff, 0xff),
    Color::rgb8(0x55, 0x55, 0x55),
    Color::rgb8(0x11, 0x11, 0x11),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tool { Select, Hand, Scale, Frame, Rectangle, Ellipse, Line, Polygon, Star, Text }
impl Tool {
    fn label(self) -> &'static str {
        match self {
            Tool::Select => "V", Tool::Hand => "H", Tool::Scale => "K", Tool::Frame => "F", Tool::Rectangle => "R",
            Tool::Ellipse => "O", Tool::Line => "L", Tool::Polygon => "P", Tool::Star => "S", Tool::Text => "T",
        }
    }
    const ALL: [Tool; 10] = [Tool::Select, Tool::Hand, Tool::Scale, Tool::Frame, Tool::Rectangle, Tool::Ellipse, Tool::Line, Tool::Polygon, Tool::Star, Tool::Text];
    fn name(self) -> &'static str {
        match self {
            Tool::Select => "MOVE", Tool::Hand => "HAND", Tool::Scale => "SCALE", Tool::Frame => "FRAME",
            Tool::Rectangle => "RECTANGLE", Tool::Ellipse => "ELLIPSE", Tool::Line => "LINE",
            Tool::Polygon => "POLYGON", Tool::Star => "STAR", Tool::Text => "TEXT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Drag {
    None,
    Move { start: Point, cmds: usize },
    Create { start_world: Point },
    Marquee { start_world: Point },
    Resize { corner: u8, start_world: Point, orig: (f64, f64, f64, f64), cmds: usize }, // x,y,w,h
    Rotate { center: Point, start_angle: f64, orig: f64, cmds: usize },
    Pan { start: Point },
    /// Figma Scale tool: vertical drag scales the selected subtree.
    Scale { start_y: f64, applied: f64, cmds: usize },
}

/// Text-input focus: either inline canvas text editing or a numeric
/// inspector field. Keyboard chars route here when active.
#[derive(Debug, Clone, PartialEq)]
enum Focus {
    None,
    /// editing the text CONTENT of a Text node; original kept for Esc-cancel
    TextNode { id: String, buffer: String, original: String },
    /// editing X/Y/W/H (field 0..4) of the selected node
    Field { id: String, field: u8, buffer: String },
    /// typing in the layers-panel search box (Sketch-style filter)
    LayerSearch,
}

struct App {
    editor: Editor,
    vars: Variables,
    tool: Tool,
    pan: (f64, f64),
    zoom: f64,
    cursor: Point,
    drag: Drag,
    shift: bool,
    ctrl: bool,
    alt: bool,
    /// alt was held at drag start -> duplicate then move (Figma Alt+drag)
    alt_dupe_done: bool,
    status: String,
    created_count: usize,
    win_w: f64,
    win_h: f64,
    /// flattened (id, depth, kind_label) rows for the layers panel
    layer_rows: Vec<(String, usize, &'static str)>,
    focus: Focus,
    last_click: std::time::Instant,
    last_click_pos: Point,
    /// Phase 6.5: all pages; `page_idx` is the one loaded in the editor.
    pages: Vec<Node>,
    page_idx: usize,
    /// Phase 8: presentation mode. When Some, canvas renders a playback
    /// frame instead of the editor; transitions smart-animate between pages.
    present: Option<Present>,
    /// smart guides found during the current move drag (world coords)
    guides: Vec<(bool, f64)>,
    /// Phase 5.2: component pending placement — next canvas click stamps it
    stamping: Option<String>,
    /// hover highlight target (Select tool, nothing dragging)
    hover: Option<String>,
    /// layers panel scroll offset (rows)
    layers_scroll: usize,
    /// Sketch-style hide interface (Ctrl+.)
    chrome_hidden: bool,
    /// rulers on/off (Shift+R in Figma)
    rulers: bool,
    /// user guides in page coords: (vertical?, coord)
    user_guides: Vec<(bool, f64)>,
    /// Figma outline view (Ctrl+Y): strokes only, no fills
    outline_view: bool,
    /// right-sidebar tab: 0 = Design, 1 = Prototype (Figma properties panel)
    inspector_tab: u8,
    /// "?" shortcuts overlay
    help_open: bool,
    /// spacebar held -> temporary hand tool (Figma)
    space_pan: bool,
    /// Sketch-style layer list filter
    layer_filter: String,
    /// decoded image assets (Phase 4.2)
    assets: arco_native::Assets,
}

struct Present {
    /// index of the page being shown
    current: usize,
    /// active transition: (from_idx, to_idx, started, duration_ms)
    transition: Option<(usize, usize, std::time::Instant, u32)>,
}

fn kind_label(n: &Node) -> &'static str {
    use arco_native::NodeKind::*;
    match &n.kind {
        Frame { .. } => "FRAME", Group => "GROUP", Rect { .. } => "RECT", Ellipse => "ELLIPSE",
        Line => "LINE", Text { .. } => "TEXT", Image { .. } => "IMAGE", Vector { .. } => "VECTOR",
        Component { .. } => "COMP", Instance { .. } => "INST",
    }
}

impl App {
    fn canvas_origin(&self) -> (f64, f64) {
        if self.chrome_hidden { (0.0, 0.0) } else { (TOOLBAR_W + LAYERS_W, TOP_H) }
    }
    fn canvas_rect(&self) -> Rect {
        if self.chrome_hidden { return Rect::new(0.0, 0.0, self.win_w, self.win_h); }
        Rect::new(TOOLBAR_W + LAYERS_W, TOP_H, self.win_w - INSPECTOR_W, self.win_h)
    }
    /// Sketch-style minimap rect (bottom-right of the canvas).
    fn minimap_rect(&self) -> Rect {
        let c = self.canvas_rect();
        Rect::new(c.x1 - 176.0, c.y1 - BOTTOM_BAR_H - 116.0, c.x1 - 12.0, c.y1 - BOTTOM_BAR_H - 12.0)
    }

    /// Figma-style floating toolbar, centered at the bottom of the canvas.
    fn bottom_bar_rect(&self) -> Rect {
        let c = self.canvas_rect();
        let w = Tool::ALL.len() as f64 * 38.0 + 16.0;
        let cx = (c.x0 + c.x1) / 2.0;
        Rect::new(cx - w / 2.0, c.y1 - BOTTOM_BAR_H - 10.0, cx + w / 2.0, c.y1 - 10.0)
    }
    fn camera(&self) -> Affine {
        let (ox, oy) = self.canvas_origin();
        Affine::translate((ox + self.pan.0, oy + self.pan.1)) * Affine::scale(self.zoom)
    }
    fn world_point(&self, screen: Point) -> Point {
        let (ox, oy) = self.canvas_origin();
        Point::new((screen.x - ox - self.pan.0) / self.zoom, (screen.y - oy - self.pan.1) / self.zoom)
    }

    fn rebuild_layer_rows(&mut self) {
        fn walk(n: &Node, depth: usize, out: &mut Vec<(String, usize, &'static str)>) {
            out.push((n.id.clone(), depth, kind_label(n)));
            for c in &n.children { walk(c, depth + 1, out); }
        }
        let mut rows = vec![];
        walk(&self.editor.root, 0, &mut rows);
        if !self.layer_filter.is_empty() {
            let q = self.layer_filter.to_ascii_lowercase();
            rows.retain(|(id, _, k)| id.to_ascii_lowercase().contains(&q) || k.to_ascii_lowercase().contains(&q));
        }
        self.layer_rows = rows;
    }

    fn selected_single(&self) -> Option<&Node> {
        if self.editor.selection.len() == 1 { find(&self.editor.root, &self.editor.selection[0]) } else { None }
    }

    /// Selection AABB in SCREEN space (for handles).
    fn selection_screen_bounds(&self) -> Option<Rect> {
        let id = self.editor.selection.first()?;
        let (world, w, h) = world_transform_of(&self.editor.root, id)?;
        Some(quad_bounds(self.camera() * world, w, h))
    }

    /// Figma handle model: 0-3 = corners (TL,TR,BL,BR), 4=left edge,
    /// 5=right, 6=top, 7=bottom. Corners win over edges.
    fn handle_at(&self, p: Point) -> Option<u8> {
        let b = self.selection_screen_bounds()?;
        let corners = [(b.x0, b.y0), (b.x1, b.y0), (b.x0, b.y1), (b.x1, b.y1)];
        for (i, (cx, cy)) in corners.iter().enumerate() {
            if (p.x - cx).abs() <= 6.0 && (p.y - cy).abs() <= 6.0 { return Some(i as u8); }
        }
        // edges: within 4px of the line, between the corner zones
        let inside_y = p.y > b.y0 + 8.0 && p.y < b.y1 - 8.0;
        let inside_x = p.x > b.x0 + 8.0 && p.x < b.x1 - 8.0;
        if inside_y && (p.x - b.x0).abs() <= 4.0 { return Some(4); }
        if inside_y && (p.x - b.x1).abs() <= 4.0 { return Some(5); }
        if inside_x && (p.y - b.y0).abs() <= 4.0 { return Some(6); }
        if inside_x && (p.y - b.y1).abs() <= 4.0 { return Some(7); }
        None
    }

    /// Figma rotation: no visible knob — an invisible hotspot in the ring
    /// JUST OUTSIDE each corner (8..24px out, beyond the resize square).
    fn rotate_handle_at(&self, p: Point) -> bool {
        let Some(b) = self.selection_screen_bounds() else { return false };
        let outside = p.x < b.x0 - 4.0 || p.x > b.x1 + 4.0 || p.y < b.y0 - 4.0 || p.y > b.y1 + 4.0;
        if !outside { return false; }
        for (cx, cy) in [(b.x0, b.y0), (b.x1, b.y0), (b.x0, b.y1), (b.x1, b.y1)] {
            let d = ((p.x - cx).powi(2) + (p.y - cy).powi(2)).sqrt();
            if d > 6.0 && d <= 24.0 { return true; }
        }
        false
    }

    // ---------------------------------------------------------- text focus

    fn commit_focus(&mut self) {
        match std::mem::replace(&mut self.focus, Focus::None) {
            Focus::TextNode { id, buffer, original } => {
                if buffer != original {
                    self.editor.set_text(&id, &buffer);
                    self.status = format!("text: {buffer}");
                }
            }
            Focus::Field { id, field, buffer } => {
                if let Ok(v) = buffer.trim().parse::<f64>() {
                    match field {
                        0 | 1 => {
                            if let Some(n) = find(&self.editor.root, &id) {
                                let (dx, dy) = if field == 0 { (v - n.transform.x, 0.0) } else { (0.0, v - n.transform.y) };
                                let keep = self.editor.selection.clone();
                                self.editor.selection = vec![id.clone()];
                                self.editor.move_selection(dx, dy);
                                self.editor.selection = keep;
                            }
                        }
                        2 | 3 => {
                            if let Some(n) = find(&self.editor.root, &id) {
                                let (w, h) = if field == 2 { (v, n.h) } else { (n.w, v) };
                                self.editor.resize(&id, w.max(1.0), h.max(1.0));
                            }
                        }
                        _ => {}
                    }
                    self.status = format!("set {} = {v}", ["X", "Y", "W", "H"][field as usize]);
                }
            }
            Focus::LayerSearch => {}
            Focus::None => {}
        }
    }

    fn cancel_focus(&mut self) {
        if let Focus::TextNode { id, original, .. } = &self.focus {
            let id = id.clone(); let orig = original.clone();
            // restore original content directly (no undo entry for the cancel)
            if let Some(n) = arco_native::editor::find_mut(&mut self.editor.root, &id) {
                if let arco_native::NodeKind::Text { text } = &mut n.kind { *text = orig; }
            }
        }
        self.focus = Focus::None;
    }

    // ---------------------------------------------------------------- pages

    fn switch_page(&mut self, idx: usize) {
        if idx >= self.pages.len() || idx == self.page_idx { return; }
        self.commit_focus();
        self.pages[self.page_idx] = self.editor.root.clone();
        self.page_idx = idx;
        self.editor = Editor::new(self.pages[idx].clone());
        self.status = format!("page: {}", self.pages[idx].id);
    }

    fn add_page(&mut self) {
        self.pages[self.page_idx] = self.editor.root.clone();
        let id = format!("page-{}", self.pages.len() + 1);
        self.pages.push(Node::frame(&id, 1600.0, 1000.0));
        let idx = self.pages.len() - 1;
        self.page_idx = idx;
        self.editor = Editor::new(self.pages[idx].clone());
        self.status = format!("new page: {id}");
    }

    // ---------------------------------------------------------------- input

    // ---------------------------------------------------------- presenting

    fn enter_present(&mut self) {
        self.commit_focus();
        self.pages[self.page_idx] = self.editor.root.clone();
        self.present = Some(Present { current: self.page_idx, transition: None });
        self.status = "PRESENTING — click advances, Esc exits".into();
    }

    fn present_click(&mut self, p: Point) {
        let Some(pr) = &self.present else { return };
        if pr.transition.is_some() { return; }
        let current = pr.current;
        // map screen point back into page coordinates (same fit as rendering)
        let page = &self.pages[current];
        let scale = (self.win_w / page.w.max(1.0)).min(self.win_h / page.h.max(1.0));
        let ox = (self.win_w - page.w * scale) / 2.0;
        let oy = (self.win_h - page.h * scale) / 2.0;
        let wp = Point::new((p.x - ox) / scale, (p.y - oy) / scale);
        // hit a node with a prototype link? navigate to its destination page
        let mut target: Option<(usize, u32)> = None;
        if let Some(hit_id) = arco_native::editor::hit_test(page, wp) {
            // walk up ancestors for the nearest prototype action
            fn proto_for<'a>(n: &'a Node, target: &str) -> Option<&'a arco_native::PrototypeAction> {
                if n.id == target { return n.prototype.as_ref(); }
                for c in &n.children {
                    if let Some(a) = proto_for(c, target) { return Some(a); }
                    if arco_native::editor::find(c, target).is_some() {
                        return c.prototype.as_ref().or_else(|| proto_for(c, target));
                    }
                }
                None
            }
            if let Some(act) = proto_for(page, &hit_id) {
                if let Some(idx) = self.pages.iter().position(|pg| pg.id == act.destination) {
                    target = Some((idx, act.transition_ms.max(80)));
                }
            }
        }
        // fallback: click-anywhere advances to the next page
        let (next, ms) = target.unwrap_or(((current + 1) % self.pages.len(), 350));
        if next != current {
            if let Some(pr) = &mut self.present {
                pr.transition = Some((current, next, std::time::Instant::now(), ms));
            }
        }
    }

    /// The frame to draw while presenting (owned; may be an interpolation).
    fn present_frame(&mut self) -> Option<Node> {
        let pr = self.present.as_mut()?;
        if let Some((from, to, started, ms)) = pr.transition {
            let t = started.elapsed().as_millis() as f64 / ms as f64;
            if t >= 1.0 {
                pr.current = to;
                pr.transition = None;
            } else {
                // ease-in-out
                let te = if t < 0.5 { 2.0 * t * t } else { 1.0 - (-2.0 * t + 2.0).powi(2) / 2.0 };
                return Some(arco_native::editor::smart_animate(&self.pages[from], &self.pages[to], te));
            }
        }
        Some(self.pages[pr.current].clone())
    }

    fn mouse_down(&mut self, p: Point) {
        if self.present.is_some() { self.present_click(p); return; }
        let double = self.last_click.elapsed().as_millis() < 400
            && (p - self.last_click_pos).hypot() < 6.0;
        self.last_click = std::time::Instant::now();
        self.last_click_pos = p;

        // an active text/field edit commits when clicking elsewhere
        if self.focus != Focus::None { self.commit_focus(); }

        // help overlay swallows clicks
        if self.help_open { self.help_open = false; return; }
        // chrome first (Figma layout: bottom toolbar, left sidebar, right panel)
        if !self.chrome_hidden {
            let bar = self.bottom_bar_rect();
            if bar.contains(p) { self.click_bottom_bar(p); return; }
            // "?" chip next to the bar
            let hr = Rect::new(bar.x1 + 8.0, bar.y0 + 5.0, bar.x1 + 36.0, bar.y1 - 5.0);
            if hr.contains(p) { self.help_open = true; return; }
            // zoom widget in the top bar
            if p.y < TOP_H {
                let zx = self.win_w - INSPECTOR_W - 128.0;
                if p.x >= zx && p.x <= zx + 20.0 { self.zoom = (self.zoom / 1.25).clamp(0.05, 16.0); self.status = format!("zoom {}%", (self.zoom * 100.0).round()); return; }
                if p.x >= zx + 80.0 && p.x <= zx + 100.0 { self.zoom = (self.zoom * 1.25).clamp(0.05, 16.0); self.status = format!("zoom {}%", (self.zoom * 100.0).round()); return; }
                if p.x >= zx + 24.0 && p.x <= zx + 76.0 {
                    let cw = self.win_w - LAYERS_W - INSPECTOR_W - 40.0;
                    let chh = self.win_h - TOP_H - 40.0;
                    self.zoom = (cw / self.editor.root.w.max(1.0)).min(chh / self.editor.root.h.max(1.0)).clamp(0.02, 4.0);
                    self.pan = (20.0, 20.0);
                    self.status = "zoom to fit".into();
                    return;
                }
            }
        }
        if p.x < LAYERS_W && p.y > TOP_H { self.click_left_sidebar(p); return; }
        if p.x > self.win_w - INSPECTOR_W && p.y > TOP_H { self.click_inspector(p); return; }
        if p.y < TOP_H { return; }

        // hand tool or held spacebar -> pan drag
        if self.tool == Tool::Hand || self.space_pan {
            self.drag = Drag::Pan { start: p };
            return;
        }
        // scale tool: needs a selection; vertical drag scales it
        if self.tool == Tool::Scale {
            if let Some(id) = self.editor.selection.first() {
                let _ = id;
                self.drag = Drag::Scale { start_y: p.y, applied: 1.0, cmds: self.editor.undo_depth() };
            } else {
                // click selects first, like Figma's scale tool
                let wp = self.world_point(p);
                self.editor.click(wp, false);
                if !self.editor.selection.is_empty() {
                    self.status = format!("scale: drag vertically ({})", self.editor.selection[0]);
                }
            }
            return;
        }
        // rulers: click in a ruler strip drops a guide at that spot
        if self.rulers && !self.chrome_hidden {
            let c = self.canvas_rect();
            if p.y >= c.y0 && p.y <= c.y0 + 16.0 && p.x >= c.x0 + 16.0 {
                let wp = self.world_point(p);
                self.user_guides.push((false, wp.y.round()));
                self.status = format!("guide at y={}", wp.y.round());
                return;
            }
            if p.x >= c.x0 && p.x <= c.x0 + 16.0 && p.y >= c.y0 + 16.0 {
                let wp = self.world_point(p);
                self.user_guides.push((true, wp.x.round()));
                self.status = format!("guide at x={}", wp.x.round());
                return;
            }
        }
        // minimap click -> jump viewport there
        if !self.chrome_hidden && self.minimap_rect().contains(p) {
            let mm = self.minimap_rect();
            let page = &self.editor.root;
            let sx = mm.width() / page.w.max(1.0);
            let sy = mm.height() / page.h.max(1.0);
            let s = sx.min(sy);
            let wx = (p.x - mm.x0) / s;
            let wy = (p.y - mm.y0) / s;
            let c = self.canvas_rect();
            self.pan.0 = (c.width() / 2.0) - wx * self.zoom - (c.x0 - self.canvas_origin().0);
            self.pan.1 = (c.height() / 2.0) - wy * self.zoom;
            self.status = "minimap jump".into();
            return;
        }
        let wp = self.world_point(p);
        // component stamping takes priority over tools
        if let Some(name) = self.stamping.take() {
            if let Some(id) = self.editor.place_instance(&name, wp.x, wp.y) {
                self.editor.selection = vec![id.clone()];
                self.status = format!("placed {id}");
            }
            return;
        }
        match self.tool {
            Tool::Select => {
                if self.rotate_handle_at(p) {
                    if let Some(n) = self.selected_single() {
                        if let Some(b) = self.selection_screen_bounds() {
                            let center = Point::new((b.x0 + b.x1) / 2.0, (b.y0 + b.y1) / 2.0);
                            let a0 = (p.y - center.y).atan2(p.x - center.x);
                            self.drag = Drag::Rotate { center, start_angle: a0, orig: n.transform.rotation, cmds: self.editor.undo_depth() };
                            return;
                        }
                    }
                }
                if let Some(corner) = self.handle_at(p) {
                    if let Some(n) = self.selected_single() {
                        self.drag = Drag::Resize { corner, start_world: wp, orig: (n.transform.x, n.transform.y, n.w, n.h), cmds: self.editor.undo_depth() };
                        return;
                    }
                }
                if double {
                    // Figma double-click: drill into the hierarchy;
                    // if the drill lands on a Text node -> inline edit.
                    if let Some(next) = self.editor.drill_into(wp) {
                        if let Some(n) = find(&self.editor.root, &next) {
                            if let arco_native::NodeKind::Text { text } = &n.kind {
                                self.focus = Focus::TextNode { id: n.id.clone(), buffer: text.clone(), original: text.clone() };
                                self.status = "editing text — Enter commits, Esc cancels".into();
                                self.drag = Drag::None;
                                return;
                            }
                        }
                        self.status = format!("entered {next}");
                        self.drag = Drag::None;
                        return;
                    }
                }
                // Figma: plain click = top-level object; Ctrl+click = deep select
                self.editor.click_figma(wp, self.shift, self.ctrl);
                if self.editor.selection.is_empty() {
                    self.drag = Drag::Marquee { start_world: wp };
                } else {
                    self.alt_dupe_done = false;
                    self.drag = Drag::Move { start: p, cmds: self.editor.undo_depth() };
                    self.status = format!("selected {}", self.editor.selection.join(", "));
                }
            }
            _ => self.drag = Drag::Create { start_world: wp },
        }
    }

    fn click_bottom_bar(&mut self, p: Point) {
        let bar = self.bottom_bar_rect();
        let idx = ((p.x - bar.x0 - 8.0) / 38.0).floor();
        if idx >= 0.0 && (idx as usize) < Tool::ALL.len() {
            self.tool = Tool::ALL[idx as usize];
            self.status = format!("tool: {:?}", self.tool);
        }
    }

    fn mouse_move(&mut self, p: Point) {
        if let Drag::Move { start, .. } = self.drag {
            let d = (p - start) / self.zoom;
            if d.x != 0.0 || d.y != 0.0 {
                // Figma Alt+drag = duplicate, then move the copy
                if self.alt && !self.alt_dupe_done {
                    self.alt_dupe_done = true;
                    let ids = self.editor.duplicate_selection((0.0, 0.0));
                    self.status = format!("alt-duplicated {}", ids.join(", "));
                }
                self.editor.move_selection(d.x.round(), d.y.round());
                // Figma magnetic snap: pull edges/centers onto neighbors
                if self.editor.selection.len() == 1 {
                    let id = self.editor.selection[0].clone();
                    let (sx, sy) = arco_native::editor::snap_delta(&self.editor.root, &id, 4.0 / self.zoom);
                    if sx != 0.0 || sy != 0.0 { self.editor.move_selection(sx, sy); }
                    self.guides = arco_native::editor::alignment_guides(&self.editor.root, &id, 1.0);
                } else { self.guides = vec![]; }
                self.drag = match self.drag { Drag::Move { cmds, .. } => Drag::Move { start: p, cmds }, d => d };
            }
        } else if let Drag::Resize { corner, start_world, orig, cmds } = self.drag {
            let wp = self.world_point(p);
            let (dx, dy) = (wp.x - start_world.x, wp.y - start_world.y);
            let (x, y, w, h) = orig;
            let id = self.editor.selection[0].clone();
            // corner: 0 TL, 1 TR, 2 BL, 3 BR
            let (mut nw, mut nh) = match corner {
                0 => (w - dx, h - dy),
                1 => (w + dx, h - dy),
                2 => (w - dx, h + dy),
                3 => (w + dx, h + dy),
                4 => (w - dx, h), // left edge
                5 => (w + dx, h), // right edge
                6 => (w, h - dy), // top edge
                _ => (w, h + dy), // bottom edge
            };
            // Shift = lock aspect ratio to the original w:h (corners only)
            if self.shift && corner < 4 && w > 0.0 && h > 0.0 {
                let ratio = w / h;
                if (nw / w).abs() > (nh / h).abs() { nh = nw / ratio; } else { nw = nh * ratio; }
            }
            self.editor.resize(&id, nw.max(2.0), nh.max(2.0));
            if let Some(n) = arco_native::editor::find_mut(&mut self.editor.root, &id) {
                // opposite corner stays fixed
                match corner {
                    0 => { n.transform.x = x + dx; n.transform.y = y + dy; }
                    1 => { n.transform.y = y + dy; }
                    2 => { n.transform.x = x + dx; }
                    4 => { n.transform.x = x + dx; }
                    6 => { n.transform.y = y + dy; }
                    _ => {}
                }
            }
            self.drag = Drag::Resize { corner, start_world, orig, cmds };
        } else if let Drag::Pan { start } = self.drag {
            self.pan.0 += p.x - start.x;
            self.pan.1 += p.y - start.y;
            self.drag = Drag::Pan { start: p };
        } else if let Drag::Scale { start_y, applied, cmds } = self.drag {
            // target factor from total drag distance: 200px up = +100%
            let target = (1.0 - (p.y - start_y) / 200.0).clamp(0.2, 5.0);
            let step = target / applied;
            if (step - 1.0).abs() > 0.01 {
                if let Some(id) = self.editor.selection.first().cloned() {
                    self.editor.scale_node(&id, step);
                    self.drag = Drag::Scale { start_y, applied: target, cmds };
                    self.status = format!("scale {:.0}%", target * 100.0);
                }
            }
        } else if self.drag == Drag::None && self.tool == Tool::Select && self.present.is_none() {
            // hover highlight (only inside canvas, not over chrome)
            self.hover = if self.canvas_rect().contains(p) {
                arco_native::editor::hit_test(&self.editor.root, self.world_point(p))
                    .filter(|id| !self.editor.selection.contains(id))
            } else { None };
        }
        if let Drag::Rotate { center, start_angle, orig, cmds } = self.drag {
            let a = (p.y - center.y).atan2(p.x - center.x);
            let mut angle = orig + (a - start_angle);
            if self.shift {
                // snap to 15° steps
                let step = 15f64.to_radians();
                angle = (angle / step).round() * step;
            }
            if let Some(id) = self.editor.selection.first().cloned() {
                self.editor.rotate(&id, angle);
            }
            self.drag = Drag::Rotate { center, start_angle, orig, cmds };
        }
        self.cursor = p;
    }

    fn mouse_up(&mut self, p: Point) {
        self.guides.clear();
        match self.drag {
            Drag::Move { cmds, .. } => {
                let n = self.editor.undo_depth().saturating_sub(cmds);
                self.editor.merge_last(n);
            }
            Drag::Resize { cmds, .. } => {
                let n = self.editor.undo_depth().saturating_sub(cmds);
                self.editor.merge_last(n);
                self.status = "resized".into();
            }
            Drag::Rotate { cmds, .. } => {
                let n = self.editor.undo_depth().saturating_sub(cmds);
                self.editor.merge_last(n);
                if let Some(node) = self.selected_single() {
                    self.status = format!("rotated to {:.0} deg", node.transform.rotation.to_degrees());
                }
            }
            Drag::Marquee { start_world } => {
                let wp = self.world_point(p);
                let r = Rect::new(start_world.x.min(wp.x), start_world.y.min(wp.y), start_world.x.max(wp.x), start_world.y.max(wp.y));
                if r.width() > 2.0 && r.height() > 2.0 {
                    self.editor.selection = hit_test_rect(&self.editor.root, r);
                    self.status = format!("marquee: {} selected", self.editor.selection.len());
                }
            }
            Drag::Create { start_world } => {
                let wp = self.world_point(p);
                let r = Rect::new(start_world.x.min(wp.x), start_world.y.min(wp.y), start_world.x.max(wp.x), start_world.y.max(wp.y));
                if r.width() >= 3.0 && r.height() >= 3.0 {
                    self.created_count += 1;
                    let id = format!("{}-{}", self.tool.label().to_lowercase(), self.created_count);
                    let node = match self.tool {
                        Tool::Rectangle => Node::rect(&id, r.x0, r.y0, r.width(), r.height(), C_ACCENT).radius(4.0),
                        Tool::Ellipse => Node::ellipse(&id, r.x0, r.y0, r.width(), r.height(), PALETTE[1]),
                        Tool::Line => Node::line(&id, r.x0, r.y0, r.width(), r.height().max(2.0), Color::WHITE),
                        Tool::Text => Node::text(&id, r.x0, r.y0, r.width(), r.height().clamp(12.0, 64.0), "TEXT"),
                        Tool::Polygon => {
                            let mut n = Node::vector(&id, 0.0, 0.0, r.width(), r.height(), regular_polygon(6, r.width(), r.height()));
                            n.transform.x = r.x0; n.transform.y = r.y0;
                            n.fill = Paint::Solid(PALETTE[2]);
                            n
                        }
                        Tool::Star => {
                            let mut n = Node::vector(&id, 0.0, 0.0, r.width(), r.height(), star_path(5, r.width(), r.height()));
                            n.transform.x = r.x0; n.transform.y = r.y0;
                            n.fill = Paint::Solid(PALETTE[4]);
                            n
                        }
                        Tool::Frame | Tool::Select | Tool::Hand | Tool::Scale => {
                            let mut f = Node::frame(&id, r.width(), r.height());
                            f.transform.x = r.x0; f.transform.y = r.y0;
                            f.fill = Paint::Solid(Color::rgb8(0x38, 0x38, 0x38));
                            f
                        }
                    };
                    let root_id = self.editor.root.id.clone();
                    self.editor.insert_node(&root_id, node);
                    self.editor.selection = vec![id.clone()];
                    self.status = format!("created {id}");
                    self.rebuild_layer_rows();
                    self.tool = Tool::Select;
                }
            }
            Drag::Pan { .. } => {}
            Drag::Scale { applied, cmds, .. } => {
                let n = self.editor.undo_depth().saturating_sub(cmds);
                self.editor.merge_last(n);
                if (applied - 1.0).abs() > 0.001 {
                    self.status = format!("scaled to {:.0}%", applied * 100.0);
                }
            }
            Drag::None => {}
        }
        self.drag = Drag::None;
    }

    fn click_left_sidebar(&mut self, p: Point) {
        // PAGES section first (Figma File tab: pages above layers)
        let pages_y0 = TOP_H + 24.0;
        let pages_end = pages_y0 + self.pages.len() as f64 * ROW_H;
        if p.y >= pages_y0 && p.y < pages_end {
            let idx = ((p.y - pages_y0) / ROW_H) as usize;
            if idx < self.pages.len() { self.switch_page(idx); }
            return;
        }
        // "+ new page" row
        if p.y >= pages_end && p.y < pages_end + ROW_H {
            self.add_page();
            return;
        }
        self.click_layers(p);
    }

    fn click_layers(&mut self, p: Point) {
        // search box next to the LAYERS header (position depends on pages count)
        let header_y = TOP_H + 24.0 + (self.pages.len() as f64 + 1.0) * ROW_H + 6.0;
        if p.y >= header_y - 6.0 && p.y <= header_y + 14.0 && p.x > 70.0 {
            self.focus = Focus::LayerSearch;
            self.status = "type to filter layers, Enter/Esc done".into();
            return;
        }
        // ASSETS section: bottom of the panel, one row per component
        let comps = self.editor.component_names();
        if !comps.is_empty() {
            let assets_y = self.win_h - 30.0 - comps.len() as f64 * ROW_H;
            if p.y >= assets_y {
                let idx = ((p.y - assets_y) / ROW_H).floor();
                if idx >= 0.0 && (idx as usize) < comps.len() {
                    let name = comps[idx as usize].clone();
                    self.status = format!("click canvas to place {name}");
                    self.stamping = Some(name);
                    return;
                }
            }
        }
        let layers_list_y = TOP_H + 24.0 + (self.pages.len() as f64 + 1.0) * ROW_H + 26.0;
        let idx = ((p.y - layers_list_y) / ROW_H).floor();
        let idx = if idx >= 0.0 { idx as usize + self.layers_scroll } else { return };
        if idx < self.layer_rows.len() {
            let id = self.layer_rows[idx].0.clone();
            // eye / lock click zones (right side of the row)
            if p.x >= LAYERS_W - 40.0 && p.x < LAYERS_W - 24.0 {
                if let Some(n) = arco_native::editor::find_mut(&mut self.editor.root, &id) {
                    n.visible = !n.visible;
                    self.status = format!("{} {}", id, if n.visible { "shown" } else { "hidden" });
                }
                return;
            }
            if p.x >= LAYERS_W - 24.0 {
                if let Some(n) = arco_native::editor::find_mut(&mut self.editor.root, &id) {
                    n.locked = !n.locked;
                    self.status = format!("{} {}", id, if n.locked { "locked" } else { "unlocked" });
                }
                return;
            }
            if self.shift {
                if let Some(i) = self.editor.selection.iter().position(|s| s == &id) { self.editor.selection.remove(i); }
                else { self.editor.selection.push(id.clone()); }
            } else {
                self.editor.selection = vec![id.clone()];
            }
            self.status = format!("layer: {id}");
        }
    }

    fn click_inspector(&mut self, p: Point) {
        // Design/Prototype tab switch
        let ix = self.win_w - INSPECTOR_W;
        if p.y >= TOP_H + 4.0 && p.y <= TOP_H + 21.0 {
            for i in 0..2u8 {
                let x = ix + 12.0 + i as f64 * 84.0;
                if p.x >= x && p.x <= x + 78.0 {
                    self.inspector_tab = i;
                    self.status = if i == 0 { "design tab".into() } else { "prototype tab".into() };
                    return;
                }
            }
        }
        // frame presets (Frame tool active, nothing selected)
        if self.selected_single().is_none() && self.tool == Tool::Frame {
            let ix = self.win_w - INSPECTOR_W;
            for (i, (name, w, h)) in FRAME_PRESETS.iter().enumerate() {
                let y = TOP_H + 50.0 + i as f64 * 24.0;
                if p.x >= ix + 12.0 && p.x <= ix + INSPECTOR_W - 24.0 && p.y >= y && p.y <= y + 19.0 {
                    self.created_count += 1;
                    let id = format!("frame-{}", self.created_count);
                    let wp = self.world_point(Point::new(self.canvas_rect().x0 + 60.0, self.canvas_rect().y0 + 60.0));
                    let mut f = Node::frame(&id, *w, *h);
                    f.transform.x = wp.x.max(0.0); f.transform.y = wp.y.max(0.0);
                    f.fill = Paint::Solid(Color::rgb8(0xff, 0xff, 0xff));
                    let root_id = self.editor.root.id.clone();
                    self.editor.insert_node(&root_id, f);
                    self.editor.selection = vec![id.clone()];
                    self.status = format!("created {id} ({name})");
                    self.tool = Tool::Select;
                    return;
                }
            }
        }
        let x0 = self.win_w - INSPECTOR_W + 12.0;
        // numeric fields: X Y (row y=TOP_H+66) and W H (row y=TOP_H+84),
        // matching inspector line positions; click one to type a new value.
        if let Some(n) = self.selected_single() {
            let id = n.id.clone();
            let vals = [n.transform.x, n.transform.y, n.w, n.h];
            let rows = [(0u8, TOP_H + 66.0), (1, TOP_H + 66.0), (2, TOP_H + 84.0), (3, TOP_H + 84.0)];
            for (field, ry) in rows {
                let fx = x0 + if field % 2 == 0 { 0.0 } else { 90.0 };
                if p.x >= fx && p.x <= fx + 84.0 && p.y >= ry - 3.0 && p.y <= ry + 14.0 {
                    self.focus = Focus::Field { id, field, buffer: format!("{:.0}", vals[field as usize]) };
                    self.status = format!("type new {} then Enter", ["X", "Y", "W", "H"][field as usize]);
                    return;
                }
            }
        }
        // alignment row (Design tab): operates on multi-selection like Figma
        if self.inspector_tab == 0 && !self.editor.selection.is_empty() {
            let ix2 = self.win_w - INSPECTOR_W;
            let ay = TOP_H + 24.0;
            if p.y >= ay - 2.0 && p.y <= ay + 14.0 {
                for i in 0..6usize {
                    let x = ix2 + 12.0 + i as f64 * 32.0;
                    if p.x >= x && p.x <= x + 28.0 {
                        use arco_native::editor::AlignKind::*;
                        let kind = [Left, CenterH, Right, Top, CenterV, Bottom][i];
                        let ids = self.editor.selection.clone();
                        if ids.len() >= 2 {
                            arco_native::editor::align(&mut self.editor.root, &ids, kind);
                            self.status = format!("aligned {:?}", kind);
                        } else if let Some(id) = ids.first() {
                            // single selection: align within its parent frame (Figma)
                            let rootw = self.editor.root.w; let rooth = self.editor.root.h;
                            if let Some(n) = arco_native::editor::find_mut(&mut self.editor.root, id) {
                                match kind {
                                    Left => n.transform.x = 0.0,
                                    Right => n.transform.x = rootw - n.w,
                                    CenterH => n.transform.x = (rootw - n.w) / 2.0,
                                    Top => n.transform.y = 0.0,
                                    Bottom => n.transform.y = rooth - n.h,
                                    CenterV => n.transform.y = (rooth - n.h) / 2.0,
                                }
                            }
                            self.status = format!("aligned {:?} to page", kind);
                        }
                        return;
                    }
                }
            }
            // constraints rows
            let cy = TOP_H + 210.0 + 96.0;
            if let Some(id) = self.editor.selection.first().cloned() {
                if p.y >= cy + 14.0 && p.y <= cy + 30.0 {
                    for i in 0..5usize {
                        let x = ix2 + 12.0 + i as f64 * 34.0;
                        if p.x >= x && p.x <= x + 30.0 {
                            use arco_native::HPin::*;
                            let h = [Left, Right, CenterH, StretchH, ScaleH][i];
                            let v = find(&self.editor.root, &id).map(|n| n.pin.1).unwrap_or_default();
                            self.editor.set_pin(&id, h, v);
                            self.status = format!("h-pin {:?}", h);
                            return;
                        }
                    }
                }
                if p.y >= cy + 34.0 && p.y <= cy + 50.0 {
                    for i in 0..5usize {
                        let x = ix2 + 12.0 + i as f64 * 34.0;
                        if p.x >= x && p.x <= x + 30.0 {
                            use arco_native::VPin::*;
                            let v = [Top, Bottom, CenterV, StretchV, ScaleV][i];
                            let h = find(&self.editor.root, &id).map(|n| n.pin.0).unwrap_or_default();
                            self.editor.set_pin(&id, h, v);
                            self.status = format!("v-pin {:?}", v);
                            return;
                        }
                    }
                }
            }
        }
        // opacity -/+ buttons
        if let Some(n) = self.selected_single() {
            let id = n.id.clone();
            let op = n.opacity;
            let ix = self.win_w - INSPECTOR_W;
            if p.y >= TOP_H + 115.0 && p.y <= TOP_H + 130.0 {
                if p.x >= ix + 140.0 && p.x <= ix + 158.0 {
                    self.editor.set_opacity(&id, (op - 0.1).max(0.0));
                    self.status = "opacity -".into();
                    return;
                }
                if p.x >= ix + 162.0 && p.x <= ix + 180.0 {
                    self.editor.set_opacity(&id, (op + 0.1).min(1.0));
                    self.status = "opacity +".into();
                    return;
                }
            }
        }
        // palette swatches
        let y0 = TOP_H + 150.0;
        for (i, color) in PALETTE.iter().enumerate() {
            let sx = x0 + (i as f64 % 4.0) * 26.0;
            let sy = y0 + (i as f64 / 4.0).floor() * 26.0;
            if p.x >= sx && p.x <= sx + 20.0 && p.y >= sy && p.y <= sy + 20.0 {
                if let Some(id) = self.editor.selection.first().cloned() {
                    self.editor.set_fill(&id, Paint::Solid(*color));
                    self.status = format!("fill {} -> {}", id, arco_native::color_to_hex(*color));
                }
                return;
            }
        }
        // prototype link buttons (Prototype tab)
        if self.inspector_tab == 1 { if let Some(n) = self.selected_single() {
            let id = n.id.clone();
            let ix = self.win_w - INSPECTOR_W;
            let py = TOP_H + 40.0;
            if p.y >= py + 16.0 && p.y <= py + 60.0 {
                let mut bx = ix + 12.0;
                let mut by = py + 16.0;
                if p.x >= bx && p.x <= bx + 46.0 && p.y >= by && p.y <= by + 18.0 {
                    self.editor.set_prototype(&id, None);
                    self.status = format!("{id}: link cleared");
                    return;
                }
                bx += 52.0;
                let root_id = self.editor.root.id.clone();
                let page_ids: Vec<String> = self.pages.iter().map(|pg| pg.id.clone()).filter(|pid| pid != &root_id).collect();
                for pid in page_ids {
                    if bx + 60.0 > self.win_w - 8.0 { bx = ix + 12.0; by += 22.0; }
                    if p.x >= bx && p.x <= bx + 56.0 && p.y >= by && p.y <= by + 18.0 {
                        self.editor.set_prototype(&id, Some(arco_native::PrototypeAction { destination: pid.clone(), transition_ms: 350 }));
                        self.status = format!("{id} -> {pid} on click");
                        return;
                    }
                    bx += 62.0;
                }
            }
        }}
        // auto layout controls (frames only)
        if let Some(n) = self.selected_single() {
            if matches!(n.kind, arco_native::NodeKind::Frame { .. }) {
                let id = n.id.clone();
                let ix = self.win_w - INSPECTOR_W;
                let ly = TOP_H + 210.0;
                let vars = self.vars.clone();
                // NONE / H / V
                if p.y >= ly + 16.0 && p.y <= ly + 34.0 {
                    for i in 0..3usize {
                        let bx = ix + 12.0 + i as f64 * 52.0;
                        if p.x >= bx && p.x <= bx + 46.0 {
                            let current = self.editor.auto_layout_of(&id);
                            let new_layout = match i {
                                0 => None,
                                _ => {
                                    let mut l = current.clone().unwrap_or(AutoLayout {
                                        gap: 16.0, padding: 16.0, align: CrossAlign::Center, ..Default::default()
                                    });
                                    l.direction = if i == 1 { LayoutDirection::Horizontal } else { LayoutDirection::Vertical };
                                    Some(l)
                                }
                            };
                            self.editor.set_auto_layout(&id, new_layout, &vars);
                            self.status = format!("layout: {}", ["none", "horizontal", "vertical"][i]);
                            return;
                        }
                    }
                }
                // GAP / PAD steppers
                if let Some(l) = self.editor.auto_layout_of(&id) {
                    for (row, is_gap) in [(0usize, true), (1, false)] {
                        let ry = ly + 44.0 + row as f64 * 22.0;
                        if p.y >= ry - 3.0 && p.y <= ry + 12.0 {
                            let delta = if p.x >= ix + 140.0 && p.x <= ix + 158.0 { -4.0 }
                                else if p.x >= ix + 162.0 && p.x <= ix + 180.0 { 4.0 }
                                else { continue };
                            let mut nl = l.clone();
                            if is_gap { nl.gap = (nl.gap + delta).max(0.0); } else { nl.padding = (nl.padding + delta).max(0.0); }
                            self.editor.set_auto_layout(&id, Some(nl.clone()), &vars);
                            self.status = format!("gap {:.0} pad {:.0}", nl.gap, nl.padding);
                            return;
                        }
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------ rendering

    fn build_display_scene(&mut self) -> Scene {
        // presentation mode: full-window playback, no chrome
        if self.present.is_some() {
            if let Some(frame) = self.present_frame() {
                let mut ui = Scene::new();
                let (scene, _) = arco_native::build_scene_with_assets(&frame, None, &self.vars, Some(&self.assets));
                // fit page into window
                let scale = (self.win_w / frame.w.max(1.0)).min(self.win_h / frame.h.max(1.0));
                let ox = (self.win_w - frame.w * scale) / 2.0;
                let oy = (self.win_h - frame.h * scale) / 2.0;
                ui.append(&scene, Some(Affine::translate((ox, oy)) * Affine::scale(scale)));
                label(&mut ui, "PRESENTING - ESC TO EXIT", 12.0, self.win_h - 24.0, 10.0, C_DIM);
                return ui;
            }
        }
        self.rebuild_layer_rows();
        let mut ui = Scene::new();

        // document, clipped to canvas
        let canvas = self.canvas_rect();
        ui.push_layer(vello::peniko::Mix::Clip, 1.0, Affine::IDENTITY, &canvas);
        if self.outline_view {
            // Figma "layer outlines": strokes only, no fills
            fn outline_walk(n: &Node, parent: Affine, cam: Affine, ui: &mut Scene) {
                if !n.visible { return; }
                let world = parent * n.transform.matrix(n.w, n.h);
                let b = quad_bounds(cam * world, n.w, n.h);
                if !matches!(n.kind, arco_native::NodeKind::Component { .. }) {
                    stroke_rect(ui, b, Color::rgb8(0x9a, 0x9a, 0x9a), 1.0);
                }
                for c in &n.children { outline_walk(c, world, cam, ui); }
            }
            let cam = self.camera();
            let root = self.editor.root.clone();
            for c in &root.children { outline_walk(c, Affine::IDENTITY, cam, &mut ui); }
        } else {
            let (doc_scene, _) = arco_native::build_scene_with_assets(&self.editor.root, None, &self.vars, Some(&self.assets));
            ui.append(&doc_scene, Some(self.camera()));
        }

        // user guides (cyan, Sketch/Figma canvas guides)
        for (vertical, coord) in &self.user_guides {
            let line = if *vertical {
                let a = self.camera() * Point::new(*coord, -100000.0);
                let b = self.camera() * Point::new(*coord, 100000.0);
                vello::kurbo::Line::new(a, b)
            } else {
                let a = self.camera() * Point::new(-100000.0, *coord);
                let b = self.camera() * Point::new(100000.0, *coord);
                vello::kurbo::Line::new(a, b)
            };
            ui.stroke(&vello::kurbo::Stroke::new(1.0), Affine::IDENTITY, Color::rgba8(0x00, 0xbc, 0xd4, 180), None, &line);
        }

        // smart guides (red lines) while dragging
        for (vertical, coord) in &self.guides {
            let line = if *vertical {
                let a = self.camera() * Point::new(*coord, -100000.0);
                let b = self.camera() * Point::new(*coord, 100000.0);
                vello::kurbo::Line::new(a, b)
            } else {
                let a = self.camera() * Point::new(-100000.0, *coord);
                let b = self.camera() * Point::new(100000.0, *coord);
                vello::kurbo::Line::new(a, b)
            };
            ui.stroke(&vello::kurbo::Stroke::new(1.0), Affine::IDENTITY, Color::rgb8(0xff, 0x3b, 0x30), None, &line);
        }

        // hover highlight (thin outline, no handles)
        if let Some(hid) = &self.hover {
            if let Some((world, w, h)) = world_transform_of(&self.editor.root, hid) {
                let b = quad_bounds(self.camera() * world, w, h);
                stroke_rect(&mut ui, b, Color::rgba8(0x0d, 0x99, 0xff, 140), 1.0);
            }
        }
        // prototype link badges: small purple arrow chip on linked nodes
        {
            fn walk_badges(n: &Node, parent: Affine, cam: Affine, ui: &mut Scene) {
                let world = parent * n.transform.matrix(n.w, n.h);
                if n.prototype.is_some() && n.visible {
                    let b = quad_bounds(cam * world, n.w, n.h);
                    let chip = Rect::new(b.x1 - 14.0, b.y0 - 7.0, b.x1 + 2.0, b.y0 + 7.0);
                    fill_rect(ui, chip, PALETTE[3]);
                    label(ui, ">", chip.x0 + 4.0, chip.y0 + 2.0, 8.0, Color::WHITE);
                }
                for c in &n.children { walk_badges(c, world, cam, ui); }
            }
            let cam = self.camera();
            let root = self.editor.root.clone();
            walk_badges(&root, Affine::IDENTITY, cam, &mut ui);
        }
        // selection outlines + handles
        for id in self.editor.selection.clone() {
            if let Some((world, w, h)) = world_transform_of(&self.editor.root, &id) {
                let b = quad_bounds(self.camera() * world, w, h);
                let editing_this = matches!(&self.focus, Focus::TextNode { id: eid, .. } if eid == &id);
                stroke_rect(&mut ui, b.inflate(1.5, 1.5), if editing_this { PALETTE[4] } else { C_ACCENT }, 1.5);
                if self.editor.selection.len() == 1 && !editing_this {
                    // Figma: 4 small corner squares only (no knob, no stem,
                    // no edge dots — edges are grabbable but invisible;
                    // rotation lives in the invisible ring outside corners)
                    for (cx, cy) in [(b.x0, b.y0), (b.x1, b.y0), (b.x0, b.y1), (b.x1, b.y1)] {
                        let hr = Rect::new(cx - 3.0, cy - 3.0, cx + 3.0, cy + 3.0);
                        fill_rect(&mut ui, hr, Color::WHITE);
                        stroke_rect(&mut ui, hr, C_ACCENT, 1.0);
                    }
                }
                if self.editor.selection.len() == 1 {
                    // Figma dimension badge: blue pill under the selection
                    if let Some(n) = find(&self.editor.root, &id) {
                        let text = format!("{:.0} X {:.0}", n.w, n.h);
                        let tw = arco_native::text::measure(&text, 9.0);
                        let bx = (b.x0 + b.x1) / 2.0 - tw / 2.0 - 6.0;
                        let by = b.y1 + 8.0;
                        let badge = vello::kurbo::RoundedRect::new(bx, by, bx + tw + 12.0, by + 16.0, 3.0);
                        ui.fill(Fill::NonZero, Affine::IDENTITY, C_ACCENT, None, &badge);
                        label(&mut ui, &text, bx + 6.0, by + 4.0, 9.0, Color::WHITE);
                    }
                }
                if editing_this {
                    // caret hint: yellow underline across the text box
                    ui.stroke(&vello::kurbo::Stroke::new(2.0), Affine::IDENTITY, PALETTE[4], None,
                        &vello::kurbo::Line::new((b.x0, b.y1 + 3.0), (b.x1, b.y1 + 3.0)));
                }
            }
        }
        // live marquee / create preview
        match self.drag {
            Drag::Marquee { start_world } | Drag::Create { start_world } => {
                let a = self.camera() * start_world;
                let bpt = self.cursor;
                let r = Rect::new(a.x.min(bpt.x), a.y.min(bpt.y), a.x.max(bpt.x), a.y.max(bpt.y));
                ui.fill(Fill::NonZero, Affine::IDENTITY, Color::rgba8(0x0d, 0x99, 0xff, 30), None, &r.into_path(0.1));
                stroke_rect(&mut ui, r, C_ACCENT, 1.0);
            }
            _ => {}
        }
        ui.pop_layer();

        // Sketch-style "hide interface": canvas only + tiny hint
        if self.chrome_hidden {
            label(&mut ui, "CTRL+. TO SHOW UI", 12.0, self.win_h - 24.0, 9.0, C_DIM);
            return ui;
        }

        // ---------- chrome ----------
        // top bar
        fill_rect(&mut ui, Rect::new(0.0, 0.0, self.win_w, TOP_H), C_PANEL);
        fill_rect(&mut ui, Rect::new(0.0, TOP_H - 1.0, self.win_w, TOP_H), C_PANEL_EDGE);
        label(&mut ui, "X NATIVE BETA", 12.0, 10.0, 13.0, C_TEXT);
        {
            // zoom widget: [-] 100% [+] (click % = zoom-to-fit)
            let zx = self.win_w - INSPECTOR_W - 128.0;
            let bm = Rect::new(zx, 7.0, zx + 20.0, TOP_H - 7.0);
            let bl = Rect::new(zx + 24.0, 7.0, zx + 76.0, TOP_H - 7.0);
            let bp = Rect::new(zx + 80.0, 7.0, zx + 100.0, TOP_H - 7.0);
            for r in [bm, bl, bp] { fill_rrect(&mut ui, r, 4.0, C_HOVERBG); }
            label(&mut ui, "-", bm.x0 + 7.0, 10.0, 11.0, C_TEXT);
            let ztxt = format!("{}%", (self.zoom * 100.0).round());
            let tw = arco_native::text::measure(&ztxt, 9.0);
            label(&mut ui, &ztxt, bl.x0 + (bl.width() - tw) / 2.0, 11.0, 9.0, C_TEXT);
            label(&mut ui, "+", bp.x0 + 6.0, 10.0, 11.0, C_TEXT);
        }
        // status: shows live text buffer while editing
        let status_line = match &self.focus {
            Focus::TextNode { buffer, .. } => format!("TEXT> {buffer}_"),
            Focus::Field { field, buffer, .. } => format!("{}> {buffer}_", ["X", "Y", "W", "H"][*field as usize]),
            Focus::LayerSearch => format!("FIND> {}_", self.layer_filter),
            Focus::None => self.status.clone(),
        };
        label(&mut ui, &status_line, 660.0, 11.0, 10.0, if self.focus == Focus::None { C_DIM } else { PALETTE[4] });

        // ---------- left sidebar (Figma File tab: PAGES then LAYERS) ----------
        fill_rect(&mut ui, Rect::new(0.0, TOP_H, LAYERS_W, self.win_h), C_PANEL);
        fill_rect(&mut ui, Rect::new(LAYERS_W - 1.0, TOP_H, LAYERS_W, self.win_h), C_PANEL_EDGE);
        // PAGES section
        label(&mut ui, "PAGES", 12.0, TOP_H + 8.0, 10.0, C_DIM);
        let pages_y0 = TOP_H + 24.0;
        for (i, pg) in self.pages.iter().enumerate() {
            let y = pages_y0 + i as f64 * ROW_H;
            if i == self.page_idx {
                fill_rect(&mut ui, Rect::new(2.0, y - 2.0, LAYERS_W - 4.0, y + ROW_H - 6.0), Color::rgba8(0x0d, 0x99, 0xff, 70));
            }
            label(&mut ui, &pg.id, 20.0, y, 9.0, if i == self.page_idx { Color::WHITE } else { C_TEXT });
        }
        let plus_y = pages_y0 + self.pages.len() as f64 * ROW_H;
        label(&mut ui, "+ NEW PAGE", 20.0, plus_y, 8.0, C_DIM);
        let layers_header_y = plus_y + ROW_H + 6.0;
        // LAYERS header + search
        label(&mut ui, "LAYERS", 12.0, layers_header_y, 10.0, C_DIM);
        {
            let sr = Rect::new(72.0, layers_header_y - 4.0, LAYERS_W - 8.0, layers_header_y + 12.0);
            let active = self.focus == Focus::LayerSearch;
            stroke_rect(&mut ui, sr, if active { PALETTE[4] } else { C_PANEL_EDGE }, 1.0);
            let shown = if self.layer_filter.is_empty() && !active { "FIND".to_string() }
                else { format!("{}{}", self.layer_filter, if active { "_" } else { "" }) };
            let shown = if shown.len() > 15 { shown[shown.len()-15..].to_string() } else { shown };
            label(&mut ui, &shown, sr.x0 + 4.0, sr.y0 + 4.0, 8.0, if self.layer_filter.is_empty() && !active { C_DIM } else { C_TEXT });
        }
        let layers_list_y = layers_header_y + 20.0;
        let rows = self.layer_rows.clone();
        self.layers_scroll = self.layers_scroll.min(rows.len().saturating_sub(1));
        if self.layers_scroll > 0 {
            label(&mut ui, "...", 12.0, layers_list_y - 14.0, 8.0, C_DIM);
        }
        for (i, (id, depth, klabel)) in rows.iter().enumerate().skip(self.layers_scroll) {
            let y = layers_list_y + (i - self.layers_scroll) as f64 * ROW_H;
            if y > self.win_h - ROW_H { break; }
            let selected = self.editor.selection.contains(id);
            let row_r = Rect::new(2.0, y - 2.0, LAYERS_W - 4.0, y + ROW_H - 6.0);
            let row_hover = row_r.contains(self.cursor);
            if selected { fill_rrect(&mut ui, row_r, 4.0, Color::rgba8(0x0d, 0x99, 0xff, 70)); }
            else if row_hover { fill_rrect(&mut ui, row_r, 4.0, C_HOVERBG); }
            let node_ref = find(&self.editor.root, id);
            let x = 10.0 + *depth as f64 * 12.0;
            // color chip (fill preview) instead of only a kind label
            if let Some(n) = node_ref {
                let chip_c = match &n.fill {
                    Paint::Solid(c) if c.a > 0 => *c,
                    Paint::LinearGradient { stops, .. } | Paint::RadialGradient { stops, .. } =>
                        stops.first().map(|s| s.1).unwrap_or(C_DIM),
                    _ => C_DIM,
                };
                fill_rrect(&mut ui, Rect::new(x, y + 1.0, x + 8.0, y + 9.0), 2.0, chip_c);
            }
            label(&mut ui, klabel, x + 12.0, y, 7.0, C_DIM);
            let name = if id.len() > 12 { &id[..12] } else { id };
            label(&mut ui, name, x + 54.0, y, 9.0, if selected { Color::WHITE } else { C_TEXT });
            // eye + lock affordances at the row's right (hover or engaged)
            if let Some(n) = node_ref {
                let eye_x = LAYERS_W - 40.0;
                let lock_x = LAYERS_W - 22.0;
                if !n.visible { label(&mut ui, "-", eye_x + 3.0, y, 9.0, C_DIM); }
                else if row_hover { label(&mut ui, "O", eye_x + 2.0, y, 8.0, C_DIM); }
                if n.locked { label(&mut ui, "*", lock_x + 3.0, y, 9.0, PALETTE[4]); }
                else if row_hover { label(&mut ui, "*", lock_x + 3.0, y, 8.0, Color::rgba8(0x8f, 0x93, 0x9b, 120)); }
            }
        }

        // ASSETS section at the bottom of the layers panel
        let comps = self.editor.component_names();
        if !comps.is_empty() {
            let assets_y = self.win_h - 30.0 - comps.len() as f64 * ROW_H;
            fill_rect(&mut ui, Rect::new(0.0, assets_y - 22.0, LAYERS_W, assets_y - 21.0), C_PANEL_EDGE);
            label(&mut ui, "ASSETS", 12.0, assets_y - 16.0, 11.0, C_DIM);
            for (i, name) in comps.iter().enumerate() {
                let y = assets_y + i as f64 * ROW_H;
                let stamping_this = self.stamping.as_deref() == Some(name.as_str());
                if stamping_this {
                    fill_rect(&mut ui, Rect::new(2.0, y - 2.0, LAYERS_W - 4.0, y + ROW_H - 6.0), Color::rgba8(0x0d, 0x99, 0xff, 70));
                }
                // diamond marker, Figma-style
                let d = 5.0;
                let (cx, cy) = (16.0, y + 5.0);
                let mut diamond = vello::kurbo::BezPath::new();
                diamond.move_to((cx, cy - d));
                diamond.line_to((cx + d, cy));
                diamond.line_to((cx, cy + d));
                diamond.line_to((cx - d, cy));
                diamond.close_path();
                ui.fill(Fill::NonZero, Affine::IDENTITY, PALETTE[3], None, &diamond);
                label(&mut ui, name, 30.0, y, 9.0, if stamping_this { Color::WHITE } else { C_TEXT });
            }
        }

        // inspector
        let ix = self.win_w - INSPECTOR_W;
        fill_rect(&mut ui, Rect::new(ix, TOP_H, self.win_w, self.win_h), C_PANEL);
        fill_rect(&mut ui, Rect::new(ix, TOP_H, ix + 1.0, self.win_h), C_PANEL_EDGE);
        // Design | Prototype tabs (Figma properties panel)
        for (i, name) in ["DESIGN", "PROTOTYPE"].iter().enumerate() {
            let x = ix + 12.0 + i as f64 * 84.0;
            let r = Rect::new(x, TOP_H + 4.0, x + 78.0, TOP_H + 21.0);
            if self.inspector_tab == i as u8 { fill_rect(&mut ui, r, C_ACCENT); }
            label(&mut ui, name, x + 8.0, TOP_H + 8.0, 8.5, if self.inspector_tab == i as u8 { Color::WHITE } else { C_DIM });
        }
        if self.inspector_tab == 1 {
            // Prototype tab with nothing selected
            if self.selected_single().is_none() {
                label(&mut ui, "SELECT A LAYER TO LINK", ix + 12.0, TOP_H + 40.0, 8.5, C_DIM);
            }
        }
        if let Some(n) = self.selected_single() {
            if self.inspector_tab == 0 {
            label(&mut ui, &format!("{}  ({})", n.id, kind_label(n)), ix + 12.0, TOP_H + 46.0, 9.0, C_TEXT);
            // numeric fields as boxes (click to edit)
            let vals = [n.transform.x, n.transform.y, n.w, n.h];
            let names = ["X", "Y", "W", "H"];
            let rot_deg = n.transform.rotation.to_degrees();
            let opacity = n.opacity;
            for f in 0..4u8 {
                let fy = if f < 2 { TOP_H + 66.0 } else { TOP_H + 84.0 };
                let fx = ix + 12.0 + if f % 2 == 1 { 90.0 } else { 0.0 };
                let r = Rect::new(fx - 2.0, fy - 3.0, fx + 82.0, fy + 13.0);
                let active = matches!(&self.focus, Focus::Field { field, .. } if *field == f);
                if active {
                    stroke_rect(&mut ui, r, PALETTE[4], 1.2);
                    if let Focus::Field { buffer, .. } = &self.focus {
                        label(&mut ui, &format!("{}: {buffer}_", names[f as usize]), fx, fy, 9.5, PALETTE[4]);
                    }
                } else {
                    stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0);
                    label(&mut ui, &format!("{}: {:.0}", names[f as usize], vals[f as usize]), fx, fy, 9.5, C_TEXT);
                }
            }
            // Figma alignment row (top of Design panel): L C R | T M B
            {
                let ay = TOP_H + 24.0;
                for (i, lbl) in ["|<", "><", ">|", "T", "M", "B"].iter().enumerate() {
                    let x = ix + 12.0 + i as f64 * 32.0;
                    let r = Rect::new(x, ay - 2.0, x + 28.0, ay + 14.0);
                    stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0);
                    label(&mut ui, lbl, x + 6.0, ay + 1.0, 8.0, C_TEXT);
                }
            }
            label(&mut ui, &format!("ROT: {:.0} DEG", rot_deg), ix + 12.0, TOP_H + 104.0, 9.5, C_TEXT);
            // opacity with -/+ buttons
            label(&mut ui, &format!("OPACITY: {:.2}", opacity), ix + 12.0, TOP_H + 118.0, 9.5, C_TEXT);
            let bm = Rect::new(ix + 140.0, TOP_H + 115.0, ix + 158.0, TOP_H + 130.0);
            let bp = Rect::new(ix + 162.0, TOP_H + 115.0, ix + 180.0, TOP_H + 130.0);
            stroke_rect(&mut ui, bm, C_PANEL_EDGE, 1.0);
            stroke_rect(&mut ui, bp, C_PANEL_EDGE, 1.0);
            label(&mut ui, "-", ix + 146.0, TOP_H + 117.0, 10.0, C_TEXT);
            label(&mut ui, "+", ix + 166.0, TOP_H + 117.0, 10.0, C_TEXT);
            label(&mut ui, "FILL", ix + 12.0, TOP_H + 132.0, 10.0, C_DIM);
            for (i, color) in PALETTE.iter().enumerate() {
                let sx = ix + 12.0 + (i as f64 % 4.0) * 26.0;
                let sy = TOP_H + 150.0 + (i as f64 / 4.0).floor() * 26.0;
                let r = Rect::new(sx, sy, sx + 20.0, sy + 20.0);
                fill_rect(&mut ui, r, *color);
                stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0);
            }
            } // end Design tab
            // ---- prototype link section (Prototype tab, Figma-style) ----
            if self.inspector_tab == 1 {
                let py = TOP_H + 40.0;
                label(&mut ui, "PROTOTYPE", ix + 12.0, py, 10.0, C_DIM);
                let current_dest = n.prototype.as_ref().map(|a| a.destination.clone());
                // one button per OTHER page + NONE
                let mut bx = ix + 12.0;
                let mut by = py + 16.0;
                let none_r = Rect::new(bx, by, bx + 46.0, by + 18.0);
                if current_dest.is_none() { fill_rect(&mut ui, none_r, C_ACCENT); } else { stroke_rect(&mut ui, none_r, C_PANEL_EDGE, 1.0); }
                label(&mut ui, "NONE", bx + 6.0, by + 4.0, 8.0, if current_dest.is_none() { Color::WHITE } else { C_TEXT });
                bx += 52.0;
                for pg in self.pages.iter() {
                    if pg.id == self.editor.root.id { continue; }
                    if bx + 60.0 > self.win_w - 8.0 { bx = ix + 12.0; by += 22.0; }
                    let r = Rect::new(bx, by, bx + 56.0, by + 18.0);
                    let active = current_dest.as_deref() == Some(pg.id.as_str());
                    if active { fill_rect(&mut ui, r, PALETTE[3]); } else { stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0); }
                    let name = if pg.id.len() > 7 { &pg.id[..7] } else { &pg.id };
                    label(&mut ui, name, bx + 4.0, by + 4.0, 7.5, if active { Color::WHITE } else { C_TEXT });
                    bx += 62.0;
                }
            }
            // ---- constraints (Figma Design tab) ----
            if self.inspector_tab == 0 {
                let cy = TOP_H + 210.0 + 96.0;
                label(&mut ui, "CONSTRAINTS", ix + 12.0, cy, 10.0, C_DIM);
                let hpins = ["L", "R", "CH", "SH", "SC"];
                let vpins = ["T", "B", "CV", "SV", "SC"];
                let (cur_h, cur_v) = n.pin;
                let hi = match cur_h { arco_native::HPin::Left => 0, arco_native::HPin::Right => 1, arco_native::HPin::CenterH => 2, arco_native::HPin::StretchH => 3, arco_native::HPin::ScaleH => 4 };
                let vi = match cur_v { arco_native::VPin::Top => 0, arco_native::VPin::Bottom => 1, arco_native::VPin::CenterV => 2, arco_native::VPin::StretchV => 3, arco_native::VPin::ScaleV => 4 };
                for (i, lbl) in hpins.iter().enumerate() {
                    let x = ix + 12.0 + i as f64 * 34.0;
                    let r = Rect::new(x, cy + 14.0, x + 30.0, cy + 30.0);
                    if i == hi { fill_rect(&mut ui, r, C_ACCENT); } else { stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0); }
                    label(&mut ui, lbl, x + 5.0, cy + 17.0, 7.5, if i == hi { Color::WHITE } else { C_TEXT });
                }
                for (i, lbl) in vpins.iter().enumerate() {
                    let x = ix + 12.0 + i as f64 * 34.0;
                    let r = Rect::new(x, cy + 34.0, x + 30.0, cy + 50.0);
                    if i == vi { fill_rect(&mut ui, r, C_ACCENT); } else { stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0); }
                    label(&mut ui, lbl, x + 5.0, cy + 37.0, 7.5, if i == vi { Color::WHITE } else { C_TEXT });
                }
            }
            // ---- auto layout section (frames only, Design tab) ----
            let is_frame = matches!(n.kind, arco_native::NodeKind::Frame { .. });
            if is_frame && self.inspector_tab == 0 {
                let id = n.id.clone();
                let layout = self.editor.auto_layout_of(&id);
                let ly = TOP_H + 210.0;
                label(&mut ui, "LAYOUT", ix + 12.0, ly, 10.0, C_DIM);
                // NONE / H / V buttons
                let opts = ["NONE", "H", "V"];
                let active = match &layout {
                    None => 0usize,
                    Some(l) if l.direction == LayoutDirection::Horizontal => 1,
                    Some(_) => 2,
                };
                for (i, o) in opts.iter().enumerate() {
                    let bx = ix + 12.0 + i as f64 * 52.0;
                    let r = Rect::new(bx, ly + 16.0, bx + 46.0, ly + 34.0);
                    if i == active { fill_rect(&mut ui, r, C_ACCENT); } else { stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0); }
                    label(&mut ui, o, bx + 8.0, ly + 20.0, 9.0, if i == active { Color::WHITE } else { C_TEXT });
                }
                if let Some(l) = &layout {
                    // GAP and PAD steppers
                    for (row, (name, val)) in [("GAP", l.gap), ("PAD", l.padding)].iter().enumerate() {
                        let ry = ly + 44.0 + row as f64 * 22.0;
                        label(&mut ui, &format!("{name}: {val:.0}"), ix + 12.0, ry, 9.5, C_TEXT);
                        let bm = Rect::new(ix + 140.0, ry - 3.0, ix + 158.0, ry + 12.0);
                        let bp = Rect::new(ix + 162.0, ry - 3.0, ix + 180.0, ry + 12.0);
                        stroke_rect(&mut ui, bm, C_PANEL_EDGE, 1.0);
                        stroke_rect(&mut ui, bp, C_PANEL_EDGE, 1.0);
                        label(&mut ui, "-", ix + 146.0, ry - 1.0, 10.0, C_TEXT);
                        label(&mut ui, "+", ix + 166.0, ry - 1.0, 10.0, C_TEXT);
                    }
                }
            }
        } else if self.tool == Tool::Frame {
            // Figma: frame presets in the right panel when Frame tool active
            label(&mut ui, "FRAME PRESETS", ix + 12.0, TOP_H + 30.0, 10.0, C_DIM);
            for (i, (name, _, _)) in FRAME_PRESETS.iter().enumerate() {
                let y = TOP_H + 50.0 + i as f64 * 24.0;
                let r = Rect::new(ix + 12.0, y, ix + INSPECTOR_W - 24.0, y + 19.0);
                stroke_rect(&mut ui, r, C_PANEL_EDGE, 1.0);
                label(&mut ui, name, ix + 18.0, y + 4.0, 8.5, C_TEXT);
            }
        } else if self.editor.selection.len() > 1 {
            label(&mut ui, &format!("{} LAYERS SELECTED", self.editor.selection.len()), ix + 12.0, TOP_H + 34.0, 9.5, C_TEXT);
            label(&mut ui, "USE THE ALIGN ROW OR", ix + 12.0, TOP_H + 52.0, 8.0, C_DIM);
            label(&mut ui, "CTRL+G TO GROUP", ix + 12.0, TOP_H + 64.0, 8.0, C_DIM);
        } else {
            // friendly empty state: quick-start card (better than a blank panel)
            let card = Rect::new(ix + 10.0, TOP_H + 30.0, self.win_w - 10.0, TOP_H + 168.0);
            fill_rrect(&mut ui, card, 8.0, Color::rgba8(0x2a, 0x2c, 0x33, 200));
            label(&mut ui, "GET STARTED", card.x0 + 10.0, card.y0 + 8.0, 9.5, C_TEXT);
            for (i, line) in [
                "R  DRAW A RECTANGLE",
                "T  ADD TEXT",
                "F  PHONE/DESKTOP FRAME",
                "CTRL+P  PLAY PROTOTYPE",
                "?  ALL SHORTCUTS",
            ].iter().enumerate() {
                label(&mut ui, line, card.x0 + 10.0, card.y0 + 30.0 + i as f64 * 20.0, 8.0, C_DIM);
            }
        }

        // ---------- floating bottom toolbar: icons + tooltips ----------
        {
            let bar = self.bottom_bar_rect();
            fill_rrect(&mut ui, Rect::new(bar.x0 + 2.0, bar.y0 + 3.0, bar.x1 + 2.0, bar.y1 + 3.0), 9.0, Color::rgba8(0, 0, 0, 90)); // soft shadow
            fill_rrect(&mut ui, bar, 9.0, Color::rgba8(0x2a, 0x2c, 0x33, 250));
            let mut hovered: Option<(Tool, f64)> = None;
            for (i, t) in Tool::ALL.iter().enumerate() {
                let x = bar.x0 + 8.0 + i as f64 * 38.0;
                let r = Rect::new(x, bar.y0 + 5.0, x + 32.0, bar.y1 - 5.0);
                let hover = r.contains(self.cursor);
                if *t == self.tool { fill_rrect(&mut ui, r, 6.0, C_ACCENT); }
                else if hover { fill_rrect(&mut ui, r, 6.0, C_HOVERBG); }
                let icon_c = if *t == self.tool { Color::WHITE } else if hover { C_TEXT } else { C_DIM };
                draw_tool_icon(&mut ui, *t, x + 16.0, (bar.y0 + bar.y1) / 2.0, icon_c);
                if hover { hovered = Some((*t, x + 16.0)); }
            }
            // tooltip above the bar: "RECTANGLE  R"
            if let Some((t, cx)) = hovered {
                let text = format!("{}  {}", t.name(), t.label());
                let tw = arco_native::text::measure(&text, 8.5);
                let tip = Rect::new(cx - tw / 2.0 - 8.0, bar.y0 - 26.0, cx + tw / 2.0 + 8.0, bar.y0 - 6.0);
                fill_rrect(&mut ui, tip, 5.0, Color::rgba8(0x0e, 0x0f, 0x12, 240));
                label(&mut ui, &text, tip.x0 + 8.0, tip.y0 + 6.0, 8.5, C_TEXT);
            }
            // "?" help chip at the right end of the bar
            let hr = Rect::new(bar.x1 + 8.0, bar.y0 + 5.0, bar.x1 + 36.0, bar.y1 - 5.0);
            fill_rrect(&mut ui, hr, 6.0, if self.help_open { C_ACCENT } else { Color::rgba8(0x2a, 0x2c, 0x33, 250) });
            label(&mut ui, "?", hr.x0 + 10.0, hr.y0 + 8.0, 11.0, if self.help_open { Color::WHITE } else { C_DIM });
        }

        // ---------- rulers (Figma Shift+R) ----------
        if self.rulers {
            let c = self.canvas_rect();
            fill_rect(&mut ui, Rect::new(c.x0, c.y0, c.x1, c.y0 + 16.0), Color::rgba8(0x1a, 0x1a, 0x1a, 240));
            fill_rect(&mut ui, Rect::new(c.x0, c.y0, c.x0 + 16.0, c.y1), Color::rgba8(0x1a, 0x1a, 0x1a, 240));
            // ticks every 100 page units
            let step = 100.0 * self.zoom;
            if step > 20.0 {
                let (ox, oy) = self.canvas_origin();
                let start_x = ((c.x0 - ox - self.pan.0) / step).floor() as i64;
                let end_x = ((c.x1 - ox - self.pan.0) / step).ceil() as i64;
                for i in start_x..=end_x {
                    let sx = ox + self.pan.0 + i as f64 * step;
                    if sx < c.x0 + 16.0 || sx > c.x1 { continue; }
                    ui.stroke(&vello::kurbo::Stroke::new(1.0), Affine::IDENTITY, C_DIM, None,
                        &vello::kurbo::Line::new((sx, c.y0 + 10.0), (sx, c.y0 + 16.0)));
                    label(&mut ui, &format!("{}", i * 100), sx + 2.0, c.y0 + 2.0, 6.0, C_DIM);
                }
                let start_y = ((c.y0 - oy - self.pan.1) / step).floor() as i64;
                let end_y = ((c.y1 - oy - self.pan.1) / step).ceil() as i64;
                for i in start_y..=end_y {
                    let sy = oy + self.pan.1 + i as f64 * step;
                    if sy < c.y0 + 16.0 || sy > c.y1 { continue; }
                    ui.stroke(&vello::kurbo::Stroke::new(1.0), Affine::IDENTITY, C_DIM, None,
                        &vello::kurbo::Line::new((c.x0 + 10.0, sy), (c.x0 + 16.0, sy)));
                    label(&mut ui, &format!("{}", i * 100), c.x0 + 2.0, sy + 2.0, 6.0, C_DIM);
                }
            }
        }

        // ---------- "?" shortcuts overlay ----------
        if self.help_open {
            let c = self.canvas_rect();
            let panel = Rect::new(c.x0 + 120.0, c.y0 + 60.0, c.x1 - 120.0, c.y1 - 100.0);
            fill_rect(&mut ui, c, Color::rgba8(0, 0, 0, 120));
            fill_rrect(&mut ui, panel, 12.0, Color::rgba8(0x24, 0x26, 0x2b, 250));
            stroke_rect(&mut ui, panel, C_PANEL_EDGE, 1.0);
            label(&mut ui, "KEYBOARD SHORTCUTS", panel.x0 + 20.0, panel.y0 + 14.0, 12.0, C_TEXT);
            let cols = [
                ["V MOVE", "H HAND / SPACE", "K SCALE", "F FRAME", "R RECT", "O ELLIPSE", "L LINE", "P POLYGON", "S STAR", "T TEXT"],
                ["CTRL+Z UNDO", "CTRL+SHIFT+Z REDO", "CTRL+D DUPLICATE", "ALT+DRAG COPY", "CTRL+G GROUP", "CTRL+SHIFT+G UNGROUP", "CTRL+A SELECT ALL", "DEL DELETE", "ESC PARENT/CLOSE", "ARROWS NUDGE (SHIFT=10)"],
                ["CTRL+S SAVE", "CTRL+O OPEN", "CTRL+E EXPORT SVG", "CTRL+K COMPONENT", "CTRL+P PRESENT", "CTRL+0 ZOOM 100%", "CTRL+1 ZOOM FIT", "SHIFT+R RULERS", "CTRL+Y OUTLINE", "CTRL+. HIDE UI"],
            ];
            for (ci, col) in cols.iter().enumerate() {
                let cx = panel.x0 + 20.0 + ci as f64 * ((panel.width() - 40.0) / 3.0);
                for (ri, item) in col.iter().enumerate() {
                    label(&mut ui, item, cx, panel.y0 + 44.0 + ri as f64 * 22.0, 8.0, if ri % 2 == 0 { C_TEXT } else { C_DIM });
                }
            }
            label(&mut ui, "PRESS ? OR ESC TO CLOSE", panel.x0 + 20.0, panel.y1 - 24.0, 8.0, C_DIM);
        }

        // ---------- minimap (Sketch) ----------
        {
            let mm = self.minimap_rect();
            fill_rrect(&mut ui, Rect::new(mm.x0 + 2.0, mm.y0 + 2.0, mm.x1 + 2.0, mm.y1 + 2.0), 8.0, Color::rgba8(0, 0, 0, 80));
            fill_rrect(&mut ui, mm, 8.0, Color::rgba8(0x24, 0x26, 0x2b, 235));
            stroke_rect(&mut ui, mm, C_PANEL_EDGE, 1.0);
            let page = &self.editor.root;
            let s = (mm.width() / page.w.max(1.0)).min(mm.height() / page.h.max(1.0));
            // page outline
            stroke_rect(&mut ui, Rect::new(mm.x0, mm.y0, mm.x0 + page.w * s, mm.y0 + page.h * s), C_DIM, 1.0);
            // top-level children as blocks
            for c in &page.children {
                if !c.visible { continue; }
                let r = Rect::new(
                    mm.x0 + c.transform.x * s, mm.y0 + c.transform.y * s,
                    mm.x0 + (c.transform.x + c.w) * s, mm.y0 + (c.transform.y + c.h) * s,
                );
                let col = match &c.fill { Paint::Solid(col) if col.a > 0 => *col, _ => C_DIM };
                fill_rect(&mut ui, r, col.with_alpha_factor(0.9));
            }
            // viewport rectangle
            let c = self.canvas_rect();
            let (ox, oy) = self.canvas_origin();
            let vx0 = (c.x0 - ox - self.pan.0) / self.zoom;
            let vy0 = (c.y0 - oy - self.pan.1) / self.zoom;
            let vx1 = (c.x1 - ox - self.pan.0) / self.zoom;
            let vy1 = (c.y1 - oy - self.pan.1) / self.zoom;
            let vr = Rect::new(
                (mm.x0 + vx0 * s).max(mm.x0), (mm.y0 + vy0 * s).max(mm.y0),
                (mm.x0 + vx1 * s).min(mm.x1), (mm.y0 + vy1 * s).min(mm.y1),
            );
            if vr.x1 > vr.x0 && vr.y1 > vr.y0 { stroke_rect(&mut ui, vr, C_ACCENT, 1.2); }
        }

        ui
    }
}

// ------------------------------------------------------------ small helpers

fn fill_rrect(s: &mut Scene, r: Rect, radius: f64, c: Color) {
    s.fill(Fill::NonZero, Affine::IDENTITY, c, None, &vello::kurbo::RoundedRect::from_rect(r, radius).into_path(0.1));
}

/// Vector tool icons drawn at (cx, cy), ~16px box. Real glyphs, not letters.
fn draw_tool_icon(s: &mut Scene, tool: Tool, cx: f64, cy: f64, c: Color) {
    use vello::kurbo::{BezPath, Circle as KCircle, Line as KLine};
    let st = vello::kurbo::Stroke::new(1.6).with_caps(vello::kurbo::Cap::Round).with_join(vello::kurbo::Join::Round);
    let t = Affine::translate((cx - 8.0, cy - 8.0)); // local 0..16 box
    match tool {
        Tool::Select => {
            let mut p = BezPath::new();
            p.move_to((4.0, 1.0)); p.line_to((4.0, 13.0)); p.line_to((7.2, 10.2));
            p.line_to((9.4, 15.0)); p.line_to((11.4, 14.1)); p.line_to((9.2, 9.4));
            p.line_to((13.0, 9.0)); p.close_path();
            s.fill(Fill::NonZero, t, c, None, &p);
        }
        Tool::Hand => {
            for (x, y0) in [(5.0, 3.0), (8.0, 2.0), (11.0, 3.0)] {
                s.stroke(&st, t, c, None, &KLine::new((x, y0), (x, 8.0)));
            }
            let mut palm = BezPath::new();
            palm.move_to((3.5, 8.0)); palm.line_to((12.5, 8.0)); palm.line_to((12.0, 13.0));
            palm.line_to((5.5, 13.5)); palm.line_to((3.0, 10.0)); palm.close_path();
            s.fill(Fill::NonZero, t, c, None, &palm);
        }
        Tool::Scale => {
            s.stroke(&st, t, c, None, &Rect::new(2.0, 6.0, 10.0, 14.0).into_path(0.1));
            s.stroke(&st, t, c, None, &KLine::new((7.0, 9.0), (14.0, 2.0)));
            s.stroke(&st, t, c, None, &KLine::new((10.0, 2.0), (14.0, 2.0)));
            s.stroke(&st, t, c, None, &KLine::new((14.0, 2.0), (14.0, 6.0)));
        }
        Tool::Frame => {
            s.stroke(&st, t, c, None, &KLine::new((5.0, 1.0), (5.0, 15.0)));
            s.stroke(&st, t, c, None, &KLine::new((11.0, 1.0), (11.0, 15.0)));
            s.stroke(&st, t, c, None, &KLine::new((1.0, 5.0), (15.0, 5.0)));
            s.stroke(&st, t, c, None, &KLine::new((1.0, 11.0), (15.0, 11.0)));
        }
        Tool::Rectangle => { s.stroke(&st, t, c, None, &Rect::new(2.0, 3.0, 14.0, 13.0).into_path(0.1)); }
        Tool::Ellipse => { s.stroke(&st, t, c, None, &KCircle::new((8.0, 8.0), 6.0)); }
        Tool::Line => { s.stroke(&st, t, c, None, &KLine::new((2.0, 14.0), (14.0, 2.0))); }
        Tool::Polygon => {
            let mut p = BezPath::new();
            for (i, cmd) in regular_polygon(6, 14.0, 14.0).iter().enumerate() {
                match cmd {
                    arco_native::PathCmd::MoveTo(x, y) => p.move_to((*x + 1.0, *y + 1.0)),
                    arco_native::PathCmd::LineTo(x, y) => p.line_to((*x + 1.0, *y + 1.0)),
                    arco_native::PathCmd::Close => p.close_path(),
                    _ => { let _ = i; }
                }
            }
            s.stroke(&st, t, c, None, &p);
        }
        Tool::Star => {
            let mut p = BezPath::new();
            for cmd in star_path(5, 15.0, 15.0) {
                match cmd {
                    arco_native::PathCmd::MoveTo(x, y) => p.move_to((x + 0.5, y + 0.5)),
                    arco_native::PathCmd::LineTo(x, y) => p.line_to((x + 0.5, y + 0.5)),
                    arco_native::PathCmd::Close => p.close_path(),
                    _ => {}
                }
            }
            s.fill(Fill::NonZero, t, c, None, &p);
        }
        Tool::Text => {
            s.stroke(&st, t, c, None, &KLine::new((3.0, 3.0), (13.0, 3.0)));
            s.stroke(&st, t, c, None, &KLine::new((8.0, 3.0), (8.0, 14.0)));
        }
    }
}

fn fill_rect(s: &mut Scene, r: Rect, c: Color) {
    s.fill(Fill::NonZero, Affine::IDENTITY, c, None, &r.into_path(0.1));
}
fn stroke_rect(s: &mut Scene, r: Rect, c: Color, w: f64) {
    s.stroke(&vello::kurbo::Stroke::new(w), Affine::IDENTITY, c, None, &r.into_path(0.1));
}
fn label(s: &mut Scene, text: &str, x: f64, y: f64, size: f64, c: Color) {
    let _ = measure(text, size);
    encode_text(s, text, Affine::translate((x, y)), size, c);
}

fn world_transform_of(root: &Node, id: &str) -> Option<(Affine, f64, f64)> {
    fn walk(node: &Node, parent: Affine, id: &str) -> Option<(Affine, f64, f64)> {
        let world = parent * node.transform.matrix(node.w, node.h);
        if node.id == id { return Some((world, node.w, node.h)); }
        node.children.iter().find_map(|c| walk(c, world, id))
    }
    walk(root, Affine::IDENTITY, id)
}

/// Regular n-gon inscribed in (w,h), point-up.
fn regular_polygon(sides: usize, w: f64, h: f64) -> Vec<arco_native::PathCmd> {
    use arco_native::PathCmd::*;
    let (rx, ry, cx, cy) = (w / 2.0, h / 2.0, w / 2.0, h / 2.0);
    let mut out = vec![];
    for i in 0..sides {
        let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::TAU / sides as f64;
        let (x, y) = (cx + rx * a.cos(), cy + ry * a.sin());
        out.push(if i == 0 { MoveTo(x, y) } else { LineTo(x, y) });
    }
    out.push(Close);
    out
}

/// n-point star inscribed in (w,h), point-up, inner radius 40%.
fn star_path(points: usize, w: f64, h: f64) -> Vec<arco_native::PathCmd> {
    use arco_native::PathCmd::*;
    let (rx, ry, cx, cy) = (w / 2.0, h / 2.0, w / 2.0, h / 2.0);
    let mut out = vec![];
    for i in 0..(points * 2) {
        let a = -std::f64::consts::FRAC_PI_2 + i as f64 * std::f64::consts::PI / points as f64;
        let (fx, fy) = if i % 2 == 0 { (1.0, 1.0) } else { (0.4, 0.4) };
        let (x, y) = (cx + rx * fx * a.cos(), cy + ry * fy * a.sin());
        out.push(if i == 0 { MoveTo(x, y) } else { LineTo(x, y) });
    }
    out.push(Close);
    out
}

fn quad_bounds(world: Affine, w: f64, h: f64) -> Rect {
    let pts = [world * Point::new(0.0, 0.0), world * Point::new(w, 0.0), world * Point::new(w, h), world * Point::new(0.0, h)];
    let xs = pts.iter().map(|p| p.x);
    let ys = pts.iter().map(|p| p.y);
    Rect::new(
        xs.clone().fold(f64::INFINITY, f64::min),
        ys.clone().fold(f64::INFINITY, f64::min),
        xs.fold(f64::NEG_INFINITY, f64::max),
        ys.fold(f64::NEG_INFINITY, f64::max),
    )
}

fn demo_document() -> Document {
    let mut vars = Variables::default();
    vars.numbers.insert("gap-lg".into(), 28.0);
    let page = Node::frame("page-1", 1600.0, 1000.0)
        .auto_layout(AutoLayout {
            direction: LayoutDirection::Horizontal, gap: 24.0, padding: 40.0,
            align: CrossAlign::Center, gap_var: Some("gap-lg".into()), ..Default::default()
        })
        .child(Node::rect("card", 0.0, 0.0, 260.0, 160.0, C_ACCENT).radius(18.0).rotate(PI / 10.0)
            .effect(Effect::DropShadow { dx: 5.0, dy: 7.0, blur: 12.0, color: Color::BLACK }))
        .child(Node::rect("grad", 0.0, 0.0, 220.0, 130.0, Color::WHITE).radius(12.0).fill_paint(Paint::LinearGradient {
            start: (0.0, 0.0), end: (220.0, 0.0),
            stops: vec![(0.0, Color::rgb8(0xff, 0x5a, 0x00)), (1.0, Color::rgb8(0x8e, 0x2d, 0xe2))],
        }))
        .child(Node::ellipse("dot", 0.0, 0.0, 130.0, 130.0, PALETTE[1]).opacity(0.8))
        .child(Node::text("title", 0.0, 0.0, 320.0, 34.0, "X NATIVE"));
    let mut doc = Document::new();
    doc.variables = vars.clone();
    let mut p = page;
    arco_native::apply_layout_recursive(&mut p, &vars);
    doc.pages.push(p);
    doc
}

fn main() { pollster::block_on(run()); }

async fn run() {
    let doc = if std::path::Path::new(DOC_PATH).exists() {
        load_x_file(DOC_PATH).unwrap_or_else(|_| demo_document())
    } else { demo_document() };
    let vars = doc.variables.clone();
    let pages = if doc.pages.is_empty() { vec![Node::frame("page-1", 1600.0, 1000.0)] } else { doc.pages };
    let root = pages[0].clone();

    let mut app = App {
        editor: Editor::new(root), vars, tool: Tool::Select,
        pan: (60.0, 40.0), zoom: 0.6,
        cursor: Point::ZERO, drag: Drag::None, shift: false, ctrl: false,
        alt: false, alt_dupe_done: false,
        status: "ready".into(), created_count: 0,
        win_w: 1280.0, win_h: 800.0, layer_rows: vec![],
        focus: Focus::None,
        last_click: std::time::Instant::now(),
        last_click_pos: Point::ZERO,
        pages, page_idx: 0,
        present: None,
        guides: vec![],
        stamping: None,
        hover: None,
        layers_scroll: 0,
        chrome_hidden: false,
        help_open: false,
        inspector_tab: 0,
        rulers: false,
        user_guides: vec![],
        outline_view: false,
        space_pan: false,
        layer_filter: String::new(),
        assets: arco_native::Assets::new(),
    };
    // Phase 4.2: load any PNGs sitting next to the app as named assets;
    // an Image node with asset "logo" renders assets/logo.png if present.
    if let Ok(entries) = std::fs::read_dir("assets") {
        for e in entries.flatten() {
            let path = e.path();
            if path.extension().is_some_and(|x| x == "png") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    let _ = app.assets.load_png(stem, path.to_str().unwrap_or_default());
                }
            }
        }
        if !app.assets.is_empty() { app.status = format!("loaded {} image asset(s)", app.assets.len()); }
    }
    app.rebuild_layer_rows();

    let event_loop = EventLoop::new().expect("create event loop (needs a display)");
    let window = Arc::new(
        WindowBuilder::new().with_title("X Native Beta").with_inner_size(PhysicalSize::new(1280, 800))
            .build(&event_loop).expect("create window"),
    );

    let instance = wgpu::Instance::default();
    let surface = instance.create_surface(window.clone()).expect("create surface");
    let adapter = instance.request_adapter(&wgpu::RequestAdapterOptions {
        power_preference: wgpu::PowerPreference::HighPerformance,
        compatible_surface: Some(&surface), force_fallback_adapter: false,
    }).await.expect("no adapter");
    let (device, queue) = adapter.request_device(&wgpu::DeviceDescriptor {
        label: None, required_features: wgpu::Features::empty(), required_limits: wgpu::Limits::default(),
    }, None).await.expect("no device");

    let size = window.inner_size();
    let caps = surface.get_capabilities(&adapter);
    let format = caps.formats.iter().copied()
        .find(|f| matches!(f, wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm))
        .unwrap_or(caps.formats[0]);
    let mut config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::STORAGE_BINDING,
        format, width: size.width.max(1), height: size.height.max(1),
        present_mode: wgpu::PresentMode::AutoVsync, desired_maximum_frame_latency: 2,
        alpha_mode: wgpu::CompositeAlphaMode::Auto, view_formats: vec![],
    };
    surface.configure(&device, &config);

    let mut renderer = Renderer::new(&device, RendererOptions {
        surface_format: Some(config.format), use_cpu: false,
        antialiasing_support: vello::AaSupport::all(),
        num_init_threads: std::num::NonZeroUsize::new(1),
    }).expect("create vello renderer");

    event_loop.run(move |event, elwt| {
        if let Event::WindowEvent { event, .. } = event {
            match event {
                WindowEvent::CloseRequested => elwt.exit(),
                WindowEvent::Resized(new_size) => {
                    config.width = new_size.width.max(1);
                    config.height = new_size.height.max(1);
                    app.win_w = config.width as f64;
                    app.win_h = config.height as f64;
                    surface.configure(&device, &config);
                    window.request_redraw();
                }
                WindowEvent::ModifiersChanged(m) => {
                    app.shift = m.state().shift_key();
                    app.ctrl = m.state().control_key() || m.state().super_key();
                    app.alt = m.state().alt_key();
                }
                WindowEvent::CursorMoved { position, .. } => {
                    app.mouse_move(Point::new(position.x, position.y));
                    if app.drag != Drag::None { window.request_redraw(); }
                }
                WindowEvent::MouseInput { state, button: MouseButton::Left, .. } => {
                    match state {
                        ElementState::Pressed => app.mouse_down(app.cursor),
                        ElementState::Released => app.mouse_up(app.cursor),
                    }
                    window.request_redraw();
                }
                WindowEvent::MouseWheel { delta, .. } => {
                    let (dx, dy) = match delta {
                        MouseScrollDelta::LineDelta(x, y) => (x as f64 * 30.0, y as f64 * 30.0),
                        MouseScrollDelta::PixelDelta(p) => (p.x, p.y),
                    };
                    // wheel over layers panel scrolls the tree instead of the canvas
                    if app.cursor.x < LAYERS_W && app.cursor.y > TOP_H {
                        if dy < 0.0 { app.layers_scroll = app.layers_scroll.saturating_add(2); }
                        else if dy > 0.0 { app.layers_scroll = app.layers_scroll.saturating_sub(2); }
                    } else if app.ctrl {
                        let factor = (1.0 + dy / 300.0).clamp(0.5, 2.0);
                        let before = app.world_point(app.cursor);
                        app.zoom = (app.zoom * factor).clamp(0.05, 16.0);
                        let after = app.world_point(app.cursor);
                        app.pan.0 += (after.x - before.x) * app.zoom;
                        app.pan.1 += (after.y - before.y) * app.zoom;
                    } else {
                        app.pan.0 += dx;
                        app.pan.1 += dy;
                    }
                    window.request_redraw();
                }
                WindowEvent::KeyboardInput { event: kev, .. } => {
                    if kev.state == ElementState::Released {
                        if let Key::Named(NamedKey::Space) = &kev.logical_key { app.space_pan = false; }
                    }
                    if kev.state == ElementState::Pressed {
                        // text/field editing captures keystrokes first
                        if app.focus != Focus::None {
                            match &kev.logical_key {
                                Key::Named(NamedKey::Enter) => app.commit_focus(),
                                Key::Named(NamedKey::Escape) => {
                                    if app.focus == Focus::LayerSearch { app.layer_filter.clear(); }
                                    app.cancel_focus();
                                }
                                Key::Named(NamedKey::Backspace) => {
                                    match &mut app.focus {
                                        Focus::TextNode { buffer, .. } | Focus::Field { buffer, .. } => { buffer.pop(); }
                                        Focus::LayerSearch => { app.layer_filter.pop(); }
                                        Focus::None => {}
                                    }
                                }
                                Key::Named(NamedKey::Space) => {
                                    if let Focus::TextNode { buffer, .. } = &mut app.focus { buffer.push(' '); }
                                }
                                Key::Character(c) => {
                                    match &mut app.focus {
                                        Focus::TextNode { buffer, .. } => buffer.push_str(c.as_str()),
                                        Focus::Field { buffer, .. } => {
                                            for ch in c.chars() {
                                                if ch.is_ascii_digit() || ch == '-' || ch == '.' { buffer.push(ch); }
                                            }
                                        }
                                        Focus::LayerSearch => app.layer_filter.push_str(c.as_str()),
                                        Focus::None => {}
                                    }
                                }
                                _ => {}
                            }
                            // live-preview text edits directly on the node
                            if let Focus::TextNode { id, buffer, .. } = &app.focus {
                                let id = id.clone(); let buf = buffer.clone();
                                if let Some(n) = arco_native::editor::find_mut(&mut app.editor.root, &id) {
                                    if let arco_native::NodeKind::Text { text } = &mut n.kind { *text = buf; }
                                }
                            }
                            window.request_redraw();
                            return;
                        }
                        let nudge = if app.shift { 10.0 } else { 1.0 };
                        if let Key::Named(NamedKey::Space) = &kev.logical_key {
                            app.space_pan = true;
                            window.request_redraw();
                            return;
                        }
                        match &kev.logical_key {
                            Key::Named(NamedKey::Delete) | Key::Named(NamedKey::Backspace) => { app.editor.delete_selection(); app.status = "deleted".into(); }
                            Key::Named(NamedKey::ArrowLeft) => app.editor.move_selection(-nudge, 0.0),
                            Key::Named(NamedKey::ArrowRight) => app.editor.move_selection(nudge, 0.0),
                            Key::Named(NamedKey::ArrowUp) => app.editor.move_selection(0.0, -nudge),
                            Key::Named(NamedKey::ArrowDown) => app.editor.move_selection(0.0, nudge),
                            Key::Named(NamedKey::Escape) => {
                                if app.help_open { app.help_open = false; }
                                else if app.present.is_some() { app.present = None; app.status = "exited presentation".into(); }
                                else if let Some(id) = app.editor.selection.first().cloned() {
                                    // Figma: Esc selects the parent; at top level it deselects
                                    let root_id = app.editor.root.id.clone();
                                    let parent = arco_native::editor::top_level_ancestor(&app.editor.root, &id);
                                    match parent {
                                        Some(pid) if pid != id => { app.editor.selection = vec![pid]; app.status = "selected parent".into(); }
                                        _ => { app.editor.selection.clear(); app.tool = Tool::Select; }
                                    }
                                    let _ = root_id;
                                }
                                else { app.editor.selection.clear(); app.tool = Tool::Select; }
                            }
                            Key::Character(c) => {
                                let ch = c.as_str();
                                if app.ctrl {
                                    // NB: with Shift held, winit reports the
                                    // UPPERCASE char ("Z"), so normalize.
                                    let lower = ch.to_ascii_lowercase();
                                    match lower.as_str() {
                                        "z" => { if app.shift { app.editor.redo(); } else { app.editor.undo(); } app.status = "undo/redo".into(); }
                                        "d" => { app.editor.duplicate_selection((16.0, 16.0)); app.status = "duplicated".into(); }
                                        "s" => {
                                            app.pages[app.page_idx] = app.editor.root.clone();
                                            let mut d = Document::new();
                                            d.variables = app.vars.clone();
                                            d.pages = app.pages.clone();
                                            app.status = if save_x_file(&d, DOC_PATH).is_ok() { format!("saved {DOC_PATH} ({} pages)", d.pages.len()) } else { "save FAILED".into() };
                                        }
                                        "o" => {
                                            if let Ok(d) = load_x_file(DOC_PATH) {
                                                if !d.pages.is_empty() {
                                                    app.pages = d.pages;
                                                    app.page_idx = 0;
                                                    app.editor = Editor::new(app.pages[0].clone());
                                                    app.vars = d.variables;
                                                    app.status = format!("loaded {DOC_PATH} ({} pages)", app.pages.len());
                                                }
                                            }
                                        }
                                        "e" => {
                                            let svg = export_svg(&app.editor.root, &app.vars);
                                            app.status = if std::fs::write(SVG_PATH, svg).is_ok() { format!("exported {SVG_PATH}") } else { "export FAILED".into() };
                                        }
                                        "p" => app.enter_present(),
                                        "." => { app.chrome_hidden = !app.chrome_hidden; app.status = if app.chrome_hidden { "UI hidden".into() } else { "UI shown".into() }; }
                                        "y" => { app.outline_view = !app.outline_view; app.status = if app.outline_view { "outline view".into() } else { "normal view".into() }; }
                                        ";" => { app.user_guides.clear(); app.status = "guides cleared".into(); }
                                        "0" => { app.zoom = 1.0; app.status = "zoom 100%".into(); }
                                        "1" => {
                                            // zoom-to-fit the page in the canvas area
                                            let cw = app.win_w - TOOLBAR_W - LAYERS_W - INSPECTOR_W - 40.0;
                                            let chh = app.win_h - TOP_H - 40.0;
                                            let pw = app.editor.root.w.max(1.0);
                                            let ph = app.editor.root.h.max(1.0);
                                            app.zoom = (cw / pw).min(chh / ph).clamp(0.02, 4.0);
                                            app.pan = (20.0, 20.0);
                                            app.status = format!("zoom to fit ({:.0}%)", app.zoom * 100.0);
                                        }
                                        "g" => {
                                            if app.shift {
                                                if let Some(id) = app.editor.selection.first().cloned() {
                                                    if app.editor.ungroup(&id) { app.status = "ungrouped".into(); }
                                                }
                                            } else if app.editor.selection.len() >= 2 {
                                                let gid = format!("group-{}", app.editor.undo_depth());
                                                app.editor.group_selection(&gid);
                                                app.status = format!("grouped -> {gid}");
                                            }
                                        }
                                        "a" => { app.editor.select_all(); app.status = format!("{} selected", app.editor.selection.len()); }
                                        "k" => {
                                            let n = app.editor.selection.len();
                                            let name = format!("Component{}", app.editor.component_names().len() + 1);
                                            if app.editor.make_component(&name) {
                                                app.status = format!("created component {name} from {n} node(s)");
                                            } else {
                                                app.status = "select sibling nodes first (Ctrl+K)".into();
                                            }
                                        }
                                        "]" => { if let Some(id) = app.editor.selection.first().cloned() { app.editor.bring_to_front(&id); app.status = "to front".into(); } }
                                        "[" => { if let Some(id) = app.editor.selection.first().cloned() { app.editor.send_to_back(&id); app.status = "to back".into(); } }
                                        _ => {}
                                    }
                                } else {
                                    match ch.to_ascii_lowercase().as_str() {
                                        "?" | "/" => { app.help_open = !app.help_open; }
                                        "v" => app.tool = Tool::Select,
                                        "h" => app.tool = Tool::Hand,
                                        "k" => app.tool = Tool::Scale,
                                        "f" => app.tool = Tool::Frame,
                                        "r" => {
                                            if app.shift { app.rulers = !app.rulers; app.status = if app.rulers { "rulers on (click ruler to add guide)".into() } else { "rulers off".into() }; }
                                            else { app.tool = Tool::Rectangle; }
                                        }
                                        "o" => app.tool = Tool::Ellipse,
                                        "l" => app.tool = Tool::Line,
                                        "p" => app.tool = Tool::Polygon,
                                        "s" => app.tool = Tool::Star,
                                        "t" => app.tool = Tool::Text,
                                        _ => {}
                                    }
                                    if !app.shift { app.status = format!("tool: {:?}", app.tool); }
                                }
                            }
                            _ => {}
                        }
                        window.request_redraw();
                    }
                }
                WindowEvent::RedrawRequested => {
                    let scene = app.build_display_scene();
                    let frame = match surface.get_current_texture() {
                        Ok(f) => f,
                        Err(_) => { surface.configure(&device, &config); return; }
                    };
                    let _ = renderer.render_to_surface(&device, &queue, &scene, &frame, &RenderParams {
                        base_color: if app.present.is_some() { Color::BLACK } else { C_CANVAS },
                        width: config.width, height: config.height,
                        antialiasing_method: AaConfig::Msaa16,
                    });
                    frame.present();
                    // keep animating while a presentation transition runs
                    if app.present.as_ref().is_some_and(|p| p.transition.is_some()) {
                        window.request_redraw();
                    }
                }
                _ => {}
            }
        }
    }).expect("event loop");
}
