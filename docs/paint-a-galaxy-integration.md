# Paint a Galaxy integration

What Stellaris Galaxy Forge writes and reads for Paint a Galaxy (PaG,
`oatmealproblem/paint-a-galaxy`, MIT), and a proposal for embedding the site
inside Forge with a postMessage protocol between the two. Audience: the Paint
a Galaxy maintainer and Forge contributors.

## Protocol

Neither side implements this yet: it stays here as a proposal for the
Paint a Galaxy maintainer.

Forge would load PaG in an iframe at:

```
<PaG URL>?embeddedMode=true&parentAppName=Stellaris%20Galaxy%20Forge
```

PaG is a hash router, so both query parameters must precede the `#`.
`parentAppName` is whatever the host calls itself; PaG never hardcodes a
host's name and uses the parameter for its own labels ("Send to Stellaris
Galaxy Forge").

PaG, when `embeddedMode=true`, replaces Download with "Send to
`<parentAppName>`" and posts the galaxy with
`window.parent.postMessage(message, "*")`. The target is `"*"` because
Forge's origin differs per platform (`http://tauri.localhost`,
`tauri://localhost`, `http://localhost:1420` in dev) and the message text is
not secret. External links (Community menu, the Workshop link in the Tweak
step) open in a new window (`target="_blank" rel="noopener"`) rather than
navigating the iframe.

PaG → Forge, the galaxy itself:

```json
{
  "source": "paint-a-galaxy",
  "type": "galaxy",
  "version": 1,
  "name": "<project name>",
  "txt": "<scenario text>"
}
```

`name` is optional: a missing, non-string or blank `name` would be shown to
the user as "Painted galaxy".

PaG → Forge, optional, posted on load:

```json
{
  "source": "paint-a-galaxy",
  "type": "ready",
  "version": 1
}
```

Forge → PaG, posted to `iframe.contentWindow` with the PaG origin as target,
on receiving `ready`:

```json
{
  "source": "stellaris-galaxy-forge",
  "type": "ready",
  "version": 1
}
```

Forge would accept a message only when all of the following hold: `event.origin`
is the PaG origin, `event.source === iframe.contentWindow`,
`source === "paint-a-galaxy"`, `type === "galaxy"`, and `txt` is a non-empty
string. Unknown `type` values are ignored rather than treated as errors, so
new message types can be added without breaking old hosts. `version` is
carried on every message for the same reason: a host or PaG build reading an
unfamiliar version can fall back instead of failing.

## What Paint a Galaxy needs to change

1. Read `embeddedMode` and `parentAppName` from `window.location.search`
   once at startup (a constant in `src/lib/constants.ts`, or a field on the
   `Editor` in `src/lib/editor.svelte.ts`).
2. `src/routes/sidebar.svelte`, `handle_download()`: in embedded mode, post
   the `galaxy` message to `window.parent` instead of calling
   `download_blob()`. Label the button "Send to `{parentAppName}`" and
   reword the Tweak step's "follow the instructions on the Workshop"
   sentence, which currently assumes a download.
3. `src/routes/header.svelte`: the Community links and the Tweak
   description's Workshop link get `target="_blank" rel="noopener"` in
   embedded mode, or the Community menu is hidden there.
4. Optional: post the `ready` message on load; hide Export JSON and other
   file-system-only items when embedded.
5. README note: inside a host's webview, IndexedDB (`idb-keyval`) is
   partitioned from the user's ordinary browser, so projects painted inside
   the host and on the public site are separate storage. Export JSON /
   Import remain the bridge between them. The companion mod needs no
   change for any of this.

## What Forge writes under the Paint a Galaxy profile

A scenario written without Paint a Galaxy's dialect is byte-identical to one
written before this profile existed. The dialect is chosen by the "For the
Paint a Galaxy mod" checkbox, which the New scenario dialog's blank route and
the Export as scenario dialog share (ticked by default, remembered per
machine), and by the CLI's `--profile paint-a-galaxy` flag on
`export-scenario` and `new-scenario` (default `plain`).
`crates/sgf-core/src/export/paint.rs` is the one module that writes it, laid
over a plain draft; the exact statement shapes below are drawn from it.

The header opens with a comment naming Forge and the mod, then the block
`generate_galaxy_txt.ts` writes for `S` spawn systems and `systems` systems
in total, plus Forge's own `core_radius`:

```
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {
	name = "<name>"
	priority = 10
	supports_shape = elliptical
	supports_shape = spiral_2
	supports_shape = spiral_3
	supports_shape = spiral_4
	supports_shape = spiral_6
	supports_shape = ring
	supports_shape = bar
	supports_shape = cartwheel
	supports_shape = cluster
	supports_shape = starburst
	random_hyperlanes = no
	num_wormhole_pairs = { min = 0 max = 5 }
	num_wormhole_pairs_default = 1
	num_gateways = { min = 0 max = 5 }
	num_gateways_default = 1
	num_hyperlanes = { min = 0.5 max = 3 }
	num_hyperlanes_default = 1
	colonizable_planet_odds = 1.0
	primitive_odds = 1.0
	fallen_empire_max = <min(Z, 6)>
	marauder_empire_max = 3
	extra_crisis_strength = { 10 25 }
	num_empires = { min = 0 max = <S-1> }
	num_empire_default = <S-1>
	advanced_empire_default = <round((S-1)/8)>
	nomad_empire_default = <round((S-1)/10)>
	nomad_empire_max = <S-1>
	fallen_empire_default = <band>
	marauder_empire_default = <band>
	crisis_strength = <band>
	core_radius = <Forge's own>
```

`fallen_empire_default` / `marauder_empire_default` / `crisis_strength` come
from a band on the system count: below 400 systems 0 / 1 / 0.5, from 400 1 /
1 / 0.75, from 600 2 / 2 / 1.0, from 800 3 / 2 / 1.25, from 1000 4 / 3 / 1.5.
`fallen_empire_max` is the number of fallen empire zones the export places,
`Z`, capped at the six kinds the mod knows, and `fallen_empire_default` is
capped at that too. "Update counts" in the editor writes both fallen keys as
`min(Z, 6)` over every zone the map holds, and the validator warns when
`fallen_empire_max` is not that number or `fallen_empire_default` exceeds
the zones.

Spawn systems are the capitals of the playable ("default") countries, union
every system that already carries a Paint a Galaxy script, union every
system with a spawn weight above zero. Each is written, in ascending id
order as position `i`:

```
spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|n| }
```

`n = i % 10`. A system that already carries a preferred, reserved or Sol
script keeps that script's kind and random value rather than being reset to
plain "enabled". A spawn system with no `initializer` is given
`random_empire_init_0N` (`N` = `id % 6 + 1`). Every empty system
within two lane jumps of a spawn, and still without an `initializer`, gets
the mod's random-list filler and the flag that names it automatic:

```
initializer = painted_galaxy_rl_basic
effect = { set_star_flag = painted_galaxy_automatic_initializer }
```

Each wormhole pair (`BypassLink::Wormhole`) is flagged on both ends, `n`
counting the pairs from 1:

```
effect = { set_star_flag = painted_galaxy_wormhole_<n> set_star_flag = empire_cluster }
```

Preferred, reserved and Sol seats are not chosen at export; the seat kind
is changed afterwards in the inspector's Spawn point section. The
custom-initializer flag is not written.

### Fallen empire zones

A zone is star flags on an anchor system:

```
effect = { set_star_flag = painted_galaxy_fe_spawn
           set_star_flag = painted_galaxy_fe_spawn_<e|se|s|sw|w|nw|n|ne>
           set_star_flag = painted_galaxy_fe_spawn_<random|materialist|spiritualist|xenophobe|xenophile|machine|hive>
           set_star_flag = painted_galaxy_fe_spawn_distance_<30..200 step 10>
           set_star_flag = painted_galaxy_fe_spawn_preferred    # placed by the user
           set_star_flag = painted_galaxy_fe_spawn_fallback }   # fill with random systems if unused
```

The zone's centre is the anchor's position plus, for distance `d` and
`k = d/√2`: e (−d, 0), se (−k, +k), s (0, +d), sw (+k, +k), w (+d, 0),
nw (+k, −k), n (0, −d), ne (−k, −k). At game start the mod spawns the
fallen empire's home system there with `spawn_system` at exactly `d` in
that orientation, and its satellites 15–25 units around it. A missing kind
reads as `random`, a missing distance as 40, and Forge reads them the same
way.

Forge edits only the `painted_galaxy_fe_spawn*` flags of the anchor's
`effect` block. Every other flag stays where it is, including the
`painted_galaxy_fe_custom_connection*` flags, which Forge neither writes
nor shows. A zone whose ring of radius 30 would contain a system, or whose
centre lies beyond ±470, is refused. Every change made in Forge sets
`painted_galaxy_fe_spawn_preferred`.

Automatic candidates follow Paint a Galaxy's own rule. For every system
that anchors no zone, in direction order e, se, s, sw, w, nw, n, ne, the
first direction whose centre `C` at distance 40 has `|C| ≥ 130`,
`dist(C, (−420, −420)) ≥ 100`, `|C.x|, |C.y| ≤ 470`, no system within 30
and no accepted zone centre within 60 becomes a `random`, non-preferred
zone. Export as scenario runs it over a save's systems. "Fit fallen
empire zones" (`fe_zone::fit`) removes every non-preferred zone, runs the
rule again and keeps the `count` candidates farthest from each other and
from the preferred zones, as one op. `fe_zone::candidate_count` is the
most it can keep.

## What Forge reads

A system reads as a Paint a Galaxy spawn when its `spawn_weight`'s `add`
scalar starts with `value:painted_galaxy_spawn_weight|`; what follows is
read as `|KEY|value|` pairs (`PREFERRED|yes`, `RESERVED|<letter>`,
`SOL|yes`, `RANDOM_VALUE|n`), and a key this editor does not know is passed
over rather than rejected, so a parameter a later Paint a Galaxy build adds
still reads back as a seat. A reserved seat's letter is written as one
lowercase ASCII letter, matching the star flags Paint a Galaxy itself uses;
on read, whatever follows `RESERVED|` is taken as the letter. Because the
mod resolves the weight from the seat kind rather than from a number,
setting a base spawn weight or a human/AI reservation on a system that
already carries a script is refused; its Paint a Galaxy spawn kind is what
changes instead.

Forge treats a scenario as painted, and turns its Paint a Galaxy layer on,
when the `painted_galaxy_` prefix appears anywhere in the text or the
header carries the comment Forge itself writes under the profile.
