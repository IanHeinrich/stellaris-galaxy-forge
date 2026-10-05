//! The op vocabulary: every edit the editor can make and the entries its plural ops take.

use serde::{Deserialize, Serialize};
use strum::{IntoStaticStr, VariantNames};
use ts_rs::TS;

use crate::format::save::system_spec::SystemSpec;
use crate::format::scenario::{FeLinkFlags, FeZone};
use crate::ops::OpError;
use crate::projections::galaxy::{LGateOutcome, SpawnScript};
use crate::views::{DocumentKind, OrbitPlacement};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, IntoStaticStr, VariantNames)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Op {
    MoveSystem {
        system: u32,
        x: f64,
        y: f64,
    },
    AddLane {
        a: u32,
        b: u32,
        bridge: bool,
    },
    /// Several lanes from one system as one op: `from`'s new entries are written together, in
    /// the order given, and a system listed twice in `to` is refused. It is what
    /// [`Op::IsolateSystem`] and [`Op::RemoveLanes`] invert to, so that undo puts `from`'s
    /// list back in its order.
    AddLanes {
        from: u32,
        to: Vec<(u32, bool)>,
    },
    RemoveLane {
        a: u32,
        b: u32,
    },
    /// Several lanes of one system as one op, `from`'s entries taken out together. The
    /// inverse is one [`Op::AddLanes`], which puts them back in their order.
    RemoveLanes {
        from: u32,
        to: Vec<u32>,
    },
    SetLaneLength {
        a: u32,
        b: u32,
        length: f64,
    },
    IsolateSystem {
        system: u32,
    },
    /// Several systems moved as one; every lane touching any of them gets its length
    /// recomputed from the new positions of both ends.
    MoveSystems {
        moves: Vec<SystemMove>,
    },
    /// Several unrelated lanes as one op, each system's new entries written together. A lane
    /// listed twice, either way round, is refused. It is what [`Op::RemoveLanePairs`] and
    /// [`Op::IsolateSystems`] invert to.
    AddLanePairs {
        lanes: Vec<LanePair>,
    },
    /// Several unrelated lanes taken out as one op, each system's entries together. The
    /// inverse is one [`Op::AddLanePairs`] that carries each lane's bridge flag.
    RemoveLanePairs {
        lanes: Vec<(u32, u32)>,
    },
    /// Every lane touching any of `systems`; a lane between two of them is removed once.
    /// Systems without lanes are allowed, but the op refuses with
    /// [`OpError::NoLanes`] (naming the first id) when no lane is removed at all.
    IsolateSystems {
        systems: Vec<u32>,
    },
    /// Several lane lengths as one op, each following the [`Op::SetLaneLength`] rules. A lane
    /// listed twice, either way round, is refused. Its own inverse, and what
    /// [`Op::NormaliseLaneLengths`] inverts to.
    SetLaneLengths {
        lanes: Vec<LaneLength>,
    },
    /// One lane's length rewritten to the `floor(distance)` the generator writes, on both
    /// ends; refuses with [`OpError::AlreadyNormal`] when it already stands there. The inverse is
    /// the [`Op::SetLaneLength`] that puts the old length back.
    NormaliseLaneLength {
        a: u32,
        b: u32,
    },
    /// Every lane touching one of `systems` whose length is not `floor(distance)`,
    /// rewritten to it as an integer; refuses with [`OpError::AlreadyNormal`] when none is stale.
    NormaliseLaneLengths {
        systems: Vec<u32>,
    },
    /// The `index`th nebula's centre. Nothing else moves: a save rewrites the member lists
    /// to what the radius now covers, and lane lengths are untouched. Its own inverse.
    MoveNebula {
        index: usize,
        x: f64,
        y: f64,
    },
    /// A new nebula, which lands last and so takes the index `nebulae.len()`. `name` is
    /// the save's `key=` or the scenario's `name =`, empty when `None`. Every system its
    /// radius reaches joins it.
    AddNebula {
        x: f64,
        y: f64,
        radius: f64,
        name: Option<String>,
    },
    /// The `index`th nebula; its members join whatever other cloud covers them. Later
    /// nebulae renumber, so a held index is stale afterwards. The inverse writes the
    /// nebula back, but last rather than where it stood.
    RemoveNebula {
        index: usize,
    },
    /// The `index`th nebula's radius, about its fixed centre; its own inverse.
    SetNebulaRadius {
        index: usize,
        radius: f64,
    },
    /// The `index`th nebula's name, written as it stands: a cloud named by a localisation
    /// key is left naming the text instead. Empty is refused; the inverse carries the name
    /// it displaced.
    RenameNebula {
        index: usize,
        name: String,
    },
    /// A new `system` statement, its id `system` defaulting to one past the highest held.
    /// Scenario documents only; a save adds a system through [`Op::AddSystemFromSpec`]. A weight and a
    /// script together are refused (see [`Op::SetSpawnScript`]).
    AddSystem {
        system: Option<u32>,
        x: f64,
        y: f64,
        name: Option<String>,
        initializer: Option<String>,
        spawn_weight: Option<f64>,
        #[serde(default)]
        spawn_script: Option<SpawnScript>,
    },
    /// A scenario system and every hyperlane statement naming it, `prevent_hyperlane`
    /// included. The inverse is a batch that restores the system's statement text and
    /// each distinct lane and prevented pair between systems the graph holds. Undo through
    /// history stays byte-exact in either kind of document.
    ///
    /// A save removes only a system [`Op::AddSystemFromSpec`] added since the file was opened,
    /// with its bodies, their deposits, its lanes on both ends and its nebula member lines.
    /// A reused slot gets its tombstone back, the name returns to the pool of unused star
    /// or black hole names the add took it from, and `last_created_system` goes down. The
    /// systems added after it take the id below their own, so that ids stay dense. A system
    /// with a wormhole pair, whether removed or renumbered, is refused. The
    /// inverse adds the system again, read back as a spec, at the end of the list, which
    /// joins it to the nebula it stands in; then its bridges, the lane lengths that are not
    /// `floor(distance)`, its nebula footprint and its height are put back. The bytes come back exactly
    /// only for the last system added, with nothing written to its neighbours since. A
    /// lane's entry on the other end comes back last in that system's list. A system taken
    /// from among the added ones comes back at the next id, its bodies and deposits one
    /// generation on in the slots they had. A lane whose two ends disagreed comes back with
    /// one length. Undo through history is byte-exact either way.
    RemoveSystem {
        system: u32,
    },
    /// Several systems as one op, each following the [`Op::AddSystem`] rules with its id
    /// given. An id listed twice is refused. The inverse is one [`Op::RemoveSystems`], and it
    /// is what that op's inverse puts back. Scenario documents only.
    AddSystems {
        systems: Vec<NewSystem>,
    },
    /// Several systems as one undo step, each as [`Op::RemoveSystem`]; a statement naming
    /// two of them is removed once. An id listed twice is refused. The inverse restores
    /// what [`Op::RemoveSystem`]'s does, for every system; undo through history stays
    /// byte-exact.
    RemoveSystems {
        systems: Vec<u32>,
    },
    /// A system's name. In a scenario, the `name` of its `system` statement; empty takes
    /// the statement away, and the game names the system. In a save, only a system
    /// [`Op::AddSystemFromSpec`] added since the file was opened: its own name and the
    /// names of its star, planets and moons, which carry it as text. The old name goes back
    /// to the pool of unused star or black hole names the add took it from, and the new one
    /// leaves whichever of those pools holds it. A save refuses an empty name. The inverse
    /// carries the name displaced.
    RenameSystem {
        system: u32,
        name: String,
    },
    /// The system's `initializer`, which `None` removes. The `spawn_weight` beside it is
    /// not touched: only [`Op::SetSpawnWeight`] writes one. Scenario documents only.
    SetInitializer {
        system: u32,
        initializer: Option<String>,
    },
    /// One header key, scenario documents only: `value` is the raw text right of `=`, and
    /// `None` removes the statement. A repeated key is read and written at its first
    /// statement, the one the game takes. The inverse carries the text displaced.
    SetHeaderField {
        key: String,
        value: Option<String>,
    },
    /// Several header keys as one undo step, each as [`Op::SetHeaderField`] with `Some`.
    /// A key listed twice is refused. The inverse omits a key this added: it describes the
    /// change, and undo puts the bytes back exactly. Scenario documents only.
    SetHeaderKeys {
        entries: Vec<(String, String)>,
    },
    /// Every statement of one repeated header key as one undo step: one per value, in
    /// order, where the first stood, none when `values` is empty. Each value is the raw
    /// text right of `=`; the inverse carries the values held. Scenario documents only.
    SetHeaderList {
        key: String,
        values: Vec<String>,
    },
    /// The `base` of a system's `spawn_weight`: `None` removes it, and the statement with
    /// it when no `modifier` remains. A base that is not a number inverts to `None`.
    /// Scenario documents only.
    SetSpawnWeight {
        system: u32,
        base: Option<f64>,
    },
    /// The scripted seat a system's `spawn_weight` states; `None` removes the statement.
    /// A system with no `initializer` gets the dialect's basic one, which the inverse
    /// omits: undo puts the bytes back exactly. Scenario documents only.
    SetSpawnScript {
        system: u32,
        script: Option<SpawnScript>,
    },
    /// The Paint a Galaxy fallen empire zone a system anchors; `None` clears it. A zone
    /// whose ring holds another system, or whose centre lies off the map, is refused: the
    /// mod builds the fallen empire's systems in that ring. Scenario documents only.
    SetFeZone {
        system: u32,
        zone: Option<FeZone>,
    },
    /// The Paint a Galaxy wormhole pair joining `a` and `b`; `None` unpairs both. The two
    /// must differ and exist, and a number another system carries is refused. The inverse
    /// puts both ends' old pairs back, each as its own entry. Scenario documents only.
    SetWormholePair {
        a: u32,
        b: u32,
        pair: Option<u32>,
    },
    /// One system's wormhole pair alone: what a [`Op::SetWormholePair`] inverts to when
    /// the two ends held different numbers, or one held none. Scenario documents only.
    SetWormholeEnds {
        entries: Vec<(u32, Option<u32>)>,
    },
    /// The systems Paint a Galaxy lays a hyperlane from into the zone `anchor` anchors,
    /// empty to clear; `anchor` must anchor a zone and may not be in `linked`. Inverts to
    /// a [`Op::SetFeLinkFlags`] over the systems written. Scenario documents only.
    SetFeLinks {
        anchor: u32,
        linked: Vec<u32>,
    },
    /// Several systems' custom connection flags, each set exactly as given: what a
    /// [`Op::SetFeLinks`] inverts to, and the way to a state the mod reads oddly, such
    /// as the custom flag without an id. Scenario documents only.
    SetFeLinkFlags {
        entries: Vec<(u32, FeLinkFlags)>,
    },
    /// One `prevent_hyperlane` statement, barring the generator from linking `a` and `b`.
    /// A pair the file already links is refused: a file that both lays and forbids a lane
    /// leaves the generator undefined, so the lane goes first. Scenario documents only.
    PreventLane {
        a: u32,
        b: u32,
    },
    /// Every `prevent_hyperlane` naming `a` and `b`, whichever way round. Scenario
    /// documents only.
    AllowLane {
        a: u32,
        b: u32,
    },
    /// The L-Cluster outcome a save's global flags hold: every outcome flag goes, and the
    /// chosen outcome's flags are written dated like `game_started`. Refused for a galaxy
    /// with no L-Gate and once a gate has opened. Save documents only.
    SetLGateOutcome {
        outcome: LGateOutcome,
    },
    /// A save system's `star_class` and the `planet_class` of each of its star bodies,
    /// each written as given. Which bodies are stars and what they become is the caller's
    /// to say from the install's star classes; each must be one the system lists, once.
    /// The inverse carries the class and body classes displaced. Save documents only.
    SetStarClass {
        system: u32,
        class: String,
        bodies: Vec<StarBody>,
    },
    /// A save planet's `planet_size`, star bodies included, written as given: nothing
    /// holds it to the range its class allows. Zero is refused; the inverse carries the
    /// size displaced. Save documents only.
    SetBodySize {
        body: u32,
        size: u32,
    },
    /// A save planet's timed `modifier`, written as given: one `timed_modifier` item per
    /// entry of `days`, each lasting that many days or `-1` for ever, added last as the
    /// game's `add_modifier` does. With `feature`, a planet feature (`pm_*`) whose static
    /// modifier `modifier` is, its `planet_modifier` line goes before `entity` too, unless the
    /// planet has it, and `days` may be empty. Days are written as given, a negative count
    /// that a save holds included. A system's star is refused, and so are a modifier the
    /// planet has, days of 0, more than `MAX_MODIFIER_COPIES` items and a save before
    /// Stellaris 4.0. The inverse removes what it wrote. Save documents only.
    AddBodyModifier {
        body: u32,
        modifier: String,
        days: Vec<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        feature: Option<String>,
    },
    /// Every `timed_modifier` item naming `modifier` on a save planet, permanent or not, as
    /// the game's `remove_modifier` takes it, and with `feature` every `planet_modifier` line
    /// naming that. A system's star is refused, and so are a planet with neither, an item
    /// whose days are not a number and a save before Stellaris 4.0. The inverse adds back
    /// what it took, each item with its days. Save documents only.
    RemoveBodyModifier {
        body: u32,
        modifier: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        feature: Option<String>,
    },
    /// A save planet's anomaly, `anomaly="<category>"` written after its `planet_orbitals`
    /// as given. Without `found_by`, the planet also goes last in the player's
    /// `events.anomalies` when the player has surveyed it, because the game lists an
    /// anomaly only when a survey turns it up; with it, in the lists of those countries,
    /// each once. A star takes one as any body does. A planet that has an anomaly is refused,
    /// and so is a save before Stellaris 4.0. The inverse removes what it wrote. Save
    /// documents only.
    AddAnomaly {
        body: u32,
        category: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        found_by: Option<Vec<u32>>,
    },
    /// A save planet's anomaly, and the planet from every country's `events.anomalies`,
    /// the list going with its last planet. A planet without one is refused, and so is a
    /// save before Stellaris 4.0. The inverse adds it back with the countries that had
    /// found it. Save documents only.
    RemoveAnomaly {
        body: u32,
    },
    /// An empire's map border and fill, the fifth and sixth entries of its `flag.colors`,
    /// which the game paints its territory in only under `flag.use_map_color=yes`. `Some`
    /// writes both and turns that on; `None` turns it off and mirrors the first two flag
    /// colours into them, as the game does. Needs the six-entry list Stellaris 4.5 writes.
    /// The inverse carries the pair displaced only when map colours were on: it describes
    /// the change, and undo puts the bytes back exactly. Save documents only.
    SetEmpireMapColors {
        country: u32,
        colors: Option<MapColorPair>,
    },
    /// An empire's flag: its emblem, its background file and the first two entries of
    /// `flag.colors`, each written as given. Without `flag.use_map_color=yes`, a fifth or
    /// sixth entry that matched the first or second follows it, as the game keeps them.
    /// The player's empire has its flag in the save's `meta` rewritten the same way, which
    /// the load screen draws. The inverse carries the flag displaced. Save documents only.
    SetEmpireFlag {
        country: u32,
        flag: EmpireFlag,
    },
    /// An empire's name, `country.<id>.name`, written as `{ key="…" literal=yes }` so the
    /// game shows it as typed: a name that is already literal has only its key rewritten,
    /// and any other name is replaced whole. The player's empire also has the gamestate
    /// header's `name` and the `name` in the save's `meta` rewritten, which the load screen
    /// lists the save under. A country without `custom_name=yes` gets it where the game
    /// writes it, so the game keeps the name rather than generating a new one. The
    /// adjective, species names and homeworld name stay. Empty is refused, and so is a
    /// name that changes nothing. The inverse carries the player's old header name, or the
    /// old name, the old `name` value whole when it was not a literal, and `custom_name`
    /// off when the rename added it. Save documents only.
    RenameEmpire {
        country: u32,
        name: String,
        /// The country's whole `name` value, written as it stands in place of the literal
        /// block `name` makes: what the inverse carries for a name the game generated. The
        /// header and `meta` still take `name`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        value: Option<String>,
        /// `false` takes the country's `custom_name=yes` away: what the inverse carries
        /// when the rename added it. `true`, the default, adds the mark when missing.
        #[serde(default = "yes")]
        #[ts(optional, as = "Option<bool>")]
        custom_name: bool,
    },
    /// A new save system with its bodies, their deposits and its lanes, written as the
    /// game writes a system it spawns by script. It takes `last_created_system + 1`, which
    /// must be the number of systems the save holds; planets and deposits take the lowest
    /// dead slot of their tables first. Its name leaves the save's pool of unused star
    /// names, or failing that of black hole names, when one holds it. A system standing
    /// in a nebula's radius joins that nebula, as a system moved there does. The inverse
    /// is [`Op::RemoveSystem`]. Stellaris 4.x save documents only.
    AddSystemFromSpec {
        spec: SystemSpec,
    },
    /// A new deposit of type `kind` on a save planet, a star, moon or colony included,
    /// written as the game writes one: an entry of the `deposit` table in the lowest dead
    /// slot one generation on, or past the highest, and its id last in the planet's
    /// `deposits`, which the planet gains when it has none. The type is written as given:
    /// only an empty one, or one that is not an identifier, is refused. The inverse is
    /// [`Op::RemoveDeposit`]. Stellaris 4.x save documents only.
    AddDeposit {
        body: u32,
        kind: String,
    },
    /// A deposit of a save planet, a colony included, as the game removes one: its entry becomes
    /// the tombstone `<id>=none` and its id leaves the planet's `deposits`, which goes with
    /// its last id. A station working it is left standing. A deposit an
    /// [`Op::AddDeposit`] wrote gives its slot back: a reused slot gets back the
    /// tombstone that stood there before the add, and an appended one goes when it is last,
    /// else becomes a tombstone. A deposit held by no planet is refused. The inverse adds
    /// one of the same type to the same planet. Stellaris 4.x save documents only.
    RemoveDeposit {
        deposit: u32,
    },
    /// A save system [`Op::AddSystemFromSpec`] added since the file was opened, rolled again
    /// in place: its star class, initializer, belts, radii and bodies with their deposits
    /// become the spec's, and its id, position and lanes stay: the spec's `x`, `y` and
    /// `lanes` are ignored. The old bodies' slots and asteroid names are freed before the
    /// new bodies take theirs, and a new name swaps places in the pools of unused star
    /// and black hole names as [`Op::RenameSystem`] does. The inverse rolls the old system back in,
    /// read back as a spec that carries the system's position and lanes as they stand.
    /// Save documents only.
    ReplaceSystemFromSpec {
        system: u32,
        spec: SystemSpec,
    },
    /// The `nebula`th nebula's members made turbulent or calm. A turbulent member carries
    /// `turbulent_nebula` and a `turbulent_nebula_*` cloud; a calm one neither, its cloud
    /// swapped back to a calm type its star class takes. A member already so is left
    /// alone, and a nebula none of whose members would change is refused. A home system
    /// is made turbulent too, which the game never does; the description names it. The
    /// inverse is the [`Op::SetNebulaFootprints`] that puts back each member it changed.
    /// Stellaris 4.x save documents only.
    SetNebulaTurbulent {
        nebula: usize,
        turbulent: bool,
    },
    /// Each system's nebula footprint set as given: its `nebula_cloaking` and
    /// `turbulent_nebula` modifiers, and its cloud, the last nebula ambient object it
    /// lists. A cloud with another id takes that one's place, written back in its own
    /// slot. What the inverse of a nebula op carries, so that undoing it puts back the
    /// clouds and modifiers its members had rather than new ones. The inverse carries the
    /// footprints displaced. Stellaris 4.x save documents only.
    SetNebulaFootprints {
        footprints: Vec<NebulaFootprint>,
    },
    /// A save body put at `radius` and `angle` about its parent's point: the system centre
    /// for a planet, its `moon_of` body for a moon. Angles are degrees, written normalised
    /// to [0, 360). Its `orbit` becomes the radius, and every moon under it moves by the
    /// same step with its own `orbit` kept. `system` must be the body's own. A body at the
    /// system's centre is refused. When the body now reaches further than the system did, or
    /// outside its `inner_radius`, that radius grows to the body's reach plus its margin, and
    /// the inverse is a [`Op::Batch`] that also puts it back. Stellaris 4.x save documents
    /// only.
    MoveBody {
        system: u32,
        body: u32,
        radius: f64,
        angle: f64,
    },
    /// A save body made a moon of the body `parent` names, a planet of it when that is a
    /// star, or a planet of the system's centre, then put at `radius` and `angle` about its
    /// new parent as
    /// [`Op::MoveBody`] puts it. `moon_of` and both parents' `moons` are written, and
    /// the moon bit of `binary_flags` is set for a moon and cleared otherwise. A parent
    /// outside the system, a moon, the body itself or one of its moons, and a parent at the
    /// system's centre are refused, and so are the primary body and a body with moons made
    /// a moon of a planet. The inverse puts the old parent back. Stellaris 4.x save
    /// documents only.
    SetBodyParent {
        system: u32,
        body: u32,
        parent: Parent,
        radius: f64,
        angle: f64,
    },
    /// A save's natural wormhole put at `radius` and `angle` about its system's star, as
    /// [`Op::MoveBody`] places a planet. Angles are degrees, written normalised to
    /// [0, 360). Only `coordinate.x` and `.y` of the `natural_wormholes` entry are written: a
    /// wormhole has no orbit, and the system's `inner_radius` is left as it is. An entry
    /// whose bypass is not a `wormhole`, such as a shroud tunnel, is refused. The inverse
    /// moves it back to its old point. Stellaris 4.x save documents only.
    MoveWormhole {
        wormhole: u32,
        radius: f64,
        angle: f64,
    },
    /// A natural wormhole pair between save systems `a` and `b`, written with only what the
    /// game does not fill in on load. Each end gets a `natural_wormholes` entry holding its
    /// point and its bypass, and a `bypasses` entry holding `type="wormhole"`, `active=yes`,
    /// the other end's bypass as `linked_to` and its `natural_wormholes` entry as `owner`;
    /// each table's new ids follow its highest. Each system lists its end in a
    /// `natural_wormholes` list after its `hyperlane` block, or after `star_class` without
    /// one. The game fills in the systems' `bypasses` lists and each country's
    /// `usable_bypasses` on load. `a`'s end stands at 180° and `b`'s at 90°, just outside
    /// each system's `inner_radius`, where the game puts a pair it spawns without a random
    /// position. A pair of one system, and a system that already has a natural wormhole or
    /// a shroud tunnel, are refused. The inverse is [`Op::RemoveWormholePair`].
    /// Stellaris 4.x save documents only.
    AddWormholePair {
        a: u32,
        b: u32,
        /// The two ends' points in place of the ones the op picks: what the inverse of
        /// [`Op::RemoveWormholePair`] carries, so that the pair comes back where it stood.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        at: Option<PairPoints>,
    },
    /// The natural wormhole pair between save systems `a` and `b`, named in either order.
    /// Both ends' `natural_wormholes` and `bypasses` entries are erased, and their ids leave
    /// both systems' `natural_wormholes` and `bypasses` lists, each list going with its last
    /// id. Each country's `usable_bypasses` is left for the game to rebuild on load, and a
    /// fleet's `bypass_from` and `bypass_to` are left as they are. Two systems that are not
    /// the ends of one wormhole are refused, a shroud tunnel included, and so is a wormhole
    /// whose other end has no `natural_wormholes` entry. The inverse adds the pair back at
    /// the points it stood at, numbered as [`Op::AddWormholePair`] numbers a new one.
    /// Stellaris 4.x save documents only.
    RemoveWormholePair {
        a: u32,
        b: u32,
    },
    /// The ring bit of a save body's `binary_flags`, set when `ring` and cleared when not:
    /// the statement is written before `entity_planet_class` or `coordinate` when the body
    /// has none, and goes when only the bit set beside any other is left. The body's class
    /// is not checked. A ring bit already as asked is refused with
    /// [`OpError::Unchanged`]; the inverse flips `ring`. Stellaris 4.x save documents
    /// only.
    SetBodyRing {
        body: u32,
        ring: bool,
    },
    /// A save planet's model: `entity_name="<entity>"` written on the line after its
    /// `entity=N`, which stays, or rewritten in place, or removed with the `binary_flags` bit
    /// an initializer's model sets when `None`. The model is written as given, on any class:
    /// only one that is not an identifier is refused, and so are a star and a model already
    /// as asked. A class change in game drops the model. The inverse sets the old one back,
    /// without that bit. Stellaris 4.x save documents only.
    SetBodyModel {
        body: u32,
        entity: Option<String>,
    },
    /// A save planet's class, written as the game's `change_pc` writes one: `planet_class`
    /// becomes `to`'s class and `entity_name` goes, so the planet takes the new class's own
    /// model. `entity` becomes 0 when it is past the `models` `to` has, and stays otherwise.
    /// `binary_flags`, deposits, modifiers and the colony stay as they are. The install
    /// knows what each class is and the bytes do not, so the caller says, in `from` for the
    /// class the planet has and `to` for the new one. A star, a class that never changes
    /// taken from or to, a colony taken from or to a class not open to colonies, a `from`
    /// that is not the planet's class, a planet with a megastructure and a class it already
    /// has are refused. `look`, when given, is written in place of that model and index, and
    /// its index must be below the `models` `to` has: it is what the inverse carries, so that
    /// undoing a change puts back the look the planet had. Stellaris 4.x save documents only.
    SetBodyClass {
        body: u32,
        from: PlanetClassRule,
        to: PlanetClassRule,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        look: Option<PlanetLook>,
    },
    /// A new asteroid belt of type `kind` at `radius`, last in the system's
    /// `asteroid_belts`, which the system gains when it has none. A belt reaching past the
    /// system's bodies and belts, or outside its `inner_radius`, grows that radius as a moved
    /// body does. The inverse is [`Op::RemoveBelt`] at the new last index, batched with
    /// the old inner radius when it grew. Stellaris 4.x save documents only.
    AddBelt {
        system: u32,
        kind: String,
        radius: f64,
    },
    /// The `index`th belt of the system's `asteroid_belts`, counted from 0; the block goes
    /// with its last belt. The inverse adds it back, last. Stellaris 4.x save documents only.
    RemoveBelt {
        system: u32,
        index: usize,
    },
    /// The `index`th belt's `inner_radius`. Its asteroids stay where they are; the app
    /// moves them in the same [`Op::Batch`]. A belt moved past the system's reach grows its
    /// `inner_radius` as [`Op::AddBelt`] does. Its own inverse, batched with the old
    /// inner radius when it grew. Stellaris 4.x save documents only.
    SetBeltRadius {
        system: u32,
        index: usize,
        radius: f64,
    },
    /// The `index`th belt's `type`, written as given: only one that is not an identifier
    /// is refused. Its own inverse. Stellaris 4.x save documents only.
    SetBeltKind {
        system: u32,
        index: usize,
        kind: String,
    },
    /// A save system's `inner_radius`, with `outer_radius` the session's outer offset past
    /// it. A radius inside the system's outermost body or belt, or below the session's
    /// smallest inner radius, is refused unless it is no smaller than the value the system
    /// already holds. Its own inverse. Stellaris 4.x save documents only.
    SetInnerRadius {
        system: u32,
        radius: f64,
    },
    /// A save planet and its moons taken from their system into system `to`: their
    /// `planet=` lines leave the old system and follow the new one's last, and their
    /// `origin` becomes `to`. The planet keeps its angle about the centre on an orbit the
    /// inner radius offset past the new system's reach, or goes to `at` when given, as
    /// [`Op::MoveBody`] places a body. Its moons keep their places about it, and the
    /// new system's `inner_radius` grows as a moved body's does. A moon, or a planet of a
    /// companion star, becomes a planet of the new system's centre: it leaves its parent's
    /// `moons` and loses `moon_of` and the moon bit. The colony of each colonised body
    /// moves between the two systems' `colonies`, and the station fleet of each body with
    /// one between their `fleet_presence`, it and its ships taking the new `origin`, their
    /// points shifted with the body. No other fleet is touched. A star, a system with no
    /// bodies to join and a planet or moon with a megastructure are refused, and so is an
    /// owned planet or moon another country controls. The
    /// inverse moves it back to its old point, batched with the old inner radius when it
    /// grew. Stellaris 4.x save documents only.
    MoveBodyToSystem {
        body: u32,
        to: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        at: Option<OrbitPlacement>,
    },
    /// A save planet's or moon's name, written as the game writes a name a player typed:
    /// `name={ key="<name>" literal=yes }`. Each moon, and each moon of a moon, whose name
    /// holds the body's old name as the value of a `PARENT` variable, as
    /// `SUBPLANET_NAME_FORMAT` names a moon after its planet, holds the new one there. A
    /// moon holding something else there keeps it. A [`NewName::Block`] is written in place
    /// of the literal instead: it is what the inverse carries, so that undoing a rename puts
    /// back the name as it stood. An empty name, a name the body already has, and a star are refused: the
    /// system's primary body, or a body of a star's class, whose planets hold its name in
    /// copies of their own. Save documents only.
    RenameBody {
        body: u32,
        name: NewName,
    },
    /// The colony on a save planet or moon, as the game's `destroy_colony` leaves it, while
    /// the planet stays: the planet loses `colony`, `owner`, `controller`, `colonize_date`
    /// and `orbital_defence`. The colony, its pop groups, jobs, districts, zones and
    /// buildings, its defence armies and its orbital ring's starbase, ships, fleet, queues
    /// and the construction items in those queues become tombstones. A system's own
    /// starbase that `orbital_defence` names stays. The colony leaves its system's
    /// `colonies`, and the owner's colony, planet, army and fleet lists lose what went, as
    /// do an occupier's and the armies' owners'. Their queues at the planet are left with no
    /// owner, as the game leaves them, and the items in them stay. A country's `capital`
    /// and a species' `home_planet` are left for the game. Refused for an army aboard a
    /// ship, a ring world segment, and a megastructure on or around the planet. The inverse
    /// is the
    /// [`Op::RestoreEntities`] that writes back every entity it rewrote. Stellaris 4.x
    /// save documents only.
    RemoveColony {
        body: u32,
    },
    /// A save planet and its moons, or a moon alone, as the game's `remove_planet` leaves
    /// it: each body's entry becomes `<id>=none` and its `planet=` line leaves the system.
    /// A moon deleted alone leaves its parent's `moons`. A colonised body first loses its
    /// colony as [`Op::RemoveColony`] takes it, and a mining or research station goes with
    /// the body it works: its fleet and ships become tombstones and leave the system's
    /// `fleet_presence` and the controller's `owned_fleets` and `controlled_planets`.
    /// Deposits, survey lists, event targets, fleets in orbit and orphaned construction
    /// queues are left for the game. A dig site on a deleted body goes as
    /// [`Op::RemoveDigSite`] takes it, and the body leaves each country's `events.anomalies`
    /// as [`Op::RemoveAnomaly`] takes it out. A star, an uncolonised body a starbase orbits,
    /// a ring world segment and a megastructure on or around it are refused, as is any colony
    /// [`Op::RemoveColony`] refuses. The inverse is the [`Op::RestoreEntities`] that
    /// writes back every entity it rewrote, batched with an [`Op::AddDigSite`] per site it
    /// removed. A body [`Op::AddBody`] added since the file was opened goes as
    /// [`Op::RemoveBody`] takes it, and is refused while it has moons; its inverse adds
    /// it back, then its site and anomaly. Stellaris 4.x save documents only.
    DeleteBody {
        body: u32,
    },
    /// Save entities written back whole, each over whatever stands for it now: what
    /// [`Op::RemoveColony`] and [`Op::DeleteBody`] invert to. Each text must be one
    /// statement keyed by its id, the entity or its tombstone. Only an inverse: the session
    /// refuses it from [`crate::session::Session::apply`], and undo reaches it through the
    /// bytes. The inverse carries the texts displaced. Save documents only.
    #[ts(skip)]
    RestoreEntities {
        description: String,
        entities: Vec<SavedEntity>,
    },
    /// A new planet, or a moon of the planet `spec.moon_of` names, in save system `system`,
    /// written as the game writes a body it spawns: its entry and its deposits' take the
    /// lowest dead slot of their tables one generation on, or the slot past the highest. It
    /// stands `at` its radius and angle about its parent's point, the system's centre for a
    /// planet, and the system lists it after its last `planet=` line. A moon gets `moon_of`
    /// and the moon bit, and its planet lists it in `moons`. Without a name in the spec, a
    /// planet takes the numeral after the highest of the system's numbered planets and a moon
    /// the letter after its planet's highest. When the body lies past the system's
    /// `inner_radius`, that radius grows to the body's reach plus its margin. The game builds
    /// its construction queue when it loads, and nobody has surveyed it. A moon of a star, a
    /// moon or an asteroid, and a parent outside the system, are refused. The inverse is
    /// [`Op::RemoveBody`], batched with the old inner radius when it grew. Stellaris 4.x
    /// save documents only.
    AddBody {
        system: u32,
        spec: NewBody,
        at: OrbitPlacement,
    },
    /// A save planet or moon [`Op::AddBody`] added since the file was opened, taken out
    /// again: its entry and its deposits' give their slots back as a removed system's bodies
    /// do, its `planet=` line goes, and so does its id from its planet's `moons`. A body the
    /// file held, and one with moons, are refused. The inverse adds it back, read as a spec,
    /// at the radius and angle it stood at. Stellaris 4.x save documents only.
    RemoveBody {
        body: u32,
    },
    /// A new archaeological dig site of type `site_type` on a save planet, a moon or colony
    /// included: an entry last in `archaeological_sites.sites`, its id one past the highest
    /// the save has held since it was opened, written as the game writes a site nobody has
    /// dug, with `difficulty` its first stage's. The game fills in which countries see it. The
    /// type is written as given: only an empty one, or one that is not an identifier, is
    /// refused, and so are a star, a planet that has a site and a save before Stellaris 4.0. The inverse is [`Op::RemoveDigSite`]. Save documents only.
    AddDigSite {
        body: u32,
        site_type: String,
        difficulty: i32,
    },
    /// A dig site's entry, dug or not, taken out whole. Nothing else is written: the order of
    /// a fleet excavating the site, which names its id, is left for the game to drop on its
    /// first day. A site that is
    /// not on a planet is refused, and so is a save before Stellaris 4.0. The inverse adds a
    /// site of the same type and current difficulty to the same planet; undo puts the entry
    /// back as it stood. Save documents only.
    RemoveDigSite {
        site: u32,
    },
    /// Each save system's `coordinate.visual_height`, how far above or below the galactic
    /// plane the map draws its star; `None` takes the key out. A system without one, as
    /// 3.x saves write them, gets it last in its `coordinate` block. A height that would be
    /// written as 0 is written as 0.00001, because the game reads 0 as unset and puts a
    /// height of its own in its place. An empty list, an id listed twice and a height that
    /// is not a finite number are refused. There is no op for one system's height: it is a
    /// list of one. The inverse carries the heights displaced, `None` where there was none.
    /// Save documents only.
    SetSystemHeights {
        heights: Vec<SystemHeight>,
    },
    /// Several ops as one edit and one undo step, applied in order; a refused member
    /// leaves the document as it was before the first. Not nested.
    Batch {
        description: String,
        ops: Vec<Op>,
    },
}

impl Op {
    /// The variant's name, for an error that has to name the op.
    pub fn name(&self) -> &'static str {
        self.into()
    }

    /// What the op reaches beyond the bytes it writes: the document kinds that take it, the
    /// details it stales, whether it reclassifies, whether it needs a 4.x save and whether it
    /// takes a second step.
    pub fn reach(&self) -> OpReach {
        use DetailsReach::{Bodies, InPlace, Rebuild, SaveBodies};
        match self {
            Self::MoveSystem { .. }
            | Self::AddLane { .. }
            | Self::AddLanes { .. }
            | Self::RemoveLane { .. }
            | Self::RemoveLanes { .. }
            | Self::IsolateSystem { .. }
            | Self::MoveSystems { .. }
            | Self::AddLanePairs { .. }
            | Self::RemoveLanePairs { .. }
            | Self::IsolateSystems { .. }
            | Self::MoveNebula { .. }
            | Self::AddNebula { .. }
            | Self::RemoveNebula { .. }
            | Self::SetNebulaRadius { .. }
            | Self::RenameNebula { .. } => OpReach::of(BOTH),
            Self::RenameSystem { .. } => OpReach::of(BOTH).details(SaveBodies).reclassifies(),
            Self::RemoveSystem { .. } | Self::RemoveSystems { .. } => {
                OpReach::of(BOTH).details(Bodies).reclassifies()
            }
            // A scenario's lanes carry no length: the game measures them from the two ends.
            // It holds no global flags, countries or planets either: the game rolls the
            // outcome and creates the empires when it starts, and its stars and bodies come
            // from the initializers. The game ignores the `z` of a scenario position.
            Self::SetLaneLength { .. }
            | Self::SetLaneLengths { .. }
            | Self::NormaliseLaneLength { .. }
            | Self::NormaliseLaneLengths { .. }
            | Self::SetLGateOutcome { .. }
            | Self::SetEmpireMapColors { .. }
            | Self::SetEmpireFlag { .. }
            | Self::RenameEmpire { .. }
            | Self::SetSystemHeights { .. } => OpReach::of(SAVE),
            Self::SetStarClass { .. } | Self::SetBodySize { .. } | Self::RenameBody { .. } => {
                OpReach::of(SAVE).details(InPlace)
            }
            Self::AddSystemFromSpec { .. } => OpReach::of(SAVE)
                .details(Bodies)
                .reclassifies()
                .whole_entries()
                .follow_up(),
            Self::ReplaceSystemFromSpec { .. } => {
                OpReach::of(SAVE).details(Bodies).reclassifies().follow_up()
            }
            // The game dresses a scenario's nebula members itself when it starts.
            Self::SetNebulaTurbulent { .. } | Self::SetNebulaFootprints { .. } => {
                OpReach::of(SAVE).whole_entries()
            }
            Self::AddBodyModifier { .. }
            | Self::RemoveBodyModifier { .. }
            | Self::AddAnomaly { .. }
            | Self::RemoveAnomaly { .. }
            | Self::MoveBody { .. }
            | Self::SetBodyParent { .. }
            | Self::MoveWormhole { .. }
            | Self::SetBodyRing { .. }
            | Self::SetBodyModel { .. }
            | Self::SetBodyClass { .. }
            | Self::AddBelt { .. }
            | Self::RemoveBelt { .. }
            | Self::SetBeltRadius { .. }
            | Self::SetBeltKind { .. }
            | Self::SetInnerRadius { .. } => OpReach::of(SAVE).details(InPlace).whole_entries(),
            Self::AddDeposit { .. }
            | Self::RemoveDeposit { .. }
            | Self::RemoveColony { .. }
            | Self::DeleteBody { .. }
            | Self::AddBody { .. }
            | Self::RemoveBody { .. }
            | Self::AddDigSite { .. }
            | Self::RemoveDigSite { .. } => OpReach::of(SAVE).details(Bodies).whole_entries(),
            Self::RestoreEntities { .. } => OpReach::of(SAVE)
                .details(Bodies)
                .whole_entries()
                .inverse_only(),
            Self::AddWormholePair { .. }
            | Self::RemoveWormholePair { .. }
            | Self::MoveBodyToSystem { .. } => OpReach::of(SAVE).details(Rebuild).whole_entries(),
            // A save's initializers, spawns, fallen empire zones and wormholes are the game's
            // to set, and it has neither a scenario header nor a generator to prevent a lane
            // from. It adds and names a system through the save ops, which write the bodies a
            // scenario statement leaves out.
            Self::SetHeaderField { .. }
            | Self::SetHeaderKeys { .. }
            | Self::SetHeaderList { .. }
            | Self::SetSpawnWeight { .. }
            | Self::SetFeZone { .. }
            | Self::SetFeLinks { .. }
            | Self::SetFeLinkFlags { .. }
            | Self::PreventLane { .. }
            | Self::AllowLane { .. } => OpReach::of(SCENARIO),
            Self::SetWormholePair { .. } | Self::SetWormholeEnds { .. } => {
                OpReach::of(SCENARIO).reclassifies()
            }
            // A scripted seat may bring an initializer with it.
            Self::AddSystem { .. }
            | Self::AddSystems { .. }
            | Self::SetInitializer { .. }
            | Self::SetSpawnScript { .. } => OpReach::of(SCENARIO).details(Rebuild).reclassifies(),
            Self::Batch { ops, .. } => ops
                .iter()
                .map(Self::reach)
                .fold(OpReach::of(BOTH), OpReach::with),
        }
    }

    /// Refuse an op that is only an inverse, alone or in a batch, when it is sent from outside.
    pub fn check_sendable(&self) -> Result<(), OpError> {
        if self.reach().inverse_only {
            Err(OpError::InverseOnly(self.name()))
        } else {
            Ok(())
        }
    }

    /// Refuse the op before any format sees it when `kind` does not take it.
    pub(crate) fn check_kind(&self, kind: DocumentKind) -> Result<(), OpError> {
        if self.reach().kinds.contains(&kind) {
            Ok(())
        } else {
            Err(OpError::Unsupported {
                op: self.name(),
                kind,
            })
        }
    }
}

const BOTH: &[DocumentKind] = &[DocumentKind::Save, DocumentKind::Scenario];
const SAVE: &[DocumentKind] = &[DocumentKind::Save];
const SCENARIO: &[DocumentKind] = &[DocumentKind::Scenario];
const NEITHER: &[DocumentKind] = &[];

fn yes() -> bool {
    true
}

fn shared_kinds(a: &'static [DocumentKind], b: &'static [DocumentKind]) -> &'static [DocumentKind] {
    match (
        a.contains(&DocumentKind::Save) && b.contains(&DocumentKind::Save),
        a.contains(&DocumentKind::Scenario) && b.contains(&DocumentKind::Scenario),
    ) {
        (true, true) => BOTH,
        (true, false) => SAVE,
        (false, true) => SCENARIO,
        (false, false) => NEITHER,
    }
}

/// One op's row: see [`Op::reach`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpReach {
    /// The document kinds that take the op.
    pub kinds: &'static [DocumentKind],
    pub details: DetailsReach,
    /// Whether the op can move how the systems it touched are classified: the initializer a
    /// classification is read from, the name it is labelled by, or the star flags the
    /// scripts place a wormhole by.
    pub reclassifies: bool,
    /// Whether the op writes whole entries, which only a 4.x save lays out as it does.
    pub whole_entries: bool,
    /// Whether the op has a second step, planned once its first is committed.
    pub follow_up: bool,
    /// Whether the op is only ever an inverse, which the session refuses from outside.
    pub inverse_only: bool,
}

impl OpReach {
    const fn of(kinds: &'static [DocumentKind]) -> Self {
        Self {
            kinds,
            details: DetailsReach::Untouched,
            reclassifies: false,
            whole_entries: false,
            follow_up: false,
            inverse_only: false,
        }
    }

    const fn details(self, details: DetailsReach) -> Self {
        Self { details, ..self }
    }

    const fn reclassifies(self) -> Self {
        Self {
            reclassifies: true,
            ..self
        }
    }

    const fn whole_entries(self) -> Self {
        Self {
            whole_entries: true,
            ..self
        }
    }

    const fn follow_up(self) -> Self {
        Self {
            follow_up: true,
            ..self
        }
    }

    const fn inverse_only(self) -> Self {
        Self {
            inverse_only: true,
            ..self
        }
    }

    /// A batch's row with `member` added to it.
    fn with(self, member: Self) -> Self {
        Self {
            kinds: shared_kinds(self.kinds, member.kinds),
            details: self.details.with(member.details),
            reclassifies: self.reclassifies || member.reclassifies,
            whole_entries: self.whole_entries || member.whole_entries,
            follow_up: self.follow_up || member.follow_up,
            inverse_only: self.inverse_only || member.inverse_only,
        }
    }
}

/// Which systems' details an op leaves stale, and how they come up to date.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DetailsReach {
    Untouched,
    /// The systems it rewrote, read again in place: the planets it rewrote and the belts,
    /// inner radius and wormhole points of the systems it rewrote.
    InPlace,
    /// In a save, only the systems whose bodies it wrote, since a save system's lanes
    /// rewrite its neighbours; in a scenario, whose systems have no bodies, every system it
    /// rewrote. The projection is built again.
    Bodies,
    /// [`Self::Bodies`] in a save and nothing in a scenario, where the op writes only a
    /// statement's own text.
    SaveBodies,
    /// Every system it rewrote, with the projection built again.
    Rebuild,
}

impl DetailsReach {
    pub fn stales(self) -> bool {
        self != Self::Untouched
    }

    fn with(self, other: Self) -> Self {
        match (self, other) {
            (Self::Untouched, reach) | (reach, Self::Untouched) => reach,
            (a, b) if a == b => a,
            (Self::Bodies, Self::SaveBodies) | (Self::SaveBodies, Self::Bodies) => Self::Bodies,
            _ => Self::Rebuild,
        }
    }
}

/// One star body's new planet class in [`Op::SetStarClass`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarBody {
    pub body: u32,
    pub class: String,
}

/// What the install says about one planet class, for [`Op::SetBodyClass`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetClassRule {
    pub class: String,
    pub change: ClassChange,
    /// How many models the install numbers for the class, `<model>_01_entity` on; 0 when
    /// it names none.
    pub models: u32,
}

/// Which planets a class may be given to, or taken from, in [`Op::SetBodyClass`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ClassChange {
    /// None: a star, a habitat, a ring world, an ark and the other classes the game builds
    /// or scripts its own way.
    Never,
    /// Any planet, a colony included: a class colonised with the standard district set.
    Any,
    /// A planet with no colony only.
    Uncolonised,
}

/// A save planet's model in [`Op::SetBodyClass`]: its `entity` index and the
/// `entity_name` it has in place of its class's own, each `None` where the planet has none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanetLook {
    pub entity: Option<u32>,
    pub entity_name: Option<String>,
}

/// The body [`Op::AddBody`] writes, every value chosen by the caller.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewBody {
    /// `pc_desert`, `pc_gas_giant`, …
    pub class: String,
    pub size: u32,
    /// The planet a moon orbits; `None` for a planet of the system's centre.
    #[serde(default)]
    pub moon_of: Option<u32>,
    /// A name written as typed, with `literal=yes`; `None` numbers it after its siblings.
    #[serde(default)]
    pub name: Option<String>,
    /// Deposit keys, `d_minerals_2`, …
    #[serde(default)]
    pub deposits: Vec<String>,
    /// Drawn with a ring around it. A moon is refused one.
    #[serde(default)]
    pub ring: bool,
}

/// One system to add in [`Op::AddSystems`]: an [`Op::AddSystem`] with its id given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewSystem {
    pub system: u32,
    pub x: f64,
    pub y: f64,
    pub name: Option<String>,
    pub initializer: Option<String>,
    pub spawn_weight: Option<f64>,
    #[serde(default)]
    pub spawn_script: Option<SpawnScript>,
    /// The whole `system` statement, written as it stands instead of one built from the
    /// fields, which then only describe it: what a removal's inverse carries. It must
    /// read as one `system` statement with this id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub statement: Option<String>,
}

/// The body [`Op::SetBodyParent`] makes a body orbit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Parent {
    /// The system's centre: the body becomes a planet of it.
    Centre,
    /// Another body of the system: a planet of it when it is a star, a moon otherwise.
    Body(u32),
}

impl Parent {
    pub fn body(self) -> Option<u32> {
        match self {
            Self::Centre => None,
            Self::Body(id) => Some(id),
        }
    }
}

impl From<Option<u32>> for Parent {
    fn from(parent: Option<u32>) -> Self {
        parent.map_or(Self::Centre, Self::Body)
    }
}

/// The name [`Op::RenameBody`] writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum NewName {
    /// A name as typed, written `{ key="<name>" literal=yes }`.
    Literal(String),
    /// A whole `{ … }` name value written as it stands, which `name` only describes.
    Block { value: String, name: String },
}

impl NewName {
    /// The name as the player reads it.
    pub fn shown(&self) -> &str {
        match self {
            Self::Literal(name) | Self::Block { name, .. } => name,
        }
    }
}

/// The two ends of a pair in [`Op::AddWormholePair`], each as x/y about its star.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PairPoints {
    pub a: (f64, f64),
    pub b: (f64, f64),
}

/// The map border and fill in [`Op::SetEmpireMapColors`], each a colour name from
/// `flags/colors.txt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MapColorPair {
    pub border: String,
    pub fill: String,
}

/// An empire's flag in [`Op::SetEmpireFlag`]: the emblem's category and file under the
/// install's `flags/`, the background file under `flags/backgrounds`, and the primary and
/// secondary colours, each a colour name from `flags/colors.txt`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EmpireFlag {
    pub icon_category: String,
    pub icon_file: String,
    pub background: String,
    pub primary: String,
    pub secondary: String,
}

/// What a nebula leaves on one member system besides its member line, in
/// [`Op::SetNebulaFootprints`]: the cloud that draws it in the system view, and the two
/// permanent modifiers, which give only its numbers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NebulaFootprint {
    pub system: u32,
    pub cloud: Option<NebulaCloud>,
    /// `nebula_cloaking`, which a save carries only with First Contact.
    pub cloaking: bool,
    /// `turbulent_nebula`.
    pub turbulent: bool,
}

/// One entry of the save's `ambient_object` table that draws a nebula cloud: its id and
/// its type, such as `nebula_3`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NebulaCloud {
    pub id: u32,
    pub kind: String,
}

/// One save entity in [`Op::RestoreEntities`]: the table it stands in, its id, and its
/// whole `<id>={ … }` statement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SavedEntity {
    pub table: SavedTable,
    pub id: u32,
    pub text: String,
}

/// The id-keyed save tables [`SavedEntity`] names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum SavedTable {
    System,
    Planet,
    Country,
    Colony,
    PopGroup,
    PopJob,
    District,
    Zone,
    Building,
    Army,
    Starbase,
    Fleet,
    Ship,
    /// `construction.queue_mgr.queues`.
    ConstructionQueue,
    /// `construction.item_mgr.items`.
    ConstructionItem,
}

/// One system's destination in [`Op::MoveSystems`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemMove {
    pub system: u32,
    pub x: f64,
    pub y: f64,
}

/// One system's height in [`Op::SetSystemHeights`]: its `coordinate.visual_height`, or
/// `None` for none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemHeight {
    pub system: u32,
    pub height: Option<f64>,
}

/// One lane to add in [`Op::AddLanePairs`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LanePair {
    pub a: u32,
    pub b: u32,
    pub bridge: bool,
}

/// One lane's new length in [`Op::SetLaneLengths`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LaneLength {
    pub a: u32,
    pub b: u32,
    pub length: f64,
}
