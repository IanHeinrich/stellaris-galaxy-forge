//! The edits that read the install: `nebula add` and `planet-class`.
use crate::common::{SAMPLE, SAMPLE_4_5, edited, ok, sgf, stdout, without_install};

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

/// Without `--name` a nebula is named as the app names one, from the save's pool first. An
/// `--install` that cannot be read is refused.
#[test]
fn nebula_add_without_a_name_is_named_as_the_app_names_one() {
    let dir = tempfile::tempdir().unwrap();
    let add = |out: &str, extra: &[&str]| {
        let out = dir.path().join(out);
        let mut args = vec!["nebula", "add", SAMPLE_4_5, "-57.5", "-305", "40"];
        args.extend_from_slice(extra);
        args.extend_from_slice(&["-o", out.to_str().unwrap()]);
        sgf(&args)
    };

    let saved = add("pooled.sav", &["--no-mods"]);
    ok(&saved);
    let text = stdout(&saved);
    let text = text.lines().next().unwrap_or_default();
    assert!(text.starts_with("Added nebula \""), "{text}");
    assert!(
        !text.starts_with("Added nebula \"\""),
        "a name from the pool: {text}"
    );

    let no_install = dir.path().join("no-install");
    std::fs::create_dir(&no_install).unwrap();
    let refused = add("never.sav", &["--install", no_install.to_str().unwrap()]);
    assert_eq!(refused.status.code(), Some(1));
    let err = String::from_utf8_lossy(&refused.stderr);
    assert!(err.contains("no Stellaris install found"), "{err}");
    assert!(!dir.path().join("never.sav").exists());
}

/// The install says what each class is: a barren world may become an ocean world.
#[test]
fn planet_class_writes_the_new_class() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("class.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&[
        "planet-class",
        SAMPLE_4_5,
        "585",
        "pc_ocean",
        "--no-mods",
        "-o",
        out_str,
    ]);
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
}
