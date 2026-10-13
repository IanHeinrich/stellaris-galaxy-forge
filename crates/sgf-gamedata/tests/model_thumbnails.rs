//! Model thumbnails: a pixel cap and a camera tilt named in the key, baked from the meshes
//! `model_sprites` writes into a hand-written install.

use crate::common;

use crate::model_sprites::{boxes, close, sprite};
use image::RgbaImage;

#[test]
fn a_pixel_cap_in_the_key_bakes_no_larger_and_keeps_the_placement() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let long = |image: &RgbaImage| image.width().max(image.height());
    let (full, placement) = sprite(&gd, &textures, "model:mammalian_01:pair_entity");
    let (capped, at) = sprite(&gd, &textures, "model:mammalian_01:pair_entity:px64");
    assert!(long(&full) > 64, "{:?}", full.dimensions());
    assert!(long(&capped) <= 64, "{:?}", capped.dimensions());
    assert!(close(at.width, placement.width, 0.03), "{at:?}");
    assert!(close(at.height, placement.height, 0.03), "{at:?}");
    assert!((at.anchor_x - placement.anchor_x).abs() < 0.02, "{at:?}");
    assert!((at.anchor_y - placement.anchor_y).abs() < 0.02, "{at:?}");

    let (wide, _) = sprite(&gd, &textures, "model:mammalian_01:pair_entity:px4096");
    assert_eq!(wide.dimensions(), full.dimensions(), "a cap above the size");
}

#[test]
fn a_tilt_in_the_key_shows_more_of_a_thin_model_brighter_and_none_keeps_the_maps_look() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (map, at_map) = sprite(&gd, &textures, "model:mammalian_01:wall_entity");
    let (tilted, at_tilted) = sprite(&gd, &textures, "model:mammalian_01:wall_entity:tilt60");
    // The wall's 0.6 units of height seen at 15° and at 60°, its 0.02 of thickness at the
    // cosine, and the margin, 1% of its 4 units across, above and below.
    assert!(close(at_map.height, 0.255, 0.05), "{at_map:?}");
    assert!(close(at_tilted.height, 0.61, 0.05), "{at_tilted:?}");
    assert!(close(at_tilted.width, at_map.width, 1e-3), "{at_tilted:?}");
    let opaque = |image: &RgbaImage| image.pixels().filter(|p| p.0[3] == 255).count();
    assert!(
        opaque(&tilted) > 2 * opaque(&map),
        "{} against {}",
        opaque(&tilted),
        opaque(&map)
    );

    let (fifteen, at_fifteen) = sprite(&gd, &textures, "model:mammalian_01:wall_entity:tilt15");
    assert_eq!(at_fifteen, at_map, "the map's tilt is 15°");
    let light = |image: &RgbaImage| {
        image
            .pixels()
            .filter(|p| p.0[3] == 255)
            .map(|p| u32::from(p.0[0]))
            .sum::<u32>()
    };
    assert!(
        light(&fifteen) > light(&map) * 11 / 10,
        "a thumbnail is drawn brighter"
    );
}
