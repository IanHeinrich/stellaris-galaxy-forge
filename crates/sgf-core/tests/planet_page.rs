//! A save body's own page on the sample saves: a colony, an unowned surveyed world with
//! blockers, a gas giant with moons and a station, a star, an asteroid and a 4.5 capital.

use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::entity::{EntityError, PlanetPage, get_planet_page};
use sgf_core::ops::Op;

use crate::common;
use common::fixture::GRAMMAR;

fn page(doc: &Document, id: u32) -> PlanetPage {
    get_planet_page(doc, id).unwrap_or_else(|e| panic!("planet {id}: {e}"))
}

fn or_none<T: ToString>(value: Option<T>) -> String {
    value.map_or_else(|| "-".to_owned(), |v| v.to_string())
}

fn report(page: &PlanetPage) -> String {
    let mut out = String::new();
    let mut line = |text: String| writeln!(out, "{text}").unwrap();
    line(format!(
        "planet {} {} ({})",
        page.id, page.label, page.name_key
    ));
    line(format!(
        "class {} size {} orbit {}",
        page.class,
        or_none(page.size),
        or_none(page.orbit)
    ));
    line(format!(
        "system {} parent {} owner {} controller {} surveyed by {} station {} flags {}",
        or_none(page.system),
        or_none(page.parent),
        or_none(page.owner),
        or_none(page.controller),
        or_none(page.surveyed_by),
        or_none(page.station),
        page.flags
    ));
    for moon in &page.moons {
        line(format!(
            "moon {} {} {} size {}",
            moon.id,
            moon.name.stand_in(),
            moon.class,
            or_none(moon.size)
        ));
    }
    for deposit in &page.deposits {
        let swap = deposit
            .swap_type
            .as_ref()
            .map_or(String::new(), |s| format!(" hides {s}"));
        line(format!("deposit {} {}{swap}", deposit.id, deposit.kind));
    }
    for modifier in &page.planet_modifiers {
        line(format!("planet modifier {modifier}"));
    }
    for timed in &page.timed_modifiers {
        line(format!(
            "timed modifier {} days {}",
            timed.modifier, timed.days
        ));
    }
    if let Some(colony) = &page.colony {
        line(format!(
            "colony {} colonised {} designation {} manual {} pops {}",
            colony.id,
            or_none(colony.colonised.as_ref()),
            or_none(colony.final_designation.as_ref()),
            or_none(colony.designation.as_ref()),
            colony.pops
        ));
        for species in &colony.species {
            line(format!(
                "species {} {} pops {}",
                species.id,
                species.name.stand_in(),
                species.pops
            ));
        }
    }
    out
}

fn kinds(page: &PlanetPage) -> Vec<&str> {
    page.deposits.iter().map(|d| d.kind.as_str()).collect()
}

/// Nekkar I, a Ti-Zru fallen empire colony orbiting the Nekkar star.
#[test]
fn an_owned_colony_reads_its_colony() {
    let doc = common::load();
    let nekkar_i = page(&doc, 731);
    assert_eq!(nekkar_i.class, "pc_tropical");
    assert_eq!(nekkar_i.owner, Some(16));
    assert_eq!(nekkar_i.system, Some(396));
    assert_eq!(nekkar_i.parent, Some(730));
    assert_eq!(nekkar_i.orbit, Some(60.0));
    assert_eq!(nekkar_i.deposits.len(), 11);
    // One entry per deposit, repeats kept for the app to group.
    let swamps = kinds(&nekkar_i)
        .into_iter()
        .filter(|k| *k == "d_bubbling_swamp")
        .count();
    assert_eq!(swamps, 2);

    let colony = nekkar_i.colony.as_ref().expect("a colony");
    assert_eq!(colony.id, 29);
    assert_eq!(colony.final_designation.as_deref(), Some("col_fe_colony"));
    assert_eq!(colony.designation, None);
    assert_eq!(colony.colonised.as_deref(), Some("2200.01.01"));
    assert_eq!(colony.pops, 1600);
    let split: Vec<(u32, String, u32)> = colony
        .species
        .iter()
        .map(|s| (s.id, s.name.stand_in(), s.pops))
        .collect();
    assert_eq!(
        split,
        [
            (20, "SPEC_Ti-Zru".to_owned(), 800),
            (22, "NAME_Synthetic".to_owned(), 800)
        ]
    );
    common::snapshot("nekkar_i_731", &report(&nekkar_i));
}

/// Olbers II: unowned and surveyed, with three blockers, one of which hides Crystalline
/// Caverns, a permanent geothermal modifier and one moon.
#[test]
fn an_unowned_world_reads_its_blockers_modifiers_and_moon() {
    let doc = common::load();
    let olbers_ii = page(&doc, 5172);
    assert_eq!(olbers_ii.owner, None);
    assert!(olbers_ii.colony.is_none());
    assert_eq!(olbers_ii.surveyed_by, Some(16_777_221));
    for blocker in [
        "d_dangerous_wildlife_blocker",
        "d_massive_glacier",
        "d_active_volcano",
    ] {
        assert!(kinds(&olbers_ii).contains(&blocker), "{blocker}");
    }
    let hiding: Vec<_> = olbers_ii
        .deposits
        .iter()
        .filter(|d| d.swap_type.is_some())
        .collect();
    assert_eq!(hiding.len(), 1);
    assert_eq!(hiding[0].id, 3403);
    assert_eq!(hiding[0].kind, "d_massive_glacier");
    assert_eq!(
        hiding[0].swap_type.as_deref(),
        Some("d_crystalline_caverns")
    );
    assert_eq!(
        olbers_ii.planet_modifiers,
        ["pm_abundant_geothermal_activity"]
    );
    let timed: Vec<(&str, i32)> = olbers_ii
        .timed_modifiers
        .iter()
        .map(|t| (t.modifier.as_str(), t.days))
        .collect();
    assert_eq!(timed, [("abundant_geothermal_activity", -1)]);
    let moons: Vec<(u32, &str)> = olbers_ii
        .moons
        .iter()
        .map(|m| (m.id, m.class.as_str()))
        .collect();
    assert_eq!(moons, [(5173, "pc_barren_cold")]);
    common::snapshot("olbers_ii_5172", &report(&olbers_ii));

    // The moon's parent is the planet it names, not the star.
    assert_eq!(page(&doc, 5173).parent, Some(5172));
}

/// Nekkar VIII: a gas giant with two moons, an orbital trade deposit and a mining station
/// whose id is its fleet's.
#[test]
fn a_gas_giant_reads_its_moons_orbital_deposit_and_station() {
    let doc = common::load();
    let nekkar_viii = page(&doc, 744);
    assert_eq!(nekkar_viii.class, "pc_gas_giant");
    assert_eq!(nekkar_viii.parent, Some(730));
    let moons: Vec<(u32, &str, Option<u32>)> = nekkar_viii
        .moons
        .iter()
        .map(|m| (m.id, m.class.as_str(), m.size))
        .collect();
    assert_eq!(
        moons,
        [(745, "pc_frozen", Some(10)), (746, "pc_frozen", Some(6))]
    );
    assert_eq!(
        nekkar_viii.moons[0].name.stand_in(),
        "SUBPLANET_NAME_FORMAT"
    );
    assert_eq!(kinds(&nekkar_viii), ["d_trade_value_4"]);
    assert_eq!(nekkar_viii.station, Some(498));
    assert!(nekkar_viii.colony.is_none());
}

/// The Nekkar star is its system's primary body, so it orbits nothing.
#[test]
fn a_star_reads_its_energy_deposit() {
    let doc = common::load();
    let star = page(&doc, 730);
    assert_eq!(star.class, "pc_g_star");
    assert_eq!(star.parent, None);
    assert_eq!(star.deposits.len(), 1);
    assert_eq!(star.deposits[0].id, 1024);
    assert_eq!(star.deposits[0].kind, "d_energy_2");
    assert_eq!(star.surveyed_by, Some(16));
}

#[test]
fn an_asteroid_reads_its_mineral_deposit_and_station() {
    let doc = common::load();
    let asteroid = page(&doc, 56);
    assert_eq!(asteroid.class, "pc_asteroid");
    assert_eq!(kinds(&asteroid), ["d_minerals_5"]);
    assert_eq!(asteroid.station, Some(387));
    assert_eq!(asteroid.flags, 2);
    assert!(asteroid.parent.is_some());
}

/// A 4.5 capital whose player set its designation by hand.
#[test]
fn a_4_5_capital_reads_its_manual_designation() {
    let doc = Document::load(common::SAMPLE_4_5).expect("load the 4.5 sample");
    let capital = page(&doc, 18);
    let colony = capital.colony.as_ref().expect("a colony");
    assert_eq!(colony.id, 1);
    assert_eq!(colony.designation.as_deref(), Some("col_capital"));
    assert_eq!(colony.final_designation.as_deref(), Some("col_capital"));
    assert_eq!(colony.pops, 5382);
    assert_eq!(colony.species.len(), 1);
    assert_eq!(colony.species[0].pops, 5382);
    assert_eq!(capital.deposits.len(), 12);
    let timed: Vec<(&str, i32)> = capital
        .timed_modifiers
        .iter()
        .map(|t| (t.modifier.as_str(), t.days))
        .collect();
    assert_eq!(timed, [("prosp_uni_mod", 6756)]);
    common::snapshot("capital_4_5_18", &report(&capital));
}

#[test]
fn the_page_reads_the_bytes_an_op_wrote() {
    let mut session = common::open();
    session
        .apply(Op::SetPlanetSize { id: 731, size: 20 })
        .expect("resize Nekkar I");
    assert_eq!(page(&session.doc, 731).size, Some(20));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(page(&session.doc, 731).size, Some(16));
}

#[test]
fn an_absent_planet_and_a_scenarios_are_not_found() {
    let doc = common::load();
    let err = get_planet_page(&doc, 999_999).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");

    let scenario = GRAMMAR.open();
    let err = get_planet_page(&scenario.doc, 0).unwrap_err();
    assert!(matches!(err, EntityError::NotFound(_)), "{err}");
}
