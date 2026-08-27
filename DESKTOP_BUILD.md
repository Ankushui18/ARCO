# ARCO Desktop Build

ARCO is prepared for Tauri 2 desktop packaging while retaining the browser app.

## Requirements

- Node.js 20+
- Rust stable + Cargo
- macOS: Xcode Command Line Tools
- Windows: Visual Studio Build Tools with MSVC + Windows SDK

## Install

```bash
npm install
```

## Browser

```bash
npm run dev
```

## Desktop development

```bash
npm run desktop:dev
```

## Production installers

```bash
npm run desktop:build
```

Windows target:

```bash
npm run desktop:build:windows
```

macOS universal target:

```bash
npm run desktop:build:mac
```

Outputs are generated under `src-tauri/target/release/bundle/`.

## Native file operations

The desktop shell exposes native Open/Save commands through a narrow bridge in
`src/platform.js`. Browser builds keep their existing File System Access/download
fallbacks. Native saves use a temporary file followed by a commit to reduce the
risk of leaving a partially written project after a crash.

## Architecture rule

Do not put editor logic in Tauri/Rust. Keep the document, layout, geometry,
rendering and interaction engines platform-independent. Native code should only
provide OS capabilities such as filesystem dialogs, paths, windowing and later
updates/crash reporting.
