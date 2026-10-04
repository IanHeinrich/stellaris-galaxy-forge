//! The precursors `common/precursor_civilizations` defines, read from a throwaway install
//! in file order, then from the real Stellaris install when this machine has one.

use crate::common;

use std::fs;

use sgf_gamedata::views::PrecursorView;
use sgf_gamedata::{Diagnostic, GameData};

fn keys(gd: &GameData) -> Vec<String> {
    gd.precursor_views()
        .into_iter()
        .map(|precursor| precursor.key)
        .collect()
}

#[test]
fn precursors_are_listed_in_file_order_and_a_later_file_overrides_by_key() {
    let (dir, gd) = common::hand_written(&[
        (
            "localisation/english/precursors_l_english.yml",
            "\u{feff}l_english:\n precursor_1:0 \"$VULTAUM$\"\n VULTAUM:0 \"Vultaum\"\n",
        ),
        (
            "common/precursor_civilizations/00_precursors.txt",
            "@size = 100\nprecursor_1 = {\n\tsize = @size\n}\nprecursor_2 = {\n}\nprecursor_3 = {\n}\n",
        ),
        (
            "common/precursor_civilizations/01_more.txt",
            "precursor_extra = {\n}\nprecursor_2 = {\n\tsize = 50\n}\n",
        ),
    ]);
    let install = dir.path().join("install");
    let precursors_dir = install.join("common").join("precursor_civilizations");
    assert_eq!(
        keys(&gd),
        [
            "precursor_1",
            "precursor_2",
            "precursor_3",
            "precursor_extra"
        ]
    );
    assert_eq!(
        gd.precursor_views()[0],
        PrecursorView {
            key: "precursor_1".to_owned(),
            name: "Vultaum".to_owned(),
        }
    );
    assert_eq!(gd.precursor_views()[1].name, "Precursor 2");
    assert!(
        gd.diagnostics.contains(&Diagnostic::Override {
            key: "precursor_2".to_owned(),
            from: precursors_dir.join("00_precursors.txt"),
            to: precursors_dir.join("01_more.txt"),
        }),
        "{:?}",
        gd.diagnostics
    );

    fs::remove_dir_all(&precursors_dir).unwrap();
    assert!(keys(&common::load_tree(&install, None, false)).is_empty());
}

#[test]
fn the_real_install_lists_nine_precursors_by_name() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    assert_eq!(
        keys(gd),
        [
            "precursor_1",
            "precursor_2",
            "precursor_3",
            "precursor_4",
            "precursor_5",
            "precursor_baol_1",
            "precursor_zroni_1",
            "precursor_inetian",
            "precursor_adakkaria",
        ]
    );
    let names: Vec<String> = gd
        .precursor_views()
        .into_iter()
        .map(|precursor| precursor.name)
        .collect();
    assert_eq!(
        names,
        [
            "Vultaum",
            "Yuht",
            "First League",
            "Irassian",
            "Cybrex",
            "Baol",
            "Zroni",
            "Inetian Traders",
            "adAkkaria",
        ]
    );
}
