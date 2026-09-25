//! The editing commands: `move`, `nebula`, `lane` and `deposit`.
use crate::common::{SAMPLE, SAMPLE_4_5, SCENARIO, backups, ok, sgf, stdout};

#[test]
fn move_writes_the_edited_save_to_the_output_path() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("moved.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["move", SAMPLE, "0", "-150", "60", "-o", out_str]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Moved Gamma Refuge (#0) from (-144.22, 57.36) to (-150, 60)"),
        "{text}"
    );
    assert!(
        text.contains("validate: 1 warning(s), 0 error(s), 2 note(s)"),
        "{text}"
    );
    assert!(text.contains(&format!("wrote {out_str}")), "{text}");
    assert!(out_path.is_file());
    assert_eq!(backups(dir.path()).len(), 0);
}

#[test]
fn move_in_place_backs_up_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("copy.sav");
    std::fs::copy(SAMPLE, &copy).unwrap();
    let copy_str = copy.to_str().unwrap();

    let out = sgf(&["move", copy_str, "0", "-150", "60"]);
    ok(&out);
    let text = stdout(&out);
    let backups = backups(dir.path());
    assert_eq!(backups.len(), 1, "{backups:?}");
    assert!(backups[0].starts_with("copy.sav.bak-"), "{backups:?}");
    assert!(text.contains(&format!("wrote {copy_str}")), "{text}");
    assert!(text.contains("backup "), "{text}");
    assert!(text.contains(&backups[0]), "{text}");
    assert_eq!(
        std::fs::read(dir.path().join(&backups[0])).unwrap(),
        std::fs::read(SAMPLE).unwrap(),
        "backup is not the original sample"
    );
    assert_ne!(
        std::fs::read(&copy).unwrap(),
        std::fs::read(SAMPLE).unwrap()
    );
}

#[test]
fn nebula_add_remove_and_radius_write_the_edited_save() {
    let dir = tempfile::tempdir().unwrap();
    let added = dir.path().join("added.sav");
    let out = sgf(&[
        "nebula",
        "add",
        SAMPLE,
        "-57.5",
        "-305",
        "40",
        "--name",
        "SGF_Test_Nebula",
        "-o",
        added.to_str().unwrap(),
    ]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains(
            "Added nebula \"SGF_Test_Nebula\" at (-57.5, -305) radius 40; 4 systems joined"
        ),
        "{text}"
    );
    assert!(added.is_file());

    let grown = dir.path().join("grown.sav");
    let out = sgf(&[
        "nebula",
        "radius",
        added.to_str().unwrap(),
        "9",
        "50",
        "-o",
        grown.to_str().unwrap(),
    ]);
    ok(&out);
    assert!(
        stdout(&out).contains("radius to 50 (was 40)"),
        "{}",
        stdout(&out)
    );

    let removed = dir.path().join("removed.sav");
    let out = sgf(&[
        "nebula",
        "remove",
        grown.to_str().unwrap(),
        "9",
        "-o",
        removed.to_str().unwrap(),
    ]);
    ok(&out);
    assert!(
        stdout(&out).contains("Removed nebula \"SGF Test Nebula\""),
        "{}",
        stdout(&out)
    );
    assert!(removed.is_file());
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

#[test]
fn nebula_name_renames_the_cloud_and_writes_the_edited_save() {
    let dir = tempfile::tempdir().unwrap();
    let renamed = dir.path().join("renamed.sav");
    let out = sgf(&[
        "nebula",
        "name",
        SAMPLE,
        "0",
        "Sea of Ghosts",
        "-o",
        renamed.to_str().unwrap(),
    ]);
    ok(&out);
    assert!(
        stdout(&out)
            .contains("Renamed nebula 0 from \"Phantom_Streak_Miasma\" to \"Sea of Ghosts\""),
        "{}",
        stdout(&out)
    );
    assert!(renamed.is_file());

    let out = sgf(&[
        "nebula",
        "name",
        renamed.to_str().unwrap(),
        "0",
        "",
        "-o",
        dir.path().join("never.sav").to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("a name may not be empty"), "{err}");
    assert!(!dir.path().join("never.sav").exists());
}

#[test]
fn nebula_radius_of_an_unknown_index_fails_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "nebula",
        "radius",
        SAMPLE,
        "99",
        "30",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("nebula 99 does not exist"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn lane_add_to_self_fails_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "lane",
        "add",
        SAMPLE,
        "0",
        "0",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(err.contains("itself"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn lane_normalise_writes_the_floor_of_the_distance() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("normalised.sav");
    let out_str = out_path.to_str().unwrap();

    let out = sgf(&["lane", "normalise", SAMPLE, "788", "760", "-o", out_str]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Normalised lane 788 <-> 760 length from 20.70131 to 20"),
        "{text}"
    );
    assert!(out_path.is_file());
}

#[test]
fn lane_remove_of_a_missing_lane_fails() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("never.sav");
    let out = sgf(&[
        "lane",
        "remove",
        SAMPLE,
        "0",
        "1",
        "-o",
        out_path.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.starts_with("error: "), "{err}");
    assert!(err.contains("not linked"), "{err}");
    assert!(!out_path.exists());
}

#[test]
fn deposit_add_then_remove_in_a_later_session() {
    let dir = tempfile::tempdir().unwrap();
    let added = dir.path().join("added.sav");
    let removed = dir.path().join("removed.sav");
    let (added_str, removed_str) = (added.to_str().unwrap(), removed.to_str().unwrap());

    let out = sgf(&[
        "deposit",
        "add",
        SAMPLE_4_5,
        "--planet",
        "3",
        "--type",
        "d_minerals_3",
        "--planet",
        "0",
        "--type",
        "d_energy_2",
        "-o",
        added_str,
    ]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains("Added d_minerals_3 (#16777216) to planet #3"),
        "{text}"
    );
    assert!(
        text.contains("Added d_energy_2 (#16777217) to planet #0"),
        "{text}"
    );
    assert!(text.contains(&format!("wrote {added_str}")), "{text}");
    assert_eq!(sgf(&["validate", added_str]).status.code(), Some(0));

    let out = sgf(&[
        "deposit",
        "remove",
        added_str,
        "--deposit",
        "16777216",
        "--deposit",
        "16777217",
        "-o",
        removed_str,
    ]);
    ok(&out);
    assert!(
        stdout(&out).contains("Removed d_minerals_3 (#16777216) from planet #3"),
        "{}",
        stdout(&out)
    );
    assert_eq!(sgf(&["validate", removed_str]).status.code(), Some(0));
}

#[test]
fn deposit_refusals_write_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let out_path = dir.path().join("refused.sav");
    let out_str = out_path.to_str().unwrap();
    let refusals: [(&[&str], &str); 3] = [
        (
            &["remove", SAMPLE_4_5, "--deposit", "440"],
            "planet 2 is colonised",
        ),
        (
            &[
                "add",
                SAMPLE_4_5,
                "--planet",
                "3",
                "--planet",
                "4",
                "--type",
                "d_minerals_3",
            ],
            "each --planet takes one --type",
        ),
        (
            &["remove", SAMPLE_4_5, "--deposit", "96"],
            "deposit 96 is not held by a planet",
        ),
    ];
    for (args, message) in refusals {
        let mut command = vec!["deposit"];
        command.extend_from_slice(args);
        command.extend_from_slice(&["-o", out_str]);
        let out = sgf(&command);
        assert_eq!(out.status.code(), Some(1), "{args:?}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains(message), "{err}");
        assert!(!out_path.exists());
    }
}
