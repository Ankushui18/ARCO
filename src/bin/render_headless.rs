//! Headless GPU render: builds the same demo scene as main.rs, renders it
//! with a real wgpu device (software Vulkan/llvmpipe in this sandbox, a
//! real GPU on an actual machine) via vello::Renderer::render_to_texture,
//! copies the result off the GPU, and writes it as a PNG. This is the
//! strongest verification available without a live window/display: actual
//! rendered pixels, not just "the code compiled" or "the draw-op count was
//! right".
use arco_native::{build_scene, AutoLayout, Color, LayoutDirection, Node, Sizing, Variables, PI};
use vello::{AaConfig, RenderParams, Renderer, RendererOptions};
use wgpu::util::DeviceExt as _;

fn main() {
    pollster::block_on(run());
}

async fn run() {
    let width = 800u32;
    let height = 600u32;

    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::VULKAN,
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: None,
            force_fallback_adapter: false,
        })
        .await
        .expect("no wgpu adapter found (no Vulkan device available)");
    let info = adapter.get_info();
    eprintln!("Using adapter: {} ({:?}, {:?})", info.name, info.device_type, info.backend);

    let (device, queue) = adapter
        .request_device(
            &wgpu::DeviceDescriptor {
                label: None,
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
            },
            None,
        )
        .await
        .expect("failed to create wgpu device");

    // Same demo scene as main.rs's main(), rebuilt here so this binary
    // exercises the real library code, not a re-typed copy. Extended this
    // round to also exercise Instance -> Component resolution with
    // per-instance fill overrides, and a number-variable-driven gap — the
    // two things added to lib.rs this session — so the rendered PNG is
    // real visual proof for those too, not just the earlier rotation/
    // radius/opacity proof.
    //
    // The hidden master component lives OUTSIDE the auto-layout row, as a
    // separate top-level child — apply_auto_layout positions every child
    // of a layout frame regardless of visibility (matches this session's
    // number-variable tests, which only assert on position, not
    // visibility), so a hidden master placed *inside* the row would still
    // consume layout space and push later siblings off-canvas. That's not
    // a rendering bug — first version of this demo scene actually hit
    // exactly this and it's worth knowing about when composing real docs.
    let mut vars = Variables::default();
    vars.numbers.insert("gap-lg".into(), 28.0);

    let mut button = Node::component("btn-def", "Button", 120.0, 60.0)
        .child(Node::rect("btn-bg", 0.0, 0.0, 120.0, 60.0, Color::rgb8(0x33, 0x33, 0x33)).radius(10.0));
    button.visible = false;

    let row = Node::frame("row", 0.0, 0.0)
        .auto_layout(AutoLayout {
            direction: LayoutDirection::Horizontal,
            gap: 20.0,
            padding: 24.0,
            sizing: Sizing::Fixed,
            gap_var: Some("gap-lg".into()),
            ..Default::default()
        })
        .child(
            Node::rect("card", 0.0, 0.0, 200.0, 120.0, Color::rgb8(0x0d, 0x99, 0xff))
                .radius(18.0)
                .rotate(PI / 8.0)
                // v0.4: real drop shadow behind the rotated card
                .effect(arco_native::Effect::DropShadow { dx: 6.0, dy: 8.0, blur: 12.0, color: Color::BLACK }),
        )
        .child(Node::ellipse("dot", 0.0, 0.0, 100.0, 100.0, Color::rgb8(0xf2, 0x48, 0x22)).opacity(0.75))
        .child(Node::instance("btn-1", "Button", 0.0, 0.0, 120.0, 60.0).override_prop("btn-bg", "#2ecc71"))
        .child(Node::instance("btn-2", "Button", 0.0, 0.0, 120.0, 60.0).override_prop("btn-bg", "#9b59b6"))
        .child(Node::instance("btn-3", "Button", 0.0, 0.0, 120.0, 60.0)); // no override -> component's own dark fill

    // v0.4 additions to the visual proof:
    // - a real gradient-filled rect
    // - a Text node that now draws actual vector glyphs
    let gradient_bar = Node::rect("grad", 40.0, 40.0, 380.0, 60.0, Color::WHITE)
        .radius(12.0)
        .fill_paint(arco_native::Paint::LinearGradient {
            start: (0.0, 0.0),
            end: (380.0, 0.0),
            stops: vec![
                (0.0, Color::rgb8(0xff, 0x5a, 0x00)),
                (1.0, Color::rgb8(0x8e, 0x2d, 0xe2)),
            ],
        });
    let title = Node::text("headline", 460.0, 55.0, 320.0, 34.0, "X NATIVE 0.5");

    // v0.5: editable vector path (pen-tool data model) — a real star polygon
    let star = {
        use arco_native::PathCmd::*;
        let mut n = Node::vector("star", 60.0, 420.0, 120.0, 120.0, vec![
            MoveTo(60.0, 0.0), LineTo(75.0, 42.0), LineTo(120.0, 42.0), LineTo(84.0, 69.0),
            LineTo(97.0, 112.0), LineTo(60.0, 85.0), LineTo(23.0, 112.0), LineTo(36.0, 69.0),
            LineTo(0.0, 42.0), LineTo(45.0, 42.0), Close,
        ]);
        n.fill = arco_native::Paint::Solid(Color::rgb8(0xff, 0xd7, 0x00));
        n
    };

    // v0.5: smart-animate mid-frame — red 100px box morphing into a blue
    // 200px box at t=0.5 renders as a purple 150px in-between, live proof
    // the interpolator output is renderable scene content.
    let anim_mid = {
        let from = Node::frame("sa-from", 300.0, 160.0)
            .child(Node::rect("sa-box", 0.0, 0.0, 100.0, 60.0, Color::rgb8(0xff, 0x00, 0x00)).radius(8.0));
        let to = Node::frame("sa-to", 300.0, 160.0)
            .child(Node::rect("sa-box", 120.0, 60.0, 160.0, 80.0, Color::rgb8(0x00, 0x00, 0xff)).radius(8.0));
        let mut mid = arco_native::editor::smart_animate(&from, &to, 0.5);
        mid.transform.x = 280.0;
        mid.transform.y = 420.0;
        mid
    };

    let doc = Node::frame("page", width as f64, height as f64)
        .child(button)
        .child(gradient_bar)
        .child(title)
        .child(star)
        .child(anim_mid)
        .child(row);
    let mut doc2 = doc.clone();
    // apply_auto_layout only acts on frames that carry an AutoLayout, and
    // doesn't recurse into children — call it on "row" specifically, then
    // rebuild doc2's row child with the now-positioned version.
    if let Some(row_child) = doc2.children.iter_mut().find(|n| n.id == "row") {
        arco_native::apply_auto_layout(row_child, &vars);
        row_child.transform.x = 0.0;
        row_child.transform.y = 220.0;
    }
    let (scene, stats) = build_scene(&doc2, None, &vars);
    eprintln!(
        "Scene: nodes={} paths={} culled={} dirty={}",
        stats.nodes, stats.paths, stats.culled, stats.dirty_nodes
    );

    let mut renderer = Renderer::new(
        &device,
        RendererOptions {
            surface_format: None,
            use_cpu: false,
            antialiasing_support: vello::AaSupport::all(),
            num_init_threads: std::num::NonZeroUsize::new(1),
        },
    )
    .expect("failed to create vello Renderer");

    let target_texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("render target"),
        size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let target_view = target_texture.create_view(&wgpu::TextureViewDescriptor::default());

    renderer
        .render_to_texture(
            &device,
            &queue,
            &scene,
            &target_view,
            &RenderParams {
                base_color: Color::rgb8(0x38, 0x38, 0x38),
                width,
                height,
                antialiasing_method: AaConfig::Area,
            },
        )
        .expect("render_to_texture failed");

    // Copy the rendered texture into a CPU-readable buffer.
    let bytes_per_pixel = 4u32;
    let unpadded_bytes_per_row = width * bytes_per_pixel;
    let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT;
    let padded_bytes_per_row = (unpadded_bytes_per_row + align - 1) / align * align;

    let output_buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("output buffer"),
        size: (padded_bytes_per_row * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture: &target_texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer: &output_buffer,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded_bytes_per_row),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
    );
    queue.submit(Some(encoder.finish()));

    let buffer_slice = output_buffer.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer_slice.map_async(wgpu::MapMode::Read, move |result| {
        tx.send(result).unwrap();
    });
    device.poll(wgpu::Maintain::Wait);
    rx.recv().unwrap().expect("buffer map failed");

    let data = buffer_slice.get_mapped_range();
    // Strip row padding back down to the tight width*4 stride PNG expects.
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    for y in 0..height as usize {
        let src_start = y * padded_bytes_per_row as usize;
        let dst_start = y * (width as usize) * 4;
        pixels[dst_start..dst_start + (width as usize) * 4]
            .copy_from_slice(&data[src_start..src_start + (width as usize) * 4]);
    }
    drop(data);
    output_buffer.unmap();

    let img_data = pixels;
    let file = std::fs::File::create("render_output.png").expect("failed to create render_output.png");
    let w = std::io::BufWriter::new(file);
    let mut encoder = png::Encoder::new(w, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().expect("failed to write PNG header");
    writer.write_image_data(&img_data).expect("failed to write PNG data");
    eprintln!("Wrote render_output.png ({}x{})", width, height);
}
