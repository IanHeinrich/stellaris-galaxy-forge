//! The dig site ops on both 4.x samples: the diff each change produces is snapshotted, the
//! planet page and the system's details read the site back, and undo puts the original bytes
//! back.

use sgf_core::entity::{PlanetPageDigSite, get_planet_page};
use sgf_core::ops::Op;
use sgf_core::session::Session;

use crate::common;
use common::diff::{plain_report, round_trip, snapshot_step};
use common::{SAMPLE_4_5, current, open, open_3_4, open_4_5, open_edited_sample};

/// A barren planet of the 4.5 sample without a site; 584 is its system's star.
const BARREN: u32 = 585;
const STAR: u32 = 584;
/// The F star of a binary on the 4.5 sample, which is not its system's primary body.
const COMPANION_STAR: u32 = 619;
/// A frozen moon of the 4.5 sample, holding no site.
const MOON: u32 = 40;
/// Site 1 of the 4.5 sample, on planet 1019.
const GRAVEYARD: u32 = 1;
const GRAVEYARD_PLANET: u32 = 1019;
const LOST_MOMENTS: &str = "site_lost_moments";

fn add(planet: u32, site_type: &str, difficulty: i32) -> Op {
    Op::AddDigSite {
        planet,
        site_type: site_type.to_owned(),
        difficulty,
    }
}

fn remove(site: u32) -> Op {
    Op::RemoveDigSite { site }
}

/// The site planet `id`'s page shows.
fn site(session: &Session, id: u32) -> Option<PlanetPageDigSite> {
    get_planet_page(&session.doc, id)
        .unwrap_or_else(|e| panic!("planet {id}: {e}"))
        .dig_site
}

/// The system planet `id` is a body of.
fn system_of(session: &Session, id: u32) -> u32 {
    get_planet_page(&session.doc, id)
        .expect("the planet")
        .system
        .expect("a system")
}

/// The ids and types of the sites system `id`'s details list.
fn listed(session: &Session, id: u32) -> Vec<(u32, String)> {
    session
        .details()
        .expect("details")
        .raw(id)
        .expect("the system")
        .sites
        .iter()
        .map(|s| (s.id, s.kind.clone()))
        .collect()
}

#[test]
fn a_site_is_added_last_with_the_next_id_and_the_page_and_details_read_it() {
    let mut session = open_4_5();
    let system = system_of(&session, BARREN);
    assert_eq!(site(&session, BARREN), None);
    session.warm_details().expect("build details");

    let result = snapshot_step(&mut session, "add_4_5", add(BARREN, LOST_MOMENTS, 1));
    assert_eq!(
        result.entry.description,
        "Add dig site site_lost_moments (#4) to planet #585"
    );
    assert_eq!(result.inverse, remove(4));
    assert_eq!(result.details_stale, vec![system]);
    assert!(!result.reclassifies);
    assert_eq!(
        site(&session, BARREN),
        Some(PlanetPageDigSite {
            id: 4,
            kind: LOST_MOMENTS.to_owned(),
            stages_done: 0,
            clues: 0,
            excavating: false,
        })
    );
    assert!(listed(&session, system).contains(&(4, LOST_MOMENTS.to_owned())));

    let removed = session
        .apply(result.inverse)
        .expect("remove the added site");
    assert_eq!(
        removed.entry.description,
        "Remove dig site site_lost_moments (#4) from planet #585"
    );
    assert_eq!(removed.inverse, add(BARREN, LOST_MOMENTS, 1));
    assert_eq!(current(&session), session.doc.original());
    assert_eq!(site(&session, BARREN), None);
    assert!(!listed(&session, system).iter().any(|&(id, _)| id == 4));

    session.undo().expect("undo").expect("the removal");
    assert_eq!(site(&session, BARREN).map(|s| s.id), Some(4));
    session.undo().expect("undo").expect("the add");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn the_4_4_sample_takes_a_site_after_its_last() {
    let mut session = open();
    let result = snapshot_step(&mut session, "add_4_4", add(749, "site_krazura_dig", 3));
    assert_eq!(
        result.entry.description,
        "Add dig site site_krazura_dig (#5) to planet #749"
    );
    assert_eq!(
        site(&session, 749).map(|s| s.kind),
        Some("site_krazura_dig".into())
    );
}

#[test]
fn a_site_is_removed_whole_and_its_inverse_adds_one_of_its_type() {
    let mut session = open_4_5();
    let system = system_of(&session, GRAVEYARD_PLANET);
    assert_eq!(
        site(&session, GRAVEYARD_PLANET).map(|s| s.id),
        Some(GRAVEYARD)
    );

    let result = snapshot_step(&mut session, "remove_4_5", remove(GRAVEYARD));
    assert_eq!(
        result.entry.description,
        "Remove dig site site_tiyanki_graveyard (#1) from planet #1019"
    );
    assert_eq!(
        result.inverse,
        add(GRAVEYARD_PLANET, "site_tiyanki_graveyard", 3)
    );
    assert_eq!(result.details_stale, vec![system]);
    assert_eq!(site(&session, GRAVEYARD_PLANET), None);
    assert!(listed(&session, system).is_empty());

    let added = session.apply(result.inverse).expect("add one back");
    assert_eq!(added.inverse, remove(4), "the id past the highest left");
}

/// The 4.5 sample with site 1 dug as the game writes a site being excavated: a fleet on it,
/// a log of rolls, clues and the countries that see it.
fn with_site_being_dug() -> Session {
    open_edited_sample(SAMPLE_4_5, |gamestate, _| {
        let at = gamestate
            .find("\t\t1=\n\t\t{\n\t\t\tlocation=")
            .expect("site 1");
        let dug = gamestate[at..]
            .replacen(
                "\t\t\tlast_excavator_country=4294967295\n\t\t\texcavator_fleet=4294967295\n",
                "\t\t\tlast_excavator_country=0\n\t\t\texcavator_fleet=12\n",
                1,
            )
            .replacen(
                "\t\t\tindex=0\n\t\t\tclues=0\n\t\t\tlast_roll=0\n",
                "\t\t\tindex=0\n\t\t\tlog=\n\t\t\t{\n\t\t\t\t\n\t\t\t\t{\n\t\t\t\t\ttitle=\"\"\n\t\t\t\t\ttooltip=\"\"\n\t\t\t\t\tclues=5\n\t\t\t\t\ttotal=5\n\t\t\t\t\troll=9\n\t\t\t\t\tbonus=4\n\t\t\t\t\tdifficulty=3\n\t\t\t\t\tdate=\t\t\t\t\t\"2201.03.20\"\n\t\t\t\t}\n\t\t\t}\n\t\t\tclues=5\n\t\t\tlast_roll=9\n",
                1,
            )
            .replacen(
                "\t\t\tdifficulty=3\n\t\t}\n",
                "\t\t\tdifficulty=3\n\t\t\tvisible_to=\n\t\t\t{\n\t\t\t\t0 \n\t\t\t}\n\t\t}\n",
                1,
            );
        gamestate.replace_range(at.., &dug);
    })
}

#[test]
fn a_site_being_dug_is_removed_whole_and_undo_puts_it_back() {
    let session = with_site_being_dug();
    let text = String::from_utf8(current(&session)).expect("utf-8");
    assert!(
        text.contains("\t\t\tlog=\n") && text.contains("\t\t\tvisible_to=\n\t\t\t{\n\t\t\t\t0 \n")
    );
    round_trip(session, remove(GRAVEYARD));
}

#[test]
fn removing_a_site_being_dug_says_a_fleet_is_excavating_it() {
    let mut session = with_site_being_dug();
    let shown = site(&session, GRAVEYARD_PLANET).expect("a site");
    assert!(shown.excavating);
    assert_eq!(shown.clues, 5);
    let result = session.apply(remove(GRAVEYARD)).expect("remove it");
    assert_eq!(
        result.entry.description,
        "Remove dig site site_tiyanki_graveyard (#1) from planet #1019, which a fleet is excavating"
    );
}

#[test]
fn a_site_round_trips_from_the_file_as_opened() {
    round_trip(open_4_5(), add(BARREN, LOST_MOMENTS, 1));
    round_trip(open_4_5(), remove(0));
    round_trip(open_4_5(), remove(3));
    round_trip(open(), add(749, LOST_MOMENTS, 1));
    round_trip(open(), remove(4));
}

#[test]
fn a_site_is_refused_for_a_star_a_planet_with_one_or_an_unknown_id() {
    let mut session = open_4_5();
    let refusals = [
        (add(99_999, LOST_MOMENTS, 1), "planet 99999 does not exist"),
        (
            add(STAR, LOST_MOMENTS, 1),
            "planet 584 is a star, which takes no dig site",
        ),
        (
            add(COMPANION_STAR, LOST_MOMENTS, 1),
            "planet 619 is a star, which takes no dig site",
        ),
        (
            add(GRAVEYARD_PLANET, LOST_MOMENTS, 1),
            "planet 1019 already has dig site 1",
        ),
        (add(BARREN, "", 1), "a dig site type may not be empty"),
        (
            add(BARREN, "two words", 1),
            "\"two words\" cannot be written as a dig site type",
        ),
        (remove(99), "dig site 99 does not exist"),
    ];
    for (op, message) in refusals {
        let error = session.apply(op).expect_err(message);
        assert_eq!(error.to_string(), message);
    }
    assert!(!session.doc.is_dirty());
    assert!(session.history().undo.is_empty());
}

#[test]
fn a_save_before_stellaris_4_is_refused() {
    let mut session = open_3_4();
    for op in [add(1, LOST_MOMENTS, 1), remove(0)] {
        let error = session.apply(op).expect_err("a 3.4 save");
        assert!(error.to_string().contains("3.4"), "{error}");
    }
    assert!(!session.doc.is_dirty());
}

#[test]
fn a_removed_sites_id_is_not_taken_again() {
    let mut session = open_4_5();
    session.apply(remove(3)).expect("remove the highest site");
    let added = session
        .apply(add(BARREN, LOST_MOMENTS, 1))
        .expect("add a site");
    assert_eq!(added.inverse, remove(4));
    let again = session
        .apply(add(MOON, LOST_MOMENTS, 1))
        .expect("add another");
    assert_eq!(again.inverse, remove(5));
}

/// The 4.5 sample with its `archaeological_sites` section replaced by `section`.
fn with_sites_section(section: &'static str) -> Session {
    open_edited_sample(SAMPLE_4_5, move |gamestate, _| {
        let start = gamestate
            .find("\narchaeological_sites=\n")
            .expect("the section")
            + 1;
        let end = start + gamestate[start..].find("\n}\n").expect("its end") + 3;
        gamestate.replace_range(start..end, section);
    })
}

#[test]
fn an_empty_inline_sites_block_takes_each_new_site_on_a_line_of_its_own() {
    let mut session = with_sites_section("archaeological_sites=\n{\n\tsites={ }\n}\n");
    assert_eq!(site(&session, BARREN), None);
    let first = session
        .apply(add(BARREN, LOST_MOMENTS, 1))
        .expect("add a site");
    assert_eq!(first.inverse, remove(0));
    let second = session
        .apply(add(MOON, "site_krazura_dig", 3))
        .expect("add another");
    assert_eq!(second.inverse, remove(1));
    common::snapshot("inline_empty_4_5", &plain_report(&session, &second));
    assert_eq!(site(&session, BARREN).map(|s| s.id), Some(0));
    assert_eq!(site(&session, MOON).map(|s| s.id), Some(1));

    session.undo().expect("undo").expect("the second add");
    session.undo().expect("undo").expect("the first add");
    assert_eq!(current(&session), session.doc.original());
}

#[test]
fn a_section_without_a_sites_block_is_refused() {
    let mut session = with_sites_section("archaeological_sites=\n{\n}\n");
    let error = session
        .apply(add(BARREN, LOST_MOMENTS, 1))
        .expect_err("no sites block");
    assert_eq!(error.to_string(), "the save has no `sites`");
    assert!(!session.doc.is_dirty());
}
