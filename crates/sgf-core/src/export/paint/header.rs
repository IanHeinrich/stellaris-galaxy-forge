//! The `static_galaxy_scenario` header the mod sizes its fixes by.

use crate::emit::coord;
use crate::format::scenario::emit::{ScenarioOptions, VANILLA_SHAPES};
use crate::format::scenario::header_counts::{SeatCounts, fallen_count, seat_entries};
use crate::format::scenario::paint::{HEADER_NOTE, WORKSHOP_ID};
use crate::keys::scenario as keys;
use crate::projections::galaxy::GameSetup;

/// The most wormhole pairs and gateways the header allows unless the save asked for more.
const BYPASS_MAX: u32 = 5;

/// What the header's counts are sized from: the seats, the zones, and either the save's
/// setup screen or the band on the system count.
pub(crate) struct HeaderCounts {
    seats: SeatCounts,
    /// `num_empire_default`, `advanced_empire_default` and `nomad_empire_default` as
    /// the setup asked, or `None` for the seats' shares.
    empires: Option<[u32; 3]>,
    fallen_max: u32,
    fallen_default: u32,
    marauders: u32,
    crisis: &'static str,
    wormhole_pairs: u32,
    gateways: u32,
    hyperlanes: f64,
    colonizable_planet_odds: f64,
    primitive_odds: f64,
    /// The shape listed first.
    shape: Option<String>,
}

impl HeaderCounts {
    /// Sized by the map alone: `seats`, `zones` fallen empire zones, and the band on
    /// `systems` for the rest.
    pub(crate) fn sized(systems: usize, seats: SeatCounts, zones: u32, clans: u32) -> Self {
        let (fallen, crisis) = size_band(systems);
        let fallen_max = fallen_count(zones);
        Self {
            seats,
            empires: None,
            fallen_max,
            fallen_default: fallen.min(fallen_max),
            marauders: clans,
            crisis,
            wormhole_pairs: 1,
            gateways: 1,
            hyperlanes: 1.0,
            colonizable_planet_odds: 1.0,
            primitive_odds: 1.0,
            shape: None,
        }
    }

    /// Sized by the save's setup screen: its counts and odds as set, `typed` fallen
    /// empires as the default, and the marauder `clans` whose homes the map holds.
    pub(super) fn from_setup(
        setup: &GameSetup,
        systems: usize,
        seats: SeatCounts,
        typed: u32,
        zones: u32,
        clans: u32,
    ) -> Self {
        let sized = Self::sized(systems, seats, zones, clans);
        Self {
            empires: Some([
                setup.num_empires,
                setup.num_advanced_empires,
                setup.num_nomad_empires,
            ]),
            fallen_default: typed.min(sized.fallen_max),
            wormhole_pairs: setup.num_wormhole_pairs,
            gateways: setup.num_gateways,
            hyperlanes: setup.num_hyperlanes,
            colonizable_planet_odds: setup.habitability,
            primitive_odds: setup.primitive,
            shape: Some(setup.shape.clone()),
            ..sized
        }
    }
}

/// The header for `counts`, on Forge's own `core_radius`.
pub(crate) fn header(options: &ScenarioOptions, counts: &HeaderCounts) -> Vec<u8> {
    let mut entries = seat_entries(counts.seats);
    if let Some([empires, advanced, nomads]) = counts.empires {
        let most = counts.seats.most();
        let safe = counts.seats.safe();
        for (key, value) in &mut entries {
            let count = match *key {
                keys::NUM_EMPIRE_DEFAULT => empires.min(safe),
                keys::ADVANCED_EMPIRE_DEFAULT => advanced.min(most),
                keys::NOMAD_EMPIRE_DEFAULT => nomads.min(most),
                _ => continue,
            };
            *value = count.to_string();
        }
    }
    let seats: String = entries
        .iter()
        .map(|(key, value)| format!("\t{key} = {value}\n"))
        .collect();
    let shapes: String = shapes(counts.shape.as_deref())
        .iter()
        .map(|shape| format!("\tsupports_shape = {shape}\n"))
        .collect();
    format!(
        "# Written by Stellaris Galaxy Forge {HEADER_NOTE} (Steam Workshop {WORKSHOP_ID}), which this map requires.\n\
         static_galaxy_scenario = {{\n\
         \tname = \"{}\"\n\
         \tpriority = 10\n\
         {shapes}\
         \trandom_hyperlanes = no\n\
         \tnum_wormhole_pairs = {{ min = 0 max = {} }}\n\
         \tnum_wormhole_pairs_default = {}\n\
         \tnum_gateways = {{ min = 0 max = {} }}\n\
         \tnum_gateways_default = {}\n\
         \tnum_hyperlanes = {{ min = 0.5 max = 3 }}\n\
         \tnum_hyperlanes_default = {}\n\
         \tcolonizable_planet_odds = {}\n\
         \tprimitive_odds = {}\n\
         \tfallen_empire_max = {}\n\
         \tmarauder_empire_max = {}\n\
         \textra_crisis_strength = {{ 10 25 }}\n\
         {seats}\
         \tfallen_empire_default = {}\n\
         \tmarauder_empire_default = {}\n\
         \tcrisis_strength = {}\n\
         \tcore_radius = {}\n\
         \n",
        options.name,
        BYPASS_MAX.max(counts.wormhole_pairs),
        counts.wormhole_pairs,
        BYPASS_MAX.max(counts.gateways),
        counts.gateways,
        coord(counts.hyperlanes),
        odds(counts.colonizable_planet_odds),
        odds(counts.primitive_odds),
        counts.fallen_max,
        counts.marauders,
        counts.fallen_default,
        counts.marauders,
        counts.crisis,
        coord(options.core_radius)
    )
    .into_bytes()
}

/// The vanilla shapes in the game's order, `first` ahead of the rest when it is one.
fn shapes(first: Option<&str>) -> Vec<&'static str> {
    let mut shapes: Vec<&'static str> = VANILLA_SHAPES.to_vec();
    if let Some(i) = first.and_then(|first| shapes.iter().position(|shape| *shape == first)) {
        let shape = shapes.remove(i);
        shapes.insert(0, shape);
    }
    shapes
}

/// An odds value as the header writes it: `1.0`, `0.25`.
fn odds(value: f64) -> String {
    if value == value.trunc() {
        format!("{value:.1}")
    } else {
        coord(value)
    }
}

/// Fallen empires and crisis strength by galaxy size.
fn size_band(systems: usize) -> (u32, &'static str) {
    match systems {
        1000.. => (4, "1.5"),
        800.. => (3, "1.25"),
        600.. => (2, "1.0"),
        400.. => (1, "0.75"),
        _ => (0, "0.5"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ScenarioOptions {
        ScenarioOptions {
            name: "sgf_paint".into(),
            core_radius: 30.0,
            num_empires: (0, 1),
            exported_from: None,
        }
    }

    fn seats(seats: u32, reserved: u32, player_on_reserved: bool) -> SeatCounts {
        SeatCounts {
            seats,
            reserved,
            player_on_reserved,
        }
    }

    fn header_text(systems: usize, spawns: u32, zones: u32) -> String {
        let counts = HeaderCounts::sized(systems, seats(spawns, 0, false), zones, 2);
        String::from_utf8(header(&options(), &counts)).unwrap()
    }

    #[test]
    fn the_header_counts_empires_from_the_spawns_and_sizes_the_rest_by_systems() {
        let text = header_text(791, 12, 4);
        assert!(text.starts_with("# Written by Stellaris Galaxy Forge"));
        assert!(text.contains("\tfallen_empire_max = 4\n"), "{text}");
        assert!(text.contains("\tnum_empires = { min = 0 max = 11 }\n\tnum_empire_default = 6\n\tadvanced_empire_default = 1\n\tnomad_empire_default = 1\n\tnomad_empire_max = 11\n\tfallen_empire_default = 2\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0\n\tcore_radius = 30\n"), "{text}");
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
        assert!(
            text.contains("\tnum_wormhole_pairs = { min = 0 max = 5 }\n\tnum_wormhole_pairs_default = 1\n\tnum_gateways = { min = 0 max = 5 }\n\tnum_gateways_default = 1\n\tnum_hyperlanes = { min = 0.5 max = 3 }\n\tnum_hyperlanes_default = 1\n\tcolonizable_planet_odds = 1.0\n\tprimitive_odds = 1.0\n"),
            "{text}"
        );

        let none = header_text(0, 0, 0);
        assert!(
            none.contains("\tnum_empires = { min = 0 max = 0 }\n"),
            "{none}"
        );
        assert!(none.contains("\tnomad_empire_max = 0\n"), "{none}");
        assert!(none.contains("\tfallen_empire_max = 0\n"), "{none}");
        assert!(none.contains("\tcrisis_strength = 0.5\n"), "{none}");

        let one = header_text(1000, 4, 1);
        assert!(one.contains("\tfallen_empire_max = 1\n"), "{one}");
        assert!(one.contains("\tfallen_empire_default = 1\n"), "{one}");
        let many = header_text(1000, 4, 9);
        assert!(many.contains("\tfallen_empire_max = 6\n"), "{many}");
        assert!(many.contains("\tfallen_empire_default = 4\n"), "{many}");

        for (systems, band) in [
            (
                399,
                "fallen_empire_default = 0\n\tmarauder_empire_default = 2\n\tcrisis_strength = 0.5",
            ),
            (
                400,
                "fallen_empire_default = 1\n\tmarauder_empire_default = 2\n\tcrisis_strength = 0.75",
            ),
            (
                600,
                "fallen_empire_default = 2\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0",
            ),
            (
                800,
                "fallen_empire_default = 3\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.25",
            ),
            (
                1000,
                "fallen_empire_default = 4\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.5",
            ),
        ] {
            assert!(header_text(systems, 4, 6).contains(band), "{systems}");
        }
    }

    #[test]
    fn a_setup_sets_the_defaults_and_odds_clamped_to_what_the_seats_allow() {
        let setup = GameSetup {
            template: "large".into(),
            shape: "spiral_4".into(),
            num_empires: 13,
            num_advanced_empires: 20,
            num_fallen_empires: 3,
            num_marauder_empires: 2,
            num_nomad_empires: 2,
            num_gateways: 7,
            num_wormhole_pairs: 1,
            num_hyperlanes: 0.75,
            primitive: 0.25,
            habitability: 0.5,
            resource_abundance: Some(1.0),
        };
        let counts = HeaderCounts::from_setup(&setup, 791, seats(17, 1, false), 3, 9, 2);
        let text = String::from_utf8(header(&options(), &counts)).unwrap();
        assert!(
            text.contains("\tpriority = 10\n\tsupports_shape = spiral_4\n\tsupports_shape = elliptical\n\tsupports_shape = ring\n\tsupports_shape = spiral_2\n\tsupports_shape = spiral_3\n\tsupports_shape = spiral_6\n"),
            "{text}"
        );
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
        assert!(
            text.contains("\tnum_wormhole_pairs = { min = 0 max = 5 }\n\tnum_wormhole_pairs_default = 1\n\tnum_gateways = { min = 0 max = 7 }\n\tnum_gateways_default = 7\n\tnum_hyperlanes = { min = 0.5 max = 3 }\n\tnum_hyperlanes_default = 0.75\n\tcolonizable_planet_odds = 0.5\n\tprimitive_odds = 0.25\n\tfallen_empire_max = 6\n"),
            "{text}"
        );
        assert!(
            text.contains("\tnum_empires = { min = 0 max = 16 }\n\tnum_empire_default = 13\n\tadvanced_empire_default = 16\n\tnomad_empire_default = 2\n\tnomad_empire_max = 16\n\tfallen_empire_default = 3\n\tmarauder_empire_default = 2\n\tcrisis_strength = 1.0\n"),
            "{text}"
        );

        let crowded = HeaderCounts::from_setup(&setup, 300, seats(4, 3, false), 0, 0, 0);
        let text = String::from_utf8(header(&options(), &crowded)).unwrap();
        assert!(
            text.contains("\tnum_empires = { min = 0 max = 3 }\n\tnum_empire_default = 0\n\tadvanced_empire_default = 3\n\tnomad_empire_default = 2\n\tnomad_empire_max = 3\n\tfallen_empire_default = 0\n\tmarauder_empire_default = 0\n\tcrisis_strength = 0.5\n"),
            "{text}"
        );
        assert!(text.contains("\tfallen_empire_max = 0\n"), "{text}");
    }
}
