//! The system radii the defines give, from the install and from a mod that overrides them.

use crate::common;

use sgf_core::ops::SystemRadii;
use sgf_gamedata::views::GameDataSummary;

/// The fixture install defines none of the system radii, so the vanilla values stand. A mod
/// changing one of them wins over the install, and the others keep the install's.
#[test]
fn system_radii_come_from_the_defines_a_mod_overrides() {
    assert_eq!(common::cached_fixture().system_radii, SystemRadii::VANILLA);

    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let user = dir.path().join("user");
    let defines = install.join("common/defines/00_defines.txt");
    std::fs::create_dir_all(defines.parent().expect("a directory")).expect("the install tree");
    std::fs::write(
        &defines,
        "NGameplay = {\n\tSYSTEM_INNER_RADIUS_OFFSET = 30\n\tSYSTEM_MIN_INNER_RADIUS = 160\n\
         \tSYSTEM_OUTER_RADIUS_OFFSET = 110\n}\n",
    )
    .expect("the defines");
    let stub = install.join("localisation/english/fx_l_english.yml");
    std::fs::create_dir_all(stub.parent().expect("a directory")).expect("the install tree");
    std::fs::write(
        stub,
        "l_english:
",
    )
    .expect("the localisation stub");
    common::playset(
        &user,
        &[(
            "radii",
            &[(
                "common/defines/zz_radii.txt",
                "NGameplay = {\n\tSYSTEM_INNER_RADIUS_OFFSET = 45\n}\n",
            )],
        )],
    );
    let gd = common::load_tree(&install, Some(&user), true);
    assert_eq!(
        gd.system_radii,
        SystemRadii {
            min_inner: 160.0,
            inner_offset: 45.0,
            outer_offset: 110.0,
        }
    );
    assert_eq!(GameDataSummary::from(&gd).system_radii, gd.system_radii);
}

#[test]
fn vanilla_system_radii_are_read_from_the_install() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    assert_eq!(gd.system_radii, SystemRadii::VANILLA);
}
