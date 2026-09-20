//! Which systems are special (leviathan lairs, enclaves, landmarks …) and
//! why. The save's flags are ground truth; game data adds what the
//! initializer and the countries it spawns say, and supplies display names.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sgf_core::export::policy::is_generic_initializer;
use sgf_core::format::save::details::DetailsProjection;
use sgf_core::projections::galaxy::{CountryNode, GalaxyGraph, SystemNode, display_name};
use sgf_core::session::Session;
use ts_rs::TS;

use crate::GameData;
use crate::initializers::{FlagIcon, Initializer, SpawnedCountry};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum SpecialKind {
    Leviathan,
    Enclave,
    Marauder,
    FallenEmpire,
    Landmark,
    Unique,
}

/// Precedence: a system's primary kind is the first of these it matches.
pub const KIND_ORDER: [SpecialKind; 6] = [
    SpecialKind::Leviathan,
    SpecialKind::Enclave,
    SpecialKind::Marauder,
    SpecialKind::FallenEmpire,
    SpecialKind::Landmark,
    SpecialKind::Unique,
];

impl SpecialKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Leviathan => "leviathan",
            Self::Enclave => "enclave",
            Self::Marauder => "marauder",
            Self::FallenEmpire => "fallen_empire",
            Self::Landmark => "landmark",
            Self::Unique => "unique",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CountryRef {
    /// The save's country, when one stands in the system or carries the same name key.
    pub id: Option<u32>,
    pub name_key: String,
    /// Localised, when game data is present and knows the key.
    pub name: Option<String>,
    pub country_type: String,
    pub icon: Option<FlagIcon>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialSystem {
    pub id: u32,
    pub primary: SpecialKind,
    /// Every kind matched, in [`KIND_ORDER`].
    pub kinds: Vec<SpecialKind>,
    pub initializer: String,
    /// The initializer exists in the loaded game data.
    pub initializer_known: bool,
    /// The file (name only, no directory) the initializer was defined in.
    pub source_file: Option<String>,
    pub flags: Vec<String>,
    /// Countries the initializer (or one that spawned it) creates; when it creates none,
    /// the countries the save itself puts in the system.
    pub countries: Vec<CountryRef>,
    pub label: String,
}

/// A country the save puts in a system: the owner of a fleet or starbase standing there.
/// Mercenary, shroudwalker and salvager enclaves and some leviathans are spawned by an
/// event, so the save is the only place their country appears.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PresentCountry {
    pub id: u32,
    pub name_key: String,
    pub country_type: String,
    pub icon: Option<FlagIcon>,
}

/// System id → the countries present in it, in the save's order.
pub type PresentCountries = HashMap<u32, Vec<PresentCountry>>;

/// The countries each system's fleets and starbases belong to, its own owner aside.
/// Cheap: it reads the already-built details projection.
pub fn present_countries(graph: &GalaxyGraph, details: &DetailsProjection) -> PresentCountries {
    let by_id: HashMap<u32, &CountryNode> = graph.countries.iter().map(|c| (c.id, c)).collect();
    graph
        .systems
        .values()
        .filter_map(|node| {
            let raw = details.raw(node.id)?;
            let owners = raw
                .starbases
                .iter()
                .filter_map(|s| s.owner)
                .chain(raw.fleets.iter().filter_map(|f| f.owner));
            let mut present: Vec<PresentCountry> = Vec::new();
            let mut seen: Vec<u32> = Vec::new();
            for owner in owners {
                if Some(owner) == node.owner || seen.contains(&owner) {
                    continue;
                }
                seen.push(owner);
                present.extend(by_id.get(&owner).map(|c| PresentCountry {
                    id: c.id,
                    name_key: c.name_key.clone(),
                    country_type: c.country_type.clone(),
                    icon: c.flag_icon.as_ref().map(|f| FlagIcon {
                        category: f.category.clone(),
                        file: f.file.clone(),
                    }),
                }));
            }
            (!present.is_empty()).then_some((node.id, present))
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct KindCount {
    pub kind: SpecialKind,
    /// Systems whose `kinds` include this one.
    pub count: u32,
    /// Systems whose primary kind this is.
    pub primary_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialSystems {
    /// In the save's system order.
    pub systems: Vec<SpecialSystem>,
    /// One entry per kind in [`KIND_ORDER`], zeros included.
    pub counts: Vec<KindCount>,
    pub with_game_data: bool,
}

/// Classify an open session's systems, building its details projection so that a system
/// whose initializer creates no country is still named after the country standing in it.
pub fn classify_session(session: &Session, gd: Option<&GameData>) -> SpecialSystems {
    let present = session
        .details()
        .map(|details| present_countries(&session.graph, &details))
        .unwrap_or_default();
    classify_with_countries(&session.graph, gd, &present)
}

/// Classify every system of `graph`; `gd` enriches the flag-only rules and
/// supplies names.
pub fn classify(graph: &GalaxyGraph, gd: Option<&GameData>) -> SpecialSystems {
    classify_with_countries(graph, gd, &PresentCountries::default())
}

/// [`classify`], naming a system after the country standing in it when no initializer
/// creates one; see [`present_countries`].
pub fn classify_with_countries(
    graph: &GalaxyGraph,
    gd: Option<&GameData>,
    present: &PresentCountries,
) -> SpecialSystems {
    let mut by_name_key: HashMap<&str, u32> = HashMap::new();
    for country in &graph.countries {
        by_name_key
            .entry(country.name_key.as_str())
            .or_insert(country.id);
    }
    let systems: Vec<SpecialSystem> = graph
        .order
        .iter()
        .filter_map(|id| graph.systems.get(id))
        .filter_map(|node| {
            let here = present.get(&node.id).map_or(&[][..], Vec::as_slice);
            classify_one(node, gd, here, &by_name_key)
        })
        .collect();
    let counts = KIND_ORDER
        .iter()
        .map(|&kind| KindCount {
            kind,
            count: tally(&systems, |s| s.kinds.contains(&kind)),
            primary_count: tally(&systems, |s| s.primary == kind),
        })
        .collect();
    SpecialSystems {
        systems,
        counts,
        with_game_data: gd.is_some(),
    }
}

fn tally(systems: &[SpecialSystem], pred: impl Fn(&SpecialSystem) -> bool) -> u32 {
    u32::try_from(systems.iter().filter(|s| pred(s)).count()).unwrap_or(u32::MAX)
}

/// What game data adds to one system's classification.
#[derive(Default)]
struct Enrichment<'a> {
    known: bool,
    source_file: Option<String>,
    leviathan: bool,
    enclave: bool,
    fallen_empire: bool,
    countries: Vec<&'a SpawnedCountry>,
}

fn enrich<'a>(node: &SystemNode, gd: Option<&'a GameData>) -> Enrichment<'a> {
    let Some(gd) = gd else {
        return Enrichment::default();
    };
    let own = gd.initializers.get(&node.initializer);
    let chain: Vec<&Initializer> = own
        .into_iter()
        .chain(gd.initializers.ancestors(&node.initializer))
        .collect();
    let countries: Vec<&SpawnedCountry> = chain.iter().flat_map(|i| &i.countries).collect();
    let country_type = |c: &&SpawnedCountry| gd.country_types.get(&c.country_type);
    Enrichment {
        known: own.is_some(),
        source_file: own
            .and_then(|i| i.source.file_name())
            .map(|f| f.to_string_lossy().into_owned()),
        leviathan: countries
            .iter()
            .filter_map(country_type)
            .any(|t| t.is_leviathan()),
        enclave: countries
            .iter()
            .filter_map(country_type)
            .any(|t| t.is_enclave),
        fallen_empire: chain
            .iter()
            .any(|i| i.usage.as_deref() == Some("fallen_empire_init"))
            || countries
                .iter()
                .filter_map(country_type)
                .any(|t| t.fallen_empire),
        countries,
    }
}

fn classify_one(
    node: &SystemNode,
    gd: Option<&GameData>,
    present: &[PresentCountry],
    by_name_key: &HashMap<&str, u32>,
) -> Option<SpecialSystem> {
    let extra = enrich(node, gd);
    let kinds = kinds_of(node, &extra);
    let primary = *kinds.first()?;
    let countries: Vec<CountryRef> = if extra.countries.is_empty() {
        present_refs(gd, present, primary)
    } else {
        extra
            .countries
            .iter()
            .map(|c| CountryRef {
                id: by_name_key.get(c.name_key.as_str()).copied(),
                name_key: c.name_key.clone(),
                name: gd.and_then(|gd| gd.loc.get(&c.name_key)),
                country_type: c.country_type.clone(),
                icon: c.icon.clone(),
            })
            .collect()
    };
    let label = countries
        .iter()
        .find_map(|c| c.name.clone())
        .or_else(|| gd.map(|gd| gd.loc.resolve_template(&node.name)))
        .unwrap_or_else(|| node.display_name());
    Some(SpecialSystem {
        id: node.id,
        primary,
        kinds,
        initializer: node.initializer.clone(),
        initializer_known: extra.known,
        source_file: extra.source_file.clone(),
        flags: node.flags.clone(),
        countries,
        label,
    })
}

/// The countries standing in the system, the one whose type fits `primary` first. Their
/// name key is the save's own text, which stands in where localisation has no entry.
fn present_refs(
    gd: Option<&GameData>,
    present: &[PresentCountry],
    primary: SpecialKind,
) -> Vec<CountryRef> {
    let mut ordered: Vec<&PresentCountry> = present.iter().collect();
    ordered.sort_by_key(|c| !fits_kind(gd, c, primary));
    ordered
        .into_iter()
        .map(|c| CountryRef {
            id: Some(c.id),
            name_key: c.name_key.clone(),
            name: Some(
                gd.and_then(|gd| gd.loc.get(&c.name_key))
                    .unwrap_or_else(|| display_name(&c.name_key)),
            ),
            country_type: c.country_type.clone(),
            icon: c.icon.clone(),
        })
        .collect()
}

fn fits_kind(gd: Option<&GameData>, country: &PresentCountry, kind: SpecialKind) -> bool {
    let Some(country_type) = gd.and_then(|gd| gd.country_types.get(&country.country_type)) else {
        return false;
    };
    match kind {
        SpecialKind::Leviathan => country_type.is_leviathan(),
        SpecialKind::Enclave => country_type.is_enclave,
        SpecialKind::FallenEmpire => country_type.fallen_empire,
        _ => false,
    }
}

/// Every kind the system matches, in [`KIND_ORDER`]; `Unique` only when
/// nothing above it matched.
fn kinds_of(node: &SystemNode, extra: &Enrichment<'_>) -> Vec<SpecialKind> {
    let mut kinds = Vec::new();
    for kind in KIND_ORDER {
        if kind == SpecialKind::Unique {
            if kinds.is_empty() && is_unique_initializer(&node.initializer) {
                kinds.push(kind);
            }
            continue;
        }
        if matches(node, extra, kind) {
            kinds.push(kind);
        }
    }
    kinds
}

fn matches(node: &SystemNode, extra: &Enrichment<'_>, kind: SpecialKind) -> bool {
    let has = |flag: &str| node.flags.iter().any(|f| f == flag);
    match kind {
        SpecialKind::Leviathan => has("guardian") || extra.leviathan,
        SpecialKind::Enclave => has("enclave") || extra.enclave,
        SpecialKind::Marauder => has("marauder_system"),
        SpecialKind::FallenEmpire => node.initializer.starts_with("fallen_") || extra.fallen_empire,
        SpecialKind::Landmark => has("galactic_landmark_system"),
        SpecialKind::Unique => false,
    }
}

fn is_unique_initializer(initializer: &str) -> bool {
    !initializer.is_empty() && !is_generic_initializer(initializer)
}
