//! An empire's map colours on the 4.5 sample: the diff each change produces in the
//! gamestate and in `meta` is snapshotted, the countries projection and a reload of the
//! edited bytes read the new colours, undo puts the original bytes back, and the inverse
//! op writes them back too.

use sgf_core::archive::{self, MetaFlag};
use sgf_core::ops::{MapColorPair, Op, OpError};
use sgf_core::projections::galaxy::CountryNode;
use similar::TextDiff;

use crate::common;
use common::diff::snapshot_step;
use common::{current, open, open_4_5, reprojected};

/// The player empire, created with Independent Map Color on.
const PLAYER: u32 = 0;
/// An AI empire whose map colours mirror its flag's first two.
const AI: u32 = 1;

fn pair(border: &str, fill: &str) -> Option<MapColorPair> {
    Some(MapColorPair {
        border: border.to_owned(),
        fill: fill.to_owned(),
    })
}

fn set(country: u32, colors: Option<MapColorPair>) -> Op {
    Op::SetEmpireMapColors { country, colors }
}

fn country(countries: &[CountryNode], id: u32) -> (Option<String>, Option<String>) {
    let country = countries
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("country {id}"));
    (country.border_color.clone(), country.fill_color.clone())
}

fn colours(border: &str, fill: &str) -> (Option<String>, Option<String>) {
    (Some(border.to_owned()), Some(fill.to_owned()))
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

/// `meta` as a unified diff against `original`.
fn meta_diff(original: &[u8], meta: &[u8]) -> String {
    let before = String::from_utf8_lossy(original);
    let after = String::from_utf8_lossy(meta);
    let diff = TextDiff::from_lines(&before, &after);
    format!(
        "{}",
        diff.unified_diff().context_radius(3).header("meta", "meta")
    )
}

/// Round-trip and snapshot `op` on a fresh 4.5 sample, check the projection, a reload of
/// the bytes and the app's delta read `expected`, then apply the inverse and check it
/// writes the original gamestate and `meta` back. Returns `meta` as the op left it.
fn change(
    op: Op,
    expected: (Option<String>, Option<String>),
    inverse: Op,
    snapshot: &str,
) -> Vec<u8> {
    let Op::SetEmpireMapColors { country: id, .. } = op else {
        unreachable!()
    };
    let mut session = open_4_5();
    let result = snapshot_step(&mut session, snapshot, op);
    assert_eq!(
        country(&session.graph.countries, id),
        expected,
        "{snapshot}"
    );
    assert_eq!(
        country(&reprojected(&session).countries, id),
        expected,
        "{snapshot}: reload"
    );
    let edit = session.edit_result(result.clone());
    assert_eq!(
        country(&edit.delta.countries, id),
        expected,
        "{snapshot}: reaches the app"
    );
    assert_eq!(result.inverse, inverse, "{snapshot}");
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
fn colours_set_on_an_ai_empire_turn_independent_map_colours_on() {
    let before = open_4_5();
    assert_eq!(country(&before.graph.countries, AI), (None, None));
    let meta = change(
        set(AI, pair("blue", "dark_blue")),
        colours("blue", "dark_blue"),
        set(AI, None),
        "ai_empire_set",
    );
    assert_eq!(meta, before.doc.original_meta(), "meta is the player's");
}

#[test]
fn the_player_empire_s_map_colours_change() {
    let before = open_4_5();
    assert_eq!(
        country(&before.graph.countries, PLAYER),
        colours("intense_red", "light_pink")
    );
    let meta = change(
        set(PLAYER, pair("green", "light_pink")),
        colours("green", "light_pink"),
        set(PLAYER, pair("intense_red", "light_pink")),
        "player_empire_changed",
    );
    common::snapshot(
        "player_empire_changed_meta",
        &meta_diff(before.doc.original_meta(), &meta),
    );
    let flag = meta_flag(&meta);
    assert_eq!(
        flag.colors,
        names(&["grey", "dark_blue", "black", "grey", "green", "light_pink"])
    );
    assert!(flag.use_map_color, "the switch stays on");
}

#[test]
fn the_player_empire_goes_back_to_its_flag_colours() {
    let meta = change(
        set(PLAYER, None),
        (None, None),
        set(PLAYER, pair("intense_red", "light_pink")),
        "player_empire_flag_colours",
    );
    common::snapshot(
        "player_empire_flag_colours_meta",
        &meta_diff(open_4_5().doc.original_meta(), &meta),
    );
    let flag = meta_flag(&meta);
    assert_eq!(
        flag.colors,
        names(&["grey", "dark_blue", "black", "grey", "grey", "dark_blue"])
    );
    assert!(!flag.use_map_color, "the switch is gone");
}

#[test]
fn the_player_s_map_colours_turned_off_and_on_again_restore_meta() {
    let mut session = open_4_5();
    session.apply(set(PLAYER, None)).expect("turn them off");
    session
        .apply(set(PLAYER, pair("intense_red", "light_pink")))
        .expect("turn them on");
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(session.doc.meta(), session.doc.original_meta());
}

#[test]
fn undo_puts_the_player_s_meta_back() {
    for colors in [None, pair("green", "dark_green")] {
        let mut session = open_4_5();
        session.apply(set(PLAYER, colors.clone())).expect("apply");
        assert_ne!(
            session.doc.meta(),
            session.doc.original_meta(),
            "{colors:?}: apply"
        );
        session.undo().expect("undo").expect("an op to undo");
        assert_eq!(
            session.doc.meta(),
            session.doc.original_meta(),
            "{colors:?}: undo"
        );
        assert!(!session.doc.is_dirty(), "{colors:?}: undo");
    }
}

#[test]
fn map_colours_are_refused_without_a_4_5_colours_list_or_where_nothing_would_change() {
    let mut four_four = open();
    let error = four_four
        .apply(set(0, pair("blue", "dark_blue")))
        .unwrap_err();
    assert!(matches!(error, OpError::NoMapColors(0)), "{error:?}");
    assert!(error.to_string().contains("Stellaris 4.5"), "{error}");

    let mut session = open_4_5();
    assert!(matches!(
        session.apply(set(999_999, pair("blue", "dark_blue"))),
        Err(OpError::UnknownCountry(999_999))
    ));
    for (border, fill) in [
        ("", "blue"),
        ("blue", "dark blue"),
        ("blue", "dark\tblue"),
        ("\"blue\"", "blue"),
        ("blue", "back\\slash"),
    ] {
        let error = session.apply(set(AI, pair(border, fill))).unwrap_err();
        assert!(
            matches!(
                error,
                OpError::EmptyText {
                    what: "a colour name"
                } | OpError::InvalidText {
                    what: "a colour name",
                    ..
                }
            ),
            "{border:?} {fill:?}: {error:?}"
        );
    }
    for unchanged in [
        set(AI, None),
        set(PLAYER, pair("intense_red", "light_pink")),
    ] {
        let error = session.apply(unchanged.clone()).unwrap_err();
        assert!(
            matches!(error, OpError::Unchanged { .. }),
            "{unchanged:?}: {error:?}"
        );
    }

    for session in [&four_four, &session] {
        assert!(!session.doc.is_dirty());
    }
}
