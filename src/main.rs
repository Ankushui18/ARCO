//! Demo driver for the v0.4 engine: builds a document exercising every new
//! phase slice, runs the headless editor through a scripted session
//! (select → move → undo → group → save/load → SVG export → prototype
//! playback), and prints verifiable stats for each step.

use arco_native::editor::{align, hit_test, AlignKind, Editor, Player, SpatialGrid};
use arco_native::fileio::{export_svg, load_x, save_x};
use arco_native::{
    apply_layout_recursive, build_scene, AutoLayout, BlendKind, Color, CrossAlign, Document,
    Effect, LayoutDirection, Node, Paint, Sizing, Variables, Viewport, PI,
};
use vello::kurbo::{Point, Rect};

fn main() {
    // ---- variables v2: modes + aliases -----------------------------------
    let mut vars = Variables::default();
    vars.colors.insert("bg".into(), Color::rgb8(0xff, 0xff, 0xff));
    vars.aliases.insert("surface".into(), "bg".into());
    let mut dark = std::collections::HashMap::new();
    dark.insert("bg".to_string(), Color::rgb8(0x1e, 0x1e, 0x1e));
    vars.modes.insert("dark".into(), dark);
    vars.numbers.insert("gap-lg".into(), 28.0);

    // ---- document: text, gradients, shadows, blend, layout v2 ------------
    let page = Node::frame("page-1", 1000.0, 700.0)
        .auto_layout(AutoLayout {
            direction: LayoutDirection::Horizontal,
            gap: 20.0,
            padding: 24.0,
            sizing: Sizing::Fixed,
            align: CrossAlign::Center,
            gap_var: Some("gap-lg".into()),
            ..Default::default()
        })
        .child(
            Node::rect("card", 0.0, 0.0, 240.0, 140.0, Color::rgb8(0x0d, 0x99, 0xff))
                .radius(18.0)
                .rotate(PI / 8.0)
                .effect(Effect::DropShadow { dx: 4.0, dy: 6.0, blur: 10.0, color: Color::BLACK }),
        )
        .child(
            Node::rect("grad", 0.0, 0.0, 200.0, 120.0, Color::WHITE).fill_paint(Paint::LinearGradient {
                start: (0.0, 0.0),
                end: (200.0, 0.0),
                stops: vec![(0.0, Color::rgb8(0xff, 0x5a, 0x00)), (1.0, Color::rgb8(0x8e, 0x2d, 0xe2))],
            }),
        )
        .child(Node::ellipse("dot", 0.0, 0.0, 120.0, 120.0, Color::rgb8(0xf2, 0x48, 0x22)).opacity(0.75).blend(BlendKind::Multiply))
        .child(Node::text("title", 0.0, 0.0, 220.0, 30.0, "X NATIVE 0.4").prototype("page-2", 250));

    let mut doc = Document::new();
    doc.variables = vars.clone();
    doc.pages.push(page);
    doc.pages.push(Node::frame("page-2", 1000.0, 700.0).child(Node::text("t2", 40.0, 40.0, 300.0, 40.0, "SCREEN 2")));

    // layout v2 (recursive)
    for p in &mut doc.pages { apply_layout_recursive(p, &vars); }

    let (scene, stats) = build_scene(&doc.pages[0], Some(Viewport { x: 0.0, y: 0.0, w: 1000.0, h: 700.0 }), &vars);
    println!(
        "render:      nodes={} paths={} culled={} vello_paths={} (text now DRAWS)",
        stats.nodes, stats.paths, stats.culled, scene.encoding().n_paths
    );

    // ---- editor session: hit test, move, undo, group ----------------------
    let mut ed = Editor::new(doc.pages[0].clone());
    let card_center = {
        let c = arco_native::editor::find(&ed.root, "card").unwrap();
        Point::new(c.transform.x + c.w / 2.0, c.transform.y + c.h / 2.0)
    };
    ed.click(card_center, false);
    println!("hit+select:  clicked {:?} -> selection={:?}", (card_center.x, card_center.y), ed.selection);

    ed.move_selection(15.0, -10.0);
    ed.undo();
    ed.redo();
    println!("undo/redo:   card.x after move+undo+redo = {}", arco_native::editor::find(&ed.root, "card").unwrap().transform.x);

    ed.marquee(Rect::new(0.0, 0.0, 1000.0, 700.0));
    println!("marquee:     selected {} nodes", ed.selection.len());

    ed.selection = vec!["grad".into(), "dot".into()];
    ed.group_selection("group-1");
    println!("group:       group-1 children={}", arco_native::editor::find(&ed.root, "group-1").unwrap().children.len());
    ed.undo();
    println!("ungroup(undo): group exists = {}", arco_native::editor::find(&ed.root, "group-1").is_some());

    align(&mut ed.root, &["card".to_string(), "title".to_string()], AlignKind::Top);

    // ---- variables v2 -----------------------------------------------------
    let mut dark_vars = vars.clone();
    dark_vars.active_mode = Some("dark".into());
    println!(
        "variables:   surface(light)={} surface(dark)={}",
        arco_native::color_to_hex(vars.color("surface", Color::BLACK)),
        arco_native::color_to_hex(dark_vars.color("surface", Color::BLACK)),
    );

    // ---- .x save/load roundtrip -------------------------------------------
    let saved = save_x(&doc);
    let loaded = load_x(&saved).expect("load_x");
    let roundtrip_ok = save_x(&loaded) == saved;
    println!(".x format:   {} bytes, roundtrip stable = {}", saved.len(), roundtrip_ok);

    // ---- SVG export --------------------------------------------------------
    let svg = export_svg(&doc.pages[0], &vars);
    std::fs::write("export_page1.svg", &svg).ok();
    println!("svg export:  {} bytes -> export_page1.svg", svg.len());

    // ---- prototype playback ------------------------------------------------
    let proto_doc = Node::frame("proto", 2000.0, 700.0)
        .child(doc.pages[0].clone())
        .child(doc.pages[1].clone());
    let mut player = Player::new(&proto_doc, "page-1");
    let title_pos = {
        let f = arco_native::editor::find(&proto_doc, "page-1").unwrap();
        let t = arco_native::editor::find(f, "title").unwrap();
        Point::new(t.transform.x + 10.0, t.transform.y + 10.0)
    };
    let ms = player.click(title_pos);
    let after_click = player.current.clone();
    player.back();
    println!("prototype:   click title -> {} (transition {:?}ms), back() -> {}", after_click, ms, player.current);

    // ---- spatial index at 100K ---------------------------------------------
    let big = arco_native::benchmark_scene(100_000);
    let t0 = std::time::Instant::now();
    let grid = SpatialGrid::build(&big, 256.0);
    let built = t0.elapsed();
    let t1 = std::time::Instant::now();
    let hits = grid.query_point(Point::new(1000.0, 1000.0)).len();
    let q = t1.elapsed();
    println!("spatial:     100K nodes indexed in {:?}, point query {:?} ({} hits)", built, q, hits);
    // linear hit test comparison
    let t2 = std::time::Instant::now();
    let _ = hit_test(&big, Point::new(1000.0, 1000.0));
    println!("             vs full-tree hit_test {:?}", t2.elapsed());

    // ---- copy/paste/duplicate (Phase 2.7) -----------------------------------
    ed.selection = vec!["card".into()];
    ed.copy();
    let pasted = ed.paste("page-1", (24.0, 24.0));
    println!("copy/paste:  pasted ids={:?}, undoable={}", pasted, { ed.undo(); arco_native::editor::find(&ed.root, "card-copy").is_none() });

    // ---- editable vectors (Phase 2.6) ----------------------------------------
    let star = Node::vector("star", 0.0, 0.0, 100.0, 100.0, vec![
        arco_native::PathCmd::MoveTo(50.0, 0.0),
        arco_native::PathCmd::LineTo(79.0, 91.0),
        arco_native::PathCmd::LineTo(2.0, 35.0),
        arco_native::PathCmd::LineTo(98.0, 35.0),
        arco_native::PathCmd::LineTo(21.0, 91.0),
        arco_native::PathCmd::Close,
    ]);
    let (_, vs) = build_scene(&star, None, &vars);
    println!("vector node: star path -> {} draw path(s)", vs.paths);

    // ---- SVG import (Phase 7.4) ----------------------------------------------
    let reimported = arco_native::fileio::import_svg(&svg).expect("re-import own export");
    let (_, ris) = build_scene(&reimported, None, &vars);
    println!("svg import:  re-imported own export -> {} nodes, {} paths", ris.nodes, ris.paths);

    // ---- smart animate (Phase 8.3) --------------------------------------------
    let from = Node::frame("s1", 400.0, 400.0).child(Node::rect("box", 0.0, 0.0, 100.0, 100.0, Color::rgb8(255, 0, 0)));
    let to = Node::frame("s2", 400.0, 400.0).child(Node::rect("box", 200.0, 100.0, 200.0, 100.0, Color::rgb8(0, 0, 255)));
    let mid = arco_native::editor::smart_animate(&from, &to, 0.5);
    let b = arco_native::editor::find(&mid, "box").unwrap();
    println!("smart anim:  t=0.5 -> x={} w={} fill={}", b.transform.x, b.w,
        if let arco_native::Paint::Solid(c) = &b.fill { arco_native::color_to_hex(*c) } else { "?".into() });

    // ---- dev mode -----------------------------------------------------------
    let css = arco_native::editor::node_to_css(arco_native::editor::find(&ed.root, "card").unwrap(), &vars);
    println!("dev mode CSS for #card:\n{css}");

    // ---- stress (unchanged from v0.3) ---------------------------------------
    for n in [10_000usize, 50_000] {
        let (s, st) = build_scene(&arco_native::benchmark_scene(n), None, &vars);
        println!("stress {} nodes: encoded={} paths={} vello_paths={}", n, st.nodes, st.paths, s.encoding().n_paths);
    }
}
