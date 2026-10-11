//! Models baked into sprites through the texture cache: a box mesh the test writes into a
//! hand-written install first, then the real install's megastructures and starbases when
//! this machine has one (skipped with a message otherwise).

use crate::common;

use base64::prelude::*;
use sgf_gamedata::GameData;
use tempfile::TempDir;

/// A box assembly: the box at the root and again at a locator 30 world units along model Z.
const ENTITIES: &str = "@box_scale = 1
entity = {
\tname = \"mammalian_01_box_entity\"
\tpdxmesh = \"box_mesh\"
\tscale = @box_scale
}
entity = {
\tname = \"mammalian_01_pair_entity\"
\tlocator = { name = \"side\" position = { 0 0 30 } }
\tattach = { \"root\" = \"mammalian_01_box_entity\" }
\tattach = { side = \"mammalian_01_box_entity\" }
}
entity = {
\tname = \"mammalian_01_broken_entity\"
\tpdxmesh = \"broken_mesh\"
}
entity = {
\tname = \"mammalian_01_patched_entity\"
\tattach = { \"root\" = \"mammalian_01_box_entity\" }
\tattach = { \"root\" = \"mammalian_01_broken_entity\" }
}
entity = {
\tname = \"mammalian_01_glow_entity\"
\tpdxmesh = \"box_mesh\"
\tmeshsettings = { name = \"boxShape\" index = 0 shader = \"PdxMeshAlphaAdditive\" }
}
";

const MESHES: &str = "objectTypes = {
\tpdxmesh = { name = \"box_mesh\" file = \"gfx/models/test/box.mesh\" }
\tpdxmesh = { name = \"broken_mesh\" file = \"gfx/models/test/broken.mesh\" }
}
";

/// A box 40 world units along model X, 6 along Y and 10 along Z, centred on the origin.
fn box_mesh() -> Vec<u8> {
    let (x, y, z) = (20.0f32, 3.0f32, 5.0f32);
    let corners: Vec<f32> = (0..8)
        .flat_map(|i| {
            let pick = |bit: u32, v: f32| if i & bit == 0 { -v } else { v };
            [pick(1, x), pick(2, y), pick(4, z)]
        })
        .collect();
    let faces: [[i32; 4]; 6] = [
        [0, 1, 3, 2],
        [4, 6, 7, 5],
        [0, 4, 5, 1],
        [2, 3, 7, 6],
        [0, 2, 6, 4],
        [1, 5, 7, 3],
    ];
    let tri: Vec<i32> = faces
        .iter()
        .flat_map(|[a, b, c, d]| [*a, *b, *c, *a, *c, *d])
        .collect();
    let normals: Vec<f32> = (0..8).flat_map(|_| [0.0, 1.0, 0.0]).collect();
    let uvs: Vec<f32> = (0..8).flat_map(|_| [0.5, 0.5]).collect();

    let mut mesh = b"@@b@".to_vec();
    let object = |mesh: &mut Vec<u8>, depth: usize, name: &str| {
        mesh.extend(std::iter::repeat_n(b'[', depth));
        mesh.extend(name.as_bytes());
        mesh.push(0);
    };
    let header = |mesh: &mut Vec<u8>, name: &str, kind: u8, count: usize| {
        mesh.push(b'!');
        mesh.push(name.len() as u8);
        mesh.extend(name.as_bytes());
        mesh.push(kind);
        mesh.extend((count as u32).to_le_bytes());
    };
    let floats = |mesh: &mut Vec<u8>, name: &str, values: &[f32]| {
        header(mesh, name, b'f', values.len());
        mesh.extend(values.iter().flat_map(|v| v.to_le_bytes()));
    };
    object(&mut mesh, 1, "object");
    object(&mut mesh, 2, "boxShape");
    object(&mut mesh, 3, "mesh");
    floats(&mut mesh, "p", &corners);
    floats(&mut mesh, "n", &normals);
    floats(&mut mesh, "u0", &uvs);
    header(&mut mesh, "tri", b'i', tri.len());
    mesh.extend(tri.iter().flat_map(|v| v.to_le_bytes()));
    object(&mut mesh, 4, "material");
    header(&mut mesh, "shader", b's', 1);
    mesh.extend(16u32.to_le_bytes());
    mesh.extend(b"PdxMeshStandard\0");
    mesh
}

fn boxes() -> (TempDir, GameData) {
    common::hand_written_bytes(&[
        ("gfx/models/test/box.asset", ENTITIES.as_bytes().to_vec()),
        ("gfx/models/test/box.gfx", MESHES.as_bytes().to_vec()),
        ("gfx/models/test/box.mesh", box_mesh()),
        ("gfx/models/test/broken.mesh", b"@@b@[[[".to_vec()),
        ("common/planet_classes/00_none.txt", Vec::new()),
    ])
}

fn close(actual: f64, expected: f64, share: f64) -> bool {
    (actual - expected).abs() <= expected.abs() * share
}

#[test]
fn a_box_assembly_bakes_at_its_size_with_model_x_along_save_y() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let key = "model:avian_01:pair_entity";

    let bounds = gd.model_bounds(&textures, key).expect("the pair resolves");
    let expected = ([-0.5, -2.0, -0.3], [3.5, 2.0, 0.3]);
    for k in 0..3 {
        assert!(close(bounds.min[k], expected.0[k], 1e-4), "{bounds:?}");
        assert!(close(bounds.max[k], expected.1[k], 1e-4), "{bounds:?}");
    }

    let view = gd.texture(&textures, key);
    assert_eq!(view.error, None);
    let placement = view.model.expect("a model sprite holds its placement");
    // Screen-right is −save x, so the origin sits towards the right of a box assembly that
    // reaches 3.5 units along +save x and 0.5 along −save x. Height is the 4 units of save y
    // foreshortened by the 41.4° tilt, plus the box's 0.6 height seen at that tilt.
    assert!(close(placement.width, 4.08, 0.02), "{placement:?}");
    assert!(close(placement.height, 3.47, 0.02), "{placement:?}");
    assert!((placement.anchor_x - 0.868).abs() < 0.01, "{placement:?}");
    assert!((placement.anchor_y - 0.5).abs() < 0.01, "{placement:?}");
    assert!(view.width.max(view.height) >= 250);
    let png = gd.texture_png(&textures, key).expect("a PNG");
    let image = image::load_from_memory(&png)
        .expect("it decodes")
        .to_rgba8();
    assert!(image.pixels().any(|p| p.0[3] == 255));
    assert!(image.pixels().any(|p| p.0[3] == 0));

    let cached = gd.texture(&textures, key);
    assert_eq!(
        cached.model,
        Some(placement),
        "the cache keeps the placement"
    );
}

#[test]
fn a_model_that_cannot_be_drawn_is_a_miss_not_a_panic() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    for key in [
        "model:mammalian_01:no_such_entity",
        "model:mammalian_01:glow_entity",
        "model:mammalian_01:broken_entity",
        "model:mammalian_01",
    ] {
        let view = gd.texture(&textures, key);
        assert!(view.png_base64.is_none(), "{key}");
        assert!(view.error.is_some(), "{key}");
        assert!(view.model.is_none(), "{key}");
        assert!(gd.model_bounds(&textures, key).is_err(), "{key}");
    }
    let broken = gd.texture(&textures, "model:mammalian_01:broken_entity");
    let error = broken.error.expect("the broken mesh is the miss");
    assert!(
        error.starts_with("gfx/models/test/broken.mesh: "),
        "{error}"
    );

    let patched = "model:mammalian_01:patched_entity";
    let size = gd
        .model_bounds(&textures, patched)
        .expect("the box still draws")
        .size();
    assert!(close(size[1], 4.0, 1e-4), "{size:?}");
    assert!(gd.texture(&textures, patched).model.is_some());

    let plain = gd.texture(&textures, "planet_ring");
    assert!(plain.model.is_none());
}

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
            .model_bounds(&textures, &key)
            .unwrap_or_else(|e| panic!("{key}: {e}"))
            .size();
        for k in 0..3 {
            assert!(close(size[k], expected[k], 0.04), "{key}: {size:?}");
        }
    }

    let nexus = gd.texture(&textures, "model:mammalian_01:thinktank_phase_03_entity");
    let placement = nexus.model.expect("the Nexus bakes");
    assert!(close(placement.width, 14.07, 0.02), "{placement:?}");
    assert!(close(placement.height, 30.01, 0.02), "{placement:?}");
    assert!((placement.anchor_x - 0.5).abs() < 0.01, "{placement:?}");
    assert!((placement.anchor_y - 0.5).abs() < 0.01, "{placement:?}");
    let png = BASE64_STANDARD
        .decode(nexus.png_base64.expect("a PNG"))
        .expect("base64");
    let image = image::load_from_memory(&png)
        .expect("it decodes")
        .to_rgba8();
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

    let missing = gd.texture(&textures, "model:mammalian_01:no_such_megastructure_entity");
    assert!(missing.png_base64.is_none());
    assert!(
        missing
            .error
            .is_some_and(|e| e.contains("no_such_megastructure_entity"))
    );
}
