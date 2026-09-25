//! An empire's map colours on the 4.5 sample: the diff each change produces is
//! snapshotted, the countries projection and a reload of the edited bytes read the new
//! colours, undo puts the original bytes back, and the inverse op writes them back too.

use sgf_core::ops::{MapColorPair, Op, OpError};
use sgf_core::projections::galaxy::CountryNode;
use sgf_core::views::DocumentKind;

use crate::common;
use common::diff::{plain_report, round_trip};
use common::examples;
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

/// Apply `op` to a fresh 4.5 sample, check the projection, a reload of the bytes and the
/// app's delta all read `expected`, snapshot the diff, check the inverse, then apply the
/// inverse and check it writes the original bytes back.
fn change(op: Op, expected: (Option<String>, Option<String>), inverse: Op, snapshot: &str) {
    let Op::SetEmpireMapColors { country: id, .. } = op else {
        unreachable!()
    };
    let mut session = open_4_5();
    let result = session.apply(op.clone()).expect("set the map colours");
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
    common::snapshot(snapshot, &plain_report(&session, &result));

    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(
        current(&session),
        session.doc.original(),
        "{snapshot}: the inverse"
    );

    round_trip(open_4_5(), op);
}

#[test]
fn colours_set_on_an_ai_empire_turn_independent_map_colours_on() {
    let before = open_4_5();
    assert_eq!(country(&before.graph.countries, AI), (None, None));
    change(
        set(AI, pair("blue", "dark_blue")),
        colours("blue", "dark_blue"),
        set(AI, None),
        "ai_empire_set",
    );
}

#[test]
fn the_player_empire_s_map_colours_change() {
    let before = open_4_5();
    assert_eq!(
        country(&before.graph.countries, PLAYER),
        colours("intense_red", "light_pink")
    );
    change(
        set(PLAYER, pair("green", "light_pink")),
        colours("green", "light_pink"),
        set(PLAYER, pair("intense_red", "light_pink")),
        "player_empire_changed",
    );
}

#[test]
fn the_player_empire_goes_back_to_its_flag_colours() {
    change(
        set(PLAYER, None),
        (None, None),
        set(PLAYER, pair("intense_red", "light_pink")),
        "player_empire_flag_colours",
    );
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
            matches!(error, OpError::MapColorsUnchanged(_)),
            "{unchanged:?}: {error:?}"
        );
    }

    let mut scenario = examples::scenario();
    assert!(matches!(
        scenario.apply(set(AI, pair("blue", "dark_blue"))),
        Err(OpError::Unsupported {
            kind: DocumentKind::Scenario,
            ..
        })
    ));
    for session in [&four_four, &session, &scenario] {
        assert!(!session.doc.is_dirty());
    }
}
