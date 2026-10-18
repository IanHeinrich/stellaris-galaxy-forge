//! The Special menu of Add system: the special layouts a user picks by name, less those a
//! star-class pick already draws, each with a label no other entry shares.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use sgf_core::session::Session;
use ts_rs::TS;

use crate::GameData;
use crate::body_effects;
use crate::generate;
use crate::initializers::{Initializer, expand};
use crate::layouts::{
    CLUSTERS, Cluster, ClusterPlan, DlcNeed, Eligibility, SaveFacts, UNIQUE_SYSTEM, cluster_member,
    converted, defining_mod, eligibility, notable, runs_scripts, special_initializers, star_body,
    unplaced,
};
use crate::loc::localisation::Localisation;

/// One entry of the Special menu.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialLayout {
    /// The initializer's key, which the added system records.
    pub key: String,
    /// The localised fixed system name, else the notable bodies, modifiers and belts:
    /// `Arboreal World`. A layout with none of them, and labels that would repeat once they
    /// take their belts, have the key made readable: `Star Lifting System`.
    pub label: String,
    /// Its `flags` set [`UNIQUE_SYSTEM`], or its [`crate::layouts::Converted`] entry says
    /// so: one of the game's unique systems, which the menu lists apart from its other
    /// special systems.
    pub unique: bool,
    /// It has `max_instances`, which an add counts in `system_initializer_counter`.
    pub capped: bool,
    /// How many systems of the save record it as their `initializer`.
    pub in_galaxy: u32,
    /// The DLC its odds rule it out without, when they check one.
    pub dlc: Option<DlcNeed>,
    /// For a mod's layout no galaxy places, [`crate::layouts::unplaced`]: the name of the
    /// mod that defines it. The menu lists these under that name, apart from the unique and
    /// other special systems.
    pub group: Option<String>,
}

/// A cluster of the Special menu: several systems added as one, with the lanes between them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SpecialCluster {
    /// Its key in [`CLUSTERS`], which the roll and the add take: `junk_ratlings`.
    pub key: String,
    pub label: String,
    /// What a sentence calls it: `the Junk Ratlings`.
    pub phrase: String,
    /// The layout of each of its systems, the home first: as many as the add writes.
    pub layouts: Vec<String>,
    /// How many lanes the add lays between its systems.
    pub lanes: u32,
    /// How many systems of the save record its home layout as their `initializer`.
    pub in_galaxy: u32,
    /// The DLC its home's odds rule it out without, when they check one.
    pub dlc: Option<DlcNeed>,
}

/// The special layouts the Special menu offers: all but those a star-class pick of
/// [`crate::generate::generate`] already draws, and the members of a cluster no galaxy places
/// alone, in the install's key order.
pub fn menu_initializers(gd: &GameData) -> Vec<&Initializer> {
    let drawn: HashSet<&str> = generate::star_pick_layouts(gd)
        .into_iter()
        .map(|init| init.name.as_str())
        .collect();
    special_initializers(gd)
        .into_iter()
        .filter(|init| !drawn.contains(init.name.as_str()))
        .filter(|init| !cluster_only(init))
        .collect()
}

/// A member of a cluster with no `usage` that the menu does not offer converted: it is
/// offered only through its cluster.
fn cluster_only(init: &Initializer) -> bool {
    cluster_member(init) && init.usage.is_none() && converted(init).is_none()
}

/// The clusters of [`CLUSTERS`] the generator can build every system of, in the table's
/// order.
pub fn menu_clusters(gd: &GameData) -> Vec<&'static Cluster> {
    CLUSTERS
        .iter()
        .filter(|cluster| {
            cluster.layouts().all(|layout| {
                gd.initializers
                    .get(layout)
                    .is_some_and(|init| eligibility(gd, init) == Eligibility::Special)
            })
        })
        .collect()
}

/// The clusters of [`menu_clusters`] `session`'s document takes, each with what an add writes
/// into it: those that come to more than their home.
pub fn document_clusters(gd: &GameData, session: &Session) -> Vec<(&'static Cluster, ClusterPlan)> {
    let runs = runs_scripts(session);
    menu_clusters(gd)
        .into_iter()
        .map(|cluster| (cluster, cluster.plan(gd, runs)))
        .filter(|(_, plan)| plan.layouts.len() > 1)
        .collect()
}

/// The Special menu's clusters for `session`'s document.
pub fn special_clusters(gd: &GameData, session: &Session) -> Vec<SpecialCluster> {
    let save = SaveFacts::read(session);
    document_clusters(gd, session)
        .iter()
        .map(|(cluster, plan)| cluster_row(gd, &save, cluster, plan))
        .collect()
}

/// The menu's row for `cluster`, whose add writes `plan`.
pub(crate) fn cluster_row(
    gd: &GameData,
    save: &SaveFacts,
    cluster: &Cluster,
    plan: &ClusterPlan,
) -> SpecialCluster {
    SpecialCluster {
        key: cluster.key.to_owned(),
        label: cluster.label.to_owned(),
        phrase: cluster.phrase.to_owned(),
        layouts: plan
            .layouts
            .iter()
            .map(|&layout| layout.to_owned())
            .collect(),
        lanes: plan.links.len() as u32,
        in_galaxy: save.in_galaxy(cluster.home),
        dlc: gd
            .initializers
            .get(cluster.home)
            .and_then(|home| save.dlc_need(gd, home)),
    }
}

/// The Special menu's entries for `session`'s save, by label.
pub fn special_layouts(gd: &GameData, session: &Session) -> Vec<SpecialLayout> {
    let save = SaveFacts::read(session);
    let layouts = menu_initializers(gd);
    let labels = labels(gd, &layouts);
    let mut entries: Vec<SpecialLayout> = layouts
        .into_iter()
        .zip(labels)
        .map(|(init, label)| SpecialLayout {
            key: init.name.clone(),
            label,
            unique: converted(init).is_some_and(|layout| layout.unique)
                || init.flags.iter().any(|flag| flag == UNIQUE_SYSTEM),
            capped: init.max_instances.is_some(),
            in_galaxy: save.in_galaxy(&init.name),
            dlc: save.dlc_need(gd, init),
            group: defining_mod(gd, init)
                .filter(|_| unplaced(gd, init))
                .map(str::to_owned),
        })
        .collect();
    entries.sort_by(|a, b| a.label.cmp(&b.label).then_with(|| a.key.cmp(&b.key)));
    entries
}

/// What a label is built from: the fixed name, or the megastructures its script spawns and the
/// notable bodies and modifiers, and the belts that tell it from another. A phenomenon's card shows its star, so its label
/// leaves the star out.
struct LabelParts {
    main: Vec<String>,
    belts: Vec<String>,
}

/// A label for each of `layouts`, no two alike.
fn labels(gd: &GameData, layouts: &[&Initializer]) -> Vec<String> {
    let parts: Vec<LabelParts> = layouts.iter().map(|init| label_parts(gd, init)).collect();
    let mut labels: Vec<String> = parts
        .iter()
        .zip(layouts)
        .map(|(parts, init)| {
            let main = match parts.main.is_empty() {
                true => &parts.belts,
                false => &parts.main,
            };
            match main.is_empty() {
                true => Localisation::readable(&init.name),
                false => main.join(", "),
            }
        })
        .collect();
    let base = labels.clone();
    for (i, part) in parts.iter().enumerate() {
        if repeated(&base, i) && !part.main.is_empty() && !part.belts.is_empty() {
            labels[i] = [part.main.clone(), part.belts.clone()].concat().join(", ");
        }
    }
    let first = labels.clone();
    for (i, init) in layouts.iter().enumerate() {
        if !repeated(&first, i) {
            continue;
        }
        let uncapped: Vec<usize> = (0..layouts.len())
            .filter(|&j| first[j] == first[i] && layouts[j].max_instances.is_none())
            .collect();
        if uncapped != [i] {
            labels[i] = Localisation::readable(&init.name);
        }
    }
    labels
}

fn repeated(labels: &[String], i: usize) -> bool {
    labels
        .iter()
        .enumerate()
        .any(|(j, label)| j != i && *label == labels[i])
}

fn label_parts(gd: &GameData, init: &Initializer) -> LabelParts {
    let loc = |key: &str| gd.loc.name_or_readable(key);
    let mut belts: Vec<String> = Vec::new();
    for belt in &init.asteroid_belts {
        let name = Localisation::readable(&belt.kind);
        if !belts.contains(&name) {
            belts.push(name);
        }
    }
    // The layout's fixed name, whether written for the Special menu or as `name = …`, with
    // the readable fallback each takes when the install has no localisation for it.
    let fixed = converted(init)
        .and_then(|layout| layout.label)
        .map(|key| (key, Localisation::readable(key.trim_start_matches("NAME_"))))
        .or_else(|| {
            init.display_name
                .as_deref()
                .map(|name| (name, Localisation::readable(&init.name)))
        });
    if let Some((key, fallback)) = fixed {
        let main = gd.loc.name(key).unwrap_or(fallback);
        return LabelParts {
            main: vec![main],
            belts,
        };
    }
    let mut main: Vec<String> = Vec::new();
    let mut push = |part: String| {
        if !main.contains(&part) {
            main.push(part);
        }
    };
    if let Ok(structures) = generate::layout_structures(gd, init) {
        for def in structures.types() {
            push(loc(&def.key));
        }
    }
    for body in expand(&init.planets)
        .skip_while(|b| !star_body(gd, &b.block.class))
        .skip(1)
    {
        let class = body.block.class.named().and_then(|key| resolved(gd, key));
        if let Some(class) = class.filter(|c| notable(gd, c)) {
            push(loc(class));
        }
        for modifier in body_effects::modifiers(&body.block.effects) {
            push(loc(modifier));
        }
    }
    LabelParts { main, belts }
}

/// The one class a body can be: its fixed class, or the only class of its planet list.
fn resolved<'a>(gd: &'a GameData, class: &'a str) -> Option<&'a str> {
    match gd.planet_lists.get(class) {
        Some(list) if list.len() == 1 => Some(list[0].as_str()),
        Some(_) => None,
        None => Some(class),
    }
}
