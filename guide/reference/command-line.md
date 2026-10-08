---
title: Command line
description: Read and edit saves and scenarios from a terminal with the sgf tool.
aliases: [cli, sgf, terminal, script, json, apply, batch, automation, add-system, export-scenario]
---
# Command line

The `sgf` tool reads saves and scenarios from a terminal and applies
edits to them. It is on the
[Releases page](https://github.com/IanHeinrich/stellaris-galaxy-forge/releases)
beside the app. System ids are the numbers shown as `#123` in the app.
`sgf --help` lists every command, and `sgf <command> --help` its options.

## Commands

- Read a file: `inspect`, `validate`, `details`, `special`,
  `special-layouts`, `gamedata`. `special-layouts` lists the layouts a
  system can be rerolled from, and how many systems in the save already
  use each. `shape` and `roundtrip` check a save's structure: `shape`
  lists every key path with its count, and `roundtrip` writes the save
  out unchanged.
- Make a scenario: `export-scenario <sav> <out>` and
  `new-scenario <name> <out>`. Add `--profile paint-a-galaxy` to write
  it for Paint a Galaxy.
- Prepare a scenario for a new game: `prepare <scenario> --preset
  faithful|fresh|shell`. The presets are Keep everything, Keep the galaxy
  and Keep the layout from
  [Prepare for a new game](../scenario/prepare.md). `--row <row>=<choice>`
  sets one row's choice over the preset's, and you can repeat it.
- Edit a save or scenario: `apply <file> <edit.json>...`.
- Edit with what the install says: `add-system` and `add-body` roll a
  system or a body from the install's rules. `planet-class` changes a
  planet's class and `nebula add` names a new nebula the way the app
  does.
- Copy planets: `copy-planet <sav> --body 99,402 --to 216` copies the
  planets, each with its moons, into system 216. `--at RADIUS,ANGLE`
  places a single copy, and `--from <other.sav>` copies from another
  save.
- Decode a game texture to a PNG: `texture <key> -o <file.png>`, with a
  key such as `star_class:g_star`.

## Add a system

`add-system <sav>` takes these options:

| Option | Does |
| --- | --- |
| `--seed N` | What the system is rolled from. The same seed gives the same system. |
| `--at X,Y` | Where the system stands. |
| `--lane ID` | A system the new one is joined to by a hyperlane. Repeat it for more. |
| `--star-class sc_g` | Rolls the system around that star class. |
| `--layout NAME` | Builds the system from that initializer, plain or special. |
| `--then-reroll N` | Rolls the system again from seed N before saving, keeping its name, position and lanes. |

For example: `sgf add-system game.sav --seed 7 --at -310,-95 --lane 169 -o out.sav`.

## Edit files

Each edit file holds one change as JSON. `type` is the name of one of
the edits the app makes, and the other fields are its values. This file
moves system 123:

```json
{ "type": "MoveSystem", "system": 123, "x": -150, "y": 80 }
```

`sgf apply game.sav move.json` applies it. Give several files and they
apply in the order listed. A `Batch` holds a list of edits under `ops`
and applies them as one step.

`apply` saves in place with the same backup as the app, or writes
elsewhere with `-o <file>`. If an edit is refused, `apply` names the
file and the edit, and writes nothing. The edits and their fields are the
`Op` enum in `crates/sgf-core/src/ops/op.rs`.

`add-system --print-spec` prints a rolled system as JSON.
Put it under `spec` in an `AddSystemFromSpec` edit to add the system
after you change it.
