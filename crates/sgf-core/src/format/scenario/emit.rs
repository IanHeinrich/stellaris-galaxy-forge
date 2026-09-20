//! Scenario statements in the shape the New Dawn mod writes them: one statement per
//! line, `key = value` with spaces, ids and names quoted. Positions are the scenario's
//! own numbers; callers undo the map's axis signs before coming here.

use crate::emit::coord;
use crate::format::scenario::paint;
use crate::projections::galaxy::SpawnScript;

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
/// [`FOOTER`]. Every vanilla shape is supported, empire counts follow the vanilla
/// example, everything random is off.
pub fn header(o: &ScenarioOptions) -> Vec<u8> {
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
         \tnum_empire_default = {max}\n\
         \tfallen_empire_default = 0\n\
         \tfallen_empire_max = 0\n\
         \tmarauder_empire_default = 0\n\
         \tmarauder_empire_max = 0\n\
         \tnomad_empire_default = 0\n\
         \tnomad_empire_max = 0\n\
         \tadvanced_empire_default = 0\n\
         \tcolonizable_planet_odds = 1.0\n\
         \tprimitive_odds = 1.0\n\
         \tnum_wormhole_pairs = {{ min = 0 max = 0 }}\n\
         \tnum_wormhole_pairs_default = 0\n\
         \tnum_gateways = {{ min = 0 max = 0 }}\n\
         \tnum_gateways_default = 0\n\
         \tnum_hyperlanes_default = 0\n\
         \trandom_hyperlanes = no\n\
         \tcore_radius = {}\n\
         \tcrisis_strength = 0.75\n\
         \textra_crisis_strength = {{ 5 10 25 }}\n\
         \n",
        o.name,
        coord(o.core_radius)
    )
    .into_bytes()
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

    #[test]
    fn header_and_footer_wrap_a_body() {
        let text = header(&ScenarioOptions {
            name: "sgf_test".into(),
            core_radius: 30.0,
            num_empires: (1, 4),
            exported_from: None,
        });
        let text = String::from_utf8(text).unwrap();
        assert!(text.starts_with("static_galaxy_scenario = {\n\tname = \"sgf_test\"\n"));
        assert!(
            text.contains(
                "\tpriority = 5\n\tsupports_shape = elliptical\n\tsupports_shape = ring\n"
            )
        );
        assert!(text.contains("\tsupports_shape = spoked\n\tdefault = no\n"));
        assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
        assert!(text.contains("\tnum_empires = { min = 1 max = 4 }\n\tnum_empire_default = 4\n"));
        assert!(text.contains("\tcore_radius = 30\n"));
        assert!(text.ends_with("}\n\n"));
    }
}
