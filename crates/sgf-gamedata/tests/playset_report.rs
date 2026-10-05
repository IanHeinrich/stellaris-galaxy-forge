//! The playset report on the real install, vanilla, and on the user's enabled mods when
//! `SGF_PLAYSET=1` asks for them.

use crate::common;

use sgf_gamedata::report::PlaysetReport;
use sgf_gamedata::{Diagnostic, LoadOptions, load};

#[test]
fn vanilla_shows_every_class_it_can_roll() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let (_cache, textures) = common::temp_textures();
    let report = PlaysetReport::new(gd, &textures);
    let text = report.text(None);

    for section in report.sections() {
        for row in section.rows {
            assert_eq!(row.source, "vanilla", "{}: {row:?}", section.title);
        }
    }
    let class_files_broken: Vec<String> = gd
        .diagnostics
        .iter()
        .filter(|d| {
            let (Diagnostic::ParseError { file, .. } | Diagnostic::Unreadable { file, .. }) = d
            else {
                return false;
            };
            let file = file.to_string_lossy().replace('\\', "/");
            ["planet_classes", "star_classes"]
                .iter()
                .any(|dir| file.contains(&format!("common/{dir}/")))
        })
        .map(ToString::to_string)
        .collect();
    assert!(class_files_broken.is_empty(), "{class_files_broken:?}");
    for empty in [
        &report.unnamed_rolled,
        &report.star_art_missing,
        &report.stars_without_body,
    ] {
        assert!(empty.is_empty(), "{text}");
    }
    for row in &report.no_planet_size {
        let class = gd.planet_classes.get(&row.key).expect("a planet class");
        assert_eq!(class.spawn_odds, 0.0, "{text}");
    }
    assert!(!report.stars_with_bodies.is_empty(), "{text}");
}

#[test]
fn the_enabled_mods_load_without_a_parse_error() {
    if std::env::var_os("SGF_PLAYSET").is_none_or(|v| v != "1") {
        eprintln!("skipped: SGF_PLAYSET=1 reads the enabled mods");
        return;
    }
    let gd = load(&LoadOptions::default(), &mut |_| {}).expect("SGF_PLAYSET needs an install");
    let (_cache, textures) = common::temp_textures();
    let report = PlaysetReport::new(&gd, &textures);
    println!("{} mods\n{}", gd.mods.len(), report.text(None));
    let broken: Vec<String> = gd
        .diagnostics
        .iter()
        .filter(|d| {
            matches!(
                d,
                Diagnostic::ParseError { .. } | Diagnostic::Unreadable { .. }
            )
        })
        .map(ToString::to_string)
        .collect();
    assert!(broken.is_empty(), "{broken:#?}");
}
