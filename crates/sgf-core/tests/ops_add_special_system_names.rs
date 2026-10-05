//! Names, flags and modifiers of added special systems as the save holds them after a
//! reopen: lettered and fixed body names, binary flags, a star named by its class, what a
//! rename leaves alone and what the random name pool keeps.

use sgf_core::ops::{Op, initializer_counts};
use sgf_core::session::Session;

use crate::common;
use crate::ops_add_special_system::{add, larionessi, opened, terraformed, trappist, wenkwort};
use common::current;
use common::diff::round_trip_step;
use common::spec::SAMPLES;
use common::{findings, text};

/// Each body the details list for system `id`, as (class, its name's key, the keys of
/// its name's variables' values).
fn names(session: &Session, id: u32) -> Vec<(String, String, Vec<String>)> {
    common::planets(session, id)
        .into_iter()
        .map(|p| {
            let values = p
                .name
                .variables
                .iter()
                .map(|v| v.value.key.clone())
                .collect();
            (p.class, p.name.key, values)
        })
        .collect()
}

/// System `id`'s body entries as the text holds them, star first.
fn entries(text: &str, session: &Session, id: u32) -> Vec<String> {
    common::planet_ids(session, id)
        .into_iter()
        .map(|planet| {
            let head = format!("\n\t\t{planet}=\n\t\t{{\n");
            let start = text.find(&head).expect("the body's entry") + 1;
            let end = start + text[start..].find("\n\t\t}\n").expect("its end");
            text[start..end].to_owned()
        })
        .collect()
}

#[test]
fn a_saved_special_system_reopens_with_its_names_flags_and_modifiers() {
    let dir = tempfile::tempdir().expect("a temp dir");
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        let before = findings(&session);
        let specs = [trappist(&at), {
            let mut spec = larionessi(&at);
            (spec.x, spec.y) = (at.x + 20.0, at.y + 20.0);
            spec.lanes = vec![id];
            spec
        }];
        for spec in specs {
            session.apply(add(spec)).expect("add the system");
        }
        let mut spec = terraformed(&at);
        (spec.x, spec.y) = (at.x - 20.0, at.y + 20.0);
        spec.lanes = vec![id];
        session.apply(add(spec)).expect("add the system");
        let path = dir.path().join(format!("{id}.sav"));
        session.save_as(&path).expect("save");

        let reopened = Session::open(&path).expect("reopen");
        assert_eq!(findings(&reopened), before, "{id}: the save's own findings");
        let saved = text(&reopened);

        let trappist = names(&reopened, id);
        assert_eq!(trappist, names(&session, id), "{id}: before the save");
        assert_eq!(
            trappist[0],
            ("pc_m_star".into(), "NAME_Trappist".into(), vec![])
        );
        assert_eq!(
            trappist[4],
            (
                "pc_barren".into(),
                "PLANET_NAME_FORMAT".into(),
                vec!["NAME_Trappist".into(), "IV".into()]
            )
        );
        let bodies = entries(&saved, &reopened, id);
        assert!(!bodies[0].contains("	binary_flags"), "{}", bodies[0]);
        assert!(bodies[4].contains("\t\t\tbombardment_damage=0\n\t\t\ttimed_modifier=\n\t\t\t{\n\t\t\t\titems=\n\t\t\t\t{\n\t\t\t\t\t\n\t\t\t\t\t{\n\t\t\t\t\t\tmodifier=\"terraforming_candidate\"\n\t\t\t\t\t\tdays=-1\n\t\t\t\t\t}\n \n\t\t\t\t}\n\t\t\t}\n\t\t\tentity=1"), "{}", bodies[4]);
        assert!(!saved.contains("planet_modifier=\"terraforming_candidate\""));

        let refuge = names(&reopened, id + 1);
        let keys: Vec<&str> = refuge.iter().map(|(_, key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "STAR_NAME_1_OF_1",
                "PLANET_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "ASTEROID_NAME_FORMAT",
                "NAME_Unique_System_2_Planet",
                "SUBPLANET_NAME_FORMAT",
                "SUBPLANET_NAME_FORMAT"
            ]
        );
        assert_eq!(refuge[5].2, ["NAME_Unique_System_2_Planet", "a"]);
        assert_eq!(refuge[6].2, ["NAME_Unique_System_2_Planet", "b"]);
        let bodies = entries(&saved, &reopened, id + 1);
        assert!(bodies[0].contains("\t\t\tcarrier_binary_flags=3\n"));
        assert!(
            bodies[4].contains("\t\t\tbinary_flags=65\n"),
            "{}",
            bodies[4]
        );
        assert!(
            bodies[5].contains("\t\t\tbinary_flags=576\n"),
            "{}",
            bodies[5]
        );

        let world = &entries(&saved, &reopened, id + 2)[1];
        assert!(world.contains("\t\t\tbinary_flags=322\n"), "{world}");
        assert!(
            world.contains(
                "\t\t\tentity=0\n\t\t\tentity_name=\"previously_terraformed_planet_entity\""
            ),
            "{world}"
        );
        let star = &entries(&saved, &reopened, id + 2)[0];
        assert!(star.contains("\t\t\torbit=40\n"), "{star}");
        assert!(!star.contains("\t\t\t\tx=0\n"), "{star}");

        let counts = initializer_counts(reopened.doc());
        let opened = initializer_counts((sample.open)().doc());
        assert_eq!(
            counts.get("trappist_initializer"),
            opened.get("trappist_initializer").map(|n| n + 1).as_ref()
        );
        assert_eq!(counts.get("unique_system_initializer_02"), Some(&1));
        assert!(!opened.contains_key("unique_system_initializer_02"));
    }
}

#[test]
fn a_fixed_name_moon_takes_no_letter_and_an_entity_override_alone_is_66() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        session.apply(add(wenkwort(&at))).expect("add the system");
        let reopened = common::reopened(&mut session);
        let listed = names(&reopened, id);
        assert_eq!(listed, names(&session, id), "{id}: before the save");
        let keys: Vec<&str> = listed.iter().map(|(_, key, _)| key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "STAR_NAME_1_OF_1",
                "PLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT",
                "NAME_wenkwort_moon",
                "SUBPLANET_NAME_FORMAT",
                "PLANET_NAME_FORMAT"
            ]
        );
        assert_eq!(listed[4].2, ["PLANET_NAME_FORMAT", "a"], "{listed:?}");
        assert_eq!(listed[5].2, ["Sgf_Wenkwort", "III"]);

        let bodies = entries(&text(&reopened), &reopened, id);
        let flags = |body: &str| {
            body.lines()
                .find_map(|line| line.strip_prefix("\t\t\tbinary_flags="))
                .map(str::to_owned)
        };
        let found: Vec<Option<String>> = bodies.iter().map(|b| flags(b)).collect();
        let expected = [None, None, None, Some("577"), Some("576"), Some("66")];
        assert_eq!(found, expected.map(|f| f.map(str::to_owned)));
        assert!(bodies[5].contains("\t\t\tentity=0\n\t\t\tentity_name=\"gas_giant_02_entity\""));
    }
}

#[test]
fn a_fixed_system_name_outside_the_pool_takes_nothing_from_it() {
    for sample in &SAMPLES {
        let (mut session, at, _) = opened(sample);
        assert!(!text(&session).contains("\t\t\"NAME_Trappist\"\n"));
        let pool = |bytes: &[u8]| {
            let text = String::from_utf8_lossy(bytes).into_owned();
            let start = text.find("\nrandom_name_database=").expect("the pool");
            text[start..start + 200_000].to_owned()
        };
        session.apply(add(trappist(&at))).expect("add");
        assert_eq!(pool(&current(&session)), pool(session.doc().original()));
    }
}

#[test]
fn a_rename_leaves_fixed_names_alone_and_renames_a_star_named_by_class() {
    for sample in &SAMPLES {
        let (mut session, at, id) = opened(sample);
        round_trip_step(&mut session, "refuge", add(larionessi(&at)));
        let mut spec = trappist(&at);
        (spec.x, spec.y) = (at.x + 20.0, at.y + 20.0);
        spec.lanes = vec![id];
        round_trip_step(&mut session, "trappist", add(spec));
        let opened = names(&session, id);

        let rename = |system: u32, name: &str| Op::RenameSystem {
            system,
            name: name.to_owned(),
        };
        round_trip_step(&mut session, "rename refuge", rename(id, "Sgf_Refuge"));
        let renamed = names(&session, id);
        for (before, after) in opened.iter().zip(&renamed) {
            let expected = match before.1.as_str() {
                "STAR_NAME_1_OF_1" | "PLANET_NAME_FORMAT" => {
                    let mut values = before.2.clone();
                    values[0] = "Sgf_Refuge".to_owned();
                    (before.0.clone(), before.1.clone(), values)
                }
                _ => before.clone(),
            };
            assert_eq!(after, &expected);
        }
        assert_eq!(renamed[4].1, "NAME_Unique_System_2_Planet");
        assert_eq!(renamed[5].2[0], "NAME_Unique_System_2_Planet");

        round_trip_step(
            &mut session,
            "rename trappist",
            rename(id + 1, "Sgf_Trappist"),
        );
        let trappist = names(&session, id + 1);
        assert_eq!(trappist[0].1, "Sgf_Trappist");
        assert_eq!(trappist[1].2[0], "Sgf_Trappist");

        let result = round_trip_step(&mut session, "remove", Op::RemoveSystem { system: id + 1 });
        let Op::AddSystemFromSpec { spec } = &result.inverse else {
            panic!("{:?}", result.inverse);
        };
        assert!(spec.star_named_by_class && spec.capped);
        assert_eq!(spec.name, "Sgf_Trappist");
        while session.undo().expect("undo").is_some() {}
        assert_eq!(current(&session), session.doc().original());
    }
}
