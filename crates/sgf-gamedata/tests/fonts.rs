//! The font the map writes empire names in, found through the install's own chain.

use crate::common;

use sgf_gamedata::fonts::map_name_font;

const FONTS_GFX: &str = r#"bitmapfonts = {
	textcolors = { W = { 255 255 255 } }
	bitmapfont = {
		name = "map_name_border"
		path = "gfx/fonts/wide"
		color = 0xffffffff
	}
	bitmapfont = {
		name = "map_name_nebula"
		path = "gfx/fonts/other"
	}
}
"#;

const FONTS_ASSET: &str = r#"font = {
	name = "Wide"
	fontstyle = { style = bold file = "gfx/fonts/Wide-Bold.ttf" }
	fontstyle = { style = regular file = "gfx/fonts/Wide-Regular.ttf" }
}
font = {
	name = "Other"
	fontstyle = { style = regular file = "gfx/fonts/Other-Regular.ttf" }
}
"#;

#[test]
fn the_map_name_font_is_the_regular_file_of_the_face_its_bitmap_was_made_from() {
    let (_dir, gd) = common::hand_written(&[
        ("common/defines/00_defines.txt", ""),
        ("interface/fonts.gfx", FONTS_GFX),
        (
            "gfx/fonts/wide.fnt",
            "info face=\"Wide\" size=36 bold=0\ncommon lineHeight=36\n",
        ),
        ("fonts/fonts.asset", FONTS_ASSET),
        ("gfx/fonts/Wide-Regular.ttf", "not really a font"),
        ("gfx/fonts/Wide-Bold.ttf", "not really a font"),
    ]);
    let font = map_name_font(&gd.layout).expect("the chain resolves");
    assert!(font.ends_with("gfx/fonts/Wide-Regular.ttf"), "{font:?}");
}

#[test]
fn no_map_name_font_when_the_face_ships_no_file() {
    let (_dir, gd) = common::hand_written(&[
        ("common/defines/00_defines.txt", ""),
        ("interface/fonts.gfx", FONTS_GFX),
        ("gfx/fonts/wide.fnt", "info face=\"Wide\" size=36\n"),
        ("fonts/fonts.asset", FONTS_ASSET),
    ]);
    assert_eq!(map_name_font(&gd.layout), None);
}

#[test]
fn the_real_install_writes_map_names_in_orbitron() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let font = map_name_font(&gd.layout).expect("the install names a map font");
    assert!(font.ends_with("gfx/fonts/Orbitron-Regular.ttf"), "{font:?}");
}
