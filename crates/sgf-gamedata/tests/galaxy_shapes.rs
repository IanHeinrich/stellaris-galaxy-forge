//! The galaxy shapes `map/galaxy` defines, read from a throwaway install in file
//! order, then from the real Stellaris install when this machine has one.

use crate::common;

use std::fs;

use sgf_gamedata::views::GalaxyShapeView;
use sgf_gamedata::{Diagnostic, GameData};

fn names(gd: &GameData) -> Vec<String> {
    gd.galaxy_shape_views()
        .into_iter()
        .map(|shape| shape.name)
        .collect()
}

#[test]
fn shapes_are_listed_in_file_order_and_a_later_file_overrides_by_name() {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path();
    fs::create_dir_all(install.join("common")).unwrap();
    fs::create_dir_all(install.join("localisation")).unwrap();
    let galaxy = install.join("map").join("galaxy");
    fs::create_dir_all(&galaxy).unwrap();
    let shapes = galaxy.join("galaxy_shapes.txt");
    fs::write(
        &shapes,
        "@radius = 400\nring = {\n\tradius = @radius\n}\nelliptical = {\n\tradius = 450\n}\nbar = {\n}\n",
    )
    .unwrap();
    let more = galaxy.join("zz_more.txt");
    fs::write(&more, "spoked = {\n}\nelliptical = {\n\tradius = 500\n}\n").unwrap();

    let gd = common::load_tree(install, None, false);
    assert_eq!(names(&gd), ["ring", "elliptical", "bar", "spoked"]);
    let views = gd.galaxy_shape_views();
    assert_eq!(
        views[1],
        GalaxyShapeView {
            name: "elliptical".to_owned(),
            source: more.display().to_string(),
        }
    );
    assert_eq!(views[0].source, shapes.display().to_string());
    assert!(
        gd.diagnostics.contains(&Diagnostic::Override {
            key: "elliptical".to_owned(),
            from: shapes.clone(),
            to: more.clone(),
        }),
        "{:?}",
        gd.diagnostics
    );

    fs::remove_dir_all(&galaxy).unwrap();
    assert!(names(&common::load_tree(install, None, false)).is_empty());
}

#[test]
fn the_real_install_lists_ten_vanilla_shapes() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let names = names(gd);
    assert_eq!(names.len(), 10, "{names:?}");
    assert_eq!(names.first().map(String::as_str), Some("elliptical"));
    assert!(names.iter().any(|name| name == "spoked"), "{names:?}");
    for shape in gd.galaxy_shape_views() {
        assert!(
            shape.source.ends_with("galaxy_shapes.txt"),
            "{}",
            shape.source
        );
    }
}
