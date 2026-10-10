//! `common/solar_system_initializers`: what a system was generated from.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sgf_core::cst::{self, Node};
use sgf_core::format::save::details::{CountRange, InlineScriptUse};
use sgf_core::span::Span;
use ts_rs::TS;

use crate::body_effects::{self, BodyEffect, HOME_EFFECTS, Unwritten};
use crate::install::layers::{Layout, VANILLA};
use crate::install::script::{self, Def, ParsedDir, Range, Variables, whole};
use crate::registries::planet_classes::PlanetClassDef;
use crate::registries::registry::{FromDef, Registry};
use crate::scripts::init_bypasses::bypasses;
use crate::stated::{self, StatedBody, StatedSystem};
use crate::weight::Weight;
use crate::{Diagnostic, GameData};

pub use crate::scripts::init_bypasses::{InitBypass, InitBypasses, PartnerRef};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlagIcon {
    pub category: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpawnedCountry {
    pub name_key: String,
    pub country_type: String,
    pub icon: Option<FlagIcon>,
}

/// One `planet` or `moon` block: what the initializer will spawn there.
#[derive(Debug, Clone, PartialEq)]
pub struct InitPlanet {
    /// The localisation key as written, when the block names one.
    pub name: Option<String>,
    /// As written: a `pc_` class, `star`, a `random_…` choice, an `rl_` list or `none`.
    pub class: BodyClass,
    /// `(min, max)`, equal for a fixed size.
    pub size: Option<(u32, u32)>,
    /// How far each instance lies beyond the one before; `None` for an `@variable` no
    /// file defines.
    pub orbit_distance: Option<Range>,
    /// Degrees each instance turns on from the one before.
    pub orbit_angle: Option<Range>,
    /// The sum of the `change_orbit` statements between the previous sibling block and
    /// this one, which moves every later instance out (or in).
    pub change_orbit: f64,
    /// `has_ring = yes` or `no`; `None` leaves it to the class's `chance_of_ring`.
    pub has_ring: Option<bool>,
    /// `entity = "…"`: the model drawn in place of the class's own.
    pub entity: Option<String>,
    /// How many instances the block spawns; `1` when it says nothing.
    pub count: Range,
    pub home_planet: bool,
    /// The `event_target:` token a `create_colony`, or a `set_owner` beside a
    /// colonisation effect, gives this body to.
    pub colony_owner: Option<String>,
    /// A home planet, an effect that generates an empire's, or a colony.
    pub colonised: bool,
    /// A `generate_…pre_ftl…_on_planet` effect.
    pub pre_ftl: bool,
    /// Every `create_archaeological_site` in this block's effects, in file order.
    pub sites: Vec<String>,
    /// Every `add_deposit = d_…` in this block's effects, its moons aside.
    pub deposits: Vec<String>,
    /// `false` for `deposit_blockers = none`: the body rolls no blockers.
    pub blockers: bool,
    /// What this block's `init_effect` runs that a generated body is given, in order.
    pub effects: Vec<BodyEffect>,
    /// The first statement of this block's `init_effect` that is neither given to a
    /// generated body nor dropped with the script, plain and for a converted layout.
    pub unwritten: Unwritten,
    /// Its `moon` blocks, and the `planet` blocks written inside it, which the game spawns
    /// around it the same way, in file order.
    pub moons: Vec<InitPlanet>,
    /// What else the block and its `init_effect` state of the body.
    pub stated: StatedBody,
}

impl InitPlanet {
    /// How many instances the block spawns, as a range to draw from. A block written
    /// `class = star` spawns one whatever its `count` says: Previously Terraformed writes one
    /// to two, and the game's saves show one star (unverified in game beyond that one system).
    pub fn count(&self) -> Range {
        match self.class {
            BodyClass::Star => Range::fixed(1.0),
            _ => self.count,
        }
    }

    /// The representative number of instances: the midpoint of [`Self::count`], rounded.
    pub fn instances(&self) -> u32 {
        whole(self.count().midpoint())
    }

    /// The fewest and the most instances the game can spawn.
    pub fn copies(&self) -> CountRange {
        let count = self.count();
        let min = whole(count.min.min(count.max));
        CountRange {
            min,
            max: whole(count.max).max(min),
        }
    }

    /// `class = none`: no body, only a step out of the running orbit.
    pub fn spacer(&self) -> bool {
        self.class == SPACER
    }

    /// The block's own `size`, when it fixes one.
    pub fn size_range(&self) -> Option<Range> {
        self.size.map(|(min, max)| Range {
            min: f64::from(min),
            max: f64::from(max),
        })
    }

    /// The representative orbit distance: the midpoint of `orbit_distance`.
    pub fn orbit(&self) -> Option<f64> {
        self.orbit_distance.map(Range::midpoint)
    }

    /// This block's own instances and every moon they carry; none for a spacer.
    pub fn total(&self) -> u32 {
        if self.spacer() {
            return 0;
        }
        let moons: u32 = self.moons.iter().map(Self::total).sum();
        self.instances().saturating_mul(1 + moons)
    }
}

impl PlanetClassDef {
    /// The size range the generator draws a body of this class from, a moon's or a planet's.
    pub fn size(&self, moon: bool) -> Option<Range> {
        if moon {
            self.moon_size
        } else {
            self.planet_size
        }
    }
}

/// The size a body of `block` is drawn from: the block's own `size`, else its class's. A body
/// no layout writes has no block.
pub(crate) fn body_size(
    block: Option<&InitPlanet>,
    class: Option<&PlanetClassDef>,
    moon: bool,
) -> Option<Range> {
    block
        .and_then(InitPlanet::size_range)
        .or_else(|| class.and_then(|c| c.size(moon)))
}

/// The body written as `class = star`, which takes the star class's own planet class.
const STAR: &str = "star";
/// A block that spawns nothing but moves the running orbit out by its `orbit_distance`.
const SPACER: &str = "none";
/// A body whose class the engine draws, among every class, the ones that can be colonised,
/// or the ones that cannot.
const RANDOM: &str = "random";
const RANDOM_COLONIZABLE: &str = "random_colonizable";
const RANDOM_NON_COLONIZABLE: &str = "random_non_colonizable";

/// A body's `class`, as the engine reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BodyClass {
    /// The star class's own planet class.
    Star,
    /// Drawn by the engine: among the classes that can be colonised (`Some(true)`), those
    /// that cannot (`Some(false)`), or every one.
    Random(Option<bool>),
    /// A planet class or a planet list of the install, by key.
    Named(String),
}

impl BodyClass {
    pub fn of(written: &str) -> Self {
        match written {
            STAR => Self::Star,
            RANDOM => Self::Random(None),
            RANDOM_COLONIZABLE => Self::Random(Some(true)),
            RANDOM_NON_COLONIZABLE => Self::Random(Some(false)),
            key => Self::Named(key.to_owned()),
        }
    }

    /// The class as the layout writes it.
    pub fn written(&self) -> &str {
        match self {
            Self::Star => STAR,
            Self::Random(None) => RANDOM,
            Self::Random(Some(true)) => RANDOM_COLONIZABLE,
            Self::Random(Some(false)) => RANDOM_NON_COLONIZABLE,
            Self::Named(key) => key,
        }
    }

    /// The key of a planet class or list the layout names.
    pub fn named(&self) -> Option<&str> {
        match self {
            Self::Named(key) => Some(key),
            _ => None,
        }
    }
}

impl PartialEq<&str> for BodyClass {
    fn eq(&self, written: &&str) -> bool {
        self.written() == *written
    }
}

/// One body of a system's planet list: the block it was written as, and
/// whether it orbits another body.
#[derive(Debug, Clone, Copy)]
pub struct Body<'p> {
    pub block: &'p InitPlanet,
    pub moon: bool,
    /// The planet index of the body this one was expanded under.
    pub parent: Option<usize>,
    /// Which instance of its block it is, from 1.
    pub copy: u32,
    /// The game spawns it whatever it draws: it is within the fewest instances its block
    /// spawns, and so is every body it was expanded under.
    pub always: bool,
}

/// Every body `planets` can expand to, in the order a system's planet list
/// gives them: each instance of a block up to the most its `count` allows, then that
/// instance's moons. A spacer gives none. A body's position in this sequence is its planet
/// index.
pub fn expand(planets: &[InitPlanet]) -> impl Iterator<Item = Body<'_>> {
    let mut out = Vec::new();
    push_bodies(planets, None, true, &mut out);
    out.into_iter()
}

fn push_bodies<'p>(
    blocks: &'p [InitPlanet],
    parent: Option<usize>,
    parent_always: bool,
    out: &mut Vec<Body<'p>>,
) {
    for block in blocks.iter().filter(|b| !b.spacer()) {
        let copies = block.copies();
        for copy in 1..=copies.max {
            let index = out.len();
            let always = parent_always && copy <= copies.min;
            out.push(Body {
                block,
                moon: parent.is_some(),
                parent,
                copy,
                always,
            });
            push_bodies(&block.moons, Some(index), always, out);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Initializer {
    pub name: String,
    pub source: PathBuf,
    /// The initializer's own `name` scalar, a localisation key; most name none.
    pub display_name: Option<String>,
    pub class: Option<String>,
    pub usage: Option<String>,
    /// The weight a galaxy draws this initializer with for its `usage`, when written as
    /// a plain number; `None` when absent or a block of conditions.
    pub usage_odds: Option<f64>,
    /// `usage_odds` written as a block: its `base`, then each `modifier` whose conditions
    /// hold.
    pub usage_weight: Option<Weight>,
    pub max_instances: Option<u32>,
    pub flags: Vec<String>,
    /// Whether the system runs an `init_effect` once it is spawned.
    pub init_effect: bool,
    /// Every `create_country` below `init_effect`, at any depth.
    pub countries: Vec<SpawnedCountry>,
    /// Initializers this one places nearby (`neighbor_system` / `spawn_system`).
    pub spawns: Vec<String>,
    pub asteroid_belts: Vec<InitAsteroidBelt>,
    /// In file order, each carrying the `change_orbit` written before it.
    pub planets: Vec<InitPlanet>,
    /// Every `spawn_megastructure` type in the system's own effects, in file order.
    pub megastructures: Vec<String>,
    /// The bypasses the system's own effects spawn, its own ones drawable.
    pub bypasses: InitBypasses,
    /// Every `create_archaeological_site` written directly in the system's own
    /// `init_effect`, no planet's.
    pub sites: Vec<String>,
    pub starbase: Option<InitStarbase>,
    /// The system's block, or a `planet` or `moon` block in it, runs an `inline_script` that
    /// was not read in place: the bodies it places are not in [`Self::planets`].
    pub inline_script: bool,
    /// What else the block states of the system.
    pub stated: StatedSystem,
}

impl GameData {
    /// The mod `initializer` comes from, by its name, when this install knows it; `None`
    /// for the base game.
    pub fn initializer_source(&self, initializer: &str) -> Option<String> {
        let init = self.initializers.get(initializer)?;
        let (layer, _) = self.layout.layer_of(&init.source)?;
        (layer.name != VANILLA).then(|| layer.name.clone())
    }
}

/// One `asteroid_belt = { type radius }` of the system.
#[derive(Debug, Clone, PartialEq)]
pub struct InitAsteroidBelt {
    /// `rocky_asteroid_belt`, `icy_asteroid_belt`, …
    pub kind: String,
    pub radius: Option<f64>,
}

/// The `create_starbase` block: what the system is generated with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InitStarbase {
    /// The `size`, a `starbase_levels` key.
    pub size: String,
    pub modules: Vec<String>,
    pub buildings: Vec<String>,
}

impl FromDef for Initializer {
    const DIR: &'static str = "common/solar_system_initializers";

    fn read(name: String, def: &Def) -> Self {
        Self::read_spliced(name, def, &[])
    }
}

impl Initializer {
    /// The initializer `def` defines, `splices` the inline scripts its text was read with in
    /// place of their calls.
    fn read_spliced(name: String, def: &Def, splices: &[InlineScript]) -> Self {
        let src = &def.src;
        let node = &def.node;
        let planets = bodies(node, &["planet"], def, splices);
        let mut stated = stated::system(node, def);
        stated.inline_scripts = splices.iter().map(InlineScript::use_of).collect();
        stated.from_script = splices
            .iter()
            .find(|splice| splice.gives_everything(&planets))
            .map(|splice| splice.script.clone());
        Self {
            name,
            source: def.file.clone(),
            display_name: def.scalar("name").map(str::to_owned),
            class: def.scalar("class").map(str::to_owned),
            usage: def.scalar("usage").map(str::to_owned),
            usage_odds: def.number("usage_odds"),
            usage_weight: node
                .find("usage_odds", src)
                .filter(|odds| odds.scalar_span().is_none())
                .map(|odds| Weight::read(odds, def, 0.0)),
            max_instances: def.scalar("max_instances").and_then(|s| s.parse().ok()),
            flags: script::list_items(node, "flags", src),
            init_effect: node.find("init_effect", src).is_some(),
            countries: countries(node, src),
            spawns: spawns(node, src),
            asteroid_belts: asteroid_belts(def),
            planets,
            megastructures: megastructures(node, src),
            bypasses: bypasses(node, src),
            sites: own_sites(node, src),
            starbase: starbase(node, src),
            inline_script: places_by_script(node, src),
            stated,
        }
    }
}

/// Whether `node`, or a `planet` or `moon` block below it, runs an `inline_script` itself.
fn places_by_script(node: &Node, src: &[u8]) -> bool {
    node.children()
        .iter()
        .any(|child| match child.key_str(src) {
            Some("inline_script") => true,
            Some("planet" | "moon") => places_by_script(child, src),
            _ => false,
        })
}

/// The top-level keys of the install's own initializer files: from the parse when the file
/// won, else read here, since a mod replaced it by its filename.
fn vanilla_keys(layout: &Layout, parsed: &ParsedDir) -> HashSet<String> {
    let won: HashMap<&std::path::Path, (&Node, &[u8])> = parsed
        .files()
        .map(|(file, root, src)| (file, (root, src)))
        .collect();
    let mut keys = HashSet::new();
    let mut add = |root: &Node, src: &[u8]| {
        keys.extend(
            root.children()
                .iter()
                .filter_map(|node| node.key_str(src))
                .filter(|key| !key.starts_with('@'))
                .map(str::to_owned),
        );
    };
    for file in layout.vanilla_files_in(Initializer::DIR) {
        match won.get(file.as_path()) {
            Some(&(root, src)) => add(root, src),
            None => {
                if let Some((root, src)) = script::parse_file(&file, &mut Vec::new()) {
                    add(&root, &src);
                }
            }
        }
    }
    keys
}

/// The registry plus the reverse of every initializer's `spawns`, and the
/// blocks they were read from, which [`crate::scripts`] walks again.
#[derive(Debug, Default)]
pub struct Initializers {
    by_name: Registry<Initializer>,
    spawned_by: HashMap<String, Vec<String>>,
    defs: BTreeMap<String, Def>,
    /// The directory's winning files, in the order the game reads them.
    files: Vec<PathBuf>,
    /// The keys the game's own files define, whichever file won them.
    vanilla: HashSet<String>,
    /// Each definition that calls an inline script the install has, as the game reads it.
    spliced: HashMap<String, Spliced>,
}

/// A definition with each `inline_script` its own block calls read in place of the call.
#[derive(Debug, Clone)]
struct Spliced {
    def: Def,
    scripts: Vec<InlineScript>,
}

impl Initializers {
    pub(crate) fn load(
        layout: &Layout,
        globals: &Arc<Variables>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Self {
        let files = layout.files_in(Initializer::DIR);
        let parsed = ParsedDir::load(layout, Initializer::DIR, diagnostics);
        let vanilla = vanilla_keys(layout, &parsed);
        let defs = parsed.into_defs(globals, diagnostics);
        let mut spliced = HashMap::new();
        let by_name: Registry<Initializer> = defs
            .iter()
            .map(|(key, def)| {
                let (init, read) = read_with_scripts(key, def, layout);
                if let Some(read) = read {
                    spliced.insert(key.clone(), read);
                }
                (key.clone(), init)
            })
            .collect();
        let mut spawned_by: HashMap<String, Vec<String>> = HashMap::new();
        for init in by_name.iter() {
            for child in &init.spawns {
                spawned_by
                    .entry(child.clone())
                    .or_default()
                    .push(init.name.clone());
            }
        }
        Self {
            by_name,
            spawned_by,
            defs,
            files,
            vanilla,
            spliced,
        }
    }

    /// The game's own files define `name`, though a mod's definition may have won.
    pub fn defined_by_the_game(&self, name: &str) -> bool {
        self.vanilla.contains(name)
    }

    /// The parsed block `name` was read from, spans and source bytes intact.
    pub fn def(&self, name: &str) -> Option<&Def> {
        self.defs.get(name)
    }

    /// `name`'s block as the game reads it: each `inline_script` its own block calls read in
    /// place of the call. The block as written when it calls none the install has; its spans
    /// then point into the file.
    pub fn spliced(&self, name: &str) -> Option<&Def> {
        self.spliced
            .get(name)
            .map(|read| &read.def)
            .or_else(|| self.defs.get(name))
    }

    /// The inline scripts read into `name`'s block, each with the file its lines are.
    pub(crate) fn inline_scripts(&self, name: &str) -> &[InlineScript] {
        self.spliced
            .get(name)
            .map_or(&[][..], |read| read.scripts.as_slice())
    }

    /// Each file that contributed a definition, once, with the bytes already
    /// read for it, so no caller opens the directory a second time.
    pub(crate) fn sources(&self) -> Vec<(PathBuf, Arc<[u8]>)> {
        let mut bytes: HashMap<&PathBuf, &Arc<[u8]>> = HashMap::new();
        for def in self.defs.values() {
            bytes.entry(&def.file).or_insert(&def.src);
        }
        self.files
            .iter()
            .filter_map(|file| Some((file.clone(), Arc::clone(bytes.get(file)?))))
            .collect()
    }

    pub fn get(&self, name: &str) -> Option<&Initializer> {
        self.by_name.get(name)
    }

    pub fn len(&self) -> usize {
        self.by_name.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_name.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Initializer> {
        self.by_name.iter()
    }

    /// Every initializer that spawns `name`, directly or through others,
    /// nearest first; each appears once.
    pub fn ancestors(&self, name: &str) -> Vec<&Initializer> {
        let mut seen = BTreeSet::new();
        let mut queue = VecDeque::from([name]);
        let mut found = Vec::new();
        while let Some(current) = queue.pop_front() {
            for parent in self.spawned_by.get(current).into_iter().flatten() {
                if seen.insert(parent.as_str()) {
                    found.extend(self.by_name.get(parent));
                    queue.push_back(parent);
                }
            }
        }
        found
    }
}

fn countries(node: &Node, src: &[u8]) -> Vec<SpawnedCountry> {
    let mut blocks = Vec::new();
    script::find_deep(node, "create_country", src, &mut blocks);
    blocks
        .into_iter()
        .filter_map(|block| {
            let name = block.find("name", src)?;
            let name_key = name
                .scalar_str(src)
                .or_else(|| name.find("key", src)?.scalar_str(src))?;
            let country_type = block.find("type", src)?.scalar_str(src)?;
            Some(SpawnedCountry {
                name_key: name_key.to_owned(),
                country_type: country_type.to_owned(),
                icon: icon(block, src),
            })
        })
        .collect()
}

fn icon(country: &Node, src: &[u8]) -> Option<FlagIcon> {
    let icon = country.find("flag", src)?.find("icon", src)?;
    Some(FlagIcon {
        category: icon.find("category", src)?.scalar_str(src)?.to_owned(),
        file: icon.find("file", src)?.scalar_str(src)?.to_owned(),
    })
}

fn bodies(parent: &Node, keys: &[&str], def: &Def, splices: &[InlineScript]) -> Vec<InitPlanet> {
    let mut out = Vec::new();
    let mut change_orbit = 0.0;
    for child in parent.children() {
        match child.key_str(&def.src) {
            Some("change_orbit") => {
                change_orbit += child
                    .scalar_str(&def.src)
                    .and_then(|text| def.number_of(text))
                    .unwrap_or(0.0);
            }
            Some(found) if keys.contains(&found) => {
                out.push(body(child, change_orbit, def, splices));
                change_orbit = 0.0;
            }
            _ => {}
        }
    }
    out
}

fn body(node: &Node, change_orbit: f64, def: &Def, splices: &[InlineScript]) -> InitPlanet {
    let src = &def.src;
    let home_planet = scalar(node, "home_planet", src) == Some("yes")
        || scalar(node, "starting_planet", src) == Some("yes");
    let colony_owner = colony_owner(node, src);
    let (effects, unwritten) = body_effects::read(node, def);
    InitPlanet {
        name: scalar(node, "name", src).map(str::to_owned),
        class: BodyClass::of(scalar(node, "class", src).unwrap_or(RANDOM)),
        size: def
            .range_in(node, "size")
            .map(|r| (whole(r.min), whole(r.max))),
        orbit_distance: def.range_in(node, "orbit_distance"),
        orbit_angle: def.range_in(node, "orbit_angle"),
        change_orbit,
        has_ring: match scalar(node, "has_ring", src) {
            Some("yes") => Some(true),
            Some("no") => Some(false),
            _ => None,
        },
        entity: scalar(node, "entity", src).map(str::to_owned),
        count: def.range_in(node, "count").unwrap_or(Range::fixed(1.0)),
        home_planet,
        colonised: home_planet
            || colony_owner.is_some()
            || has_effect(node, src, |key| HOME_EFFECTS.contains(&key)),
        colony_owner,
        pre_ftl: has_effect(node, src, body_effects::pre_ftl),
        sites: sites(node, src),
        deposits: deposits(node, src),
        blockers: scalar(node, "deposit_blockers", src) != Some("none"),
        effects,
        unwritten,
        moons: bodies(node, &["moon", "planet"], def, splices),
        stated: stated::body(node, def, InlineScript::holding(splices, node)),
    }
}

/// A `set_owner` beside one of these gives the body to that empire as a
/// colony; on its own it only makes the system that empire's territory.
const COLONY_EFFECTS: [&str; 3] = ["generate_owner_pops", "create_pop", "add_building"];

fn colony_owner(node: &Node, src: &[u8]) -> Option<String> {
    let created = first_effect(node, "create_colony", src)
        .and_then(|block| block.find("owner", src))
        .and_then(|owner| owner_token(owner, src));
    if created.is_some() {
        return created;
    }
    let colonising = has_effect(node, src, |key| {
        COLONY_EFFECTS.contains(&key) || key.starts_with("generate_start_buildings_and_districts")
    });
    if !colonising {
        return None;
    }
    owner_token(first_effect(node, "set_owner", src)?, src)
}

fn owner_token(node: &Node, src: &[u8]) -> Option<String> {
    Some(
        node.scalar_str(src)?
            .strip_prefix("event_target:")?
            .to_owned(),
    )
}

fn deposits(node: &Node, src: &[u8]) -> Vec<String> {
    effects(node, "add_deposit", src)
        .into_iter()
        .filter_map(|n| n.scalar_str(src))
        .filter(|d| d.starts_with("d_"))
        .map(str::to_owned)
        .collect()
}

fn megastructures(node: &Node, src: &[u8]) -> Vec<String> {
    effects(node, "spawn_megastructure", src)
        .into_iter()
        .filter_map(|m| m.find("type", src)?.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

/// Each `create_archaeological_site = site` written directly in the system's own
/// `init_effect`: one under a condition or in another scope is left to the script.
fn own_sites(node: &Node, src: &[u8]) -> Vec<String> {
    node.find_all("init_effect", src)
        .flat_map(|block| block.find_all("create_archaeological_site", src))
        .filter_map(|n| n.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

fn sites(node: &Node, src: &[u8]) -> Vec<String> {
    effects(node, "create_archaeological_site", src)
        .into_iter()
        .filter_map(|n| n.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

fn starbase(node: &Node, src: &[u8]) -> Option<InitStarbase> {
    let block = first_effect(node, "create_starbase", src)?;
    Some(InitStarbase {
        size: scalar(block, "size", src)?.to_owned(),
        modules: values(block, "module", src),
        buildings: values(block, "building", src),
    })
}

fn values(node: &Node, key: &str, src: &[u8]) -> Vec<String> {
    node.find_all(key, src)
        .filter_map(|n| n.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

/// Every `key` effect below `node` at any depth, `if`, `else` and `random_list` included.
/// A `planet` or `moon` block's effects belong to that body, so it is not descended into.
fn effects<'n>(node: &'n Node, key: &str, src: &[u8]) -> Vec<&'n Node> {
    let mut out = Vec::new();
    collect_effects(node, key, src, &mut out);
    out
}

fn first_effect<'n>(node: &'n Node, key: &str, src: &[u8]) -> Option<&'n Node> {
    effects(node, key, src).into_iter().next()
}

fn collect_effects<'n>(node: &'n Node, key: &str, src: &[u8], out: &mut Vec<&'n Node>) {
    for child in node.children() {
        match child.key_str(src) {
            Some("planet" | "moon") => {}
            found => {
                if found == Some(key) {
                    out.push(child);
                }
                collect_effects(child, key, src, out);
            }
        }
    }
}

fn has_effect(node: &Node, src: &[u8], matches: impl Fn(&str) -> bool + Copy) -> bool {
    node.children()
        .iter()
        .any(|child| match child.key_str(src) {
            Some("planet" | "moon") => false,
            Some(key) if matches(key) => true,
            _ => has_effect(child, src, matches),
        })
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}

fn asteroid_belts(def: &Def) -> Vec<InitAsteroidBelt> {
    def.node
        .find_all("asteroid_belt", &def.src)
        .map(|belt| InitAsteroidBelt {
            kind: scalar(belt, "type", &def.src)
                .unwrap_or_default()
                .to_owned(),
            radius: scalar(belt, "radius", &def.src).and_then(|text| def.number_of(text)),
        })
        .collect()
}

fn spawns(node: &Node, src: &[u8]) -> Vec<String> {
    let mut blocks = Vec::new();
    script::find_deep(node, "neighbor_system", src, &mut blocks);
    script::find_deep(node, "spawn_system", src, &mut blocks);
    blocks
        .into_iter()
        .filter_map(|block| block.find("initializer", src)?.scalar_str(src))
        .map(str::to_owned)
        .collect()
}

/// The text of an `inline_script` an initializer's own block calls, its parameters put in.
/// Its lines are the lines of the file it was read from.
#[derive(Debug, Clone)]
pub(crate) struct InlineScript {
    /// Its `script`, as the call writes it.
    pub script: String,
    pub file: PathBuf,
    pub src: Arc<[u8]>,
    pub root: Node,
    /// The keys its text writes at its top level, each once.
    keys: Vec<String>,
    /// Where its text lies in the spliced definition's text.
    span: Span,
}

impl InlineScript {
    fn use_of(&self) -> InlineScriptUse {
        InlineScriptUse {
            script: self.script.clone(),
            keys: self.keys.clone(),
        }
    }

    /// The script that `node` was read from, when one was.
    fn holding(splices: &[Self], node: &Node) -> Option<String> {
        let span = node.span();
        splices
            .iter()
            .find(|s| s.span.start <= span.start && span.end <= s.span.end)
            .map(|s| s.script.clone())
    }

    /// It gives the system its star class and every one of `planets`.
    fn gives_everything(&self, planets: &[InitPlanet]) -> bool {
        self.keys.iter().any(|key| key == "class")
            && !planets.is_empty()
            && planets
                .iter()
                .all(|p| p.stated.from_script.as_deref() == Some(self.script.as_str()))
    }
}

/// The initializer `def` defines, each `inline_script` its own block calls read in place of
/// the call, as the game reads it, and the definition it was read from when that differs
/// from `def`. A script the install does not have, or whose text does not parse once its
/// parameters are put in, is left as the call.
fn read_with_scripts(name: &str, def: &Def, layout: &Layout) -> (Initializer, Option<Spliced>) {
    let as_written = || (Initializer::read_spliced(name.to_owned(), def, &[]), None);
    let src = &def.src;
    let whole = def.node.span();
    let mut text: Vec<u8> = Vec::new();
    let mut scripts = Vec::new();
    let mut from = whole.start;
    for call in def.node.find_all("inline_script", src) {
        let Some(mut script) = inline_script(call, src, layout) else {
            continue;
        };
        let call_span = call.span();
        text.extend_from_slice(&src[from..call_span.start]);
        let start = text.len();
        text.extend_from_slice(&script.src);
        script.span = Span::new(start, text.len());
        scripts.push(script);
        from = call_span.end;
    }
    if scripts.is_empty() {
        return as_written();
    }
    text.extend_from_slice(&src[from..whole.end]);
    let parsed = cst::parse_script(&text, 0)
        .ok()
        .and_then(|root| root.children().first().cloned());
    let Some(node) = parsed else {
        return as_written();
    };
    let spliced = Def {
        node,
        src: text.into(),
        file: def.file.clone(),
        vars: Arc::clone(&def.vars),
        globals: Arc::clone(&def.globals),
    };
    let init = Initializer::read_spliced(name.to_owned(), &spliced, &scripts);
    (
        init,
        Some(Spliced {
            def: spliced,
            scripts,
        }),
    )
}

/// The `inline_script` `call` reads: its script's text with its parameters put in, and the
/// keys that text writes at its top level. A parameter keeps its quotes, so a quoted value
/// goes in as one token.
fn inline_script(call: &Node, src: &[u8], layout: &Layout) -> Option<InlineScript> {
    let written = |node: &Node| {
        let span = node.scalar_span()?;
        std::str::from_utf8(span.slice(src)).ok()
    };
    let (script, params): (&str, Vec<(&str, &str)>) = match call.scalar_str(src) {
        Some(script) => (script, Vec::new()),
        None => (
            call.find("script", src)?.scalar_str(src)?,
            call.children()
                .iter()
                .filter_map(|p| Some((p.key_str(src)?, written(p)?)))
                .filter(|(key, _)| *key != "script")
                .collect(),
        ),
    };
    let file = layout.resolve_file(&format!("common/inline_scripts/{script}.txt"))?;
    let raw = std::fs::read(&file).ok()?;
    let body = substitute(&raw, &params);
    let root = cst::parse_script(&body, 0).ok()?;
    let mut keys: Vec<String> = Vec::new();
    for key in root.children().iter().filter_map(|n| n.key_str(&body)) {
        if !keys.iter().any(|k| k == key) {
            keys.push(key.to_owned());
        }
    }
    Some(InlineScript {
        script: script.to_owned(),
        file,
        src: body.into(),
        root,
        keys,
        span: Span::new(0, 0),
    })
}

/// `text` with its conditional blocks settled, then each `$NAME$` and `$NAME|default$`
/// replaced by the value `params` gives `NAME`, or its default; a parameter with neither is
/// left as written.
fn substitute(text: &[u8], params: &[(&str, &str)]) -> Vec<u8> {
    put_params(&conditionals(text, params), params)
}

fn put_params(text: &[u8], params: &[(&str, &str)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.iter().position(|&b| b == b'$') {
        out.extend_from_slice(&rest[..open]);
        let after = &rest[open + 1..];
        let Some(close) = after.iter().position(|&b| b == b'$') else {
            out.extend_from_slice(&rest[open..]);
            return out;
        };
        let inner = &after[..close];
        let (name, default) = match inner.iter().position(|&b| b == b'|') {
            Some(bar) => (&inner[..bar], Some(&inner[bar + 1..])),
            None => (inner, None),
        };
        let value = params
            .iter()
            .find(|(key, _)| key.as_bytes() == name)
            .map(|(_, value)| value.as_bytes())
            .or(default);
        match value {
            Some(value) => out.extend_from_slice(value),
            None => out.extend_from_slice(&rest[open..open + close + 2]),
        }
        rest = &after[close + 1..];
    }
    out.extend_from_slice(rest);
    out
}

/// `text` with each `[[NAME] … ]` kept when `params` gives `NAME`, and each `[[!NAME] … ]`
/// kept when it does not, nested ones settled in turn. A block that is dropped leaves its
/// line breaks, so the text keeps the lines of its file.
fn conditionals(text: &[u8], params: &[(&str, &str)]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let Some(block) = conditional(text, at) else {
            out.push(text[at]);
            at += 1;
            continue;
        };
        let given = params.iter().any(|(key, _)| key.as_bytes() == block.name);
        let body = &text[block.body.clone()];
        if given != block.negated {
            out.extend(conditionals(body, params));
        } else {
            out.extend(body.iter().filter(|&&b| b == b'\n'));
        }
        at = block.end;
    }
    out
}

/// A `[[NAME] … ]` or `[[!NAME] … ]` block of an inline script.
struct Conditional<'t> {
    name: &'t [u8],
    negated: bool,
    /// Its text, between the header and the closing bracket.
    body: std::ops::Range<usize>,
    /// Just past the closing bracket.
    end: usize,
}

/// The conditional block that starts at `at` in `text`, when one does and it closes.
fn conditional(text: &[u8], at: usize) -> Option<Conditional<'_>> {
    let rest = text.get(at..)?.strip_prefix(b"[[")?;
    let header_len = rest.iter().position(|&b| b == b']')?;
    let header = &rest[..header_len];
    let (negated, name) = match header.strip_prefix(b"!") {
        Some(name) => (true, name),
        None => (false, header),
    };
    let word = |b: &u8| b.is_ascii_alphanumeric() || *b == b'_';
    if name.is_empty() || !name.iter().all(word) {
        return None;
    }
    let start = at + 2 + header_len + 1;
    let mut depth = 1;
    for (offset, &b) in text[start..].iter().enumerate() {
        match b {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(Conditional {
                        name,
                        negated,
                        body: start..start + offset,
                        end: start + offset + 1,
                    });
                }
            }
            _ => {}
        }
    }
    None
}
