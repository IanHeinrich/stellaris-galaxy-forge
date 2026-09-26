//! Star planet classes baked into discs through the texture cache: a hand-written install
//! whose lighting classes paint their stars in plain colours first, then every vanilla star
//! class from the real install when this machine has one (skipped with a message otherwise).

use crate::common;

use std::fs;

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

fn painted() -> (TempDir, GameData) {
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
    let text = |rel: &'static str, text: String| (rel, text.into_bytes());
    common::hand_written_bytes(&[
        (
            "common/star_classes/00_painted.txt",
            STAR_CLASSES.as_bytes().to_vec(),
        ),
        (
            "common/planet_classes/00_painted.txt",
            PLANET_CLASSES.as_bytes().to_vec(),
        ),
        (
            "gfx/models/planets/_painted_stars.asset",
            ENTITIES.as_bytes().to_vec(),
        ),
        text("gfx/worldgfx/star_red.txt", world("red_star", 0.0)),
        text("gfx/worldgfx/star_blue.txt", world("blue_star", 0.66)),
        text("gfx/worldgfx/default.txt", world("default", 0.15)),
        (
            "gfx/worldgfx/noise.dds",
            common::dds(SIDE, &(0..6).map(noise).collect::<Vec<_>>()),
        ),
        (
            "gfx/worldgfx/lava.dds",
            common::dds(SIDE, std::slice::from_ref(&grey)),
        ),
        ("gfx/worldgfx/stone.dds", common::dds(SIDE, &[grey])),
        (
            "gfx/models/planets/painted_diffuse.dds",
            fs::read(common::fixture("planet_disc_diffuse.dds")).expect("the fixture map"),
        ),
    ])
}

fn bake(gd: &GameData, class: &str) -> RgbaImage {
    common::bake_disc(gd, &format!("star_disc:{class}"))
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

/// A sample of vanilla star classes bake without erroring, and a blue one reads bluer than a
/// red one.
#[test]
fn the_installs_star_classes_bake_into_discs_in_recognisable_colours() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let classes = [
        "pc_b_star",
        "pc_a_star",
        "pc_f_star",
        "pc_g_star",
        "pc_k_star",
        "pc_m_star",
        "pc_m_giant_star",
        "pc_t_star",
        "pc_neutron_star",
        "pc_pulsar",
    ];
    let started = std::time::Instant::now();
    // Each bake takes a second or more in a debug build; side by side they take about one.
    let colours = common::parallel(classes.len(), |i| {
        disc_colour(classes[i], &bake(gd, classes[i]))
    });
    for (class, colour) in classes.iter().zip(&colours) {
        eprintln!("{class}: {colour:.0?}");
    }
    eprintln!(
        "baked {} star discs in {:.2?}",
        classes.len(),
        started.elapsed()
    );
    let blue = colours[classes.iter().position(|&c| c == "pc_b_star").unwrap()];
    let red = colours[classes.iter().position(|&c| c == "pc_m_star").unwrap()];
    let (blue_diff, red_diff) = (blue[2] - blue[0], red[2] - red[0]);
    assert!(
        blue_diff > red_diff,
        "pc_b_star is not bluer than pc_m_star: {blue:?} vs {red:?}"
    );
}

/// The star shader reads the mip level a disc's width asks for, not always level 0: a
/// `lava.dds` wider than `LAVA_WIDTH` with a distinct colour at level 1 changes the baked
/// disc, read through `texture_png` as the app would.
#[test]
fn a_stars_lava_map_reads_the_mip_level_its_width_asks_for() {
    // Chosen so the shader's veins sit near their most negative, so `lava_mask` is close to 1
    // and the lava map's own colour dominates over the stone map's.
    const NOISE_SHADE: u8 = 94;
    const WORLD: &str = "gfx_settings = {
\tworld = lod_star
\tlava_bright_color = rgb { 200 200 200 }
\tlava_bright_intensity = 1.0
\tlava_hot_stone_color = rgb { 80 80 80 }
\tlava_hot_stone_intensity = 1.0
\tlava_cold_stone_color = rgb { 40 40 40 }
\tlava_cold_stone_intensity = 1.0
\ttex_lava_noise=\"gfx/worldgfx/noise.dds\"
\ttex_lava_diffuse=\"gfx/worldgfx/lava.dds\"
\ttex_stone_diffuse=\"gfx/worldgfx/stone.dds\"
}
";
    let bake_with_lava_level_1 = |colour: [u8; 4]| {
        let noise_face = vec![[NOISE_SHADE, NOISE_SHADE, NOISE_SHADE, 255]; 64];
        let (_dir, gd) = common::hand_written_bytes(&[
            (
                "common/star_classes/00_lod.txt",
                b"sc_lod = {\n\tclass = lod_star\n\tplanet = { key = pc_lod_star }\n}\n".to_vec(),
            ),
            (
                "common/planet_classes/00_lod.txt",
                b"pc_lod_star = {\n\tentity = \"lod_star_entity\"\n\tstar = yes\n}\n".to_vec(),
            ),
            ("gfx/worldgfx/lod.txt", WORLD.as_bytes().to_vec()),
            (
                "gfx/worldgfx/noise.dds",
                common::dds(8, &(0..6).map(|_| noise_face.clone()).collect::<Vec<_>>()),
            ),
            (
                "gfx/worldgfx/stone.dds",
                common::dds(8, &[vec![[200, 200, 200, 255]; 64]]),
            ),
            (
                // Wider than LAVA_WIDTH (128), so the level read is level 1, not level 0.
                "gfx/worldgfx/lava.dds",
                common::dds_by_level(256, |level| {
                    if level == 0 {
                        [10, 10, 10, 255]
                    } else {
                        colour
                    }
                }),
            ),
        ]);
        disc_colour("lod", &bake(&gd, "pc_lod_star"))
    };
    let red = bake_with_lava_level_1([255, 0, 0, 255]);
    let blue = bake_with_lava_level_1([0, 0, 255, 255]);
    assert!(
        red[0] > blue[0] && blue[2] > red[2],
        "level 1's colour did not reach the bake: red {red:?}, blue {blue:?}"
    );
}
