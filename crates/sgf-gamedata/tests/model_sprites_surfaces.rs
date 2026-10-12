//! How a baked model's surfaces are drawn: faces wound away from the camera, glass and other
//! see-through or added shaders, parts scaled inside out, and alpha-tested surfaces.

use crate::common;

use crate::model_sprites::{boxes, sprite};
use image::RgbaImage;
use sgf_gamedata::textures::ModelPlacement;

/// The pixel the model's origin falls on.
fn pixel_at_origin(image: &RgbaImage, placement: &ModelPlacement) -> [u8; 4] {
    let x = (placement.anchor_x * f64::from(image.width())) as u32;
    let y = (placement.anchor_y * f64::from(image.height())) as u32;
    image.get_pixel(x, y).0
}

#[test]
fn faces_wound_away_from_the_camera_are_not_drawn() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (hollow, placement) = sprite(&gd, &textures, "model:mammalian_01:hollow_entity");
    let [r, _, b, a] = pixel_at_origin(&hollow, &placement);
    assert_eq!(a, 255);
    assert!(
        r > b + 100,
        "the near side of the inside-out sphere is culled, so the red box shows: {r} red, {b} blue"
    );
    assert!(
        hollow.pixels().any(|p| p.0[2] > p.0[0] + 100),
        "the far side faces the camera and is drawn round the box"
    );
}

#[test]
fn glass_is_blended_over_what_is_behind_it_in_the_empire_colour() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (glass, placement) = sprite(&gd, &textures, "model:mammalian_01:glass_entity");
    let [r, g, b, a] = pixel_at_origin(&glass, &placement);
    assert_eq!(a, 255, "the box behind the glass is opaque");
    assert!(
        r > g + 40,
        "the red box shows through the white glass: {r} {g} {b}"
    );
    assert!(
        b > g + 40,
        "the ship shader tints the glass its mask marks in the empire colour: {r} {g} {b}"
    );
    assert!(
        glass.pixels().any(|p| (100..=160).contains(&p.0[3])),
        "glass with nothing behind it is half clear"
    );
}

#[test]
fn see_through_surfaces_are_laid_on_farthest_first() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (nested, placement) = sprite(&gd, &textures, "model:mammalian_01:nested_entity");
    let [r, g, _, _] = pixel_at_origin(&nested, &placement);
    assert!(
        g > r + 40,
        "the outer green cloud lies over the inner red one: {r} red, {g} green"
    );
}

#[test]
fn a_double_sided_shader_draws_faces_wound_away_from_the_camera() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (sided, placement) = sprite(&gd, &textures, "model:mammalian_01:sided_entity");
    let [r, _, b, a] = pixel_at_origin(&sided, &placement);
    assert_eq!(a, 255);
    assert!(
        b > r + 100,
        "the near side of the inside-out sphere is drawn over the red box: {r} red, {b} blue"
    );
}

#[test]
fn an_added_shell_brightens_what_is_behind_it_without_the_empire_colour() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (added, placement) = sprite(&gd, &textures, "model:mammalian_01:added_entity");
    let [r, g, b, a] = pixel_at_origin(&added, &placement);
    assert_eq!(a, 255);
    assert!(
        r > g + 40 && g > 60,
        "the grey shell is added onto the red box: {r} {g} {b}"
    );
    assert!(
        g.abs_diff(b) < 8,
        "the standard shader leaves the mask alone: {r} {g} {b}"
    );
}

#[test]
fn a_part_scaled_inside_out_still_shows_its_outside() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (mirrored, placement) = sprite(&gd, &textures, "model:mammalian_01:mirrored_entity");
    let [r, _, b, a] = pixel_at_origin(&mirrored, &placement);
    assert_eq!(a, 255);
    assert!(
        b > r + 100,
        "the negative scale reverses the winding, so the sphere's near side hides the box: \
         {r} red, {b} blue"
    );
}

#[test]
fn an_alpha_tested_surface_is_not_drawn_where_its_alpha_is_below_one() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let (tested, placement) = sprite(&gd, &textures, "model:mammalian_01:tested_entity");
    let [r, _, b, a] = pixel_at_origin(&tested, &placement);
    assert_eq!(a, 255);
    assert!(
        r > b + 100,
        "the blue sphere at alpha 254 is clipped, so the red box shows: {r} red, {b} blue"
    );
    assert!(
        tested.pixels().all(|p| p.0[3] == 0 || p.0[0] > p.0[2]),
        "nothing of the sphere is drawn"
    );
}
