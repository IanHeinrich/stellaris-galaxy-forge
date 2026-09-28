//! A save body's own page on the sample saves: a colony, an unowned surveyed world with
//! blockers, a gas giant with moons and a station, a star, an asteroid and a 4.5 capital.
//! Each page is snapshotted whole, every field as the app receives it.

use sgf_core::document::Document;
use sgf_core::entity::{EntityError, PlanetPage, get_planet_page};
use sgf_core::ops::Op;

use crate::common;
use common::fixture::GRAMMAR;

fn page(doc: &Document, id: u32) -> PlanetPage {
    get_planet_page(doc, id).unwrap_or_else(|e| panic!("planet {id}: {e}"))
}

/// Each page snapshotted as the app receives it:
/// - Nekkar I (731), a Ti-Zru fallen empire colony orbiting the Nekkar star;
/// - Olbers II (5172), unowned and surveyed, with three blockers, one of which hides
///   Crystalline Caverns, a permanent geothermal modifier and one moon;
/// - Nekkar VIII (744), a gas giant with two moons, an orbital trade deposit and a mining
///   station whose id is its fleet's;
/// - the Nekkar star (730), its system's primary body, which orbits nothing;
/// - an asteroid (56) with a mineral deposit and a station;
/// - the 4.5 sample's capital (18), whose player set its designation by hand.
#[test]
fn each_page_reads_its_body_colony_deposits_modifiers_and_moons() {
    let (four_four, four_five) = (common::load(), common::load_4_5());
    for (doc, id, name) in [
        (&four_four, 731, "nekkar_i_731"),
        (&four_four, 5172, "olbers_ii_5172"),
        (&four_four, 744, "nekkar_viii_744"),
        (&four_four, 730, "nekkar_730"),
        (&four_four, 56, "asteroid_56"),
        (&four_five, 18, "capital_4_5_18"),
    ] {
        let page = page(doc, id);
        common::snapshot(name, &serde_json::to_string_pretty(&page).expect("json"));
    }

    // One entry per deposit, repeats kept for the app to group.
    let swamps = page(&four_four, 731)
        .deposits
        .iter()
        .filter(|d| d.kind == "d_bubbling_swamp")
        .count();
    assert_eq!(swamps, 2);
    // A moon's parent is the planet it names, not the star.
    assert_eq!(page(&four_four, 5173).parent, Some(5172));
}

/// Colony 0 of the 4.5 sample, the player's capital: four districts, one of each type,
/// and the zones and buildings in its city district.
#[test]
fn a_colony_lists_its_built_districts_zones_and_buildings() {
    let colony = page(&common::load_4_5(), 2).colony.expect("colony 0");
    let built: Vec<(&str, u32)> = colony
        .districts
        .iter()
        .map(|d| (d.kind.as_str(), d.level))
        .collect();
    assert_eq!(
        built,
        [
            ("district_city", 3),
            ("district_generator", 3),
            ("district_mining", 1),
            ("district_farming", 6),
        ]
    );
    assert_eq!(
        colony.zones,
        ["zone_default", "zone_research_unity", "zone_industrial"]
    );
    assert!(colony.buildings.contains(&"building_capital".to_owned()));
    assert_eq!(colony.buildings.len(), 5);
}

#[test]
fn a_terraforming_planet_says_so() {
    let doc = common::load_4_5();
    assert!(!page(&doc, 2).terraforming);
    let session = common::open_edited_sample(common::SAMPLE_4_5, |text, _| {
        let list = "			entity=1
			deposits=
			{
				440 ";
        assert_eq!(text.matches(list).count(), 1);
        let process = "			terraform_process=
			{
				progress=1381.5
				total=7200
				planet_class=\"pc_ocean\"
			}
";
        *text = text.replacen(list, &format!("{process}{list}"), 1);
    });
    assert!(page(&session.doc, 2).terraforming);
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

/// The 4.5 sample's anomalies: two one country has found, one no country has, and a
/// planet that holds none.
#[test]
fn a_page_names_the_anomaly_its_planet_holds_and_who_found_it() {
    let doc = common::load_4_5();
    let anomaly = |id: u32| page(&doc, id).anomaly;
    let found = anomaly(185).expect("planet 185's anomaly");
    assert_eq!(found.category, "AIANOM_RESEARCHDEPO_CAT");
    assert_eq!(found.found_by, anomaly(182).expect("182's").found_by);
    assert_eq!(found.found_by.len(), 1, "{found:?}");
    let waiting = anomaly(2600).expect("planet 2600's anomaly");
    assert_eq!(waiting.category, "time_loop_world");
    assert!(waiting.found_by.is_empty(), "{waiting:?}");
    assert_eq!(anomaly(140), None);
}
