# ADR 0006: Map scenes

Accepted

## Context

The map has only ever drawn the whole galaxy. A player editing a save also wants to look inside one system:
where its planets and moons sit, its asteroid belts, and later to move them. That view needs a different
camera range, its own layers and its own picking, while the galaxy keeps its camera, its layers and the
territory worker it already runs. The ways in and out need to be as quick as selecting a system, and the galaxy
tools must not act on a galaxy the player cannot see.

## Decision

One PixiJS `Application` draws two scenes. A host keeps the `Application`, the ticker, resizing, the wheel and
the held keys. A `GalaxyScene` holds everything the map controller held before. A `SystemScene` has its own root
container, its own `Camera`, its own small layer registry, render context and store bindings. The galaxy layer
registry is built once and kept while a system is shown, because `OwnersLayer` starts a territory worker per
instance. `Camera` is reused unchanged. A small store, `sceneStore`, says which scene the map shows.

The player enters a system by:

- a double-click on it, detected by the gesture model from the time of each click;
- "Open system view" on the system's right-click menu;
- an "Open system view" button in the Planets section header of the system's page;
- "Open system view" in the View menu;
- `Enter` with exactly one system selected.

Inside the scene, a double-click on a hyperlane arrow enters the neighbour. The player leaves by a step in the
`Esc` chain, a floating "Galaxy › name" crumb at the map's top left, "Back to galaxy" on a right click, the View
menu, and `Backspace` when the inspector has no crumb to pop. The scene also leaves when the selection stops
being that one system.

Entering switches the tool to Select and hides the tool rail, since none of its tools applies inside a system.
Undo and redo stay on the Edit menu and their shortcuts. Brushes, symmetry, the galaxy nudge, `Delete`,
`Ctrl+A`, the number keys and the layer toggles do not act on the galaxy while the system scene is up. The
scene's edits, when they come, are gestures of its own select model, not new `Tool` values.

Until the scenario view exists, the ways in are offered on a save only.

## Alternatives considered

- A second `Application` for the system view, in its own canvas or panel. It would need a second WebGL context
  and its own ticker, resize and input handling, and the galaxy's layers would have to be torn down or kept
  running behind it. One host with swapped roots keeps a single context and keeps the galaxy registry alive.
- Rebuilding the galaxy registry on every return. It would restart the territory worker and redraw every
  layer each time the player comes back, so the registry is built once instead.
- The system view as a tool on the rail. A tool changes what a press does on the same map; the system view
  changes what the map shows, and the galaxy tools mean nothing inside it. Treating it as a scene lets the rail
  hide and the keys gate on one flag.
- A single click to enter. Clicking a system already selects it and opens its page, which players use
  constantly, so entering takes a double-click or an explicit command.

## Consequences

- Every key or menu that acts on the galaxy checks the scene, and the tests of the scene store list which do.
- The map area widens by the rail's width while a system is shown, and the host re-applies the viewport on the
  scene change.
- Fit and `Home` act on whichever scene is shown.
- The system scene's gestures are tested without a canvas, as the galaxy's are.
