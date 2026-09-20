//! What the grammar fixture's spawn weights read as: the numbers, the trigger text and
//! what each modifier reserves.

use sgf_core::projections::galaxy::SpawnReservation;

mod common;
use common::scenario::open;

#[test]
fn a_modifier_is_read_as_its_numbers_its_trigger_text_and_what_it_reserves() {
    let session = open();
    let modifiers = |id: u32| session.graph.systems[&id].spawn_modifiers.clone();

    let [flagged] = &modifiers(2)[..] else {
        panic!("system 2 has one modifier")
    };
    assert_eq!(flagged.factor, None);
    assert_eq!(flagged.add, Some(10000.0));
    assert_eq!(flagged.trigger, "has_country_flag = galactic_empire");
    assert_eq!(
        flagged.reservation,
        Some(SpawnReservation::CountryFlag("galactic_empire".to_owned()))
    );

    let [reserved] = &modifiers(888)[..] else {
        panic!("system 888 has one modifier")
    };
    assert_eq!(reserved.factor, Some(0.0));
    assert_eq!(reserved.add, None);
    assert_eq!(reserved.trigger, "is_ai = yes");
    assert_eq!(reserved.reservation, Some(SpawnReservation::Human));

    assert_eq!(
        modifiers(512)[0].reservation,
        Some(SpawnReservation::CountryFlag("sgf_grammar".to_owned()))
    );
    assert!(modifiers(3018).is_empty());
    assert!(modifiers(1).is_empty());
}

#[test]
fn a_spawn_design_is_read_and_a_save_states_none_of_this() {
    let session = open();
    assert_eq!(
        session.graph.systems[&111].spawn_design.as_deref(),
        Some("my_design")
    );
    assert_eq!(session.graph.systems[&2].spawn_design, None);

    let save = common::open();
    let system = save.graph.systems.values().next().expect("a system");
    assert!(system.spawn_modifiers.is_empty());
    assert_eq!(system.spawn_design, None);
}
