//! The real install's planets that bake into something other than a lit disc: flat
//! habitats and ring worlds, a tomb world's mesh map and worlds broken apart.

use crate::common;
use crate::planet_discs::assert_disc;

use std::fs;

use image::RgbaImage;
use sgf_gamedata::GameData;

/// A tomb world's entity names no surface map; its `.mesh` stores the material that does. A
/// model whose surface a star's shader draws has no planet surface, so its class is flat.
#[test]
fn an_entity_with_no_surface_settings_bakes_the_map_its_mesh_names() {
    let mut mesh = b"@@b@[object\0[[atmosphere_geosphereShape\0[[[mesh\0".to_vec();
    mesh.extend_from_slice(b"[[[[material\0!\x04diffs\x01\0\0\0\x09\0\0\0haze.dds\0");
    mesh.extend_from_slice(b"[[planet_geosphereShape\0[[[mesh\0!\x01pf\x00\0\0\0");
    mesh.extend_from_slice(b"[[[[material\0!\x06shaders\x01\0\0\0\x0e\0\0\0PdxMeshPlanet\0");
    mesh.extend_from_slice(b"!\x04diffs\x01\0\0\0\x0e\0\0\0tomb_surf.dds\0");
    let (_dir, gd) = common::hand_written_bytes(&[
        (
            "common/planet_classes/00_tomb.txt",
            b"pc_tomb = {\n\tentity = \"tomb_planet\"\n}\npc_hollow = {\n\tentity = \"hollow_planet\"\n}\n"
                .to_vec(),
        ),
        (
            "gfx/models/planets/_tomb.asset",
            b"entity = {\n\tname = \"tomb_planet_01_entity\"\n\tpdxmesh = \"tomb_mesh\"\n}\nentity = {\n\tname = \"hollow_planet_01_entity\"\n\tpdxmesh = \"hollow_mesh\"\n}\n"
                .to_vec(),
        ),
        (
            "gfx/models/planets/_tomb.gfx",
            b"objectTypes = {\n\tpdxmesh = {\n\t\tname = \"tomb_mesh\"\n\t\tfile = \"gfx/models/planets/tomb.mesh\"\n\t}\n\tpdxmesh = {\n\t\tname = \"hollow_mesh\"\n\t\tfile = \"gfx/models/planets/hollow.mesh\"\n\t}\n}\n"
                .to_vec(),
        ),
        ("gfx/models/planets/tomb.mesh", mesh),
        (
            "gfx/models/planets/hollow.mesh",
            [
                b"@@b@[object\0[[planet_geosphereShape\0[[[mesh\0".as_slice(),
                b"[[[[material\0!\x06shaders\x01\0\0\0\x0c\0\0\0PdxMeshStar\0",
                b"!\x04diffs\x01\0\0\0\x0e\0\0\0tomb_surf.dds\0",
            ]
            .concat(),
        ),
        (
            "gfx/models/planets/tomb_surf.dds",
            fs::read(common::fixture("planet_disc_diffuse.dds")).expect("the fixture map"),
        ),
    ]);
    assert_disc(&common::bake_disc(&gd, "planet_disc:pc_tomb"), 50.0);
    let views = gd.planet_class_views();
    let flat = |key: &str| views.iter().find(|v| v.key == key).expect(key).flat_art;
    assert_eq!(flat("pc_tomb"), None);
    assert_eq!(flat("pc_hollow"), Some(true));
}

#[test]
fn the_installs_habitats_and_ring_worlds_are_flat_and_its_tomb_world_a_disc() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.planet_class_views();
    let flat: Vec<&str> = views
        .iter()
        .filter(|v| v.flat_art == Some(true))
        .map(|v| v.key.as_str())
        .collect();
    for key in [
        "pc_habitat",
        "pc_habitat_shielded",
        "pc_crystal_habitat",
        "pc_warden_guardian",
        "pc_cosmogenesis_world",
        "pc_ringworld_habitable",
        "pc_ringworld_habitable_damaged",
        "pc_ringworld_tech",
        "pc_ringworld_tech_damaged",
        "pc_ringworld_seam",
        "pc_ringworld_seam_damaged",
        "pc_shattered_ring_habitable",
        "pc_ringworld_shielded",
        "pc_cybrex",
        "pc_broken",
    ] {
        assert!(flat.contains(&key), "{key}");
    }
    for key in [
        "pc_continental",
        "pc_gas_giant",
        "pc_nuked",
        "pc_asteroid",
        "pc_a_star",
    ] {
        assert!(!flat.contains(&key), "{key}");
    }
    assert_disc(&common::bake_disc(gd, "planet_disc:pc_nuked"), 15.0);
}

/// The share of a disc's pixels within 0.7 of its radius that show through.
fn gaps(image: &RgbaImage) -> f64 {
    let centre = f64::from(image.width()) / 2.0;
    let inside: Vec<u8> = image
        .enumerate_pixels()
        .filter(|(x, y, _)| {
            let (dx, dy) = (f64::from(*x) + 0.5 - centre, f64::from(*y) + 0.5 - centre);
            dx.hypot(dy) < 0.7 * centre
        })
        .map(|(_, _, px)| px.0[3])
        .collect();
    inside.iter().filter(|a| **a < 128).count() as f64 / inside.len() as f64
}

/// A shattered disc: the size of any other, with transparent corners, still lit from the left,
/// with gaps between its shards inside the planet's radius, and the same every time for a seed.
fn assert_shattered(gd: &GameData, class: &str) {
    let disc = common::bake_disc(gd, &format!("planet_disc_shattered:{class}:7"));
    let (opaque, left, right) = assert_disc(&disc, 15.0);
    let gaps = gaps(&disc);
    eprintln!(
        "{class} shattered: {opaque} opaque, left {left:.1}, right {right:.1}, gaps {gaps:.3}"
    );
    assert!(gaps > 0.03, "{class}: the shards part, {gaps:.3}");
    assert!(
        opaque > 128 * 128 / 8,
        "{class}: most of the planet is still there"
    );
    assert_eq!(
        disc,
        common::bake_disc(gd, &format!("planet_disc_shattered:{class}:7")),
        "{class}: the same seed breaks the same way"
    );
    assert_ne!(
        disc,
        common::bake_disc(gd, &format!("planet_disc_shattered:{class}:8")),
        "{class}: another seed breaks another way"
    );
}

/// A model that is a planet in pieces, whose pieces' map its `.mesh` stores or its `.asset`
/// names, is drawn broken apart and not flat. Its class has no whole disc, and a class that is
/// not in pieces has no shattered one.
#[test]
fn a_model_in_pieces_bakes_into_a_shattered_disc() {
    let pieces = [
        b"@@b@[object\0[[triSphere1Shape\0[[[mesh\0".as_slice(),
        b"[[[[material\0!\x06shaders\x01\0\0\0\x15\0\0\0PdxMeshAlphaAdditive\0",
        b"[[pieceShape1\0[[[mesh\0",
        b"[[[[material\0!\x06shaders\x01\0\0\0\x0e\0\0\0PdxMeshPlanet\0",
        b"!\x04diffs\x01\0\0\0\x11\0\0\0cracked_surf.dds\0",
    ]
    .concat();
    let map = fs::read(common::fixture("planet_disc_diffuse.dds")).expect("the fixture map");
    let (_dir, gd) = common::hand_written_bytes(&[
        (
            "common/planet_classes/00_cracked.txt",
            b"pc_cracked = {\n\tentity = \"cracked_planet\"\n}\npc_egg = {\n\tentity = \"egg_planet\"\n}\npc_whole = {\n\tentity = \"whole_planet\"\n}\n"
                .to_vec(),
        ),
        (
            "gfx/models/planets/_cracked.asset",
            b"entity = {\n\tname = \"cracked_planet_01_entity\"\n\tpdxmesh = \"cracked_mesh\"\n}\nentity = {\n\tname = \"egg_planet_01_entity\"\n\tpdxmesh = \"cracked_mesh\"\n\tmeshsettings = {\n\t\tname = \"pieceShape1\"\n\t\ttexture_diffuse = \"egg_surf.dds\"\n\t}\n}\nentity = {\n\tname = \"whole_planet_01_entity\"\n\tmeshsettings = {\n\t\tname = \"planet_geosphereShape\"\n\t\ttexture_diffuse = \"cracked_surf.dds\"\n\t}\n}\n"
                .to_vec(),
        ),
        (
            "gfx/models/planets/_cracked.gfx",
            b"objectTypes = {\n\tpdxmesh = {\n\t\tname = \"cracked_mesh\"\n\t\tfile = \"gfx/models/planets/cracked.mesh\"\n\t}\n}\n"
                .to_vec(),
        ),
        ("gfx/models/planets/cracked.mesh", pieces),
        ("gfx/models/planets/cracked_surf.dds", map.clone()),
        ("gfx/models/planets/egg_surf.dds", map),
    ]);
    let views = gd.planet_class_views();
    let view = |key: &str| views.iter().find(|v| v.key == key).expect(key);
    for key in ["pc_cracked", "pc_egg"] {
        assert_eq!(view(key).shattered, Some(true), "{key}");
        assert_eq!(view(key).flat_art, None, "{key}");
    }
    assert_eq!(view("pc_whole").shattered, None);

    assert_shattered(&gd, "pc_cracked");
    assert_shattered(&gd, "pc_egg");
    let whole = common::bake_disc(&gd, "planet_disc:pc_whole");
    assert_eq!(gaps(&whole), 0.0, "a whole disc has no gaps");

    let (_cache, textures) = common::temp_textures();
    for key in [
        "planet_disc:pc_cracked",
        "planet_model:cracked_planet_01_entity",
        "planet_disc_shattered:pc_whole:7",
        "planet_disc_shattered:pc_nowhere:7",
    ] {
        let view = gd.texture(&textures, key);
        assert!(view.png_base64.is_none(), "{key}");
        assert!(view.error.is_some(), "{key}");
    }
}

#[test]
fn the_installs_shattered_worlds_bake_broken_apart() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.planet_class_views();
    let view = |key: &str| views.iter().find(|v| v.key == key).expect(key);
    for key in ["pc_shattered", "pc_shattered_2", "pc_egg_cracked"] {
        assert_eq!(view(key).shattered, Some(true), "{key}");
        assert_eq!(view(key).flat_art, None, "{key}");
    }
    for key in ["pc_continental", "pc_barren", "pc_broken", "pc_habitat"] {
        assert_eq!(view(key).shattered, None, "{key}");
    }
    assert_shattered(gd, "pc_shattered");
}
