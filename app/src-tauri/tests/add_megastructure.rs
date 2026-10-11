//! Adding a megastructure to a system of the real 4.5 sample save, end to end.
use serde_json::json;
use sgf_app_lib::views::AddedMegastructure;
use sgf_core::entity::{EntityAddr, EntityKind};
use sgf_core::format::save::details::SystemDetails;
use sgf_core::projections::galaxy::BypassLink;
use sgf_core::views::{EditResult, ErrorKind};

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

fn nexus() -> serde_json::Value {
    json!({
        "system": 169, "kind": "think_tank_3",
        "place": { "place": "body", "body": 6 }, "owner": 0
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
    assert_eq!(added.megastructure, 16);
    assert!(
        added
            .edit
            .touched_entities
            .contains(&EntityAddr::new(EntityKind::Megastructure, 16)),
        "{:?}",
        added.edit.touched_entities
    );
    assert_eq!(added.edit.details_stale, [169]);

    let relay: AddedMegastructure = invoke(
        &w,
        "add_megastructure",
        json!({
            "system": 0, "kind": "hyper_relay",
            "place": { "place": "free", "x": 0.0, "y": -260.0 }, "owner": null
        }),
    )
    .expect("a relay");
    assert_eq!(relay.megastructure, 17);

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
            "place": { "place": "body", "body": body }, "owner": null
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
            json!({ "system": 1, "kind": kind, "place": place, "owner": null }),
        )
        .expect_err(kind)
    };
    let free = json!({ "place": "free", "x": 0.0, "y": -260.0 });
    let lgate = refuse("lgate_base", free.clone());
    assert_eq!(lgate.kind, ErrorKind::Op);
    assert!(lgate.message.contains("lgate"), "{}", lgate.message);
    let ring = refuse("ring_world_1", json!({ "place": "body", "body": 584 }));
    assert!(ring.message.contains("ring world"), "{}", ring.message);
    let unknown = refuse("no_such_structure", free);
    assert!(
        unknown.message.contains("no_such_structure"),
        "{}",
        unknown.message
    );
}
