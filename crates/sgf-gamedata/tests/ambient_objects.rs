//! The install's ambient objects, named from its localisation, with the model the system view
//! draws each with.

use std::collections::BTreeSet;

use crate::common;

use sgf_gamedata::ambient_object_views::AmbientObjectView;

fn view<'a>(views: &'a [AmbientObjectView], key: &str) -> &'a AmbientObjectView {
    views
        .iter()
        .find(|view| view.key == key)
        .unwrap_or_else(|| panic!("{key} is an ambient object"))
}

#[test]
fn the_installs_derelicts_and_debris_are_read_and_named() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.ambient_object_views();
    assert_eq!(views.len(), gd.ambient_objects.len());

    let wreck = view(&views, "abandoned_ship_object");
    assert_eq!(wreck.name, "Ship Debris");
    assert_eq!(
        wreck.entity.as_deref(),
        Some("abandoned_ship_destroyed_entity")
    );
    assert!(wreck.selectable && wreck.show_name);
    assert_eq!(
        wreck.portrait.as_deref(),
        Some("model:none:abandoned_ship_destroyed_entity")
    );

    let unlabelled = view(&views, "abandoned_ship_2_object");
    assert_eq!(
        unlabelled.name, "Derelict Ship",
        "its name is a reference to the derelict's"
    );
    assert!(!unlabelled.selectable && !unlabelled.show_name);

    let debris = view(&views, "small_debris_object");
    assert_eq!(debris.entity.as_deref(), Some("debris_small_01_entity"));
    assert!(!debris.selectable && !debris.show_name);

    let probe = view(&views, "sublight_probe_object");
    assert_eq!(probe.name, "Sublight Probe");
    assert_eq!(
        probe.description.as_deref(),
        Some(
            "A primitive sublight space probe that appears to be several centuries old. Its power \
             supply has long since been depleted."
        )
    );
    assert_eq!(debris.description, None, "it names no description");
    assert_eq!(probe.portrait.as_deref(), Some("model:none:probe_entity"));
}

#[test]
fn most_objects_have_a_portrait_and_a_cloud_or_particle_effect_has_none() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let views = gd.ambient_object_views();
    let portraits: BTreeSet<&str> = views
        .iter()
        .filter_map(|view| view.portrait.as_deref())
        .collect();
    assert!(portraits.len() > 60, "{} portraits", portraits.len());
    for key in [
        "explosion_particle_object",
        "nebula_1",
        "turbulent_nebula_1",
    ] {
        assert_eq!(
            view(&views, key).portrait,
            None,
            "{key} has nothing to draw"
        );
    }
}
