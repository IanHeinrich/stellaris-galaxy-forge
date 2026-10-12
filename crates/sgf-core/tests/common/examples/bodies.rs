//! The examples of the ops on stars, bodies, empires, belts and wormholes, and the batch.
use sgf_core::ops::{
    ClassChange, EmpireFlag, MapColorPair, MegastructurePlace, NebulaFootprint, NewBypass, NewName,
    Op, Parent, PlanetClassRule, SavedEntity, SavedTable, StarBody, SystemHeight,
};
use sgf_core::projections::galaxy::LGateOutcome;

use super::{
    ADDED_BODY, ADDED_MEGASTRUCTURE, Example, chors_ring, chors_ring_removal, meissa_v, sol_habitat,
};

pub(super) fn examples() -> Vec<Example> {
    vec![
        Example::save(Op::SetLGateOutcome {
            outcome: LGateOutcome::LDrakes,
        }),
        Example::save(Op::SetStarClass {
            system: 1,
            class: "sc_pulsar".to_owned(),
            bodies: vec![StarBody {
                body: 748,
                class: "pc_pulsar".to_owned(),
            }],
        }),
        Example::save(Op::SetBodySize {
            body: 748,
            size: 30,
        }),
        Example::save(Op::AddBodyModifier {
            body: 749,
            modifier: "terraforming_candidate".to_owned(),
            days: vec![-1],
            feature: None,
        }),
        Example::save_4_5(Op::RemoveBodyModifier {
            body: 151,
            modifier: "mineral_poor".to_owned(),
            feature: Some("pm_mineral_poor".to_owned()),
        }),
        Example::save_4_5(Op::AddAnomaly {
            body: 3,
            category: "asteroid_uninhabitable_category".to_owned(),
            found_by: None,
        }),
        Example::save_4_5(Op::RemoveAnomaly { body: 185 }),
        Example::save_4_5(Op::SetEmpireMapColors {
            country: 1,
            colors: Some(MapColorPair {
                border: "blue".to_owned(),
                fill: "dark_blue".to_owned(),
            }),
        }),
        Example::save_4_5(Op::SetEmpireFlag {
            country: 0,
            flag: EmpireFlag {
                icon_category: "blocky".to_owned(),
                icon_file: "flag_blocky_18.dds".to_owned(),
                background: "flag_BG_12.dds".to_owned(),
                primary: "blue".to_owned(),
                secondary: "dark_blue".to_owned(),
            },
        }),
        Example::save(Op::RenameEmpire {
            country: 0,
            name: "Sgf Dominion".to_owned(),
            value: None,
            custom_name: true,
        }),
        Example::save(Op::AddSystemFromSpec {
            spec: crate::common::spec::dorellion(),
        }),
        Example::save(Op::AddDeposit {
            body: 2,
            kind: "d_minerals_3".to_owned(),
        }),
        Example::save(Op::RemoveDeposit { deposit: 26 }),
        Example::added(Op::ReplaceSystemFromSpec {
            system: 791,
            spec: crate::common::spec::rerolled(crate::common::spec::dorellion()),
        }),
        Example::save(Op::SetNebulaTurbulent {
            nebula: 0,
            turbulent: true,
        }),
        Example::save(Op::SetNebulaFootprints {
            footprints: vec![NebulaFootprint {
                system: 108,
                cloud: None,
                cloaking: false,
                turbulent: false,
            }],
        }),
        Example::save_4_5(Op::MoveBody {
            system: 1,
            body: 585,
            radius: 70.0,
            angle: 40.0,
        }),
        Example::save_4_5(Op::SetBodyParent {
            system: 1,
            body: 588,
            parent: Parent::Body(589),
            radius: 20.0,
            angle: 90.0,
        }),
        Example::save_4_5(Op::MoveWormhole {
            wormhole: 1,
            radius: 300.0,
            angle: 45.0,
        }),
        Example::save_4_5(Op::AddWormholePair {
            a: 1,
            b: 140,
            at: None,
        }),
        Example::save_4_5(Op::RemoveWormholePair { a: 489, b: 152 }),
        Example::save_4_5(Op::SetBodyRing {
            body: 585,
            ring: true,
        }),
        Example::save_4_5(Op::SetBodyModel {
            body: 585,
            entity: Some("ocean_paradise_planet_01_entity".to_owned()),
        }),
        Example::save_4_5(Op::SetBodyClass {
            body: 585,
            from: PlanetClassRule {
                class: "pc_barren".to_owned(),
                change: ClassChange::Uncolonised,
                models: 3,
            },
            to: PlanetClassRule {
                class: "pc_ocean".to_owned(),
                change: ClassChange::Any,
                models: 3,
            },
            look: None,
        }),
        Example::save_4_5(Op::AddBelt {
            system: 140,
            kind: "rocky_asteroid_belt".to_owned(),
            radius: 120.0,
        }),
        Example::save_4_5(Op::RemoveBelt {
            system: 140,
            index: 1,
        }),
        Example::save_4_5(Op::SetBeltRadius {
            system: 140,
            index: 0,
            radius: 55.0,
        }),
        Example::save_4_5(Op::SetBeltKind {
            system: 140,
            index: 0,
            kind: "icy_asteroid_belt".to_owned(),
        }),
        Example::save_4_5(Op::SetInnerRadius {
            system: 1,
            radius: 200.0,
        }),
        Example::save_4_5(Op::MoveBodyToSystem {
            body: 99,
            to: 216,
            at: None,
        }),
        Example::save_4_5(Op::RenameBody {
            body: 140,
            name: NewName::Literal("Nova Terra".to_owned()),
        }),
        Example::save(Op::RemoveColony { body: 217 }),
        Example::save(Op::DeleteBody { body: 12 }),
        Example::save_4_5(Op::DeleteMegastructure {
            megastructure: 6,
            dismantle: None,
        }),
        Example::save_4_5(Op::DeleteRingWorld {
            system: 203,
            radius: None,
        }),
        Example::save_4_5(Op::RestoreEntities {
            description: "Left queue 0 with no owner".to_owned(),
            entities: vec![SavedEntity {
                table: SavedTable::ConstructionQueue,
                id: 0,
                text: "0=
			{
				owner=4294967295
				location=
				{
					type=2
					id=2
				}
				simultaneous=1
				type=planet
			}"
                .to_owned(),
            }],
        }),
        Example::save_4_5(meissa_v()),
        Example::added_body(Op::RemoveBody { body: ADDED_BODY }),
        Example::save_4_5(sol_habitat()),
        Example::save_4_5(chors_ring(Some(0))),
        Example::added_ring_world(chors_ring_removal()),
        Example::save(Op::AddDigSite {
            body: 749,
            site_type: "site_lost_moments".to_owned(),
            difficulty: 1,
        }),
        Example::save(Op::RemoveDigSite { site: 0 }),
        Example::save_4_5(Op::AddMegastructure {
            system: 1,
            kind: "gateway_final".to_owned(),
            name: None,
            at: MegastructurePlace::Free { x: 0.0, y: -260.0 },
            owner: None,
            bypass: Some(NewBypass {
                kind: "gateway".to_owned(),
                active: true,
            }),
            ruined_orbital_ring: false,
            megastructure_flag: false,
            orbital_flag: false,
            star_only: false,
            construction: None,
            left_out: 0,
        }),
        Example::added_megastructure(Op::RemoveMegastructure {
            megastructure: ADDED_MEGASTRUCTURE,
            construction: None,
        }),
        Example::save_4_5(Op::MoveMegastructure {
            megastructure: 4,
            at: MegastructurePlace::Body { body: 933 },
        }),
        Example::save(Op::SetSystemHeights {
            heights: vec![SystemHeight {
                system: 0,
                height: Some(10.0),
            }],
        }),
        Example::each(
            Op::Batch {
                description: "Moved system 0 and cut its lane to 752".to_owned(),
                ops: vec![
                    Op::MoveSystem {
                        system: 0,
                        x: -150.0,
                        y: 60.0,
                    },
                    Op::RemoveLane { a: 0, b: 752 },
                ],
            },
            Op::Batch {
                description: "Moved system 0 and cut its lane to 5".to_owned(),
                ops: vec![
                    Op::MoveSystem {
                        system: 0,
                        x: -150.0,
                        y: 60.0,
                    },
                    Op::RemoveLane { a: 0, b: 5 },
                ],
            },
        ),
    ]
}
