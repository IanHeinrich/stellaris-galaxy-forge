//! What the grammar fixture's spawn weights read as: the numbers, the trigger text and
//! the country flag a modifier holds the system for.

mod common;
use common::fixture::GRAMMAR;

#[test]
fn a_modifier_is_read_as_its_numbers_its_trigger_text_and_its_country_flag() {
    let session = GRAMMAR.open();
    let modifiers = |id: u32| session.graph.systems[&id].spawn_modifiers.clone();

    let [flagged] = &modifiers(2)[..] else {
        panic!("system 2 has one modifier")
    };
    assert_eq!(flagged.factor, None);
    assert_eq!(flagged.add, Some(10000.0));
    assert_eq!(flagged.trigger, "has_country_flag = galactic_empire");
    assert_eq!(flagged.country_flag.as_deref(), Some("galactic_empire"));

    let [scripted] = &modifiers(888)[..] else {
        panic!("system 888 has one modifier")
    };
    assert_eq!(scripted.factor, Some(0.0));
    assert_eq!(scripted.add, None);
    assert_eq!(scripted.trigger, "is_ai = yes");
    assert_eq!(scripted.country_flag, None);

    assert_eq!(
        modifiers(512)[0].country_flag.as_deref(),
        Some("sgf_grammar")
    );
    assert!(modifiers(3018).is_empty());
    assert!(modifiers(1).is_empty());
}

#[test]
fn a_spawn_design_is_read_and_a_save_states_none_of_this() {
    let session = GRAMMAR.open();
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
