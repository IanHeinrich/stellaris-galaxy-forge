//! The op vocabulary: every edit the editor can make, the entries its plural ops take,
//! and the errors an op is refused with.

use serde::{Deserialize, Serialize};
use strum::IntoStaticStr;
use ts_rs::TS;

use crate::document;
use crate::format::save::system_spec::SystemSpec;
use crate::format::save::write::planet_modifier::MAX_MODIFIER_COPIES;
use crate::format::scenario::{FeLinkFlags, FeZone};
use crate::overlay::OverlayError;
use crate::projections::galaxy::{LGateOutcome, ProjectionError, SpawnScript};
use crate::views::{DocumentKind, ErrorKind, OrbitPlacement};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, IntoStaticStr)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Op {
    MoveSystem {
        id: u32,
        x: f64,
        y: f64,
    },
    AddLane {
        a: u32,
        b: u32,
        bridge: bool,
    },
    /// Several lanes from one system at once; the inverse of [`Op::IsolateSystem`] and
    /// of [`Op::RemoveLanes`].
    AddLanes {
        from: u32,
        to: Vec<(u32, bool)>,
    },
    RemoveLane {
        a: u32,
        b: u32,
    },
    /// Several lanes of one system at once; the inverse of [`Op::AddLanes`].
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
        id: u32,
    },
    /// Several systems moved as one; every lane touching any of them gets its length
    /// recomputed from the new positions of both ends.
    MoveSystems {
        moves: Vec<SystemMove>,
    },
    /// Several unrelated lanes at once; the inverse of [`Op::RemoveLanePairs`] and of
    /// [`Op::IsolateSystems`].
    AddLanePairs {
        lanes: Vec<LanePair>,
    },
    /// The inverse of [`Op::AddLanePairs`].
    RemoveLanePairs {
        lanes: Vec<(u32, u32)>,
    },
    /// Every lane touching any of `ids`; a lane between two of them is removed once.
    /// Systems without lanes are allowed, but the op refuses with
    /// [`OpError::NoLanes`] (naming the first id) when no lane is removed at all.
    IsolateSystems {
        ids: Vec<u32>,
    },
    /// Several lane lengths at once; its own inverse. Lengths follow the
    /// [`Op::SetLaneLength`] rules.
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
    SetNebulaName {
        index: usize,
        name: String,
    },
    /// A new `system` statement, `id` defaulting to one past the highest held. Scenario
    /// documents only; a save adds a system through [`Op::AddSaveSystem`]. A weight and a
    /// script together are refused (see [`Op::SetSpawnScript`]).
    AddSystem {
        id: Option<u32>,
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
    /// A save removes only a system [`Op::AddSaveSystem`] added since the file was opened,
    /// with its bodies, their deposits, its lanes on both ends and its nebula member lines.
    /// A reused slot gets its tombstone back, the name returns to the pool of unused star
    /// or black hole names the add took it from, and `last_created_system` goes down. The
    /// systems added after it take the id below their own, so that ids stay dense. The
    /// inverse adds the system again, read back as a spec, at the end of the list, which
    /// joins it to the nebula it stands in; then its bridges, the lane lengths that are not
    /// `floor(distance)` and its nebula footprint are put back. The bytes come back exactly
    /// only for the last system added, with nothing written to its neighbours since. A
    /// lane's entry on the other end comes back last in that system's list. A system taken
    /// from among the added ones comes back at the next id, its bodies and deposits one
    /// generation on in the slots they had. A lane whose two ends disagreed comes back with
    /// one length. Undo through history is byte-exact either way.
    RemoveSystem {
        id: u32,
    },
    /// Several systems as one undo step, each following the [`Op::AddSystem`] rules with
    /// its id given. An id listed twice is refused. Scenario documents only.
    AddSystems {
        systems: Vec<NewSystem>,
    },
    /// Several systems as one undo step, each as [`Op::RemoveSystem`]; a statement naming
    /// two of them is removed once. An id listed twice is refused. The inverse restores
    /// what [`Op::RemoveSystem`]'s does, for every system; undo through history stays
    /// byte-exact.
    RemoveSystems {
        ids: Vec<u32>,
    },
    /// Scenario documents only.
    SetSystemName {
        id: u32,
        name: String,
    },
    /// The system's `initializer`, which `None` removes. The `spawn_weight` beside it is
    /// not touched: only [`Op::SetSpawnWeight`] writes one. Scenario documents only.
    SetInitializer {
        id: u32,
        initializer: Option<String>,
    },
    /// Several systems' initializers as one undo step; each entry follows the
    /// [`Op::SetInitializer`] rules. Scenario documents only.
    SetInitializers {
        entries: Vec<InitializerSet>,
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
        id: u32,
        base: Option<f64>,
    },
    /// Several systems' spawn weights as one undo step, each entry following the
    /// [`Op::SetSpawnWeight`] rules. Scenario documents only.
    SetSpawnWeights {
        entries: Vec<(u32, Option<f64>)>,
    },
    /// The scripted seat a system's `spawn_weight` states; `None` removes the statement.
    /// A system with no `initializer` gets the dialect's basic one, which the inverse
    /// omits: undo puts the bytes back exactly. Scenario documents only.
    SetSpawnScript {
        id: u32,
        script: Option<SpawnScript>,
    },
    /// Several systems' scripted seats as one undo step, each entry following the
    /// [`Op::SetSpawnScript`] rules. Scenario documents only.
    SetSpawnScripts {
        entries: Vec<(u32, Option<SpawnScript>)>,
    },
    /// The Paint a Galaxy fallen empire zone a system anchors; `None` clears it. A zone
    /// whose ring holds another system, or whose centre lies off the map, is refused: the
    /// mod builds the fallen empire's systems in that ring. Scenario documents only.
    SetFeZone {
        id: u32,
        zone: Option<FeZone>,
    },
    /// Several systems' fallen empire zones as one undo step, each entry following the
    /// [`Op::SetFeZone`] rules. Scenario documents only.
    SetFeZones {
        entries: Vec<(u32, Option<FeZone>)>,
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
    UnpreventLane {
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
        id: u32,
        class: String,
        bodies: Vec<StarBody>,
    },
    /// A save planet's `planet_size`, star bodies included, written as given: nothing
    /// holds it to the range its class allows. Zero is refused; the inverse carries the
    /// size displaced. Save documents only.
    SetPlanetSize {
        id: u32,
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
    AddPlanetModifier {
        planet: u32,
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
    RemovePlanetModifier {
        planet: u32,
        modifier: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        feature: Option<String>,
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
        /// `Some(false)` takes the country's `custom_name=yes` away: what the inverse
        /// carries when the rename added it. Otherwise the mark is added when missing.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        custom_name: Option<bool>,
    },
    /// A new save system with its bodies, their deposits and its lanes, written as the
    /// game writes a system it spawns by script. It takes `last_created_system + 1`, which
    /// must be the number of systems the save holds; planets and deposits take the lowest
    /// dead slot of their tables first. Its name leaves the save's pool of unused star
    /// names, or failing that of black hole names, when one holds it. A system standing
    /// in a nebula's radius joins that nebula, as a system moved there does. The inverse
    /// is [`Op::RemoveSystem`]. Stellaris 4.x save documents only, and not an Ironman
    /// save.
    AddSaveSystem {
        spec: SystemSpec,
    },
    /// A new deposit of type `kind` on a save planet, a star, moon or colony included,
    /// written as the game writes one: an entry of the `deposit` table in the lowest dead
    /// slot one generation on, or past the highest, and its id last in the planet's
    /// `deposits`, which the planet gains when it has none. The type is written as given:
    /// only an empty one, or one that is not an identifier, is refused. The inverse is
    /// [`Op::RemoveSaveDeposit`]. Stellaris 4.x save documents only.
    AddSaveDeposit {
        planet: u32,
        kind: String,
    },
    /// A deposit of a save planet, a colony included, as the game removes one: its entry becomes
    /// the tombstone `<id>=none` and its id leaves the planet's `deposits`, which goes with
    /// its last id. A station working it is left standing. A deposit an
    /// [`Op::AddSaveDeposit`] wrote gives its slot back: a reused slot gets back the
    /// tombstone that stood there before the add, and an appended one goes when it is last,
    /// else becomes a tombstone. A deposit held by no planet is refused. The inverse adds
    /// one of the same type to the same planet. Stellaris 4.x save documents only.
    RemoveSaveDeposit {
        deposit: u32,
    },
    /// A save system [`Op::AddSaveSystem`] added since the file was opened, rolled again
    /// in place: its star class, initializer, belts, radii and bodies with their deposits
    /// become the spec's, and its id, position and lanes stay: the spec's `x`, `y` and
    /// `lanes` are ignored. The old bodies' slots and asteroid names are freed before the
    /// new bodies take theirs, and a new name swaps places in the pools of unused star
    /// and black hole names as [`Op::RenameSaveSystem`] does. The inverse rolls the old system back in,
    /// read back as a spec that carries the system's position and lanes as they stand.
    /// Save documents only.
    ReplaceSaveSystem {
        system: u32,
        spec: SystemSpec,
    },
    /// A save system [`Op::AddSaveSystem`] added since the file was opened, renamed: its
    /// own name and the names of its star, planets and moons, which carry it as text. The
    /// old name goes back to the pool of unused star or black hole names the add took it
    /// from, and the new one leaves whichever of those pools holds it. Empty is refused;
    /// the inverse carries the name displaced. Save documents only.
    RenameSaveSystem {
        system: u32,
        name: String,
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
    MoveSaveBody {
        system: u32,
        body: u32,
        radius: f64,
        angle: f64,
    },
    /// A save body made a moon of `parent`, a planet of it when `star`, or a planet of the
    /// system's centre when `None`, then put at `radius` and `angle` about its new parent as
    /// [`Op::MoveSaveBody`] puts it. `moon_of` and both parents' `moons` are written, and
    /// the moon bit of `binary_flags` is set for a moon and cleared otherwise. A parent
    /// outside the system, a moon, the body itself or one of its moons, and a parent at the
    /// system's centre are refused, and so are the primary body and a body with moons made
    /// a moon of a planet. The inverse puts the old parent back. Stellaris 4.x save
    /// documents only.
    SetSaveBodyParent {
        system: u32,
        body: u32,
        parent: Option<u32>,
        /// `parent` is a star: the body orbits it as a planet, with its moons, and takes no
        /// moon bit. The core cannot tell a star from the bytes, so the caller says. Ignored
        /// with no parent.
        star: bool,
        radius: f64,
        angle: f64,
    },
    /// A save's natural wormhole put at `radius` and `angle` about its system's star, as
    /// [`Op::MoveSaveBody`] places a planet. Angles are degrees, written normalised to
    /// [0, 360). Only `coordinate.x` and `.y` of the `natural_wormholes` entry are written: a
    /// wormhole has no orbit, and the system's `inner_radius` is left as it is. An entry
    /// whose bypass is not a `wormhole`, such as a shroud tunnel, is refused. The inverse
    /// moves it back to its old point. Stellaris 4.x save documents only.
    MoveSaveWormhole {
        wormhole: u32,
        radius: f64,
        angle: f64,
    },
    /// The ring bit of a save body's `binary_flags`, set when `ring` and cleared when not:
    /// the statement is written before `entity_planet_class` or `coordinate` when the body
    /// has none, and goes when only the bit set beside any other is left. The body's class
    /// is not checked. A ring bit already as asked is refused with
    /// [`OpError::RingUnchanged`]; the inverse flips `ring`. Stellaris 4.x save documents
    /// only.
    SetPlanetRing {
        planet: u32,
        ring: bool,
    },
    /// A save planet's model: `entity_name="<entity>"` written on the line after its
    /// `entity=N`, which stays, or rewritten in place, or removed with the `binary_flags` bit
    /// an initializer's model sets when `None`. The model is written as given, on any class:
    /// only one that is not an identifier is refused, and so are a star and a model already
    /// as asked. A class change in game drops the model. The inverse sets the old one back,
    /// without that bit. Stellaris 4.x save documents only.
    SetPlanetEntity {
        planet: u32,
        entity: Option<String>,
    },
    /// A new asteroid belt of type `kind` at `radius`, last in the system's
    /// `asteroid_belts`, which the system gains when it has none. A belt reaching past the
    /// system's bodies and belts, or outside its `inner_radius`, grows that radius as a moved
    /// body does. The inverse is [`Op::RemoveSaveBelt`] at the new last index, batched with
    /// the old inner radius when it grew. Stellaris 4.x save documents only.
    AddSaveBelt {
        system: u32,
        kind: String,
        radius: f64,
    },
    /// The `index`th belt of the system's `asteroid_belts`, counted from 0; the block goes
    /// with its last belt. The inverse adds it back, last. Stellaris 4.x save documents only.
    RemoveSaveBelt {
        system: u32,
        index: usize,
    },
    /// The `index`th belt's `inner_radius`. Its asteroids stay where they are; the app
    /// moves them in the same [`Op::Batch`]. A belt moved past the system's reach grows its
    /// `inner_radius` as [`Op::AddSaveBelt`] does. Its own inverse, batched with the old
    /// inner radius when it grew. Stellaris 4.x save documents only.
    SetSaveBeltRadius {
        system: u32,
        index: usize,
        radius: f64,
    },
    /// The `index`th belt's `type`, written as given: only one that is not an identifier
    /// is refused. Its own inverse. Stellaris 4.x save documents only.
    SetSaveBeltKind {
        system: u32,
        index: usize,
        kind: String,
    },
    /// A save system's `inner_radius`, with `outer_radius` the session's outer offset past
    /// it. A radius inside the system's outermost body or belt, or below the session's
    /// smallest inner radius, is refused unless it is no smaller than the value the system
    /// already holds. Its own inverse. Stellaris 4.x save documents only.
    SetSaveInnerRadius {
        system: u32,
        radius: f64,
    },
    /// A save planet and its moons taken from their system into system `to`: their
    /// `planet=` lines leave the old system and follow the new one's last, and their
    /// `origin` becomes `to`. The planet keeps its angle about the centre on an orbit the
    /// inner radius offset past the new system's reach, or goes to `at` when given, as
    /// [`Op::MoveSaveBody`] places a body. Its moons keep their places about it, and the
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
    MoveSavePlanet {
        planet: u32,
        to: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        at: Option<OrbitPlacement>,
    },
    /// A save planet's or moon's name, written as the game writes a name a player typed:
    /// `name={ key="<name>" literal=yes }`. Each moon, and each moon of a moon, whose name
    /// holds the body's old name as the value of a `PARENT` variable, as
    /// `SUBPLANET_NAME_FORMAT` names a moon after its planet, holds the new one there. A
    /// moon holding something else there keeps it. `block`, when given, is written in place
    /// of the name instead: a whole `{ … }` name value, which `name` then only describes.
    /// It is what the inverse carries, so that undoing a rename puts back the name as it
    /// stood. An empty name, a name the body already has, and a star are refused: the
    /// system's primary body, or a body of a star's class, whose planets hold its name in
    /// copies of their own. Save documents only.
    RenameSavePlanet {
        planet: u32,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        block: Option<String>,
    },
    /// A new archaeological dig site of type `site_type` on a save planet, a moon or colony
    /// included: an entry last in `archaeological_sites.sites`, its id one past the highest
    /// the save has held since it was opened, written as the game writes a site nobody has
    /// dug, with `difficulty` its first stage's. The game fills in which countries see it. The
    /// type is written as given: only an empty one, or one that is not an identifier, is
    /// refused, and so are a star, a planet that has a site and a save before Stellaris 4.0. The inverse is [`Op::RemoveDigSite`]. Save documents only.
    AddDigSite {
        planet: u32,
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

    /// Whether this op leaves the details of the systems it touched stale. The
    /// projection is keyed by the systems the graph holds, so an op that adds or removes
    /// one stales it, and a scenario system's planets and resources come from its
    /// initializer, so an op that writes one stales it too, a scripted seat included
    /// because it may bring an initializer with it. A save's details list a star's
    /// bodies, whose classes [`Op::SetStarClass`] writes, whose sizes [`Op::SetPlanetSize`]
    /// does and whose deposits [`Op::AddSaveDeposit`] and [`Op::RemoveSaveDeposit`] do, and
    /// a save system an op adds brings its bodies with it, and [`Op::AddPlanetModifier`],
    /// [`Op::RemovePlanetModifier`] and [`Op::SetPlanetRing`] stale the one planet they wrote, as [`Op::RenameSavePlanet`]
    /// does the planet and moons it renamed, and [`Op::AddDigSite`] and [`Op::RemoveDigSite`]
    /// the planet whose site they wrote. [`Op::MoveSaveWormhole`] stales the system whose
    /// wormhole it moved.
    pub fn stales_details(&self) -> bool {
        match self {
            Self::SetStarClass { .. }
            | Self::SetPlanetSize { .. }
            | Self::AddPlanetModifier { .. }
            | Self::RemovePlanetModifier { .. }
            | Self::AddSaveDeposit { .. }
            | Self::RemoveSaveDeposit { .. }
            | Self::AddSaveSystem { .. }
            | Self::ReplaceSaveSystem { .. }
            | Self::RenameSaveSystem { .. }
            | Self::AddSystem { .. }
            | Self::RemoveSystem { .. }
            | Self::AddSystems { .. }
            | Self::RemoveSystems { .. }
            | Self::SetInitializer { .. }
            | Self::SetInitializers { .. }
            | Self::SetSpawnScript { .. }
            | Self::SetSpawnScripts { .. }
            | Self::MoveSaveBody { .. }
            | Self::SetSaveBodyParent { .. }
            | Self::MoveSaveWormhole { .. }
            | Self::SetPlanetRing { .. }
            | Self::AddSaveBelt { .. }
            | Self::RemoveSaveBelt { .. }
            | Self::SetSaveBeltRadius { .. }
            | Self::SetSaveBeltKind { .. }
            | Self::SetSaveInnerRadius { .. }
            | Self::MoveSavePlanet { .. }
            | Self::RenameSavePlanet { .. }
            | Self::AddDigSite { .. }
            | Self::RemoveDigSite { .. } => true,
            Self::Batch { ops, .. } => ops.iter().any(Self::stales_details),
            _ => false,
        }
    }

    /// Whether the details this op stales come up to date by rereading, in place, the
    /// planets it rewrote and the belts, inner radius and wormhole points of the systems it
    /// rewrote, without building the projection again.
    pub fn refreshes_details_in_place(&self) -> bool {
        match self {
            Self::SetStarClass { .. }
            | Self::SetPlanetSize { .. }
            | Self::AddPlanetModifier { .. }
            | Self::RemovePlanetModifier { .. }
            | Self::MoveSaveBody { .. }
            | Self::SetSaveBodyParent { .. }
            | Self::MoveSaveWormhole { .. }
            | Self::SetPlanetRing { .. }
            | Self::AddSaveBelt { .. }
            | Self::RemoveSaveBelt { .. }
            | Self::SetSaveBeltRadius { .. }
            | Self::SetSaveBeltKind { .. }
            | Self::SetSaveInnerRadius { .. }
            | Self::RenameSavePlanet { .. } => true,
            Self::Batch { ops, .. } => ops
                .iter()
                .all(|op| op.refreshes_details_in_place() || !op.stales_details()),
            _ => false,
        }
    }

    /// Whether, in a save, the details this op stales are only those of the systems whose
    /// bodies it wrote: a save system's lanes rewrite its neighbours, whose details stand
    /// as they were. A scenario's systems have no bodies, so there it stales them all.
    pub fn stales_only_bodies(&self) -> bool {
        match self {
            Self::AddSaveSystem { .. }
            | Self::ReplaceSaveSystem { .. }
            | Self::RenameSaveSystem { .. }
            | Self::RemoveSystem { .. }
            | Self::RemoveSystems { .. }
            | Self::AddSaveDeposit { .. }
            | Self::RemoveSaveDeposit { .. }
            | Self::AddDigSite { .. }
            | Self::RemoveDigSite { .. } => true,
            Self::Batch { ops, .. } => ops
                .iter()
                .all(|op| op.stales_only_bodies() || !op.stales_details()),
            _ => false,
        }
    }

    /// Whether this op can have moved how the systems it touched are classified: the
    /// initializer a classification is read from, the name it is labelled by, or the
    /// star flags the scripts place a wormhole by.
    pub fn reclassifies(&self) -> bool {
        match self {
            Self::SetSystemName { .. }
            | Self::RenameSaveSystem { .. }
            | Self::SetWormholePair { .. }
            | Self::SetWormholeEnds { .. } => true,
            Self::SetStarClass { .. }
            | Self::SetPlanetSize { .. }
            | Self::AddPlanetModifier { .. }
            | Self::RemovePlanetModifier { .. }
            | Self::AddSaveDeposit { .. }
            | Self::RemoveSaveDeposit { .. }
            | Self::MoveSaveBody { .. }
            | Self::SetSaveBodyParent { .. }
            | Self::MoveSaveWormhole { .. }
            | Self::SetPlanetRing { .. }
            | Self::SetPlanetEntity { .. }
            | Self::AddSaveBelt { .. }
            | Self::RemoveSaveBelt { .. }
            | Self::SetSaveBeltRadius { .. }
            | Self::SetSaveBeltKind { .. }
            | Self::SetSaveInnerRadius { .. }
            | Self::MoveSavePlanet { .. }
            | Self::RenameSavePlanet { .. }
            | Self::AddDigSite { .. }
            | Self::RemoveDigSite { .. } => false,
            Self::Batch { ops, .. } => ops.iter().any(Self::reclassifies),
            _ => self.stales_details(),
        }
    }
}

/// One system's initializer in [`Op::SetInitializers`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InitializerSet {
    pub id: u32,
    pub initializer: Option<String>,
}

/// One star body's new planet class in [`Op::SetStarClass`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StarBody {
    pub planet: u32,
    pub class: String,
}

/// One system to add in [`Op::AddSystems`]: an [`Op::AddSystem`] with its id given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NewSystem {
    pub id: u32,
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

/// One system's destination in [`Op::MoveSystems`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemMove {
    pub id: u32,
    pub x: f64,
    pub y: f64,
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

#[derive(Debug, thiserror::Error)]
pub enum OpError {
    #[error("system {0} does not exist")]
    UnknownSystem(u32),
    #[error("system {0} already exists")]
    SystemExists(u32),
    #[error("{0} is the null id, which no system may take")]
    NullSystemId(u32),
    #[error("{what} may not be empty")]
    EmptyText { what: &'static str },
    #[error("{text:?} cannot be written as {what}")]
    InvalidText { what: &'static str, text: String },
    #[error("planet {planet}: {error}")]
    OnPlanet { planet: u32, error: Box<OpError> },
    #[error("nebula {0} does not exist")]
    UnknownNebula(usize),
    #[error("system {0} cannot have a lane to itself")]
    SelfLane(u32),
    #[error("systems {0} and {1} are already linked")]
    LaneExists(u32, u32),
    #[error("systems {0} and {1} are not linked")]
    NoSuchLane(u32, u32),
    #[error("lane {0} <-> {1} holds a different length on each end")]
    LaneEndsDisagree(u32, u32),
    #[error("lane {0} <-> {1} is already prevented")]
    PreventExists(u32, u32),
    #[error("a hyperlane already runs between {0} and {1}: remove it before preventing the pair")]
    PreventLinked(u32, u32),
    #[error("lane {0} <-> {1} is not prevented")]
    NotPrevented(u32, u32),
    #[error("system {0} has no hyperlanes")]
    NoLanes(u32),
    #[error("value is not a finite number")]
    NotFinite,
    #[error("length {length} is invalid: {reason}")]
    InvalidLength { length: f64, reason: String },
    #[error("radius {radius} is invalid: {reason}")]
    InvalidRadius { radius: f64, reason: String },
    #[error("spawn weight {weight} is invalid: {reason}")]
    InvalidWeight { weight: f64, reason: String },
    #[error("system {0}'s spawn weight is script; change its spawn kind instead")]
    ScriptedSpawn(u32),
    #[error("a system takes a spawn weight or a spawn script, not both")]
    WeightAndScript,
    #[error(
        "a reserved seat is named by a letter a to z or a Greek letter alpha to omega, not {0:?}"
    )]
    InvalidSeatLetter(String),
    #[error(
        "an enabled seat has no marker to make it the player's; choose a 1st Player, Sol or reserved seat"
    )]
    EnabledSeatPlayer,
    #[error(
        "Fallen empire zone from {anchor} is blocked by {blocker}: the mod needs the ring empty"
    )]
    FeZoneBlocked { anchor: String, blocker: String },
    #[error("Fallen empire zone from {anchor} is off the map")]
    FeZoneOffMap { anchor: String },
    #[error("system {0} cannot be paired with itself")]
    WormholeSelf(u32),
    #[error("wormhole pair {0} is already in use")]
    WormholePairInUse(u32),
    #[error("system {0} anchors no fallen empire zone")]
    FeLinkNoZone(u32),
    #[error("system {0} cannot link to its own fallen empire zone")]
    FeLinkSelf(u32),
    #[error("every fallen empire connection id is taken")]
    FeLinkIdsExhausted,
    #[error("fallen empire connection id {0} is beyond the {1} the mod reads")]
    FeLinkIdOutOfRange(u8, u8),
    #[error("random value {0} is beyond the {1} a Paint a Galaxy seat is drawn from")]
    RandomValueOutOfRange(u8, u8),
    #[error("no entries given")]
    NoEntries,
    #[error("every lane already has the length the game writes")]
    AlreadyNormal,
    #[error("a batch with nothing in it")]
    EmptyBatch,
    #[error("no planets to move")]
    NoPlanets,
    #[error("a batch may not hold another batch")]
    NestedBatch,
    #[error("system {0} is listed more than once")]
    DuplicateSystem(u32),
    #[error("lane {0} <-> {1} is listed more than once")]
    DuplicateLane(u32, u32),
    #[error("system {system}: {reason} at byte {offset}")]
    Parse {
        system: u32,
        offset: usize,
        reason: String,
    },
    #[error("nebula {nebula}: {reason} at byte {offset}")]
    NebulaParse {
        nebula: usize,
        offset: usize,
        reason: String,
    },
    #[error("scenario header: {reason} at byte {offset}")]
    HeaderParse { offset: usize, reason: String },
    #[error("global flags: {reason} at byte {offset}")]
    FlagsParse { offset: usize, reason: String },
    #[error("planet {planet}: {reason} at byte {offset}")]
    PlanetParse {
        planet: u32,
        offset: usize,
        reason: String,
    },
    #[error("the document has no global flags")]
    NoFlags,
    #[error("the galaxy has no L-Gate")]
    NoLGate,
    #[error("a gate has opened: the outcome has already spawned")]
    LGateOpened,
    #[error("the L-Gate outcome is already {0}")]
    LGateUnchanged(&'static str),
    #[error("planet {0} does not exist")]
    UnknownPlanet(u32),
    #[error("no star bodies given")]
    NoStarBodies,
    #[error("planet {planet} is not a body of system {system}")]
    NotABody { planet: u32, system: u32 },
    #[error("planet {0} is listed more than once")]
    DuplicatePlanet(u32),
    #[error("system {0} is already {1} with those star bodies")]
    StarClassUnchanged(u32, String),
    #[error("a planet size may not be zero")]
    ZeroPlanetSize,
    #[error("planet {0} is already size {1}")]
    PlanetSizeUnchanged(u32, u32),
    #[error("planet {0} is its system's star, which takes no planet modifiers")]
    StarModifier(u32),
    #[error("planet {0} already has {1}")]
    ModifierPresent(u32, String),
    #[error("planet {0} does not have {1}")]
    ModifierAbsent(u32, String),
    #[error("a modifier cannot last 0 days: -1 keeps it for ever")]
    ModifierDays,
    #[error("{0} copies of a modifier: an op adds or restores 1 to {max}", max = MAX_MODIFIER_COPIES)]
    ModifierCopies(u32),
    #[error("country {0} does not exist")]
    UnknownCountry(u32),
    #[error("country {0} has no map colours: map colours need a Stellaris 4.5 save")]
    NoMapColors(u32),
    #[error("country {0}'s map colours are already set that way")]
    MapColorsUnchanged(u32),
    #[error("country {0}'s flag is already set that way")]
    FlagUnchanged(u32),
    #[error("country {0} already has that name")]
    EmpireNameUnchanged(u32),
    #[error("save meta: {reason} at byte {offset}")]
    MetaParse { offset: usize, reason: String },
    #[error("save statement: {reason} at byte {offset}")]
    RecordParse { offset: usize, reason: String },
    #[error("this edit needs a save from Stellaris 4.0 or later, not {0}")]
    SaveTooOld(String),
    #[error("the save's version {0:?} names no major version, so it cannot take this edit")]
    UnknownSaveVersion(String),
    #[error("an Ironman save cannot take this edit")]
    Ironman,
    #[error("the save has no `{0}`")]
    MissingSaveKey(&'static str),
    #[error(
        "the save's last system is {last} but it holds {count} systems: a new system needs ids 0 to {last} held, without a gap"
    )]
    SystemIdsNotDense { last: u32, count: usize },
    #[error("system {id} is {distance:.2} away; a new system needs 10 between them")]
    TooClose { id: u32, distance: f64 },
    #[error("({x}, {y}) is outside the galaxy's radius of {radius}")]
    OutsideGalaxy { x: f64, y: f64, radius: f64 },
    #[error("{0} cannot have moons")]
    MoonsNotAllowed(&'static str),
    #[error("{0} cannot be an asteroid")]
    AsteroidNotAllowed(&'static str),
    #[error("{0} cannot have a fixed name")]
    FixedNameNotAllowed(&'static str),
    #[error("{0} cannot have a ring")]
    RingNotAllowed(&'static str),
    #[error(
        "system {other}, added since the file was opened, has layout {initializer} with capped set to {capped}: a system of the same layout must match it"
    )]
    CappedMismatch {
        initializer: String,
        other: u32,
        capped: bool,
    },
    #[error(
        "system {0} was in the save when it was opened: only a system added since then can be removed, rolled again or renamed"
    )]
    SystemNotAdded(u32),
    #[error("deposit {0} does not exist")]
    UnknownDeposit(u32),
    #[error("deposit {0} is not held by a planet")]
    DepositNotOnPlanet(u32),
    #[error("planet {0} is a star, which takes no dig site")]
    StarDigSite(u32),
    #[error("planet {planet} already has dig site {site}")]
    DigSitePresent { planet: u32, site: u32 },
    #[error("dig site {0} does not exist")]
    UnknownDigSite(u32),
    #[error("dig site {0} is not on a planet")]
    DigSiteNotOnPlanet(u32),
    #[error("every system of {nebula} is already {state}")]
    TurbulenceUnchanged { nebula: String, state: &'static str },
    #[error("{0:?} is not a nebula cloud type")]
    InvalidCloudType(String),
    #[error("ambient object {0} cannot be written back: its slot is taken")]
    AmbientSlotTaken(u32),
    #[error("system {0} is already named {1}")]
    NameUnchanged(u32, String),
    #[error("planet {0} is already named {1}")]
    PlanetNameUnchanged(u32, String),
    #[error("planet {0} is a star: only a planet or moon can be renamed")]
    StarNotRenamed(u32),
    #[error("planet {0} stands at the system's centre")]
    AtCentre(u32),
    #[error(
        "planet {body} is a moon of planet {parent}, which the save does not hold: make it a planet first"
    )]
    ParentMissing { body: u32, parent: u32 },
    #[error("planet {0} already stands there")]
    BodyUnchanged(u32),
    #[error("natural wormhole {0} does not exist")]
    UnknownWormhole(u32),
    #[error("natural wormhole {wormhole} has bypass type \"{kind}\": only a wormhole can be moved")]
    NotAWormhole { wormhole: u32, kind: String },
    #[error("wormhole {0} already stands there")]
    WormholeUnchanged(u32),
    #[error("{reason}")]
    InvalidParent { reason: String },
    #[error("planet {0} has moons, so it cannot become a moon")]
    HasMoons(u32),
    #[error("planet {0} already has that parent")]
    ParentUnchanged(u32),
    #[error("planet {planet} {state}")]
    RingUnchanged { planet: u32, state: &'static str },
    #[error("planet {0} is a star, which takes no planet model")]
    StarModel(u32),
    #[error("planet {planet} {state}")]
    ModelUnchanged { planet: u32, state: String },
    #[error("system {system} has no belt {index}")]
    UnknownBelt { system: u32, index: usize },
    #[error("belt {index} of system {system} is already that way")]
    BeltUnchanged { system: u32, index: usize },
    #[error(
        "the inner radius cannot go below {least:.2}, which the system's bodies and belts reach"
    )]
    InnerRadiusTooSmall { least: f64 },
    #[error("system {0} already has that inner radius")]
    InnerRadiusUnchanged(u32),
    #[error("planet {planet} is already a body of system {system}")]
    AlreadyInSystem { planet: u32, system: u32 },
    #[error("planet {0} is a star: only a planet can move to another system")]
    StarNotMovable(u32),
    #[error("system {0} lists no bodies, so a planet cannot join it")]
    NoBodies(u32),
    #[error("system {system} holds planet {planet} from the save; move it out first")]
    HoldsSavePlanet { system: u32, planet: u32 },
    #[error("planet {0} has a megastructure, so it cannot move to another system")]
    MegastructurePlanet(u32),
    #[error("planet {planet} is owned by country {owner} but controlled by country {controller}")]
    PlanetOccupied {
        planet: u32,
        owner: u32,
        controller: u32,
    },
    #[error("country {country}: {reason} at byte {offset}")]
    CountryParse {
        country: u32,
        offset: usize,
        reason: String,
    },
    #[error("{op} is not supported for a {kind} document")]
    Unsupported {
        op: &'static str,
        kind: DocumentKind,
    },
    #[error(transparent)]
    Overlay(#[from] OverlayError),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
    #[error(transparent)]
    Document(#[from] document::Error),
}

impl OpError {
    /// How the refusal crosses to the app: an entity the document does not hold, text it
    /// could not read, or an edit refused.
    pub fn kind(&self) -> ErrorKind {
        match self {
            Self::UnknownSystem { .. }
            | Self::UnknownNebula { .. }
            | Self::UnknownPlanet { .. }
            | Self::UnknownCountry { .. }
            | Self::UnknownDeposit { .. }
            | Self::UnknownDigSite { .. }
            | Self::UnknownBelt { .. }
            | Self::UnknownWormhole { .. } => ErrorKind::NotFound,
            Self::Parse { .. }
            | Self::NebulaParse { .. }
            | Self::HeaderParse { .. }
            | Self::FlagsParse { .. }
            | Self::PlanetParse { .. }
            | Self::RecordParse { .. }
            | Self::CountryParse { .. }
            | Self::MetaParse { .. }
            | Self::Overlay { .. }
            | Self::Projection { .. }
            | Self::Document { .. } => ErrorKind::Format,
            Self::SystemExists { .. }
            | Self::NullSystemId { .. }
            | Self::EmptyText { .. }
            | Self::InvalidText { .. }
            | Self::OnPlanet { .. }
            | Self::SelfLane { .. }
            | Self::LaneExists { .. }
            | Self::NoSuchLane { .. }
            | Self::LaneEndsDisagree { .. }
            | Self::PreventExists { .. }
            | Self::PreventLinked { .. }
            | Self::NotPrevented { .. }
            | Self::NoLanes { .. }
            | Self::NotFinite { .. }
            | Self::InvalidLength { .. }
            | Self::InvalidRadius { .. }
            | Self::InvalidWeight { .. }
            | Self::ScriptedSpawn { .. }
            | Self::WeightAndScript { .. }
            | Self::InvalidSeatLetter { .. }
            | Self::EnabledSeatPlayer { .. }
            | Self::FeZoneBlocked { .. }
            | Self::FeZoneOffMap { .. }
            | Self::WormholeSelf { .. }
            | Self::WormholePairInUse { .. }
            | Self::FeLinkNoZone { .. }
            | Self::FeLinkSelf { .. }
            | Self::FeLinkIdsExhausted { .. }
            | Self::FeLinkIdOutOfRange { .. }
            | Self::RandomValueOutOfRange { .. }
            | Self::NoEntries { .. }
            | Self::AlreadyNormal { .. }
            | Self::EmptyBatch { .. }
            | Self::NoPlanets
            | Self::NestedBatch { .. }
            | Self::DuplicateSystem { .. }
            | Self::DuplicateLane { .. }
            | Self::NoFlags { .. }
            | Self::NoLGate { .. }
            | Self::LGateOpened { .. }
            | Self::LGateUnchanged { .. }
            | Self::NoStarBodies { .. }
            | Self::NotABody { .. }
            | Self::DuplicatePlanet { .. }
            | Self::StarClassUnchanged { .. }
            | Self::ZeroPlanetSize { .. }
            | Self::PlanetSizeUnchanged { .. }
            | Self::StarModifier { .. }
            | Self::ModifierPresent { .. }
            | Self::ModifierAbsent { .. }
            | Self::ModifierDays { .. }
            | Self::ModifierCopies { .. }
            | Self::NoMapColors { .. }
            | Self::MapColorsUnchanged { .. }
            | Self::FlagUnchanged { .. }
            | Self::EmpireNameUnchanged { .. }
            | Self::SaveTooOld { .. }
            | Self::UnknownSaveVersion { .. }
            | Self::Ironman { .. }
            | Self::MissingSaveKey { .. }
            | Self::SystemIdsNotDense { .. }
            | Self::TooClose { .. }
            | Self::OutsideGalaxy { .. }
            | Self::MoonsNotAllowed { .. }
            | Self::AsteroidNotAllowed { .. }
            | Self::FixedNameNotAllowed { .. }
            | Self::RingNotAllowed { .. }
            | Self::CappedMismatch { .. }
            | Self::SystemNotAdded { .. }
            | Self::DepositNotOnPlanet { .. }
            | Self::StarDigSite { .. }
            | Self::DigSitePresent { .. }
            | Self::DigSiteNotOnPlanet { .. }
            | Self::TurbulenceUnchanged { .. }
            | Self::InvalidCloudType { .. }
            | Self::AmbientSlotTaken { .. }
            | Self::NameUnchanged { .. }
            | Self::PlanetNameUnchanged { .. }
            | Self::StarNotRenamed { .. }
            | Self::AtCentre { .. }
            | Self::ParentMissing { .. }
            | Self::BodyUnchanged { .. }
            | Self::NotAWormhole { .. }
            | Self::WormholeUnchanged { .. }
            | Self::InvalidParent { .. }
            | Self::HasMoons { .. }
            | Self::ParentUnchanged { .. }
            | Self::RingUnchanged { .. }
            | Self::StarModel { .. }
            | Self::ModelUnchanged { .. }
            | Self::BeltUnchanged { .. }
            | Self::InnerRadiusTooSmall { .. }
            | Self::InnerRadiusUnchanged { .. }
            | Self::AlreadyInSystem { .. }
            | Self::StarNotMovable { .. }
            | Self::NoBodies { .. }
            | Self::HoldsSavePlanet { .. }
            | Self::MegastructurePlanet { .. }
            | Self::PlanetOccupied { .. }
            | Self::Unsupported { .. } => ErrorKind::Op,
        }
    }
}
