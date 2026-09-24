//! Which loaded mods could change the L-Cluster outcome, on the real install
//! and on a mod layer over the synthetic one.

use crate::common;

use sgf_gamedata::scripts::{LGateModTouch, LGateTouchKind};

use common::scripts::install_with_mod;

#[test]
fn the_base_game_alone_touches_no_lgate_outcome() {
    let Some(gd) = common::load_real() else {
        return;
    };
    let rolls = gd.scripts.global_flag_writes("dragon_season");
    assert!(
        !rolls.is_empty(),
        "vanilla sets dragon_season somewhere, or this test asserts nothing"
    );
    assert!(rolls.iter().all(|site| site.location.layer == "vanilla"));
    assert_eq!(gd.lgate_outcome_mods(), []);
}

#[test]
fn a_mod_overriding_the_roll_is_named_with_its_file() {
    let (_dir, gd) = install_with_mod(&[(
        "events/zz_lgate_events.txt",
        "namespace = distar\n\
         event = {\n\
         \tid = distar.8000\n\
         \thide_window = yes\n\
         \tis_triggered_only = yes\n\
         \timmediate = {\n\
         \t\tset_global_flag = dragon_season\n\
         \t\tif = { limit = { always = yes } set_global_flag = dragon_season }\n\
         \t}\n\
         }\n",
    )]);
    let touch = |what| LGateModTouch {
        mod_name: "many".to_owned(),
        file: "events/zz_lgate_events.txt".to_owned(),
        what,
    };
    assert_eq!(
        gd.lgate_outcome_mods(),
        [
            touch(LGateTouchKind::OverridesRoll),
            touch(LGateTouchKind::SetsFlag("dragon_season".to_owned())),
        ]
    );
}
