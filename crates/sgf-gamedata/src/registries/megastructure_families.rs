//! How the megastructure types link once every one is read: the build chain each stage
//! belongs to, the working type each variant belongs to, the types joined to a gateway or a
//! relay, the ring worlds and the structures of several parts, and from them where the editor
//! adds a row of each type.

use std::collections::{BTreeMap, BTreeSet};

use sgf_core::cst::Node;
use sgf_core::format::save::ring_world;
use sgf_core::ops::ClassChange;

use crate::construction::{self, Construction, PlanetChange, UnsurePlanetChange};
use crate::registries::megastructures::{
    ADDED_BYPASSES, BuildType, MegastructureDef, MegastructureRead, Placement, ReadTypes,
    Unsupported, changes_body, effect_reaches, flags_megastructure,
};
use crate::registries::planet_classes::PlanetClasses;
use crate::registries::registry::Registry;
use crate::scripts::ScriptIndex;

/// A megastructure type as its build chain reads it.
pub trait Stage {
    fn key(&self) -> &str;
    /// The types it is built over, in file order.
    fn upgrade_from(&self) -> &[String];
}

impl Stage for MegastructureDef {
    fn key(&self) -> &str {
        &self.key
    }

    fn upgrade_from(&self) -> &[String] {
        &self.upgrade_from
    }
}

impl Stage for MegastructureRead {
    fn key(&self) -> &str {
        &self.key
    }

    fn upgrade_from(&self) -> &[String] {
        &self.upgrade_from
    }
}

impl<T: Stage> Registry<T> {
    /// The build chain of `key`: the stages it is built over, following the first of each
    /// `upgrade_from`, from the first stage up to `key` itself, each once. Empty for a key the
    /// registry does not hold.
    pub fn chain(&self, key: &str) -> Vec<&T> {
        let mut stages: Vec<&T> = Vec::new();
        let mut next = self.get(key);
        while let Some(stage) = next {
            if stages.iter().any(|seen| seen.key() == stage.key()) {
                break;
            }
            stages.push(stage);
            next = stage.upgrade_from().first().and_then(|key| self.get(key));
        }
        stages.reverse();
        stages
    }

    /// The stage the build chain of `key` starts from.
    pub fn first_stage(&self, key: &str) -> Option<&T> {
        self.chain(key).into_iter().next()
    }

    /// `key` and every stage it is built over, through each `upgrade_from`, each once, `key`
    /// first.
    pub fn stages(&self, key: &str) -> Vec<&T> {
        let Some(own) = self.get(key) else {
            return Vec::new();
        };
        closure([own.key()], |key| self.earlier(key))
            .into_iter()
            .filter_map(|key| self.get(key))
            .collect()
    }

    /// The stages `key` is built over that the registry holds.
    fn earlier<'t>(&'t self, key: &str) -> impl Iterator<Item = &'t str> {
        self.get(key)
            .map_or(&[][..], Stage::upgrade_from)
            .iter()
            .filter_map(|earlier| self.get(earlier))
            .map(Stage::key)
    }
}

/// `start` and every key `linked` reaches from it, in the order they are reached, each once.
pub fn closure<'k, I>(
    start: impl IntoIterator<Item = &'k str>,
    mut linked: impl FnMut(&'k str) -> I,
) -> Vec<&'k str>
where
    I: IntoIterator<Item = &'k str>,
{
    let mut seen = BTreeSet::new();
    let mut reached: Vec<&'k str> = start.into_iter().filter(|key| seen.insert(*key)).collect();
    let mut next = 0;
    while let Some(&key) = reached.get(next) {
        next += 1;
        for other in linked(key) {
            if seen.insert(other) {
                reached.push(other);
            }
        }
    }
    reached
}

/// Each key of `pairs` with every key paired with it, either way round.
fn joined<'k>(
    pairs: impl IntoIterator<Item = (&'k str, &'k str)>,
) -> BTreeMap<&'k str, Vec<&'k str>> {
    let mut links: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for (a, b) in pairs {
        links.entry(a).or_default().push(b);
        links.entry(b).or_default().push(a);
    }
    links
}

/// The keys `links` joins to `key`.
fn linked<'k>(links: &BTreeMap<&'k str, Vec<&'k str>>, key: &str) -> Vec<&'k str> {
    links.get(key).cloned().unwrap_or_default()
}

/// The working type a variant takes its placement from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Family {
    pub working: String,
    pub linked: Linked,
}

/// How a variant was linked to its working type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Linked {
    /// The files name the two together: an `upgrade_from`, or a scripted effect branch that
    /// asks for the one and spawns the other in its place.
    Files,
    /// Their keys share a stem, the variant's suffix taken off.
    Stem,
}

/// The suffixes a variant's key adds to its family's stem.
const VARIANT_SUFFIXES: [&str; 5] = [
    "_permanently_ruined",
    "_ruined",
    "_restored",
    "_destroyed",
    "_derelict",
];

/// A ruined, destroyed or derelict variant: one a restore is built over.
pub(crate) fn is_ruin(key: &str) -> bool {
    VARIANT_SUFFIXES
        .iter()
        .any(|suffix| *suffix != "_restored" && key.contains(suffix))
}

/// The stem of a variant's key: what stands before its variant suffix. `None` for a
/// working type.
pub(crate) fn variant_stem(key: &str) -> Option<&str> {
    VARIANT_SUFFIXES
        .iter()
        .filter_map(|suffix| key.find(suffix))
        .min()
        .map(|at| &key[..at])
}

/// The types [`placed`] resolved, ready for the add dialog's offers.
pub(crate) struct Placed {
    pub types: ReadTypes,
    pub resolved: BTreeMap<String, Resolved>,
}

impl Placed {
    /// The working type the variant `key` belongs to.
    pub(crate) fn variant_of(&self, key: &str) -> Option<&str> {
        let family = self.resolved.get(key)?.family.as_ref()?;
        Some(&family.working)
    }
}

/// What [`placed`] resolves of one type across every type.
#[derive(Debug)]
pub(crate) struct Resolved {
    pub placement: Placement,
    pub planet_change: Option<PlanetChange>,
    pub sets_has_megastructure: bool,
    pub may_stand_on_star: bool,
    /// For a variant, the working type it belongs to.
    pub family: Option<Family>,
    /// The variant takes its working type's placement.
    pub takes_placement: bool,
    pub planet_only: bool,
    pub ring_world: bool,
    pub construction: Construction,
}

/// `types` with each type's [`Placement`] resolved; the first rule that matches wins. A type
/// whose chain changes its planet is placed as any other when the change can be told, with
/// the change as its [`MegastructureDef::planet_change`]. A
/// variant placed around a body takes the placement of the first stage of the working type
/// it belongs to, as [`families`] links them, when that stage too stands around a body.
/// Every stage and variant of a gateway or a relay stands where its bypass does. A stage
/// whose completion always swaps it for another type takes that type's placement.
pub(crate) fn placed(types: ReadTypes, scripts: &ScriptIndex, classes: &PlanetClasses) -> Placed {
    let families = families(&types, scripts);
    let bypassed = bypass_groups(&types, &families);
    let whole = whole_structures(&types);
    let on_stars = star_stages(&types);
    let rings = ring_worlds(&types, &families);
    let built_over: BTreeSet<&str> = types
        .iter()
        .flat_map(|def| def.upgrade_from.iter().map(String::as_str))
        .collect();
    let mut resolved: BTreeMap<String, Resolved> = types
        .iter()
        .map(|def| {
            let construction = construction_of(&types, &def.key, scripts);
            let sets_has_megastructure = types.stages(&def.key).into_iter().any(|stage| {
                stage.sets_has_megastructure
                    || stage
                        .completes
                        .body_effects
                        .iter()
                        .any(|effect| effect_reaches(effect, scripts, flags_megastructure))
            });
            // Only a finished Arc Furnace was seen on a star in game.
            let may_stand_on_star = !built_over.contains(def.key.as_str())
                && types
                    .stages(&def.key)
                    .into_iter()
                    .any(|stage| stage.completes.hides_body_as_furnace);
            let mut planet_change = None;
            let own = match placement(&types, def, &on_stars, &rings) {
                Placement::Body { .. } if bypassed.contains(def.key.as_str()) => Placement::Free {
                    outside_gravity_well: true,
                },
                Placement::Body { star_only }
                    if whole.contains(def.key.as_str()) && !rings.sites.contains(&def.key) =>
                {
                    Placement::Unsupported {
                        why: Unsupported::WholeStructure { star_only },
                    }
                }
                Placement::Body { star_only: false } => {
                    match told_change(&types, def, &construction, scripts, classes) {
                        Ok(told) => {
                            planet_change = told;
                            Placement::Body { star_only: false }
                        }
                        Err(why) => Placement::Unsupported { why },
                    }
                }
                own => own,
            };
            let family = families.get(&def.key).cloned();
            let taken = match own {
                Placement::Body { .. } => family
                    .as_ref()
                    .and_then(|family| types.first_stage(&family.working))
                    .map(|first| placement(&types, first, &on_stars, &rings))
                    .filter(|placement| matches!(placement, Placement::Body { .. })),
                _ => None,
            };
            let resolved = Resolved {
                takes_placement: taken.is_some(),
                placement: taken.unwrap_or(own),
                planet_change,
                sets_has_megastructure,
                may_stand_on_star,
                family,
                planet_only: false,
                ring_world: rings.members.contains(&def.key),
                construction,
            };
            (def.key.clone(), resolved)
        })
        .collect();
    let off_stars: Vec<String> = types
        .iter()
        .filter(|def| {
            let working = resolved[&def.key]
                .family
                .as_ref()
                .filter(|_| resolved[&def.key].takes_placement)
                .map_or(def.key.as_str(), |family| family.working.as_str());
            types
                .first_stage(working)
                .is_some_and(|first| off_stars(first, classes))
        })
        .map(|def| def.key.clone())
        .collect();
    for key in off_stars {
        if let Some(own) = resolved.get_mut(&key) {
            own.planet_only = true;
        }
    }
    let swapped: Vec<(String, Placement, Option<PlanetChange>)> = types
        .iter()
        .filter_map(|def| {
            let swap = def.swaps.iter().find(|swap| swap.always())?;
            let into = resolved.get(&swap.into)?;
            Some((
                def.key.clone(),
                into.placement.clone(),
                into.planet_change.clone(),
            ))
        })
        .collect();
    for (key, placement, change) in swapped {
        if let Some(own) = resolved.get_mut(&key) {
            own.placement = placement;
            own.planet_change = change;
        }
    }
    Placed { types, resolved }
}

/// What the build chain of `key` adds to its system and owner, as `scripts` resolve the
/// effects and events it calls.
fn construction_of(types: &ReadTypes, key: &str, scripts: &ScriptIndex) -> Construction {
    let stages: Vec<_> = types
        .chain(key)
        .into_iter()
        .map(|stage| &stage.def)
        .collect();
    construction::read(&stages, scripts)
}

/// The class or size `def`'s build chain gives the planet it stands at, as its
/// `construction` keeps it. When a stage of the chain changes the planet, as
/// [`changes_body`] reads it, a change the walk cannot tell, or none where it should find
/// one, refuses the type, and so does a class no planet is given. A stage of another chain
/// the type can be built over does not count: the editor builds the first.
fn told_change(
    types: &ReadTypes,
    def: &MegastructureRead,
    construction: &Construction,
    scripts: &ScriptIndex,
    classes: &PlanetClasses,
) -> Result<Option<PlanetChange>, Unsupported> {
    let flagged = types
        .chain(&def.key)
        .into_iter()
        .any(|stage| changes_body(&stage.completes, scripts));
    let change = match construction.planet_change() {
        Ok(Some(change)) => change,
        Ok(None) | Err(UnsurePlanetChange) if !flagged => return Ok(None),
        Ok(None) | Err(UnsurePlanetChange) => return Err(Unsupported::ChangesBody),
    };
    let fixed = change.class.as_ref().filter(|class| {
        classes
            .get(class)
            .is_none_or(|def| def.change() == ClassChange::Never)
    });
    match fixed {
        Some(_) if !flagged => Ok(None),
        Some(class) => Err(Unsupported::FixedClass {
            class: class.clone(),
        }),
        None => Ok(Some(change)),
    }
}

/// The first stages built only around a star: those whose `placement_rules` ask for one, and
/// the types a star's first stage turns into on completion, such as one per star class.
fn star_stages(types: &ReadTypes) -> BTreeSet<String> {
    let mut stars: BTreeSet<String> = types
        .iter()
        .filter(|def| def.planet_possible_star)
        .map(|def| def.key.clone())
        .collect();
    let turned: Vec<String> = types
        .iter()
        .filter(|def| {
            types
                .first_stage(&def.key)
                .is_some_and(|first| stars.contains(&first.key))
        })
        .flat_map(|def| def.turns_into.iter().cloned())
        .collect();
    stars.extend(turned);
    stars
}

/// The types that belong to a structure of several rows or planets: each type whose build
/// [`builds_whole`](crate::registries::megastructures::Completes::builds_whole), and every
/// type joined to them by `upgrade_from` or by a spawn that does not replace the row.
fn whole_structures(types: &ReadTypes) -> BTreeSet<&str> {
    let links = joined(types.iter().flat_map(|def| {
        let spawned = def
            .completes
            .spawned
            .iter()
            .filter(|key| !def.completes.replaced_by.contains(key));
        def.upgrade_from
            .iter()
            .chain(spawned)
            .filter_map(|key| types.get(key))
            .map(|other| (def.key.as_str(), other.key.as_str()))
    }));
    let seeds = types
        .iter()
        .filter(|def| def.completes.builds_whole())
        .map(|def| def.key.as_str());
    closure(seeds, |key| linked(&links, key))
        .into_iter()
        .collect()
}

/// Every type joined by `upgrade_from` or by [`families`] to a type that stands for a bypass
/// the editor adds: a gateway, a relay or an L-Gate.
fn bypass_groups<'t>(
    types: &'t ReadTypes,
    families: &BTreeMap<String, Family>,
) -> BTreeSet<&'t str> {
    let built_over = types.iter().flat_map(|def| {
        def.upgrade_from
            .iter()
            .map(move |earlier| (def.key.as_str(), earlier.as_str()))
    });
    let variants = families
        .iter()
        .map(|(variant, family)| (variant.as_str(), family.working.as_str()));
    let links = joined(
        built_over
            .chain(variants)
            .filter_map(|(a, b)| Some((types.get(a)?.key.as_str(), types.get(b)?.key.as_str()))),
    );
    let seeds = types
        .iter()
        .filter(|def| {
            def.bypass_type
                .as_deref()
                .is_some_and(|kind| ADDED_BYPASSES.contains(&kind))
        })
        .map(|def| def.key.as_str());
    closure(seeds, |key| linked(&links, key))
        .into_iter()
        .collect()
}

/// Each variant's working type: one the files link it to, through any chain of
/// `upgrade_from` and scripted effect branches, else the first working type, in key order,
/// whose key is its stem or starts with it, read with its underscores and else without them.
fn families(types: &ReadTypes, scripts: &ScriptIndex) -> BTreeMap<String, Family> {
    let mut groups: Vec<Vec<String>> = Vec::new();
    for def in types.iter() {
        if variant_stem(&def.key).is_some() {
            for earlier in &def.upgrade_from {
                groups.push(vec![def.key.clone(), earlier.clone()]);
            }
        }
    }
    for effect in scripts.effects() {
        spawn_groups(&effect.node, &effect.src, &mut groups);
    }
    let links = joined(groups.iter().flat_map(|group| {
        let known: Vec<&str> = group
            .iter()
            .filter_map(|key| types.get(key).map(|def| def.key.as_str()))
            .collect();
        known
            .windows(2)
            .map(|pair| (pair[0], pair[1]))
            .collect::<Vec<_>>()
    }));

    let mut out = BTreeMap::new();
    for def in types.iter() {
        let Some(stem) = variant_stem(&def.key) else {
            continue;
        };
        let mut working: Vec<&str> = closure([def.key.as_str()], |key| linked(&links, key))
            .into_iter()
            .filter(|key| variant_stem(key).is_none())
            .collect();
        working.sort_unstable();
        let family = match working.first() {
            Some(&key) => Some(Family {
                working: key.to_owned(),
                linked: Linked::Files,
            }),
            None => [stem_rest, words_rest]
                .into_iter()
                .find_map(|rest| {
                    types
                        .iter()
                        .filter(|other| variant_stem(&other.key).is_none())
                        .find(|other| {
                            rest(&other.key, stem)
                                .is_some_and(|r| r.is_empty() || r.starts_with('_'))
                        })
                })
                .map(|other| Family {
                    working: other.key.clone(),
                    linked: Linked::Stem,
                }),
        };
        if let Some(family) = family {
            out.insert(def.key.clone(), family);
        }
    }
    out
}

/// What follows `stem` in `key`.
fn stem_rest<'k>(key: &'k str, stem: &str) -> Option<&'k str> {
    key.strip_prefix(stem)
}

/// What follows `stem` in `key` when the two are read without their underscores, as
/// Gigastructural Engineering's `ring_world_titanic_ruined` belongs to `ringworld_titanic_0`.
fn words_rest<'k>(key: &'k str, stem: &str) -> Option<&'k str> {
    let mut letters = stem.bytes().filter(|&b| b != b'_').peekable();
    for (at, byte) in key.bytes().enumerate() {
        if letters.peek().is_none() {
            return Some(&key[at..]);
        }
        if byte == b'_' {
            continue;
        }
        if letters.next() != Some(byte) {
            return None;
        }
    }
    letters.peek().is_none().then_some("")
}

/// Each block of `node` that asks with its `limit` for megastructure types and spawns one
/// in their place, as the types it names: those of `is_megastructure_type` in the limit,
/// outside a `NOT`, and those of `spawn_megastructure`'s `type` in the block.
fn spawn_groups(node: &Node, src: &[u8], out: &mut Vec<Vec<String>>) {
    for child in node.children() {
        if child.scalar_span().is_some() {
            continue;
        }
        if let Some(limit) = child.find("limit", src) {
            let mut group = Vec::new();
            asked_types(limit, src, &mut group);
            if !group.is_empty() {
                let before = group.len();
                spawned_types(child, src, &mut group);
                if group.len() > before {
                    out.push(group);
                }
            }
        }
        spawn_groups(child, src, out);
    }
}

fn asked_types(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        match child.key_str(src) {
            Some("is_megastructure_type") => {
                if let Some(kind) = child.scalar_str(src) {
                    out.push(kind.to_owned());
                }
            }
            Some(key) if key.eq_ignore_ascii_case("not") || key.eq_ignore_ascii_case("nor") => {}
            _ => asked_types(child, src, out),
        }
    }
}

/// The types the `spawn_megastructure` blocks in `node` spawn, leaving out a block with a
/// `limit` of its own.
fn spawned_types(node: &Node, src: &[u8], out: &mut Vec<String>) {
    for child in node.children() {
        if child.scalar_span().is_some() {
            continue;
        }
        if child.key_str(src) == Some("spawn_megastructure") {
            if let Some(kind) = child.find("type", src).and_then(|t| t.scalar_str(src)) {
                out.push(kind.to_owned());
            }
            continue;
        }
        if child.key_str(src) != Some("limit") && child.find("limit", src).is_none() {
            spawned_types(child, src, out);
        }
    }
}

fn placement(
    types: &ReadTypes,
    def: &MegastructureRead,
    on_stars: &BTreeSet<String>,
    rings: &RingWorlds,
) -> Placement {
    if let Some(bypass) = def
        .bypass_type
        .as_ref()
        .filter(|kind| !ADDED_BYPASSES.contains(&kind.as_str()))
    {
        let why = Unsupported::Bypass {
            bypass: bypass.clone(),
        };
        return Placement::Unsupported { why };
    }
    if rings.members.contains(&def.key) && !rings.sites.contains(&def.key) {
        return Placement::Unsupported {
            why: Unsupported::RingWorld,
        };
    }
    if def.spawns_starbase {
        return Placement::Unsupported {
            why: Unsupported::BecomesStarbase,
        };
    }
    // Some gateway stages leave `build_type` commented out; every gateway and relay stands
    // outside the gravity well.
    if def.bypass_type.is_some() {
        return Placement::Free {
            outside_gravity_well: true,
        };
    }
    match def.build_type {
        BuildType::OutsideGravityWell => Placement::Free {
            outside_gravity_well: true,
        },
        BuildType::InsideGravityWell => Placement::Free {
            outside_gravity_well: false,
        },
        BuildType::AroundPlanet => Placement::Body {
            star_only: types
                .first_stage(&def.key)
                .is_some_and(|first| on_stars.contains(&first.key)),
        },
    }
}

/// The types of the ring worlds, and of those the sites, the one stage of a ring the editor
/// adds as a row.
#[derive(Debug, Default)]
struct RingWorlds {
    members: BTreeSet<String>,
    sites: BTreeSet<String>,
}

/// Every type of a ring world: a chain one of whose stages spawns rows round the system
/// whatever happens, which a stage built over them turns into ring world segments, the planet
/// classes a save's ring is made of. From that stage, every stage it is built over or that
/// is built over it, every type it spawns and every variant of one of them belongs to the
/// ring. Its site is a working type of it that no stage is built over and none spawns.
fn ring_worlds(types: &ReadTypes, families: &BTreeMap<String, Family>) -> RingWorlds {
    let builds_segments = |spawned: &String| {
        types.iter().any(|stage| {
            stage.upgrade_from.contains(spawned)
                && stage
                    .completes
                    .planet_classes
                    .iter()
                    .any(|class| ring_world::is_segment(class))
        })
    };
    let seeds = types
        .iter()
        .filter(|def| {
            def.completes.spawns_rows > 1 && def.completes.spawned.iter().any(builds_segments)
        })
        .map(|def| def.key.as_str());
    let members = closure(seeds, |key| {
        let Some(def) = types.get(key) else {
            return Vec::new();
        };
        types
            .iter()
            .filter(|other| {
                def.upgrade_from.contains(&other.key)
                    || other.upgrade_from.contains(&def.key)
                    || def.completes.spawned.contains(&other.key)
                    || families
                        .get(&other.key)
                        .is_some_and(|f| f.working == def.key)
                    || families
                        .get(&def.key)
                        .is_some_and(|f| f.working == other.key)
            })
            .map(|other| other.key.as_str())
            .collect()
    });
    let sites = members
        .iter()
        .filter_map(|key| types.get(key))
        .filter(|def| {
            def.upgrade_from.is_empty()
                && variant_stem(&def.key).is_none()
                && !types
                    .iter()
                    .any(|other| other.completes.spawned.contains(&def.key))
        })
        .map(|def| def.key.clone())
        .collect();
    RingWorlds {
        members: members.into_iter().map(str::to_owned).collect(),
        sites,
    }
}

/// Whether the game never builds `def` on a star: its `planet_possible` asks for `is_star =
/// no`, or only for planet classes the install defines as no star.
fn off_stars(def: &MegastructureRead, classes: &PlanetClasses) -> bool {
    let named = &def.planet_possible_classes;
    def.planet_possible_no_star
        || (!named.is_empty()
            && named
                .iter()
                .all(|class| classes.get(class).is_some_and(|c| !c.star)))
}
