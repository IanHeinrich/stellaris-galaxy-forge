//! Adding a megastructure to a system of the real 4.5 sample save, end to end.
use serde_json::json;
use sgf_app_lib::views::AddedMegastructure;
use sgf_core::entity::{EntityAddr, EntityKind};
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::views::details::SystemDetails;
use sgf_core::views::{EditResult, ErrorKind};

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

fn nexus() -> serde_json::Value {
    json!({
        "system": 169, "kind": "think_tank_3",
        "place": { "place": "body", "body": 6 },
        "keepPlanet": false
    })
}

#[test]
fn adding_a_megastructure_needs_game_data() {
    let w = webview();
    open(&w, SAMPLE_45);
    let refused =
        invoke::<AddedMegastructure>(&w, "add_megastructure", nexus()).expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

/// A Science Nexus on gas giant 6 of the capital system takes row 16, the slot past the
/// sample's highest, and undo takes it out again.
#[test]
fn a_megastructure_is_added_and_undone() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let added: AddedMegastructure =
        invoke(&w, "add_megastructure", nexus()).expect("the Science Nexus");
    assert_eq!(added.added.megastructures, [16]);
    assert!(
        added
            .added
            .edit
            .touched_entities
            .contains(&EntityAddr::new(EntityKind::Megastructure, 16)),
        "{:?}",
        added.added.edit.touched_entities
    );
    assert_eq!(added.added.edit.details_stale, [169]);

    let relay: AddedMegastructure = invoke(
        &w,
        "add_megastructure",
        json!({
            "system": 0, "kind": "hyper_relay",
            "place": { "place": "free", "x": 0.0, "y": -260.0 },
            "keepPlanet": false
        }),
    )
    .expect("a relay");
    assert_eq!(relay.added.megastructures, [17]);

    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert_eq!(undone.history.undo.len(), 1);
    let links = undone.delta.bypasses.expect("the bypass links");
    assert!(
        !links
            .iter()
            .any(|link| matches!(link, BypassLink::Other { system: 0, .. })),
        "{links:?}"
    );
    let details: Vec<SystemDetails> =
        invoke(&w, "get_system_details", json!({ "ids": [0, 169] })).expect("details");
    let rows = |system: u32| -> Vec<u32> {
        details
            .iter()
            .find(|d| d.id == system)
            .unwrap_or_else(|| panic!("system {system}"))
            .megastructures
            .iter()
            .map(|m| m.id)
            .collect()
    };
    assert!(rows(0).is_empty(), "the relay is gone");
    assert_eq!(rows(169), [16], "the Nexus stays");
}

/// A Dyson Sphere is built only around a star: planet 585 of Xu Nur (1) is refused, its star
/// 584 is not.
#[test]
fn a_star_only_type_is_refused_off_a_star() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let sphere = |body: u32| {
        json!({
            "system": 1, "kind": "dyson_sphere_5",
            "place": { "place": "body", "body": body },
            "keepPlanet": false
        })
    };
    let refused =
        invoke::<AddedMegastructure>(&w, "add_megastructure", sphere(585)).expect_err("a planet");
    assert!(
        refused.message.contains("only around a star"),
        "{}",
        refused.message
    );
    invoke::<AddedMegastructure>(&w, "add_megastructure", sphere(584)).expect("the star");
}

#[test]
fn a_type_the_editor_does_not_add_is_refused_with_its_reason() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let refuse = |kind: &str, place: serde_json::Value| {
        invoke::<AddedMegastructure>(
            &w,
            "add_megastructure",
            json!({ "system": 1, "kind": kind, "place": place, "keepPlanet": false }),
        )
        .expect_err(kind)
    };
    let free = json!({ "place": "free", "x": 0.0, "y": -260.0 });
    let lgate = refuse("lgate_base", free.clone());
    assert_eq!(lgate.kind, ErrorKind::Op);
    assert!(lgate.message.contains("lgate"), "{}", lgate.message);
    let ring = refuse("ring_world_2", json!({ "place": "body", "body": 584 }));
    assert!(ring.message.contains("ring world"), "{}", ring.message);
    let unknown = refuse("no_such_structure", free);
    assert!(
        unknown.message.contains("no_such_structure"),
        "{}",
        unknown.message
    );
    invoke::<AddedMegastructure>(
        &w,
        "add_megastructure",
        json!({
            "system": 1, "kind": "ring_world_1",
            "place": { "place": "body", "body": 584 }, "keepPlanet": false
        }),
    )
    .expect("a ring world's site is one row round the star");
}

/// An Arc Furnace round Alari's molten planet 1 takes the mining bonus and a deposit to the
/// 11 bodies its event picks: not the star, the colonised capital, or barren cold 8 and
/// barren 11, whose engineering deposits a research station works. It raises the counter
/// of country 0, which owns the system. One effect of an event its owner fires is left out
/// and named, and the edit says so. A Dyson Swarm round the star of Xu Nur, which no one
/// owns, gives the star its last stage's modifier and raises no counter. Deleted, the
/// furnace takes all of it back.
#[test]
fn a_megastructure_is_added_with_what_its_construction_adds() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let furnace: AddedMegastructure = invoke(
        &w,
        "add_megastructure",
        json!({
            "system": 169, "kind": "orbital_arc_furnace_4",
            "place": { "place": "body", "body": 1 },
            "keepPlanet": false
        }),
    )
    .expect("the Arc Furnace");
    assert_eq!(
        furnace.added.edit.entry.description,
        "Added megastructure #16 (orbital_arc_furnace_4) in Alari system #169, with 11 modifiers, 11 deposits and 1 counter, leaving out 1 effect of its construction"
    );
    assert_eq!(
        furnace.unsure,
        ["focus.535: change_variable with a value that is not a number"]
    );
    let swarm: AddedMegastructure = invoke(
        &w,
        "add_megastructure",
        json!({
            "system": 1, "kind": "dyson_swarm_3",
            "place": { "place": "body", "body": 584 },
            "keepPlanet": false
        }),
    )
    .expect("the Dyson Swarm");
    assert_eq!(
        swarm.added.edit.entry.description,
        "Added megastructure #17 (dyson_swarm_3) in Xu Nur #1, with 1 modifier"
    );
    assert!(furnace.unwritten.is_empty(), "{:?}", furnace.unwritten);
    assert!(swarm.unsure.is_empty(), "{:?}", swarm.unsure);
    let deleted: EditResult = invoke(
        &w,
        "delete_megastructure",
        json!({ "megastructure": furnace.added.megastructures[0] }),
    )
    .expect("the delete");
    assert!(
        deleted
            .entry
            .description
            .starts_with("Removed megastructure #16 (orbital_arc_furnace_4)")
            && deleted
                .entry
                .description
                .ends_with(", with 11 modifiers, 11 deposits and 1 counter"),
        "{}",
        deleted.entry.description
    );
}
