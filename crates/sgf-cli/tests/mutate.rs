//! The edits that read the install: `nebula add` and `planet-class`.
use crate::common::{SAMPLE, SAMPLE_4_5, SCENARIO, edited, ok, sgf, stdout, without_install};

#[test]
fn nebula_add_writes_a_nebula_named_as_given() {
    let (text, path) = edited(&[
        "nebula",
        "add",
        SAMPLE,
        "-57.5",
        "-305",
        "40",
        "--name",
        "SGF_Test_Nebula",
    ]);
    assert!(
        text.contains(
            "Added nebula \"SGF_Test_Nebula\" at (-57.5, -305) radius 40; 4 systems joined"
        ),
        "{text}"
    );
    assert!(path.is_file());
}

/// Without `--name` a nebula is named as the app names one: from the save's pool first, the
/// same way for the same save, and in a scenario, which has no pool, from the install or as
/// `New Nebula`. An `--install` that cannot be read is refused.
#[test]
fn nebula_add_without_a_name_is_named_as_the_app_names_one() {
    let dir = tempfile::tempdir().unwrap();
    let add = |doc: &str, out: &str, extra: &[&str]| {
        let out = dir.path().join(out);
        let mut args = vec!["nebula", "add", doc, "-57.5", "-305", "40"];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out.to_str().unwrap()]);
        sgf(&args)
    };
    let first_line = |text: &str| text.lines().next().unwrap_or_default().to_owned();

    let saved = add(SAMPLE_4_5, "pooled.sav", &[]);
    ok(&saved);
    let text = first_line(&stdout(&saved));
    assert!(text.starts_with("Added nebula \""), "{text}");
    assert!(
        !text.starts_with("Added nebula \"\""),
        "a name from the pool: {text}"
    );
    assert_eq!(
        first_line(&stdout(&add(SAMPLE_4_5, "again.sav", &[]))),
        text,
        "the same draw"
    );

    let scenario = add(SCENARIO, "scenario.txt", &[]);
    ok(&scenario);
    let text = first_line(&stdout(&scenario));
    assert!(text.starts_with("Added nebula \""), "{text}");
    assert!(!text.starts_with("Added nebula \"\""), "{text}");

    let no_install = dir.path().join("no-install");
    std::fs::create_dir(&no_install).unwrap();
    let refused = add(
        SAMPLE_4_5,
        "never.sav",
        &["--install", no_install.to_str().unwrap()],
    );
    assert_eq!(refused.status.code(), Some(1));
    let err = String::from_utf8_lossy(&refused.stderr);
    assert!(err.contains("no Stellaris install found"), "{err}");
    assert!(!dir.path().join("never.sav").exists());
}

/// The install says what each class is: a barren world may become an ocean world, and a colony
/// may not become barren.
#[test]
fn planet_class_writes_the_new_class_and_refuses_a_colony_made_barren() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("class.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["planet-class", SAMPLE_4_5, "585", "pc_ocean", "-o", out_str]);
    if without_install(&out) {
        return;
    }
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Set the class of planet #585 from pc_barren to pc_ocean"),
        "{text}"
    );
    assert_eq!(sgf(&["validate", out_str]).status.code(), Some(0));

    let refused = dir.path().join("refused.sav");
    let out = sgf(&[
        "planet-class",
        SAMPLE_4_5,
        "2",
        "pc_barren",
        "-o",
        refused.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains("planet 2 is a colony, and a colony cannot be changed to or from pc_barren"),
        "{err}"
    );
    assert!(!refused.exists());
}
