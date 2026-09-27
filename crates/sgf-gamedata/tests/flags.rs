//! `flags/`: the emblem categories and backgrounds a flag can use, read from the real
//! Stellaris install when this machine has one.

use crate::common;

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
