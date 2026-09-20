# `app/`

The Vite + React + TypeScript frontend, and `src-tauri/`, the Tauri crate that
is the only IPC surface between it and the Rust core.

`src/` is split by layer, and a layer may only import from the ones below it:

- `api/`: one function per Tauri command, and nothing else.
- `store/`: the session's state and the actions the UI calls: open, edit,
  undo, save, and what is selected and shown.
- `lib/`: what the data means: pure helpers over the generated types, the
  maths, and how it all looks.
- `map/`: the PixiJS renderer: the camera, hit-testing, the interactions and
  one class per drawn layer.
- `panels/`: the React tree around the map: the top bar, the dock, the
  inspector, the browsers, the overlays and the open screen.
- `generated/`: the IPC types ts-rs writes from the Rust crates. Never
  hand-edited; `cargo test --workspace` rewrites them.

[`src/lib/README.md`](src/lib/README.md) states the import rule in full, with
the two exceptions `eslint.config.js` allows.
[`src/panels/README.md`](src/panels/README.md) says which folder owns which
slice of the UI, and which stylesheet.

Commands run from this directory: `npm test`, `npm run lint`, `npm run build`,
`npm run tauri dev` (one instance per machine).
