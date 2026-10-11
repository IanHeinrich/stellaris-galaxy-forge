//! How large the system view draws a planet or star of each class, from the real install
//! when this machine has one (skipped otherwise).

use crate::common;

use sgf_gamedata::GameData;

fn disc_scale(gd: &GameData, class: &str) -> Option<f64> {
    gd.planet_class_views()
        .into_iter()
        .find(|view| view.key == class)
        .unwrap_or_else(|| panic!("{class}"))
        .disc_scale
}

#[test]
fn vanilla_classes_are_drawn_at_their_in_game_size() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let radius = |class: &str, size: f64| {
        disc_scale(gd, class).unwrap_or_else(|| panic!("{class} has a disc scale")) * size
    };
    for (class, size, expected) in [
        ("pc_continental", 16.0, 2.87),
        ("pc_gas_giant", 25.0, 6.85),
        ("pc_m_star", 24.0, 7.82),
        ("pc_m_giant_star", 21.0, 13.69),
    ] {
        let drawn = radius(class, size);
        assert!(
            (drawn - expected).abs() < 0.01,
            "{class} of size {size} is drawn at {drawn}, not {expected}"
        );
    }
    for class in [
        "pc_asteroid",
        "pc_shattered",
        "pc_habitat",
        "pc_ringworld_habitable",
    ] {
        assert_eq!(disc_scale(gd, class), None, "{class}");
    }
}
