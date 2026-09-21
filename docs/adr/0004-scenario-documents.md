# ADR 0004: Scenario documents

Accepted

## Context

Stellaris reads static galaxy layouts from `map/setup_scenarios/*.txt`: a `static_galaxy_scenario` block of
`system`, `add_hyperlane` and `nebula` statements, as against the dynamic shape a `setup_scenario` block
describes. Vanilla ships one example, commented out, so real layouts are third-party mod content, which is the
same job as a save: hold arbitrary bytes, change a few statements, preserve the rest. It differs in that the
file is small, has no top-level sections to index, and must allow adding a system from the start.

## Decision

A scenario is a second document kind over the byte model of ADR 0001. Which kind a file holds is sniffed from
its first bytes, a zip magic meaning a save, so a `.txt` renamed from a `.sav` still opens correctly. The body
is indexed with the scanner in the script mode ADR 0002 added, every statement is a statement span, and the
map from system id to statement is rebuilt from the bytes currently standing for each statement after a
structural edit and after undo or redo. A statement an op adds is an ordinary overlay slot,
`Anchor::Inserted`, at the line before the block's closing brace and ordered by a `seq` that is never reused,
with a second insertion point for header keys; removing a statement empties its slot whether the file came
with it or an op added it.

`Format` is the single seam between the two kinds (`sgf-core/src/format/mod.rs`). There is one `Op` enum and
one graph: an op decides on the graph, and the format projects that graph, parses a statement, finds the
statement a subject lives in, refreshes what an edit touched, says whether it takes the op at all, turns it
into byte splices, writes the file back, names the document, reports its own issues and declares its
`Capabilities`, which the app reads per open document instead of guessing from the extension. What the writers
absorb is `position` against `coordinate`, one standalone `add_hyperlane` against `hyperlane` entries carrying
a `length` at both ends, and nebula membership by radius alone against a written member list. Ten ops are
scenario-only: `AddSystem`, `RemoveSystem`, `SetSystemName`, `SetInitializer`, `SetInitializers`,
`SetHeaderField`, `SetSpawnWeight`, `SetSpawnWeights`, `PreventLane` and `UnpreventLane`. Four are save-only,
because a scenario lane carries no length: `SetLaneLength`, `SetLaneLengths`, `NormaliseLaneLength` and
`NormaliseLaneLengths`, and a bridge lane is refused for the same reason.

One generator serves the three ways to reach a scenario (`sgf-core/src/export.rs`): exporting the open save's
galaxy to a file, starting a new empty one from a header, and opening a `.sav` as an unsaved scenario named
after its file stem. A save is never rewritten as a scenario in place and is only read. A scenario holds no
planets, stations or fleets of its own, so what a system contains comes from the initializer it names,
resolved through game data (`sgf-gamedata/src/initializers.rs`).

Three things are read but not edited. `coordinate_transform` is preserved and its positions shown
untransformed, with a warning, since evaluating it would mean interpreting arbitrary script. A range position,
`x = { min max }`, is read at its midpoint, also with a warning, and fixed to a point once the system moves.
`z` is ignored, the editor being two-dimensional. A scenario `position` and a save's `coordinate` share their
axes: an exported scenario loaded in the game matched the save's galaxy with no mirroring, so
`SCENARIO_X_SIGN` and `SCENARIO_Y_SIGN` are both `1.0`, kept in one place as the only conversion between a
scenario's coordinates and the map's.

## Consequences

- The scanner, the overlay and undo are shared by two grammars, through a trait every op is planned twice.
- Insertion slots are load-bearing rather than deferred, so adding a system to a save has its mechanism
  waiting.
- `Capabilities` is part of the IPC surface, so the app must read it per document.
- A scenario system is only as legible as the user's install makes it, its contents living in the initializer
  rather than the file.
