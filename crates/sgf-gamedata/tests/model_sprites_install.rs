//! The install's megastructure and starport models baked to sprites, and with
//! `SGF_PLAYSET=1` a Gigastructural Engineering model at the largest size.

use base64::prelude::*;
use sgf_gamedata::GameData;
use sgf_gamedata::textures::Textures;

use crate::common;
use crate::model_sprites::{clear_share_within, close, sprite};

/// Each model and its size along save x, save y and height in save units.
const INSTALL_MODELS: [(&str, [f64; 3]); 3] = [
    ("thinktank_phase_03_entity", [13.5, 36.1, 10.7]),
    ("dyson_sphere_phase_05_entity", [38.2, 38.2, 37.2]),
    ("starbase_starport_section_entity", [2.7, 1.8, 2.25]),
];

#[test]
fn the_installs_megastructures_and_starport_have_their_game_sizes() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (_cache, textures) = common::temp_textures();
    for (entity, expected) in INSTALL_MODELS {
        let key = format!("model:mammalian_01:{entity}");
        let size = gd
            .model_bounds(&key)
            .unwrap_or_else(|e| panic!("{key}: {e}"))
            .size();
        for k in 0..3 {
            assert!(close(size[k], expected[k], 0.04), "{key}: {size:?}");
        }
    }

    let nexus = gd.texture(&textures, "model:mammalian_01:thinktank_phase_03_entity");
    let placement = nexus.model.expect("the Nexus bakes");
    assert!(close(placement.width, 14.27, 0.02), "{placement:?}");
    assert!(close(placement.height, 36.52, 0.02), "{placement:?}");
    assert!((placement.anchor_x - 0.5).abs() < 0.01, "{placement:?}");
    assert!((placement.anchor_y - 0.5).abs() < 0.01, "{placement:?}");
    let png = BASE64_STANDARD
        .decode(nexus.png_base64.expect("a PNG"))
        .expect("base64");
    let image = image::load_from_memory(&png)
        .expect("it decodes")
        .to_rgba8();
    // 36 units long, it covers about 1460 pixels at the closest zoom.
    let nexus_side = image.width().max(image.height());
    assert!((1300..2048).contains(&nexus_side), "{nexus_side}");
    let starport = "model:mammalian_01:starbase_starport_section_entity";
    assert_eq!(
        long_side(gd, &textures, starport),
        256,
        "a model under 3 units across keeps the least size"
    );
    let opaque: Vec<[u8; 4]> = image
        .pixels()
        .map(|p| p.0)
        .filter(|p| p[3] == 255)
        .collect();
    let distinct = opaque
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len();
    let spread = |p: &[u8; 4]| p[..3].iter().max().unwrap() - p[..3].iter().min().unwrap();
    let coloured = opaque.iter().filter(|p| spread(p) > 20).count();
    // Without its diffuse map the model is one grey, lit: at most 256 colours.
    assert!(
        distinct > 1000,
        "the diffuse map was found and decoded: {distinct} colours"
    );
    assert!(
        coloured > 0,
        "the normal and specular maps were found and decoded"
    );

    let key = "model:mammalian_01:arc_crucible_stage_4_entity";
    let (furnace, placement) = sprite(gd, &textures, key);
    // Its hub stands over the planet's pole, so the planet shows between the spokes.
    let clear = clear_share_within(&furnace, &placement, 0.4);
    assert!(
        clear > 0.5,
        "the Arc Furnace leaves its planet clear: {clear}"
    );

    let missing = gd.texture(&textures, "model:mammalian_01:no_such_megastructure_entity");
    assert!(missing.png_base64.is_none());
    assert!(
        missing
            .error
            .is_some_and(|e| e.contains("no_such_megastructure_entity"))
    );
}

/// The longer side of the sprite `key` bakes to, in pixels.
fn long_side(gd: &GameData, textures: &Textures, key: &str) -> u32 {
    let (image, _) = sprite(gd, textures, key);
    image.width().max(image.height())
}

/// Gigastructural Engineering's Hyperstructural Assembly Yard, 157 units across, is baked at
/// the largest size. Runs with `SGF_PLAYSET=1` when the enabled mods include Giga.
#[test]
fn a_system_sized_model_bakes_at_the_largest_sprite_size() {
    let Some(gd) = common::giga() else {
        return;
    };
    let key = "model:mammalian_01:giga_shipyard_full_entity";
    let (_cache, textures) = common::temp_textures();
    assert_eq!(long_side(gd, &textures, key), 2048);
}
