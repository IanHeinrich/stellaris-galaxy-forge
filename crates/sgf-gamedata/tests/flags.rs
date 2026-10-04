//! `flags/`: the emblem categories and backgrounds a flag can use, read from a hand-written
//! install with a mod on top of it, and from the real Stellaris install when this machine has
//! one.

use crate::common;

use sgf_gamedata::GameData;
use sgf_gamedata::registries::flags::{EmblemCategory, FlagFile};

fn files(category: &EmblemCategory) -> Vec<(&str, Option<&str>)> {
    category
        .files
        .iter()
        .map(|f: &FlagFile| (f.file.as_str(), f.source.as_deref()))
        .collect()
}

fn category<'a>(gd: &'a GameData, name: &str) -> &'a EmblemCategory {
    gd.flags
        .emblems
        .iter()
        .find(|c| c.name == name)
        .unwrap_or_else(|| panic!("{name} is a category"))
}

#[test]
fn flags_sort_naturally_name_their_mod_and_follow_its_replace_path() {
    let (dir, vanilla) = common::hand_written(&[
        ("common/defines/00_fx.txt", ""),
        ("flags/x/flag_x_10.dds", ""),
        ("flags/x/flag_x_2.dds", ""),
        ("flags/x/flag_x_1.dds", ""),
        ("flags/x/small/flag_x_3.dds", ""),
        ("flags/x/map/flag_x_4.dds", ""),
        ("flags/zeta/flag_z_1.dds", ""),
        ("flags/empty/readme.txt", ""),
        ("flags/backgrounds/bg_b.dds", ""),
        ("flags/backgrounds/bg_a.dds", ""),
    ]);
    let names: Vec<&str> = vanilla
        .flags
        .emblems
        .iter()
        .map(|c| c.name.as_str())
        .collect();
    assert_eq!(
        names,
        ["x", "zeta"],
        "backgrounds is no emblem category, nor is a folder with no .dds"
    );
    assert_eq!(
        files(category(&vanilla, "x")),
        [
            ("flag_x_1.dds", None),
            ("flag_x_2.dds", None),
            ("flag_x_10.dds", None),
        ],
        "2 before 10, and the small/ and map/ variants left out"
    );
    let backgrounds: Vec<&str> = vanilla
        .flags
        .backgrounds
        .iter()
        .map(|f| f.file.as_str())
        .collect();
    assert_eq!(backgrounds, ["bg_a.dds", "bg_b.dds"]);

    let install = dir.path().join("install");
    let user = dir.path().join("user");
    common::playset(
        &user,
        &[(
            "flag_mod",
            &[
                ("flags/x/flag_x_1.dds", ""),
                ("flags/x/flag_x_11.dds", ""),
                ("flags/alpha/flag_a_1.dds", ""),
                ("flags/backgrounds/bg_c.dds", ""),
            ],
        )],
    );
    let modded = common::load_tree(&install, Some(&user), true);
    let names: Vec<&str> = modded
        .flags
        .emblems
        .iter()
        .map(|c| c.name.as_str())
        .collect();
    assert_eq!(names, ["alpha", "x", "zeta"]);
    assert_eq!(
        files(category(&modded, "x")),
        [
            ("flag_x_1.dds", Some("flag_mod")),
            ("flag_x_2.dds", None),
            ("flag_x_10.dds", None),
            ("flag_x_11.dds", Some("flag_mod")),
        ],
        "a mod's file replaces vanilla's of the same name and sorts in with the rest"
    );
    assert_eq!(
        files(category(&modded, "alpha")),
        [("flag_a_1.dds", Some("flag_mod"))]
    );
    assert_eq!(files(category(&modded, "zeta")), [("flag_z_1.dds", None)]);
    let backgrounds: Vec<(&str, Option<&str>)> = modded
        .flags
        .backgrounds
        .iter()
        .map(|f| (f.file.as_str(), f.source.as_deref()))
        .collect();
    assert_eq!(
        backgrounds,
        [
            ("bg_a.dds", None),
            ("bg_b.dds", None),
            ("bg_c.dds", Some("flag_mod"))
        ]
    );

    std::fs::write(
        user.join("mod/flag_mod.mod"),
        "name=\"flag_mod\"
path=\"mod/flag_mod\"
replace_path=\"flags/x\"
supported_version=\"v9.9.*\"
",
    )
    .expect("descriptor");
    let replaced = common::load_tree(&install, Some(&user), true);
    assert_eq!(
        files(category(&replaced, "x")),
        [
            ("flag_x_1.dds", Some("flag_mod")),
            ("flag_x_11.dds", Some("flag_mod")),
        ],
        "replace_path drops vanilla's files from that category only"
    );
    assert_eq!(files(category(&replaced, "zeta")), [("flag_z_1.dds", None)]);
}

#[test]
fn vanilla_flags() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let flags = &gd.flags;

    assert!(
        flags.emblems.len() >= 15,
        "{}",
        flags
            .emblems
            .iter()
            .map(|c| c.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    assert!(
        flags.emblems.iter().all(|c| c.name != "backgrounds"),
        "backgrounds is a sibling of the emblem categories, not one of them"
    );

    let pointy = flags
        .emblems
        .iter()
        .find(|c| c.name == "pointy")
        .expect("a pointy category");
    assert!(
        pointy.files.iter().any(|f| f.file == "flag_pointy_9.dds"),
        "{:?}",
        pointy.files.iter().map(|f| &f.file).collect::<Vec<_>>()
    );

    for category in &flags.emblems {
        for file in &category.files {
            assert!(
                !file.file.contains('/') && !file.file.contains('\\'),
                "a small/ or map/ size variant leaked into {}: {}",
                category.name,
                file.file
            );
        }
    }
    // The pointy category's own `small/` and `map/` folders exist and hold more files
    // than the category itself: only the ones directly under it should be listed.
    let pointy_dir = gd.layout.install.join("flags").join("pointy");
    let direct: Vec<String> = std::fs::read_dir(&pointy_dir)
        .expect("flags/pointy reads")
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|e| e == "dds"))
        .map(|p| p.file_name().unwrap().to_string_lossy().into_owned())
        .collect();
    assert!(pointy_dir.join("small").is_dir());
    assert_eq!(pointy.files.len(), direct.len(), "{direct:?}");

    assert!(flags.backgrounds.len() >= 60, "{}", flags.backgrounds.len());
    assert!(
        flags
            .emblems
            .iter()
            .all(|c| c.files.iter().all(|f| f.source.is_none()))
            && flags.backgrounds.iter().all(|f| f.source.is_none()),
        "vanilla only installed: every file should report no mod source"
    );
}
