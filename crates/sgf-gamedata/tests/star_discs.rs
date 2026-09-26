//! Star planet classes baked into discs through the texture cache: a hand-written install
//! whose lighting classes paint their stars in plain colours first, then every vanilla star
//! class from the real install when this machine has one (skipped with a message otherwise).

use crate::common;

use std::fs;
use std::path::Path;

use image::RgbaImage;
use sgf_gamedata::GameData;
use tempfile::TempDir;

const STAR_CLASSES: &str = "sc_red = {
\tclass = red_star
\tplanet = { key = pc_red_star }
}
sc_pair = {
\tclass = red_star
\tplanet = { key = pc_red_star }
\tplanet = { key = pc_blue_star class = blue_star }
}
";

const PLANET_CLASSES: &str = "pc_red_star = {
\tentity = \"red_star_entity\"
\tstar = yes
}
pc_blue_star = {
\tentity = \"blue_star_entity\"
\tstar = yes
}
pc_green_star = {
\tentity = \"green_star_entity\"
\tatmosphere_color = rgb { 40 220 60 }
\tatmosphere_intensity = 1.0
\tatmosphere_width = 0.5
\tstar = yes
}
pc_banded_star = {
\tentity = \"banded_star_entity\"
\tstar = yes
}
pc_rock = {
\tentity = \"banded_star_entity\"
}
";

/// The banded star's model wears a surface map, as the brown dwarf's does.
const ENTITIES: &str = "entity = {
\tname = \"banded_star_entity\"
\tpdxmesh = \"planet_clouded_mesh\"
\tmeshsettings = {
\t\tname = \"planet_geosphereShape\"
\t\ttexture_diffuse = \"painted_diffuse.dds\"
\t}
}
";

/// A lighting class's settings, in one colour throughout.
fn world(name: &str, hue: f64) -> String {
    let colour = |part: &str| {
        format!("\tlava_{part}_color = hsv {{ {hue} 1.0 1.0 }}\n\tlava_{part}_intensity = 1.0\n")
    };
    format!(
        "gfx_settings = {{\n\tworld = {name}\n{}{}{}\ttex_lava_noise=\"gfx/worldgfx/noise.dds\"\n\ttex_lava_diffuse=\"gfx/worldgfx/lava.dds\"\n\ttex_stone_diffuse=\"gfx/worldgfx/stone.dds\"\n}}\n",
        colour("bright"),
        colour("hot_stone"),
        colour("cold_stone"),
    )
}

/// An uncompressed 32-bit DDS of `faces` square images `side` texels wide, a cube map when
/// there are six.
fn dds(side: u32, faces: &[Vec<[u8; 4]>]) -> Vec<u8> {
    let mut header = [0u32; 31];
    header[0] = 124;
    header[1] = 0x1 | 0x2 | 0x4 | 0x1000 | 0x8;
    header[2] = side;
    header[3] = side;
    header[4] = side * 4;
    header[18] = 32;
    header[19] = 0x41;
    header[21] = 32;
    header[22] = 0xff;
    header[23] = 0xff00;
    header[24] = 0xff_0000;
    header[25] = 0xff00_0000;
    let cube = faces.len() == 6;
    header[26] = 0x1000 | if cube { 0x8 } else { 0 };
    header[27] = if cube { 0x200 | 0xfc00 } else { 0 };
    let mut bytes = b"DDS ".to_vec();
    bytes.extend(header.iter().flat_map(|word| word.to_le_bytes()));
    bytes.extend(faces.iter().flatten().flatten());
    bytes
}

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join("install").join(rel);
    fs::create_dir_all(path.parent().expect("a folder")).expect("the folder");
    fs::write(path, bytes).expect("the file");
}

fn painted() -> (TempDir, GameData) {
    let (dir, gd) = common::hand_written(&[
        ("common/star_classes/00_painted.txt", STAR_CLASSES),
        ("common/planet_classes/00_painted.txt", PLANET_CLASSES),
        ("gfx/models/planets/_painted_stars.asset", ENTITIES),
        ("gfx/worldgfx/star_red.txt", &world("red_star", 0.0)),
        ("gfx/worldgfx/star_blue.txt", &world("blue_star", 0.66)),
        ("gfx/worldgfx/default.txt", &world("default", 0.15)),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ]);
    const SIDE: u32 = 8;
    let noise = |face: u32| {
        (0..SIDE * SIDE)
            .map(|i| {
                let v = ((i * 37 + face * 91) % 256) as u8;
                [v, v, v, 255]
            })
            .collect::<Vec<_>>()
    };
    let grey = vec![[200, 200, 200, 255]; (SIDE * SIDE) as usize];
    let root = dir.path();
    write(
        root,
        "gfx/worldgfx/noise.dds",
        &dds(SIDE, &(0..6).map(noise).collect::<Vec<_>>()),
    );
    write(
        root,
        "gfx/worldgfx/lava.dds",
        &dds(SIDE, std::slice::from_ref(&grey)),
    );
    write(root, "gfx/worldgfx/stone.dds", &dds(SIDE, &[grey]));
    fs::copy(
        common::fixture("planet_disc_diffuse.dds"),
        root.join("install/gfx/models/planets/painted_diffuse.dds"),
    )
    .expect("the fixture map");
    (dir, gd)
}

fn bake(gd: &GameData, class: &str) -> RgbaImage {
    let (_cache, textures) = common::temp_textures();
    let key = format!("star_disc:{class}");
    let png = gd
        .texture_png(&textures, &key)
        .unwrap_or_else(|e| panic!("{key}: {e}"));
    image::load_from_memory(&png).expect("a PNG").to_rgba8()
}

/// A 256 pixel disc, clear in its corners and whole across its middle, and the mean colour
/// of its opaque pixels.
fn disc_colour(class: &str, image: &RgbaImage) -> [f64; 3] {
    assert_eq!(image.dimensions(), (256, 256), "{class}");
    for (x, y) in [(0, 0), (255, 0), (0, 255), (255, 255)] {
        assert_eq!(image.get_pixel(x, y).0[3], 0, "{class}: corner ({x},{y})");
    }
    let opaque: Vec<_> = image.pixels().filter(|p| p.0[3] == 255).collect();
    assert!(
        (49_000..=51_500).contains(&opaque.len()),
        "{class}: {} opaque pixels",
        opaque.len()
    );
    let mut sum = [0.0; 3];
    for p in &opaque {
        for (s, c) in sum.iter_mut().zip(p.0) {
            *s += f64::from(c);
        }
    }
    sum.map(|s| s / opaque.len() as f64)
}

#[test]
fn a_star_is_painted_in_its_lighting_class_colours_or_its_atmosphere_or_its_surface_map() {
    let (_dir, gd) = painted();
    let red = disc_colour("red", &bake(&gd, "pc_red_star"));
    assert!(
        red[0] > 2.0 * red[1] && red[0] > 2.0 * red[2],
        "red: {red:?}"
    );
    // Lit as its own `class = blue_star` in the pair, not as the pair's red.
    let blue = disc_colour("blue", &bake(&gd, "pc_blue_star"));
    assert!(blue[2] > 2.0 * blue[0], "blue: {blue:?}");
    // No star class lights it: the fallback's maps in its atmosphere's green.
    let green = disc_colour("green", &bake(&gd, "pc_green_star"));
    assert!(
        green[1] > green[0] && green[1] > green[2],
        "green: {green:?}"
    );
    // Its model's own surface map: both of the fixture's checker colours show.
    let banded = bake(&gd, "pc_banded_star");
    disc_colour("banded", &banded);
    let leans = |warm: bool| {
        banded.pixels().filter(|p| p.0[3] == 255).any(|p| {
            let (red, blue) = (i16::from(p.0[0]), i16::from(p.0[2]));
            if warm {
                red > blue + 60
            } else {
                blue > red + 60
            }
        })
    };
    assert!(leans(true) && leans(false), "the banded star shows its map");
}

#[test]
fn a_class_that_is_no_star_has_no_star_disc() {
    let (_dir, gd) = painted();
    let (_cache, textures) = common::temp_textures();
    for class in ["pc_rock", "pc_nowhere"] {
        let view = gd.texture(&textures, &format!("star_disc:{class}"));
        assert!(view.png_base64.is_none(), "{class}");
        assert!(view.error.is_some(), "{class}");
    }
}

/// Whether a disc's mean colour is its class's.
type Fits = fn([f64; 3]) -> bool;

/// Every vanilla star but the black hole, each in its class's colours.
#[test]
fn the_installs_star_classes_bake_into_discs_in_their_colours() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let blue = |[r, _, b]: [f64; 3]| b > r + 40.0;
    let checks: [(&str, Fits); 10] = [
        ("pc_b_star", blue),
        ("pc_a_star", blue),
        ("pc_f_star", |c| c.iter().all(|&v| v > 190.0)),
        ("pc_g_star", |[r, g, b]| r > 200.0 && g > 170.0 && b < 160.0),
        ("pc_k_star", |[r, g, b]| {
            r > 200.0 && g > b + 40.0 && g < r - 60.0
        }),
        ("pc_m_star", |[r, g, b]| {
            r > 150.0 && r > 3.0 * g && r > 3.0 * b
        }),
        ("pc_m_giant_star", |[r, g, b]| {
            r > 150.0 && r > 3.0 * g && r > 3.0 * b
        }),
        ("pc_t_star", |[r, g, b]| {
            r > g + 50.0 && r < 200.0 && b < 120.0
        }),
        ("pc_neutron_star", blue),
        ("pc_pulsar", blue),
    ];
    let started = std::time::Instant::now();
    // Each bake takes a second or more in a debug build; side by side they take about one.
    let colours: Vec<[f64; 3]> = std::thread::scope(|scope| {
        let bakes: Vec<_> = checks
            .iter()
            .map(|(class, _)| scope.spawn(move || disc_colour(class, &bake(gd, class))))
            .collect();
        bakes
            .into_iter()
            .map(|b| b.join().expect("a bake"))
            .collect()
    });
    for ((class, fits), colour) in checks.iter().zip(colours) {
        eprintln!("{class}: {colour:.0?}");
        assert!(fits(colour), "{class} reads {colour:?}");
    }
    eprintln!(
        "baked {} star discs in {:.2?}",
        checks.len(),
        started.elapsed()
    );
}
