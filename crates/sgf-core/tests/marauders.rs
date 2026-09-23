//! The marauder clans a map places by initializer: which systems are a clan's home and
//! its raid bases, the next clan free to place, and the issues a scenario raises when a
//! clan has two homes, a base has no home beside it, or a home stands beside a seat.

use sgf_core::format::scenario::marauder::{
    CLANS, MarauderRole, clan_count, home_initializer, homes, next_free_clan,
};
use sgf_core::ops::Op;
use sgf_core::validate::{Issue, IssueCode, Severity};

mod common;
use common::fixture::{EXPORTED_PAINT, PAINTED};

const VOID: &str = "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" }";
const UNNAMED: &str = "id = \"11\" position = { x = -150 y = -30 } }";
const INGRESS: &str = "id = \"7\" position = { x = 20 y = -20 } name = \"Ingress\"";
const EGRESS: &str = "id = \"8\" position = { x = -160 y = -160 } name = \"Egress\"";

fn coded(issues: &[Issue], code: IssueCode) -> Vec<&Issue> {
    issues.iter().filter(|issue| issue.code == code).collect()
}

fn marauder_issues(issues: &[Issue]) -> Vec<&Issue> {
    issues
        .iter()
        .filter(|issue| {
            matches!(
                issue.code,
                IssueCode::MarauderHomeDuplicate
                    | IssueCode::MarauderBaseOrphan
                    | IssueCode::MarauderNearSeat
            )
        })
        .collect()
}

#[test]
fn two_homes_of_one_clan_are_reported_together_and_only_one_spawns() {
    let session = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            UNNAMED,
            "id = \"11\" position = { x = -150 y = -30 } initializer = marauder_1_1 }",
        ),
    ]);
    assert_eq!(
        session.system(10).and_then(|s| s.marauder),
        Some(MarauderRole::Home(1))
    );
    assert_eq!(homes(&session.graph).get(&1), Some(&vec![10, 11]));
    assert_eq!(clan_count(&session.graph), 1);
    let issues = session.validate();
    let duplicate = coded(&issues, IssueCode::MarauderHomeDuplicate);
    assert_eq!(duplicate.len(), 1, "{issues:?}");
    assert_eq!(
        duplicate[0].message,
        "Marauder clan 1 has two homes: Void and #11. Only one spawns."
    );
    assert_eq!(duplicate[0].severity, Severity::Warning);
    assert_eq!(duplicate[0].systems, [10, 11]);
    assert!(coded(&issues, IssueCode::MarauderBaseOrphan).is_empty());
    assert!(coded(&issues, IssueCode::MarauderNearSeat).is_empty());
}

#[test]
fn a_raid_base_with_no_home_of_its_clan_beside_it_is_an_orphan() {
    let orphaned = PAINTED.open_edited(&[(
        EGRESS,
        "id = \"8\" position = { x = -160 y = -160 } name = \"Egress\" initializer = marauder_2_2",
    )]);
    assert_eq!(
        orphaned.system(8).and_then(|s| s.marauder),
        Some(MarauderRole::Base(2))
    );
    let issues = orphaned.validate();
    let orphan = coded(&issues, IssueCode::MarauderBaseOrphan);
    assert_eq!(orphan.len(), 1, "{issues:?}");
    assert_eq!(
        orphan[0].message,
        "Egress is an outpost of clan 2 with no clan home beside it. Nothing spawns there."
    );
    assert_eq!(orphan[0].severity, Severity::Warning);
    assert_eq!(orphan[0].systems, [8]);

    let beside_home = PAINTED.open_edited(&[
        (
            EGRESS,
            "id = \"8\" position = { x = -160 y = -160 } name = \"Egress\" initializer = marauder_2_2",
        ),
        (
            UNNAMED,
            "id = \"11\" position = { x = -150 y = -30 } initializer = marauder_2_1 }",
        ),
    ]);
    let issues = beside_home.validate();
    assert!(marauder_issues(&issues).is_empty(), "{issues:?}");

    let wrong_clan = PAINTED.open_edited(&[
        (
            EGRESS,
            "id = \"8\" position = { x = -160 y = -160 } name = \"Egress\" initializer = marauder_2_2",
        ),
        (
            UNNAMED,
            "id = \"11\" position = { x = -150 y = -30 } initializer = marauder_1_1 }",
        ),
    ]);
    assert_eq!(
        coded(&wrong_clan.validate(), IssueCode::MarauderBaseOrphan).len(),
        1
    );
}

#[test]
fn a_home_beside_a_seat_is_worth_a_look_on_a_painted_map() {
    let session = PAINTED.open_edited(&[(
        VOID,
        "id = \"10\" position = { x = 130 y = 40 } name = \"Void\" initializer = marauder_1_1 }",
    )]);
    let issues = session.validate();
    let near = coded(&issues, IssueCode::MarauderNearSeat);
    assert_eq!(near.len(), 1, "{issues:?}");
    assert_eq!(
        near[0].message,
        "Marauder clan 1's home Void is within 30 of the seat Beta. Raids hit that empire first."
    );
    assert_eq!(near[0].severity, Severity::Info);
    assert_eq!(near[0].systems, [10, 1]);
    assert!(coded(&issues, IssueCode::MarauderHomeDuplicate).is_empty());
    assert!(coded(&issues, IssueCode::MarauderBaseOrphan).is_empty());

    let clear = PAINTED.open_edited(&[(
        VOID,
        "id = \"10\" position = { x = 150 y = 40 } name = \"Void\" initializer = marauder_1_1 }",
    )]);
    assert!(coded(&clear.validate(), IssueCode::MarauderNearSeat).is_empty());
}

#[test]
fn the_next_free_clan_is_the_lowest_without_a_home_and_an_op_keeps_the_role_in_step() {
    assert_eq!(CLANS, 3);
    let plain = PAINTED.open();
    assert!(homes(&plain.graph).is_empty());
    assert_eq!(clan_count(&plain.graph), 0);
    assert_eq!(next_free_clan(&plain.graph), Some(1));

    let two = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            UNNAMED,
            "id = \"11\" position = { x = -150 y = -30 } initializer = marauder_2_1 }",
        ),
    ]);
    assert_eq!(clan_count(&two.graph), 2);
    assert_eq!(next_free_clan(&two.graph), Some(3));

    let three = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            UNNAMED,
            "id = \"11\" position = { x = -150 y = -30 } initializer = marauder_2_1 }",
        ),
        (
            INGRESS,
            "id = \"7\" position = { x = 20 y = -20 } name = \"Ingress\" initializer = marauder_3_1",
        ),
    ]);
    assert_eq!(clan_count(&three.graph), 3);
    assert_eq!(next_free_clan(&three.graph), None);

    let mut session = PAINTED.open();
    session
        .apply(Op::SetInitializer {
            id: 10,
            initializer: Some(home_initializer(3)),
        })
        .expect("set the initializer");
    assert_eq!(
        session.system(10).and_then(|s| s.marauder),
        Some(MarauderRole::Home(3))
    );
    assert_eq!(homes(&session.graph).get(&3), Some(&vec![10]));
    assert_eq!(next_free_clan(&session.graph), Some(1));
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(session.system(10).and_then(|s| s.marauder), None);
}

#[test]
fn the_sample_saves_two_clans_read_from_their_initializers_and_raise_no_issue() {
    let save = common::open();
    let role = |id: u32| save.system(id).expect("a system").marauder;
    assert_eq!(role(13), Some(MarauderRole::Home(1)));
    assert_eq!(role(520), Some(MarauderRole::Base(1)));
    assert_eq!(role(574), Some(MarauderRole::Base(1)));
    assert_eq!(role(12), Some(MarauderRole::Home(2)));
    assert_eq!(role(76), Some(MarauderRole::Base(2)));
    assert_eq!(role(435), Some(MarauderRole::Base(2)));
    assert_eq!(
        save.graph
            .systems
            .values()
            .filter(|s| s.marauder.is_some())
            .count(),
        6
    );
    assert_eq!(homes(&save.graph).get(&1), Some(&vec![13]));
    assert_eq!(homes(&save.graph).get(&2), Some(&vec![12]));
    assert_eq!(clan_count(&save.graph), 2);
    assert_eq!(next_free_clan(&save.graph), Some(3));
    let issues = save.validate();
    assert!(marauder_issues(&issues).is_empty(), "{issues:?}");
}

#[test]
fn a_home_with_two_raid_bases_hyperlaned_to_it_raises_no_issue() {
    let session = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            "initializer = random_empire_init_02",
            "initializer = marauder_1_2",
        ),
        (
            "initializer = random_empire_init_03",
            "initializer = marauder_1_3",
        ),
    ]);
    let issues = session.validate();
    assert!(
        coded(&issues, IssueCode::MarauderBasesMissing).is_empty(),
        "{issues:?}"
    );
}

#[test]
fn a_home_with_one_raid_base_beside_it_is_reported_with_one() {
    let session = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            "initializer = random_empire_init_02",
            "initializer = marauder_1_2",
        ),
    ]);
    let issues = session.validate();
    let missing = coded(&issues, IssueCode::MarauderBasesMissing);
    assert_eq!(missing.len(), 1, "{issues:?}");
    assert_eq!(
        missing[0].message,
        "Void is the marauder clan 1 home with one outpost beside it. A clan is its home and two outposts hyperlaned to it."
    );
    assert_eq!(missing[0].severity, Severity::Info);
    assert_eq!(missing[0].systems, [10]);
}

#[test]
fn a_home_with_two_bases_but_one_not_hyperlaned_still_raises_the_issue() {
    let session = PAINTED.open_edited(&[
        (
            VOID,
            "id = \"10\" position = { x = 150 y = -30 } name = \"Void\" initializer = marauder_1_1 }",
        ),
        (
            "initializer = random_empire_init_02",
            "initializer = marauder_1_2",
        ),
        (
            "initializer = custom_starting_init_01",
            "initializer = marauder_1_3",
        ),
    ]);
    let issues = session.validate();
    let missing = coded(&issues, IssueCode::MarauderBasesMissing);
    assert_eq!(missing.len(), 1, "{issues:?}");
    assert_eq!(
        missing[0].message,
        "Void is the marauder clan 1 home with one outpost beside it. A clan is its home and two outposts hyperlaned to it."
    );
    assert_eq!(missing[0].severity, Severity::Info);
    assert_eq!(missing[0].systems, [10]);
}

#[test]
fn the_paint_fixture_exports_both_clans_complete_and_raises_no_bases_missing_issue() {
    let session = EXPORTED_PAINT.open();
    assert_eq!(homes(&session.graph).get(&1), Some(&vec![13]));
    assert_eq!(homes(&session.graph).get(&2), Some(&vec![12]));
    let issues = session.validate();
    assert!(
        coded(&issues, IssueCode::MarauderBasesMissing).is_empty(),
        "{issues:?}"
    );
}
