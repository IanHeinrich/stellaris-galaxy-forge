//! What a plain export could and could not carry over: the seats it wrote, the homes
//! worth a look, the bypasses a scenario cannot state, and where the initializers come
//! from. The file carries it as comment lines, the caller as issues.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::export::SourceResolver;
use crate::export::policy::{Category, builds_gateway, builds_lgate, classify, is_generic_home};
use crate::format::scenario::fe_zone::FeKind;
use crate::projections::galaxy::{BypassLink, GalaxyGraph, PaintSpawnKind};
use crate::validate::{Issue, IssueCode};
use crate::{as_u32, plural};

const DEFAULT_COUNTRY: &str = "default";

/// What a plain export wrote and what it left behind, for the file's comment lines,
/// the CLI's summary and the app's warnings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExportReport {
    /// Systems written with a spawn weight: every [`Category::Home`].
    pub seats: u32,
    /// Homes whose initializer is not one the generator seats any empire on.
    pub home_initializers: Vec<HomeInitializer>,
    pub dropped: DroppedBypasses,
    /// Ascending by category; a category with no systems is left out.
    pub by_category: Vec<CategoryCount>,
    /// Sorted by source.
    pub sources: Vec<SourceCount>,
    /// Fallen empire zones the Paint a Galaxy profile placed by the mod's own rule;
    /// 0 for the plain profile, which writes none.
    pub fallen_empire_zones: u32,
    /// The save's fallen empires, each left out for the mod to rebuild in a typed zone
    /// at its old capital; empty for the plain profile.
    pub fallen_empires: Vec<FallenEmpireReport>,
    /// The player's capital, written as the player's seat with the marker its kind
    /// takes. `None` for the plain profile or a save with no player.
    pub player_seat: Option<u32>,
    /// The seat's kind: Sol for the United Nations of Earth, the only empire that
    /// weighs it above zero, so the start is certain; preferred for any other empire,
    /// weighted to be the likeliest start, not a certain one.
    pub player_seat_kind: Option<PaintSpawnKind>,
    /// Systems left out because the game adds its own, ascending by category.
    pub omitted: Vec<OmittedCount>,
    /// Whether the header's counts come from the save's own setup screen.
    pub setup_from_save: bool,
}

/// An empire seat whose initializer may only fit the empire that started there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HomeInitializer {
    pub system: u32,
    pub initializer: String,
    /// Whether the Paint a Galaxy profile rewrote it to a generic start.
    pub replaced: bool,
}

/// A fallen empire the Paint a Galaxy profile left out and gave a typed zone.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FallenEmpireReport {
    pub name: String,
    pub kind: FeKind,
    /// The capital and the cluster around it.
    pub systems_left_out: u32,
    /// The system anchoring the zone: one added for it, or an existing one when the old
    /// spot was not clear. `None` when no clear spot was found within reach.
    pub anchor: Option<u32>,
    /// Whether the zone's centre is the old capital's exact position.
    pub exact: bool,
    /// How many kept systems that had a lane into the cluster were linked to the zone
    /// by a custom connection; 0 when none had, or the zone found no anchor.
    pub links: u32,
}

/// How many systems of one [`Category`] the export left out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OmittedCount {
    pub category: Category,
    pub systems: u32,
}

/// Bypasses the save had that the scenario does not state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DroppedBypasses {
    pub wormhole_pairs: u32,
    pub gateways: u32,
    pub lgates: u32,
}

/// How many systems the export classed as one [`Category`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CategoryCount {
    pub category: Category,
    pub systems: u32,
}

/// How many systems need one DLC or mod for their initializer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SourceCount {
    pub source: String,
    pub systems: u32,
}

impl ExportReport {
    /// One warning per dropped kind and per home initializer worth a look.
    pub fn issues(&self) -> Vec<Issue> {
        let mut issues: Vec<Issue> = self
            .dropped
            .parts()
            .into_iter()
            .map(|(count, noun)| {
                let verb = if count == 1 { "was" } else { "were" };
                Issue::new(
                    IssueCode::ExportDropped,
                    format!(
                        "{} {verb} not carried into the scenario",
                        plural(count, noun)
                    ),
                    Vec::new(),
                )
            })
            .collect();
        issues.extend(self.home_initializers.iter().map(|home| {
            Issue::new(
                IssueCode::HomeInitializer,
                format!(
                    "system {} is an empire seat on {}, not a generic home initializer",
                    home.system, home.initializer
                ),
                vec![home.system],
            )
        }));
        issues
    }

    /// `9 L-Cluster systems`, or `None` when nothing was left out.
    pub fn omitted_summary(&self) -> Option<String> {
        let parts: Vec<String> = self
            .omitted
            .iter()
            .map(|count| {
                plural(
                    count.systems as usize,
                    &format!("{} system", count.category.label()),
                )
            })
            .collect();
        (!parts.is_empty()).then(|| parts.join(", "))
    }

    /// `dlc021_distant_stars, my_mod`, or `None` when every initializer is vanilla.
    pub fn needs(&self) -> Option<String> {
        (!self.sources.is_empty()).then(|| {
            self.sources
                .iter()
                .map(|s| s.source.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
    }
}

impl DroppedBypasses {
    /// `3 wormhole pairs, 8 gateways, 1 L-Gate`, or `None` when nothing was dropped.
    pub fn summary(&self) -> Option<String> {
        let parts: Vec<String> = self
            .parts()
            .into_iter()
            .map(|(count, noun)| plural(count, noun))
            .collect();
        (!parts.is_empty()).then(|| parts.join(", "))
    }

    /// The non-zero kinds, each with its noun.
    fn parts(&self) -> Vec<(usize, &'static str)> {
        [
            (self.wormhole_pairs, "wormhole pair"),
            (self.gateways, "gateway"),
            (self.lgates, "L-Gate"),
        ]
        .into_iter()
        .filter(|(count, _)| *count > 0)
        .map(|(count, noun)| (count as usize, noun))
        .collect()
    }
}

/// The capitals of the playable countries that the galaxy holds.
pub(super) fn capitals(graph: &GalaxyGraph) -> BTreeSet<u32> {
    graph
        .countries
        .iter()
        .filter(|country| country.country_type == DEFAULT_COUNTRY)
        .filter_map(|country| country.capital_system)
        .filter(|id| graph.systems.contains_key(id))
        .collect()
}

/// Every system's category, keyed by id.
pub(super) fn categories(graph: &GalaxyGraph) -> BTreeMap<u32, Category> {
    let capitals = capitals(graph);
    graph
        .systems
        .values()
        .map(|system| {
            let category = classify(
                &system.initializer,
                &system.flags,
                capitals.contains(&system.id),
            );
            (system.id, category)
        })
        .collect()
}

/// The report for `graph` as the plain profile writes it.
pub(super) fn build(
    graph: &GalaxyGraph,
    categories: &BTreeMap<u32, Category>,
    sources: SourceResolver<'_>,
) -> ExportReport {
    let mut home_initializers = Vec::new();
    let mut by_category: BTreeMap<Category, u32> = BTreeMap::new();
    let mut by_source: BTreeMap<String, u32> = BTreeMap::new();
    for (&id, &category) in categories {
        *by_category.entry(category).or_default() += 1;
        let initializer = &graph.systems[&id].initializer;
        if category == Category::Home && !is_generic_home(initializer) {
            home_initializers.push(HomeInitializer {
                system: id,
                initializer: initializer.clone(),
                replaced: false,
            });
        }
        if let Some(source) = sources(initializer) {
            *by_source.entry(source).or_default() += 1;
        }
    }
    ExportReport {
        seats: by_category.get(&Category::Home).copied().unwrap_or(0),
        home_initializers,
        dropped: dropped(graph),
        by_category: by_category
            .into_iter()
            .map(|(category, systems)| CategoryCount { category, systems })
            .collect(),
        sources: by_source
            .into_iter()
            .map(|(source, systems)| SourceCount { source, systems })
            .collect(),
        fallen_empire_zones: 0,
        fallen_empires: Vec::new(),
        player_seat: None,
        player_seat_kind: None,
        omitted: Vec::new(),
        setup_from_save: false,
    }
}

/// Wormhole pairs once each; a gateway or L-Gate only when its system's initializer
/// does not put it back.
fn dropped(graph: &GalaxyGraph) -> DroppedBypasses {
    let rebuilt = |system: &u32, builds: fn(&str) -> bool| {
        graph
            .systems
            .get(system)
            .is_some_and(|s| builds(&s.initializer))
    };
    let mut pairs = BTreeSet::new();
    let mut dropped = DroppedBypasses::default();
    for link in &graph.bypasses {
        match link {
            BypassLink::Wormhole { a, b } => {
                pairs.insert((a.min(b), a.max(b)));
            }
            BypassLink::Gateway { system, .. } => {
                if !rebuilt(system, builds_gateway) {
                    dropped.gateways += 1;
                }
            }
            BypassLink::LGate { system } => {
                if !rebuilt(system, builds_lgate) {
                    dropped.lgates += 1;
                }
            }
            BypassLink::Other { .. } => {}
        }
    }
    dropped.wormhole_pairs = as_u32(pairs.len());
    dropped
}
