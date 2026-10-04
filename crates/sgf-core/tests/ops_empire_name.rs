//! An empire's name on the sample saves: the diff each rename writes to the gamestate and
//! to `meta` is snapshotted, the countries projection, a reload of the edited bytes and
//! the app's delta read the new name, and the inverse writes the original bytes back. The
//! player's rename reaches the gamestate header and `meta`; any other empire's does not.

use sgf_core::archive;
use sgf_core::entity::{EntityAddr, EntityKind};
use sgf_core::ops::{Op, OpError};
use sgf_core::projections::name::NameTemplate;
use sgf_core::session::Session;

use crate::common;
use common::diff::{plain_report, round_trip_step};
use common::{country, current, open, open_3_4, open_4_5, reprojected};

/// The player empire in both samples: a literal "Test Empire" in 4.5, and a name from the
/// empire designs in 4.4, which the header and `meta` hold as the text it reads.
const PLAYER: u32 = 0;
/// A 4.5 AI empire whose name is generated from its species' adjective.
const AI: u32 = 1;
/// A 4.5 primitive, named from its species like an AI empire.
const PRIMITIVE: u32 = 36;
const NEW_NAME: &str = "Sgf Dominion of Tests";

fn rename(country: u32, name: &str) -> Op {
    Op::RenameEmpire {
        country,
        name: name.to_owned(),
        value: None,
        custom_name: true,
    }
}

fn literal(name: &str) -> NameTemplate {
    NameTemplate {
        key: name.to_owned(),
        literal: true,
        variables: Vec::new(),
    }
}

/// The gamestate header's `name`, the third line the game writes.
fn header_name(session: &Session) -> String {
    let text = String::from_utf8_lossy(&current(session)).into_owned();
    let line = text
        .lines()
        .take(5)
        .find(|line| line.starts_with("name="))
        .expect("a header name")
        .to_owned();
    line.trim_start_matches("name=")
        .trim_matches('"')
        .to_owned()
}

fn meta_name(meta: &[u8]) -> String {
    archive::parse_meta(meta).expect("read meta").name
}

/// Round-trip and snapshot a rename of `id` to [`NEW_NAME`] on `session`, check the
/// projection, a reload of the bytes and the app's delta read the new name, then apply the
/// inverse and check it writes the original gamestate and `meta` back. Returns the inverse.
fn change(mut session: Session, id: u32, snapshot: &str) -> Op {
    let result = round_trip_step(&mut session, snapshot, rename(id, NEW_NAME));
    common::snapshot(snapshot, &plain_report(&session, &result));
    let expected = literal(NEW_NAME);
    assert_eq!(country(&session.graph().countries, id).name, expected);
    assert_eq!(country(&session.graph().countries, id).name_key, NEW_NAME);
    assert_eq!(
        country(&reprojected(&session).countries, id).name,
        expected,
        "{snapshot}: reload"
    );
    let edit = session.edit_result(result.clone());
    assert_eq!(
        country(&edit.delta.countries, id).name,
        expected,
        "{snapshot}: reaches the app"
    );
    session
        .apply(result.inverse.clone())
        .expect("apply the inverse");
    assert_eq!(
        current(&session),
        session.doc().original(),
        "{snapshot}: the inverse"
    );
    assert_eq!(
        session.doc().meta(),
        session.doc().original_meta(),
        "{snapshot}: the inverse puts meta back"
    );
    result.inverse
}

#[test]
fn the_player_s_name_changes_in_the_country_the_header_and_meta() {
    let session = open_4_5();
    assert_eq!(header_name(&session), "Test Empire");
    let mut renamed = open_4_5();
    renamed.apply(rename(PLAYER, NEW_NAME)).expect("apply");
    assert_eq!(header_name(&renamed), NEW_NAME);
    assert_eq!(meta_name(renamed.doc().meta()), NEW_NAME);
    assert_eq!(renamed.title(), NEW_NAME);

    let inverse = change(session, PLAYER, "player_literal");
    assert_eq!(inverse, rename(PLAYER, "Test Empire"));
}

#[test]
fn a_4_4_player_s_designed_name_becomes_a_literal_and_the_inverse_carries_the_old_block() {
    let session = open();
    assert_eq!(header_name(&session), "United Nations of Earth 2");
    let inverse = change(session, PLAYER, "player_designed");
    let Op::RenameEmpire {
        country: PLAYER,
        name,
        value: Some(value),
        custom_name: true,
    } = inverse
    else {
        panic!("{inverse:?}");
    };
    assert_eq!(name, "United Nations of Earth 2");
    assert!(value.contains("key=\"EMPIRE_DESIGN_humans1\""), "{value}");
}

#[test]
fn an_ai_empire_s_generated_name_changes_and_the_header_and_meta_stay() {
    let inverse = change(open_4_5(), AI, "ai_generated");
    let Op::RenameEmpire {
        value: Some(value),
        custom_name: false,
        ..
    } = inverse
    else {
        panic!("{inverse:?}");
    };
    assert!(value.contains("variables="), "{value}");

    let mut renamed = open_4_5();
    renamed.apply(rename(AI, NEW_NAME)).expect("apply");
    assert_eq!(header_name(&renamed), "Test Empire");
    assert_eq!(renamed.doc().meta(), renamed.doc().original_meta());
}

#[test]
fn a_primitive_can_be_renamed() {
    let mut session = open_4_5();
    round_trip_step(&mut session, "primitive", rename(PRIMITIVE, NEW_NAME));
    let primitive = country(&session.graph().countries, PRIMITIVE);
    assert_eq!(primitive.name, literal(NEW_NAME));
    assert_eq!(primitive.country_type, "primitive");
}

#[test]
fn a_renamed_player_reads_back_from_the_file() {
    let mut session = open_4_5();
    session.apply(rename(PLAYER, NEW_NAME)).expect("apply");
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("renamed.sav");
    session.save_as(&path).expect("save");

    let reopened = Session::open(&path).expect("reopen");
    assert_eq!(
        country(&reopened.graph().countries, PLAYER).name,
        literal(NEW_NAME)
    );
    assert_eq!(meta_name(reopened.doc().meta()), NEW_NAME);
    assert_eq!(header_name(&reopened), NEW_NAME);
}

#[test]
fn a_rename_is_refused_where_nothing_would_change_or_the_name_cannot_be_written() {
    let mut session = open_4_5();
    let error = session
        .apply(rename(PLAYER, "Test Empire"))
        .expect_err("unchanged");
    assert!(
        matches!(error, OpError::Unchanged { ref what, .. } if *what == format!("country {PLAYER}")),
        "{error:?}"
    );
    assert!(matches!(
        session.apply(rename(999_999, NEW_NAME)),
        Err(OpError::UnknownCountry(999_999))
    ));
    for bad in ["", "The \"Quoted\" Realm", "Back\\slash", "Two\nLines"] {
        let error = session.apply(rename(AI, bad)).unwrap_err();
        assert!(
            matches!(
                error,
                OpError::EmptyText { .. } | OpError::InvalidText { .. }
            ),
            "{bad:?}: {error:?}"
        );
    }
    let error = session
        .apply(Op::RenameEmpire {
            country: AI,
            name: NEW_NAME.to_owned(),
            value: Some("{ key=\"X\"".to_owned()),
            custom_name: true,
        })
        .unwrap_err();
    assert!(matches!(error, OpError::InvalidText { .. }), "{error:?}");
    let error = session
        .apply(Op::RenameEmpire {
            country: AI,
            name: NEW_NAME.to_owned(),
            value: Some("\"abc".to_owned()),
            custom_name: true,
        })
        .unwrap_err();
    assert!(matches!(error, OpError::InvalidText { .. }), "{error:?}");
    assert!(!session.doc().is_dirty());
}

#[test]
fn a_batch_renaming_the_player_twice_undoes_to_the_original_meta() {
    let mut session = open_4_5();
    let batch = Op::Batch {
        description: "Rename the player twice".to_owned(),
        ops: vec![rename(PLAYER, "First Name"), rename(PLAYER, NEW_NAME)],
    };
    session.apply(batch).expect("apply");
    assert_eq!(meta_name(session.doc().meta()), NEW_NAME);
    assert_eq!(header_name(&session), NEW_NAME);
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.doc().meta(), session.doc().original_meta());
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_3_4_player_s_one_line_name_becomes_a_literal() {
    let session = open_3_4();
    assert_eq!(header_name(&session), "United Nations of Earth 6");
    change(session, PLAYER, "player_3_4");
}

#[test]
fn a_3_4_empire_is_marked_custom_after_its_adjective() {
    let mut session = open_3_4();
    let result = round_trip_step(&mut session, "3.4 AI", rename(AI, NEW_NAME));
    let Op::RenameEmpire { custom_name, .. } = &result.inverse else {
        panic!("{:?}", result.inverse);
    };
    assert!(!*custom_name);
    let text = String::from_utf8_lossy(&current(&session)).into_owned();
    let at = text
        .find(&format!("key=\"{NEW_NAME}\""))
        .expect("the new name");
    let after = &text[at..];
    let adjective = after.find("\t\tadjective=").expect("the adjective");
    let mark = after.find("\t\tcustom_name=yes\n").expect("the mark");
    assert!(adjective < mark, "{}", &after[..mark + 20]);
}

#[test]
fn a_rename_reaches_the_app_as_an_edit_of_the_country() {
    let mut session = open_4_5();
    let result = session.apply(rename(PLAYER, NEW_NAME)).expect("rename");
    let edit = session.edit_result(result);
    assert!(
        edit.touched_entities
            .contains(&EntityAddr::new(EntityKind::Country, PLAYER)),
        "{:?}",
        edit.touched_entities
    );
}
