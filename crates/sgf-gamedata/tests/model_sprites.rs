//! Models baked into sprites through the texture cache, from meshes the tests write into a
//! hand-written install. `model_sprites_install` bakes the real install's.

use crate::common;

use image::RgbaImage;
use sgf_gamedata::GameData;
use sgf_gamedata::textures::{ModelPlacement, Textures};
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
\tname = \"box_entity\"
\tpdxmesh = \"box_mesh\"
\tscale = 3
}
entity = {
\tname = \"fallen_empire_01_box_entity\"
\tpdxmesh = \"box_mesh\"
\tscale = 2
}
entity = {
\tname = \"mammalian_01_glow_entity\"
\tpdxmesh = \"box_mesh\"
\tmeshsettings = { name = \"boxShape\" index = 0 shader = \"PdxMeshAlphaAdditive\" }
}
entity = {
\tname = \"mammalian_01_furnace_entity\"
\tpdxmesh = \"furnace_mesh\"
}
entity = {
\tname = \"mammalian_01_ball_entity\"
\tpdxmesh = \"ball_mesh\"
}
entity = {
\tname = \"mammalian_01_moon_entity\"
\tlocator = { name = \"side\" position = { 0 0 30 } }
\tattach = { side = \"mammalian_01_ball_entity\" }
}
entity = {
\tname = \"mammalian_01_hollow_entity\"
\tpdxmesh = \"hollow_mesh\"
}
entity = {
\tname = \"mammalian_01_glass_entity\"
\tpdxmesh = \"glass_mesh\"
}
entity = {
\tname = \"mammalian_01_nested_entity\"
\tpdxmesh = \"nested_mesh\"
}
entity = {
\tname = \"mammalian_01_sided_entity\"
\tpdxmesh = \"sided_mesh\"
}
entity = {
\tname = \"mammalian_01_added_entity\"
\tpdxmesh = \"added_mesh\"
}
entity = {
\tname = \"mammalian_01_tested_entity\"
\tpdxmesh = \"tested_mesh\"
}
entity = {
\tname = \"mammalian_01_mirrored_entity\"
\tpdxmesh = \"mirrored_mesh\"
\tscale = -1
}
";

/// Two cultures that fall back in a chain to `mammalian_01`, and two that fall back to each
/// other.
const CULTURES: &str = "fallen_empire_01 = { fallback = mammalian_01 }
fallen_empire_02 = { fallback = fallen_empire_01 }
loop_a = { fallback = loop_b }
loop_b = { fallback = loop_a }
";

const MESHES: &str = "objectTypes = {
\tpdxmesh = { name = \"box_mesh\" file = \"gfx/models/test/box.mesh\" }
\tpdxmesh = { name = \"broken_mesh\" file = \"gfx/models/test/broken.mesh\" }
\tpdxmesh = { name = \"furnace_mesh\" file = \"gfx/models/test/furnace.mesh\" }
\tpdxmesh = { name = \"ball_mesh\" file = \"gfx/models/test/ball.mesh\" }
\tpdxmesh = { name = \"hollow_mesh\" file = \"gfx/models/test/hollow.mesh\" }
\tpdxmesh = {
\t\tname = \"glass_mesh\"
\t\tfile = \"gfx/models/test/glass.mesh\"
\t\tmeshsettings = { name = \"glassShape\" index = 1 texture_specular = \"mask.dds\" }
\t}
\tpdxmesh = { name = \"nested_mesh\" file = \"gfx/models/test/nested.mesh\" }
\tpdxmesh = { name = \"sided_mesh\" file = \"gfx/models/test/sided.mesh\" }
\tpdxmesh = {
\t\tname = \"added_mesh\"
\t\tfile = \"gfx/models/test/added.mesh\"
\t\tmeshsettings = { name = \"addedShape\" index = 1 texture_specular = \"mask.dds\" }
\t}
\tpdxmesh = { name = \"tested_mesh\" file = \"gfx/models/test/tested.mesh\" }
\tpdxmesh = { name = \"mirrored_mesh\" file = \"gfx/models/test/mirrored.mesh\" }
}
";

/// One mesh of a shape the test writes: its vertices, triangles, shader and diffuse map.
struct MeshData {
    positions: Vec<[f32; 3]>,
    triangles: Vec<[i32; 3]>,
    shader: &'static str,
    diffuse: Option<&'static str>,
}

/// A box `2x` world units along model X, `2y` along Y and `2z` along Z, centred on the origin,
/// its faces wound counter-clockwise seen from outside, as the game's meshes are.
fn cuboid(x: f32, y: f32, z: f32) -> MeshData {
    let positions = (0..8)
        .map(|i| {
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
    MeshData {
        positions,
        triangles: faces
            .iter()
            .flat_map(|[a, b, c, d]| [[*a, *c, *b], [*a, *d, *c]])
            .collect(),
        shader: "PdxMeshStandard",
        diffuse: None,
    }
}

/// A sphere of `radius` world units about the origin, wound as [`cuboid`] is.
fn sphere(radius: f32, shader: &'static str, diffuse: Option<&'static str>) -> MeshData {
    const RINGS: i32 = 12;
    const SEGMENTS: i32 = 24;
    let mut positions = Vec::new();
    for ring in 0..=RINGS {
        let (sin_t, cos_t) = (std::f32::consts::PI * ring as f32 / RINGS as f32).sin_cos();
        for segment in 0..SEGMENTS {
            let (sin_p, cos_p) =
                (std::f32::consts::TAU * segment as f32 / SEGMENTS as f32).sin_cos();
            positions.push([
                radius * sin_t * cos_p,
                radius * cos_t,
                radius * sin_t * sin_p,
            ]);
        }
    }
    let at = |ring: i32, segment: i32| ring * SEGMENTS + segment.rem_euclid(SEGMENTS);
    let triangles = (0..RINGS)
        .flat_map(|ring| {
            (0..SEGMENTS).flat_map(move |s| {
                [
                    [at(ring, s), at(ring + 1, s + 1), at(ring + 1, s)],
                    [at(ring, s), at(ring, s + 1), at(ring + 1, s + 1)],
                ]
            })
        })
        .collect();
    MeshData {
        positions,
        triangles,
        shader,
        diffuse,
    }
}

/// A binary `.mesh` file of `shapes`, each a name and its meshes.
fn mesh_file(shapes: &[(&str, Vec<MeshData>)]) -> Vec<u8> {
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
    let text = |mesh: &mut Vec<u8>, name: &str, value: &str| {
        header(mesh, name, b's', 1);
        mesh.extend((value.len() as u32 + 1).to_le_bytes());
        mesh.extend(value.as_bytes());
        mesh.push(0);
    };
    object(&mut mesh, 1, "object");
    for (name, meshes) in shapes {
        object(&mut mesh, 2, name);
        for data in meshes {
            let count = data.positions.len();
            object(&mut mesh, 3, "mesh");
            floats(&mut mesh, "p", data.positions.as_flattened());
            floats(&mut mesh, "n", &[0.0, 1.0, 0.0].repeat(count));
            floats(&mut mesh, "u0", &[0.5, 0.5].repeat(count));
            let tri = data.triangles.as_flattened();
            header(&mut mesh, "tri", b'i', tri.len());
            mesh.extend(tri.iter().flat_map(|v| v.to_le_bytes()));
            object(&mut mesh, 4, "material");
            text(&mut mesh, "shader", data.shader);
            if let Some(diffuse) = data.diffuse {
                text(&mut mesh, "diff", diffuse);
            }
        }
    }
    mesh
}

/// A box 40 world units along model X, 6 along Y and 10 along Z, centred on the origin.
fn box_mesh() -> Vec<u8> {
    mesh_file(&[("boxShape", vec![cuboid(20.0, 3.0, 5.0)])])
}

/// A planet's texture, kept where the game keeps them.
const LAVA: &str = "gfx/models/planets/lava_diffuse.dds";

/// A ball 16 world units across, textured as a planet.
fn ball() -> MeshData {
    sphere(8.0, "PdxMeshShipDiffuseEmissive", Some("lava_diffuse.dds"))
}

/// A bar 40 world units along model X through a planet at the origin, in an atmosphere.
fn furnace_mesh() -> Vec<u8> {
    mesh_file(&[
        ("furnaceShape", vec![cuboid(20.0, 1.0, 1.0), ball()]),
        (
            "atmosphereShape",
            vec![sphere(15.0, "PdxMeshAtmosphere", None)],
        ),
    ])
}

/// `mesh` with each triangle wound the other way, so its faces point inwards.
fn inside_out(mesh: MeshData) -> MeshData {
    MeshData {
        triangles: mesh
            .triangles
            .iter()
            .map(|[a, b, c]| [*a, *c, *b])
            .collect(),
        ..mesh
    }
}

/// A red box 6 world units across, opaque.
fn red_box() -> MeshData {
    MeshData {
        diffuse: Some("red.dds"),
        ..cuboid(3.0, 3.0, 3.0)
    }
}

/// A red box in a blue sphere 30 world units across whose faces point inwards.
fn hollow_mesh() -> Vec<u8> {
    let shell = inside_out(sphere(15.0, "PdxMeshShip", Some("blue.dds")));
    mesh_file(&[("hollowShape", vec![red_box(), shell])])
}

/// A red box in a sphere 30 world units across of white glass at half alpha, which its
/// specular map marks for the empire colour.
fn glass_mesh() -> Vec<u8> {
    let glass = sphere(15.0, "AlphaBlendNoDepth", Some("glass.dds"));
    mesh_file(&[("glassShape", vec![red_box(), glass])])
}

/// A green cloud 30 world units across round a red one 20 across, each at half alpha, the
/// outer one first in the file.
fn nested_mesh() -> Vec<u8> {
    let outer = sphere(15.0, "PdxMeshClouds", Some("green_half.dds"));
    let inner = sphere(10.0, "PdxMeshClouds", Some("red_half.dds"));
    mesh_file(&[("nestedShape", vec![outer, inner])])
}

/// A red box in a blue sphere whose faces point inwards, drawn with a shader that shows both
/// faces.
fn sided_mesh() -> Vec<u8> {
    let shell = inside_out(sphere(
        15.0,
        "PdxMeshExtraDimensionalShip",
        Some("blue.dds"),
    ));
    mesh_file(&[("sidedShape", vec![red_box(), shell])])
}

/// A red box in a grey shell that adds its colour, which its specular map marks for the
/// empire colour.
fn added_mesh() -> Vec<u8> {
    let shell = sphere(15.0, "OmniMeshMegaAlpha", Some("grey.dds"));
    mesh_file(&[("addedShape", vec![red_box(), shell])])
}

/// A red box in a blue sphere, both wound outwards, for an entity that scales them by −1.
fn mirrored_mesh() -> Vec<u8> {
    let shell = sphere(15.0, "PdxMeshShip", Some("blue.dds"));
    mesh_file(&[("mirroredShape", vec![red_box(), shell])])
}

/// A red box in a blue sphere alpha-tested at a diffuse alpha below 1.
fn tested_mesh() -> Vec<u8> {
    let shell = sphere(15.0, "PdxMeshAlphaBlend", Some("blue_faint.dds"));
    mesh_file(&[("testedShape", vec![red_box(), shell])])
}

/// A 4×4 texture of one colour.
fn solid(texel: [u8; 4]) -> Vec<u8> {
    common::dds(4, &[vec![texel; 16]])
}

fn boxes() -> (TempDir, GameData) {
    common::hand_written_bytes(&[
        ("gfx/models/test/box.asset", ENTITIES.as_bytes().to_vec()),
        ("gfx/models/test/box.gfx", MESHES.as_bytes().to_vec()),
        ("gfx/models/test/box.mesh", box_mesh()),
        ("gfx/models/test/furnace.mesh", furnace_mesh()),
        (
            "gfx/models/test/ball.mesh",
            mesh_file(&[("ballShape", vec![ball()])]),
        ),
        (LAVA, b"not a texture".to_vec()),
        ("gfx/models/test/broken.mesh", b"@@b@[[[".to_vec()),
        ("gfx/models/test/hollow.mesh", hollow_mesh()),
        ("gfx/models/test/glass.mesh", glass_mesh()),
        ("gfx/models/test/red.dds", solid([255, 0, 0, 255])),
        ("gfx/models/test/blue.dds", solid([0, 0, 255, 255])),
        ("gfx/models/test/glass.dds", solid([255, 255, 255, 128])),
        ("gfx/models/test/mask.dds", solid([255, 0, 0, 255])),
        ("gfx/models/test/nested.mesh", nested_mesh()),
        ("gfx/models/test/sided.mesh", sided_mesh()),
        ("gfx/models/test/added.mesh", added_mesh()),
        ("gfx/models/test/tested.mesh", tested_mesh()),
        ("gfx/models/test/mirrored.mesh", mirrored_mesh()),
        ("gfx/models/test/green_half.dds", solid([0, 255, 0, 128])),
        ("gfx/models/test/red_half.dds", solid([255, 0, 0, 128])),
        ("gfx/models/test/grey.dds", solid([128, 128, 128, 255])),
        ("gfx/models/test/blue_faint.dds", solid([0, 0, 255, 254])),
        ("common/planet_classes/00_none.txt", Vec::new()),
        (
            "common/graphical_culture/00_cultures.txt",
            CULTURES.as_bytes().to_vec(),
        ),
    ])
}

pub(crate) fn close(actual: f64, expected: f64, share: f64) -> bool {
    (actual - expected).abs() <= expected.abs() * share
}

#[test]
fn a_box_assembly_bakes_at_its_size_with_model_x_along_save_y() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let key = "model:avian_01:pair_entity";

    let bounds = gd.model_bounds(key).expect("the pair resolves");
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
    // foreshortened by the 15° tilt, plus the box's 0.6 height seen at that tilt.
    assert!(close(placement.width, 4.08, 0.02), "{placement:?}");
    assert!(close(placement.height, 4.10, 0.02), "{placement:?}");
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
        assert!(gd.model_bounds(key).is_err(), "{key}");
    }
    let broken = gd.texture(&textures, "model:mammalian_01:broken_entity");
    let error = broken.error.expect("the broken mesh is the miss");
    assert!(
        error.starts_with("gfx/models/test/broken.mesh: "),
        "{error}"
    );

    let patched = "model:mammalian_01:patched_entity";
    let size = gd
        .model_bounds(patched)
        .expect("the box still draws")
        .size();
    assert!(close(size[1], 4.0, 1e-4), "{size:?}");
    assert!(gd.texture(&textures, patched).model.is_some());

    let plain = gd.texture(&textures, "planet_ring");
    assert!(plain.model.is_none());
}

#[test]
fn a_culture_without_a_model_of_its_own_draws_its_fallbacks() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let long = |culture: &str| {
        let key = format!("model:{culture}:box_entity");
        let size = gd
            .model_bounds(&key)
            .unwrap_or_else(|e| panic!("{key}: {e}"))
            .size();
        size[1]
    };
    assert!(close(long("mammalian_01"), 4.0, 1e-4));
    assert!(close(long("fallen_empire_01"), 8.0, 1e-4));
    assert!(
        close(long("fallen_empire_02"), 8.0, 1e-4),
        "fallen_empire_02 falls back to fallen_empire_01's box"
    );
    assert!(
        close(long("loop_a"), 4.0, 1e-4),
        "a chain that loops ends at mammalian_01"
    );
    assert!(
        close(long("none"), 12.0, 1e-4),
        "what no empire owns draws the bare entity"
    );
    assert!(
        gd.model_bounds("model:none:pair_entity").is_ok(),
        "what no empire owns draws mammalian_01's model where there is no bare entity"
    );
    assert!(
        close(long("avian_01"), 4.0, 1e-4),
        "a culture with no box of its own draws mammalian_01's before the bare one"
    );

    let width = |culture: &str| {
        let view = gd.texture(&textures, &format!("model:{culture}:box_entity"));
        view.model.expect("the box bakes").width
    };
    let (fallen, avian) = (width("fallen_empire_02"), width("avian_01"));
    assert!(close(fallen, 2.0 * avian, 0.02));
}

/// A model sprite and its placement.
pub(crate) fn sprite(gd: &GameData, textures: &Textures, key: &str) -> (RgbaImage, ModelPlacement) {
    let view = gd.texture(textures, key);
    assert_eq!(view.error, None, "{key}");
    let placement = view.model.expect("a model sprite holds its placement");
    let png = gd.texture_png(textures, key).expect("a PNG");
    let image = image::load_from_memory(&png)
        .expect("it decodes")
        .to_rgba8();
    (image, placement)
}

/// The alpha of the pixel the model's origin falls on.
fn alpha_at_origin(image: &RgbaImage, placement: &ModelPlacement) -> u8 {
    let x = (placement.anchor_x * f64::from(image.width())) as u32;
    let y = (placement.anchor_y * f64::from(image.height())) as u32;
    image.get_pixel(x, y).0[3]
}

/// The share of the pixels within `radius` save units of the model's origin that are clear.
pub(crate) fn clear_share_within(
    image: &RgbaImage,
    placement: &ModelPlacement,
    radius: f64,
) -> f64 {
    let per_unit = f64::from(image.width()) / placement.width;
    let origin_x = placement.anchor_x * f64::from(image.width());
    let origin_y = placement.anchor_y * f64::from(image.height());
    let (mut inside, mut clear) = (0u32, 0u32);
    for (x, y, pixel) in image.enumerate_pixels() {
        let dx = f64::from(x) + 0.5 - origin_x;
        let dy = f64::from(y) + 0.5 - origin_y;
        if dx.hypot(dy) < radius * per_unit {
            inside += 1;
            clear += u32::from(pixel.0[3] == 0);
        }
    }
    f64::from(clear) / f64::from(inside.max(1))
}

#[test]
fn a_planet_a_model_is_built_round_is_left_clear_and_its_atmosphere_is_not_drawn() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();

    let (furnace, placement) = sprite(&gd, &textures, "model:mammalian_01:furnace_entity");
    assert_eq!(
        alpha_at_origin(&furnace, &placement),
        0,
        "the planet hides the bar behind it and is left clear"
    );
    assert!(
        furnace.pixels().any(|p| p.0[3] == 255),
        "the bar beyond the planet is drawn"
    );
    // The planet is 1.6 units across and the atmosphere 3.
    assert!(placement.width < 2.0, "{placement:?}");

    let (alone, _) = sprite(&gd, &textures, "model:mammalian_01:ball_entity");
    assert!(alone.pixels().all(|p| p.0[3] == 0));

    let (moon, _) = sprite(&gd, &textures, "model:mammalian_01:moon_entity");
    assert!(
        moon.pixels().any(|p| p.0[3] == 255),
        "a ball away from the model's origin is drawn"
    );
}

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

#[test]
fn a_yaw_in_the_key_turns_the_model_about_its_up_axis() {
    let (_dir, gd) = boxes();
    let (_cache, textures) = common::temp_textures();
    let size = |key: &str| {
        gd.model_bounds(key)
            .unwrap_or_else(|e| panic!("{key}: {e}"))
            .size()
    };
    let straight = size("model:mammalian_01:box_entity");
    let turned = size("model:mammalian_01:box_entity:yaw90");
    assert!(
        close(straight[0], 1.0, 1e-4) && close(straight[1], 4.0, 1e-4),
        "{straight:?}"
    );
    assert!(
        close(turned[0], 4.0, 1e-4) && close(turned[1], 1.0, 1e-4),
        "{turned:?}"
    );
    assert_eq!(size("model:mammalian_01:box_entity:yaw450"), turned);

    let bounds = gd
        .model_bounds("model:mammalian_01:pair_entity:yaw90")
        .expect("the pair");
    assert!(
        close(bounds.min[1], -3.5, 1e-4) && close(bounds.max[1], 0.5, 1e-4),
        "a quarter turn takes model Z, +save x, to model X, −save y: {bounds:?}"
    );

    let view = gd.texture(&textures, "model:mammalian_01:box_entity:yaw90");
    let placement = view.model.expect("the turned box bakes");
    assert!(close(placement.width, 4.08, 0.02), "{placement:?}");
    for bad in [
        "model:mammalian_01:box_entity:spin90",
        "model:mammalian_01:box_entity:yaw",
    ] {
        assert!(gd.model_bounds(bad).is_err(), "{bad}");
    }
}

#[test]
fn a_ring_world_quadrant_turns_its_side_pieces_to_face_its_star() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let key = "model:mammalian_01:ringworld_3x_seams_entity";
    let size = gd
        .model_bounds(key)
        .unwrap_or_else(|e| panic!("{key}: {e}"))
        .size();
    // Three pieces of a ring 90 units across, the side ones a 30° turn either way round it,
    // so the quadrant bows towards the star.
    assert!(close(size[0], 13.8, 0.03), "{size:?}");
}
