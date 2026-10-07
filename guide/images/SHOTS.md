---
search: false
---
# Screenshot register

Every image in the guide, the page it is on and how to take it again
after the UI changes. Keep the file name when you retake a shot, so the
pages don't need editing.

## How the shots were taken

- The installed app, not `npm run tauri dev`, in a 1600×1000 window on
  Windows, dark theme.
- Game data from Stellaris 4.5.1 with no mods enabled. The status bar
  reads "Game data v4.5.1 · 0 mods".
- The Paint a Galaxy mod was installed but not enabled in the playset,
  which is why several dialogs show the orange "installed but not
  enabled" line. Keep that state if you retake those dialogs.
- Saved as PNG at 1x, cropped to the part of the window the page talks
  about.
- Numbered marks are not drawn into the images. A page wraps the image in
  `<Annotated>` and gives each mark's position in the image's own pixels.
  A retaken shot keeps its marks as long as the panel's layout is the
  same. If the layout moves, update the positions on the page.
- Always work on copies of the sample files in `testdata/`:
  - `4.5-day-one.sav` for every save shot unless a row says otherwise.
  - `4.4-early.paint.txt` for the Paint a Galaxy scenario shots.
  - `4.4-early.sav` for the export report and the orbit radii shot.
  - `4.4-early.scenario.txt` for the plain-scenario warning.

Several save shots follow from the same two edits on the 4.5 save. Draw
a lane from Xraneax #322 to Usksion, then add a Class M Red Giant with
no lanes at an empty spot left of the core. It becomes Alphecca #601.
The Issues, Changes and added-system shots show those edits.

## Get started

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `start/open-screen.png` | `start/open.md` | The Open screen on All, with Recent, Saves and the details pane | File → Open… with a copy of the 4.5 save in the game's save folder. Select it in Recent. The list shows whatever saves the machine has. |
| `start/open-mode.png` | `start/open.md`, `scenario/paint-a-galaxy.md` | "Open 4.5-day-one.sav" with Edit as save and Edit as scenario | Double-click the 4.5 save on the Open screen. Hover Edit as scenario so its checkbox shows. |
| `start/window.png` | `start/the-window.md` | The whole window, numbered by the page through `<Annotated>` | The 4.5 save with Soukias #576 selected, Tilt at 0°. |
| `start/file-menu.png` | `start/the-window.md` | The File menu with Open recent | Open the File menu with the Paint a Galaxy scenario open, after opening 4.4-early, 4.5-day-one and a copy of the 4.5 save. |
| `start/game-data-panel.png` | `start/game-data.md` | The game data menu with the install path and no mods | Click "Game data v4.5.1 · 0 mods" in the status bar. |

## Find your way

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `map/map-zoomed-in.png` | `map/navigate.md` | The map zoomed in on names, resource counts and height rings | Zoom in on Xraneax, selected, with Names, System details and Heights on. Alphecca shows its added mark on the left. |
| `map/search.png` | `map/search.md` | Search for "gaia" with its results and rings | Press F and type `gaia`. Crop to the top bar, the results and the map under them. |
| `map/pinned-rings.png` | `map/search.md` | The orange rings of a pinned "gaia" search | Pin `gaia` with Ctrl+Enter, close search and press Home. |
| `map/pinned-searches.png` | `map/search.md` | The Pinned tab with the "gaia" pin open | Open the Pinned tab in the dock and expand the pin. |
| `map/layers-menu.png` | `map/layers.md` | The Layers menu in a save | Open Layers in the top bar with the default layers plus Pinned searches. |

## Edit the map

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `edit/selected-system-ring.png` | `edit/select-and-move.md` | A selected system's yellow ring | Click a star and crop close around it. |
| `edit/system-inspector.png` | `edit/select-and-move.md` | A system's Overview tab | Select Soukias #576 and crop the dock. |
| `edit/lane-drawn.png` | `edit/hyperlanes.md` | A newly drawn lane | Zoom in and drag from Xraneax's ring to Usksion. |
| `edit/lane-menu.png` | `edit/hyperlanes.md` | The right-click menu on a lane | Right-click the Usksion to Xraneax lane. |
| `edit/system-menu-save.png` | `edit/hyperlanes.md` | The right-click menu on a system in a save | Right-click Xraneax. |
| `edit/add-system-menu.png` | `edit/add-systems.md` | Add system here with the star classes | Right-click empty space and hover Add system here. |
| `edit/add-system-special.png` | `edit/add-systems.md` | The Special list | As above, then hover Special. Kira, Big Rip System and others show warning marks on this save. |
| `edit/added-system-inspector.png` | `edit/add-systems.md` | An added system's page | Select Alphecca #601 after adding it. |
| `edit/connect-brush-options.png` | `edit/brushes.md` | The Connect lanes brush and its options | Press C with the Size at 40 and hover the tool so its tooltip shows. |
| `edit/paint-brush-options.png` | `edit/brushes.md` | The Paint brush options | In the Paint a Galaxy scenario, press B with Size 400 and Lanes on New and nearby. Crop the option bar. |
| `edit/erase-brush-options.png` | `edit/brushes.md` | The Erase brush options | In the same scenario, press E with Size 400. Crop the option bar. |
| `edit/symmetry-control.png` | `edit/brushes.md` | The Symmetry menu | Click the Symmetry button under the tools with symmetry off. |
| `edit/symmetry-6-fold.png` | `edit/brushes.md` | 6-fold rotation guides over the whole galaxy | In the Paint a Galaxy scenario, pick Rotate 6 and the Paint brush at Size 400. Turn off Names and the Initializers layers, then press Home. |
| `edit/height-brush-options.png` | `edit/heights.md` | The Height brush in Raise mode | Press H, pick Raise, Size 40, Strength 10. Crop the option bar. |
| `edit/height-ripple-options.png` | `edit/heights.md` | The Height brush in Ripple mode | Pick Ripple with the Ripples preset, Size 40. Crop the option bar. |
| `edit/heights-ripple-tilted.png` | `edit/heights.md` | A ripple of raised and sunk systems, tilted | Drop a Ripple at Size 400 around the core, then set Tilt to 37°. |
| `edit/empires-tab.png` | `edit/empires.md` | The Empires tab | Open the Empires tab in the dock. |
| `edit/empire-page.png` | `edit/empires.md` | The player empire's page | Open Test Empire #0 from the Empires tab. Independent map colour is on in this save. |
| `edit/emblem-picker.png` | `edit/empires.md` | The Emblem list open | On Test Empire's page, open Emblem. It opens on the "pointy 24" category. |

## Inside a system

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `system/system-view.png` | `system/system-view.md` | The system view with the dock | Open Xraneax #322 with nothing selected inside it. Full window. |
| `system/orbit-radii.png` | `system/system-view.md` | Orbit radii in a system view | On the 4.4 save, open Amory and press 2. |
| `system/system-view-planet-selected.png` | `system/arrange-planets.md` | A selected planet with its radius line | In Xraneax, click Baloryz. |
| `system/planet-menu.png` | `system/arrange-planets.md` | The right-click menu on a planet | In Xraneax, select Baloryz, TF-B-63 and JQQ-1-6498, then right-click Baloryz. |
| `system/planet-page.png` | `system/planet-pages.md` | A planet's page | Click Baloryz and crop the dock. |
| `system/deposit-picker.png` | `system/deposits-and-modifiers.md` | The Add deposit list | On Baloryz's page, click Add deposit… and hover Hot Springs. |
| `system/edit-several-planets.png` | `system/edit-several-planets.md` | Three planets selected | In Xraneax, Ctrl-click Baloryz, TF-B-63 and JQQ-1-6498. |
| `system/belts-section.png` | `system/belts.md` | The Belts section | Xraneax's page, scrolled to Belts. |

## Build a galaxy

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `scenario/new-scenario-dialog.png` | `scenario/make-a-scenario.md` | The New scenario dialog | File → New scenario… with the defaults. |
| `scenario/export-report.png` | `scenario/make-a-scenario.md` | The Export as scenario dialog | Open the 4.4 save and use File → Export as scenario… |
| `scenario/scenario-window.png` | `scenario/make-a-scenario.md` | A Paint a Galaxy scenario with nothing selected | Open the Paint a Galaxy scenario, press Home and hover the Tiyanki leviathan for its card. Full window. |
| `scenario/game-setup.png` | `scenario/make-a-scenario.md` | The Galaxy and Game setup sections | The same scenario with nothing selected. Crop the dock. |
| `scenario/scenario-top-bar.png` | `scenario/make-a-scenario.md` or the window page | The Scenario, Initializers and Scripts layer groups | Crop the right of the top bar in the Paint a Galaxy scenario. |
| `scenario/paint-mod-not-enabled.png` | `scenario/paint-a-galaxy.md`, `reference/troubleshooting.md` | The warning on opening a Paint a Galaxy scenario | Open the Paint a Galaxy scenario with the mod installed and not enabled. |
| `scenario/plain-scenario-warning.png` | `reference/troubleshooting.md` | The warning on opening a plain scenario | Open the plain scenario with "Don't warn me again" never ticked. |
| `scenario/spawn-point-section.png` | `scenario/spawn-points.md` | A seat's Spawn point section | In the Paint a Galaxy scenario, select a seat and crop the section. |
| `scenario/seat-choices.png` | `scenario/spawn-points.md` | The Seat list open | As above, open Seat. Sol shows "in use". |
| `scenario/scenario-system-inspector.png` | `scenario/fallen-empires-marauders-lgates.md` | A scenario system's page | Select Mar-Adetta #122, which isn't a seat. |
| `scenario/initializer-browser.png` | `scenario/initializers.md` | The initializer browser | Select Mar-Adetta and press Shift+I. basic_init_02 is its current one. |
| `scenario/prepare-section.png` | `scenario/prepare.md` | Prepare for a new game | File → Prepare for a new game… with Keep everything. Crop the dock. |

## Save and avoid problems

| File | Page | Shows | How to take it |
| --- | --- | --- | --- |
| `safety/issues-tab.png` | `safety/issues.md` | The Issues tab on From my edits | After adding Alphecca with no lanes, open the Issues tab. |
| `safety/changes-tab.png` | `safety/undo.md` | The Changes tab with two edits | After the lane and Alphecca edits, open the Changes tab and click the second row. |
