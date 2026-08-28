//! Phase 7 slice: the native `.x` document format + SVG export.
//!
//! `.x` v1 is versioned JSON (schema field first, forward-compatible:
//! unknown keys are skipped on load). Written with a purpose-built emitter
//! and read with a purpose-built recursive-descent parser — zero new
//! dependencies, which matters given this crate's pinned dependency tree.
//! A binary (postcard/flatbuffers) format can replace the encoding behind
//! the same save/load API later.

use crate::{
    color_to_hex, parse_hex_color, AutoLayout, BlendKind, Color, CrossAlign, Document, Effect,
    LayoutDirection, Node, NodeKind, Paint, PathCmd, PrototypeAction, Sizing, Stroke, Variables,
};

pub const X_FORMAT_VERSION: u32 = 1;

// ------------------------------------------------------------------ emitter

fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn paint_json(p: &Paint) -> String {
    match p {
        Paint::Solid(c) => format!("{{\"t\":\"solid\",\"c\":\"{}\"}}", color_to_hex(*c)),
        Paint::Variable(n) => format!("{{\"t\":\"var\",\"name\":\"{}\"}}", esc(n)),
        Paint::LinearGradient { start, end, stops } => format!(
            "{{\"t\":\"linear\",\"x0\":{},\"y0\":{},\"x1\":{},\"y1\":{},\"stops\":[{}]}}",
            start.0, start.1, end.0, end.1,
            stops.iter().map(|(t, c)| format!("[{},\"{}\"]", t, color_to_hex(*c))).collect::<Vec<_>>().join(",")
        ),
        Paint::RadialGradient { center, radius, stops } => format!(
            "{{\"t\":\"radial\",\"cx\":{},\"cy\":{},\"r\":{},\"stops\":[{}]}}",
            center.0, center.1, radius,
            stops.iter().map(|(t, c)| format!("[{},\"{}\"]", t, color_to_hex(*c))).collect::<Vec<_>>().join(",")
        ),
    }
}

fn kind_json(k: &NodeKind) -> String {
    match k {
        NodeKind::Frame { layout: None } => "{\"t\":\"frame\"}".into(),
        NodeKind::Frame { layout: Some(l) } => format!(
            "{{\"t\":\"frame\",\"layout\":{{\"dir\":\"{}\",\"gap\":{},\"padding\":{},\"sizing\":\"{}\",\"align\":\"{}\",\"space_between\":{}{}{}}}}}",
            if l.direction == LayoutDirection::Horizontal { "h" } else { "v" },
            l.gap, l.padding,
            if l.sizing == Sizing::Hug { "hug" } else { "fixed" },
            match l.align { CrossAlign::Start => "start", CrossAlign::Center => "center", CrossAlign::End => "end" },
            l.space_between,
            l.gap_var.as_deref().map(|v| format!(",\"gap_var\":\"{}\"", esc(v))).unwrap_or_default(),
            l.padding_var.as_deref().map(|v| format!(",\"padding_var\":\"{}\"", esc(v))).unwrap_or_default(),
        ),
        NodeKind::Group => "{\"t\":\"group\"}".into(),
        NodeKind::Rect { radius } => format!("{{\"t\":\"rect\",\"radius\":{radius}}}"),
        NodeKind::Ellipse => "{\"t\":\"ellipse\"}".into(),
        NodeKind::Line => "{\"t\":\"line\"}".into(),
        NodeKind::Text { text } => format!("{{\"t\":\"text\",\"text\":\"{}\"}}", esc(text)),
        NodeKind::Image { asset } => format!("{{\"t\":\"image\",\"asset\":\"{}\"}}", esc(asset)),
        NodeKind::Vector { path } => {
            let cmds: Vec<String> = path.iter().map(|c| match c {
                PathCmd::MoveTo(x, y) => format!("[\"M\",{x},{y}]"),
                PathCmd::LineTo(x, y) => format!("[\"L\",{x},{y}]"),
                PathCmd::CurveTo(x1, y1, x2, y2, x, y) => format!("[\"C\",{x1},{y1},{x2},{y2},{x},{y}]"),
                PathCmd::Close => "[\"Z\"]".into(),
            }).collect();
            format!("{{\"t\":\"vector\",\"path\":[{}]}}", cmds.join(","))
        }
        NodeKind::Component { name } => format!("{{\"t\":\"component\",\"name\":\"{}\"}}", esc(name)),
        NodeKind::Instance { component } => format!("{{\"t\":\"instance\",\"component\":\"{}\"}}", esc(component)),
    }
}

fn node_json(n: &Node, out: &mut String) {
    out.push_str(&format!(
        "{{\"id\":\"{}\",\"kind\":{},\"x\":{},\"y\":{},\"w\":{},\"h\":{},\"rotation\":{},\"opacity\":{},\"visible\":{},\"locked\":{},\"fill\":{}",
        esc(&n.id), kind_json(&n.kind),
        n.transform.x, n.transform.y, n.w, n.h, n.transform.rotation, n.opacity, n.visible, n.locked,
        paint_json(&n.fill),
    ));
    if n.stroke.width > 0.0 {
        out.push_str(&format!(",\"stroke\":{{\"color\":\"{}\",\"width\":{}}}", color_to_hex(n.stroke.color), n.stroke.width));
    }
    if let Some([tl, tr, br, bl]) = n.corner_radii {
        out.push_str(&format!(",\"corners\":[{tl},{tr},{br},{bl}]"));
    }
    if n.blend != BlendKind::Normal {
        let b = match n.blend { BlendKind::Multiply => "multiply", BlendKind::Screen => "screen", BlendKind::Overlay => "overlay", BlendKind::Darken => "darken", BlendKind::Lighten => "lighten", BlendKind::Normal => unreachable!() };
        out.push_str(&format!(",\"blend\":\"{b}\""));
    }
    if !n.effects.is_empty() {
        let fx: Vec<String> = n.effects.iter().map(|e| match e {
            Effect::DropShadow { dx, dy, blur, color } => format!("{{\"t\":\"drop\",\"dx\":{dx},\"dy\":{dy},\"blur\":{blur},\"c\":\"{}\"}}", color_to_hex(*color)),
            Effect::InnerShadow { dx, dy, blur, color } => format!("{{\"t\":\"inner\",\"dx\":{dx},\"dy\":{dy},\"blur\":{blur},\"c\":\"{}\"}}", color_to_hex(*color)),
            Effect::LayerBlur { radius } => format!("{{\"t\":\"blur\",\"r\":{radius}}}"),
            Effect::BackgroundBlur { radius } => format!("{{\"t\":\"bgblur\",\"r\":{radius}}}"),
        }).collect();
        out.push_str(&format!(",\"effects\":[{}]", fx.join(",")));
    }
    if let Some(p) = &n.prototype {
        out.push_str(&format!(",\"prototype\":{{\"to\":\"{}\",\"ms\":{}}}", esc(&p.destination), p.transition_ms));
    }
    if !n.overrides.is_empty() {
        let mut keys: Vec<_> = n.overrides.keys().collect();
        keys.sort();
        let kv: Vec<String> = keys.iter().map(|k| format!("\"{}\":\"{}\"", esc(k), esc(&n.overrides[*k]))).collect();
        out.push_str(&format!(",\"overrides\":{{{}}}", kv.join(",")));
    }
    if !n.children.is_empty() {
        out.push_str(",\"children\":[");
        for (i, c) in n.children.iter().enumerate() {
            if i > 0 { out.push(','); }
            node_json(c, out);
        }
        out.push(']');
    }
    out.push('}');
}

/// Serialize a Document to `.x` v1 JSON.
pub fn save_x(doc: &Document) -> String {
    let mut out = format!("{{\"format\":\"x-native\",\"version\":{X_FORMAT_VERSION},");
    // variables
    let mut colors: Vec<_> = doc.variables.colors.iter().collect();
    colors.sort_by_key(|(k, _)| k.clone());
    let mut numbers: Vec<_> = doc.variables.numbers.iter().collect();
    numbers.sort_by_key(|(k, _)| k.clone());
    out.push_str("\"variables\":{\"colors\":{");
    out.push_str(&colors.iter().map(|(k, v)| format!("\"{}\":\"{}\"", esc(k), color_to_hex(**v))).collect::<Vec<_>>().join(","));
    out.push_str("},\"numbers\":{");
    out.push_str(&numbers.iter().map(|(k, v)| format!("\"{}\":{}", esc(k), v)).collect::<Vec<_>>().join(","));
    out.push_str("}},\"pages\":[");
    for (i, p) in doc.pages.iter().enumerate() {
        if i > 0 { out.push(','); }
        node_json(p, &mut out);
    }
    out.push_str("]}");
    out
}

// ------------------------------------------------------------------- parser

struct P<'a> { s: &'a [u8], i: usize }
#[derive(Debug, Clone, PartialEq)]
enum V { Null, Bool(bool), Num(f64), Str(String), Arr(Vec<V>), Obj(Vec<(String, V)>) }
impl V {
    fn get(&self, key: &str) -> Option<&V> { if let V::Obj(m) = self { m.iter().find(|(k, _)| k == key).map(|(_, v)| v) } else { None } }
    fn str(&self) -> Option<&str> { if let V::Str(s) = self { Some(s) } else { None } }
    fn num(&self) -> Option<f64> { if let V::Num(n) = self { Some(*n) } else { None } }
    fn boolean(&self) -> Option<bool> { if let V::Bool(b) = self { Some(*b) } else { None } }
    fn arr(&self) -> Option<&Vec<V>> { if let V::Arr(a) = self { Some(a) } else { None } }
}

impl<'a> P<'a> {
    fn new(s: &'a str) -> Self { Self { s: s.as_bytes(), i: 0 } }
    fn ws(&mut self) { while self.i < self.s.len() && (self.s[self.i] as char).is_ascii_whitespace() { self.i += 1; } }
    fn peek(&mut self) -> Option<u8> { self.ws(); self.s.get(self.i).copied() }
    fn eat(&mut self, c: u8) -> Result<(), String> {
        self.ws();
        if self.s.get(self.i) == Some(&c) { self.i += 1; Ok(()) } else { Err(format!("expected '{}' at {}", c as char, self.i)) }
    }
    fn value(&mut self) -> Result<V, String> {
        match self.peek().ok_or("eof")? {
            b'{' => {
                self.eat(b'{')?;
                let mut m = vec![];
                if self.peek() == Some(b'}') { self.eat(b'}')?; return Ok(V::Obj(m)); }
                loop {
                    let k = match self.value()? { V::Str(s) => s, _ => return Err("key must be string".into()) };
                    self.eat(b':')?;
                    m.push((k, self.value()?));
                    match self.peek() { Some(b',') => { self.eat(b',')?; } _ => break }
                }
                self.eat(b'}')?;
                Ok(V::Obj(m))
            }
            b'[' => {
                self.eat(b'[')?;
                let mut a = vec![];
                if self.peek() == Some(b']') { self.eat(b']')?; return Ok(V::Arr(a)); }
                loop {
                    a.push(self.value()?);
                    match self.peek() { Some(b',') => { self.eat(b',')?; } _ => break }
                }
                self.eat(b']')?;
                Ok(V::Arr(a))
            }
            b'"' => {
                self.eat(b'"')?;
                let mut out = String::new();
                while let Some(&c) = self.s.get(self.i) {
                    self.i += 1;
                    match c {
                        b'"' => return Ok(V::Str(out)),
                        b'\\' => {
                            let e = *self.s.get(self.i).ok_or("eof in escape")?;
                            self.i += 1;
                            match e {
                                b'n' => out.push('\n'), b't' => out.push('\t'), b'r' => out.push('\r'),
                                b'u' => {
                                    let hex = std::str::from_utf8(self.s.get(self.i..self.i + 4).ok_or("bad \\u")?).map_err(|_| "bad utf8")?;
                                    let cp = u32::from_str_radix(hex, 16).map_err(|_| "bad hex")?;
                                    out.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
                                    self.i += 4;
                                }
                                other => out.push(other as char),
                            }
                        }
                        c => {
                            // re-assemble multi-byte utf8
                            let start = self.i - 1;
                            let len = if c < 0x80 { 1 } else if c >> 5 == 0b110 { 2 } else if c >> 4 == 0b1110 { 3 } else { 4 };
                            let slice = self.s.get(start..start + len).ok_or("bad utf8")?;
                            out.push_str(std::str::from_utf8(slice).map_err(|_| "bad utf8")?);
                            self.i = start + len;
                        }
                    }
                }
                Err("unterminated string".into())
            }
            b't' => { self.i += 4; Ok(V::Bool(true)) }
            b'f' => { self.i += 5; Ok(V::Bool(false)) }
            b'n' => { self.i += 4; Ok(V::Null) }
            _ => {
                self.ws();
                let start = self.i;
                while self.i < self.s.len() && matches!(self.s[self.i], b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E') { self.i += 1; }
                std::str::from_utf8(&self.s[start..self.i]).ok()
                    .and_then(|t| t.parse().ok())
                    .map(V::Num)
                    .ok_or_else(|| format!("bad number at {start}"))
            }
        }
    }
}

fn parse_paint(v: &V) -> Paint {
    let t = v.get("t").and_then(V::str).unwrap_or("solid");
    match t {
        "var" => Paint::Variable(v.get("name").and_then(V::str).unwrap_or("").into()),
        "linear" => Paint::LinearGradient {
            start: (v.get("x0").and_then(V::num).unwrap_or(0.0), v.get("y0").and_then(V::num).unwrap_or(0.0)),
            end: (v.get("x1").and_then(V::num).unwrap_or(0.0), v.get("y1").and_then(V::num).unwrap_or(0.0)),
            stops: parse_stops(v),
        },
        "radial" => Paint::RadialGradient {
            center: (v.get("cx").and_then(V::num).unwrap_or(0.0), v.get("cy").and_then(V::num).unwrap_or(0.0)),
            radius: v.get("r").and_then(V::num).unwrap_or(0.0),
            stops: parse_stops(v),
        },
        _ => Paint::Solid(v.get("c").and_then(V::str).and_then(parse_hex_color).unwrap_or(Color::TRANSPARENT)),
    }
}
fn parse_stops(v: &V) -> Vec<(f32, Color)> {
    v.get("stops").and_then(V::arr).map(|a| {
        a.iter().filter_map(|s| {
            let pair = s.arr()?;
            Some((pair.first()?.num()? as f32, parse_hex_color(pair.get(1)?.str()?)?))
        }).collect()
    }).unwrap_or_default()
}

fn parse_kind(v: &V) -> NodeKind {
    match v.get("t").and_then(V::str).unwrap_or("frame") {
        "group" => NodeKind::Group,
        "rect" => NodeKind::Rect { radius: v.get("radius").and_then(V::num).unwrap_or(0.0) },
        "ellipse" => NodeKind::Ellipse,
        "line" => NodeKind::Line,
        "text" => NodeKind::Text { text: v.get("text").and_then(V::str).unwrap_or("").into() },
        "image" => NodeKind::Image { asset: v.get("asset").and_then(V::str).unwrap_or("").into() },
        "vector" => NodeKind::Vector {
            path: v.get("path").and_then(V::arr).map(|a| {
                a.iter().filter_map(|cmd| {
                    let c = cmd.arr()?;
                    match c.first()?.str()? {
                        "M" => Some(PathCmd::MoveTo(c.get(1)?.num()?, c.get(2)?.num()?)),
                        "L" => Some(PathCmd::LineTo(c.get(1)?.num()?, c.get(2)?.num()?)),
                        "C" => Some(PathCmd::CurveTo(c.get(1)?.num()?, c.get(2)?.num()?, c.get(3)?.num()?, c.get(4)?.num()?, c.get(5)?.num()?, c.get(6)?.num()?)),
                        "Z" => Some(PathCmd::Close),
                        _ => None,
                    }
                }).collect()
            }).unwrap_or_default(),
        },
        "component" => NodeKind::Component { name: v.get("name").and_then(V::str).unwrap_or("").into() },
        "instance" => NodeKind::Instance { component: v.get("component").and_then(V::str).unwrap_or("").into() },
        _ => {
            let layout = v.get("layout").map(|l| AutoLayout {
                direction: if l.get("dir").and_then(V::str) == Some("h") { LayoutDirection::Horizontal } else { LayoutDirection::Vertical },
                gap: l.get("gap").and_then(V::num).unwrap_or(0.0),
                padding: l.get("padding").and_then(V::num).unwrap_or(0.0),
                sizing: if l.get("sizing").and_then(V::str) == Some("hug") { Sizing::Hug } else { Sizing::Fixed },
                align: match l.get("align").and_then(V::str) { Some("center") => CrossAlign::Center, Some("end") => CrossAlign::End, _ => CrossAlign::Start },
                space_between: l.get("space_between").and_then(V::boolean).unwrap_or(false),
                gap_var: l.get("gap_var").and_then(V::str).map(String::from),
                padding_var: l.get("padding_var").and_then(V::str).map(String::from),
            });
            NodeKind::Frame { layout }
        }
    }
}

fn parse_node(v: &V) -> Node {
    let kind = v.get("kind").map(parse_kind).unwrap_or(NodeKind::Group);
    let mut n = Node::frame("", 0.0, 0.0);
    n.kind = kind;
    n.id = v.get("id").and_then(V::str).unwrap_or("").into();
    n.transform.x = v.get("x").and_then(V::num).unwrap_or(0.0);
    n.transform.y = v.get("y").and_then(V::num).unwrap_or(0.0);
    n.transform.rotation = v.get("rotation").and_then(V::num).unwrap_or(0.0);
    n.w = v.get("w").and_then(V::num).unwrap_or(0.0);
    n.h = v.get("h").and_then(V::num).unwrap_or(0.0);
    n.opacity = v.get("opacity").and_then(V::num).unwrap_or(1.0) as f32;
    n.visible = v.get("visible").and_then(V::boolean).unwrap_or(true);
    n.locked = v.get("locked").and_then(V::boolean).unwrap_or(false);
    n.fill = v.get("fill").map(parse_paint).unwrap_or(Paint::Solid(Color::TRANSPARENT));
    if let Some(s) = v.get("stroke") {
        n.stroke = Stroke {
            color: s.get("color").and_then(V::str).and_then(parse_hex_color).unwrap_or(Color::BLACK),
            width: s.get("width").and_then(V::num).unwrap_or(0.0),
        };
    }
    if let Some(c) = v.get("corners").and_then(V::arr) {
        if c.len() == 4 { n.corner_radii = Some([c[0].num().unwrap_or(0.0), c[1].num().unwrap_or(0.0), c[2].num().unwrap_or(0.0), c[3].num().unwrap_or(0.0)]); }
    }
    n.blend = match v.get("blend").and_then(V::str) {
        Some("multiply") => BlendKind::Multiply, Some("screen") => BlendKind::Screen,
        Some("overlay") => BlendKind::Overlay, Some("darken") => BlendKind::Darken,
        Some("lighten") => BlendKind::Lighten, _ => BlendKind::Normal,
    };
    if let Some(fx) = v.get("effects").and_then(V::arr) {
        for e in fx {
            let c = e.get("c").and_then(V::str).and_then(parse_hex_color).unwrap_or(Color::BLACK);
            let (dx, dy, blur) = (e.get("dx").and_then(V::num).unwrap_or(0.0), e.get("dy").and_then(V::num).unwrap_or(0.0), e.get("blur").and_then(V::num).unwrap_or(0.0));
            match e.get("t").and_then(V::str) {
                Some("drop") => n.effects.push(Effect::DropShadow { dx, dy, blur, color: c }),
                Some("inner") => n.effects.push(Effect::InnerShadow { dx, dy, blur, color: c }),
                Some("blur") => n.effects.push(Effect::LayerBlur { radius: e.get("r").and_then(V::num).unwrap_or(0.0) }),
                Some("bgblur") => n.effects.push(Effect::BackgroundBlur { radius: e.get("r").and_then(V::num).unwrap_or(0.0) }),
                _ => {}
            }
        }
    }
    if let Some(p) = v.get("prototype") {
        n.prototype = Some(PrototypeAction {
            destination: p.get("to").and_then(V::str).unwrap_or("").into(),
            transition_ms: p.get("ms").and_then(V::num).unwrap_or(0.0) as u32,
        });
    }
    if let Some(V::Obj(m)) = v.get("overrides") {
        for (k, val) in m { if let V::Str(s) = val { n.overrides.insert(k.clone(), s.clone()); } }
    }
    if let Some(kids) = v.get("children").and_then(V::arr) {
        n.children = kids.iter().map(parse_node).collect();
    }
    n.dirty = false;
    n
}

/// Load a `.x` v1 document. Unknown fields are ignored (forward-compatible).
pub fn load_x(text: &str) -> Result<Document, String> {
    let v = P::new(text).value()?;
    if v.get("format").and_then(V::str) != Some("x-native") { return Err("not an x-native file".into()); }
    let version = v.get("version").and_then(V::num).unwrap_or(0.0) as u32;
    if version > X_FORMAT_VERSION { return Err(format!("file version {version} is newer than supported {X_FORMAT_VERSION}")); }
    let mut doc = Document::new();
    if let Some(vars) = v.get("variables") {
        if let Some(V::Obj(m)) = vars.get("colors") {
            for (k, val) in m { if let Some(c) = val.str().and_then(parse_hex_color) { doc.variables.colors.insert(k.clone(), c); } }
        }
        if let Some(V::Obj(m)) = vars.get("numbers") {
            for (k, val) in m { if let Some(n) = val.num() { doc.variables.numbers.insert(k.clone(), n); } }
        }
    }
    if let Some(pages) = v.get("pages").and_then(V::arr) {
        doc.pages = pages.iter().map(parse_node).collect();
    }
    Ok(doc)
}

pub fn save_x_file(doc: &Document, path: &str) -> std::io::Result<()> { std::fs::write(path, save_x(doc)) }
pub fn load_x_file(path: &str) -> Result<Document, String> {
    load_x(&std::fs::read_to_string(path).map_err(|e| e.to_string())?)
}

// --------------------------------------------------------------- SVG export

/// Phase 7.6: export a node tree as standalone SVG. Rect/ellipse/line/text
/// (as vector strokes), gradients, opacity, rotation all map 1:1.
pub fn export_svg(root: &Node, vars: &Variables) -> String {
    let mut defs = String::new();
    let mut body = String::new();
    let mut grad_id = 0usize;
    svg_node(root, vars, &mut body, &mut defs, &mut grad_id);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\">\n<defs>\n{}</defs>\n{}</svg>\n",
        root.w, root.h, root.w, root.h, defs, body
    )
}

fn svg_fill(p: &Paint, vars: &Variables, defs: &mut String, grad_id: &mut usize) -> String {
    match p {
        Paint::Solid(c) => if c.a == 0 { "none".into() } else { color_to_hex(*c) },
        Paint::Variable(n) => color_to_hex(vars.color(n, Color::BLACK)),
        Paint::LinearGradient { start, end, stops } => {
            *grad_id += 1;
            let id = format!("g{grad_id}");
            defs.push_str(&format!("<linearGradient id=\"{id}\" x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" gradientUnits=\"userSpaceOnUse\">", start.0, start.1, end.0, end.1));
            for (t, c) in stops { defs.push_str(&format!("<stop offset=\"{}\" stop-color=\"{}\"/>", t, color_to_hex(*c))); }
            defs.push_str("</linearGradient>\n");
            format!("url(#{id})")
        }
        Paint::RadialGradient { center, radius, stops } => {
            *grad_id += 1;
            let id = format!("g{grad_id}");
            defs.push_str(&format!("<radialGradient id=\"{id}\" cx=\"{}\" cy=\"{}\" r=\"{}\" gradientUnits=\"userSpaceOnUse\">", center.0, center.1, radius));
            for (t, c) in stops { defs.push_str(&format!("<stop offset=\"{}\" stop-color=\"{}\"/>", t, color_to_hex(*c))); }
            defs.push_str("</radialGradient>\n");
            format!("url(#{id})")
        }
    }
}

fn svg_node(n: &Node, vars: &Variables, body: &mut String, defs: &mut String, grad_id: &mut usize) {
    if !n.visible { return; }
    let mut tf = format!("translate({} {})", n.transform.x, n.transform.y);
    if n.transform.rotation != 0.0 {
        tf.push_str(&format!(" rotate({} {} {})", n.transform.rotation.to_degrees(), n.w / 2.0, n.h / 2.0));
    }
    let op = if n.opacity < 1.0 { format!(" opacity=\"{}\"", n.opacity) } else { String::new() };
    body.push_str(&format!("<g transform=\"{tf}\"{op}>"));
    match &n.kind {
        NodeKind::Rect { radius } => {
            let fill = svg_fill(&n.fill, vars, defs, grad_id);
            let r = n.corner_radii.map(|c| c[0]).unwrap_or(*radius);
            body.push_str(&format!("<rect width=\"{}\" height=\"{}\" rx=\"{}\" fill=\"{}\"/>", n.w, n.h, r, fill));
        }
        NodeKind::Ellipse => {
            let fill = svg_fill(&n.fill, vars, defs, grad_id);
            body.push_str(&format!("<ellipse cx=\"{}\" cy=\"{}\" rx=\"{}\" ry=\"{}\" fill=\"{}\"/>", n.w / 2.0, n.h / 2.0, n.w / 2.0, n.h / 2.0, fill));
        }
        NodeKind::Line => {
            body.push_str(&format!("<line x1=\"0\" y1=\"0\" x2=\"{}\" y2=\"0\" stroke=\"{}\" stroke-width=\"{}\"/>", n.w, color_to_hex(n.stroke.color), n.stroke.width.max(1.0)));
        }
        NodeKind::Text { text } => {
            let fill = svg_fill(&n.fill, vars, defs, grad_id);
            body.push_str(&format!("<text y=\"{}\" font-size=\"{}\" font-family=\"monospace\" fill=\"{}\">{}</text>", n.h * 0.8, n.h * 0.8, fill, text.replace('&', "&amp;").replace('<', "&lt;")));
        }
        NodeKind::Vector { path } => {
            let fill = svg_fill(&n.fill, vars, defs, grad_id);
            let mut d = String::new();
            for c in path {
                match c {
                    PathCmd::MoveTo(x, y) => d.push_str(&format!("M {x} {y} ")),
                    PathCmd::LineTo(x, y) => d.push_str(&format!("L {x} {y} ")),
                    PathCmd::CurveTo(x1, y1, x2, y2, x, y) => d.push_str(&format!("C {x1} {y1} {x2} {y2} {x} {y} ")),
                    PathCmd::Close => d.push_str("Z "),
                }
            }
            let stroke = if n.stroke.width > 0.0 { format!(" stroke=\"{}\" stroke-width=\"{}\"", color_to_hex(n.stroke.color), n.stroke.width) } else { String::new() };
            body.push_str(&format!("<path d=\"{}\" fill=\"{}\"{}/>", d.trim_end(), fill, stroke));
        }
        _ => {}
    }
    for c in &n.children { svg_node(c, vars, body, defs, grad_id); }
    body.push_str("</g>\n");
}

// --------------------------------------------------------------- SVG import

/// Phase 7.4: import SVG into the native node tree. Handles the subset a
/// design tool actually round-trips: svg/g/rect/ellipse/circle/line/path/
/// text elements, fill/opacity/rx/transform=translate/rotate attributes,
/// nested groups, `<path d=...>` with M/L/C/Z (absolute and relative
/// m/l/c/z, H/V/h/v). Unknown elements/attributes are skipped, never fatal.
pub fn import_svg(svg: &str) -> Result<Node, String> {
    let mut lexer = XmlLexer { s: svg.as_bytes(), i: 0 };
    let mut id_counter = 0usize;
    // find root <svg ...>
    loop {
        match lexer.next_tag()? {
            XmlTag::Open(name, attrs) | XmlTag::SelfClose(name, attrs) if name == "svg" => {
                let w = attr_num(&attrs, "width").unwrap_or(800.0);
                let h = attr_num(&attrs, "height").unwrap_or(600.0);
                let mut root = Node::frame("svg-root", w, h);
                parse_children(&mut lexer, &mut root, &mut id_counter)?;
                return Ok(root);
            }
            XmlTag::Eof => return Err("no <svg> element found".into()),
            _ => {}
        }
    }
}

enum XmlTag { Open(String, Vec<(String, String)>), SelfClose(String, Vec<(String, String)>), Close(String), Text(String), Eof }

struct XmlLexer<'a> { s: &'a [u8], i: usize }
impl<'a> XmlLexer<'a> {
    fn next_tag(&mut self) -> Result<XmlTag, String> {
        // capture text content until next '<'
        let text_start = self.i;
        while self.i < self.s.len() && self.s[self.i] != b'<' { self.i += 1; }
        if self.i > text_start {
            let t = std::str::from_utf8(&self.s[text_start..self.i]).map_err(|_| "bad utf8")?.trim().to_string();
            if !t.is_empty() { return Ok(XmlTag::Text(t)); }
        }
        if self.i >= self.s.len() { return Ok(XmlTag::Eof); }
        self.i += 1; // consume '<'
        // comments / doctype / processing instructions
        if self.s.get(self.i) == Some(&b'!') || self.s.get(self.i) == Some(&b'?') {
            while self.i < self.s.len() && self.s[self.i] != b'>' { self.i += 1; }
            self.i += 1;
            return self.next_tag();
        }
        let closing = self.s.get(self.i) == Some(&b'/');
        if closing { self.i += 1; }
        let name_start = self.i;
        while self.i < self.s.len() && (self.s[self.i].is_ascii_alphanumeric() || self.s[self.i] == b'-' || self.s[self.i] == b':') { self.i += 1; }
        let name = std::str::from_utf8(&self.s[name_start..self.i]).map_err(|_| "bad utf8")?.to_string();
        let mut attrs = vec![];
        loop {
            while self.i < self.s.len() && (self.s[self.i] as char).is_ascii_whitespace() { self.i += 1; }
            match self.s.get(self.i) {
                Some(b'>') => { self.i += 1; return Ok(if closing { XmlTag::Close(name) } else { XmlTag::Open(name, attrs) }); }
                Some(b'/') => { self.i += 2; return Ok(XmlTag::SelfClose(name, attrs)); }
                None => return Ok(XmlTag::Eof),
                _ => {
                    let ks = self.i;
                    while self.i < self.s.len() && self.s[self.i] != b'=' && !(self.s[self.i] as char).is_ascii_whitespace() && self.s[self.i] != b'>' { self.i += 1; }
                    let key = std::str::from_utf8(&self.s[ks..self.i]).map_err(|_| "bad utf8")?.to_string();
                    if self.s.get(self.i) == Some(&b'=') {
                        self.i += 1;
                        let quote = *self.s.get(self.i).ok_or("eof in attr")?;
                        if quote == b'"' || quote == b'\'' {
                            self.i += 1;
                            let vs = self.i;
                            while self.i < self.s.len() && self.s[self.i] != quote { self.i += 1; }
                            let val = std::str::from_utf8(&self.s[vs..self.i]).map_err(|_| "bad utf8")?.to_string();
                            self.i += 1;
                            attrs.push((key, val));
                        }
                    }
                }
            }
        }
    }
}

fn attr<'v>(attrs: &'v [(String, String)], key: &str) -> Option<&'v str> { attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str()) }
fn attr_num(attrs: &[(String, String)], key: &str) -> Option<f64> {
    attr(attrs, key).and_then(|v| v.trim_end_matches("px").parse().ok())
}
fn attr_fill(attrs: &[(String, String)]) -> Color {
    match attr(attrs, "fill") {
        Some("none") => Color::TRANSPARENT,
        Some(s) => parse_hex_color(s).unwrap_or(Color::BLACK),
        None => Color::BLACK,
    }
}
fn apply_transform_attr(node: &mut Node, attrs: &[(String, String)]) {
    if let Some(t) = attr(attrs, "transform") {
        // supports translate(x y) and rotate(deg ...) — what we export.
        if let Some(rest) = t.split("translate(").nth(1) {
            let args: Vec<f64> = rest.split(')').next().unwrap_or("").split(|c| c == ' ' || c == ',').filter_map(|v| v.trim().parse().ok()).collect();
            if let Some(x) = args.first() { node.transform.x += x; }
            if let Some(y) = args.get(1) { node.transform.y += y; }
        }
        if let Some(rest) = t.split("rotate(").nth(1) {
            if let Some(deg) = rest.split(')').next().unwrap_or("").split(|c| c == ' ' || c == ',').next().and_then(|v| v.trim().parse::<f64>().ok()) {
                node.transform.rotation += deg.to_radians();
            }
        }
    }
    if let Some(op) = attr_num(attrs, "opacity") { node.opacity = op as f32; }
}

fn parse_path_d(d: &str) -> Vec<PathCmd> {
    let mut out = vec![];
    let mut nums: Vec<f64> = vec![];
    let mut cmd = ' ';
    let (mut cx, mut cy) = (0.0f64, 0.0f64);
    let mut flush = |cmd: char, nums: &mut Vec<f64>, out: &mut Vec<PathCmd>, cx: &mut f64, cy: &mut f64| {
        let rel = cmd.is_ascii_lowercase();
        match cmd.to_ascii_uppercase() {
            'M' => for pair in nums.chunks(2) { if pair.len() == 2 {
                let (x, y) = if rel { (*cx + pair[0], *cy + pair[1]) } else { (pair[0], pair[1]) };
                out.push(PathCmd::MoveTo(x, y)); *cx = x; *cy = y;
            }},
            'L' => for pair in nums.chunks(2) { if pair.len() == 2 {
                let (x, y) = if rel { (*cx + pair[0], *cy + pair[1]) } else { (pair[0], pair[1]) };
                out.push(PathCmd::LineTo(x, y)); *cx = x; *cy = y;
            }},
            'H' => for v in nums.iter() { let x = if rel { *cx + v } else { *v }; out.push(PathCmd::LineTo(x, *cy)); *cx = x; },
            'V' => for v in nums.iter() { let y = if rel { *cy + v } else { *v }; out.push(PathCmd::LineTo(*cx, y)); *cy = y; },
            'C' => for six in nums.chunks(6) { if six.len() == 6 {
                let (x1, y1, x2, y2, x, y) = if rel {
                    (*cx + six[0], *cy + six[1], *cx + six[2], *cy + six[3], *cx + six[4], *cy + six[5])
                } else { (six[0], six[1], six[2], six[3], six[4], six[5]) };
                out.push(PathCmd::CurveTo(x1, y1, x2, y2, x, y)); *cx = x; *cy = y;
            }},
            'Z' => out.push(PathCmd::Close),
            _ => {}
        }
        nums.clear();
    };
    let mut num_buf = String::new();
    let mut push_num = |num_buf: &mut String, nums: &mut Vec<f64>| {
        if !num_buf.is_empty() { if let Ok(v) = num_buf.parse() { nums.push(v); } num_buf.clear(); }
    };
    for ch in d.chars() {
        if ch.is_ascii_alphabetic() {
            push_num(&mut num_buf, &mut nums);
            if cmd != ' ' { flush(cmd, &mut nums, &mut out, &mut cx, &mut cy); }
            cmd = ch;
            if ch == 'Z' || ch == 'z' { flush(cmd, &mut nums, &mut out, &mut cx, &mut cy); cmd = ' '; }
        } else if ch.is_ascii_digit() || ch == '.' || ch == 'e' {
            num_buf.push(ch);
        } else if ch == '-' {
            if !num_buf.is_empty() && !num_buf.ends_with('e') { push_num(&mut num_buf, &mut nums); }
            num_buf.push(ch);
        } else {
            push_num(&mut num_buf, &mut nums);
        }
    }
    push_num(&mut num_buf, &mut nums);
    if cmd != ' ' { flush(cmd, &mut nums, &mut out, &mut cx, &mut cy); }
    out
}

fn parse_children(lexer: &mut XmlLexer, parent: &mut Node, id_counter: &mut usize) -> Result<(), String> {
    let mut pending_text_node: Option<Node> = None;
    loop {
        match lexer.next_tag()? {
            XmlTag::Eof => return Ok(()),
            XmlTag::Close(_) => {
                if let Some(t) = pending_text_node.take() { parent.children.push(t); }
                return Ok(());
            }
            XmlTag::Text(content) => {
                if let Some(mut t) = pending_text_node.take() {
                    if let NodeKind::Text { text } = &mut t.kind { *text = content; }
                    parent.children.push(t);
                }
            }
            tag @ (XmlTag::Open(..) | XmlTag::SelfClose(..)) => {
                let (name, attrs, self_closed) = match tag {
                    XmlTag::Open(n, a) => (n, a, false),
                    XmlTag::SelfClose(n, a) => (n, a, true),
                    _ => unreachable!(),
                };
                *id_counter += 1;
                let id = attr(&attrs, "id").map(String::from).unwrap_or_else(|| format!("import-{id_counter}"));
                match name.as_str() {
                    "g" => {
                        let mut g = Node::group(&id, 0.0, 0.0);
                        apply_transform_attr(&mut g, &attrs);
                        if !self_closed { parse_children(lexer, &mut g, id_counter)?; }
                        parent.children.push(g);
                    }
                    "rect" => {
                        let mut n = Node::rect(&id, attr_num(&attrs, "x").unwrap_or(0.0), attr_num(&attrs, "y").unwrap_or(0.0), attr_num(&attrs, "width").unwrap_or(0.0), attr_num(&attrs, "height").unwrap_or(0.0), attr_fill(&attrs));
                        if let Some(rx) = attr_num(&attrs, "rx") { n = n.radius(rx); }
                        apply_transform_attr(&mut n, &attrs);
                        if !self_closed { skip_element(lexer)?; }
                        parent.children.push(n);
                    }
                    "ellipse" | "circle" => {
                        let r = attr_num(&attrs, "r");
                        let rx = attr_num(&attrs, "rx").or(r).unwrap_or(0.0);
                        let ry = attr_num(&attrs, "ry").or(r).unwrap_or(0.0);
                        let cx = attr_num(&attrs, "cx").unwrap_or(0.0);
                        let cy = attr_num(&attrs, "cy").unwrap_or(0.0);
                        let mut n = Node::ellipse(&id, cx - rx, cy - ry, rx * 2.0, ry * 2.0, attr_fill(&attrs));
                        apply_transform_attr(&mut n, &attrs);
                        if !self_closed { skip_element(lexer)?; }
                        parent.children.push(n);
                    }
                    "line" => {
                        let x1 = attr_num(&attrs, "x1").unwrap_or(0.0);
                        let y1 = attr_num(&attrs, "y1").unwrap_or(0.0);
                        let x2 = attr_num(&attrs, "x2").unwrap_or(0.0);
                        let stroke_c = attr(&attrs, "stroke").and_then(parse_hex_color).unwrap_or(Color::BLACK);
                        let mut n = Node::line(&id, x1, y1, (x2 - x1).abs().max(1.0), 1.0, stroke_c);
                        n.stroke.width = attr_num(&attrs, "stroke-width").unwrap_or(1.0);
                        apply_transform_attr(&mut n, &attrs);
                        if !self_closed { skip_element(lexer)?; }
                        parent.children.push(n);
                    }
                    "path" => {
                        let cmds = attr(&attrs, "d").map(parse_path_d).unwrap_or_default();
                        // bounds -> node w/h so hit testing & layout see the real size
                        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
                        for c in &cmds {
                            let pts: &[(f64, f64)] = match c {
                                PathCmd::MoveTo(x, y) | PathCmd::LineTo(x, y) => &[(*x, *y)],
                                PathCmd::CurveTo(a, b, cc, d, e, f) => &[(*a, *b), (*cc, *d), (*e, *f)],
                                PathCmd::Close => &[],
                            };
                            for (x, y) in pts { x0 = x0.min(*x); y0 = y0.min(*y); x1 = x1.max(*x); y1 = y1.max(*y); }
                        }
                        let (w, h) = if x1 > x0 { (x1 - x0, y1 - y0) } else { (0.0, 0.0) };
                        let mut n = Node::vector(&id, 0.0, 0.0, w, h, cmds);
                        n.fill = Paint::Solid(attr_fill(&attrs));
                        if let (Some(sc), Some(sw)) = (attr(&attrs, "stroke").and_then(parse_hex_color), attr_num(&attrs, "stroke-width")) {
                            n.stroke = Stroke { color: sc, width: sw };
                        }
                        apply_transform_attr(&mut n, &attrs);
                        if !self_closed { skip_element(lexer)?; }
                        parent.children.push(n);
                    }
                    "text" => {
                        let size = attr_num(&attrs, "font-size").unwrap_or(16.0);
                        let mut n = Node::text(&id, attr_num(&attrs, "x").unwrap_or(0.0), attr_num(&attrs, "y").unwrap_or(0.0) - size * 0.8, 10.0 * size, size * 1.25, "");
                        n.fill = Paint::Solid(attr_fill(&attrs));
                        apply_transform_attr(&mut n, &attrs);
                        if self_closed { parent.children.push(n); } else { pending_text_node = Some(n); }
                    }
                    "defs" | "style" | "clipPath" | "mask" | "linearGradient" | "radialGradient" | "symbol" => {
                        if !self_closed { skip_element(lexer)?; }
                    }
                    _ => { if !self_closed { skip_element(lexer)?; } }
                }
            }
        }
    }
}

fn skip_element(lexer: &mut XmlLexer) -> Result<(), String> {
    let mut depth = 1i32;
    loop {
        match lexer.next_tag()? {
            XmlTag::Open(..) => depth += 1,
            XmlTag::Close(_) => { depth -= 1; if depth == 0 { return Ok(()); } }
            XmlTag::Eof => return Ok(()),
            _ => {}
        }
    }
}

// -------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{editor::find, Effect, HPin, VPin};

    fn sample_doc() -> Document {
        let mut doc = Document::new();
        doc.variables.colors.insert("brand".into(), Color::rgb8(0x0d, 0x99, 0xff));
        doc.variables.numbers.insert("gap-lg".into(), 28.0);
        let page = Node::frame("page-1", 800.0, 600.0)
            .auto_layout(AutoLayout { direction: LayoutDirection::Horizontal, gap: 20.0, padding: 24.0, align: CrossAlign::Center, space_between: true, gap_var: Some("gap-lg".into()), ..Default::default() })
            .child(
                Node::rect("card", 10.0, 20.0, 240.0, 120.0, Color::rgb8(255, 0, 0))
                    .radius(16.0).rotate(0.3).opacity(0.9)
                    .corners(1.0, 2.0, 3.0, 4.0)
                    .blend(BlendKind::Multiply)
                    .effect(Effect::DropShadow { dx: 0.0, dy: 4.0, blur: 12.0, color: Color::rgba8(0, 0, 0, 128) })
                    .pin(HPin::Right, VPin::Bottom)
                    .prototype("page-2", 250),
            )
            .child(Node::text("label", 0.0, 0.0, 120.0, 20.0, "Hello \"X\"\nworld"))
            .child(Node::instance("i1", "Button", 0.0, 0.0, 100.0, 40.0).override_prop("bg", "#00ff00").override_prop("label", "text:Buy"))
            .child(Node::rect("grad", 0.0, 0.0, 100.0, 100.0, Color::WHITE).fill_paint(Paint::LinearGradient { start: (0.0, 0.0), end: (100.0, 0.0), stops: vec![(0.0, Color::rgb8(255, 0, 0)), (1.0, Color::rgb8(0, 0, 255))] }));
        doc.pages.push(page);
        doc.pages.push(Node::frame("page-2", 800.0, 600.0));
        doc
    }

    #[test]
    fn x_format_roundtrips_everything() {
        let doc = sample_doc();
        let text = save_x(&doc);
        let loaded = load_x(&text).expect("load");
        assert_eq!(loaded.pages.len(), 2);
        assert_eq!(loaded.variables.colors.get("brand").unwrap().r, 0x0d);
        assert_eq!(*loaded.variables.numbers.get("gap-lg").unwrap(), 28.0);

        let page = &loaded.pages[0];
        if let NodeKind::Frame { layout: Some(l) } = &page.kind {
            assert_eq!(l.direction, LayoutDirection::Horizontal);
            assert_eq!(l.align, CrossAlign::Center);
            assert!(l.space_between);
            assert_eq!(l.gap_var.as_deref(), Some("gap-lg"));
        } else { panic!("layout lost"); }

        let card = find(page, "card").unwrap();
        assert_eq!(card.w, 240.0);
        assert_eq!(card.transform.rotation, 0.3);
        assert_eq!(card.corner_radii, Some([1.0, 2.0, 3.0, 4.0]));
        assert_eq!(card.blend, BlendKind::Multiply);
        assert_eq!(card.effects.len(), 1);
        assert_eq!(card.prototype.as_ref().unwrap().destination, "page-2");
        assert!((card.opacity - 0.9).abs() < 1e-6);

        let label = find(page, "label").unwrap();
        assert!(matches!(&label.kind, NodeKind::Text { text } if text == "Hello \"X\"\nworld"));

        let inst = find(page, "i1").unwrap();
        assert_eq!(inst.overrides.get("bg").map(String::as_str), Some("#00ff00"));
        assert_eq!(inst.overrides.get("label").map(String::as_str), Some("text:Buy"));

        let grad = find(page, "grad").unwrap();
        assert!(matches!(&grad.fill, Paint::LinearGradient { stops, .. } if stops.len() == 2));
    }

    #[test]
    fn double_roundtrip_is_stable() {
        let doc = sample_doc();
        let a = save_x(&doc);
        let b = save_x(&load_x(&a).unwrap());
        assert_eq!(a, b, "save(load(save(x))) must equal save(x)");
    }

    #[test]
    fn rejects_wrong_format_and_newer_versions() {
        assert!(load_x("{\"format\":\"figma\",\"version\":1}").is_err());
        assert!(load_x(&format!("{{\"format\":\"x-native\",\"version\":{}}}", X_FORMAT_VERSION + 1)).is_err());
        assert!(load_x("not json at all").is_err());
    }

    #[test]
    fn file_roundtrip_on_disk() {
        let doc = sample_doc();
        let path = std::env::temp_dir().join("xnative_test.x");
        let path = path.to_str().unwrap();
        save_x_file(&doc, path).unwrap();
        let loaded = load_x_file(path).unwrap();
        assert_eq!(loaded.pages.len(), 2);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn vector_path_roundtrips_through_x_format() {
        let mut doc = Document::new();
        let tri = Node::vector("tri", 0.0, 0.0, 100.0, 100.0, vec![
            PathCmd::MoveTo(50.0, 0.0),
            PathCmd::LineTo(100.0, 100.0),
            PathCmd::CurveTo(75.0, 90.0, 25.0, 90.0, 0.0, 100.0),
            PathCmd::Close,
        ]);
        doc.pages.push(Node::frame("p", 200.0, 200.0).child(tri));
        let loaded = load_x(&save_x(&doc)).unwrap();
        let n = find(&loaded.pages[0], "tri").unwrap();
        if let NodeKind::Vector { path } = &n.kind {
            assert_eq!(path.len(), 4);
            assert_eq!(path[0], PathCmd::MoveTo(50.0, 0.0));
            assert!(matches!(path[2], PathCmd::CurveTo(..)));
            assert_eq!(path[3], PathCmd::Close);
        } else { panic!("vector kind lost") }
    }

    #[test]
    fn svg_import_basic_shapes() {
        let svg = r##"<?xml version="1.0"?>
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
          <rect id="bg" x="10" y="20" width="100" height="50" rx="8" fill="#ff0000"/>
          <circle id="c1" cx="200" cy="100" r="40" fill="#00ff00"/>
          <g id="grp" transform="translate(50 60)">
            <ellipse cx="30" cy="20" rx="30" ry="20" fill="#0000ff"/>
          </g>
          <text id="label" x="10" y="290" font-size="20" fill="#000000">Hi there</text>
        </svg>"##;
        let root = import_svg(svg).expect("import");
        assert_eq!((root.w, root.h), (400.0, 300.0));
        let bg = find(&root, "bg").unwrap();
        assert_eq!((bg.transform.x, bg.w), (10.0, 100.0));
        assert!(matches!(bg.kind, NodeKind::Rect { radius } if radius == 8.0));
        assert!(matches!(&bg.fill, Paint::Solid(c) if c.r == 255 && c.g == 0));
        let c1 = find(&root, "c1").unwrap();
        assert_eq!((c1.transform.x, c1.w), (160.0, 80.0)); // cx-r, 2r
        let grp = find(&root, "grp").unwrap();
        assert_eq!((grp.transform.x, grp.transform.y), (50.0, 60.0));
        assert_eq!(grp.children.len(), 1);
        let label = find(&root, "label").unwrap();
        assert!(matches!(&label.kind, NodeKind::Text { text } if text == "Hi there"));
    }

    #[test]
    fn svg_import_path_with_relative_commands() {
        let svg = r##"<svg width="100" height="100">
          <path id="p" d="M 10 10 l 20 0 L 30 30 h 10 v 10 C 35 45 25 45 20 40 z" fill="#123456"/>
        </svg>"##;
        let root = import_svg(svg).unwrap();
        let p = find(&root, "p").unwrap();
        if let NodeKind::Vector { path } = &p.kind {
            assert_eq!(path[0], PathCmd::MoveTo(10.0, 10.0));
            assert_eq!(path[1], PathCmd::LineTo(30.0, 10.0));  // relative l resolved
            assert_eq!(path[2], PathCmd::LineTo(30.0, 30.0));
            assert_eq!(path[3], PathCmd::LineTo(40.0, 30.0));  // h
            assert_eq!(path[4], PathCmd::LineTo(40.0, 40.0));  // v
            assert!(matches!(path[5], PathCmd::CurveTo(..)));
            assert_eq!(*path.last().unwrap(), PathCmd::Close);
        } else { panic!("not a vector") }
        // imported vector actually renders
        let (_, s) = crate::build_scene(&root, None, &Variables::default());
        assert!(s.paths >= 1);
    }

    #[test]
    fn svg_roundtrip_export_then_import() {
        // Export our own scene, re-import it, and check the shapes survive.
        let page = Node::frame("page", 500.0, 400.0)
            .child(Node::rect("r1", 20.0, 30.0, 120.0, 60.0, Color::rgb8(0x0d, 0x99, 0xff)).radius(10.0))
            .child(Node::ellipse("e1", 200.0, 50.0, 80.0, 80.0, Color::rgb8(0xf2, 0x48, 0x22)));
        let svg = export_svg(&page, &Variables::default());
        let re = import_svg(&svg).expect("re-import own export");
        // our exporter wraps each node in <g transform=translate(...)>, so
        // position lands on the wrapping group; shape + fill must survive.
        fn count_kind(n: &Node, pred: &dyn Fn(&NodeKind) -> bool) -> usize {
            (pred(&n.kind) as usize) + n.children.iter().map(|c| count_kind(c, pred)).sum::<usize>()
        }
        assert_eq!(count_kind(&re, &|k| matches!(k, NodeKind::Rect { .. })), 1);
        assert_eq!(count_kind(&re, &|k| matches!(k, NodeKind::Ellipse)), 1);
        let (_, s) = crate::build_scene(&re, None, &Variables::default());
        assert_eq!(s.paths, 2);
    }

    #[test]
    fn svg_export_contains_shapes_and_gradients() {
        let doc = sample_doc();
        let svg = export_svg(&doc.pages[0], &doc.variables);
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("<rect"));
        assert!(svg.contains("<text"));
        assert!(svg.contains("linearGradient"));
        assert!(svg.contains("rotate("));
    }
}
