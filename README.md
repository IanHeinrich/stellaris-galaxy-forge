# Stellaris Galaxy Forge

A desktop editor for the Stellaris galaxy map, for both **static
scenarios** and **save files**. In a `.sav` file you can move systems,
add and cut hyperlanes, and add, resize and remove nebulae, then carry
on playing the campaign. A static galaxy scenario script
(`map/setup_scenarios/*.txt`) is the file a new campaign's galaxy can be
generated from. In one of those you can do all of the above plus add,
name and remove systems, choose what each one spawns by setting its
initializer, set spawn points and weights, bar lanes the generator must
not draw, and edit the header. A new campaign then starts from a galaxy
drawn by hand.

## Limitations

Beta. Only the galaxy map is editable today: empires, pops, fleets
and techs are not. Save editing is the better tested half. It works on
Stellaris 4.x saves. I have checked it in-game on 4.4.6 and 4.5.0, with
all DLC and no mods.
I haven't tested Ironman saves. I have checked scenario editing in-game
on the same two versions, on the maps of a few large mods and on saves
exported as scenarios, but it is newer and has had less use. Anything
the editor reads from scripts and events is a best guess. It follows
initializers, star flags and event targets, cannot follow scripts that
iterate over classes of systems or address them by name, and reads
conditions as if they were true. macOS builds are published unsigned.

What the editor can change vs what it only shows:

| | In a save | In a scenario |
|---|---|---|
| System positions | editable | editable |
| Hyperlanes: add, cut, isolate | editable | editable |
| Lane lengths | editable | not in the file |
| Nebulae: add, move, resize, rename, remove | editable | editable |
| Systems: add, remove, rename | shown | editable |
| Which initializer a system uses | shown | editable |
| The initializer itself (its star, planets, resources) | shown | shown, never written: initializers belong to the game and mod files |
| Spawn points, weights | not in the file | editable |
| Prevented lanes, header keys | not in the file | editable |
| Planets, deposits, colonies | shown | shown, from the initializer |
| Fleets, starbases, waystations | shown | not in the file |
| Empires and territories | shown | shown, from scripts, best guess |
| Bypasses: wormholes, gateways, L-Gates | shown | shown, from initializers and scripts, best guess |
| Flags | shown | shown |
| Pops, techs, leaders, ships, diplomacy | not shown | not in the file |

A game update is unlikely to break the editing itself. The galaxy editing
depends only on the text form of the galaxy statements in the save
(`galactic_object`, `hyperlane`, `nebula`) and on brace structure, both
of which have been stable across Stellaris versions. Anything the editor
does not understand is copied through untouched. What an update is most
likely to break is the layers drawn on top of the map from your install:
star and planet art, localised names, special-system detection, script
reading and initializer details. Those fall back to the procedural stars
and generated names rather than corrupting anything.

## Safeguards

- The file is edited as bytes. Only the statements you changed differ.
  Everything else, including anything from mods or a newer game version
  the editor does not understand, is copied out byte for byte. A load
  then save with no edits is byte-identical.
- Every save leaves the previous file beside it as a timestamped backup,
  eight per file at most.
- Every edit is undoable and listed in a change log.
- A validator flags anything the game could not cope with, before you
  save.

![The whole galaxy with empire territories drawn](docs/media/galaxy.png)

## In a save

![Moving a system, drawing a lane, cutting a lane and connecting a selection](docs/media/save-editing.gif)

Move a system and its lanes come with it. Draw a lane by dragging from
the ring that appears around a star when you zoom in. Cut a lane at its
midpoint. Select a cluster and connect it as a mesh, or cut every lane
between its members. Nebulae are dragged by their ring and resized by
the handles that appear on it when one is selected.

<p>
  <img src="docs/media/system-details.png" height="220" alt="A system zoomed in on the map: its star, name plate, station and resource counts">
  <img src="docs/media/layers-menu.png" height="420" alt="The Layers menu: map layers, overlays and editing highlights, each with its number key">
</p>

The map draws each system's planets, stations and resources as you
zoom in, with the art and names from your own install. The Layers menu
switches each drawn layer on and off, with a number key for the main ones.

## In a scenario

![Adding a system, setting a spawn point, preventing a lane and browsing initializers](docs/media/scenario-editing.gif)

Right-click empty space to add a system. Pick what it spawns from the
initializer browser, which lists everything your install and mods
define. Mark spawn points. Bar a lane the generator must never draw. A
save can be opened as a scenario. An empty scenario or one from a
paint-a-galaxy export can be started from the New scenario dialog.

<p>
  <img src="docs/media/inspectors.png" height="420" alt="The inspector for a save system beside the inspector for a scenario system: position, hyperlanes, planets, fleets and flags on one side, spawn point, initializer, the planets it will spawn and the lanes it prevents on the other">
  <img src="docs/media/scripts-tab.png" height="200" alt="The Scripts tab listing the initializer and scripted effects that touch a system, with the file and line each comes from">
</p>

The inspector shows everything a save holds about a system, or what a
scenario system will spawn before the game is ever started. The Scripts
tab lists the initializer, events and effects that reach it, with the
file and line each comes from. That list
is a best guess (see Limitations).

## Scope

A save is a game in progress, and a wrong byte in the wrong place can do
strange things to it. I add a new kind of edit once I understand it
against the game's own behaviour. It also has to be checked in-game,
undoable, and finished in the app rather than half-exposed.

Reading a save or a scenario carries no risk, so I add to what the
editor shows more readily. Seeing planets, fleets, ownership and what a
script will do on day one helps you make better edits.
Expect the inspector and the map layers to get ahead of what can be
changed.

How far editing goes depends on two things. One is how well the current
model holds up across game updates. The less it costs to keep working,
the more room there is to extend it. The other is what people ask for.

## Installing

Download the latest release from
[the Releases page](https://github.com/IanHeinrich/stellaris-galaxy-forge/releases).

- Windows: `Stellaris-Galaxy-Forge-<x.y.z>-Windows-Installer.exe`. It is
  signed by "Open Source Developer, Ian Heinrich". While the certificate
  is new, Windows SmartScreen may still warn before it runs. Click "More
  info", then "Run anyway".
- Windows, without installing:
  `Stellaris-Galaxy-Forge-<x.y.z>-Windows-No-Install.zip`. Unzip it and
  run the app inside. It needs the WebView2 runtime, which Windows 11
  already has.
- Mac: `Stellaris-Galaxy-Forge-<x.y.z>-Mac.dmg`, for Intel and Apple
  silicon Macs. It is not signed, so Gatekeeper will refuse to open it
  until you run `xattr -cr "/Applications/Stellaris Galaxy Forge.app"`,
  or right-click the app and choose Open.
- Linux: `Stellaris-Galaxy-Forge-<x.y.z>-Linux.AppImage`, which needs
  `chmod +x` before it will run, or the `Linux-Debian-Ubuntu.deb` or
  `Linux-Fedora.rpm` package. All are built on Ubuntu 22.04, x86_64.

The app checks for a newer release when it starts (the Help menu can turn
this off, and "Check for updates…" checks right away) and shows a badge
when one is found. The Windows installer or MSI, the Linux AppImage and
the Mac app install the update themselves and restart. The no-install
zip and the `.deb`/`.rpm` packages send you to this page instead. Every
update is verified against the project's public key before it is applied.
The SmartScreen warning above applies to the downloaded installer too.

`SHA256SUMS` in the release lists a checksum for every file, so you can
verify a download before running it.

## Building from source

Prerequisites:

- Rust, stable, via [rustup](https://rustup.rs).
- Node 22.
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)
  for your platform. On Windows that is the Visual Studio C++ build tools
  and the WebView2 runtime, which Windows 11 already has. On Ubuntu the
  packages CI installs are `libwebkit2gtk-4.1-dev libappindicator3-dev
  librsvg2-dev patchelf` (see `.github/workflows/ci.yml`).

Then:

```
git clone https://github.com/IanHeinrich/stellaris-galaxy-forge
cd stellaris-galaxy-forge
git lfs install          # the sample save in testdata/ is stored with Git LFS
cd app
npm install
npm run tauri dev        # builds the Rust core and opens the app
```

The first build compiles the Rust core and takes a few minutes. Later
starts are quick. `git lfs install` is only needed for the sample save
the tests use, not to run the app. To make an installer for your
platform instead, run `npm run tauri build` in `app/`. The bundles land
under `target/release/bundle/` at the repository root.

## Getting started

Start the app. It opens on a list of what it found on this machine, so
pick a save from it: the rows carry the empire, the in-game date and the
game version. The galaxy fills the window. Hold the middle mouse button
and drag to pan, or use W A S D, and use the wheel to zoom.

Drag a star to a new position and let go. Zoom in on it until a ring
appears around it, then drag from that ring to another system to draw a
lane. Ctrl+Z takes either edit back. Ctrl+S writes the save, and the
status bar names the backup it left beside it.

Everything else is in the [user guide](docs/user-guide.md).

## How it works

The file is never rebuilt. When you open a save or a scenario, its bytes
are read once and kept exactly as they are. One pass over the text
records where every statement starts and ends by counting braces, and
from that the galaxy map is drawn. Nothing is parsed into a model of the
whole file, so nothing the editor does not understand can be lost or
reordered.

When you make an edit, only the statements that edit touches are
rewritten: a moved system's coordinates, a lane's two entries, a nebula's
member list. The new bytes are kept in a patch list, keyed to where the
old bytes sat in the original file. Every edit records how to undo
itself, so undo and redo are edits too. Saving writes the original bytes
out again into a new file, with the patches spliced in at their offsets.
It then renames the old file to a backup and moves the new one into
place, keeping the original, the newest three and a spread of the rest.
Open and save with nothing changed and the output is byte-for-byte
the input.

```mermaid
flowchart LR
  File[(.sav or scenario .txt)] -->|read once, kept as is| Bytes[Original bytes]
  Bytes -->|one pass, brace counting| Map[Galaxy map]
  Map -->|you edit| Patches[Patches keyed to original offsets]
  Bytes --> Save[Save: bytes with patches spliced in]
  Patches --> Save
  Save -->|backup first| File
```

Game definitions, localisation and textures are read from your own
Stellaris install and its active mods when the app runs. Nothing from the
game is bundled. The full picture, with what the editor holds in memory
and how the pieces relate, is in [docs/architecture.md](docs/architecture.md).
The rules every change follows are in
[docs/engineering-rules.md](docs/engineering-rules.md), and the measured
facts about the file format are in
[docs/format-notes.md](docs/format-notes.md).

## Command line

The `sgf` binary does the same edits from a terminal, one command per
edit, with the same backup the app makes. The full list is in the
[user guide](docs/user-guide.md#command-line).

## Contributing

Bug reports, feature requests and pull requests are welcome.
[CONTRIBUTING.md](CONTRIBUTING.md) says what to include in each. Read
[docs/engineering-rules.md](docs/engineering-rules.md) before changing
code. It states the non-negotiables, the layout and how this project
tests.

```
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
cd app && npm test && npm run lint && npm run build
```

Every pull request adds an entry to `CHANGELOG.md` under `## [Unreleased]`
or carries the `skip-changelog` label. The pull request template lists the
in-game checks that go with a change to the galaxy.

## Acknowledgements

- [Paint a Galaxy](https://github.com/oatmealproblem/paint-a-galaxy) by
  Oatmeal Problem (MIT), and its
  [companion mod](https://steamcommunity.com/sharedfiles/filedetails/?id=3532904115)
  on the Steam Workshop. Custom static galaxies for regular play are not
  possible without that mod: the game's own generator breaks on a
  hand-made map (wrong homeworlds, no marauders, no fallen empires,
  Sol without its neighbours), and the mod fixes each of those in script.
  Everything this editor writes for a playable scenario, from the seat
  scripts to the fallen empire zones and wormhole pairs, is the mod's
  format, and its scripts and source were the reference for how they
  behave. The New scenario dialog links to the site and opens its export.
- The facts about the save format and the install were measured from the
  game's own files. For the edge cases of how mods layer over the install
  (load order, `replace_path`) and of the script dialect,
  [Irony Mod Manager](https://github.com/bcssov/IronyModManager),
  [CWTools](https://github.com/cwtools/cwtools) and
  [jomini](https://github.com/rakaly/jomini) were the references checked
  against. No code from any of them is used.
- The libraries doing most of the work in the app:
  [Tauri](https://tauri.app), [React](https://react.dev),
  [PixiJS](https://pixijs.com),
  [Zustand](https://github.com/pmndrs/zustand) and
  [Delaunator](https://github.com/mapbox/delaunator). In the tests,
  [insta](https://insta.rs) and
  [proptest](https://proptest-rs.github.io/proptest/).

Nothing from the game is bundled. Stellaris is a Paradox Interactive
title. This project is not affiliated with or endorsed by Paradox.
