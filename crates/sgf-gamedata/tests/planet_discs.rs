//! Planet classes baked into lit discs through the texture cache: the fixture's map in a
//! hand-written install first, then the real install's `pc_continental` when this machine
//! has one (skipped with a message otherwise).

use crate::common;

use std::fs;

use image::RgbaImage;
use sgf_gamedata::GameData;
use tempfile::TempDir;

const CLASSES: &str = "pc_painted = {
\tentity = \"painted_planet\"
\ticon = GFX_planet_type_painted
\ticon_large = GFX_planet_type_painted_big
\tatmosphere_color = hsv { 0.59 0.45 0.95 }
\tatmosphere_intensity = 1.0
\tatmosphere_width = 0.5
}
pc_bare = {
\tentity = \"bare_planet\"
}
pc_broken = {
\tentity = \"broken_planet\"
}
pc_painted_star = {
\tentity = \"painted_planet\"
\tstar = yes
}
pc_painted_rock = {
\tentity = \"painted_planet\"
\tasteroid = yes
}
pc_painted_ring = {
	entity = \"painted_planet\"
	ringworld = yes
}
pc_painted_dwarf = {
\tentity = \"painted_planet\"
\tstar = yes
\tstar_gfx = no
}
";

/// The surface is the `planet_geosphereShape` mesh; the clouds' map is missing, so a disc
/// baked from it would fail.
const ENTITIES: &str = "entity = {
\tname = \"painted_planet_01_entity\"
\tpdxmesh = \"planet_clouded_mesh\"
\tmeshsettings = {
\t\tname = \"clouds_geosphereShape\"
\t\ttexture_diffuse = \"clouds_diffuse.dds\"
\t}
\tmeshsettings = {
\t\tname = \"planet_geosphereShape\"
\t\ttexture_diffuse = \"painted_diffuse.dds\"
\t}
}
entity = {
\tname = \"bare_planet_01_entity\"
\tpdxmesh = \"bare_mesh\"
}
entity = { name = \"broken_planet_01_entity\" meshsettings = { name = \"planet_geosphereShape\" texture_diffuse = \"broken_diffuse.dds\" } }
";

/// The fixture's two checker colours.
const WARM: [u8; 3] = [200, 120, 60];
const COOL: [u8; 3] = [60, 120, 200];

fn painted() -> (TempDir, GameData) {
    let (dir, gd) = common::hand_written(&[
        ("common/planet_classes/00_painted.txt", CLASSES),
        ("gfx/models/planets/_planetary_entities.asset", ENTITIES),
        ("gfx/models/planets/broken_diffuse.dds", "not a texture"),
        (
            "localisation/english/fx_l_english.yml",
            "l_english:
",
        ),
    ]);
    fs::copy(
        common::fixture("planet_disc_diffuse.dds"),
        dir.path()
            .join("install/gfx/models/planets/painted_diffuse.dds"),
    )
    .expect("the fixture map");
    (dir, gd)
}

/// How many pixels are opaque, and the mean brightness of those in the left and the right
/// half.
fn halves(image: &RgbaImage) -> (usize, f64, f64) {
    let mut sums = [(0.0, 0usize); 2];
    let mut opaque = 0;
    for (x, _, px) in image.enumerate_pixels() {
        if px.0[3] < 255 {
            continue;
        }
        opaque += 1;
        let half = usize::from(x >= image.width() / 2);
        let brightness = px.0[..3].iter().map(|c| f64::from(*c)).sum::<f64>() / 3.0;
        sums[half].0 += brightness;
        sums[half].1 += 1;
    }
    let mean = |(sum, n): (f64, usize)| sum / n.max(1) as f64;
    (opaque, mean(sums[0]), mean(sums[1]))
}

/// A 128 pixel disc with transparent corners, whose left half is brighter than its right by
/// at least `margin`.
pub fn assert_disc(image: &RgbaImage, margin: f64) -> (usize, f64, f64) {
    assert_eq!(image.dimensions(), (128, 128));
    for (x, y) in [(0, 0), (127, 0), (0, 127), (127, 127)] {
        assert_eq!(image.get_pixel(x, y).0, [0; 4], "corner ({x},{y})");
    }
    let (opaque, left, right) = halves(image);
    assert!(
        left > right + margin,
        "the light comes from the left: {left:.1} vs {right:.1}"
    );
    (opaque, left, right)
}

#[test]
fn the_fixture_map_bakes_into_a_disc_lit_from_the_left() {
    let (_dir, gd) = painted();
    let disc = common::bake_disc(&gd, "planet_disc:pc_painted");
    let (opaque, left, right) = assert_disc(&disc, 50.0);
    eprintln!("fixture disc: {opaque} opaque, left {left:.1}, right {right:.1}");
    let hue = |colour: [u8; 3]| {
        disc.enumerate_pixels()
            .filter(|(x, _, px)| *x < 64 && px.0[3] == 255 && px.0[0] > 40)
            .any(|(_, _, px)| {
                let scale = f64::from(px.0[1]) / f64::from(colour[1]);
                px.0[..3]
                    .iter()
                    .zip(colour)
                    .all(|(c, want)| (f64::from(*c) - f64::from(want) * scale).abs() <= 4.0)
            })
    };
    assert!(
        hue(WARM) && hue(COOL),
        "both checker colours show in the lit half"
    );

    let (_cache, textures) = common::temp_textures();
    let view = gd.texture(&textures, "planet_disc:pc_painted");
    assert_eq!((view.width, view.height), (128, 128), "{:?}", view.error);
}

/// These keep the tinted disc: an entity with no map, a map that does not decode, a star, an
/// asteroid and a class the install does not define.
#[test]
fn a_class_with_no_readable_map_or_no_planet_surface_has_no_disc() {
    let (_dir, gd) = painted();
    let (_cache, textures) = common::temp_textures();
    for class in [
        "pc_bare",
        "pc_broken",
        "pc_painted_star",
        "pc_painted_rock",
        "pc_nowhere",
    ] {
        let view = gd.texture(&textures, &format!("planet_disc:{class}"));
        assert!(view.png_base64.is_none(), "{class}");
        assert!(view.error.is_some(), "{class}");
    }
    let broken = gd.texture(&textures, "planet_disc:pc_broken");
    assert!(
        broken
            .error
            .as_deref()
            .is_some_and(|e| e.ends_with("not a DDS file")),
        "{broken:?}"
    );
}

/// A model bakes from the map its entity names, as a class does; a model with no map, one whose
/// map does not decode and one the install does not define have no disc.
#[test]
fn a_planet_model_bakes_from_its_own_entity() {
    let (_dir, gd) = painted();
    let disc = common::bake_disc(&gd, "planet_model:painted_planet_01_entity");
    assert_disc(&disc, 50.0);
    let (_cache, textures) = common::temp_textures();
    for entity in [
        "bare_planet_01_entity",
        "broken_planet_01_entity",
        "nowhere_01_entity",
    ] {
        let view = gd.texture(&textures, &format!("planet_model:{entity}"));
        assert!(view.png_base64.is_none(), "{entity}");
        assert!(view.error.is_some(), "{entity}");
    }
}

#[test]
fn the_class_view_passes_its_atmosphere_and_big_icon() {
    let (_dir, gd) = painted();
    let views = gd.planet_class_views();
    let painted = views
        .iter()
        .find(|v| v.key == "pc_painted")
        .expect("pc_painted");
    assert_eq!(
        painted.icon_large_sprite.as_deref(),
        Some("GFX_planet_type_painted_big")
    );
    assert_eq!(painted.atmosphere_color.as_deref(), Some("#85b7f2"));
    assert_eq!(painted.atmosphere_intensity, Some(1.0));
    assert_eq!(painted.atmosphere_width, Some(0.5));
    let bare = views.iter().find(|v| v.key == "pc_bare").expect("pc_bare");
    assert_eq!(bare.icon_large_sprite, None);
    assert_eq!(bare.atmosphere_color, None);
    assert_eq!(bare.atmosphere_intensity, None);
    assert_eq!(bare.atmosphere_width, None);
    assert_eq!(bare.flat_art, None, "its model is in no .gfx file");
    assert_eq!(painted.flat_art, None);
    assert_eq!(painted.asteroid, None);
    assert_eq!(painted.draws_as_planet, None);
    let rock = views
        .iter()
        .find(|v| v.key == "pc_painted_rock")
        .expect("pc_painted_rock");
    assert_eq!(rock.asteroid, Some(true));
    assert_eq!(rock.draws_as_planet, None);
    assert_eq!(rock.ringworld, None);
    assert_eq!(rock.flat_art, None);
    let ring = views
        .iter()
        .find(|v| v.key == "pc_painted_ring")
        .expect("pc_painted_ring");
    assert_eq!(ring.ringworld, Some(true));
    assert_eq!(ring.asteroid, None);
    let dwarf = views
        .iter()
        .find(|v| v.key == "pc_painted_dwarf")
        .expect("pc_painted_dwarf");
    assert_eq!(dwarf.asteroid, None);
    assert_eq!(dwarf.draws_as_planet, Some(true));
}

/// A duplicate `texture_diffuse` (or `name`) inside a `.asset` file reads the last one, unlike
/// a class's own scalar fields (`Def::scalar`, first wins): the first name here names a file
/// that does not exist, so a disc only bakes if the last one, which does, is the one read.
#[test]
fn a_duplicate_asset_key_reads_the_last_one() {
    let (_dir, gd) = common::hand_written_bytes(&[
        (
            "common/planet_classes/00_dup.txt",
            b"pc_duped = {\n\tentity = \"duped_planet\"\n}\n".to_vec(),
        ),
        (
            "gfx/models/planets/_duped.asset",
            b"entity = {\n\tname = \"duped_planet_01_entity\"\n\tmeshsettings = {\n\t\tname = \"planet_geosphereShape\"\n\t\ttexture_diffuse = \"missing.dds\"\n\t\ttexture_diffuse = \"duped_diffuse.dds\"\n\t}\n}\n"
                .to_vec(),
        ),
        (
            "gfx/models/planets/duped_diffuse.dds",
            fs::read(common::fixture("planet_disc_diffuse.dds")).expect("the fixture map"),
        ),
    ]);
    let disc = common::bake_disc(&gd, "planet_disc:pc_duped");
    assert_eq!(disc.dimensions(), (128, 128));
}

#[test]
fn the_installs_continental_world_bakes_into_a_disc() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let started = std::time::Instant::now();
    let disc = common::bake_disc(gd, "planet_disc:pc_continental");
    let cold = started.elapsed();
    let (opaque, left, right) = assert_disc(&disc, 15.0);
    eprintln!(
        "pc_continental: {}x{}, {opaque} opaque, left {left:.1}, right {right:.1}, in {cold:.2?}",
        disc.width(),
        disc.height()
    );
    let continental = gd
        .planet_class_views()
        .into_iter()
        .find(|v| v.key == "pc_continental")
        .expect("pc_continental");
    assert_eq!(
        continental.icon_large_sprite.as_deref(),
        Some("GFX_planet_type_continental_big")
    );
    assert!(continental.atmosphere_color.is_some());
    assert!(continental.atmosphere_width.is_some());
}

#[test]
fn the_installs_ocean_paradise_model_bakes_into_a_disc() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let disc = common::bake_disc(gd, "planet_model:ocean_paradise_planet_01_entity");
    assert_disc(&disc, 15.0);
    assert_ne!(
        disc,
        common::bake_disc(gd, "planet_disc:pc_ocean"),
        "the model's map, not its class's"
    );
}

#[test]
fn the_installs_ring_world_segments_are_marked() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.planet_class_views();
    let continental = views
        .iter()
        .find(|v| v.key == "pc_continental")
        .expect("pc_continental");
    assert_eq!(continental.ringworld, None);
    for key in [
        "pc_ringworld_habitable",
        "pc_ringworld_habitable_damaged",
        "pc_ringworld_seam",
        "pc_ringworld_tech",
        "pc_shattered_ring_habitable",
        "pc_ringworld_shielded",
    ] {
        let class = views.iter().find(|v| v.key == key).expect(key);
        assert_eq!(class.ringworld, Some(true), "{key}");
    }
}
