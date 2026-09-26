//! Textures through the public API: the fixture install's own sprites
//! first, then the real install when this machine has one (skipped with a
//! message otherwise).

use crate::common;

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use image::{DynamicImage, GenericImageView, Rgba};
use sgf_gamedata::install::layers::Layout;
use sgf_gamedata::textures::{SpriteSource, TextureError, TextureKey, Textures, no_planet_entity};

fn no_colour(_: &str) -> Option<[u8; 3]> {
    None
}

fn decode(
    textures: &Textures,
    layout: &Layout,
    sprites: &dyn SpriteSource,
    key: &str,
) -> DynamicImage {
    let png = textures
        .png(layout, sprites, &no_colour, &no_planet_entity, key)
        .unwrap_or_else(|e| panic!("{key}: {e}"));
    image::load_from_memory(&png).expect("valid PNG")
}

#[test]
fn keys_round_trip_and_bad_ones_are_rejected() {
    for key in [
        "star_class:g_star",
        "deposit:d_bubbling_swamp",
        "deposit:unused/d_strategic_resources",
        "icon:planet_modifiers/pm_drilling_for_gas.dds",
        "icon:traditions/tree_icons/x.dds",
        "flag:zoological/flag_zoological_5.dds",
        "symbol:zoological/flag_zoological_5.dds",
        "sprite:GFX_planet_type",
        "sprite:GFX_planet_type#4",
        "empire_flag:00_solid.dds:human/flag_human_9.dds:blue,black,null,null",
        "planet_disc:pc_continental",
    ] {
        let parsed: TextureKey = key.parse().unwrap_or_else(|e| panic!("{key}: {e}"));
        assert_eq!(parsed.to_string(), key);
    }
    for bad in [
        "",
        "g_star",
        "star_class:",
        "star_class:../secret",
        "star_class:a/b",
        "deposit:",
        "deposit:a/b/c",
        "deposit:../secret",
        "deposit:unused/..",
        "deposit:./x",
        "deposit:/abs",
        "deposit:C:/x",
        "deposit:a\\b",
        "icon:../x.dds",
        "icon:planet_modifiers/pm_x",
        "icon:a//b.dds",
        "deposit:.. /x",
        "deposit:.. ./x",
        "deposit:.../x",
        "deposit:unused./x",
        "deposit:unused /x",
        "deposit:x.",
        "icon:.. /x.dds",
        "icon: /x.dds",
        "flag:nocategory",
        "sprite:GFX_x#0",
        "sprite:GFX_x#four",
        "empire_flag:bg.dds:human/x.dds:blue,black",
        "planet:pc_desert",
        "planet_disc:",
        "planet_disc:pc/x",
        "planet_disc:..",
    ] {
        assert!(
            matches!(bad.parse::<TextureKey>(), Err(TextureError::BadKey(_))),
            "{bad:?} should be a bad key"
        );
    }
}

#[test]
fn uncompressed_bgra_decodes_with_channels_in_rgba_order() {
    let gd = common::cached_fixture();
    let (_dir, textures) = common::temp_textures();
    let image = decode(
        &textures,
        &gd.layout,
        gd.sprites.as_ref(),
        "sprite:GFX_fixture_bgra",
    );
    assert_eq!(image.dimensions(), (4, 4));
    for y in 0..4u8 {
        for x in 0..4u8 {
            let expected = Rgba([10 + 50 * x, 10 + 50 * y, 123, 255 - 10 * x]);
            assert_eq!(image.get_pixel(x.into(), y.into()), expected, "({x},{y})");
        }
    }
}

#[test]
fn dxt1_solid_block_decodes_to_its_colour() {
    let gd = common::cached_fixture();
    let (_dir, textures) = common::temp_textures();
    let image = decode(
        &textures,
        &gd.layout,
        gd.sprites.as_ref(),
        "sprite:GFX_fixture_dxt1",
    );
    assert_eq!(image.dimensions(), (4, 4));
    assert!(image.pixels().all(|(_, _, p)| p == Rgba([255, 0, 0, 255])));
}

#[test]
fn a_frame_crops_its_slice_of_the_strip() {
    let gd = common::cached_fixture();
    let (_dir, textures) = common::temp_textures();
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let whole = decode(&textures, layout, sprites, "sprite:GFX_fixture_strip");
    assert_eq!(whole.dimensions(), (8, 4));
    let first = decode(&textures, layout, sprites, "sprite:GFX_fixture_strip#1");
    assert_eq!(first.dimensions(), (4, 4));
    assert!(
        first
            .pixels()
            .all(|(_, _, p)| p == Rgba([20, 40, 200, 255]))
    );
    let second = decode(&textures, layout, sprites, "sprite:GFX_fixture_strip#2");
    assert_eq!(second.dimensions(), (4, 4));
    assert!(
        second
            .pixels()
            .all(|(_, _, p)| p == Rgba([200, 40, 20, 255]))
    );
    let third = textures.png(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "sprite:GFX_fixture_strip#3",
    );
    assert!(
        matches!(
            third,
            Err(TextureError::BadFrame {
                frame: 3,
                count: 2,
                ..
            })
        ),
        "{third:?}"
    );
}

#[test]
fn failures_are_errors_in_the_view_never_panics() {
    let gd = common::cached_fixture();
    let (_dir, textures) = common::temp_textures();
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let cut = textures.load(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "sprite:GFX_fixture_cut",
    );
    assert!(cut.png_base64.is_none());
    assert_eq!((cut.width, cut.height), (0, 0));
    assert!(
        cut.error
            .as_deref()
            .is_some_and(|e| e.contains("truncated")),
        "{cut:?}"
    );

    let bad = textures.load(layout, sprites, &no_colour, &no_planet_entity, "nonsense");
    assert_eq!(bad.error.as_deref(), Some("bad texture key `nonsense`"));

    let missing = textures.load(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "star_class:nowhere",
    );
    assert!(
        missing
            .error
            .as_deref()
            .is_some_and(|e| e.contains("not in any layer")),
        "{missing:?}"
    );

    let unknown = textures.load(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "sprite:GFX_unregistered",
    );
    assert!(
        unknown
            .error
            .as_deref()
            .is_some_and(|e| e.contains("sprite registry")),
        "{unknown:?}"
    );

    // Vanilla ships an icon that is empty and one that is only a byte-order mark.
    for key in ["sprite:GFX_fixture_empty", "sprite:GFX_fixture_bom"] {
        let view = textures.load(layout, sprites, &no_colour, &no_planet_entity, key);
        assert_eq!(
            view.error.as_deref().map(|e| e.ends_with("not a DDS file")),
            Some(true),
            "{view:?}"
        );
    }
}

#[test]
fn second_call_is_served_from_the_cache_file() {
    let gd = common::cached_fixture();
    let (_dir, textures) = common::temp_textures();
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let first = textures
        .png(
            layout,
            sprites,
            &no_colour,
            &no_planet_entity,
            "sprite:GFX_fixture_bgra",
        )
        .unwrap();
    let cached: Vec<PathBuf> = fs::read_dir(textures.cache_dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert_eq!(cached.len(), 1, "{cached:?}");
    assert_eq!(cached[0].extension().unwrap(), "png");
    assert_eq!(fs::read(&cached[0]).unwrap(), first);

    let mutated = b"not a png at all".to_vec();
    fs::write(&cached[0], &mutated).unwrap();
    let second = textures
        .png(
            layout,
            sprites,
            &no_colour,
            &no_planet_entity,
            "sprite:GFX_fixture_bgra",
        )
        .unwrap();
    assert_eq!(second, mutated);
    let view = textures.load(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "sprite:GFX_fixture_bgra",
    );
    assert!(view.error.is_none());
    assert_eq!((view.width, view.height), (0, 0));

    let other = textures
        .png(
            layout,
            sprites,
            &no_colour,
            &no_planet_entity,
            "sprite:GFX_fixture_strip#2",
        )
        .unwrap();
    assert_ne!(other, mutated);
    assert_eq!(fs::read_dir(textures.cache_dir()).unwrap().count(), 2);
}

#[test]
fn install_star_classes_flags_and_sprites_decode() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let (_dir, textures) = common::temp_textures();
    for (key, width, height) in [
        ("star_class:g_star", 128, 128),
        ("star_class:black_hole", 128, 128),
        ("flag:zoological/flag_zoological_5.dds", 128, 128),
        ("symbol:zoological/flag_zoological_5.dds", 128, 128),
        ("sprite:GFX_resource_energy", 18, 18),
        ("sprite:GFX_planet_type#4", 38, 38),
        ("sprite:GFX_planet_type#46", 38, 38),
        ("sprite:GFX_galaxy_point_of_interest_levels", 180, 34),
        ("sprite:GFX_apocalypse_small", 76, 38),
        ("sprite:GFX_additional_content_thumbnail_fallback", 105, 105),
        ("sprite:GFX_council_room_democratic", 1264, 631),
        ("sprite:GFX_vertical_arrow", 72, 20),
    ] {
        let started = Instant::now();
        let image = decode(&textures, layout, sprites, key);
        if key.starts_with("symbol:") {
            let rgba = image.to_rgba8();
            assert!(rgba.pixels().all(|p| p.0[..3] == [255, 255, 255]));
            assert!(rgba.pixels().any(|p| p.0[3] == 0) && rgba.pixels().any(|p| p.0[3] > 0));
        }
        eprintln!(
            "{key}: {}x{} in {:.2?}",
            image.width(),
            image.height(),
            started.elapsed()
        );
        assert_eq!(image.dimensions(), (width, height), "{key}");
        assert!(
            image.pixels().any(|(_, _, p)| p.0[3] > 0),
            "{key} is fully transparent"
        );
    }
    let g_star = decode(&textures, layout, sprites, "star_class:g_star");
    let centre = g_star.get_pixel(64, 64);
    assert!(centre.0[3] > 200 && centre.0[0] > 150, "{centre:?}");

    let (arrow_file, _) = sprites
        .resolve("GFX_vertical_arrow", None)
        .expect("GFX_vertical_arrow is a vanilla sprite");
    assert!(
        !arrow_file.starts_with("gfx/interface/"),
        "{arrow_file} no longer covers a texture outside gfx/interface"
    );
}

#[test]
fn install_second_call_hits_the_cache() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let (_dir, textures) = common::temp_textures();
    let key = "star_class:black_hole";
    let started = Instant::now();
    let first = textures
        .png(layout, sprites, &no_colour, &no_planet_entity, key)
        .unwrap();
    let cold = started.elapsed();
    assert_eq!(fs::read_dir(textures.cache_dir()).unwrap().count(), 1);
    let started = Instant::now();
    let second = textures
        .png(layout, sprites, &no_colour, &no_planet_entity, key)
        .unwrap();
    let warm = started.elapsed();
    eprintln!("{key}: decode {cold:.2?}, cache hit {warm:.2?}");
    assert_eq!(first, second);
    assert_eq!(fs::read_dir(textures.cache_dir()).unwrap().count(), 1);
}

#[test]
fn install_empire_flag_composes() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (layout, sprites) = (&gd.layout, gd.sprites.as_ref());
    let (_dir, textures) = common::temp_textures();
    let colour = |name: &str| match name {
        "blue" => Some([34, 88, 218]),
        "black" => Some([20, 20, 20]),
        _ => None,
    };
    let key = "empire_flag:00_solid.dds:human/flag_human_9.dds:blue,black,null,null";
    let png = textures
        .png(layout, sprites, &colour, &no_planet_entity, key)
        .unwrap_or_else(|e| panic!("{key}: {e}"));
    let image = image::load_from_memory(&png).unwrap();
    assert_eq!(image.dimensions(), (70, 70));
    assert_eq!(image.get_pixel(0, 0).0[3], 0, "corner is outside the mask");
    let bg = image.get_pixel(10, 35);
    assert!(
        bg.0[2] > 120 && bg.0[0] < 80 && bg.0[3] == 255,
        "background not blue: {bg:?}"
    );
    let distinct: std::collections::HashSet<[u8; 4]> =
        image.pixels().map(|(_, _, p)| p.0).collect();
    assert!(
        distinct.len() > 50,
        "only {} distinct pixels",
        distinct.len()
    );

    let unknown = textures.load(
        layout,
        sprites,
        &colour,
        &no_planet_entity,
        "empire_flag:00_solid.dds:human/flag_human_9.dds:mauve,black,null,null",
    );
    assert!(unknown.error.is_none(), "{unknown:?}");
    assert!(
        unknown.width > 0,
        "an unknown colour still composes the flag"
    );
    let hex = textures.load(
        layout,
        sprites,
        &no_colour,
        &no_planet_entity,
        "empire_flag:diagonal.dds:human/flag_human_9.dds:#ff0000,#00ff00,null,null",
    );
    assert!(hex.error.is_none(), "{hex:?}");
}
