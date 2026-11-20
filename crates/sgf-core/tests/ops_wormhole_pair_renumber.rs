//! A save an editor before 0.27.4 broke: it took a new bypass's id as the highest id plus
//! one, which after a reused slot is a low slot one generation on, beside the live row the
//! game keeps there. The game crashes on such a save while it loads. The validator names
//! it, and a natural wormhole pair is written again at fresh ids as one undo step.

use sgf_core::ops::{Op, PairPoints};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

use crate::common;
use crate::ops_add_megastructure::{add as add_megastructure, at_point};
use common::diff::snapshot_step;
use common::edit::{
    bypass_ids, bypass_table, open_4_5_edited, replace_once, reuse_bypass_slot_1, system_text,
};
use common::{current, from_text, wormhole, wormholes};

const SLOT_MASK: u32 = (1 << 24) - 1;

/// `session` reopened from its bytes once `edit` has rewritten its gamestate.
fn reopened(session: &Session, edit: impl FnOnce(&mut String)) -> Session {
    let mut text = String::from_utf8(current(session)).expect("utf-8");
    edit(&mut text);
    from_text(text, session.doc().meta().to_vec())
}

/// The 4.5 sample's gamestate with bypass slot 21, one end of the wormhole to 22, reused
/// one generation on as `16777237`.
fn reuse_bypass_slot_21(gamestate: &mut String) {
    replace_once(
        gamestate,
        "\n\t21=\n\t{\n\t\ttype=\"wormhole\"",
        "\n\t16777237=\n\t{\n\t\ttype=\"wormhole\"",
    );
    replace_once(gamestate, "\t\tbypass=21\n", "\t\tbypass=16777237\n");
    replace_once(gamestate, "\t\tlinked_to=21\n", "\t\tlinked_to=16777237\n");
    replace_once(
        gamestate,
        "\t\tbypasses=\n\t\t{\n\t\t\t21 \n",
        "\t\tbypasses=\n\t\t{\n\t\t\t16777237 \n",
    );
    let start = gamestate
        .find("\nbypasses=\n{\n")
        .expect("a bypasses table");
    let end = start + bypass_table(gamestate).len();
    let table = gamestate[start..end].replace("\t\t\t21 \n", "\t\t\t16777237 \n");
    gamestate.replace_range(start..end, &table);
}

/// The pair an editor before 0.27.4 added between Xu Nur (1) and Tharbarite (140) to the
/// 4.5 sample as `reuse` left it, at bypasses `first` and `first + 1`: one past the highest
/// id. Written by today's add, at 23 and 24, and then numbered as the old allocator did.
fn broken_pair(reuse: fn(&mut String), first: u32) -> Session {
    let mut session = open_4_5_edited(reuse);
    session
        .apply(Op::AddWormholePair {
            a: 1,
            b: 140,
            at: None,
        })
        .expect("the pair");
    let second = first + 1;
    reopened(&session, |text| {
        let row = |id: u32| format!("\n\t{id}=\n\t{{\n\t\ttype=\"wormhole\"");
        for (from, to) in [
            (row(23), row(first)),
            (row(24), row(second)),
            (
                "\t\tlinked_to=24\n".to_owned(),
                format!("\t\tlinked_to={second}\n"),
            ),
            (
                "\t\tlinked_to=23\n".to_owned(),
                format!("\t\tlinked_to={first}\n"),
            ),
            (
                "\t\tbypass=23\n".to_owned(),
                format!("\t\tbypass={first}\n"),
            ),
            (
                "\t\tbypass=24\n".to_owned(),
                format!("\t\tbypass={second}\n"),
            ),
        ] {
            replace_once(text, &from, &to);
        }
    })
}

/// Bypasses `16777218` and `16777219`: slots 2 and 3 one generation on, beside the live
/// L-Gate 2 and gateway 3.
fn both_ends_shared() -> Session {
    broken_pair(reuse_bypass_slot_1, 16_777_218)
}

/// Bypass row `id`'s text as `text` holds it.
fn bypass_row(text: &str, id: u32) -> String {
    let table = bypass_table(text);
    let key = format!("\n\t{id}=\n\t{{\n");
    let start = table.find(&key).unwrap_or_else(|| panic!("bypass {id}"));
    let row = &table[start..];
    row[..row.find("\n\t}").expect("its end") + 3].to_owned()
}

fn renumber(session: &Session, a: u32, b: u32) -> Result<Op, String> {
    session
        .save("renumbering a wormhole")
        .and_then(|queries| queries.renumber_wormhole_op(a, b))
        .map_err(|e| e.to_string())
}

#[test]
fn a_pair_beside_live_slots_is_an_error_until_it_is_renumbered() {
    let mut session = both_ends_shared();
    let broken = current(&session);
    let shared = common::coded(&session.validate(), IssueCode::BypassSlotShared)
        .into_iter()
        .cloned()
        .collect::<Vec<_>>();
    assert_eq!(shared.len(), 1, "one issue for the pair: {shared:?}");
    assert_eq!(shared[0].severity, Severity::Error);
    assert_eq!(shared[0].systems, [1, 140]);
    assert_eq!(
        shared[0].message,
        "The wormhole between Xu Nur #1 and Tharbarite system #140 uses an id the game already uses, so the game crashes on load."
    );

    let op = renumber(&session, 140, 1).expect("the fix");
    let Op::Batch { description, ops } = &op else {
        panic!("a batch: {op:?}");
    };
    assert_eq!(
        description,
        "Renumbered the wormhole between Xu Nur #1 and Tharbarite system #140"
    );
    assert_eq!(
        ops,
        &[
            Op::RemoveWormholePair { a: 1, b: 140 },
            Op::AddWormholePair {
                a: 1,
                b: 140,
                at: Some(PairPoints {
                    a: (-187.71, 0.0),
                    b: (0.0, 191.0),
                }),
            },
        ]
    );
    assert_eq!(renumber(&session, 1, 140), Ok(op.clone()));

    let result = snapshot_step(&mut session, "wormhole_pair_renumbered", op);
    assert!(common::coded(&result.issues, IssueCode::BypassSlotShared).is_empty());
    let ids = bypass_ids(&session);
    let mut slots: Vec<u32> = ids.iter().map(|id| id & SLOT_MASK).collect();
    slots.sort_unstable();
    slots.dedup();
    assert_eq!(slots.len(), ids.len(), "a slot held twice: {ids:?}");
    assert!(ids.contains(&2) && ids.contains(&3) && ids.contains(&16_777_217));
    assert!(!ids.contains(&16_777_218) && !ids.contains(&16_777_219));
    assert_eq!(
        wormholes(&session, 1),
        [wormhole(17, 23, 140, -187.71, 0.0)]
    );
    assert_eq!(wormholes(&session, 140), [wormhole(18, 24, 1, 0.0, 191.0)]);
    let text = String::from_utf8(current(&session)).expect("utf-8");
    for old in ["16777218", "16777219"] {
        for key in ["linked_to", "bypass"] {
            assert!(!text.contains(&format!("\t{key}={old}\n")), "{key}={old}");
        }
        for system in [1, 140] {
            assert!(
                !system_text(&session, system).contains(old),
                "{system} names {old}"
            );
        }
    }
    let opened = String::from_utf8(broken.clone()).expect("utf-8");
    for live in [2, 3, 16_777_217] {
        assert_eq!(bypass_row(&text, live), bypass_row(&opened, live));
    }

    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("renumbered.sav");
    session.save_as(&path).expect("save_as");
    let reopened = Session::open(&path).expect("reopen");
    assert!(common::coded(&reopened.validate(), IssueCode::BypassSlotShared).is_empty());

    let undone = session.undo().expect("undo").expect("an op to undo");
    assert_eq!(current(&session), broken, "undo puts the broken bytes back");
    assert_eq!(
        common::coded(&undone.issues, IssueCode::BypassSlotShared).len(),
        1
    );
}

#[test]
fn a_pair_with_ids_of_its_own_is_not_renumbered() {
    let session = both_ends_shared();
    assert_eq!(
        renumber(&session, 489, 152),
        Err(
            "the wormhole between Ferragon #489 and Aulderaan #152 already has ids the game does not share"
                .to_owned()
        )
    );
    assert_eq!(
        renumber(&session, 1, 2),
        Err("systems 1 and 2 are not the two ends of a wormhole".to_owned())
    );
    assert_eq!(
        renumber(&session, 1, 99_999),
        Err("system 99999 does not exist".to_owned())
    );
}

#[test]
fn a_save_the_game_wrote_raises_no_shared_slot() {
    for session in [
        common::open(),
        common::open_4_5(),
        open_4_5_edited(reuse_bypass_slot_1),
    ] {
        assert!(common::coded(&session.validate(), IssueCode::BypassSlotShared).is_empty());
    }
}

/// A gateway an editor before 0.27.4 added in Dristmak (0) took bypass `16777218`, beside
/// the live L-Gate 2. Nothing renumbers a gateway, so the issue asks for it again, and
/// deleting it clears the issue.
#[test]
fn a_gateway_beside_a_live_slot_is_an_error() {
    let mut session = open_4_5_edited(reuse_bypass_slot_1);
    session
        .apply(add_megastructure(
            0,
            at_point("gateway_final", "gateway", true),
        ))
        .expect("a gateway in Dristmak");
    let mut session = reopened(&session, |text| {
        replace_once(
            text,
            "\n\t23=\n\t{\n\t\ttype=\"gateway\"",
            "\n\t16777218=\n\t{\n\t\ttype=\"gateway\"",
        );
        replace_once(text, "\t\tbypass=23\n", "\t\tbypass=16777218\n");
        replace_once(
            text,
            "\t\tbypasses=\n\t\t{\n\t\t\t23 \n",
            "\t\tbypasses=\n\t\t{\n\t\t\t16777218 \n",
        );
        let start = text.find("\nbypasses=\n{\n").expect("a bypasses table");
        let end = start + bypass_table(text).len();
        let table = text[start..end].replace(" 23 \n", " 16777218 \n");
        text.replace_range(start..end, &table);
    });
    let opened = String::from_utf8(current(&session)).expect("utf-8");
    let lgate_listed = "\t\tbypasses=\n\t\t{\n\t\t\t2 \n";
    assert_eq!(opened.matches(lgate_listed).count(), 1);

    let issues = session.validate();
    let shared = common::coded(&issues, IssueCode::BypassSlotShared);
    assert_eq!(shared.len(), 1, "{shared:?}");
    assert_eq!(shared[0].systems, [0]);
    assert_eq!(
        shared[0].message,
        "The gateway in Dristmak #0 uses an id the game already uses, so the game crashes on load. Delete it and add it again."
    );
    assert_eq!(
        renumber(&session, 0, 1),
        Err("systems 0 and 1 are not the two ends of a wormhole".to_owned())
    );

    let applied = session
        .apply(Op::DeleteMegastructure {
            megastructure: 16,
            dismantle: None,
        })
        .expect("delete the gateway");
    assert!(common::coded(&applied.issues, IssueCode::BypassSlotShared).is_empty());
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert_eq!(bypass_row(&text, 2), bypass_row(&opened, 2));
    assert_eq!(
        text.matches(lgate_listed).count(),
        1,
        "the L-Gate's system lists it"
    );
}

/// With slot 21 reused as `16777237`, the old allocator's pair took `16777238`, beside the
/// live wormhole end 22, and `16777239`, in slot 23, which nothing else holds. The one end
/// is enough to crash the game, and the renumber writes both ends past slot 23.
#[test]
fn a_pair_with_one_end_beside_a_live_slot_is_renumbered() {
    let mut session = broken_pair(reuse_bypass_slot_21, 16_777_238);
    let issues = session.validate();
    let shared = common::coded(&issues, IssueCode::BypassSlotShared);
    assert_eq!(shared.len(), 1, "{shared:?}");
    assert_eq!(shared[0].systems, [1, 140]);

    let op = renumber(&session, 1, 140).expect("the fix");
    let applied = session.apply(op).expect("the renumber");
    assert!(common::coded(&applied.issues, IssueCode::BypassSlotShared).is_empty());
    assert_eq!(
        wormholes(&session, 1),
        [wormhole(17, 24, 140, -187.71, 0.0)]
    );
    assert_eq!(wormholes(&session, 140), [wormhole(18, 25, 1, 0.0, 191.0)]);
    let ids = bypass_ids(&session);
    assert!(ids.contains(&22) && ids.contains(&16_777_237));
    assert!(!ids.contains(&16_777_238) && !ids.contains(&16_777_239));
}
