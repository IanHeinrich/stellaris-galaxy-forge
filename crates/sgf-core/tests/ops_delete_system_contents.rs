//! Deleting a 4.6 system with what stands in it: each kind of contents written as the game
//! leaves it a month after its own removal, and undone byte for byte.

use crate::common;
use crate::ops_delete_system::{HOMEWORLD, OCCIDAN, TWO_STARBASES, delete, open_4_6_edited};
use common::diff::{round_trip, round_trip_step, snapshot_step};
use common::edit::{insert_after, replace_once};
use common::{current, open_4_6};

/// The sample without the saved event target `name` on system `system`.
fn untargeted(system: u32, name: &str) -> sgf_core::session::Session {
    open_4_6_edited(|text| {
        let block = format!(
            "saved_event_target=\n{{\n\ttype=galactic_object\n\tid={system}\n\topener_id=4294967295\n\tname=\"{name}\"\n}}\n"
        );
        replace_once(text, &block, "");
    })
}

/// Each kind of contents on the system the sample holds it in, deleted and snapshot.
#[test]
fn each_kind_goes_as_the_game_leaves_it() {
    for (name, system, description) in [
        (
            "owner_starbase_colony",
            478,
            "Deleted Zowod #478 and 4 lanes, with 1 colony, 1 starbase and 3 fleets",
        ),
        (
            "two_starbases",
            TWO_STARBASES,
            "Deleted Dmaxi #67 and 4 lanes, with 2 starbases and 3 fleets",
        ),
        ("fleet", 12, "Deleted Kunides #12 and 3 lanes, with 1 fleet"),
        (
            "unowned_megastructure",
            17,
            "Deleted Trabano #17 and 4 lanes, with 1 megastructure",
        ),
        (
            "gateway",
            32,
            "Deleted Aruz #32 and 4 lanes, with 1 megastructure",
        ),
        (
            "wormhole",
            307,
            "Deleted Pulcor #307 and 3 lanes, with 1 wormhole pair",
        ),
        (
            "lgate",
            321,
            "Deleted Iskanders Pride #321 and 2 lanes, with 1 megastructure",
        ),
        (
            "catapult",
            54,
            "Deleted Birana #54 and 2 lanes, with 1 megastructure",
        ),
        (
            "pre_ftl",
            HOMEWORLD,
            "Deleted Kuhlehm #86 and 2 lanes, with 1 colony and 1 pre-FTL country",
        ),
    ] {
        let mut session = open_4_6();
        let result = snapshot_step(&mut session, name, delete(system));
        assert_eq!(result.entry.description, description);
        assert!(session.system(system).is_none());
    }
}

/// A marauder empire's home, too large to snapshot: its starbase and 19 fleets go, and undo
/// puts them back.
#[test]
fn a_marauder_home_goes() {
    let mut session = open_4_6();
    let result = round_trip_step(&mut session, "marauders", delete(2));
    assert_eq!(
        result.entry.description,
        "Deleted Bir Zun #2 and 5 lanes, with 1 starbase and 19 fleets"
    );
}

/// An owned megastructure and a shroud tunnel stand in systems a saved event target names;
/// without the target, they go.
#[test]
fn an_owned_megastructure_and_a_shroud_tunnel_go() {
    let mut session = untargeted(50, "mindwarden_enclave_system");
    let result = snapshot_step(&mut session, "owned_megastructure", delete(50));
    assert_eq!(
        result.entry.description,
        "Deleted Halvam #50 and 2 lanes, with 1 starbase and 1 megastructure"
    );
    let mut session = open_4_6_edited(|text| {
        for name in ["shroud_tunnel_nexus", "shroudwalker_enclave_system"] {
            let block = format!(
                "saved_event_target=\n{{\n\ttype=galactic_object\n\tid=9\n\topener_id=4294967295\n\tname=\"{name}\"\n}}\n"
            );
            replace_once(text, &block, "");
        }
    });
    let result = snapshot_step(&mut session, "shroud_tunnel", delete(9));
    assert!(
        result
            .entry
            .description
            .ends_with("with 1 starbase and 1 shroud tunnel"),
        "{}",
        result.entry.description
    );
}

/// A system in a sector leaves the sector's `systems`.
#[test]
fn a_sectors_system_leaves_it() {
    let mut session = open_4_6_edited(|text| {
        replace_once(
            text,
            "\t\tsystems=\n\t\t{\n\t\t\t459 \n\t\t}\n",
            "\t\tsystems=\n\t\t{\n\t\t\t459 516 \n\t\t}\n",
        );
        let table = text.find("\ngalactic_object=\n").expect("the systems");
        let at = table + text[table..].find("\n\t516=\n").expect("Occidan");
        let from = "\t\tsector=4294967295\n";
        let sector = at + text[at..].find(from).expect("its sector");
        text.replace_range(sector..sector + from.len(), "\t\tsector=0\n");
    });
    snapshot_step(&mut session, "sector", delete(OCCIDAN));
    let text = common::text(&session);
    assert!(text.contains("\t\tsystems=\n\t\t{\n\t\t\t459 \n\t\t}\n"));
}

/// A pre-FTL homeworld with a ruined ring world goes with its rows; the inverse, and the
/// inverse's inverse, write back and take out the country again.
#[test]
fn a_pre_ftl_country_comes_back_with_its_homeworld() {
    round_trip(open_4_6(), delete(457));
    let mut session = open_4_6();
    let deleted = session.apply(delete(HOMEWORLD)).expect("delete");
    let gone = current(&session);
    assert!(common::text(&session).contains("\n\t234881050=none\n"));
    let back = session.apply_inverse(deleted.inverse).expect("the inverse");
    assert_eq!(current(&session), session.doc().original());
    session
        .apply_inverse(back.inverse)
        .expect("the inverse's inverse");
    assert_eq!(current(&session), gone);
}

/// A caravaneer's home goes with its fleets, and the saved event targets naming them stay
/// for the game, as 4.6.0 leaves a target whose entity is gone.
#[test]
fn a_caravaneer_home_leaves_its_event_targets() {
    let mut session = open_4_6();
    round_trip_step(&mut session, "caravaneers", delete(28));
    let target =
        "\ttype=fleet\n\tid=156\n\topener_id=4294967295\n\tname=\"CaravaneerCustomCapital\"\n";
    assert!(common::text(&session).contains(target));
}

/// The preview gives the description the deletion would have, or its refusal, and writes
/// nothing.
#[test]
fn a_preview_describes_without_deleting() {
    let session = open_4_6();
    assert_eq!(
        session.describe_op(&delete(478)),
        Ok("Deleted Zowod #478 and 4 lanes, with 1 colony, 1 starbase and 3 fleets".to_owned())
    );
    assert_eq!(
        session.describe_op(&delete(459)),
        Err("system 459 cannot be deleted: it holds an empire's capital".to_owned())
    );
    assert!(session.system(478).is_some());
    assert!(!session.is_dirty());
}

/// Another country's relation with the pre-FTL country goes, and a spy network on it becomes
/// a tombstone, as the game leaves them a month on.
#[test]
fn a_pre_ftl_countrys_relations_and_spy_networks_go() {
    let relation = "\t\t\trelation=\n\t\t\t{\n\t\t\t\towner=251658242\n\t\t\t\tcountry=234881050\n\t\t\t\tcontact=yes\n\t\t\t}\n";
    let network = "\nspy_networks=\n{\n\t0=\n\t{\n\t\towner=17\n\t\ttarget=";
    let mut session = open_4_6_edited(|text| {
        common::edit::insert_after(text, &["\t\trelations_manager=\n\t\t{\n"], relation);
        replace_once(
            text,
            &format!("{network}234881040\n"),
            &format!("{network}234881050\n"),
        );
    });
    round_trip_step(&mut session, "relations", delete(HOMEWORLD));
    let text = common::text(&session);
    assert!(!text.contains(relation));
    assert!(text.contains("\nspy_networks=\n{\n\t0=none\n"));
}

/// The sample with the `from` that follows the last of `anchors` made `to`.
fn edited_where(anchors: &[&str], from: &str, to: &str) -> sgf_core::session::Session {
    open_4_6_edited(|text| {
        let mut at = 0;
        for anchor in anchors {
            at += text[at..]
                .find(anchor)
                .unwrap_or_else(|| panic!("{anchor:?}"));
        }
        at += text[at..].find(from).unwrap_or_else(|| panic!("{from:?}"));
        text.replace_range(at..at + from.len(), to);
    })
}

/// What names the system from elsewhere and goes with it, each snapshot: a dig site, a cosmic
/// storm's cluster and path, a psionic aura it is the source of with a system in it, an astral
/// rift, and a waystation network listing its starbase.
#[test]
fn what_names_it_goes_with_it() {
    let mut session = edited_where(
        &["\narchaeological_sites=\n", "\t\t0=\n"],
        "\t\t\t\tid=566\n",
        "\t\t\t\tid=5440\n",
    );
    snapshot_step(&mut session, "dig_site", delete(OCCIDAN));

    let storm = "\t\t0=\n\t\t{\n\t\t\ttype=\"gravity_storm\"\n\t\t\tstorm_current_path_index=2\n\t\t\tcluster=\n\t\t\t{\n\t\t\t\tobjects=\n\t\t\t\t{\n\t\t\t\t\t77 516 562 \n\t\t\t\t}\n\t\t\t}\n\t\t\tpath=\n\t\t\t{\n\t\t\t\t516 562 77 \n\t\t\t}\n\t\t}\n\t\t1=none\n";
    let mut session = open_4_6_edited(|text| {
        insert_after(text, &["\nstorms=\n{\n\tstorms=\n\t{\n"], storm);
    });
    snapshot_step(&mut session, "storm", delete(OCCIDAN));
    let text = common::text(&session);
    assert!(text.contains("\t\t\tstorm_current_path_index=1\n"));

    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\npsionic_auras=\n{\n\tpsionic_auras=\n\t{\n"],
            "\t\t0=\n\t\t{\n\t\t\tcountry=0\n\t\t\tsystem=516\n\t\t}\n\t\t1=none\n",
        );
        for system in ["516", "562"] {
            let at = text.find("\ngalactic_object=\n").expect("the systems");
            let at = at
                + text[at..]
                    .find(&format!("\n\t{system}=\n"))
                    .expect("the system");
            let at = at + text[at..].find("\t\touter_radius=").expect("its radius");
            text.insert_str(at, "\t\tpsionic_aura=0\n");
        }
    });
    snapshot_step(&mut session, "aura", delete(OCCIDAN));

    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nastral_rifts=\n{\n\trifts=\n\t{\n"],
            "\t\t0=\n\t\t{\n\t\t\tcoordinate=\n\t\t\t{\n\t\t\t\torigin=516\n\t\t\t}\n\t\t}\n\t\t1=none\n",
        );
    });
    snapshot_step(&mut session, "rift", delete(OCCIDAN));

    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nwaystation_networks=\n{\n"],
            "\t0=\n\t{\n\t\twaystations=\n\t\t{\n\t\t\t6 13 \n\t\t}\n\t}\n",
        );
    });
    snapshot_step(&mut session, "waystation", delete(TWO_STARBASES));
}

/// A colony's army aboard a ship elsewhere leaves the ship's `army`, and an army aboard a
/// ship that goes goes with it.
#[test]
fn armies_aboard_ships_go() {
    let mut session = open_4_6_edited(|text| {
        insert_after(text, &["\narmy=\n{\n", "\n\t240=\n\t{\n"], "\t\tship=653\n");
        insert_after(
            text,
            &["\nships=\n{\n", "\n\t653=\n\t{\n"],
            "\t\tarmy=\n\t\t{\n\t\t\t240 \n\t\t}\n",
        );
    });
    snapshot_step(&mut session, "colony_army_aboard", delete(HOMEWORLD));
    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nships=\n{\n", "\n\t653=\n\t{\n"],
            "\t\tarmy=\n\t\t{\n\t\t\t164 \n\t\t}\n",
        );
    });
    let result = round_trip_step(&mut session, "carried", delete(12));
    assert!(
        common::text(&session).contains("\n\t164=none\n"),
        "{result:?}"
    );
}

/// A colony on a planet with no owner goes with nobody's lists.
#[test]
fn a_colony_with_no_owner_goes() {
    let mut session = edited_where(
        &["\nplanets=\n", "\n\t\t1170=\n"],
        "\t\t\towner=234881050\n",
        "",
    );
    round_trip_step(&mut session, "ownerless", delete(HOMEWORLD));
}

/// A megastructure the pre-FTL country owns goes with the country, which no edit of its
/// lists overlaps.
#[test]
fn a_pre_ftl_countrys_own_megastructure_goes_with_it() {
    let mut session = open_4_6_edited(|text| {
        let at = text.find("\nmegastructures=\n{\n").expect("the rows");
        let at = at + text[at..].find("\n\t5=\n").expect("the catapult");
        let origin = at + text[at..].find("\t\t\torigin=54\n").expect("its origin");
        text.replace_range(
            origin..origin + "\t\t\torigin=54\n".len(),
            "\t\t\torigin=86\n",
        );
        insert_after(
            text,
            &["\nmegastructures=\n{\n", "\n\t5=\n\t{\n"],
            "\t\towner=234881050\n",
        );
        insert_after(
            text,
            &["\ncountry=\n{\n", "\n\t234881050=\n\t{\n"],
            "\t\towned_megastructures=\n\t\t{\n\t\t\t5 \n\t\t}\n",
        );
    });
    let result = round_trip_step(&mut session, "owned", delete(HOMEWORLD));
    assert_eq!(
        result.entry.description,
        "Deleted Kuhlehm #86 and 2 lanes, with 1 colony, 1 megastructure and 1 pre-FTL country"
    );
}

/// A system with no lane says none in its description.
#[test]
fn an_isolated_system_names_no_lanes() {
    let mut session = open_4_6();
    session.apply(delete(562)).expect("its only neighbour");
    let result = session.apply(delete(OCCIDAN)).expect("delete");
    assert_eq!(result.entry.description, "Deleted Occidan #516");
}

/// A pre-FTL country edited as a station's controller and an anomaly's finder in its own
/// homeworld goes as its tombstone, written over those edits.
#[test]
fn a_pre_ftl_country_edited_as_a_controller_goes_whole() {
    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nplanets=\n", "\n\t\t1168=\n\t\t{\n"],
            "\t\t\tcontroller=234881050\n\t\t\tshipclass_orbital_station=130\n",
        );
        insert_after(
            text,
            &["\ncountry=\n{\n", "\n\t234881050=\n\t{\n"],
            "\t\tevents=\n\t\t{\n\t\t\tanomalies=\n\t\t\t{\n\t\t\t\t1169 \n\t\t\t}\n\t\t}\n",
        );
    });
    round_trip_step(&mut session, "controller", delete(HOMEWORLD));
    assert!(common::text(&session).contains("\n\t234881050=none\n"));
}

/// A starbase its system's `starbases` leaves out, as a mercenary enclave's is, goes with its
/// station's fleet rather than leaving a starbase with a dead station.
#[test]
fn an_unlisted_starbase_goes_with_its_station() {
    let mut session = edited_where(
        &["\ngalactic_object=\n", "\n\t478=\n", "\t\tstarbases=\n"],
        "\t\t\t13 \n",
        "\t\t\t4294967295 \n",
    );
    let result = round_trip_step(&mut session, "unlisted", delete(478));
    assert_eq!(
        result.entry.description,
        "Deleted Zowod #478 and 4 lanes, with 1 colony, 1 starbase and 3 fleets"
    );
    let text = common::text(&session);
    let starbases = &text[text.find("\nstarbase_mgr=\n").expect("the starbases")..];
    assert!(starbases.contains("\n\t\t13=none\n"));
}

/// Another empire's observation station over a pre-FTL world leaves its owner's
/// `owned_fleets` and `sensor_range_fleets`, though the pre-FTL country controls the planet.
#[test]
fn an_observation_station_leaves_its_owners_lists() {
    let mut session = open_4_6_edited(|text| {
        insert_after(
            text,
            &["\nplanets=\n", "\n\t\t1170=\n\t\t{\n"],
            "\t\t\tshipclass_orbital_station=130\n",
        );
    });
    round_trip_step(&mut session, "observation", delete(HOMEWORLD));
    let text = common::text(&session);
    let country = text.find("\ncountry=\n{\n").expect("the countries");
    let nine = country + text[country..].find("\n\t9=\n\t{\n").expect("country 9");
    let end = nine + text[nine..].find("\n\t}\n").expect("its end");
    let nine = &text[nine..end];
    assert!(!nine.contains("\t\t\t\t\tfleet=130\n"), "owned_fleets");
    let sensors = &nine[nine.find("\t\tsensor_range_fleets=").expect("its sensors")..];
    let sensors = &sensors[..sensors.find('}').expect("their end")];
    assert!(
        !sensors.split_whitespace().any(|id| id == "130"),
        "{sensors}"
    );
}
