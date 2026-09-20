# Architecture

How Stellaris Galaxy Forge holds a document in memory and how an edit
travels from the map to the file. The README has the short version; the
rules every change follows are in [engineering-rules.md](engineering-rules.md).

## The pieces

- **Rust core, `sgf-core`.** Opens a save or a scenario, indexes it, projects
  the galaxy from it, applies edits and writes the file back. It has no
  idea a UI exists.
- **Game data, `sgf-gamedata`.** Reads the user's Stellaris install and
  active mods at runtime: system initializers, star and planet classes,
  localisation, textures, the scripts that place things at game start. A
  file watcher rebuilds the affected registry when a mod file changes.
- **Command line, `sgf`.** The same edits from a terminal, and the test
  harness for the core.
- **Desktop app.** A Tauri 2 shell (`sgf-app`) around a React and
  TypeScript UI with a PixiJS map. The UI never touches bytes: it sends
  edits to the core over IPC and redraws from what comes back.

## What a session holds

```mermaid
flowchart TB
  subgraph disk[On disk]
    Sav[(.sav: zip of gamestate and meta)]
    Txt[(scenario .txt)]
  end
  subgraph session[Session, in memory]
    Bytes[Original bytes: read once, never modified]
    Index[Index: the span of every top-level statement and every id-keyed block]
    Graph[Galaxy graph: systems, lanes, nebulae, countries]
    Details[Details projection: planets, fleets, starbases, built on first use]
    Overlay[Overlay: replacement and inserted bytes, keyed to original offsets]
    History[History: every applied edit with its inverse and description]
  end
  Sav & Txt -->|one linear scan| Bytes --> Index
  Index --> Graph
  Index --> Details
  Apply[Apply an edit] -->|decides the change on| Graph
  Apply -->|writes patches into| Overlay
  Apply -->|pushes the inverse onto| History
  Overlay -->|re-read touched statements| Graph
  Bytes & Overlay -->|spliced in one pass, backup first| Save[Save] --> Sav & Txt
  UI[React panels and PixiJS map] -->|edits over IPC| Tauri[Tauri commands] --> Apply
  CLI[sgf command line] --> Apply
  subgraph gamedata[sgf-gamedata]
    Install[Your install and mods: definitions, names, art]
  end
  Install --> UI
  Install --> Details
```

**Original bytes.** A save is a zip with two members, `gamestate` and
`meta`; a scenario is a plain text file. Whichever it is, the text is
inflated or read once and held unchanged for the life of the session.

**Index.** One linear pass over the text records the byte span of every
top-level statement and, inside the sections that hold entities, the span
of every id-keyed block. Structure comes from counting braces; the game
writes keys at column 0 at any depth, so indentation means nothing. The
index is the only structure the editor keeps about the file as a whole:
there is no typed model of it and nothing is ever serialised from one.

**Projections.** The galaxy graph is read from the index: systems with
their positions and lanes, nebulae with their members, countries with the
systems they own. The details projection (planets, deposits, fleets,
starbases, archaeological sites) is built the first time something asks
for it. Both are caches: an edit updates or invalidates them, and they are
never written back.

**Overlay.** Every edit writes its replacement bytes into the overlay,
keyed to the offset of the statement it replaces in the original, or, for
a new statement, to the offset it is inserted at plus a sequence number.
One slot per statement; a later edit to the same statement replaces the
slot. The original bytes are never modified.

**History.** Applying an edit records the edit, a description for the
change log, its inverse, and the slot contents it displaced. Undo applies
the inverse; redo applies the edit again.

## An edit, end to end

1. The UI or the CLI sends an edit: move system 419 to (x, y).
2. The core decides what changes on the galaxy graph: the system's
   position, and the stored length of each of its lanes on both ends.
3. The format writes the bytes for each touched statement and puts them in
   the overlay. Emitted text copies the indentation of the statement it
   replaces.
4. The graph re-reads the touched statements so the map and the inspector
   show the new state.
5. The inverse (move it back, restore the lengths) goes onto the history.
6. The validator runs over the graph and reports what the game could not
   cope with.

On save, the core streams the original bytes from start to end, emitting
each overlay slot in place of the original span it replaces (or at its
insertion offset), into a new file beside the old one; the old file is
renamed to `<name>.sav.bak-<stamp>` and the new one moved into place.

## The format seam

A save and a scenario share the byte model, the index, the graph, the
edits and the history. The differences are behind one trait, `Format`:
which statements hold systems, lanes and nebulae; which edits the format
supports (a scenario can add and remove systems and set what they spawn,
a save cannot; a save carries lane lengths, a scenario does not); and how
each edit's bytes are written. Edits decide on the graph; the format
writes the bytes.

## Layers of the app

`app/src` is split by layer, and a layer may only import from the ones
below it: `api/` (one function per Tauri command), `store/` (session state
and the actions the UI calls), `lib/` (pure helpers over the generated
types), `map/` (the PixiJS renderer), `panels/` (the React tree around the
map), and `generated/` (the IPC types ts-rs writes from the Rust crates).
`app/src/lib/README.md` and `app/src/panels/README.md` state the rule and
its exceptions.
