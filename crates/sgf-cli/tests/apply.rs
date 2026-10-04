//! `sgf apply`: the ops that edit files hold, applied to a save or scenario in order.
use serde_json::{Value, json};
use tempfile::TempPath;

use crate::common::{
    DORELLION, MURA, SAMPLE, SAMPLE_4_5, SCENARIO, add_system_op, backups, edit, edited, fixture,
    ok, sgf, stdout,
};

fn edits(ops: &[Value]) -> Vec<TempPath> {
    ops.iter().map(edit).collect()
}

/// `sgf apply doc <ops…>` to a new file; what it printed and the file.
fn applied(doc: &str, ops: &[Value]) -> (String, TempPath) {
    let files = edits(ops);
    let mut args = vec!["apply", doc];
    args.extend(files.iter().map(|f| f.to_str().unwrap()));
    edited(&args)
}

/// `sgf apply doc <ops…>` expecting a refusal that writes nothing; what it printed to stderr.
fn refused(doc: &str, ops: &[Value]) -> String {
    let dir = tempfile::tempdir().unwrap();
    let never = dir.path().join("never.sav");
    let files = edits(ops);
    let mut args = vec!["apply", doc];
    args.extend(files.iter().map(|f| f.to_str().unwrap()));
    args.extend(["-o", never.to_str().unwrap()]);
    let out = sgf(&args);
    assert_eq!(out.status.code(), Some(1), "{ops:?}");
    assert!(!never.exists(), "{ops:?}");
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn apply_writes_the_edited_save_to_the_output_path() {
    let op = json!({ "type": "MoveSystem", "system": 0, "x": -150, "y": 60 });
    let (text, path) = applied(SAMPLE, &[op]);
    assert!(
        text.contains("Moved Gamma Refuge #0 from (-144.22, 57.36) to (-150, 60)"),
        "{text}"
    );
    assert!(
        text.contains("validate: 1 warning(s), 0 error(s), 2 note(s)"),
        "{text}"
    );
    assert!(
        text.contains(&format!("wrote {}", path.display())),
        "{text}"
    );
    assert!(path.is_file());
}

#[test]
fn apply_in_place_backs_up_the_original() {
    let dir = tempfile::tempdir().unwrap();
    let copy = dir.path().join("copy.sav");
    std::fs::copy(SAMPLE, &copy).unwrap();
    let copy_str = copy.to_str().unwrap();
    let file = edit(&json!({ "type": "MoveSystem", "system": 0, "x": -150, "y": 60 }));

    let out = sgf(&["apply", copy_str, file.to_str().unwrap()]);
    ok(&out);
    let text = stdout(&out);
    let backups = backups(dir.path());
    assert_eq!(backups.len(), 1, "{backups:?}");
    assert!(backups[0].starts_with("copy.sav.bak-"), "{backups:?}");
    assert!(text.contains(&format!("wrote {copy_str}")), "{text}");
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

/// One op of each family, on the document that takes it. A case with several ops applies
/// its files in order, so a later one can name what an earlier one made.
#[test]
fn apply_writes_an_op_of_each_family_and_the_result_validates() {
    let cases: Vec<(&str, Vec<Value>, Vec<&str>)> = vec![
        (
            SAMPLE,
            vec![json!({ "type": "NormaliseLaneLength", "a": 788, "b": 760 })],
            vec!["Normalised lane Raprix #788 <-> Kachada #760 length from 20.70131 to 20"],
        ),
        (
            SAMPLE,
            vec![
                json!({ "type": "AddNebula", "x": -57.5, "y": -305, "radius": 40, "name": "SGF_Test_Nebula" }),
                json!({ "type": "SetNebulaRadius", "index": 9, "radius": 50 }),
                json!({ "type": "RenameNebula", "index": 9, "name": "Sea of Ghosts" }),
                json!({ "type": "RemoveNebula", "index": 9 }),
            ],
            vec![
                "Added nebula \"SGF_Test_Nebula\" at (-57.5, -305) radius 40; 4 systems joined",
                "radius to 50 (was 40)",
                "Renamed nebula 9 from \"SGF_Test_Nebula\" to \"Sea of Ghosts\"",
                "Removed nebula \"Sea of Ghosts\"",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "AddDeposit", "body": 3, "kind": "d_minerals_3" }),
                json!({ "type": "AddDeposit", "body": 0, "kind": "d_energy_2" }),
                json!({ "type": "RemoveDeposit", "deposit": 16777216 }),
            ],
            vec![
                "Added d_minerals_3 (#16777216) to planet #3",
                "Added d_energy_2 (#16777217) to planet #0",
                "Removed d_minerals_3 (#16777216) from planet #3",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "AddBodyModifier", "body": 585, "modifier": "mineral_poor",
                        "days": [-1], "feature": "pm_mineral_poor" }),
                json!({ "type": "RemoveBodyModifier", "body": 585, "modifier": "mineral_poor",
                        "feature": "pm_mineral_poor" }),
                json!({ "type": "AddBodyModifier", "body": 585,
                        "modifier": "terraforming_candidate", "days": [360], "feature": null }),
            ],
            vec![
                "Added planet feature pm_mineral_poor (mineral_poor) to planet #585",
                "Removed planet feature pm_mineral_poor (mineral_poor) from planet #585",
                "Added modifier terraforming_candidate to planet #585 for 360 days",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "SetBodyModel", "body": 585,
                        "entity": "ocean_paradise_planet_01_entity" }),
                json!({ "type": "SetBodyModel", "body": 585, "entity": null }),
            ],
            vec![
                "Gave planet #585 the model ocean_paradise_planet_01_entity",
                "Took the model ocean_paradise_planet_01_entity off planet #585",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "AddAnomaly", "body": 3,
                        "category": "asteroid_uninhabitable_category", "found_by": null }),
                json!({ "type": "RemoveAnomaly", "body": 3 }),
            ],
            vec![
                "Added anomaly asteroid_uninhabitable_category to planet #3, found by empire 0",
                "Removed anomaly asteroid_uninhabitable_category from planet #3",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "AddDigSite", "body": 585, "site_type": "site_lost_moments",
                        "difficulty": 1 }),
                json!({ "type": "RemoveDigSite", "site": 4 }),
            ],
            vec![
                "Added dig site site_lost_moments (#4) to planet #585",
                "Removed dig site site_lost_moments (#4) from planet #585",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "RenameBody", "body": 140, "name": { "Literal": "Nova Terra" } }),
                json!({ "type": "RenameEmpire", "country": 0, "name": "Sgf Dominion",
                        "value": null, "custom_name": true }),
            ],
            vec![
                "Renamed planet #140 to Nova Terra",
                "Renamed empire 0 to Sgf Dominion",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![
                json!({ "type": "AddBody", "system": 408,
                        "spec": { "class": "pc_desert", "size": 12, "deposits": ["d_minerals_2"] },
                        "at": { "radius": 45, "angle": -60 } }),
                json!({ "type": "DeleteBody", "body": 99 }),
                json!({ "type": "RemoveColony", "body": 517 }),
            ],
            vec![
                "Added planet #16777273 to Meissa #408 (pc_desert, size 12) at orbit 45 at 300°, with 1 deposit",
                "Deleted planet #99 and its 2 moons",
                "Removed colony #18 from planet #517",
            ],
        ),
        (
            SAMPLE_4_5,
            vec![add_system_op(MURA)],
            vec!["Added Mura #601 at (-292.23404, -137.62265) with 9 bodies and 1 lane"],
        ),
        (
            SCENARIO,
            vec![
                json!({ "type": "SetHeaderField", "key": "priority", "value": "7" }),
                json!({ "type": "SetSpawnWeight", "system": 0, "base": 3.0 }),
                json!({ "type": "PreventLane", "a": 0, "b": 5 }),
            ],
            vec![
                "Set header priority to 7",
                "Set the spawn weight of Gamma Refuge #0 to 3",
                "Prevented lane Gamma Refuge #0 <-> Bir #5",
            ],
        ),
    ];
    for (doc, ops, expected) in cases {
        let (text, path) = applied(doc, &ops);
        for fragment in &expected {
            assert!(text.contains(fragment), "{fragment}\n{text}");
        }
        assert_eq!(
            text.matches("wrote ").count(),
            1,
            "one save after the last op: {text}"
        );
        assert_eq!(
            sgf(&["validate", path.to_str().unwrap()]).status.code(),
            Some(0),
            "{ops:?}"
        );
    }
}

#[test]
fn apply_takes_several_files_in_order_and_a_batch_as_one_edit() {
    let (tau_ceti, fellix) = (fixture("tau_ceti"), fixture("fellix"));
    let (text, path) = applied(
        SAMPLE_4_5,
        &[
            add_system_op(MURA),
            add_system_op(&tau_ceti),
            add_system_op(&fellix),
        ],
    );
    let added: Vec<&str> = text.lines().filter(|l| l.starts_with("Added ")).collect();
    assert_eq!(added.len(), 3, "{text}");
    assert!(added[2].starts_with("Added Fellix #603"), "{text}");
    assert_eq!(
        sgf(&["validate", path.to_str().unwrap()]).status.code(),
        Some(0)
    );

    let batch = json!({
        "type": "Batch",
        "description": "Added two systems",
        "ops": [add_system_op(MURA), add_system_op(&tau_ceti)],
    });
    let (text, _) = applied(SAMPLE_4_5, &[batch]);
    assert!(text.starts_with("Added two systems\n"), "{text}");
}

#[test]
fn apply_refuses_without_writing_and_names_the_file_and_the_op() {
    let ring_segment = json!({ "type": "DeleteBody", "body": 2445 });
    let file = edit(&ring_segment);
    let dir = tempfile::tempdir().unwrap();
    let never = dir.path().join("never.sav");
    let out = sgf(&[
        "apply",
        SAMPLE_4_5,
        file.to_str().unwrap(),
        "-o",
        never.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.starts_with(&format!("error: {}: DeleteBody: ", file.display())),
        "{err}"
    );
    assert!(err.contains("it is a ring world segment"), "{err}");
    assert!(!never.exists());

    let cases = [
        (
            SAMPLE,
            json!({ "type": "AddLane", "a": 0, "b": 0, "bridge": false }),
            "itself",
        ),
        (
            SAMPLE,
            json!({ "type": "RemoveLane", "a": 0, "b": 1 }),
            "not linked",
        ),
        (
            SAMPLE,
            json!({ "type": "SetNebulaRadius", "index": 99, "radius": 30 }),
            "nebula 99 does not exist",
        ),
        (
            SAMPLE,
            json!({ "type": "RenameNebula", "index": 0, "name": "" }),
            "a name may not be empty",
        ),
        (
            SAMPLE_4_5,
            json!({ "type": "RemoveDeposit", "deposit": 999999 }),
            "deposit 999999 does not exist",
        ),
        (
            SAMPLE_4_5,
            json!({ "type": "RenameBody", "body": 140, "name": { "Literal": "" } }),
            "a name may not be empty",
        ),
        (
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/3.4.sav"),
            add_system_op(DORELLION),
            "Stellaris 4.0 or later",
        ),
        (
            SCENARIO,
            json!({ "type": "RemoveColony", "body": 1 }),
            "is not supported for a scenario document",
        ),
    ];
    for (doc, op, message) in cases {
        let name = op["type"].as_str().unwrap().to_owned();
        let err = refused(doc, std::slice::from_ref(&op));
        assert!(err.contains(&format!(": {name}: ")), "{err}");
        assert!(err.contains(message), "{err}");
    }
}

#[test]
fn apply_refuses_a_file_that_is_not_an_op() {
    let dir = tempfile::tempdir().unwrap();
    let never = dir.path().join("never.sav");
    let never_str = never.to_str().unwrap();

    let broken = dir.path().join("broken.json");
    std::fs::write(&broken, "{ \"type\": \"MoveSystem\", ").unwrap();
    let unknown = edit(&json!({ "type": "MoveStar", "system": 0 }));
    let missing = dir.path().join("missing.json");
    for file in [broken.as_path(), unknown.as_ref(), missing.as_path()] {
        let out = sgf(&["apply", SAMPLE, file.to_str().unwrap(), "-o", never_str]);
        assert_eq!(out.status.code(), Some(1), "{}", file.display());
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(
            err.starts_with(&format!("error: {}: ", file.display())),
            "{err}"
        );
        assert!(!never.exists());
    }
    let out = sgf(&["apply", SAMPLE, unknown.to_str().unwrap(), "-o", never_str]);
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(err.contains("unknown variant `MoveStar`"), "{err}");

    let out = sgf(&["apply", SAMPLE, "-o", never_str]);
    assert_eq!(out.status.code(), Some(2), "a usage error");
}

/// A refusal after edits that applied leaves the save as it was and reports none of them,
/// whether the refused op is a later file or a member of a batch.
#[test]
fn apply_writes_and_reports_nothing_when_a_later_file_or_a_batch_member_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let good = |system: u32| json!({ "type": "MoveSystem", "system": system, "x": -150, "y": 60 });
    let bad = json!({ "type": "RemoveLane", "a": 0, "b": 1 });

    let copy = dir.path().join("copy.sav");
    std::fs::copy(SAMPLE, &copy).unwrap();
    let files = edits(&[good(0), good(1), bad.clone()]);
    let out = sgf(&[
        "apply",
        copy.to_str().unwrap(),
        files[0].to_str().unwrap(),
        files[1].to_str().unwrap(),
        files[2].to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains(&format!("{}: RemoveLane: ", files[2].display())),
        "{err}"
    );
    assert_eq!(stdout(&out), "", "no edit is reported");
    assert_eq!(
        std::fs::read(&copy).unwrap(),
        std::fs::read(SAMPLE).unwrap(),
        "the save is untouched"
    );
    assert_eq!(backups(dir.path()), Vec::<String>::new());

    let never = dir.path().join("never.sav");
    let batch = edit(&json!({
        "type": "Batch",
        "description": "Moved a system and cut a lane",
        "ops": [good(0), bad],
    }));
    let out = sgf(&[
        "apply",
        SAMPLE,
        batch.to_str().unwrap(),
        "-o",
        never.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains(&format!("{}: Batch: ", batch.display())),
        "{err}"
    );
    assert_eq!(stdout(&out), "");
    assert!(!never.exists());
}
