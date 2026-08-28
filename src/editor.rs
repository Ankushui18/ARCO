//! Phase 2 / 8 / 9 / 10 slices: the headless editing engine.
//!
//! Everything here is UI-independent on purpose: a winit window (Phase 1)
//! will translate mouse/keyboard events into these operations. That means
//! all of it is testable right now, in this sandbox, without a display.
//!
//! - hit testing (transform-aware, z-order-aware, lock/visibility-aware)
//! - Editor: selection + command-based mutations with full undo/redo
//! - move / resize / rotate / set-fill / reorder(z) / group / delete
//! - align & distribute
//! - snapping (grid + other-object edges)
//! - constraints solver (pins: left/right/center/stretch/scale)
//! - Phase 8: prototype Player (navigate/back state machine)
//! - Phase 9: SpatialGrid index for O(~1) point queries at 100K nodes
//! - Phase 10: named version checkpoints + dev-mode CSS export

use crate::{bounds, HPin, Node, NodeKind, Paint, VPin, Variables};
use vello::kurbo::{Affine, Point, Rect};
use vello::peniko::Color;

// -------------------------------------------------------------- hit testing

/// Topmost hittable node id at `point` (world coords). Children are on top
/// of parents; later siblings are on top of earlier ones (paint order).
/// Locked / hidden nodes (and their subtrees, if hidden) are skipped.
pub fn hit_test(root: &Node, point: Point) -> Option<String> {
    fn walk(node: &Node, parent: Affine, point: Point, out: &mut Option<String>) {
        if !node.visible { return; }
        let world = parent * node.transform.matrix(node.w, node.h);
        // children first? No — paint order is parent, then children in order,
        // so later hits simply overwrite `out`.
        if !node.locked {
            let local = world.inverse() * point;
            let inside = match node.kind {
                NodeKind::Ellipse => {
                    let (rx, ry) = (node.w / 2.0, node.h / 2.0);
                    let (dx, dy) = ((local.x - rx) / rx, (local.y - ry) / ry);
                    dx * dx + dy * dy <= 1.0
                }
                // Frames/groups are containers: hit only through children.
                NodeKind::Frame { .. } | NodeKind::Group | NodeKind::Component { .. } => false,
                _ => local.x >= 0.0 && local.y >= 0.0 && local.x <= node.w && local.y <= node.h,
            };
            if inside { *out = Some(node.id.clone()); }
        }
        for child in &node.children { walk(child, world, point, out); }
    }
    let mut out = None;
    walk(root, Affine::IDENTITY, point, &mut out);
    out
}

/// All node ids whose world AABB intersects `rect` (marquee select).
pub fn hit_test_rect(root: &Node, rect: Rect) -> Vec<String> {
    fn walk(node: &Node, parent: Affine, rect: Rect, out: &mut Vec<String>) {
        if !node.visible { return; }
        let world = parent * node.transform.matrix(node.w, node.h);
        if !node.locked && !matches!(node.kind, NodeKind::Frame { .. } | NodeKind::Group | NodeKind::Component { .. }) {
            let b = bounds(world, node.w, node.h);
            if b.x0 < rect.x1 && b.x1 > rect.x0 && b.y0 < rect.y1 && b.y1 > rect.y0 {
                out.push(node.id.clone());
            }
        }
        for child in &node.children { walk(child, world, rect, out); }
    }
    let mut out = vec![];
    walk(root, Affine::IDENTITY, rect, &mut out);
    out
}

/// Figma's selection model: a plain click selects the TOP-LEVEL object
/// (direct child of the page) that contains the hit; only deep-select
/// (Ctrl/Cmd+click) or double-click drills into nested children.
/// Maps a (deep) hit id to its top-level ancestor's id.
pub fn top_level_ancestor(root: &Node, id: &str) -> Option<String> {
    for child in &root.children {
        if child.id == id || find(child, id).is_some() {
            return Some(child.id.clone());
        }
    }
    None
}

// ------------------------------------------------------------ tree plumbing

pub fn find<'a>(node: &'a Node, id: &str) -> Option<&'a Node> {
    if node.id == id { return Some(node); }
    node.children.iter().find_map(|c| find(c, id))
}
pub fn find_mut<'a>(node: &'a mut Node, id: &str) -> Option<&'a mut Node> {
    if node.id == id { return Some(node); }
    node.children.iter_mut().find_map(|c| find_mut(c, id))
}
fn find_parent_mut<'a>(node: &'a mut Node, id: &str) -> Option<&'a mut Node> {
    if node.children.iter().any(|c| c.id == id) { return Some(node); }
    node.children.iter_mut().find_map(|c| find_parent_mut(c, id))
}

// ----------------------------------------------------------------- commands

/// Phase 2.4: every mutation is a Command; undo/redo replays inverses.
/// Command-log architecture (not snapshots) — the roadmap's decision point,
/// resolved: logs stay cheap at 100K-node documents.
#[derive(Debug, Clone)]
pub enum Command {
    Move { id: String, dx: f64, dy: f64 },
    Resize { id: String, from: (f64, f64), to: (f64, f64) },
    Rotate { id: String, from: f64, to: f64 },
    SetFill { id: String, from: Paint, to: Paint },
    SetText { id: String, from: String, to: String },
    SetOpacity { id: String, from: f32, to: f32 },
    /// Generic whole-node swap: used where a mutation has wide side effects
    /// (e.g. auto-layout repositioning every child). Clean inverse by swap.
    ReplaceNode { id: String, before: Box<Node>, after: Box<Node> },
    SetPrototype { id: String, from: Option<crate::PrototypeAction>, to: Option<crate::PrototypeAction> },
    Reorder { id: String, from: usize, to: usize },
    Delete { parent_id: String, index: usize, node: Node },
    Insert { parent_id: String, index: usize, node: Node },
    Group { parent_id: String, indices: Vec<usize>, group_id: String },
}

fn apply(root: &mut Node, cmd: &Command) -> bool {
    match cmd {
        Command::Move { id, dx, dy } => {
            if let Some(n) = find_mut(root, id) { n.transform.x += dx; n.transform.y += dy; n.dirty = true; true } else { false }
        }
        Command::Resize { id, to, .. } => {
            if let Some(n) = find_mut(root, id) { n.w = to.0.max(1.0); n.h = to.1.max(1.0); n.dirty = true; true } else { false }
        }
        Command::Rotate { id, to, .. } => {
            if let Some(n) = find_mut(root, id) { n.transform.rotation = *to; n.dirty = true; true } else { false }
        }
        Command::SetFill { id, to, .. } => {
            if let Some(n) = find_mut(root, id) { n.fill = to.clone(); n.dirty = true; true } else { false }
        }
        Command::SetText { id, to, .. } => {
            if let Some(n) = find_mut(root, id) {
                if let NodeKind::Text { text } = &mut n.kind { *text = to.clone(); n.dirty = true; return true; }
            }
            false
        }
        Command::SetOpacity { id, to, .. } => {
            if let Some(n) = find_mut(root, id) { n.opacity = to.clamp(0.0, 1.0); n.dirty = true; true } else { false }
        }
        Command::ReplaceNode { id, after, .. } => {
            if let Some(n) = find_mut(root, id) { *n = (**after).clone(); n.dirty = true; true } else { false }
        }
        Command::SetPrototype { id, to, .. } => {
            if let Some(n) = find_mut(root, id) { n.prototype = to.clone(); n.dirty = true; true } else { false }
        }
        Command::Reorder { id, to, .. } => {
            if let Some(p) = find_parent_mut(root, id) {
                if let Some(from) = p.children.iter().position(|c| &c.id == id) {
                    let to = (*to).min(p.children.len() - 1);
                    let n = p.children.remove(from);
                    p.children.insert(to, n);
                    return true;
                }
            }
            false
        }
        Command::Delete { parent_id, index, .. } => {
            if let Some(p) = find_mut(root, parent_id) {
                if *index < p.children.len() { p.children.remove(*index); return true; }
            }
            false
        }
        Command::Insert { parent_id, index, node } => {
            if let Some(p) = find_mut(root, parent_id) {
                p.children.insert((*index).min(p.children.len()), node.clone());
                return true;
            }
            false
        }
        Command::Group { parent_id, indices, group_id } => {
            if let Some(p) = find_mut(root, parent_id) {
                let mut taken: Vec<Node> = vec![];
                let mut sorted = indices.clone();
                sorted.sort_unstable();
                for &i in sorted.iter().rev() {
                    if i < p.children.len() { taken.insert(0, p.children.remove(i)); }
                }
                if taken.is_empty() { return false; }
                // Group frame wraps the members' collective AABB.
                let x0 = taken.iter().map(|n| n.transform.x).fold(f64::INFINITY, f64::min);
                let y0 = taken.iter().map(|n| n.transform.y).fold(f64::INFINITY, f64::min);
                let x1 = taken.iter().map(|n| n.transform.x + n.w).fold(f64::NEG_INFINITY, f64::max);
                let y1 = taken.iter().map(|n| n.transform.y + n.h).fold(f64::NEG_INFINITY, f64::max);
                let mut g = Node::group(group_id, x1 - x0, y1 - y0);
                g.transform.x = x0; g.transform.y = y0;
                for mut m in taken { m.transform.x -= x0; m.transform.y -= y0; g.children.push(m); }
                p.children.insert(sorted[0], g);
                return true;
            }
            false
        }
    }
}

fn invert(cmd: &Command) -> Command {
    match cmd {
        Command::Move { id, dx, dy } => Command::Move { id: id.clone(), dx: -dx, dy: -dy },
        Command::Resize { id, from, to } => Command::Resize { id: id.clone(), from: *to, to: *from },
        Command::Rotate { id, from, to } => Command::Rotate { id: id.clone(), from: *to, to: *from },
        Command::SetFill { id, from, to } => Command::SetFill { id: id.clone(), from: to.clone(), to: from.clone() },
        Command::SetText { id, from, to } => Command::SetText { id: id.clone(), from: to.clone(), to: from.clone() },
        Command::SetOpacity { id, from, to } => Command::SetOpacity { id: id.clone(), from: *to, to: *from },
        Command::ReplaceNode { id, before, after } => Command::ReplaceNode { id: id.clone(), before: after.clone(), after: before.clone() },
        Command::SetPrototype { id, from, to } => Command::SetPrototype { id: id.clone(), from: to.clone(), to: from.clone() },
        Command::Reorder { id, from, to } => Command::Reorder { id: id.clone(), from: *to, to: *from },
        Command::Delete { parent_id, index, node } => Command::Insert { parent_id: parent_id.clone(), index: *index, node: node.clone() },
        Command::Insert { parent_id, index, node } => Command::Delete { parent_id: parent_id.clone(), index: *index, node: node.clone() },
        // Group inversion = restore snapshot via history (handled by Editor
        // keeping a pre-group Delete/Insert pair); simplest correct inverse:
        Command::Group { .. } => unreachable!("Group is inverted via Ungroup in Editor"),
    }
}

// ------------------------------------------------------------------- editor

/// Phase 2: selection + undoable document mutations + Phase 10 checkpoints.
pub struct Editor {
    pub root: Node,
    pub selection: Vec<String>,
    undo_stack: Vec<Vec<Command>>,
    redo_stack: Vec<Vec<Command>>,
    /// Group/Ungroup are structural; store whole-tree snapshots for them.
    snapshots: Vec<(usize, Node)>,
    /// Phase 10.2: named version checkpoints.
    pub checkpoints: Vec<(String, Node)>,
    /// Phase 2.7: internal clipboard (copied subtrees).
    clipboard: Vec<Node>,
}

/// Give a subtree fresh ids via `rename`; only the subtree ROOT's new id is
/// recorded into `out` (that's what selection/paste callers care about).
fn remap_ids(node: &mut Node, rename: &mut impl FnMut(&str) -> String, out: &mut Vec<String>) {
    node.id = rename(&node.id);
    out.push(node.id.clone());
    fn walk(n: &mut Node, rename: &mut impl FnMut(&str) -> String) {
        for c in &mut n.children {
            c.id = rename(&c.id);
            walk(c, rename);
        }
    }
    walk(node, rename);
}

impl Editor {
    pub fn new(root: Node) -> Self {
        Self { root, selection: vec![], undo_stack: vec![], redo_stack: vec![], snapshots: vec![], checkpoints: vec![], clipboard: vec![] }
    }

    // -- selection ---------------------------------------------------------
    /// Figma-style click: plain click selects the top-level object under the
    /// cursor; `deep` (Ctrl+click in Figma) selects the exact nested node;
    /// `shift` toggles membership.
    pub fn click_figma(&mut self, p: Point, shift: bool, deep: bool) {
        let hit = hit_test(&self.root, p);
        let target = match hit {
            Some(id) if !deep => top_level_ancestor(&self.root, &id).unwrap_or(id),
            Some(id) => id,
            None => { if !shift { self.selection.clear(); } return; }
        };
        if shift {
            if let Some(i) = self.selection.iter().position(|s| s == &target) { self.selection.remove(i); }
            else { self.selection.push(target); }
        } else {
            self.selection = vec![target];
        }
    }

    /// Figma double-click: drill one level deeper from the current
    /// selection toward the deep hit. Returns the newly selected id.
    pub fn drill_into(&mut self, p: Point) -> Option<String> {
        let deep = hit_test(&self.root, p)?;
        // path from root to deep node
        fn path_to(node: &Node, id: &str, path: &mut Vec<String>) -> bool {
            if node.id == id { return true; }
            for c in &node.children {
                path.push(c.id.clone());
                if path_to(c, id, path) { return true; }
                path.pop();
            }
            false
        }
        let mut path = vec![];
        path_to(&self.root, &deep, &mut path);
        // current selection position along the path -> next one deeper
        let cur = self.selection.first();
        let idx = cur.and_then(|c| path.iter().position(|p| p == c));
        let next = match idx {
            Some(i) if i + 1 < path.len() => path[i + 1].clone(),
            Some(_) => deep,
            None => path.first().cloned().unwrap_or(deep),
        };
        self.selection = vec![next.clone()];
        Some(next)
    }

    pub fn click(&mut self, p: Point, shift: bool) {
        match hit_test(&self.root, p) {
            Some(id) => {
                if shift {
                    if let Some(i) = self.selection.iter().position(|s| s == &id) { self.selection.remove(i); }
                    else { self.selection.push(id); }
                } else {
                    self.selection = vec![id];
                }
            }
            None => if !shift { self.selection.clear(); },
        }
    }
    pub fn marquee(&mut self, rect: Rect) { self.selection = hit_test_rect(&self.root, rect); }

    // -- undoable ops ------------------------------------------------------
    fn push(&mut self, cmds: Vec<Command>) {
        let applied: Vec<Command> = cmds.into_iter().filter(|c| apply(&mut self.root, c)).collect();
        if !applied.is_empty() {
            self.undo_stack.push(applied);
            self.redo_stack.clear();
        }
    }

    pub fn move_selection(&mut self, dx: f64, dy: f64) {
        let cmds = self.selection.iter().map(|id| Command::Move { id: id.clone(), dx, dy }).collect();
        self.push(cmds);
    }
    pub fn resize(&mut self, id: &str, w: f64, h: f64) {
        if let Some(n) = find(&self.root, id) {
            let cmd = Command::Resize { id: id.into(), from: (n.w, n.h), to: (w, h) };
            self.push(vec![cmd]);
        }
    }
    pub fn rotate(&mut self, id: &str, angle: f64) {
        if let Some(n) = find(&self.root, id) {
            let cmd = Command::Rotate { id: id.into(), from: n.transform.rotation, to: angle };
            self.push(vec![cmd]);
        }
    }
    pub fn set_fill(&mut self, id: &str, paint: Paint) {
        if let Some(n) = find(&self.root, id) {
            let cmd = Command::SetFill { id: id.into(), from: n.fill.clone(), to: paint };
            self.push(vec![cmd]);
        }
    }
    pub fn set_text(&mut self, id: &str, text: &str) {
        if let Some(n) = find(&self.root, id) {
            if let NodeKind::Text { text: old } = &n.kind {
                let cmd = Command::SetText { id: id.into(), from: old.clone(), to: text.into() };
                self.push(vec![cmd]);
            }
        }
    }
    /// Set (or clear, with None) a frame's auto layout, re-solve child
    /// positions immediately, all as ONE undoable ReplaceNode command.
    pub fn set_auto_layout(&mut self, id: &str, layout: Option<crate::AutoLayout>, vars: &Variables) -> bool {
        let Some(n) = find(&self.root, id) else { return false };
        if !matches!(n.kind, NodeKind::Frame { .. }) { return false; }
        let before = Box::new(n.clone());
        let mut after = n.clone();
        after.kind = NodeKind::Frame { layout: layout.clone() };
        if layout.is_some() { crate::apply_auto_layout(&mut after, vars); }
        let cmd = Command::ReplaceNode { id: id.into(), before, after: Box::new(after) };
        self.push(vec![cmd]);
        true
    }

    /// Current auto layout of a frame, if any.
    pub fn auto_layout_of(&self, id: &str) -> Option<crate::AutoLayout> {
        match find(&self.root, id)?.kind {
            NodeKind::Frame { ref layout } => layout.clone(),
            _ => None,
        }
    }

    /// Phase 2.3 (Figma "Scale" tool): scale a node AND its whole subtree
    /// uniformly — sizes, child offsets, strokes, corner radii. One
    /// undoable ReplaceNode.
    pub fn scale_node(&mut self, id: &str, factor: f64) -> bool {
        if factor <= 0.0 { return false; }
        let Some(n) = find(&self.root, id) else { return false };
        let before = Box::new(n.clone());
        let mut after = n.clone();
        fn scale_subtree(n: &mut Node, f: f64, scale_own_pos: bool) {
            if scale_own_pos { n.transform.x *= f; n.transform.y *= f; }
            n.w *= f;
            n.h *= f;
            n.stroke.width *= f;
            if let NodeKind::Rect { radius } = &mut n.kind { *radius *= f; }
            if let Some(r) = &mut n.corner_radii { for v in r.iter_mut() { *v *= f; } }
            if let NodeKind::Vector { path } = &mut n.kind {
                for c in path.iter_mut() {
                    match c {
                        crate::PathCmd::MoveTo(x, y) | crate::PathCmd::LineTo(x, y) => { *x *= f; *y *= f; }
                        crate::PathCmd::CurveTo(x1, y1, x2, y2, x, y) => { *x1 *= f; *y1 *= f; *x2 *= f; *y2 *= f; *x *= f; *y *= f; }
                        crate::PathCmd::Close => {}
                    }
                }
            }
            for c in &mut n.children { scale_subtree(c, f, true); }
        }
        // the root of the scale keeps its own x/y (scales in place)
        scale_subtree(&mut after, factor, false);
        let cmd = Command::ReplaceNode { id: id.into(), before, after: Box::new(after) };
        self.push(vec![cmd]);
        true
    }

    /// Phase 8: set/clear a prototype link (click -> navigate to destination).
    pub fn set_prototype(&mut self, id: &str, action: Option<crate::PrototypeAction>) {
        if let Some(n) = find(&self.root, id) {
            let cmd = Command::SetPrototype { id: id.into(), from: n.prototype.clone(), to: action };
            self.push(vec![cmd]);
        }
    }

    pub fn set_opacity(&mut self, id: &str, v: f32) {
        if let Some(n) = find(&self.root, id) {
            let cmd = Command::SetOpacity { id: id.into(), from: n.opacity, to: v };
            self.push(vec![cmd]);
        }
    }
    pub fn delete_selection(&mut self) {
        let mut cmds = vec![];
        for id in self.selection.clone() {
            if let Some(p) = find_parent_mut(&mut self.root, &id) {
                if let Some(i) = p.children.iter().position(|c| c.id == id) {
                    cmds.push(Command::Delete { parent_id: p.id.clone(), index: i, node: p.children[i].clone() });
                }
            }
        }
        // Delete back-to-front so stored indices stay valid.
        cmds.sort_by(|a, b| match (a, b) {
            (Command::Delete { index: ia, .. }, Command::Delete { index: ib, .. }) => ib.cmp(ia),
            _ => std::cmp::Ordering::Equal,
        });
        self.push(cmds);
        self.selection.clear();
    }
    /// Phase 2.8: z-order. bring_to_front / send_to_back.
    pub fn bring_to_front(&mut self, id: &str) {
        if let Some(p) = find_parent_mut(&mut self.root, id) {
            let last = p.children.len() - 1;
            if let Some(from) = p.children.iter().position(|c| c.id == id) {
                if from != last { self.push(vec![Command::Reorder { id: id.into(), from, to: last }]); }
            }
        }
    }
    pub fn send_to_back(&mut self, id: &str) {
        if let Some(p) = find_parent_mut(&mut self.root, id) {
            if let Some(from) = p.children.iter().position(|c| c.id == id) {
                if from != 0 { self.push(vec![Command::Reorder { id: id.into(), from, to: 0 }]); }
            }
        }
    }
    /// Phase 2.9: group the current selection (snapshot-undo).
    pub fn group_selection(&mut self, group_id: &str) {
        if self.selection.len() < 2 { return; }
        let snapshot = self.root.clone();
        // find common parent of first selected node; require all share it.
        let first = self.selection[0].clone();
        let parent_id = match find_parent_mut(&mut self.root, &first) { Some(p) => p.id.clone(), None => return };
        let indices: Vec<usize> = {
            let p = find(&self.root, &parent_id).unwrap();
            self.selection.iter().filter_map(|id| p.children.iter().position(|c| &c.id == id)).collect()
        };
        if indices.len() != self.selection.len() { return; } // not siblings
        let cmd = Command::Group { parent_id, indices, group_id: group_id.into() };
        if apply(&mut self.root, &cmd) {
            self.snapshots.push((self.undo_stack.len(), snapshot));
            self.undo_stack.push(vec![cmd]);
            self.redo_stack.clear();
            self.selection = vec![group_id.to_string()];
        }
    }

    /// Figma Ctrl+Shift+G: dissolve a group/frame, re-parenting children to
    /// the grandparent at the group's spot with positions preserved.
    pub fn ungroup(&mut self, id: &str) -> bool {
        let Some(g) = find(&self.root, id) else { return false };
        if !matches!(g.kind, NodeKind::Group | NodeKind::Frame { .. }) { return false; }
        let snapshot = self.root.clone();
        let (gx, gy) = (g.transform.x, g.transform.y);
        let Some(parent) = find_parent_mut(&mut self.root, id) else { return false };
        let Some(pos) = parent.children.iter().position(|c| c.id == id) else { return false };
        let mut group = parent.children.remove(pos);
        let mut ids = vec![];
        for mut child in group.children.drain(..) {
            child.transform.x += gx;
            child.transform.y += gy;
            ids.push(child.id.clone());
            parent.children.insert(pos, child);
        }
        self.snapshots.push((self.undo_stack.len(), snapshot));
        self.undo_stack.push(vec![Command::Group { parent_id: String::new(), indices: vec![], group_id: id.into() }]);
        self.redo_stack.clear();
        self.selection = ids;
        true
    }

    /// Figma Ctrl+A: select all top-level children of the page (or of the
    /// selected frame if one frame is selected).
    pub fn select_all(&mut self) {
        let scope = if self.selection.len() == 1 {
            find(&self.root, &self.selection[0])
                .filter(|n| matches!(n.kind, NodeKind::Frame { .. } | NodeKind::Group) && !n.children.is_empty())
        } else { None };
        let source = scope.unwrap_or(&self.root);
        self.selection = source.children.iter().filter(|c| c.visible && !c.locked).map(|c| c.id.clone()).collect();
    }

    /// Undoable constraint-pin change (Figma constraints panel).
    pub fn set_pin(&mut self, id: &str, h: crate::HPin, v: crate::VPin) {
        if let Some(n) = find(&self.root, id) {
            let before = Box::new(n.clone());
            let mut after = n.clone();
            after.pin = (h, v);
            self.push(vec![Command::ReplaceNode { id: id.into(), before, after: Box::new(after) }]);
        }
    }

    pub fn undo(&mut self) -> bool {
        let Some(cmds) = self.undo_stack.pop() else { return false };
        // Structural command? restore the snapshot taken before it.
        if matches!(cmds.first(), Some(Command::Group { .. })) {
            if let Some(pos) = self.snapshots.iter().rposition(|(depth, _)| *depth == self.undo_stack.len()) {
                let (_, snap) = self.snapshots.remove(pos);
                let redo_state = self.root.clone();
                self.root = snap;
                self.redo_stack.push(cmds);
                self.snapshots.push((usize::MAX, redo_state)); // stash for redo
                return true;
            }
        }
        for cmd in cmds.iter().rev() { apply(&mut self.root, &invert(cmd)); }
        self.redo_stack.push(cmds);
        true
    }
    pub fn redo(&mut self) -> bool {
        let Some(cmds) = self.redo_stack.pop() else { return false };
        if matches!(cmds.first(), Some(Command::Group { .. })) {
            if let Some(pos) = self.snapshots.iter().rposition(|(d, _)| *d == usize::MAX) {
                let (_, state) = self.snapshots.remove(pos);
                self.snapshots.push((self.undo_stack.len(), self.root.clone()));
                self.root = state;
                self.undo_stack.push(cmds);
                return true;
            }
        }
        for cmd in &cmds { apply(&mut self.root, cmd); }
        self.undo_stack.push(cmds);
        true
    }

    /// Merge the last `n` undo entries into a single undo step. UI drags
    /// call move/resize once per mouse event (each pushing an entry);
    /// on mouse-up they merge the whole gesture so one Ctrl+Z reverts it.
    pub fn merge_last(&mut self, n: usize) {
        if n <= 1 || self.undo_stack.len() < n { return; }
        let at = self.undo_stack.len() - n;
        let mut merged = vec![];
        for group in self.undo_stack.drain(at..) { merged.extend(group); }
        self.undo_stack.push(merged);
    }
    /// Number of undo entries (lets the UI count a gesture's commands).
    pub fn undo_depth(&self) -> usize { self.undo_stack.len() }

    /// Insert a new node under `parent_id` (undoable). Returns success.
    pub fn insert_node(&mut self, parent_id: &str, node: Node) -> bool {
        let Some(p) = find(&self.root, parent_id) else { return false };
        let cmd = Command::Insert { parent_id: parent_id.into(), index: p.children.len(), node };
        let depth = self.undo_stack.len();
        self.push(vec![cmd]);
        self.undo_stack.len() > depth
    }

    /// Phase 5.2: turn the current selection into a Component definition.
    /// The selected nodes become children of a hidden master (placed at the
    /// document root), and the selection is replaced in-place by an Instance
    /// of it — same flow as Figma's "create component". One undo step
    /// (snapshot-based, like group).
    pub fn make_component(&mut self, name: &str) -> bool {
        if self.selection.is_empty() { return false; }
        let snapshot = self.root.clone();
        let first = self.selection[0].clone();
        let Some(parent_id) = find_parent_mut(&mut self.root, &first).map(|p| p.id.clone()) else { return false };
        // all selected must be siblings under the same parent
        let indices: Vec<usize> = {
            let p = find(&self.root, &parent_id).unwrap();
            self.selection.iter().filter_map(|id| p.children.iter().position(|c| &c.id == id)).collect()
        };
        if indices.len() != self.selection.len() { return false; }

        let p = find_mut(&mut self.root, &parent_id).unwrap();
        let mut sorted = indices.clone();
        sorted.sort_unstable();
        let mut members: Vec<Node> = vec![];
        for &i in sorted.iter().rev() { members.insert(0, p.children.remove(i)); }
        // collective bounds -> master size; members re-based to (0,0)
        let x0 = members.iter().map(|n| n.transform.x).fold(f64::INFINITY, f64::min);
        let y0 = members.iter().map(|n| n.transform.y).fold(f64::INFINITY, f64::min);
        let x1 = members.iter().map(|n| n.transform.x + n.w).fold(f64::NEG_INFINITY, f64::max);
        let y1 = members.iter().map(|n| n.transform.y + n.h).fold(f64::NEG_INFINITY, f64::max);
        let (w, h) = (x1 - x0, y1 - y0);
        let mut master = Node::component(&format!("comp-{name}"), name, w, h);
        for mut m in members { m.transform.x -= x0; m.transform.y -= y0; master.children.push(m); }
        master.visible = false; // masters live hidden at the root
        let instance_id = format!("{name}-1");
        let instance = Node::instance(&instance_id, name, x0, y0, w, h);
        // instance replaces the members at their original spot
        let p = find_mut(&mut self.root, &parent_id).unwrap();
        p.children.insert(sorted[0], instance);
        self.root.children.push(master);

        self.snapshots.push((self.undo_stack.len(), snapshot));
        self.undo_stack.push(vec![Command::Group { parent_id, indices: sorted, group_id: instance_id.clone() }]); // snapshot-undo reuses Group's path
        self.redo_stack.clear();
        self.selection = vec![instance_id];
        true
    }

    /// Phase 5.2: stamp a new Instance of `component` at (x, y). Undoable.
    /// Returns the new instance id.
    pub fn place_instance(&mut self, component: &str, x: f64, y: f64) -> Option<String> {
        // find the master to copy its size
        fn find_master<'a>(n: &'a Node, name: &str) -> Option<&'a Node> {
            if let NodeKind::Component { name: c } = &n.kind { if c == name { return Some(n); } }
            n.children.iter().find_map(|c| find_master(c, name))
        }
        let (w, h) = { let m = find_master(&self.root, component)?; (m.w, m.h) };
        // unique id
        let mut i = 1usize;
        let id = loop {
            let cand = format!("{component}-{i}");
            if find(&self.root, &cand).is_none() { break cand; }
            i += 1;
        };
        let node = Node::instance(&id, component, x, y, w, h);
        let root_id = self.root.id.clone();
        if self.insert_node(&root_id, node) { Some(id) } else { None }
    }

    /// Names of all Component masters in the document.
    pub fn component_names(&self) -> Vec<String> {
        fn walk(n: &Node, out: &mut Vec<String>) {
            if let NodeKind::Component { name } = &n.kind { out.push(name.clone()); }
            for c in &n.children { walk(c, out); }
        }
        let mut v = vec![];
        walk(&self.root, &mut v);
        v
    }

    // -- Phase 2.7: copy / paste / duplicate --------------------------------
    /// Copy the current selection into the editor clipboard.
    pub fn copy(&mut self) {
        self.clipboard = self.selection.iter()
            .filter_map(|id| find(&self.root, id).cloned())
            .collect();
    }
    /// Paste clipboard contents into `parent_id` (undoable). Every pasted
    /// subtree gets fresh ids ("<old>-copy", "<old>-copy-2", ...) so ids stay
    /// unique — instance overrides keyed by INTERNAL component ids still
    /// work because those live inside component definitions, not the copy.
    pub fn paste(&mut self, parent_id: &str, offset: (f64, f64)) -> Vec<String> {
        // Collect every id already in the document once, then allocate
        // unique "-copy" ids against that set (no repeated tree scans).
        let mut taken = std::collections::HashSet::new();
        fn collect_ids(n: &Node, set: &mut std::collections::HashSet<String>) {
            set.insert(n.id.clone());
            for c in &n.children { collect_ids(c, set); }
        }
        collect_ids(&self.root, &mut taken);

        let mut new_root_ids = vec![];
        let mut cmds = vec![];
        for node in self.clipboard.clone() {
            let mut copy = node;
            let mut roots = vec![];
            remap_ids(&mut copy, &mut |old| {
                let mut candidate = format!("{old}-copy");
                let mut i = 1;
                while taken.contains(&candidate) {
                    i += 1;
                    candidate = format!("{old}-copy-{i}");
                }
                taken.insert(candidate.clone());
                candidate
            }, &mut roots);
            if let Some(rid) = roots.first() { new_root_ids.push(rid.clone()); }
            copy.transform.x += offset.0;
            copy.transform.y += offset.1;
            let index = find(&self.root, parent_id).map(|p| p.children.len()).unwrap_or(0);
            cmds.push(Command::Insert { parent_id: parent_id.into(), index, node: copy });
        }
        self.push(cmds);
        new_root_ids
    }
    /// Duplicate = copy + paste-in-place with a small offset, one call.
    pub fn duplicate_selection(&mut self, offset: (f64, f64)) -> Vec<String> {
        self.copy();
        let parent = self.selection.first()
            .and_then(|id| find_parent_mut(&mut self.root, id).map(|p| p.id.clone()))
            .unwrap_or_else(|| self.root.id.clone());
        let ids = self.paste(&parent, offset);
        self.selection = ids.clone();
        ids
    }

    // -- Phase 10.2: checkpoints -------------------------------------------
    pub fn checkpoint(&mut self, name: &str) { self.checkpoints.push((name.into(), self.root.clone())); }
    pub fn restore_checkpoint(&mut self, name: &str) -> bool {
        if let Some((_, snap)) = self.checkpoints.iter().find(|(n, _)| n == name) {
            self.root = snap.clone();
            self.undo_stack.clear();
            self.redo_stack.clear();
            true
        } else { false }
    }
}

// -------------------------------------------------------- align / distribute

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlignKind { Left, CenterH, Right, Top, CenterV, Bottom }

/// Phase 2.11: align sibling nodes (by their local x/y/w/h) to their
/// collective bounds. Operates on ids that share `parent`.
pub fn align(parent: &mut Node, ids: &[String], kind: AlignKind) {
    let sel: Vec<usize> = parent.children.iter().enumerate().filter(|(_, c)| ids.contains(&c.id)).map(|(i, _)| i).collect();
    if sel.len() < 2 { return; }
    let x0 = sel.iter().map(|&i| parent.children[i].transform.x).fold(f64::INFINITY, f64::min);
    let y0 = sel.iter().map(|&i| parent.children[i].transform.y).fold(f64::INFINITY, f64::min);
    let x1 = sel.iter().map(|&i| parent.children[i].transform.x + parent.children[i].w).fold(f64::NEG_INFINITY, f64::max);
    let y1 = sel.iter().map(|&i| parent.children[i].transform.y + parent.children[i].h).fold(f64::NEG_INFINITY, f64::max);
    for &i in &sel {
        let c = &mut parent.children[i];
        match kind {
            AlignKind::Left => c.transform.x = x0,
            AlignKind::Right => c.transform.x = x1 - c.w,
            AlignKind::CenterH => c.transform.x = (x0 + x1) / 2.0 - c.w / 2.0,
            AlignKind::Top => c.transform.y = y0,
            AlignKind::Bottom => c.transform.y = y1 - c.h,
            AlignKind::CenterV => c.transform.y = (y0 + y1) / 2.0 - c.h / 2.0,
        }
        c.dirty = true;
    }
}

/// Phase 2.11: equal spacing along an axis (Figma "tidy up").
pub fn distribute_horizontal(parent: &mut Node, ids: &[String]) {
    let mut sel: Vec<usize> = parent.children.iter().enumerate().filter(|(_, c)| ids.contains(&c.id)).map(|(i, _)| i).collect();
    if sel.len() < 3 { return; }
    sel.sort_by(|&a, &b| parent.children[a].transform.x.partial_cmp(&parent.children[b].transform.x).unwrap());
    let first = sel[0]; let last = *sel.last().unwrap();
    let span = (parent.children[last].transform.x + parent.children[last].w) - parent.children[first].transform.x;
    let total_w: f64 = sel.iter().map(|&i| parent.children[i].w).sum();
    let gap = (span - total_w) / (sel.len() as f64 - 1.0);
    let mut cursor = parent.children[first].transform.x;
    for &i in &sel {
        parent.children[i].transform.x = cursor;
        cursor += parent.children[i].w + gap;
        parent.children[i].dirty = true;
    }
}

// ----------------------------------------------------------------- snapping

/// Phase 2.10: snap a proposed position to the pixel grid and to other
/// nodes' edges/centers within `threshold`. Returns the snapped value and
/// (for smart guides) which other node id it snapped to, if any.
pub struct Snapper { pub grid: f64, pub threshold: f64 }
impl Default for Snapper { fn default() -> Self { Self { grid: 1.0, threshold: 6.0 } } }
impl Snapper {
    pub fn snap_x(&self, proposed: f64, moving_w: f64, others: &[(String, Rect)]) -> (f64, Option<String>) {
        // The moving object's left edge, center, and right edge can each
        // snap to any other object's left edge, center, or right edge.
        let candidates = [proposed, proposed + moving_w / 2.0, proposed + moving_w];
        let mut best: Option<(f64, f64, String)> = None; // (|delta|, corrected_x, id)
        for (id, r) in others {
            for edge in [r.x0, (r.x0 + r.x1) / 2.0, r.x1] {
                for (ci, c) in candidates.iter().enumerate() {
                    let d = edge - c;
                    if d.abs() <= self.threshold {
                        let corrected_x = match ci { 0 => edge, 1 => edge - moving_w / 2.0, _ => edge - moving_w };
                        if best.as_ref().map_or(true, |(bd, _, _)| d.abs() < *bd) {
                            best = Some((d.abs(), corrected_x, id.clone()));
                        }
                    }
                }
            }
        }
        match best {
            Some((_, x, id)) => (x, Some(id)),
            None => ((proposed / self.grid).round() * self.grid, None),
        }
    }
}

/// Phase 2.10: smart guides. Compare the moving node's world AABB against
/// every other visible node's; return guide lines (vertical?, coordinate)
/// wherever an edge or center matches within `tol`. The UI draws these as
/// the red alignment lines while dragging.
pub fn alignment_guides(root: &Node, moving_id: &str, tol: f64) -> Vec<(bool, f64)> {
    let Some((world, w, h)) = ({
        fn wt(node: &Node, parent: Affine, id: &str) -> Option<(Affine, f64, f64)> {
            let world = parent * node.transform.matrix(node.w, node.h);
            if node.id == id { return Some((world, node.w, node.h)); }
            node.children.iter().find_map(|c| wt(c, world, id))
        }
        wt(root, Affine::IDENTITY, moving_id)
    }) else { return vec![] };
    let mb = bounds(world, w, h);
    let m_xs = [mb.x0, (mb.x0 + mb.x1) / 2.0, mb.x1];
    let m_ys = [mb.y0, (mb.y0 + mb.y1) / 2.0, mb.y1];

    let mut guides = vec![];
    fn walk(node: &Node, parent: Affine, skip: &str, m_xs: &[f64; 3], m_ys: &[f64; 3], tol: f64, out: &mut Vec<(bool, f64)>) {
        if !node.visible { return; }
        let world = parent * node.transform.matrix(node.w, node.h);
        if node.id != skip && !matches!(node.kind, NodeKind::Frame { .. } | NodeKind::Group) {
            let b = bounds(world, node.w, node.h);
            for edge in [b.x0, (b.x0 + b.x1) / 2.0, b.x1] {
                if m_xs.iter().any(|x| (x - edge).abs() <= tol) { out.push((true, edge)); }
            }
            for edge in [b.y0, (b.y0 + b.y1) / 2.0, b.y1] {
                if m_ys.iter().any(|y| (y - edge).abs() <= tol) { out.push((false, edge)); }
            }
        }
        for c in &node.children { walk(c, world, skip, m_xs, m_ys, tol, out); }
    }
    walk(root, Affine::IDENTITY, moving_id, &m_xs, &m_ys, tol, &mut guides);
    guides.sort_by(|a, b| a.partial_cmp(b).unwrap());
    guides.dedup_by(|a, b| a.0 == b.0 && (a.1 - b.1).abs() < 0.5);
    guides
}

/// Figma-style magnetic snap during move: given the moving node's would-be
/// AABB, returns (dx, dy) corrections that snap edges/centers to other
/// nodes' edges/centers within `tol`. Zero when nothing is close.
pub fn snap_delta(root: &Node, moving_id: &str, tol: f64) -> (f64, f64) {
    let Some((world, w, h)) = ({
        fn wt(node: &Node, parent: Affine, id: &str) -> Option<(Affine, f64, f64)> {
            let world = parent * node.transform.matrix(node.w, node.h);
            if node.id == id { return Some((world, node.w, node.h)); }
            node.children.iter().find_map(|c| wt(c, world, id))
        }
        wt(root, Affine::IDENTITY, moving_id)
    }) else { return (0.0, 0.0) };
    let mb = bounds(world, w, h);
    let m_xs = [mb.x0, (mb.x0 + mb.x1) / 2.0, mb.x1];
    let m_ys = [mb.y0, (mb.y0 + mb.y1) / 2.0, mb.y1];
    let (mut best_dx, mut best_dy): (Option<f64>, Option<f64>) = (None, None);
    fn walk(node: &Node, parent: Affine, skip: &str, m_xs: &[f64; 3], m_ys: &[f64; 3], tol: f64, bx: &mut Option<f64>, by: &mut Option<f64>) {
        if !node.visible { return; }
        let world = parent * node.transform.matrix(node.w, node.h);
        if node.id != skip && !matches!(node.kind, NodeKind::Frame { .. } | NodeKind::Group) {
            let b = bounds(world, node.w, node.h);
            for edge in [b.x0, (b.x0 + b.x1) / 2.0, b.x1] {
                for m in m_xs {
                    let d = edge - m;
                    if d.abs() <= tol && bx.map_or(true, |cur| d.abs() < cur.abs()) { *bx = Some(d); }
                }
            }
            for edge in [b.y0, (b.y0 + b.y1) / 2.0, b.y1] {
                for m in m_ys {
                    let d = edge - m;
                    if d.abs() <= tol && by.map_or(true, |cur| d.abs() < cur.abs()) { *by = Some(d); }
                }
            }
        }
        for c in &node.children { walk(c, world, skip, m_xs, m_ys, tol, bx, by); }
    }
    walk(root, Affine::IDENTITY, moving_id, &m_xs, &m_ys, tol, &mut best_dx, &mut best_dy);
    (best_dx.unwrap_or(0.0), best_dy.unwrap_or(0.0))
}

// -------------------------------------------------------------- constraints

/// Phase 2.12: apply pin constraints to `frame`'s children after the frame
/// resizes from (old_w, old_h) to its current (w, h).
pub fn apply_constraints(frame: &mut Node, old_w: f64, old_h: f64) {
    let (dw, dh) = (frame.w - old_w, frame.h - old_h);
    let (sx, sy) = (if old_w > 0.0 { frame.w / old_w } else { 1.0 }, if old_h > 0.0 { frame.h / old_h } else { 1.0 });
    for c in &mut frame.children {
        match c.pin.0 {
            HPin::Left => {}
            HPin::Right => c.transform.x += dw,
            HPin::CenterH => c.transform.x += dw / 2.0,
            HPin::StretchH => c.w += dw,
            HPin::ScaleH => { c.transform.x *= sx; c.w *= sx; }
        }
        match c.pin.1 {
            VPin::Top => {}
            VPin::Bottom => c.transform.y += dh,
            VPin::CenterV => c.transform.y += dh / 2.0,
            VPin::StretchV => c.h += dh,
            VPin::ScaleV => { c.transform.y *= sy; c.h *= sy; }
        }
        c.dirty = true;
    }
}

// ------------------------------------------------------- prototype playback

/// Phase 8: minimal prototype player. Frames with `prototype` actions
/// navigate on "click"; Back pops the navigation stack. Transition metadata
/// (duration) is surfaced so a renderer can animate.
pub struct Player<'a> {
    pub doc: &'a Node,
    pub current: String,
    stack: Vec<String>,
}
impl<'a> Player<'a> {
    pub fn new(doc: &'a Node, start: &str) -> Self { Self { doc, current: start.into(), stack: vec![] } }
    /// Click at `point` inside the current top-level frame. If a node with a
    /// prototype action is hit, navigate. Returns transition ms if navigated.
    pub fn click(&mut self, point: Point) -> Option<u32> {
        let frame = find(self.doc, &self.current)?;
        let hit_id = hit_test(frame, point)?;
        // walk up from the hit node until a prototype action is found
        fn action_for<'b>(node: &'b Node, target: &str) -> Option<&'b crate::PrototypeAction> {
            if node.id == target { return node.prototype.as_ref(); }
            for c in &node.children {
                if let Some(a) = action_for(c, target) { return Some(a); }
                if find(c, target).is_some() { return c.prototype.as_ref().or_else(|| action_for(c, target)); }
            }
            None
        }
        let act = action_for(frame, &hit_id).or(frame.prototype.as_ref())?.clone();
        if find(self.doc, &act.destination).is_some() {
            self.stack.push(self.current.clone());
            self.current = act.destination;
            Some(act.transition_ms)
        } else { None }
    }
    pub fn back(&mut self) -> bool {
        if let Some(prev) = self.stack.pop() { self.current = prev; true } else { false }
    }
}

// ------------------------------------------------------------ smart animate

/// Phase 8.3: smart animate. Given two frames, nodes with MATCHING IDS are
/// interpolated (position, size, rotation, opacity, solid fill color) at
/// progress `t` in [0,1]; the result is a renderable in-between frame.
/// Nodes only present in `to` fade in; nodes only in `from` fade out —
/// the same matching rule comparable tools use.
pub fn smart_animate(from: &Node, to: &Node, t: f64) -> Node {
    let t = t.clamp(0.0, 1.0);
    let mut frame = to.clone();
    frame.id = format!("{}~{}@{t:.3}", from.id, to.id);

    fn collect<'n>(n: &'n Node, map: &mut std::collections::HashMap<String, &'n Node>) {
        map.insert(n.id.clone(), n);
        for c in &n.children { collect(c, map); }
    }
    let mut from_map = std::collections::HashMap::new();
    for c in &from.children { collect(c, &mut from_map); }

    fn lerp(a: f64, b: f64, t: f64) -> f64 { a + (b - a) * t }
    fn lerp_color(a: Color, b: Color, t: f64) -> Color {
        Color::rgba8(
            (a.r as f64 + (b.r as f64 - a.r as f64) * t).round() as u8,
            (a.g as f64 + (b.g as f64 - a.g as f64) * t).round() as u8,
            (a.b as f64 + (b.b as f64 - a.b as f64) * t).round() as u8,
            (a.a as f64 + (b.a as f64 - a.a as f64) * t).round() as u8,
        )
    }

    fn blend_tree(node: &mut Node, from_map: &std::collections::HashMap<String, &Node>, t: f64) {
        if let Some(src) = from_map.get(&node.id) {
            node.transform.x = lerp(src.transform.x, node.transform.x, t);
            node.transform.y = lerp(src.transform.y, node.transform.y, t);
            node.transform.rotation = lerp(src.transform.rotation, node.transform.rotation, t);
            node.w = lerp(src.w, node.w, t);
            node.h = lerp(src.h, node.h, t);
            node.opacity = lerp(src.opacity as f64, node.opacity as f64, t) as f32;
            if let (Paint::Solid(a), Paint::Solid(b)) = (&src.fill, &node.fill.clone()) {
                node.fill = Paint::Solid(lerp_color(*a, *b, t));
            }
        } else {
            // new in `to`: fade in
            node.opacity = (node.opacity as f64 * t) as f32;
        }
        for c in &mut node.children { blend_tree(c, from_map, t); }
    }
    for c in &mut frame.children { blend_tree(c, &from_map, t); }

    // nodes that existed in `from` but not in `to`: fade OUT (append ghosts)
    let mut to_ids = std::collections::HashSet::new();
    fn ids(n: &Node, set: &mut std::collections::HashSet<String>) {
        set.insert(n.id.clone());
        for c in &n.children { ids(c, set); }
    }
    for c in &to.children { ids(c, &mut to_ids); }
    for c in &from.children {
        if !to_ids.contains(&c.id) {
            let mut ghost = c.clone();
            ghost.opacity = (ghost.opacity as f64 * (1.0 - t)) as f32;
            frame.children.push(ghost);
        }
    }
    frame
}

// ------------------------------------------------------------ spatial index

/// Phase 9.1: uniform grid over world space. Rebuild is O(n); point queries
/// touch one cell. Good enough to keep hit testing flat at 100K nodes; an
/// R-tree can replace it behind the same two methods later.
pub struct SpatialGrid {
    cell: f64,
    cells: std::collections::HashMap<(i64, i64), Vec<usize>>,
    entries: Vec<(String, Rect)>,
}
impl SpatialGrid {
    pub fn build(root: &Node, cell: f64) -> Self {
        let mut grid = Self { cell, cells: Default::default(), entries: vec![] };
        fn walk(node: &Node, parent: Affine, grid: &mut SpatialGrid) {
            if !node.visible { return; }
            let world = parent * node.transform.matrix(node.w, node.h);
            if !matches!(node.kind, NodeKind::Frame { .. } | NodeKind::Group) {
                let b = bounds(world, node.w, node.h);
                let idx = grid.entries.len();
                grid.entries.push((node.id.clone(), b));
                let (cx0, cy0) = ((b.x0 / grid.cell).floor() as i64, (b.y0 / grid.cell).floor() as i64);
                let (cx1, cy1) = ((b.x1 / grid.cell).floor() as i64, (b.y1 / grid.cell).floor() as i64);
                for cx in cx0..=cx1 { for cy in cy0..=cy1 { grid.cells.entry((cx, cy)).or_default().push(idx); } }
            }
            for c in &node.children { walk(c, world, grid); }
        }
        walk(root, Affine::IDENTITY, &mut grid);
        grid
    }
    pub fn query_point(&self, p: Point) -> Vec<&str> {
        let key = ((p.x / self.cell).floor() as i64, (p.y / self.cell).floor() as i64);
        self.cells.get(&key).map(|v| {
            v.iter()
                .filter(|&&i| { let r = self.entries[i].1; p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1 })
                .map(|&i| self.entries[i].0.as_str())
                .collect()
        }).unwrap_or_default()
    }
    pub fn len(&self) -> usize { self.entries.len() }
    pub fn is_empty(&self) -> bool { self.entries.is_empty() }
}

// ------------------------------------------------------------------ dev mode

/// Phase 10.4: dev-mode export — CSS for a node (the inspect panel's copy).
pub fn node_to_css(node: &Node, vars: &Variables) -> String {
    let mut css = String::new();
    css.push_str(&format!(".{} {{\n", node.id.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")));
    css.push_str(&format!("  width: {}px;\n  height: {}px;\n", node.w, node.h));
    match &node.fill {
        Paint::Solid(c) if c.a > 0 => css.push_str(&format!("  background: {};\n", crate::color_to_hex(*c))),
        Paint::Variable(n) => css.push_str(&format!("  background: {}; /* var: {} */\n", crate::color_to_hex(vars.color(n, Color::BLACK)), n)),
        Paint::LinearGradient { stops, .. } => {
            let s: Vec<String> = stops.iter().map(|(t, c)| format!("{} {}%", crate::color_to_hex(*c), t * 100.0)).collect();
            css.push_str(&format!("  background: linear-gradient(90deg, {});\n", s.join(", ")));
        }
        _ => {}
    }
    if let NodeKind::Rect { radius } = node.kind {
        if let Some([tl, tr, br, bl]) = node.corner_radii {
            css.push_str(&format!("  border-radius: {tl}px {tr}px {br}px {bl}px;\n"));
        } else if radius > 0.0 {
            css.push_str(&format!("  border-radius: {radius}px;\n"));
        }
    }
    if node.opacity < 1.0 { css.push_str(&format!("  opacity: {};\n", node.opacity)); }
    if node.transform.rotation != 0.0 { css.push_str(&format!("  transform: rotate({:.1}deg);\n", node.transform.rotation.to_degrees())); }
    for e in &node.effects {
        if let crate::Effect::DropShadow { dx, dy, blur, color } = e {
            css.push_str(&format!("  box-shadow: {dx}px {dy}px {blur}px {};\n", crate::color_to_hex(*color)));
        }
    }
    css.push_str("}\n");
    css
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Color, Node};

    fn doc() -> Node {
        Node::frame("page", 800.0, 600.0)
            .child(Node::rect("a", 10.0, 10.0, 100.0, 50.0, Color::rgb8(255, 0, 0)))
            .child(Node::rect("b", 200.0, 10.0, 100.0, 50.0, Color::rgb8(0, 255, 0)))
            .child(Node::ellipse("c", 400.0, 10.0, 80.0, 80.0, Color::rgb8(0, 0, 255)))
    }

    #[test]
    fn hit_test_finds_topmost() {
        let d = Node::frame("page", 800.0, 600.0)
            .child(Node::rect("under", 0.0, 0.0, 100.0, 100.0, Color::WHITE))
            .child(Node::rect("over", 50.0, 50.0, 100.0, 100.0, Color::WHITE));
        assert_eq!(hit_test(&d, Point::new(75.0, 75.0)), Some("over".into()));
        assert_eq!(hit_test(&d, Point::new(25.0, 25.0)), Some("under".into()));
        assert_eq!(hit_test(&d, Point::new(500.0, 500.0)), None);
    }

    #[test]
    fn hit_test_respects_ellipse_shape_and_lock() {
        let mut d = doc();
        // corner of the ellipse's AABB is OUTSIDE the ellipse
        assert_eq!(hit_test(&d, Point::new(402.0, 12.0)), None);
        // center is inside
        assert_eq!(hit_test(&d, Point::new(440.0, 50.0)), Some("c".into()));
        find_mut(&mut d, "c").unwrap().locked = true;
        assert_eq!(hit_test(&d, Point::new(440.0, 50.0)), None);
    }

    #[test]
    fn hit_test_respects_rotation() {
        let d = Node::frame("page", 400.0, 400.0)
            .child(Node::rect("r", 100.0, 100.0, 100.0, 20.0, Color::WHITE).rotate(std::f64::consts::FRAC_PI_2));
        // rotated 90° about center (150,110): occupies x∈[140,160], y∈[60,160]
        assert_eq!(hit_test(&d, Point::new(150.0, 70.0)), Some("r".into()));
        assert_eq!(hit_test(&d, Point::new(105.0, 110.0)), None); // original spot now empty
    }

    #[test]
    fn marquee_selects_intersecting() {
        let mut e = Editor::new(doc());
        e.marquee(Rect::new(0.0, 0.0, 320.0, 100.0));
        assert_eq!(e.selection, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn move_undo_redo_roundtrip() {
        let mut e = Editor::new(doc());
        e.selection = vec!["a".into()];
        e.move_selection(30.0, 40.0);
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 40.0);
        assert!(e.undo());
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 10.0);
        assert!(e.redo());
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 40.0);
        assert!(!e.redo()); // stack empty
    }

    #[test]
    fn resize_rotate_fill_text_are_undoable() {
        let mut e = Editor::new(doc().child(Node::text("t", 0.0, 200.0, 100.0, 20.0, "OLD")));
        e.resize("a", 150.0, 75.0);
        e.rotate("a", 0.5);
        e.set_fill("a", Paint::Solid(Color::rgb8(1, 2, 3)));
        e.set_text("t", "NEW");
        assert_eq!(find(&e.root, "a").unwrap().w, 150.0);
        assert!(matches!(&find(&e.root, "t").unwrap().kind, NodeKind::Text{text} if text=="NEW"));
        e.undo(); e.undo(); e.undo(); e.undo();
        let a = find(&e.root, "a").unwrap();
        assert_eq!((a.w, a.transform.rotation), (100.0, 0.0));
        assert!(matches!(&a.fill, Paint::Solid(c) if c.r==255));
        assert!(matches!(&find(&e.root, "t").unwrap().kind, NodeKind::Text{text} if text=="OLD"));
    }

    #[test]
    fn delete_and_undo_restores_at_same_index() {
        let mut e = Editor::new(doc());
        e.selection = vec!["b".into()];
        e.delete_selection();
        assert!(find(&e.root, "b").is_none());
        e.undo();
        assert_eq!(e.root.children[1].id, "b"); // back at index 1, not appended
    }

    #[test]
    fn z_order_ops() {
        let mut e = Editor::new(doc());
        e.bring_to_front("a");
        assert_eq!(e.root.children.last().unwrap().id, "a");
        e.send_to_back("a");
        assert_eq!(e.root.children[0].id, "a");
        e.undo(); // back to front
        assert_eq!(e.root.children.last().unwrap().id, "a");
    }

    #[test]
    fn group_and_undo() {
        let mut e = Editor::new(doc());
        e.selection = vec!["a".into(), "b".into()];
        e.group_selection("g1");
        let g = find(&e.root, "g1").expect("group exists");
        assert_eq!(g.children.len(), 2);
        assert_eq!(g.transform.x, 10.0); // group wraps collective bounds
        assert_eq!(g.children[0].transform.x, 0.0); // members re-based
        assert!(e.undo());
        assert!(find(&e.root, "g1").is_none());
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 10.0);
    }

    #[test]
    fn align_and_distribute() {
        let mut d = doc();
        let ids = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        align(&mut d, &ids, AlignKind::Top);
        assert!(d.children.iter().all(|c| c.transform.y == 10.0));
        // spread them out then distribute
        d.children[0].transform.x = 0.0;
        d.children[1].transform.x = 50.0;
        d.children[2].transform.x = 400.0;
        distribute_horizontal(&mut d, &ids);
        let xs: Vec<f64> = d.children.iter().map(|c| c.transform.x).collect();
        let gap1 = xs[1] - (xs[0] + d.children[0].w);
        let gap2 = xs[2] - (xs[1] + d.children[1].w);
        assert!((gap1 - gap2).abs() < 1e-9);
    }

    #[test]
    fn snapping_to_edges_and_grid() {
        let s = Snapper { grid: 8.0, threshold: 6.0 };
        let others = vec![("b".to_string(), Rect::new(200.0, 0.0, 300.0, 50.0))];
        // proposed left edge 204, within 6 of b's left edge 200 -> snap to 200
        let (x, hit) = s.snap_x(204.0, 100.0, &others);
        assert_eq!(x, 200.0);
        assert_eq!(hit, Some("b".into()));
        // far from everything -> falls back to 8px grid
        let (x, hit) = s.snap_x(701.0, 100.0, &[]);
        assert_eq!(x, 704.0);
        assert!(hit.is_none());
    }

    #[test]
    fn constraints_solver() {
        let mut f = Node::frame("f", 400.0, 300.0)
            .child(Node::rect("right", 300.0, 10.0, 80.0, 40.0, Color::WHITE).pin(crate::HPin::Right, crate::VPin::Top))
            .child(Node::rect("stretch", 10.0, 10.0, 380.0, 40.0, Color::WHITE).pin(crate::HPin::StretchH, crate::VPin::Top))
            .child(Node::rect("center", 150.0, 100.0, 100.0, 40.0, Color::WHITE).pin(crate::HPin::CenterH, crate::VPin::CenterV));
        let (ow, oh) = (f.w, f.h);
        f.w = 600.0; f.h = 400.0;
        apply_constraints(&mut f, ow, oh);
        assert_eq!(find(&f, "right").unwrap().transform.x, 500.0);   // +200
        assert_eq!(find(&f, "stretch").unwrap().w, 580.0);           // +200
        assert_eq!(find(&f, "center").unwrap().transform.x, 250.0);  // +100
        assert_eq!(find(&f, "center").unwrap().transform.y, 150.0);  // +50
    }

    #[test]
    fn prototype_player_navigates_and_goes_back() {
        let doc = Node::frame("doc", 2000.0, 800.0)
            .child(Node::frame("screen-1", 400.0, 800.0)
                .child(Node::rect("cta", 100.0, 700.0, 200.0, 60.0, Color::WHITE).prototype("screen-2", 300)))
            .child(Node::frame("screen-2", 400.0, 800.0)
                .child(Node::rect("back-btn", 10.0, 10.0, 60.0, 40.0, Color::WHITE)));
        let mut p = Player::new(&doc, "screen-1");
        let ms = p.click(Point::new(200.0, 730.0));
        assert_eq!(ms, Some(300));
        assert_eq!(p.current, "screen-2");
        assert!(p.back());
        assert_eq!(p.current, "screen-1");
        assert!(!p.back());
    }

    #[test]
    fn spatial_grid_indexes_100k_and_queries_fast() {
        let scene = crate::benchmark_scene(100_000);
        let t0 = std::time::Instant::now();
        let grid = SpatialGrid::build(&scene, 256.0);
        let build_ms = t0.elapsed().as_millis();
        assert_eq!(grid.len(), 100_000);
        let t1 = std::time::Instant::now();
        let mut total = 0usize;
        for i in 0..1000 { total += grid.query_point(Point::new((i * 4) as f64, (i * 4) as f64)).len(); }
        let query_us = t1.elapsed().as_micros();
        assert!(total > 0);
        // generous sandbox bounds; on real hardware these are far lower
        assert!(build_ms < 5000, "grid build too slow: {build_ms}ms");
        assert!(query_us < 2_000_000, "1000 queries too slow: {query_us}us");
    }

    #[test]
    fn merge_last_collapses_a_drag_gesture() {
        let mut e = Editor::new(doc());
        e.selection = vec!["a".into()];
        let before = e.undo_depth();
        e.move_selection(5.0, 0.0);
        e.move_selection(5.0, 0.0);
        e.move_selection(5.0, 0.0);
        e.merge_last(e.undo_depth() - before);
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 25.0);
        e.undo(); // ONE undo reverts the whole gesture
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 10.0);
    }

    #[test]
    fn insert_node_is_undoable() {
        let mut e = Editor::new(doc());
        assert!(e.insert_node("page", Node::rect("new", 5.0, 5.0, 10.0, 10.0, Color::WHITE)));
        assert!(find(&e.root, "new").is_some());
        e.undo();
        assert!(find(&e.root, "new").is_none());
    }

    #[test]
    fn copy_paste_remaps_ids_and_is_undoable() {
        let mut e = Editor::new(doc());
        e.selection = vec!["a".into()];
        e.copy();
        let ids = e.paste("page", (20.0, 20.0));
        assert_eq!(ids, vec!["a-copy".to_string()]);
        let copy = find(&e.root, "a-copy").unwrap();
        assert_eq!(copy.transform.x, 30.0); // 10 + 20 offset
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 10.0); // original untouched
        // second paste gets a distinct id
        let ids2 = e.paste("page", (40.0, 40.0));
        assert_eq!(ids2, vec!["a-copy-2".to_string()]);
        e.undo();
        assert!(find(&e.root, "a-copy-2").is_none());
        assert!(find(&e.root, "a-copy").is_some());
    }

    #[test]
    fn duplicate_selects_the_new_copies() {
        let mut e = Editor::new(doc());
        e.selection = vec!["b".into()];
        let ids = e.duplicate_selection((10.0, 10.0));
        assert_eq!(e.selection, ids);
        assert!(find(&e.root, "b-copy").is_some());
    }

    #[test]
    fn paste_remaps_nested_child_ids_too() {
        let mut e = Editor::new(
            Node::frame("page", 800.0, 600.0)
                .child(Node::group("g", 100.0, 100.0).child(Node::rect("inner", 0.0, 0.0, 50.0, 50.0, Color::WHITE))),
        );
        e.selection = vec!["g".into()];
        e.copy();
        e.paste("page", (0.0, 0.0));
        let pasted = find(&e.root, "g-copy").unwrap();
        assert_eq!(pasted.children[0].id, "inner-copy"); // child renamed, no dup ids
    }

    #[test]
    fn smart_animate_interpolates_matching_ids() {
        let from = Node::frame("s1", 400.0, 400.0)
            .child(Node::rect("box", 0.0, 0.0, 100.0, 100.0, Color::rgb8(255, 0, 0)))
            .child(Node::rect("leaving", 300.0, 300.0, 50.0, 50.0, Color::WHITE));
        let to = Node::frame("s2", 400.0, 400.0)
            .child(Node::rect("box", 200.0, 100.0, 200.0, 100.0, Color::rgb8(0, 0, 255)))
            .child(Node::rect("entering", 0.0, 300.0, 50.0, 50.0, Color::WHITE));
        let mid = smart_animate(&from, &to, 0.5);
        let boxn = find(&mid, "box").unwrap();
        assert_eq!(boxn.transform.x, 100.0); // (0+200)/2
        assert_eq!(boxn.transform.y, 50.0);
        assert_eq!(boxn.w, 150.0);
        if let Paint::Solid(c) = &boxn.fill {
            assert_eq!((c.r, c.b), (128, 128)); // red->blue midpoint
        } else { panic!("expected solid fill") }
        // entering fades in, leaving fades out
        assert!((find(&mid, "entering").unwrap().opacity - 0.5).abs() < 1e-6);
        assert!((find(&mid, "leaving").unwrap().opacity - 0.5).abs() < 1e-6);
        // endpoints match the destinations exactly
        let end = smart_animate(&from, &to, 1.0);
        assert_eq!(find(&end, "box").unwrap().transform.x, 200.0);
        assert_eq!(find(&end, "leaving").unwrap().opacity, 0.0);
    }

    #[test]
    fn smart_animate_frames_are_renderable() {
        let from = Node::frame("s1", 400.0, 400.0).child(Node::rect("box", 0.0, 0.0, 100.0, 100.0, Color::WHITE));
        let to = Node::frame("s2", 400.0, 400.0).child(Node::rect("box", 200.0, 200.0, 100.0, 100.0, Color::WHITE));
        let mid = smart_animate(&from, &to, 0.25);
        let (_, s) = crate::build_scene(&mid, None, &Variables::default());
        assert_eq!(s.paths, 1);
    }

    #[test]
    fn set_opacity_is_undoable() {
        let mut e = Editor::new(doc());
        e.set_opacity("a", 0.4);
        assert!((find(&e.root, "a").unwrap().opacity - 0.4).abs() < 1e-6);
        e.undo();
        assert_eq!(find(&e.root, "a").unwrap().opacity, 1.0);
    }

    #[test]
    fn alignment_guides_detect_edges_and_centers() {
        // b: x∈[200,300] y∈[10,60]; move a to share b's top edge and left edge
        let mut d = doc();
        find_mut(&mut d, "a").unwrap().transform.x = 200.0; // left edges align
        let g = alignment_guides(&d, "a", 1.0);
        assert!(g.contains(&(true, 200.0)), "left-edge guide missing: {g:?}");
        assert!(g.contains(&(false, 10.0)), "top-edge guide missing: {g:?}");
        // center alignment: move a so its center-x hits b's center-x (250)
        find_mut(&mut d, "a").unwrap().transform.x = 200.0; // a: [200,300] center 250 == b center
        let g = alignment_guides(&d, "a", 1.0);
        assert!(g.contains(&(true, 250.0)), "center guide missing: {g:?}");
        // far away -> no guides
        find_mut(&mut d, "a").unwrap().transform.x = 500.0;
        find_mut(&mut d, "a").unwrap().transform.y = 400.0;
        let g = alignment_guides(&d, "a", 1.0);
        assert!(g.is_empty(), "expected no guides, got {g:?}");
    }

    #[test]
    fn set_auto_layout_solves_and_undoes_atomically() {
        use crate::{AutoLayout, LayoutDirection, Sizing};
        let mut e = Editor::new(
            Node::frame("page", 800.0, 600.0).child(
                Node::frame("f", 400.0, 200.0)
                    .child(Node::rect("a", 300.0, 90.0, 50.0, 40.0, Color::WHITE))
                    .child(Node::rect("b", 20.0, 15.0, 70.0, 40.0, Color::WHITE)),
            ),
        );
        let vars = Variables::default();
        assert!(e.set_auto_layout("f", Some(AutoLayout {
            direction: LayoutDirection::Horizontal, gap: 10.0, padding: 8.0,
            sizing: Sizing::Fixed, ..Default::default()
        }), &vars));
        // children re-stacked: a at padding, b after a + gap
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 8.0);
        assert_eq!(find(&e.root, "b").unwrap().transform.x, 68.0); // 8+50+10
        assert!(e.auto_layout_of("f").is_some());
        // ONE undo restores the scattered originals AND removes the layout
        assert!(e.undo());
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 300.0);
        assert_eq!(find(&e.root, "b").unwrap().transform.x, 20.0);
        assert!(e.auto_layout_of("f").is_none());
        // redo brings it back
        assert!(e.redo());
        assert_eq!(find(&e.root, "b").unwrap().transform.x, 68.0);
        // clearing layout keeps positions but removes the layout config
        assert!(e.set_auto_layout("f", None, &vars));
        assert!(e.auto_layout_of("f").is_none());
        assert_eq!(find(&e.root, "b").unwrap().transform.x, 68.0);
        // non-frames are rejected
        assert!(!e.set_auto_layout("a", None, &vars));
    }

    #[test]
    fn make_component_and_place_instances() {
        let mut e = Editor::new(doc());
        e.selection = vec!["a".into(), "b".into()];
        assert!(e.make_component("Card"));
        // selection is now the replacing instance
        assert_eq!(e.selection, vec!["Card-1".to_string()]);
        let inst = find(&e.root, "Card-1").unwrap();
        assert!(matches!(&inst.kind, NodeKind::Instance { component } if component == "Card"));
        assert_eq!(inst.transform.x, 10.0); // collective origin of a+b
        assert_eq!(inst.w, 290.0);          // spans a(10..110) to b(200..300)
        // master exists, hidden, with re-based members
        let master = find(&e.root, "comp-Card").unwrap();
        assert!(!master.visible);
        assert_eq!(master.children.len(), 2);
        assert_eq!(master.children[0].transform.x, 0.0);
        // originals moved off the page INTO the master (still findable there)
        assert!(!e.root.children.iter().any(|c| c.id == "a"));
        assert!(master.children.iter().any(|c| c.id == "a"));
        // rendering resolves the instance -> master children paths
        let (_, s) = crate::build_scene(&e.root, None, &Variables::default());
        assert_eq!(s.paths, 3); // c (ellipse) + 2 resolved members
        // stamp two more instances
        let id2 = e.place_instance("Card", 400.0, 300.0).unwrap();
        assert_eq!(id2, "Card-2");
        let (_, s) = crate::build_scene(&e.root, None, &Variables::default());
        assert_eq!(s.paths, 5);
        // editing the MASTER's child updates every instance render
        assert_eq!(e.component_names(), vec!["Card".to_string()]);
        // undo the placement, then undo the componentization entirely
        e.undo();
        assert!(find(&e.root, "Card-2").is_none());
        e.undo();
        assert!(find(&e.root, "a").is_some());
        assert!(find(&e.root, "comp-Card").is_none());
    }

    #[test]
    fn scale_tool_scales_subtree_uniformly() {
        let mut e = Editor::new(
            Node::frame("page", 800.0, 600.0).child(
                Node::frame("f", 200.0, 100.0)
                    .child(Node::rect("r", 20.0, 10.0, 50.0, 30.0, Color::WHITE).radius(8.0)),
            ),
        );
        assert!(e.scale_node("f", 2.0));
        let f = find(&e.root, "f").unwrap();
        assert_eq!((f.w, f.h), (400.0, 200.0));
        let r = find(&e.root, "r").unwrap();
        assert_eq!((r.transform.x, r.transform.y), (40.0, 20.0)); // offsets scaled
        assert_eq!((r.w, r.h), (100.0, 60.0));
        assert!(matches!(r.kind, NodeKind::Rect { radius } if radius == 16.0)); // radius scaled
        e.undo();
        assert_eq!(find(&e.root, "f").unwrap().w, 200.0);
        assert_eq!(find(&e.root, "r").unwrap().w, 50.0);
        // zero/negative factor rejected
        assert!(!e.scale_node("f", 0.0));
    }

    #[test]
    fn set_prototype_is_undoable() {
        let mut e = Editor::new(doc());
        e.set_prototype("a", Some(crate::PrototypeAction { destination: "page-2".into(), transition_ms: 300 }));
        assert_eq!(find(&e.root, "a").unwrap().prototype.as_ref().unwrap().destination, "page-2");
        e.undo();
        assert!(find(&e.root, "a").unwrap().prototype.is_none());
        e.redo();
        // clearing works too
        e.set_prototype("a", None);
        assert!(find(&e.root, "a").unwrap().prototype.is_none());
    }

    #[test]
    fn figma_click_selects_top_level_then_drills() {
        // page > group g > rect inner
        let d = Node::frame("page", 800.0, 600.0).child(
            Node::group("g", 200.0, 200.0)
                .child(Node::rect("inner", 10.0, 10.0, 100.0, 100.0, Color::WHITE)),
        );
        let mut e = Editor::new(d);
        // plain click on inner selects TOP-LEVEL group (Figma behavior)
        e.click_figma(Point::new(50.0, 50.0), false, false);
        assert_eq!(e.selection, vec!["g".to_string()]);
        // deep click (ctrl) selects the exact node
        e.click_figma(Point::new(50.0, 50.0), false, true);
        assert_eq!(e.selection, vec!["inner".to_string()]);
        // drill: from g, double-click goes one level down
        e.selection = vec!["g".into()];
        let next = e.drill_into(Point::new(50.0, 50.0));
        assert_eq!(next.as_deref(), Some("inner"));
    }

    #[test]
    fn ungroup_dissolves_and_preserves_positions() {
        let d = Node::frame("page", 800.0, 600.0).child({
            let mut g = Node::group("g", 200.0, 100.0)
                .child(Node::rect("a", 5.0, 6.0, 50.0, 40.0, Color::WHITE))
                .child(Node::rect("b", 60.0, 6.0, 50.0, 40.0, Color::WHITE));
            g.transform.x = 100.0; g.transform.y = 50.0; g
        });
        let mut e = Editor::new(d);
        assert!(e.ungroup("g"));
        assert!(find(&e.root, "g").is_none());
        let a = find(&e.root, "a").unwrap();
        assert_eq!((a.transform.x, a.transform.y), (105.0, 56.0)); // world position preserved
        assert_eq!(e.selection, vec!["a".to_string(), "b".to_string()]);
        // snapshot-undo restores the group
        assert!(e.undo());
        assert!(find(&e.root, "g").is_some());
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 5.0);
    }

    #[test]
    fn select_all_scopes_to_selected_frame() {
        let d = Node::frame("page", 800.0, 600.0)
            .child(Node::rect("x", 0.0, 0.0, 10.0, 10.0, Color::WHITE))
            .child(Node::frame("f", 200.0, 200.0)
                .child(Node::rect("c1", 0.0, 0.0, 10.0, 10.0, Color::WHITE))
                .child(Node::rect("c2", 20.0, 0.0, 10.0, 10.0, Color::WHITE)));
        let mut e = Editor::new(d);
        e.select_all();
        assert_eq!(e.selection.len(), 2); // x and f
        // with frame f selected, select-all scopes inside it
        e.selection = vec!["f".into()];
        e.select_all();
        assert_eq!(e.selection, vec!["c1".to_string(), "c2".to_string()]);
    }

    #[test]
    fn snap_delta_pulls_to_nearby_edges() {
        let mut d = doc();
        // a: x∈[10,110]; b: x∈[200,300]. Move a so its right edge is 3px from b's left.
        find_mut(&mut d, "a").unwrap().transform.x = 97.0; // right edge 197, b.x0=200, d=3
        let (dx, _) = snap_delta(&d, "a", 6.0);
        assert_eq!(dx, 3.0); // pulled right to touch exactly
        // vertical: a.y=10 already aligns with b.y=10 -> dy 0 (already snapped)
        let (_, dy) = snap_delta(&d, "a", 6.0);
        assert_eq!(dy, 0.0);
        // far away -> no snap
        find_mut(&mut d, "a").unwrap().transform.x = 400.0;
        find_mut(&mut d, "a").unwrap().transform.y = 400.0;
        assert_eq!(snap_delta(&d, "a", 6.0), (0.0, 0.0));
    }

    #[test]
    fn set_pin_is_undoable() {
        let mut e = Editor::new(doc());
        e.set_pin("a", crate::HPin::Right, crate::VPin::Bottom);
        assert_eq!(find(&e.root, "a").unwrap().pin, (crate::HPin::Right, crate::VPin::Bottom));
        e.undo();
        assert_eq!(find(&e.root, "a").unwrap().pin, (crate::HPin::Left, crate::VPin::Top));
    }

    #[test]
    fn checkpoints_restore() {
        let mut e = Editor::new(doc());
        e.checkpoint("v1");
        e.selection = vec!["a".into()];
        e.move_selection(500.0, 0.0);
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 510.0);
        assert!(e.restore_checkpoint("v1"));
        assert_eq!(find(&e.root, "a").unwrap().transform.x, 10.0);
    }

    #[test]
    fn dev_mode_css_export() {
        let n = Node::rect("card", 0.0, 0.0, 240.0, 120.0, Color::rgb8(0x0d, 0x99, 0xff))
            .radius(16.0).opacity(0.9)
            .effect(crate::Effect::DropShadow { dx: 0.0, dy: 4.0, blur: 12.0, color: Color::rgba8(0, 0, 0, 128) });
        let css = node_to_css(&n, &Variables::default());
        assert!(css.contains("width: 240px"));
        assert!(css.contains("background: #0d99ff"));
        assert!(css.contains("border-radius: 16px"));
        assert!(css.contains("box-shadow: 0px 4px 12px"));
    }
}
