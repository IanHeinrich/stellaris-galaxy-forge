//! A mod that spreads systems out with `NCamera.SYSTEM_SPACE_SCALE_MULT` leaves the save's
//! orbits where they are, so every body and model is drawn smaller against them.

use crate::common;
use crate::model_sprites::{boxes_with, close};

use sgf_gamedata::textures::{ModelBounds, ModelPlacement};
use sgf_gamedata::views::GameDataSummary;

const CLASSES: &str = "pc_test = {
\tentity = \"test_planet\"
\tentity_scale = 10
}
";

const PLANETS: &str = "entity = {
\tname = \"test_planet_01_entity\"
\tscale = 2
}
";

const PAIR: &str = "model:mammalian_01:pair_entity";

struct Drawn {
    body_scale: f64,
    disc_scale: f64,
    placement: ModelPlacement,
    bounds: ModelBounds,
}

fn drawn(defines: &[(&str, &str)]) -> Drawn {
    let mut files = vec![
        ("common/planet_classes/01_test.txt", CLASSES),
        ("gfx/models/planets/test.asset", PLANETS),
    ];
    files.extend(defines);
    let (_dir, gd) = boxes_with(&files);
    let (_cache, textures) = common::temp_textures();
    let view = gd.texture(&textures, PAIR);
    assert_eq!(view.error, None);
    Drawn {
        body_scale: GameDataSummary::from(&gd).border.body_scale,
        disc_scale: gd
            .planet_class_views()
            .into_iter()
            .find(|view| view.key == "pc_test")
            .and_then(|view| view.disc_scale)
            .expect("pc_test has a disc scale"),
        placement: view.model.expect("a model sprite holds its placement"),
        bounds: gd.model_bounds(PAIR).expect("the pair resolves"),
    }
}

#[test]
fn a_wider_system_space_draws_bodies_and_models_smaller_against_their_orbits() {
    let vanilla = drawn(&[]);
    assert_eq!(vanilla.body_scale, 1.0);
    assert!(
        close(vanilla.disc_scale, 0.0163 * 10.0 * 2.0, 1e-9),
        "{}",
        vanilla.disc_scale
    );
    assert!(close(vanilla.placement.width, 4.08, 0.02));

    // Real Space - System Scale writes 60, six times vanilla's 10; a later file wins.
    let wide = drawn(&[
        (
            "common/defines/00_defines.txt",
            "NCamera = { SYSTEM_SPACE_SCALE_MULT = 10.0 }\n",
        ),
        (
            "common/defines/zz_systemscale.txt",
            "NCamera = { SYSTEM_SPACE_SCALE_MULT = 60.0 }\n",
        ),
    ]);
    let sixth = |actual: f64, of: f64| close(actual, of / 6.0, 1e-9);
    assert!(
        close(wide.body_scale, 1.0 / 6.0, 1e-9),
        "{}",
        wide.body_scale
    );
    assert!(
        sixth(wide.disc_scale, vanilla.disc_scale),
        "{}",
        wide.disc_scale
    );
    let (p, v) = (wide.placement, vanilla.placement);
    assert!(sixth(p.width, v.width), "{p:?}");
    assert!(sixth(p.height, v.height), "{p:?}");
    assert_eq!((p.anchor_x, p.anchor_y), (v.anchor_x, v.anchor_y));
    for k in 0..3 {
        assert!(
            sixth(wide.bounds.min[k], vanilla.bounds.min[k]),
            "{:?}",
            wide.bounds
        );
        assert!(
            sixth(wide.bounds.max[k], vanilla.bounds.max[k]),
            "{:?}",
            wide.bounds
        );
    }
}

#[test]
fn a_space_scale_of_zero_or_less_keeps_vanillas() {
    for written in ["0", "-60"] {
        let (_dir, gd) = common::hand_written(&[(
            "common/defines/00_defines.txt",
            &format!("NCamera = {{ SYSTEM_SPACE_SCALE_MULT = {written} }}"),
        )]);
        assert_eq!(gd.border.body_scale, 1.0, "{written}");
    }
}
