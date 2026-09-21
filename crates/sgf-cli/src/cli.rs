//! The clap surface: `Cli`, `Command` and every subcommand's arguments.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use sgf_gamedata::LoadOptions;

#[derive(Parser)]
#[command(name = "sgf", version = sgf_core::VERSION, about = "Stellaris Galaxy Forge")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

/// Where an editing command writes; in place, backing up the original, when absent.
#[derive(Args)]
pub struct OutArg {
    /// Write here instead of in place (in place backs up the original).
    #[arg(short = 'o', long = "out")]
    pub path: Option<PathBuf>,
}

/// Which Stellaris install the command reads its definitions from.
#[derive(Args)]
pub struct InstallArg {
    /// Game root, instead of searching the Steam libraries.
    #[arg(long = "install")]
    pub path: Option<PathBuf>,
}

impl InstallArg {
    pub fn options(&self) -> LoadOptions {
        LoadOptions {
            install: self.path.clone(),
            ..LoadOptions::default()
        }
    }
}

/// `3,7,9` as the system ids of one waystation network.
fn waystation_network(text: &str) -> Result<Vec<u32>, String> {
    text.split(',')
        .map(|id| {
            id.trim()
                .parse()
                .map_err(|_| format!("{id:?} is not a system id"))
        })
        .collect()
}

#[derive(Subcommand)]
pub enum Command {
    /// Print the save header, section sizes and entity counts.
    Inspect {
        sav: PathBuf,
        /// Also summarise the galaxy: systems, lanes, components, nebulae, bypasses.
        #[arg(long)]
        galaxy: bool,
    },
    /// Check a save or scenario and print every issue; exits 1 if any is an error.
    Validate { doc: PathBuf },
    /// Print a system's planets, deposits, starbase and fleet presence; exits 1 if unknown.
    Details {
        sav: PathBuf,
        #[arg(required_unless_present = "all", conflicts_with = "all")]
        id: Option<u32>,
        /// One line per system that has anything to show.
        #[arg(long)]
        all: bool,
    },
    /// Write the save's galaxy as a static galaxy scenario script; the save is untouched.
    ExportScenario {
        sav: PathBuf,
        out: PathBuf,
        /// The scenario's `name`; the save file's stem by default.
        #[arg(long)]
        name: Option<String>,
        #[command(flatten)]
        install: InstallArg,
        /// Localise system names from the install instead of writing the save's own keys.
        #[arg(long)]
        gamedata: bool,
        /// Whose conventions the scenario follows; `paint-a-galaxy` needs that mod.
        #[arg(long, value_enum, default_value_t = Profile::Plain)]
        profile: Profile,
    },
    /// Write an empty static galaxy scenario script to start from.
    NewScenario {
        name: String,
        out: PathBuf,
        /// The galactic core's radius, written as `core_radius`.
        #[arg(long, default_value_t = 0.0)]
        core_radius: f64,
        /// Whose conventions the scenario follows; `paint-a-galaxy` needs that mod.
        #[arg(long, value_enum, default_value_t = Profile::Plain)]
        profile: Profile,
    },
    /// Load a save and write it out unchanged.
    Roundtrip {
        input: PathBuf,
        output: PathBuf,
        /// Re-read the output and assert gamestate and meta are byte-identical to the input.
        #[arg(long)]
        check: bool,
    },
    /// Move a system to (x, y), updating the length of every lane on both ends.
    Move {
        sav: PathBuf,
        id: u32,
        #[arg(allow_negative_numbers = true)]
        x: f64,
        #[arg(allow_negative_numbers = true)]
        y: f64,
        #[command(flatten)]
        out: OutArg,
    },
    /// Move a nebula (by its index in file order) to (x, y) together with every member
    /// system, updating lane lengths.
    MoveNebula {
        sav: PathBuf,
        index: usize,
        #[arg(allow_negative_numbers = true)]
        x: f64,
        #[arg(allow_negative_numbers = true)]
        y: f64,
        #[command(flatten)]
        out: OutArg,
    },
    /// Add, remove, resize or rename a nebula.
    Nebula {
        #[command(subcommand)]
        command: NebulaCommand,
    },
    /// Set or clear one key of a static galaxy scenario's header.
    Header {
        #[command(subcommand)]
        command: HeaderCommand,
    },
    /// Add, remove or re-measure a hyperlane between two systems.
    Lane {
        #[command(subcommand)]
        command: LaneCommand,
    },
    /// Set a scenario system's spawn weight, or hold it for a human player or the AI.
    Spawn {
        #[command(subcommand)]
        command: SpawnCommand,
    },
    /// Remove every hyperlane of a system.
    Isolate {
        sav: PathBuf,
        id: u32,
        #[command(flatten)]
        out: OutArg,
    },
    /// Write a synthetic Stellaris-shaped save with N systems, for stress-testing.
    Synth {
        #[arg(long)]
        systems: u32,
        #[arg(long, default_value_t = 1)]
        seed: u64,
        /// One waystation network, as system ids (`--waystations 3,7,9`); repeatable.
        #[arg(long, value_parser = waystation_network)]
        waystations: Vec<Vec<u32>>,
        #[arg(short, long)]
        out: PathBuf,
    },
    /// Find the Stellaris install and active mods; summarise what was read from them.
    Gamedata {
        #[command(flatten)]
        install: InstallArg,
        /// Localisation language folder.
        #[arg(long, default_value = "english")]
        lang: String,
        /// Read vanilla only, ignoring the enabled mods.
        #[arg(long)]
        no_mods: bool,
    },
    /// List the special systems of a save (leviathans, enclaves, landmarks …).
    Special {
        sav: PathBuf,
        #[command(flatten)]
        install: InstallArg,
        /// Classify from the save's flags alone, without reading the install.
        #[arg(long)]
        no_gamedata: bool,
    },
    /// Decode a game texture by key (`star_class:g_star`, `flag:human/flag_human_9.dds`,
    /// `empire_flag:<bg>:<category>/<file>:<c0>,<c1>,<c2>,<c3>`) to a PNG.
    Texture {
        key: String,
        #[arg(short, long)]
        out: PathBuf,
        #[command(flatten)]
        install: InstallArg,
    },
}

#[derive(Subcommand)]
pub enum NebulaCommand {
    /// Add a nebula centred on (x, y); every system it reaches joins it.
    Add {
        sav: PathBuf,
        #[arg(allow_negative_numbers = true)]
        x: f64,
        #[arg(allow_negative_numbers = true)]
        y: f64,
        #[arg(allow_negative_numbers = true)]
        radius: f64,
        /// The name key the statement carries.
        #[arg(long)]
        name: Option<String>,
        #[command(flatten)]
        out: OutArg,
    },
    /// Remove the nebula at `index` in file order; the ones after it renumber.
    Remove {
        sav: PathBuf,
        index: usize,
        #[command(flatten)]
        out: OutArg,
    },
    /// Set the radius of the nebula at `index` in file order, about its fixed centre.
    Radius {
        sav: PathBuf,
        index: usize,
        #[arg(allow_negative_numbers = true)]
        radius: f64,
        #[command(flatten)]
        out: OutArg,
    },
    /// Rename the nebula at `index` in file order.
    Name {
        sav: PathBuf,
        index: usize,
        name: String,
        #[command(flatten)]
        out: OutArg,
    },
}

#[derive(Subcommand)]
pub enum HeaderCommand {
    /// Write `value` as the raw text right of `=`, inserting the key when the header
    /// lacks it; a block such as `{ min = 1 max = 2 }` is written as it stands.
    Set {
        sav: PathBuf,
        key: String,
        #[arg(allow_negative_numbers = true)]
        value: String,
        #[command(flatten)]
        out: OutArg,
    },
    /// Remove the header's first statement of `key`.
    Unset {
        sav: PathBuf,
        key: String,
        #[command(flatten)]
        out: OutArg,
    },
}

#[derive(Subcommand)]
pub enum SpawnCommand {
    /// Write `spawn_weight = { base = N }`, or remove the base with `none`.
    Weight {
        sav: PathBuf,
        id: u32,
        /// The weight the generator places an empire by, or `none` to clear it.
        base: String,
        #[command(flatten)]
        out: OutArg,
    },
}

/// Whose conventions `sgf export-scenario` and `sgf new-scenario` write in.
#[derive(Clone, Copy, ValueEnum)]
pub enum Profile {
    Plain,
    PaintAGalaxy,
}

#[derive(Subcommand)]
pub enum LaneCommand {
    /// Add a lane whose length is the floor of the distance, as the generator writes it.
    Add {
        sav: PathBuf,
        a: u32,
        b: u32,
        /// Mark the lane `bridge=yes` on both ends.
        #[arg(long)]
        bridge: bool,
        #[command(flatten)]
        out: OutArg,
    },
    /// Remove every entry of the lane on both ends.
    Remove {
        sav: PathBuf,
        a: u32,
        b: u32,
        #[command(flatten)]
        out: OutArg,
    },
    /// Bar the generator from linking two systems: one `prevent_hyperlane` statement.
    Prevent {
        sav: PathBuf,
        a: u32,
        b: u32,
        #[command(flatten)]
        out: OutArg,
    },
    /// Remove every `prevent_hyperlane` statement naming the two systems.
    Allow {
        sav: PathBuf,
        a: u32,
        b: u32,
        #[command(flatten)]
        out: OutArg,
    },
    /// Rewrite the lane's `length` on both ends to the floor of the distance it spans.
    Normalise {
        sav: PathBuf,
        a: u32,
        b: u32,
        #[command(flatten)]
        out: OutArg,
    },
    /// Set the lane's `length` on both ends.
    Length {
        sav: PathBuf,
        a: u32,
        b: u32,
        #[arg(allow_negative_numbers = true)]
        length: f64,
        #[command(flatten)]
        out: OutArg,
    },
}
