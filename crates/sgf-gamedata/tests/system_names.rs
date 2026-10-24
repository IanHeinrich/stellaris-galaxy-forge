//! Systems in the undo list and the Issues tab are named by the install's localisation, as
//! the map names them.

use crate::common;

use sgf_core::validate::{IssueCode, validate};

/// Kazam (216) on the 4.5 sample is named `SPEC_Kazam_system`, which the game shows as "Kaz".
const KAZAM: u32 = 216;
/// Gas giant 10 of Alari (169).
const GIANT: u32 = 10;

const INSTALL: [(&str, &str); 2] = [
    ("common/defines/00_defines.txt", ""),
    (
        "localisation/english/names_l_english.yml",
        "l_english:\n SPEC_Kazam_system:0 \"Kaz\"\n",
    ),
];

#[test]
fn a_paste_and_a_nebula_issue_name_the_system_as_the_install_does() {
    let (_dir, gd) = common::hand_written(&INSTALL);
    let mut session = common::open_4_5();
    session.set_names(gd.loc.session_names());

    let save = session.save("pasting planets").expect("a save");
    let copies = save.copy_bodies(&[GIANT]).expect("a copy");
    let op = save.paste_bodies_op(KAZAM, &copies, None).expect("a paste");
    let description = session.apply(op).expect("the paste").entry.description;
    assert!(
        description.starts_with("Added planet #") && description.contains(" to Kaz #216 "),
        "{description}"
    );

    let mut graph = session.graph().clone();
    let (x, y) = (graph.nebulae[0].x, graph.nebulae[0].y);
    let kazam = graph.systems.get_mut(&KAZAM).expect("Kazam");
    (kazam.x, kazam.y) = (x, y);
    let messages: Vec<String> = validate(&graph)
        .into_iter()
        .filter(|issue| issue.code == IssueCode::NebulaMembership && issue.systems == [KAZAM])
        .map(|issue| issue.message)
        .collect();
    assert_eq!(messages.len(), 1, "{messages:?}");
    assert!(
        messages[0].starts_with("system 216 (Kaz) "),
        "{}",
        messages[0]
    );
}
