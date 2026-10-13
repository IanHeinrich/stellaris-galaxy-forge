//! A megastructure whose last stage changes its planet's class or size, added to the 4.5
//! sample with that change as one edit.

use sgf_core::entity::views::EntityKind;
use sgf_core::ops::{ClassChange, Op, PlanetClassRule};

use crate::common;
use crate::ops_add_megastructure::on_body;
use common::diff::round_trip;
use common::edit::ALARI;
use common::{assert_refusals, entity_text, open_4_5};

/// A Yggdrasil Orchid's last stage makes its gas giant a food giant as it finishes. Added
/// with that change, Alari's gas giant 6 changes class and takes the row in one edit, named as
/// the session names it, and undo gives the bytes back. The class goes first: the class op refuses a planet that has a
/// megastructure, which the game's own order, row first, would meet. Added without the
/// change, only the row is written and the planet stays a gas giant. The class change is the
/// class change the join builds for the Orchid, which sgf-gamedata's
/// `the_join_builds_the_orchids_batch_from_the_playset` test pins.
#[test]
fn a_megastructure_that_changes_its_planet_is_added_with_the_change_in_one_edit() {
    let rule = |class: &str, models| PlanetClassRule {
        class: class.to_owned(),
        change: ClassChange::Uncolonised,
        models,
    };
    let change = Op::SetBodyClass {
        body: 6,
        from: rule("pc_gas_giant", 5),
        to: rule("pc_food_giant", 1),
        look: None,
    };
    let add = on_body(ALARI, "yggdrasil_orchid_3", 6);
    let said_removing = |class: Option<&str>, size: Option<u32>, moons: usize| {
        open_4_5()
            .save("adding a megastructure")
            .expect("a save")
            .megastructure_planet_change_description("Yggdrasil Orchid", 6, class, size, moons)
            .expect("planet 6")
    };
    let said = |class: Option<&str>, size: Option<u32>| said_removing(class, size, 0);
    let description = said(Some("Food Giant"), None);
    assert_eq!(
        description, "Added the Yggdrasil Orchid at planet #6 and made it a Food Giant",
        "a planet whose name reads as no name is called by its id"
    );
    assert_eq!(
        said(Some("Food Giant"), Some(6)),
        "Added the Yggdrasil Orchid at planet #6 and made it a Food Giant and size 6"
    );
    assert_eq!(
        said(None, Some(6)),
        "Added the Yggdrasil Orchid at planet #6 and made it size 6"
    );
    assert_eq!(
        said(Some("Ocean World"), None),
        "Added the Yggdrasil Orchid at planet #6 and made it an Ocean World"
    );
    assert_eq!(
        said_removing(Some("Ocean World"), None, 3),
        "Added the Yggdrasil Orchid at planet #6 and made it an Ocean World, removing its 3 moons"
    );
    assert_eq!(
        said_removing(None, None, 1),
        "Added the Yggdrasil Orchid at planet #6, removing its moon"
    );
    let batch = |ops: Vec<Op>| Op::Batch {
        description: description.clone(),
        ops,
    };
    round_trip(open_4_5(), batch(vec![change.clone(), add.clone()]));

    let mut changed = open_4_5();
    changed
        .apply(batch(vec![change.clone(), add.clone()]))
        .expect("the Orchid and its food giant");
    let planet = entity_text(&changed, EntityKind::Planet, 6);
    assert!(
        planet.contains("planet_class=\"pc_food_giant\""),
        "{planet}"
    );
    assert!(planet.contains("megastructure=16"), "{planet}");
    assert_eq!(changed.history().undo.len(), 1, "one edit");
    assert_eq!(changed.history().undo[0].description, description);

    let mut kept = open_4_5();
    kept.apply(add.clone()).expect("the Orchid alone");
    let planet = entity_text(&kept, EntityKind::Planet, 6);
    assert!(planet.contains("planet_class=\"pc_gas_giant\""), "{planet}");
    assert!(planet.contains("megastructure=16"), "{planet}");

    assert_refusals(
        &mut open_4_5(),
        [(
            batch(vec![add, change]),
            "planet 6 has a megastructure, so it keeps its class",
        )],
    );
}
