//! `common/solar_system_initializers`: what a system was generated from.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use sgf_core::cst::Node;
use ts_rs::TS;

use crate::body_effects::{self, BodyEffect};
use crate::install::layers::Layout;
use crate::install::script::{self, Def, Range, Variables};
use crate::registries::registry::{FromDef, Registry};
use crate::scripts::init_bypasses::bypasses;
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
    pub class: String,
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
    /// What this block's `init_effect` runs that a generated body is given, in order.
    pub effects: Vec<BodyEffect>,
    /// The first statement of this block's `init_effect` that is neither given to a
    /// generated body nor dropped with the script.
    pub unwritten: Option<String>,
    /// Its `moon` blocks, and the `planet` blocks written inside it, which the game spawns
    /// around it the same way, in file order.
    pub moons: Vec<InitPlanet>,
}

impl InitPlanet {
    /// The representative number of instances: the midpoint of `count`, rounded.
    pub fn instances(&self) -> u32 {
        whole(self.count.midpoint())
    }

    /// The representative orbit distance: the midpoint of `orbit_distance`.
    pub fn orbit(&self) -> Option<f64> {
        self.orbit_distance.map(Range::midpoint)
    }

    /// This block's own instances and every moon they carry.
    pub fn total(&self) -> u32 {
        let moons: u32 = self.moons.iter().map(Self::total).sum();
        self.instances().saturating_mul(1 + moons)
    }
}

/// One body of a system's planet list: the block it was written as, and
/// whether it orbits another body.
#[derive(Debug, Clone, Copy)]
pub struct Body<'p> {
    pub block: &'p InitPlanet,
    pub moon: bool,
}

/// Every body `planets` expand to, in the order a system's planet list
/// gives them: each instance of a block, then that instance's moons. A
/// body's position in this sequence is its planet index.
pub fn expand(planets: &[InitPlanet]) -> impl Iterator<Item = Body<'_>> {
    let mut out = Vec::new();
    push_bodies(planets, false, &mut out);
    out.into_iter()
}

fn push_bodies<'p>(blocks: &'p [InitPlanet], moon: bool, out: &mut Vec<Body<'p>>) {
    for block in blocks {
        for _ in 0..block.instances() {
            out.push(Body { block, moon });
            push_bodies(&block.moons, true, out);
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
    /// Every `create_archaeological_site` in the system's own effects, no planet's.
    pub sites: Vec<String>,
    pub starbase: Option<InitStarbase>,
}

impl Initializer {
    /// What the initializer needs beyond the base game: the mod's directory name (a
    /// workshop mod's numeric folder id; its descriptor name is not looked up yet), or
    /// `None` when it is vanilla or from nowhere known.
    pub fn source_label(&self, install: &Path) -> Option<String> {
        source_label(&self.source, install)
    }
}

impl GameData {
    /// Which DLC or mod `initializer` needs, when this install knows it.
    pub fn initializer_source(&self, initializer: &str) -> Option<String> {
        self.initializers
            .get(initializer)?
            .source_label(&self.layout.install)
    }
}

/// `<install>/dlc/<dlc>/…` is that DLC; anything else under `install` is vanilla; a
/// path elsewhere is a mod, named by the directory its `common` sits in.
fn source_label(source: &Path, install: &Path) -> Option<String> {
    let dlc = source
        .strip_prefix(install.join("dlc"))
        .ok()
        .and_then(|rel| rel.components().next())
        .and_then(|c| match c {
            Component::Normal(dlc) => dlc.to_str(),
            _ => None,
        });
    if let Some(dlc) = dlc {
        return Some(dlc.to_owned());
    }
    if source.starts_with(install) {
        return None;
    }
    let parts: Vec<&str> = source
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect();
    parts
        .iter()
        .rposition(|part| *part == "common")
        .and_then(|i| i.checked_sub(1))
        .map(|i| parts[i].to_owned())
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
        let src = &def.src;
        let node = &def.node;
        Self {
            name,
            source: def.file.clone(),
            display_name: def.scalar("name").map(str::to_owned),
            class: def.scalar("class").map(str::to_owned),
            usage: def.scalar("usage").map(str::to_owned),
            usage_odds: def.number("usage_odds"),
            max_instances: def.scalar("max_instances").and_then(|s| s.parse().ok()),
            flags: script::list_items(node, "flags", src),
            init_effect: node.find("init_effect", src).is_some(),
            countries: countries(node, src),
            spawns: spawns(node, src),
            asteroid_belts: asteroid_belts(def),
            planets: bodies(node, &["planet"], def),
            megastructures: megastructures(node, src),
            bypasses: bypasses(node, src),
            sites: sites(node, src),
            starbase: starbase(node, src),
        }
    }
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
}

impl Initializers {
    pub(crate) fn load(
        layout: &Layout,
        globals: &Arc<Variables>,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Self {
        let files = layout.files_in(Initializer::DIR);
        let defs = script::parse_dir(layout, Initializer::DIR, globals, diagnostics);
        let by_name: Registry<Initializer> = defs
            .iter()
            .map(|(key, def)| (key.clone(), Initializer::read(key.clone(), def)))
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
        }
    }

    /// The parsed block `name` was read from, spans and source bytes intact.
    pub fn def(&self, name: &str) -> Option<&Def> {
        self.defs.get(name)
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

    /// Every flag any initializer sets on its system.
    pub fn declared_flags(&self) -> BTreeSet<String> {
        self.by_name
            .iter()
            .flat_map(|i| i.flags.iter().cloned())
            .collect()
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

fn bodies(parent: &Node, keys: &[&str], def: &Def) -> Vec<InitPlanet> {
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
                out.push(body(child, change_orbit, def));
                change_orbit = 0.0;
            }
            _ => {}
        }
    }
    out
}

fn body(node: &Node, change_orbit: f64, def: &Def) -> InitPlanet {
    let src = &def.src;
    let home_planet = scalar(node, "home_planet", src) == Some("yes")
        || scalar(node, "starting_planet", src) == Some("yes");
    let colony_owner = colony_owner(node, src);
    let (effects, unwritten) = body_effects::read(node, def);
    InitPlanet {
        name: scalar(node, "name", src).map(str::to_owned),
        class: scalar(node, "class", src).unwrap_or("random").to_owned(),
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
            || has_effect(node, src, |key| {
                matches!(
                    key,
                    "generate_home_system_resources" | "generate_empire_home_planet"
                )
            }),
        colony_owner,
        pre_ftl: has_effect(node, src, |key| {
            key.starts_with("generate_") && key.contains("pre_ftl") && key.ends_with("_on_planet")
        }),
        sites: sites(node, src),
        deposits: deposits(node, src),
        effects,
        unwritten,
        moons: bodies(node, &["moon", "planet"], def),
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

fn whole(n: f64) -> u32 {
    let rounded = n.round();
    if rounded < 0.0 { 0 } else { rounded as u32 }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_source_is_labelled_by_its_dlc_or_mod_and_vanilla_by_nothing() {
        let install = Path::new("/games/Stellaris");
        let label = |source: &str| source_label(Path::new(source), install);
        assert_eq!(
            label("/games/Stellaris/common/solar_system_initializers/00_basic.txt"),
            None
        );
        assert_eq!(
            label(
                "/games/Stellaris/dlc/dlc021_distant_stars/common/solar_system_initializers/ds.txt"
            ),
            Some("dlc021_distant_stars".to_owned())
        );
        assert_eq!(
            label("/mods/ugc_123/common/solar_system_initializers/mod.txt"),
            Some("ugc_123".to_owned())
        );
        assert_eq!(
            label("/mods/dlc/mymod/common/solar_system_initializers/x.txt"),
            Some("mymod".to_owned())
        );
        assert_eq!(label("/elsewhere/loose.txt"), None);
    }
}
