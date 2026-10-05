//! Scenario statements in the shape the New Dawn mod writes them: one statement per
//! line, `key = value` with spaces, ids and names quoted. Positions are the scenario's
//! own numbers; callers undo the map's axis signs before coming here.

use crate::emit::coord;
use crate::format::scenario::header_counts::{SeatCounts, setup_defaults};
use crate::format::scenario::paint;
use crate::projections::galaxy::{GameSetup, SpawnScript};

/// The most wormhole pairs and gateways a header allows unless the save asked for more.
pub(crate) const BYPASS_MAX: u32 = 5;
/// The crisis strength a plain header opens on when no save says otherwise.
const CRISIS_STRENGTH: f64 = 0.75;

/// What a `system` statement carries.
#[derive(Debug, Clone, PartialEq)]
pub struct SystemStmt {
    pub id: u32,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub initializer: Option<String>,
    pub spawn: SpawnStmt,
    /// The body of an `effect = { … }` block, written last as Paint a Galaxy does.
    pub effect: Option<String>,
}

/// The `spawn_weight` a `system` statement carries, the mark of an empire spawn point.
#[derive(Debug, Clone, PartialEq)]
pub enum SpawnStmt {
    None,
    /// `spawn_weight = { base = N }`.
    Base(f64),
    /// A scripted weight, written as the script's dialect renders it.
    Script(SpawnScript),
}

/// The header scalars a generated scenario opens with.
#[derive(Debug, Clone, PartialEq)]
pub struct ScenarioOptions {
    pub name: String,
    pub core_radius: f64,
    pub num_empires: (u32, u32),
    /// The file name of the save the scenario was exported from; `None` for one
    /// started empty.
    pub exported_from: Option<String>,
}

/// The New Game sliders a plain header opens on: each one's default, and the most the
/// header lets it reach where it caps one.
#[derive(Debug, Clone, PartialEq)]
pub struct Sliders {
    pub empires: u32,
    pub advanced_empires: u32,
    pub nomad_empires: u32,
    pub nomad_empires_max: u32,
    /// Both the default and the most.
    pub marauder_empires: u32,
    pub wormhole_pairs: u32,
    pub wormhole_pairs_max: u32,
    pub gateways: u32,
    pub gateways_max: u32,
    pub hyperlanes: f64,
    pub colonizable_planet_odds: f64,
    pub primitive_odds: f64,
    pub crisis_strength: f64,
}

impl Sliders {
    /// Every one of `empires` seats filled and everything random off.
    pub fn fixed(empires: u32) -> Self {
        Self {
            empires,
            advanced_empires: 0,
            nomad_empires: 0,
            nomad_empires_max: 0,
            marauder_empires: 0,
            wormhole_pairs: 0,
            wormhole_pairs_max: 0,
            gateways: 0,
            gateways_max: 0,
            hyperlanes: 0.0,
            colonizable_planet_odds: 1.0,
            primitive_odds: 1.0,
            crisis_strength: CRISIS_STRENGTH,
        }
    }

    /// As the save's `setup` screen left them, the empire counts capped to the `seats`
    /// the map holds and the marauders to its `clans` homes, as the Paint a Galaxy
    /// header caps them.
    pub fn from_setup(setup: &GameSetup, seats: SeatCounts, clans: u32) -> Self {
        let [empires, advanced_empires, nomad_empires] = setup_defaults(seats, setup);
        // Fallen empires stay off: whether the game seats them on a plain map is untested.
        Self {
            empires,
            advanced_empires,
            nomad_empires,
            nomad_empires_max: seats.most(),
            marauder_empires: clans,
            wormhole_pairs: setup.num_wormhole_pairs,
            wormhole_pairs_max: BYPASS_MAX.max(setup.num_wormhole_pairs),
            gateways: setup.num_gateways,
            gateways_max: BYPASS_MAX.max(setup.num_gateways),
            hyperlanes: setup.num_hyperlanes,
            colonizable_planet_odds: setup.habitability,
            primitive_odds: setup.primitive,
            crisis_strength: CRISIS_STRENGTH,
        }
    }
}

/// Every galaxy shape the game ships (`map/galaxy/galaxy_shapes.txt`), in its order.
pub const VANILLA_SHAPES: [&str; 10] = [
    "elliptical",
    "ring",
    "spiral_2",
    "spiral_3",
    "spiral_4",
    "spiral_6",
    "bar",
    "starburst",
    "cartwheel",
    "spoked",
];

/// `system = { id = "3019" name = "" position = { x = 12 y = -34 } … }` on one line.
pub fn system_stmt(indent: &[u8], s: &SystemStmt) -> Vec<u8> {
    let mut out = String::with_capacity(96);
    out.push_str(&format!(
        "system = {{ id = \"{}\" name = \"{}\" position = {{ x = {} y = {} }}",
        s.id,
        s.name,
        coord(s.x),
        coord(s.y)
    ));
    if let Some(initializer) = s.initializer.as_deref().filter(|i| !i.is_empty()) {
        out.push_str(&format!(" initializer = {initializer}"));
    }
    match &s.spawn {
        SpawnStmt::None => {}
        SpawnStmt::Base(weight) => {
            out.push_str(&format!(" spawn_weight = {{ base = {} }}", coord(*weight)));
        }
        SpawnStmt::Script(script) => {
            out.push(' ');
            out.push_str(&paint::weight_statement(script));
        }
    }
    if let Some(effect) = &s.effect {
        out.push_str(&format!(" effect = {{ {effect} }}"));
    }
    out.push_str(" }\n");
    line(indent, out.as_bytes())
}

/// `add_hyperlane = { from = "a" to = "b" }` on one line.
pub fn hyperlane_stmt(indent: &[u8], from: u32, to: u32) -> Vec<u8> {
    line(
        indent,
        format!("add_hyperlane = {{ from = \"{from}\" to = \"{to}\" }}\n").as_bytes(),
    )
}

/// `prevent_hyperlane = { from = "a" to = "b" }` on one line.
pub fn prevent_hyperlane_stmt(indent: &[u8], from: u32, to: u32) -> Vec<u8> {
    line(
        indent,
        format!("prevent_hyperlane = {{ from = \"{from}\" to = \"{to}\" }}\n").as_bytes(),
    )
}

/// `nebula = { name = "…" position = { x = … y = … } radius = … }` on one line.
pub fn nebula_stmt(indent: &[u8], name: &str, x: f64, y: f64, radius: f64) -> Vec<u8> {
    line(
        indent,
        format!(
            "nebula = {{ name = \"{name}\" position = {{ x = {} y = {} }} radius = {} }}\n",
            coord(x),
            coord(y),
            coord(radius)
        )
        .as_bytes(),
    )
}

/// The opening of a scenario file through its header scalars; statements follow, then
/// [`FOOTER`]. Every vanilla shape is supported and the New Game sliders open on
/// `sliders`.
pub fn header(o: &ScenarioOptions, sliders: &Sliders) -> Vec<u8> {
    let (min, max) = o.num_empires;
    let shapes: String = VANILLA_SHAPES
        .iter()
        .map(|shape| format!("\tsupports_shape = {shape}\n"))
        .collect();
    format!(
        "static_galaxy_scenario = {{\n\
         \tname = \"{}\"\n\
         \tpriority = 5\n\
         {shapes}\
         \tdefault = no\n\
         \tnum_empires = {{ min = {min} max = {max} }}\n\
         \tnum_empire_default = {}\n\
         \tfallen_empire_default = 0\n\
         \tfallen_empire_max = 0\n\
         \tmarauder_empire_default = {}\n\
         \tmarauder_empire_max = {}\n\
         \tnomad_empire_default = {}\n\
         \tnomad_empire_max = {}\n\
         \tadvanced_empire_default = {}\n\
         \tcolonizable_planet_odds = {}\n\
         \tprimitive_odds = {}\n\
         \tnum_wormhole_pairs = {{ min = 0 max = {} }}\n\
         \tnum_wormhole_pairs_default = {}\n\
         \tnum_gateways = {{ min = 0 max = {} }}\n\
         \tnum_gateways_default = {}\n\
         \tnum_hyperlanes_default = {}\n\
         \trandom_hyperlanes = no\n\
         \tcore_radius = {}\n\
         \tcrisis_strength = {}\n\
         \textra_crisis_strength = {{ 5 10 25 }}\n\
         \n",
        o.name,
        sliders.empires,
        sliders.marauder_empires,
        sliders.marauder_empires,
        sliders.nomad_empires,
        sliders.nomad_empires_max,
        sliders.advanced_empires,
        odds(sliders.colonizable_planet_odds),
        odds(sliders.primitive_odds),
        sliders.wormhole_pairs_max,
        sliders.wormhole_pairs,
        sliders.gateways_max,
        sliders.gateways,
        coord(sliders.hyperlanes),
        coord(o.core_radius),
        odds(sliders.crisis_strength)
    )
    .into_bytes()
}

/// An odds or strength value as a header writes it: `1.0`, `0.25`.
pub(crate) fn odds(value: f64) -> String {
    if value == value.trunc() {
        format!("{value:.1}")
    } else {
        coord(value)
    }
}

/// The closing brace of a scenario file.
pub const FOOTER: &[u8] = b"}\n";

fn line(indent: &[u8], text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(indent.len() + text.len());
    out.extend_from_slice(indent);
    out.extend_from_slice(text);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projections::galaxy::PaintSpawnKind;

    #[test]
    fn statements_take_the_mods_one_line_shape() {
        let plain = SystemStmt {
            id: 3019,
            name: String::new(),
            x: 12.0,
            y: -34.5,
            initializer: None,
            spawn: SpawnStmt::None,
            effect: None,
        };
        assert_eq!(
            system_stmt(b"\t", &plain),
            b"\tsystem = { id = \"3019\" name = \"\" position = { x = 12 y = -34.5 } }\n"
        );
        let spawn = SystemStmt {
            id: 7,
            name: "Tatooine".into(),
            initializer: Some("random_empire_init_01".into()),
            spawn: SpawnStmt::Base(1.0),
            ..plain.clone()
        };
        assert_eq!(
            system_stmt(b"", &spawn),
            b"system = { id = \"7\" name = \"Tatooine\" position = { x = 12 y = -34.5 } initializer = random_empire_init_01 spawn_weight = { base = 1 } }\n"
        );
        let scripted = SystemStmt {
            spawn: SpawnStmt::Script(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Enabled,
                random_value: 4,
                player: false,
            }),
            effect: Some("set_star_flag = empire_cluster".into()),
            ..plain
        };
        assert_eq!(
            system_stmt(b"", &scripted),
            b"system = { id = \"3019\" name = \"\" position = { x = 12 y = -34.5 } spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|4| } effect = { set_star_flag = empire_cluster } }\n"
        );
        assert_eq!(
            hyperlane_stmt(b"\t", 4231, 4234),
            b"\tadd_hyperlane = { from = \"4231\" to = \"4234\" }\n"
        );
        assert_eq!(
            nebula_stmt(b"\t", "NAME_N_Heart_Galaxy", 0.0, -0.0, 60.0),
            b"\tnebula = { name = \"NAME_N_Heart_Galaxy\" position = { x = 0 y = 0 } radius = 60 }\n"
        );
    }
}
