//! Paint a Galaxy's dialect of a scenario: the one place that knows its names.
//!
//! Paint a Galaxy marks a spawn system with `spawn_weight = { base = 0 add =
//! value:painted_galaxy_spawn_weight|PARAMS| }`, a script value its companion mod
//! resolves to a weight from the `|KEY|value|` pairs. Reading turns the pairs into a
//! [`SpawnScript`]; writing turns one back into the exact text the app emits, so a file
//! it painted and one this editor edited read the same to the mod.
//!
//! A wormhole pair is `set_star_flag = painted_galaxy_wormhole_<n>` on both of its
//! ends, with `empire_cluster` beside it to keep empires off them; the mod joins the
//! two systems carrying one number at game start.

use std::collections::BTreeMap;

use memchr::memmem;

use crate::cst::Node;
use crate::keys::scenario as keys;
use crate::ops::OpError;
use crate::projections::galaxy::{BypassLink, Galaxy, PaintSpawnKind, SpawnScript};

/// What every spawn script, star flag and initializer of the mod's dialect starts with.
const PREFIX: &str = "painted_galaxy_";
/// The phrase in the header comment Forge writes on a profile export.
pub(crate) const HEADER_NOTE: &str = "for the Paint a Galaxy mod";
const SPAWN_WEIGHT_VALUE: &str = "painted_galaxy_spawn_weight";
const PREFERRED: &str = "PREFERRED";
const RESERVED: &str = "RESERVED";
const SOL: &str = "SOL";
const RANDOM_MODULO: &str = "RANDOM_MODULO";
const RANDOM_VALUE: &str = "RANDOM_VALUE";
const YES: &str = "yes";

/// The mod's random-list initializer for an empty system near a spawn.
pub(crate) const RL_BASIC: &str = "painted_galaxy_rl_basic";
/// The star flag a system given [`RL_BASIC`] carries, so the mod knows it chose it.
pub(crate) const AUTOMATIC_INITIALIZER_FLAG: &str = "painted_galaxy_automatic_initializer";
/// The star flag both ends of the n-th wormhole pair carry, `n` appended.
pub(crate) const WORMHOLE_FLAG_PREFIX: &str = "painted_galaxy_wormhole_";
/// The star flag beside it that keeps an empire from spawning on the pair.
pub(crate) const EMPIRE_CLUSTER: &str = "empire_cluster";
/// The game's own initializer for Sol, the one a Sol seat is meant to stand on.
pub const SOL_INITIALIZER: &str = "sol_system_initializer";

/// The starting initializers the mod's minimum asks of a spawn system, one per residue.
const BASIC_INITIALIZERS: [&str; 6] = [
    "random_empire_init_01",
    "random_empire_init_02",
    "random_empire_init_03",
    "random_empire_init_04",
    "random_empire_init_05",
    "random_empire_init_06",
];

/// The pair number of the first `painted_galaxy_wormhole_<n>` among `flags`.
pub fn wormhole_pair<'a>(flags: impl Iterator<Item = &'a str>) -> Option<u32> {
    flags.filter_map(wormhole_pair_of).next()
}

/// The pair number a star flag names, `None` for any other flag.
pub fn wormhole_pair_of(flag: &str) -> Option<u32> {
    flag.strip_prefix(WORMHOLE_FLAG_PREFIX)?.parse().ok()
}

/// Whether a star flag names a wormhole pair.
pub fn is_wormhole_flag(flag: &str) -> bool {
    flag.starts_with(WORMHOLE_FLAG_PREFIX)
}

/// Every pair whose number stands on exactly two systems, as the links the map draws,
/// lower id first and ascending by number. A number on one system or on three is no
/// pair the mod can join.
pub fn wormhole_pairs(galaxy: &Galaxy) -> Vec<BypassLink> {
    let mut ends: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    for system in galaxy.systems.values() {
        if let Some(pair) = system.wormhole_pair {
            ends.entry(pair).or_default().push(system.id);
        }
    }
    ends.into_values()
        .filter_map(|mut ids| {
            ids.sort_unstable();
            match ids[..] {
                [a, b] => Some(BypassLink::Wormhole { a, b }),
                _ => None,
            }
        })
        .collect()
}

/// The number the next wormhole pair takes: one past the highest in use, 1 on a map
/// with none.
pub fn next_wormhole_pair(galaxy: &Galaxy) -> u32 {
    galaxy
        .systems
        .values()
        .filter_map(|system| system.wormhole_pair)
        .max()
        .map_or(1, |highest| highest.saturating_add(1))
}

/// Whether `bytes` carry the mod's dialect anywhere, or Forge's header for the mod.
pub fn is_painted(bytes: &[u8]) -> bool {
    memmem::find(bytes, PREFIX.as_bytes()).is_some()
        || memmem::find(bytes, HEADER_NOTE.as_bytes()).is_some()
}

/// What the `spawn_weight` block says, when its `add` is the Paint a Galaxy value. The
/// value's name is what makes it the dialect; a parameter this editor does not know is
/// passed over, so a key a later Paint a Galaxy adds still reads as a seat.
pub(crate) fn recognise(weight: &Node, src: &[u8]) -> Option<SpawnScript> {
    let add = weight.find(keys::ADD, src)?.scalar_str(src)?;
    let params = add
        .strip_prefix(keys::VALUE_PREFIX)?
        .strip_prefix(SPAWN_WEIGHT_VALUE)?
        .strip_prefix('|')?;
    let params = params.strip_suffix('|').unwrap_or(params);
    let mut kind = PaintSpawnKind::Enabled;
    let mut random_value = 0;
    if params.is_empty() {
        return Some(SpawnScript::PaintAGalaxy { kind, random_value });
    }
    let parts: Vec<&str> = params.split('|').collect();
    for pair in parts.as_chunks::<2>().0 {
        match (pair[0], pair[1]) {
            (PREFERRED, YES) => kind = kind.at_least(PaintSpawnKind::Preferred),
            (RESERVED, letter) => kind = kind.at_least(PaintSpawnKind::Reserved(letter.to_owned())),
            (SOL, YES) => kind = kind.at_least(PaintSpawnKind::Sol),
            (RANDOM_VALUE, n) => random_value = n.parse().ok()?,
            _ => {}
        }
    }
    Some(SpawnScript::PaintAGalaxy { kind, random_value })
}

impl PaintSpawnKind {
    /// The kind that wins when a file names two: a reservation over a preference, Sol
    /// over both.
    fn at_least(self, other: Self) -> Self {
        let rank = |kind: &Self| match kind {
            Self::Enabled => 0,
            Self::Preferred => 1,
            Self::Reserved(_) => 2,
            Self::Sol => 3,
        };
        if rank(&other) > rank(&self) {
            other
        } else {
            self
        }
    }
}

/// The `add` value for a script, exactly as Paint a Galaxy writes it.
pub(crate) fn render(script: &SpawnScript) -> String {
    let SpawnScript::PaintAGalaxy { kind, random_value } = script;
    let params = match kind {
        PaintSpawnKind::Enabled => {
            format!("{RANDOM_MODULO}|10|{RANDOM_VALUE}|{random_value}")
        }
        PaintSpawnKind::Preferred => {
            format!("{PREFERRED}|{YES}|{RANDOM_MODULO}|10|{RANDOM_VALUE}|{random_value}")
        }
        PaintSpawnKind::Reserved(letter) => format!(
            "{RESERVED}|{letter}|{RANDOM_MODULO}|3|{RANDOM_VALUE}|{}",
            random_value % 3
        ),
        PaintSpawnKind::Sol => format!("{SOL}|{YES}|{RANDOM_MODULO}|1|{RANDOM_VALUE}|0"),
    };
    format!("{}{SPAWN_WEIGHT_VALUE}|{params}|", keys::VALUE_PREFIX)
}

/// The whole `spawn_weight` statement a scripted system carries, on one line.
pub(crate) fn weight_statement(script: &SpawnScript) -> String {
    format!(
        "{} = {{ {} = 0 {} = {} }}",
        keys::SPAWN_WEIGHT,
        keys::BASE,
        keys::ADD,
        render(script)
    )
}

/// The starting initializer a spawn system is given when it names none, spread over
/// the six the game ships by the system's id.
pub(crate) fn basic_initializer(id: u32) -> &'static str {
    BASIC_INITIALIZERS[(id % 6) as usize]
}

/// Whether a script is one Paint a Galaxy can read back: a reserved seat is named by
/// one lowercase ASCII letter, as its flags are.
pub(crate) fn check(script: &SpawnScript) -> Result<(), OpError> {
    let SpawnScript::PaintAGalaxy { kind, .. } = script;
    if let PaintSpawnKind::Reserved(letter) = kind
        && !valid_letter(letter)
    {
        return Err(OpError::InvalidSeatLetter(letter.clone()));
    }
    Ok(())
}

fn valid_letter(letter: &str) -> bool {
    let mut chars = letter.chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if c.is_ascii_lowercase())
}

/// What to call the change [`Op::SetSpawnScript`] makes to system `id`.
///
/// [`Op::SetSpawnScript`]: crate::ops::Op::SetSpawnScript
pub(crate) fn description(id: u32, script: Option<&SpawnScript>) -> String {
    match script {
        Some(SpawnScript::PaintAGalaxy { kind, .. }) => {
            format!("Made system {id} a Paint a Galaxy spawn ({})", label(kind))
        }
        None => format!("Cleared system {id}'s Paint a Galaxy spawn"),
    }
}

fn label(kind: &PaintSpawnKind) -> String {
    match kind {
        PaintSpawnKind::Enabled => "enabled".to_owned(),
        PaintSpawnKind::Preferred => "preferred".to_owned(),
        PaintSpawnKind::Reserved(letter) => format!("reserved {letter}"),
        PaintSpawnKind::Sol => "Sol".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cst::parse_script;

    fn recognised(add: &str) -> Option<SpawnScript> {
        let text = format!("spawn_weight = {{ base = 0 add = {add} }}");
        let root = parse_script(text.as_bytes(), 0).expect("parse");
        recognise(&root.children()[0], text.as_bytes())
    }

    fn script(kind: PaintSpawnKind, random_value: u8) -> SpawnScript {
        SpawnScript::PaintAGalaxy { kind, random_value }
    }

    #[test]
    fn every_kind_renders_as_paint_a_galaxy_writes_it_and_reads_back() {
        for (script, params) in [
            (
                script(PaintSpawnKind::Enabled, 7),
                "RANDOM_MODULO|10|RANDOM_VALUE|7",
            ),
            (
                script(PaintSpawnKind::Preferred, 4),
                "PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|4",
            ),
            (
                script(PaintSpawnKind::Reserved("b".to_owned()), 2),
                "RESERVED|b|RANDOM_MODULO|3|RANDOM_VALUE|2",
            ),
            (
                script(PaintSpawnKind::Sol, 0),
                "SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0",
            ),
        ] {
            let add = format!("value:painted_galaxy_spawn_weight|{params}|");
            assert_eq!(render(&script), add);
            assert_eq!(recognised(&add), Some(script));
        }
    }

    #[test]
    fn a_reserved_seat_folds_its_random_value_and_sol_writes_none() {
        assert_eq!(
            render(&script(PaintSpawnKind::Reserved("a".to_owned()), 8)),
            "value:painted_galaxy_spawn_weight|RESERVED|a|RANDOM_MODULO|3|RANDOM_VALUE|2|"
        );
        assert_eq!(
            render(&script(PaintSpawnKind::Sol, 9)),
            "value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0|"
        );
        assert_eq!(
            weight_statement(&script(PaintSpawnKind::Enabled, 3)),
            "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|3| }"
        );
    }

    #[test]
    fn the_value_alone_is_an_enabled_seat_and_other_text_is_not_a_script() {
        assert_eq!(
            recognised("value:painted_galaxy_spawn_weight|"),
            Some(script(PaintSpawnKind::Enabled, 0))
        );
        assert_eq!(
            recognised("value:painted_galaxy_spawn_weight|PREFERRED|no|"),
            Some(script(PaintSpawnKind::Enabled, 0))
        );
        for add in [
            "10",
            "value:some_other_value|RANDOM_VALUE|1|",
            "value:painted_galaxy_spawn_weight",
            "value:painted_galaxy_spawn_weight|RANDOM_VALUE|many|",
            "value:painted_galaxy_spawn_weight|RANDOM_VALUE|300|",
        ] {
            assert_eq!(recognised(add), None, "{add}");
        }
        let root = parse_script(b"spawn_weight = { base = 1 }", 0).expect("parse");
        assert_eq!(
            recognise(&root.children()[0], b"spawn_weight = { base = 1 }"),
            None
        );
    }

    #[test]
    fn a_parameter_this_editor_does_not_know_is_passed_over() {
        assert_eq!(
            recognised("value:painted_galaxy_spawn_weight|NEW_KEY|1|PREFERRED|yes|RANDOM_VALUE|5|"),
            Some(script(PaintSpawnKind::Preferred, 5))
        );
        assert_eq!(
            recognised("value:painted_galaxy_spawn_weight|RANDOM_VALUE|"),
            Some(script(PaintSpawnKind::Enabled, 0))
        );
    }

    #[test]
    fn the_basic_initializers_cycle_by_id_and_a_seat_is_one_lowercase_letter() {
        assert_eq!(basic_initializer(0), "random_empire_init_01");
        assert_eq!(basic_initializer(5), "random_empire_init_06");
        assert_eq!(basic_initializer(6), "random_empire_init_01");
        assert_eq!(basic_initializer(10), "random_empire_init_05");
        let reserved = |letter: &str| script(PaintSpawnKind::Reserved(letter.to_owned()), 0);
        assert!(check(&reserved("a")).is_ok());
        assert!(check(&script(PaintSpawnKind::Sol, 0)).is_ok());
        for letter in ["", "Z", "ab", "1", "|", " ", "é"] {
            assert!(
                matches!(check(&reserved(letter)), Err(OpError::InvalidSeatLetter(_))),
                "{letter:?}"
            );
        }
    }
}
