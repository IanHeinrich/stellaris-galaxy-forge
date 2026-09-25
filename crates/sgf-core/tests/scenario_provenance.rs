//! The `# created by` line a scenario opens with: what an export and a new scenario
//! start with, and how saving an edited scenario wraps the line of whoever wrote it last.

use std::path::Path;

use sgf_core::VERSION;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::export::{NAME, SAVE_FILE, exported_as, no_names, no_sources};
use common::fixture::PAINTED;

const PAINT_LINE: &str = "#\u{200B} created by Paint a Galaxy 1.4.2 (imported from generic txt)";

fn forge() -> String {
    format!("#\u{200B} created by Stellaris Galaxy Forge {VERSION}")
}

fn nudge() -> Op {
    Op::MoveSystem {
        id: 0,
        x: 12.5,
        y: -40.0,
    }
}

fn written(dir: &Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

/// `bytes` opened from a file, nudged once and saved in place: what the file then holds.
fn saved_after_a_nudge(bytes: &[u8]) -> Vec<u8> {
    let dir = tempfile::tempdir().unwrap();
    let path = written(dir.path(), "scenario.txt", bytes);
    let mut session = Session::open(&path).expect("open the scenario");
    session.apply(nudge()).expect("move a system");
    session.save_to(None).expect("save in place");
    std::fs::read(&path).unwrap()
}

/// The first line of `bytes`, without its line end.
fn first_line(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.lines().next().expect("a first line").to_owned()
}

fn with_first_line(line: &str, rest: &[u8]) -> Vec<u8> {
    let mut bytes = format!("{line}\n").into_bytes();
    bytes.extend_from_slice(rest);
    bytes
}

#[test]
fn saving_an_edited_scenario_wraps_the_line_of_whoever_wrote_it_last() {
    let plain = PAINTED.bytes();
    let unstamped = saved_after_a_nudge(&plain);
    assert!(unstamped.starts_with(b"static_galaxy_scenario = {"));

    for (line, wrapped) in [
        (
            PAINT_LINE,
            "Paint a Galaxy 1.4.2 (imported from generic txt)",
        ),
        (
            "#\u{200B} created by Stellaris Galaxy Forge 0.0.1 (converted from save x.sav)",
            "Stellaris Galaxy Forge 0.0.1 (converted from save x.sav)",
        ),
        (
            "#\u{200B} created by Stellaris Galaxy Forge 0.0.1",
            "Stellaris Galaxy Forge 0.0.1",
        ),
    ] {
        let saved = saved_after_a_nudge(&with_first_line(line, &plain));
        let expected = format!("{} (imported from txt created by {wrapped})", forge());
        assert_eq!(
            String::from_utf8(saved).unwrap(),
            String::from_utf8(with_first_line(&expected, &unstamped)).unwrap(),
            "{line}"
        );
    }

    let dir = tempfile::tempdir().unwrap();
    let path = written(
        dir.path(),
        "chain.txt",
        &with_first_line(PAINT_LINE, &plain),
    );
    let mut session = Session::open(&path).expect("open the scenario");
    session.apply(nudge()).expect("move a system");
    session.save_to(None).expect("save");
    let once = std::fs::read(&path).unwrap();
    session
        .apply(Op::MoveSystem {
            id: 1,
            x: 5.0,
            y: 5.0,
        })
        .expect("move another");
    session.save_to(None).expect("save again");
    let mut reopened = Session::open(&path).expect("reopen");
    reopened.apply(nudge()).expect("move it back and forth");
    reopened.save_to(None).expect("save the reopened file");
    let text = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(
        text.matches("#\u{200B} created by").count(),
        1,
        "{}",
        &text[..300]
    );
    assert_eq!(
        text.lines().next(),
        String::from_utf8(once).unwrap().lines().next()
    );
}

/// A `# created by` line naming `writers`, newest first, each wrapping the next.
fn chain(writers: &[&str]) -> String {
    format!(
        "#\u{200B} created by {}{}",
        writers.join(" (imported from txt created by "),
        ")".repeat(writers.len() - 1)
    )
}

#[test]
fn a_long_line_keeps_the_newest_writers_and_the_original_one() {
    let origin = "Paint a Galaxy 1.0 (imported from generic txt)";
    let writers: Vec<String> = (1..10)
        .map(|i| match i % 2 {
            0 => format!("Paint a Galaxy 1.{i}"),
            _ => format!("Stellaris Galaxy Forge 0.0.{i}"),
        })
        .rev()
        .collect();
    let mut ten: Vec<&str> = writers.iter().map(String::as_str).collect();
    ten.push(origin);
    let this = format!("Stellaris Galaxy Forge {VERSION}");

    let saved = saved_after_a_nudge(&with_first_line(&chain(&ten), &PAINTED.bytes()));
    let line = first_line(&saved);
    let mut kept = vec![this.as_str()];
    kept.extend(&ten[..7]);
    kept.extend(["...", origin]);
    assert_eq!(line, chain(&kept));
    assert_eq!(line.matches("created by").count(), 10);

    let mut elided = vec!["Stellaris Galaxy Forge 0.0.1"];
    elided.extend(&ten[..7]);
    elided.extend(["...", origin]);
    let saved = saved_after_a_nudge(&with_first_line(&chain(&elided), &PAINTED.bytes()));
    let line = first_line(&saved);
    let mut kept = vec![this.as_str()];
    kept.extend(&elided[..7]);
    kept.extend(["...", origin]);
    assert_eq!(line, chain(&kept));
    assert_eq!(line.matches("...").count(), 1);

    let mut beta = ten.clone();
    beta[4] = "Paint a Galaxy 1.4 (beta)";
    let odd = chain(&beta);
    let saved = saved_after_a_nudge(&with_first_line(&odd, &PAINTED.bytes()));
    let line = first_line(&saved);
    let whole = odd.strip_prefix("#\u{200B} created by ").unwrap();
    assert_eq!(
        line,
        format!("{} (imported from txt created by {whole})", forge())
    );
    assert!(!line.contains("..."));
}

#[test]
fn a_scenario_neither_tool_made_gains_no_line_and_an_undone_edit_changes_nothing() {
    let saved = String::from_utf8(saved_after_a_nudge(&PAINTED.bytes())).unwrap();
    assert!(!saved.contains("#\u{200B} created by"), "{}", &saved[..200]);

    let typed = with_first_line("# created by hand", &PAINTED.bytes());
    let saved = String::from_utf8(saved_after_a_nudge(&typed)).unwrap();
    assert!(
        saved.starts_with("# created by hand\n") && !saved.contains('\u{200B}'),
        "{}",
        &saved[..200]
    );

    let stamped = with_first_line(PAINT_LINE, &PAINTED.bytes());
    let dir = tempfile::tempdir().unwrap();
    let path = written(dir.path(), "undone.txt", &stamped);
    let mut session = Session::open(&path).expect("open the scenario");
    session.apply(nudge()).expect("move a system");
    session.undo().expect("undo").expect("an op to undo");
    let copy = dir.path().join("copy.txt");
    session.save_as(&copy).expect("save as");
    assert_eq!(std::fs::read(&copy).unwrap(), stamped);
}

#[test]
fn a_scenario_forge_wrote_before_the_line_gains_one_above_its_old_comments() {
    let plain = PAINTED.bytes();
    let unstamped = saved_after_a_nudge(&plain);
    for old in [
        "# Exported by Stellaris Galaxy Forge from x.sav",
        "# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.",
    ] {
        let saved = saved_after_a_nudge(&with_first_line(old, &plain));
        let expected = with_first_line(
            &format!(
                "{} (imported from txt created by an earlier Stellaris Galaxy Forge)\n{old}",
                forge()
            ),
            &unstamped,
        );
        assert_eq!(
            String::from_utf8(saved).unwrap(),
            String::from_utf8(expected).unwrap()
        );
    }
}

#[test]
fn the_line_keeps_a_byte_order_mark_and_crlf_line_endings() {
    let crlf = PAINTED.text().replace('\n', "\r\n");
    let legacy = format!("# Exported by Stellaris Galaxy Forge from x.sav\r\n{crlf}");
    let saved = String::from_utf8(saved_after_a_nudge(legacy.as_bytes())).unwrap();
    assert!(
        saved.starts_with(&format!(
            "{} (imported from txt created by an earlier Stellaris Galaxy Forge)\r\n# Exported by Stellaris Galaxy Forge from x.sav\r\nstatic_galaxy_scenario = {{\r\n",
            forge()
        )),
        "{:?}",
        &saved[..200]
    );

    let wrapped = format!("{PAINT_LINE}\r\n{crlf}");
    let saved = String::from_utf8(saved_after_a_nudge(wrapped.as_bytes())).unwrap();
    assert!(
        saved.starts_with(&format!(
            "{} (imported from txt created by Paint a Galaxy 1.4.2 (imported from generic txt))\r\nstatic_galaxy_scenario = {{\r\n",
            forge()
        )),
        "{:?}",
        &saved[..200]
    );

    let mut bom = b"\xEF\xBB\xBF".to_vec();
    bom.extend(with_first_line(PAINT_LINE, &PAINTED.bytes()));
    let saved = saved_after_a_nudge(&bom);
    let mut expected = b"\xEF\xBB\xBF".to_vec();
    expected.extend(with_first_line(
        &format!(
            "{} (imported from txt created by Paint a Galaxy 1.4.2 (imported from generic txt))",
            forge()
        ),
        &saved_after_a_nudge(&PAINTED.bytes()),
    ));
    assert_eq!(saved, expected);

    let legacy = "# Exported by Stellaris Galaxy Forge from x.sav";
    let mut bom = b"\xEF\xBB\xBF".to_vec();
    bom.extend(with_first_line(legacy, &PAINTED.bytes()));
    let saved = saved_after_a_nudge(&bom);
    let mut expected = b"\xEF\xBB\xBF".to_vec();
    expected.extend(with_first_line(
        &format!(
            "{} (imported from txt created by an earlier Stellaris Galaxy Forge)\n{legacy}",
            forge()
        ),
        &saved_after_a_nudge(&PAINTED.bytes()),
    ));
    assert_eq!(saved, expected);
}

#[test]
fn a_save_exports_with_the_line_on_top_under_both_profiles() {
    let save = common::open();
    let converted = format!("{} (converted from save {SAVE_FILE})\n", forge());
    for profile in [ScenarioProfile::Plain, ScenarioProfile::PaintAGalaxy] {
        let (text, _) = exported_as(&save, NAME, profile);
        let text = String::from_utf8(text).unwrap();
        assert!(text.starts_with(&converted), "{}", &text[..300]);
        assert_eq!(text.matches("#\u{200B} created by").count(), 1);
        assert!(!text.contains("# Exported by"));
        assert_eq!(
            text.contains(
                "\n# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.\nstatic_galaxy_scenario = {\n"
            ),
            profile == ScenarioProfile::PaintAGalaxy,
            "{}",
            &text[..300]
        );
    }

    let options = export::ScenarioOptions {
        exported_from: Some("odd (name)\r\n.sav".to_owned()),
        ..export::options_for(&save.graph, NAME)
    };
    let (text, _) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    assert!(
        text.starts_with(format!("{} (converted from save odd name.sav)\n", forge()).as_bytes())
    );

    let unnamed = export::options_for(&save.graph, NAME);
    let (text, _) = export::scenario_text(
        &save.graph,
        &unnamed,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    assert!(text.starts_with(format!("{}\nstatic_galaxy_scenario = {{\n", forge()).as_bytes()));
}

#[test]
fn a_new_scenario_starts_with_a_bare_line_that_saving_keeps() {
    for profile in [ScenarioProfile::Plain, ScenarioProfile::PaintAGalaxy] {
        let mut session = export::new_scenario("sgf_test", 0.0, profile).expect("new scenario");
        let bare = format!("{}\n", forge());
        assert!(common::text(&session).starts_with(&bare));

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fresh.txt");
        session.save_as(&path).expect("save the new scenario");
        let mut reopened = Session::open(&path).expect("reopen");
        reopened
            .apply(Op::AddSystem {
                id: None,
                x: 20.0,
                y: -30.5,
                name: Some("Alderaan".to_owned()),
                initializer: None,
                spawn_weight: None,
                spawn_script: None,
            })
            .expect("add a system");
        reopened.save_to(None).expect("save the edit");
        let text = String::from_utf8(std::fs::read(&path).unwrap()).unwrap();
        assert!(text.starts_with(&bare), "{}", &text[..200]);
        assert_eq!(text.matches("#\u{200B} created by").count(), 1);
        assert!(text.contains("Alderaan"));
    }
}
