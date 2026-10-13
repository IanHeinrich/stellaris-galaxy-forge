//! Adding the habitat a Habitat Central Complex becomes to a body of the real 4.5 sample
//! save, end to end.
use serde_json::json;
use sgf_app_lib::views::Added;
use sgf_core::entity::{EntityAddr, EntityKind};
use sgf_core::views::{EditResult, ErrorKind};

use crate::common;
use common::{SAMPLE_45, invoke, open, webview, with_game_data};

fn complex(body: u32) -> serde_json::Value {
    json!({ "system": 169, "body": body, "kind": "habitat_central_complex" })
}

#[test]
fn adding_a_habitat_needs_game_data() {
    let w = webview();
    open(&w, SAMPLE_45);
    let refused = invoke::<Added>(&w, "add_habitat", complex(4)).expect_err("refused");
    assert_eq!(refused.kind, ErrorKind::Op);
    assert!(refused.message.contains("game data"), "{}", refused.message);
}

/// Round barren planet 4 of Alari, owned by country 0, the habitat takes dead planet slot 57
/// one generation on and is drawn in the owner's culture. Round the star it stands twice as
/// far out, and the restored complex adds its orbital too. Undo takes the second away again.
#[test]
fn a_habitat_is_added_round_a_planet_and_a_star_and_undone() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let added: Added = invoke(&w, "add_habitat", complex(4)).expect("round planet 4");
    let id = 57 | 1 << 24;
    assert_eq!(added.planets, [id]);
    assert_eq!(
        added.edit.entry.description,
        format!("Added habitat Alari system #{id} round planet #4 in Alari system #169")
    );
    assert!(
        added
            .edit
            .touched_entities
            .contains(&EntityAddr::new(EntityKind::Planet, id)),
        "{:?}",
        added.edit.touched_entities
    );
    assert_eq!(added.edit.details_stale, [169]);

    let round_star: Added = invoke(
        &w,
        "add_habitat",
        json!({ "system": 169, "body": 0, "kind": "habitat_central_complex_restored" }),
    )
    .expect("round the star");
    assert!(
        round_star
            .edit
            .entry
            .description
            .ends_with(", with orbital #16"),
        "{}",
        round_star.edit.entry.description
    );
    let undone: EditResult = invoke(&w, "undo", json!({})).expect("undo");
    assert_eq!(undone.history.undo.len(), 1);
    assert_ne!(round_star.planets[0], added.planets[0]);
    assert_eq!(round_star.megastructures, [16], "the orbital");
}

#[test]
fn a_type_that_is_no_habitat_and_a_moon_are_refused() {
    let Some((w, _)) = with_game_data(SAMPLE_45) else {
        return;
    };
    let ruin = invoke::<Added>(
        &w,
        "add_habitat",
        json!({ "system": 169, "body": 4, "kind": "habitat_central_complex_ruined" }),
    )
    .expect_err("the ruin");
    assert!(
        ruin.message.contains("not finished as a habitat"),
        "{}",
        ruin.message
    );
    let moon = invoke::<Added>(&w, "add_habitat", complex(3)).expect_err("moon 3");
    assert!(moon.message.contains("orbits planet 2"), "{}", moon.message);
}
