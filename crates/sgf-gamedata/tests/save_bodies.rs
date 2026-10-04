//! A save system's bodies as the install resolves them.
use sgf_core::format::save::details::BodyRole;

use crate::common;

/// Alpha Centauri's red dwarf companion, 327, has two planets that name it as `moon_of`
/// without the moon bit: the install keeps them planets, and 331 a moon.
#[test]
fn planets_of_a_companion_star_stay_planets_with_the_install() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_4();
    let system = session.system(278).expect("Alpha Centauri");
    let mut details = session
        .details()
        .expect("the sample's details")
        .resolve(278, gd, true)
        .expect("system 278's details");
    gd.resolve_save_bodies(&mut details, &system.star_class);
    let body = |id: u32| {
        let p = details.planets.iter().find(|p| p.id == id).expect("a body");
        (p.moon, p.role)
    };
    assert_eq!(body(328), (false, BodyRole::Planet));
    assert_eq!(body(329), (false, BodyRole::Planet));
    assert_eq!(body(327), (false, BodyRole::Star));
    assert_eq!(body(331), (true, BodyRole::Moon));
}

/// The 4.5 sample's habitats in system 596 name the planet they orbit as `moon_of`
/// without the moon bit: the install keeps them planets, as the core reads them.
#[test]
fn a_habitat_about_a_planet_without_the_moon_bit_stays_a_planet() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let system = session.system(596).expect("system 596");
    let mut details = session
        .details()
        .expect("the sample's details")
        .resolve(596, gd, true)
        .expect("system 596's details");
    gd.resolve_save_bodies(&mut details, &system.star_class);
    let habitat = details
        .planets
        .iter()
        .find(|p| p.id == 6268)
        .expect("a habitat");
    assert_eq!(habitat.class, "pc_habitat");
    assert_eq!(habitat.parent, Some(6267));
    assert_eq!((habitat.moon, habitat.role), (false, BodyRole::Planet));
}
