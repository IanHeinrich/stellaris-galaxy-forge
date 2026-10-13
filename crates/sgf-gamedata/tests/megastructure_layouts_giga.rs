//! Gigastructural Engineering's ring worlds as the editor adds them, with `SGF_PLAYSET=1`:
//! its own ring world chain and its titanic, behemoth and gargantuan rings.

use crate::common;

use sgf_core::ops::RingQuadrant;
use sgf_gamedata::construction::ring_world::{self as added, RingStage};
use sgf_gamedata::registries::megastructures::{Placement, Unsupported};

/// With Gigastructural Engineering enabled, its own ring world chain is added as it built
/// Acahuabene in a 4.5.2 save: rows named "Ring Section A" to "D" in `mammalian_01`, which
/// Giga gives a ring of any culture outside its ten, segments drawn in the owner's
/// `biogenesis_01` from Giga's own models, its flags, `ring_world_built` with the fourth
/// section and the section count `ring_segments`. A culture Giga has no model for takes the
/// base game's. Runs with `SGF_PLAYSET=1` when the enabled mods include Giga.
#[test]
fn gigas_ring_world_is_added_as_it_builds_one() {
    let Some(gd) = common::giga() else {
        return;
    };
    use RingStage::*;
    let culture = Some("biogenesis_01");
    let ring = added::ring_world(gd, "ring_world_1", &[Finished; 4], culture, &[]).expect("ring");
    assert_eq!(ring.star_flags, ["has_megastructure"]);
    assert_eq!(
        ring.system_flags,
        [
            "giga_forbid_planet_dismantlement",
            "ring_01",
            "ring_02",
            "ring_03",
            "ring_world_built",
            "ring_04"
        ]
    );
    assert_eq!(
        ring.system_variables
            .iter()
            .map(|v| (v.name.as_str(), v.value))
            .collect::<Vec<_>>(),
        [("ring_segments", 0.0)]
    );
    let RingQuadrant::Finished { segments } = &ring.quadrants[0] else {
        panic!("{:?}", ring.quadrants[0]);
    };
    let shown: Vec<_> = segments
        .iter()
        .map(|s| {
            (
                s.planet.at.angle,
                s.planet.name.as_str(),
                s.planet.model.as_deref(),
                s.planet
                    .flags
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
                s.megastructure_icon,
            )
        })
        .collect();
    assert_eq!(
        shown,
        [
            (
                210.0,
                "Ring Section",
                Some("biogenesis_01_vanilla_tech_entity"),
                vec![
                    "forbid_guillis_planet_modifiers",
                    "megastructure",
                    "colony_event"
                ],
                false
            ),
            (
                180.0,
                "Ring Section",
                Some("biogenesis_01_vanilla_seam_entity"),
                vec!["forbid_guillis_planet_modifiers", "megastructure"],
                false
            ),
            (
                150.0,
                "Habitable Section A",
                Some("biogenesis_01_vanilla_gaia_habitable_entity"),
                vec![
                    "forbid_guillis_planet_modifiers",
                    "megastructure",
                    "colony_event",
                    "giga_ringworld_van"
                ],
                true
            ),
        ]
    );

    let begun = added::ring_world(
        gd,
        "ring_world_2",
        &[Finished, Frame, Frame, Frame],
        culture,
        &[],
    )
    .expect("one section finished");
    assert_eq!(
        begun.system_flags,
        ["giga_forbid_planet_dismantlement", "ring_01"]
    );
    assert_eq!(begun.system_variables[0].value, 1.0);
    let RingQuadrant::Frame { row } = &begun.quadrants[1] else {
        panic!("{:?}", begun.quadrants[1]);
    };
    assert_eq!(row.kind, "ring_world_2");
    assert_eq!(row.name.as_deref(), Some("Ring Section B"));
    assert_eq!(row.culture.as_deref(), Some("mammalian_01"));
    assert_eq!(row.at.angle, 270.0);

    let other = added::ring_world(gd, "ring_world_2", &[Finished; 4], Some("nowhere_01"), &[])
        .expect("a culture Giga lists no model for");
    let RingQuadrant::Finished { segments } = &other.quadrants[0] else {
        panic!("{:?}", other.quadrants[0]);
    };
    assert_eq!(
        segments[0].planet.model.as_deref(),
        Some("nowhere_01_tech_entity_01_entity")
    );
}

/// With Gigastructural Engineering enabled, its titanic, behemoth and gargantuan rings are
/// ring worlds the editor adds whole, as the chain builds them: radius 90, 134 and 179,
/// habitable sections of size 20, 30 and 40 with the family's housing modifier, Giga's
/// `_sector_entity` models, frame rows named from Ring Section E, I and M in `mammalian_01`, and
/// the flags each leaves. Beside a base game ring holding `ring_01` to `ring_04`, the
/// habitable sections are named E to H. A damaged quadrant is refused: the game's ruin
/// effect knows no row of theirs. The add dialog's views give each ring its radius, the base
/// game's 45 beside them, and refuse Damaged for the larger three only; each site's name, from
/// which the dialog names its size, is plain text. Runs with `SGF_PLAYSET=1` when the enabled
/// mods include Giga.
#[test]
fn gigas_larger_rings_are_added_whole() {
    let Some(gd) = common::giga() else {
        return;
    };
    use RingStage::*;
    let held = ["ring_01", "ring_02", "ring_03", "ring_04"].map(str::to_owned);
    let culture = Some("biogenesis_01");
    let views = gd.megastructure_views();
    let ring_view = |key: &str| {
        let view = views.iter().find(|v| v.def.key == key).expect(key);
        (
            view.ring_world_radius,
            view.ring_world_refused_stages.clone(),
        )
    };
    let (vanilla, vanilla_refused) = ring_view("ring_world_2_intermediate");
    assert!(
        vanilla.is_some_and(|r| (r - 45.0).abs() < 1.0),
        "{vanilla:?}"
    );
    assert!(!vanilla_refused.contains(&Damaged), "{vanilla_refused:?}");
    for (size, short, letter, radius, habitable, built) in [
        ("titanic", "tit", "E", 90.0, 20, "ring_world_built_one"),
        ("behemoth", "beh", "I", 134.0, 30, "ring_world_built_two"),
        (
            "gargantuan",
            "gar",
            "M",
            179.0,
            40,
            "ring_world_built_three",
        ),
    ] {
        let site = format!("ringworld_{size}_0");
        let frame = format!("ringworld_{}_3x_segment", &size[..1]);
        let mega = |key: &str| gd.megastructures.get(key).expect(key);
        let (view_radius, refused) = ring_view(&format!("ringworld_{size}_1"));
        assert!(
            view_radius.is_some_and(|r| (r - radius).abs() < 1.0),
            "{size}: {view_radius:?}"
        );
        assert!(refused.contains(&Damaged), "{size}: {refused:?}");
        let site_name = gd.loc.get(&site).expect("the site's name");
        assert!(!site_name.contains('§'), "{site_name:?}");
        let title = format!("{}{}", size[..1].to_uppercase(), &size[1..]);
        assert_eq!(
            site_name.replace('\u{200b}', "").trim(),
            format!("{title} Ringworld Site")
        );
        assert_eq!(mega(&site).placement, Placement::Body { star_only: true });
        for key in [
            format!("ringworld_{size}_1"),
            frame.clone(),
            format!("ringworld_{size}_2"),
            format!("ring_world_{size}_ruined"),
            format!("ring_world_{size}_restored"),
        ] {
            assert_eq!(
                mega(&key).placement,
                Placement::Unsupported {
                    why: Unsupported::RingWorld
                },
                "{key}"
            );
            let view = views.iter().find(|v| v.def.key == key).expect("its view");
            assert_eq!(view.ring_world_refused, None, "{key}");
        }
        assert_eq!(
            mega(&format!("ring_world_{size}_ruined"))
                .variant_of
                .as_deref(),
            Some(site.as_str())
        );

        let ring = added::ring_world(gd, &site, &[Finished; 4], culture, &held).expect(&site);
        assert_eq!(ring.star_flags, ["has_megastructure"], "{size}");
        assert_eq!(
            ring.system_flags,
            [
                format!("giga_has_{size}_ring"),
                "ring_05".to_owned(),
                "ring_06".to_owned(),
                "ring_07".to_owned(),
                built.to_owned(),
                "ring_08".to_owned(),
            ],
            "{size}"
        );
        let names: Vec<&str> = ring
            .quadrants
            .iter()
            .map(|q| match q {
                RingQuadrant::Finished { segments } => segments[2].planet.name.as_str(),
                other => panic!("{other:?}"),
            })
            .collect();
        assert_eq!(
            names,
            [
                "Habitable Section E",
                "Habitable Section F",
                "Habitable Section G",
                "Habitable Section H"
            ]
        );
        let RingQuadrant::Finished { segments } = &ring.quadrants[0] else {
            panic!("{:?}", ring.quadrants[0]);
        };
        let shown: Vec<_> = segments
            .iter()
            .map(|s| {
                (
                    s.planet.class.as_str(),
                    s.planet.size,
                    s.planet.at.radius,
                    s.planet.model.clone(),
                    s.planet
                        .modifiers
                        .iter()
                        .map(|m| (m.modifier.clone(), m.days))
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        let model = |part: &str| Some(format!("biogenesis_01_{size}_{part}_sector_entity"));
        assert_eq!(
            shown,
            [
                ("pc_ringworld_tech", 10, radius, model("tech"), vec![]),
                ("pc_ringworld_seam", 10, radius, model("seam"), vec![]),
                (
                    "pc_ringworld_habitable",
                    habitable,
                    radius,
                    model("gaia_habitable"),
                    vec![(format!("giga_{size}_housing"), None)]
                ),
            ],
            "{size}"
        );
        assert!(
            segments[2]
                .planet
                .flags
                .contains(&format!("giga_ringworld_{short}")),
            "{:?}",
            segments[2].planet.flags
        );

        let begun = added::ring_world(gd, &site, &[Frame, Ruined, Frame, Frame], culture, &[])
            .expect("frames and a ruin");
        let RingQuadrant::Frame { row } = &begun.quadrants[0] else {
            panic!("{:?}", begun.quadrants[0]);
        };
        assert_eq!(
            (
                row.kind.as_str(),
                row.name.as_deref(),
                row.culture.as_deref(),
                row.at.radius
            ),
            (
                frame.as_str(),
                Some(format!("Ring Section {letter}").as_str()),
                Some("mammalian_01"),
                radius
            )
        );
        let RingQuadrant::Ruined { row } = &begun.quadrants[1] else {
            panic!("{:?}", begun.quadrants[1]);
        };
        assert_eq!(row.kind, format!("ring_world_{size}_ruined"));
        assert_eq!(
            added::ring_world(gd, &site, &[Damaged; 4], culture, &[]),
            Err(format!(
                "the game's set_ruined_megastructure leaves its {frame} row as it is"
            ))
        );
    }
}

/// With Gigastructural Engineering enabled, the session takes the titanic ring's site, stages,
/// frame sections and ruin as ring world rows, so none of them is deleted or moved on its own.
#[test]
fn gigas_titanic_ring_is_a_ring_world_to_the_session() {
    let Some(gd) = common::giga() else {
        return;
    };
    let types = added::ring_world_types(gd);
    for kind in [
        "ringworld_titanic_0",
        "ringworld_titanic_1",
        "ringworld_t_3x_segment",
        "ringworld_titanic_2",
        "ring_world_titanic_ruined",
    ] {
        assert!(types.is_ring_row(kind), "{kind}");
    }
    assert!(!types.is_ring_row("dyson_sphere_1"));
}

/// With Gigastructural Engineering enabled, the rings a delete reads are laid out nearest the
/// star first, each beside those before it. Giga's base ring at 45 takes `ring_01` to
/// `ring_04`, and the titanic ring at 90 lists the flags the add writes beside it, `ring_05`
/// to `ring_08`. Both name their sections `ring_` and a number.
#[test]
fn gigas_rings_list_the_flags_the_add_writes_beside_the_base_ring() {
    let Some(gd) = common::giga() else {
        return;
    };
    let rings = gd.ring_flags();
    let at = |radius: f64| {
        rings
            .iter()
            .find(|ring| (ring.radius - radius).abs() < 1.0)
            .unwrap_or_else(|| panic!("a ring at {radius}: {rings:?}"))
    };
    let base = at(45.0);
    let held: Vec<String> = base
        .flags
        .iter()
        .filter(|flag| flag.starts_with("ring_0"))
        .cloned()
        .collect();
    assert_eq!(held, ["ring_01", "ring_02", "ring_03", "ring_04"]);
    let written = added::ring_world(
        gd,
        "ringworld_titanic_0",
        &[RingStage::Finished; 4],
        Some("biogenesis_01"),
        &held,
    )
    .expect("the titanic ring");
    let titanic = at(90.0);
    assert_eq!(titanic.flags, written.system_flags);
    assert_eq!(
        titanic.flags,
        [
            "giga_has_titanic_ring",
            "ring_05",
            "ring_06",
            "ring_07",
            "ring_world_built_one",
            "ring_08"
        ]
    );
    assert_eq!(base.sections, ["ring_"]);
    assert_eq!(titanic.sections, ["ring_"]);
}
