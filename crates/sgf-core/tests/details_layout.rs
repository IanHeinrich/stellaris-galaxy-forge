//! Details projection on the real sample save: where each body and belt lies, and the
//! modifiers and anomalies a planet holds.
use std::fmt::Write as _;

use sgf_core::entity::get_planet_page;
use sgf_core::format::save::details::{Bounds, HeuristicResolver, SystemDetails};
use sgf_core::ops::Op;

use crate::common;

/// Sol (belts at 145 and 290), Baxom (a binary about an empty centre), Stenbork,
/// Carmenekke (a moon of a moon) and Alpha Centauri: each body where the scene draws it.
#[test]
fn the_layout_of_the_4_4_samples_bodies_and_belts() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let mut report = String::new();
    for id in [217, 33, 18, 53, 278] {
        let system = details
            .resolve(id, &HeuristicResolver, false)
            .expect("system resolved");
        report.push_str(&layout_report(&system));
    }
    common::snapshot("layout_4_4", &report);
}

/// System 40, whose two moons name a deleted planet, and system 140, with belts at 40
/// and 90.
#[test]
fn the_layout_of_the_4_5_samples_bodies_and_belts() {
    let session = common::open_4_5();
    let details = session.details().expect("build details");
    let mut report = String::new();
    for id in [40, 140] {
        let system = details
            .resolve(id, &HeuristicResolver, false)
            .expect("system resolved");
        report.push_str(&layout_report(&system));
    }
    common::snapshot("layout_4_5", &report);
}

/// Sol's rocky belt with its radius taken out: Sol lists no belts, and the details are
/// still built for it and every other system.
#[test]
fn a_belt_with_no_radius_leaves_its_system_without_belts() {
    let session = common::open_edited(|gamestate| {
        let systems = gamestate.find("\ngalactic_object=").expect("the systems");
        let sol = systems + gamestate[systems..].find("\n\t217=\n\t{").expect("Sol");
        let line = "\t\t\t\tinner_radius=145\n";
        let radius = sol
            + gamestate[sol..]
                .find(line)
                .expect("the rocky belt's radius");
        gamestate.replace_range(radius..radius + line.len(), "");
    });
    let details = session.details().expect("build details");
    let resolve = |id| {
        details
            .resolve(id, &HeuristicResolver, false)
            .expect("system resolved")
    };
    let sol = resolve(217);
    assert!(sol.belts.is_empty(), "{:?}", sol.belts);
    assert_eq!(sol.inner_radius, Some(320.0));
    assert_eq!(sol.planets.len(), 24);
    let radii: Vec<f64> = resolve(17).belts.iter().map(|b| b.inner_radius).collect();
    assert_eq!(radii, [85.0, 195.0]);
}

/// Barren planet 585 carries no modifiers until `AddBodyModifier` adds one; the
/// resolved details pick it up without a full projection rebuild (only its planet is stale).
#[test]
fn a_terraform_candidate_modifier_reaches_the_resolved_planet() {
    let mut session = common::open_4_5();
    let system = get_planet_page(session.doc(), 585)
        .expect("planet 585")
        .system
        .expect("planet 585 orbits a system");
    let modifiers_of = |session: &sgf_core::session::Session| {
        session
            .details()
            .expect("build details")
            .resolve(system, &HeuristicResolver, false)
            .expect("system resolved")
            .planets
            .iter()
            .find(|p| p.id == 585)
            .expect("planet 585")
            .permanent_modifiers
            .clone()
    };
    assert_eq!(modifiers_of(&session), Some(Vec::new()));

    let result = session
        .apply(Op::AddBodyModifier {
            body: 585,
            modifier: "terraforming_candidate".to_owned(),
            days: vec![-1],
            feature: None,
        })
        .expect("add the candidate");
    assert_eq!(result.details_stale, vec![system]);
    assert_eq!(
        modifiers_of(&session),
        Some(vec!["terraforming_candidate".to_owned()])
    );
}

/// Planet 185 of the 4.5 sample holds an anomaly, which its summary names by category;
/// planet 140 holds none.
#[test]
fn a_planet_summary_names_the_anomaly_it_holds() {
    let session = common::open_4_5();
    let anomaly_of = |id: u32| {
        let system = get_planet_page(session.doc(), id)
            .expect("the planet")
            .system
            .expect("it orbits a system");
        session
            .details()
            .expect("build details")
            .resolve(system, &HeuristicResolver, false)
            .expect("system resolved")
            .planets
            .iter()
            .find(|p| p.id == id)
            .expect("the planet's summary")
            .anomaly
            .clone()
    };
    assert_eq!(anomaly_of(185).as_deref(), Some("AIANOM_RESEARCHDEPO_CAT"));
    assert_eq!(anomaly_of(140), None);
}

/// A fresh build (not the refresh path) keeps a planet's permanent modifiers and drops a
/// temporary one, which the terraform op could never remove and which the game data's
/// candidate list never carries a checkbox for.
#[test]
fn the_build_path_keeps_only_permanent_modifiers() {
    let session = common::open_edited_sample(common::SAMPLE_4_5, |gamestate, _| {
        let planet = gamestate
            .find(
                "
\t\t585=
\t\t{",
            )
            .expect("planet 585");
        let anchor = "\t\t\tbombardment_damage=0
";
        let at = planet
            + gamestate[planet..]
                .find(anchor)
                .expect("its bombardment_damage");
        let block = "\t\t\ttimed_modifier=
\t\t\t{
\t\t\t\titems=
\t\t\t\t{
\t\t\t\t\t{
\t\t\t\t\t\tmodifier=\"terraforming_candidate\"
\t\t\t\t\t\tdays=-1
\t\t\t\t\t}
\t\t\t\t\t{
\t\t\t\t\t\tmodifier=\"frozen_terraforming_candidate\"
\t\t\t\t\t\tdays=120
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
";
        gamestate.insert_str(at + anchor.len(), block);
    });
    let system = get_planet_page(session.doc(), 585)
        .expect("planet 585")
        .system
        .expect("planet 585 orbits a system");
    let modifiers = session
        .details()
        .expect("build details")
        .resolve(system, &HeuristicResolver, false)
        .expect("system resolved")
        .planets
        .iter()
        .find(|p| p.id == 585)
        .expect("planet 585")
        .permanent_modifiers
        .clone();
    assert_eq!(modifiers, Some(vec!["terraforming_candidate".to_owned()]));
}

fn layout_report(system: &SystemDetails) -> String {
    let mut out = format!(
        "system {} inner_radius={}\n",
        system.id,
        optional(system.inner_radius)
    );
    for belt in &system.belts {
        writeln!(out, "  belt {} {}", belt.kind, belt.inner_radius).expect("write");
    }
    for p in &system.planets {
        let layout = p.layout.as_ref().expect("a save body's layout");
        let at = layout
            .at
            .map_or("-".to_owned(), |(x, y)| format!("({x}, {y})"));
        writeln!(
            out,
            "  body {} {} parent={} orbit={} drawn={} at={at} size={} ring={}",
            p.id,
            p.class,
            optional(p.parent),
            optional(p.orbit),
            bounds(layout.orbit.map(rounded)),
            bounds(layout.size),
            optional(p.ring),
        )
        .expect("write");
    }
    out
}

/// A radius the report works out with `hypot`, to the five decimals a save writes, so the
/// snapshot reads the same on every platform.
fn rounded(Bounds { min, max }: Bounds) -> Bounds {
    let round = |v: f64| (v * 1e5).round() / 1e5;
    Bounds {
        min: round(min),
        max: round(max),
    }
}

fn optional(value: Option<impl std::fmt::Display>) -> String {
    value.map_or("-".to_owned(), |v| v.to_string())
}

fn bounds(value: Option<Bounds>) -> String {
    match value {
        None => "-".to_owned(),
        Some(Bounds { min, max }) if min == max => min.to_string(),
        Some(Bounds { min, max }) => format!("{min}..{max}"),
    }
}
