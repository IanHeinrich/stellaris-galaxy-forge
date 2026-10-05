//! The clap surface: `Cli`, `Command` and every subcommand's arguments.

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand, ValueEnum};
use sgf_core::prepare::{PrepareChoice, PrepareRow, RowChoice};
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
    #[arg(long = "install", id = "install")]
    pub path: Option<PathBuf>,
    /// Read vanilla only, ignoring the enabled mods.
    #[arg(long)]
    pub no_mods: bool,
}

impl InstallArg {
    pub fn options(&self) -> LoadOptions {
        LoadOptions {
            install: self.path.clone(),
            mods: !self.no_mods,
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
    /// Print a system's planets, deposits, starbase and fleet presence, and exit 1 if it is
    /// unknown. Without an id, print one line per system that has anything to show.
    Details { sav: PathBuf, id: Option<u32> },
    /// Write the save's galaxy as a static galaxy scenario script; the save is untouched.
    ExportScenario {
        sav: PathBuf,
        out: PathBuf,
        /// The scenario's `name`; the output file's stem by default.
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
    /// Print every key path of a save with its count, or the paths it adds to and drops
    /// from another save.
    Shape {
        sav: PathBuf,
        /// Compare with this save: the paths only `sav` has are added, the ones only
        /// this save has are removed.
        #[arg(long, value_name = "OTHER")]
        diff: Option<PathBuf>,
        /// Only these top-level sections, comma-separated.
        #[arg(long, value_delimiter = ',')]
        section: Vec<String>,
    },
    /// Load a save and write it out unchanged.
    Roundtrip {
        input: PathBuf,
        output: PathBuf,
        /// Re-read the output and assert gamestate and meta are byte-identical to the input.
        #[arg(long)]
        check: bool,
    },
    /// Apply the edits that files hold to a save or scenario, in the order given, then save.
    ///
    /// Each file holds one op as JSON, such as {"type":"MoveSystem","system":0,"x":-150,"y":60},
    /// or a {"type":"Batch","description":"...","ops":[...]} of several that apply as one. A
    /// refused op names its file and writes nothing.
    #[command(verbatim_doc_comment)]
    Apply {
        sav: PathBuf,
        #[arg(required = true, value_name = "EDIT")]
        edits: Vec<PathBuf>,
        #[command(flatten)]
        out: OutArg,
    },
    /// Add a nebula to a save or scenario.
    Nebula {
        #[command(subcommand)]
        command: NebulaCommand,
    },
    /// Change a save planet's class, such as to `pc_ocean`, with the rules the install gives
    /// each class.
    PlanetClass {
        sav: PathBuf,
        planet: u32,
        /// The new class, as `common/planet_classes` names it.
        class: String,
        #[command(flatten)]
        install: InstallArg,
        #[command(flatten)]
        out: OutArg,
    },
    /// Roll a star system from the install's rules and add it to a Stellaris 4.x save:
    ///   sgf add-system game.sav --seed 7 --at -310,-95 --lane 169 -o out.sav
    /// --star-class sc_g rolls it around that star, or --layout trappist_initializer builds
    /// that layout (`sgf special-layouts` lists the special ones). --then-reroll 8 rolls it
    /// again from seed 8, keeping its name, position and lanes. --print-spec prints the
    /// system as JSON, which an `AddSystemFromSpec` edit file for `sgf apply` holds as its
    /// `spec`.
    #[command(verbatim_doc_comment)]
    AddSystem {
        sav: PathBuf,
        /// Remove this system again before saving if this command added it, as the app
        /// deletes a system added in the same session; the systems added after it take the
        /// ids below. Repeat for more; the file's own systems among them are left alone.
        #[arg(long, value_name = "ID")]
        then_remove: Vec<u32>,
        /// What the system is rolled from; the same seed gives the same system.
        #[arg(long)]
        seed: u64,
        /// Where the system stands, as `X,Y`.
        #[arg(long, value_parser = point, allow_hyphen_values = true)]
        at: (f64, f64),
        /// A system the new one is joined to by a hyperlane; repeatable.
        #[arg(long = "lane")]
        lanes: Vec<u32>,
        /// The system's name; one left in the save's pool of star names otherwise, or one of
        /// the install's star names no system of the save holds.
        #[arg(long)]
        name: Option<String>,
        /// The system's star class (`sc_g`), drawn among the layouts that make it.
        #[arg(long, conflicts_with = "layout")]
        star_class: Option<String>,
        /// The initializer to build the system from, plain or special.
        #[arg(long)]
        layout: Option<String>,
        /// Print the spec as JSON and write nothing, so it takes no --then-remove or
        /// --then-reroll.
        #[arg(long, conflicts_with_all = ["then_remove", "then_reroll"])]
        print_spec: bool,
        /// Roll the system again from this seed before saving, around --star-class when
        /// given, keeping its name, position and lanes.
        #[arg(long, value_name = "SEED")]
        then_reroll: Option<u64>,
        /// On --then-reroll, build a system of a Special menu layout from that layout again.
        #[arg(long, requires = "then_reroll")]
        keep_special: bool,
        #[command(flatten)]
        install: InstallArg,
        #[command(flatten)]
        out: OutArg,
    },
    /// Roll a planet, or a moon of --moon-of, from the install's rules and add it to a system
    /// of a Stellaris 4.x save, --radius from what it orbits at --angle degrees. Its deposits
    /// are drawn, and so are the --class and --size left out:
    ///   sgf add-body game.sav 408 --moon-of 138 --radius 15 --angle 90 --seed 7
    #[command(verbatim_doc_comment)]
    AddBody {
        sav: PathBuf,
        system: u32,
        /// A planet class (`pc_desert`); drawn at the body's orbit when not given.
        #[arg(long)]
        class: Option<String>,
        /// Drawn from the class's range when not given.
        #[arg(long)]
        size: Option<u32>,
        /// The planet a new moon orbits.
        #[arg(long)]
        moon_of: Option<u32>,
        #[arg(long)]
        radius: f64,
        #[arg(long, allow_negative_numbers = true)]
        angle: f64,
        /// A name written as typed; the next free numeral or letter otherwise.
        #[arg(long)]
        name: Option<String>,
        /// What the body is rolled from; the same seed gives the same body.
        #[arg(long)]
        seed: u64,
        #[command(flatten)]
        install: InstallArg,
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
        /// Instead of the summary, list what the install and mods define that the editor
        /// cannot show: planet classes with no name, disc or size, star classes with no map
        /// icon or with other than one star body, and the diagnostics by kind.
        #[arg(long)]
        report: bool,
        /// Rows --report prints per list, 20 unless given; 0 prints them all.
        #[arg(long, requires = "report")]
        limit: Option<usize>,
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
    /// Prepare a scenario for a new game: sort its systems into rows from the install's
    /// initializers, then write a preset's choices as one edit and save:
    ///   sgf prepare map.txt --preset fresh --row system_names=game_names -o new.txt
    /// --row sets one row's choice over the preset's; repeat it for more rows.
    #[command(verbatim_doc_comment)]
    Prepare {
        scenario: PathBuf,
        #[arg(long, value_enum)]
        preset: Preset,
        /// One row's choice, as `<row>=<choice>`; repeatable.
        #[arg(long = "row", value_parser = row_choice, value_name = "ROW=CHOICE")]
        rows: Vec<RowChoice>,
        /// What every draw takes: the layouts Plain system picks on a plain scenario, and
        /// the new seats and zones; the same seed gives the same edit.
        #[arg(long, default_value_t = 0)]
        seed: u64,
        /// Let the game roll the systems within two jumps of a seat too, instead of
        /// giving them Plain system.
        #[arg(long)]
        roll_around_seats: bool,
        #[command(flatten)]
        install: InstallArg,
        #[command(flatten)]
        out: OutArg,
    },
    /// List the special layouts a system can be generated from, with how many systems of
    /// the save already have each.
    SpecialLayouts {
        sav: PathBuf,
        #[command(flatten)]
        install: InstallArg,
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
        /// The name key the statement carries; one from the save's pool or the install's
        /// nebula names otherwise, as the app names a new nebula.
        #[arg(long)]
        name: Option<String>,
        #[command(flatten)]
        install: InstallArg,
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

/// The preset `sgf prepare` starts from.
#[derive(Clone, Copy, ValueEnum)]
pub enum Preset {
    Faithful,
    Fresh,
    Shell,
}

/// `system_names=game_names`, one `--row` of `sgf prepare`.
fn row_choice(text: &str) -> Result<RowChoice, String> {
    let (row, choice) = text
        .split_once('=')
        .ok_or_else(|| format!("{text} is not ROW=CHOICE"))?;
    let rows = PrepareRow::ALL.map(PrepareRow::as_str).join(", ");
    let choices = PrepareChoice::ALL.map(PrepareChoice::as_str).join(", ");
    Ok(RowChoice {
        row: PrepareRow::parse(row).ok_or_else(|| format!("{row} is none of {rows}"))?,
        choice: PrepareChoice::parse(choice)
            .ok_or_else(|| format!("{choice} is none of {choices}"))?,
    })
}

/// `X,Y`, the `--at` of a generated system.
fn point(text: &str) -> Result<(f64, f64), String> {
    let (x, y) = text
        .split_once(',')
        .ok_or_else(|| format!("{text} is not X,Y"))?;
    let coordinate = |part: &str| {
        part.trim()
            .parse::<f64>()
            .map_err(|_| format!("{part} is not a number"))
    };
    Ok((coordinate(x)?, coordinate(y)?))
}
