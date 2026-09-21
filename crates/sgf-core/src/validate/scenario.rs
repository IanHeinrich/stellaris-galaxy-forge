//! The checks on what the game itself reads from a scenario: its marauder clans and
//! the space it builds the L-Cluster in.

use super::{Issue, IssueCode, Severity, listed};
use crate::format::scenario::marauder::{self, MarauderRole};
use crate::guides::Guide;
use crate::ops::rules::fe_zone::label;
use crate::projections::galaxy::{GalaxyGraph, SystemNode};

/// What the marauder initializers say against each other: one home per clan, and a raid
/// base beside its clan's home, else the mod adds nothing there.
pub(super) fn marauders(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    for (clan, homes) in marauder::homes(g) {
        if homes.len() < 2 {
            continue;
        }
        let names: Vec<String> = homes
            .iter()
            .filter_map(|id| g.systems.get(id))
            .map(label)
            .collect();
        let count = match homes.len() {
            2 => "two".to_owned(),
            n => n.to_string(),
        };
        issues.push(Issue::new(
            IssueCode::MarauderHomeDuplicate,
            format!(
                "Marauder clan {clan} has {count} homes: {}. Only one spawns.",
                listed(&names)
            ),
            homes,
        ));
    }
    let mut bases: Vec<(&SystemNode, u8)> = g
        .systems
        .values()
        .filter_map(|system| match system.marauder {
            Some(MarauderRole::Base(clan)) => Some((system, clan)),
            _ => None,
        })
        .collect();
    bases.sort_unstable_by_key(|(base, _)| base.id);
    for (base, clan) in bases {
        let beside_home =
            !marauder::neighbours_with_role(g, base, MarauderRole::Home(clan)).is_empty();
        if !beside_home {
            issues.push(Issue::new(
                IssueCode::MarauderBaseOrphan,
                format!(
                    "{} is a raid base of clan {clan} with no clan home beside it. Nothing spawns there.",
                    label(base)
                ),
                vec![base.id],
            ));
        }
    }
    marauders_bases_missing(g, issues);
}

/// Every marauder clan home with fewer than two raid bases of its clan hyperlaned to
/// it: a clan is its home and two bases beside it, and nothing adds the missing ones.
fn marauders_bases_missing(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    for (clan, homes) in marauder::homes(g) {
        for id in homes {
            let Some(home) = g.systems.get(&id) else {
                continue;
            };
            let bases = marauder::neighbours_with_role(g, home, MarauderRole::Base(clan));
            if bases.len() >= 2 {
                continue;
            }
            // A save from an older game can hold a clan with one base, and it runs; only a
            // home with none is worth more than a note.
            let (count, severity) = match bases.len() {
                0 => ("no raid bases", Severity::Warning),
                1 => ("one raid base", Severity::Info),
                _ => unreachable!("fewer than two"),
            };
            let mut issue = Issue::new(
                IssueCode::MarauderBasesMissing,
                format!(
                    "{} is the marauder clan {clan} home with {count} beside it. A clan is its home and two bases hyperlaned to it.",
                    label(home)
                ),
                vec![home.id],
            );
            issue.severity = severity;
            issues.push(issue);
        }
    }
}

/// Every system inside the circle the game builds the L-Cluster in.
pub(super) fn l_cluster(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let guide = Guide::l_cluster();
    for system in g.systems.values() {
        if guide.contains(system.x, system.y) {
            issues.push(Issue::new(
                IssueCode::LClusterSystem,
                format!(
                    "{} sits where the game places the L-Cluster.",
                    label(system)
                ),
                vec![system.id],
            ));
        }
    }
}
