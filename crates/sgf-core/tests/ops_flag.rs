//! An empire's flag on the sample saves: the diff each change writes to the gamestate and
//! to `meta` is snapshotted, the countries projection, a reload of the edited bytes and
//! the app's delta read the new flag, and the inverse writes the original bytes back.

use sgf_core::archive::{self, MetaFlag};
use sgf_core::ops::{EmpireFlag, Op, OpError};
use sgf_core::projections::galaxy::CountryNode;
use sgf_core::session::Session;
use similar::TextDiff;

use crate::common;
use common::diff::{plain_report, round_trip_step};
use common::{current, open, open_4_5, reprojected};

/// The player empire in both samples; in 4.5 it has Independent Map Color on.
const PLAYER: u32 = 0;
/// A 4.5 AI empire with map colours off, so its fifth and sixth entries copy the first two.
const AI: u32 = 1;
/// A 4.5 primitive, whose entries past the first two are `"null"`.
const PRIMITIVE: u32 = 34;

fn set(country: u32, flag: EmpireFlag) -> Op {
    Op::SetEmpireFlag { country, flag }
}

fn country(countries: &[CountryNode], id: u32) -> &CountryNode {
    countries
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("country {id}"))
}

/// The flag country `id` projects to.
fn flag(countries: &[CountryNode], id: u32) -> EmpireFlag {
    let country = country(countries, id);
    let icon = country.flag_icon.clone().expect("an emblem");
    EmpireFlag {
        icon_category: icon.category,
        icon_file: icon.file,
        background: country.flag_background.clone().expect("a background").file,
        primary: country.colors[0].clone(),
        secondary: country.colors[1].clone(),
    }
}

fn colours(countries: &[CountryNode], id: u32) -> Vec<String> {
    country(countries, id).colors.clone()
}

fn names(names: &[&str]) -> Vec<String> {
    names.iter().map(|&n| n.to_owned()).collect()
}

fn meta_flag(meta: &[u8]) -> MetaFlag {
    archive::parse_meta(meta)
        .expect("read meta")
        .flag
        .expect("a flag in meta")
}

/// The session's `meta` as a unified diff against the one it was opened with.
fn meta_diff(session: &Session) -> String {
    let before = String::from_utf8_lossy(session.doc.original_meta()).into_owned();
    let after = String::from_utf8_lossy(session.doc.meta()).into_owned();
    if before == after {
        return "\nmeta unchanged\n".to_owned();
    }
    let diff = TextDiff::from_lines(&before, &after);
    format!(
        "\n{}",
        diff.unified_diff().context_radius(3).header("meta", "meta")
    )
}

/// Round-trip and snapshot `op` on `session`, check the projection, a reload of the bytes
/// and the app's delta read the new flag, then apply the inverse and check it writes the
/// original gamestate and `meta` back. Returns `meta` as the op left it.
fn change(mut session: Session, op: Op, snapshot: &str) -> Vec<u8> {
    let Op::SetEmpireFlag {
        country: id,
        flag: expected,
    } = op.clone()
    else {
        unreachable!()
    };
    let before = flag(&session.graph.countries, id);
    let result = round_trip_step(&mut session, snapshot, op);
    let report = format!("{}{}", plain_report(&session, &result), meta_diff(&session));
    common::snapshot(snapshot, &report);
    assert_eq!(flag(&session.graph.countries, id), expected, "{snapshot}");
    assert_eq!(
        flag(&reprojected(&session).countries, id),
        expected,
        "{snapshot}: reload"
    );
    let edit = session.edit_result(result.clone());
    assert_eq!(
        flag(&edit.delta.countries, id),
        expected,
        "{snapshot}: reaches the app"
    );
    assert_eq!(result.inverse, set(id, before), "{snapshot}");
    let edited_meta = session.doc.meta().to_vec();
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: the inverse"
    );
    assert_eq!(
        session.doc.meta(),
        session.doc.original_meta(),
        "{snapshot}: the inverse puts meta back"
    );
    edited_meta
}

#[test]
fn the_player_s_emblem_and_background_change_in_the_gamestate_and_meta() {
    let session = open_4_5();
    let before = flag(&session.graph.countries, PLAYER);
    let new = EmpireFlag {
        icon_category: "blocky".to_owned(),
        icon_file: "flag_blocky_18.dds".to_owned(),
        background: "flag_BG_12.dds".to_owned(),
        ..before
    };

    let mut undone = open_4_5();
    undone.apply(set(PLAYER, new.clone())).expect("apply");
    undone.undo().expect("undo").expect("an op to undo");
    assert_eq!(undone.doc.meta(), undone.doc.original_meta(), "undo");
    assert!(!undone.doc.is_dirty(), "undo");
    undone.redo().expect("redo").expect("an op to redo");
    assert_ne!(undone.doc.meta(), undone.doc.original_meta(), "redo");

    let meta = meta_flag(&change(session, set(PLAYER, new), "player_emblem"));
    assert_eq!(meta.icon.expect("an emblem").file, "flag_blocky_18.dds");
    assert_eq!(
        meta.background.expect("a background").file,
        "flag_BG_12.dds"
    );
    assert_eq!(
        meta.colors,
        names(&[
            "grey",
            "dark_blue",
            "black",
            "grey",
            "intense_red",
            "light_pink"
        ])
    );
}

#[test]
fn an_ai_empire_s_map_colours_follow_its_flag_colours() {
    let session = open_4_5();
    assert_eq!(
        colours(&session.graph.countries, AI),
        names(&["red", "purple", "black", "red", "red", "purple"])
    );
    let new = EmpireFlag {
        primary: "blue".to_owned(),
        secondary: "dark_blue".to_owned(),
        ..flag(&session.graph.countries, AI)
    };
    let mut edited = open_4_5();
    edited.apply(set(AI, new.clone())).expect("apply");
    assert_eq!(
        colours(&edited.graph.countries, AI),
        names(&["blue", "dark_blue", "black", "red", "blue", "dark_blue"])
    );
    let meta = change(session, set(AI, new), "ai_colours");
    assert_eq!(meta, open_4_5().doc.original_meta(), "meta is the player's");
}

#[test]
fn a_primitive_keeps_its_null_entries() {
    let session = open_4_5();
    let new = EmpireFlag {
        primary: "green".to_owned(),
        secondary: "dark_green".to_owned(),
        ..flag(&session.graph.countries, PRIMITIVE)
    };
    let mut edited = open_4_5();
    edited.apply(set(PRIMITIVE, new.clone())).expect("apply");
    let primitive = country(&edited.graph.countries, PRIMITIVE);
    assert_eq!(primitive.colors, names(&["green", "dark_green"]));
    assert_eq!(primitive.has_map_colors, Some(true));
    change(session, set(PRIMITIVE, new), "primitive_colours");
}

#[test]
fn a_4_4_player_s_four_colours_change_in_the_gamestate_and_meta() {
    let session = open();
    let new = EmpireFlag {
        primary: "green".to_owned(),
        secondary: "dark_green".to_owned(),
        ..flag(&session.graph.countries, PLAYER)
    };
    let meta = meta_flag(&change(session, set(PLAYER, new), "player_4_4_colours"));
    assert_eq!(meta.colors, names(&["green", "dark_green", "null", "null"]));
}

#[test]
fn a_saved_flag_reads_back_from_the_file() {
    let mut session = open_4_5();
    let new = EmpireFlag {
        icon_category: "ornate".to_owned(),
        icon_file: "flag_ornate_17.dds".to_owned(),
        background: "00_solid.dds".to_owned(),
        primary: "blue".to_owned(),
        secondary: "green".to_owned(),
    };
    session.apply(set(PLAYER, new.clone())).expect("apply");
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("flag.sav");
    session.save_as(&path).expect("save");

    let reopened = Session::open(&path).expect("reopen");
    assert_eq!(flag(&reopened.graph.countries, PLAYER), new);
    let meta = meta_flag(reopened.doc.meta());
    let icon = meta.icon.expect("an emblem");
    assert_eq!(
        (icon.category.as_str(), icon.file.as_str()),
        ("ornate", "flag_ornate_17.dds")
    );
    assert_eq!(meta.background.expect("a background").file, "00_solid.dds");
    assert_eq!(
        meta.colors,
        names(&[
            "blue",
            "green",
            "black",
            "grey",
            "intense_red",
            "light_pink"
        ]),
        "map colours are on, so the fifth and sixth stay"
    );
}

#[test]
fn a_batch_of_two_flag_changes_applies_as_one_and_undoes_to_the_original_meta() {
    let mut session = open_4_5();
    let start = flag(&session.graph.countries, PLAYER);
    let first = EmpireFlag {
        icon_category: "blocky".to_owned(),
        icon_file: "flag_blocky_18.dds".to_owned(),
        ..start.clone()
    };
    let second = EmpireFlag {
        primary: "green".to_owned(),
        secondary: "dark_green".to_owned(),
        ..first.clone()
    };
    let batch = Op::Batch {
        description: "Change the player's flag twice".to_owned(),
        ops: vec![set(PLAYER, first), set(PLAYER, second.clone())],
    };
    session.apply(batch).expect("apply");
    assert_eq!(flag(&session.graph.countries, PLAYER), second);
    let meta = meta_flag(session.doc.meta());
    assert_eq!(meta.colors[0], "green");
    assert_eq!(meta.colors[1], "dark_green");

    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.doc.meta(), session.doc.original_meta());
    assert!(!session.is_dirty());
    assert_eq!(flag(&session.graph.countries, PLAYER), start);
}

#[test]
fn a_batch_is_refused_whole_when_a_later_member_fails() {
    let mut session = open_4_5();
    let player_before = flag(&session.graph.countries, PLAYER);
    let new = EmpireFlag {
        icon_category: "blocky".to_owned(),
        icon_file: "flag_blocky_18.dds".to_owned(),
        ..player_before.clone()
    };
    let unchanged_ai = flag(&session.graph.countries, AI);
    let batch = Op::Batch {
        description: "Change the player, then fail".to_owned(),
        ops: vec![set(PLAYER, new), set(AI, unchanged_ai)],
    };
    let error = session.apply(batch).unwrap_err();
    assert!(
        matches!(error, OpError::Unchanged { ref what, .. } if *what == format!("country {AI}'s flag")),
        "{error:?}"
    );
    assert_eq!(flag(&session.graph.countries, PLAYER), player_before);
    assert_eq!(session.doc.meta(), session.doc.original_meta());
    assert!(!session.is_dirty());
}

// The rollback in `apply_one` at ops/mod.rs (around line 103) only runs for an op with
// a `follow_up` second step: `Op::AddSystemFromSpec` and `Op::ReplaceSystemFromSpec`.
// `Op::SetEmpireFlag` has no follow-up, so no batch built from flag ops alone can reach
// it; reaching it for real needs an add/replace-system follow-up that itself fails,
// which is unrelated to flag coverage and is not attempted here.

#[test]
fn a_flag_is_refused_where_nothing_would_change_or_a_name_cannot_be_written() {
    let mut session = open_4_5();
    let unchanged = flag(&session.graph.countries, AI);
    let error = session.apply(set(AI, unchanged.clone())).unwrap_err();
    assert!(
        matches!(error, OpError::Unchanged { ref what, .. } if *what == format!("country {AI}'s flag")),
        "{error:?}"
    );
    assert!(matches!(
        session.apply(set(999_999, unchanged.clone())),
        Err(OpError::UnknownCountry(999_999))
    ));
    for bad in [
        EmpireFlag {
            icon_file: String::new(),
            ..unchanged.clone()
        },
        EmpireFlag {
            background: "two words.dds".to_owned(),
            ..unchanged.clone()
        },
        EmpireFlag {
            icon_category: "\"pointy\"".to_owned(),
            ..unchanged.clone()
        },
        EmpireFlag {
            primary: "back\\slash".to_owned(),
            ..unchanged.clone()
        },
    ] {
        let error = session.apply(set(AI, bad.clone())).unwrap_err();
        assert!(
            matches!(
                error,
                OpError::EmptyText { .. } | OpError::InvalidText { .. }
            ),
            "{bad:?}: {error:?}"
        );
    }
    assert!(!session.doc.is_dirty());
}
