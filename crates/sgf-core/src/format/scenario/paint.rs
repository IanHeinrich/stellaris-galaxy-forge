//! Paint a Galaxy's dialect of a scenario: the one place that knows its names.
//!
//! Paint a Galaxy marks a spawn system with `spawn_weight = { base = 0 add =
//! value:painted_galaxy_spawn_weight|PARAMS| }`, a script value its companion mod
//! resolves to a weight from the `|KEY|value|` pairs. Reading turns the pairs into a
//! [`SpawnScript`]; writing turns one back into the exact text the app emits, so a file
//! it painted and one this editor edited read the same to the mod.
//!
//! `spawn_weight` is a weighted draw over the free seats, in placement order, and an
//! empire whose origin needs special placement is seated before the player, so a weight
//! alone never makes a seat certain. A 1st Player seat (`PREFERRED`) is meant for the
//! first player, the host, whose country the mod flags `painted_galaxy_host`; every
//! other empire weighs it at 0 or 10. The player's seat carries a `modifier` beside the
//! value that outweighs every other seat by far, under the condition the mod's own
//! script puts on the kind: the host flag for a 1st Player seat, the United Nations of
//! Earth's `human_1` flag for the Sol seat, the submod's trait for a reserved seat. The
//! Sol seat and a reserved seat are certain, because every other empire weighs them at
//! zero. A 1st Player seat is all but certain: an empire seated before the player can
//! still draw it. The app's importer keeps the kind and drops the modifier.
//!
//! A wormhole pair is `set_star_flag = painted_galaxy_wormhole_<n>` on both of its
//! ends, with `empire_cluster` beside it to keep empires off them; the mod joins the
//! two systems carrying one number at game start.

use std::collections::BTreeMap;

use memchr::memmem;

use crate::cst::Node;
use crate::format::scenario::unit;
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
/// The `RANDOM_MODULO` of an enabled or a 1st Player seat: the most values any kind is
/// drawn from.
pub(crate) const SEAT_MODULO: u8 = 10;
/// The `RANDOM_MODULO` of a reserved seat.
const RESERVED_MODULO: u8 = 3;
/// The `RANDOM_MODULO` of the Sol seat, which has one value.
const SOL_MODULO: u8 = 1;
/// What the player's seat adds to its weight, against the mod's 100 to 110 for the host
/// on a 1st Player seat and 1000 for a Sol or reserved one.
const PLAYER_SEAT_WEIGHT: u32 = 100000;
/// The country flag the United Nations of Earth carries, which the mod's Sol seat asks for.
pub(crate) const UNE_FLAG: &str = "human_1";
/// The country flag the mod sets on the first player, the host, which its 1st Player
/// seat asks for.
const HOST_FLAG: &str = "painted_galaxy_host";
/// What the Reserved Spawns submod's trait for seat `x` starts with, `x` appended.
const RESERVED_TRAIT_PREFIX: &str = "trait_painted_galaxy_reserved_spawn_";
/// Every name a reserved seat can take, in the order the site lists them: the Latin
/// letters, then the Greek letters spelled out in lower case.
pub const RESERVED_SEAT_NAMES: [&str; 50] = [
    "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s",
    "t", "u", "v", "w", "x", "y", "z", "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta",
    "theta", "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau",
    "upsilon", "phi", "chi", "psi", "omega",
];

/// The mod's random-list initializer for an empty system near a spawn.
pub(crate) const RL_BASIC: &str = "painted_galaxy_rl_basic";
/// What each of the mod's random lists of ordinary starts is named with.
const RANDOM_LIST_PREFIX: &str = "painted_galaxy_rl_";
/// The star flag a system given [`RL_BASIC`] carries, so the mod knows it chose it.
pub(crate) const AUTOMATIC_INITIALIZER_FLAG: &str = "painted_galaxy_automatic_initializer";
/// The star flag both ends of the n-th wormhole pair carry, `n` appended.
pub(crate) const WORMHOLE_FLAG_PREFIX: &str = "painted_galaxy_wormhole_";
/// The star flag beside it that keeps an empire from spawning on the pair.
pub(crate) const EMPIRE_CLUSTER: &str = "empire_cluster";
/// The game's own initializer for Sol, the one a Sol seat is meant to stand on.
pub(crate) const SOL_INITIALIZER: &str = "sol_system_initializer";
/// The mod's Steam Workshop item.
pub const WORKSHOP_ID: &str = "3532904115";

/// The game's random empire starts, which Paint a Galaxy gives a seat: the mod's homeworld
/// fix runs only on a system whose initializer sets `empire_home_system`, before any
/// effect the scenario writes.
pub(crate) const RANDOM_EMPIRE_STARTS: [&str; 6] = [
    "random_empire_init_01",
    "random_empire_init_02",
    "random_empire_init_03",
    "random_empire_init_04",
    "random_empire_init_05",
    "random_empire_init_06",
];

/// The random empire start a seat on system `id` is given when nothing draws one: a draw
/// from the id alone, so neighbouring ids land independently.
pub fn random_empire_start(id: u32) -> &'static str {
    random_empire_start_at(unit(0, id))
}

/// The random empire start `unit`, in `[0, 1)`, falls on, each as likely as the next.
pub(crate) fn random_empire_start_at(unit: f64) -> &'static str {
    let at = (unit * RANDOM_EMPIRE_STARTS.len() as f64) as usize;
    RANDOM_EMPIRE_STARTS[at.min(RANDOM_EMPIRE_STARTS.len() - 1)]
}

/// The pair number of the first `painted_galaxy_wormhole_<n>` among `flags`.
pub fn wormhole_pair<'a>(flags: impl Iterator<Item = &'a str>) -> Option<u32> {
    flags.filter_map(wormhole_pair_of).next()
}

/// The pair number a star flag names, `None` for any other flag.
pub fn wormhole_pair_of(flag: &str) -> Option<u32> {
    flag.strip_prefix(WORMHOLE_FLAG_PREFIX)?.parse().ok()
}

/// Whether `initializer` is one of the mod's random lists, which draw an ordinary start.
pub fn is_random_list(initializer: &str) -> bool {
    initializer.starts_with(RANDOM_LIST_PREFIX)
}

/// Whether a star flag names a wormhole pair.
pub(crate) fn is_wormhole_flag(flag: &str) -> bool {
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

/// Whether `bytes` carry the mod's dialect anywhere, or Forge's header for the mod.
pub fn is_painted(bytes: &[u8]) -> bool {
    has_dialect(bytes) || has_header_note(bytes)
}

/// Whether `bytes` carry the mod's dialect anywhere.
pub(crate) fn has_dialect(bytes: &[u8]) -> bool {
    memmem::find(bytes, PREFIX.as_bytes()).is_some()
}

/// Whether `bytes` carry the header comment Forge writes on a profile export.
pub(crate) fn has_header_note(bytes: &[u8]) -> bool {
    memmem::find(bytes, HEADER_NOTE.as_bytes()).is_some()
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
    let player = player_marker(weight, src, &kind);
    Some(SpawnScript::PaintAGalaxy {
        random_value: random_value % modulo(&kind),
        kind,
        player,
    })
}

/// Whether a `spawn_weight` block carries the player's marker for `kind`: exactly one
/// `modifier`, holding `add = 100000` and the kind's [`condition`] in either order, and
/// nothing else. A 1st Player seat's marker is also read without its condition, as
/// Forge wrote it before Paint a Galaxy flagged the host. Any other modifier content is
/// foreign script, and an enabled seat has no marker.
pub(crate) fn player_marker(weight: &Node, src: &[u8], kind: &PaintSpawnKind) -> bool {
    let modifiers: Vec<&Node> = weight.find_all(keys::MODIFIER, src).collect();
    let [only] = modifiers[..] else {
        return false;
    };
    let Some(condition) = condition(kind) else {
        return false;
    };
    let mut found: Vec<(&str, String)> = only
        .children()
        .iter()
        .filter_map(|child| Some((child.key_str(src)?, child.scalar_str(src)?.to_owned())))
        .collect();
    if found.len() != only.children().len() {
        return false;
    }
    found.sort_unstable();
    let is_marker = |condition: Option<(&str, String)>| {
        let mut expected = vec![(keys::ADD, PLAYER_SEAT_WEIGHT.to_string())];
        expected.extend(condition);
        expected.sort_unstable();
        expected == found
    };
    is_marker(Some(condition)) || (*kind == PaintSpawnKind::Preferred && is_marker(None))
}

/// The trigger the marker carries beside its weight, as the mod's own script conditions
/// the kind, and `None` for an enabled seat, which has no marker.
fn condition(kind: &PaintSpawnKind) -> Option<(&'static str, String)> {
    match kind {
        PaintSpawnKind::Enabled => None,
        PaintSpawnKind::Preferred => Some((keys::HAS_COUNTRY_FLAG, HOST_FLAG.to_owned())),
        PaintSpawnKind::Sol => Some((keys::HAS_COUNTRY_FLAG, UNE_FLAG.to_owned())),
        PaintSpawnKind::Reserved(name) => {
            Some((keys::HAS_TRAIT, format!("{RESERVED_TRAIT_PREFIX}{name}")))
        }
    }
}

impl PaintSpawnKind {
    /// The kind that wins when a file names two: a reservation over a 1st Player seat,
    /// Sol over both.
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
    let SpawnScript::PaintAGalaxy {
        kind, random_value, ..
    } = script;
    let modulo = modulo(kind);
    let random = format!(
        "{RANDOM_MODULO}|{modulo}|{RANDOM_VALUE}|{}",
        random_value % modulo
    );
    let params = match kind {
        PaintSpawnKind::Enabled => random,
        PaintSpawnKind::Preferred => format!("{PREFERRED}|{YES}|{random}"),
        PaintSpawnKind::Reserved(letter) => format!("{RESERVED}|{letter}|{random}"),
        PaintSpawnKind::Sol => format!("{SOL}|{YES}|{random}"),
    };
    format!("{}{SPAWN_WEIGHT_VALUE}|{params}|", keys::VALUE_PREFIX)
}

fn modulo(kind: &PaintSpawnKind) -> u8 {
    match kind {
        PaintSpawnKind::Enabled | PaintSpawnKind::Preferred => SEAT_MODULO,
        PaintSpawnKind::Reserved(_) => RESERVED_MODULO,
        PaintSpawnKind::Sol => SOL_MODULO,
    }
}

/// The whole `spawn_weight` statement a scripted system carries, on one line, the
/// player's marker for its kind after the value.
pub(crate) fn weight_statement(script: &SpawnScript) -> String {
    let SpawnScript::PaintAGalaxy { kind, player, .. } = script;
    let marker = match condition(kind) {
        Some((key, value)) if *player => format!(
            " {} = {{ {} = {PLAYER_SEAT_WEIGHT} {key} = {value} }}",
            keys::MODIFIER,
            keys::ADD
        ),
        _ => String::new(),
    };
    format!(
        "{} = {{ {} = 0 {} = {}{marker} }}",
        keys::SPAWN_WEIGHT,
        keys::BASE,
        keys::ADD,
        render(script)
    )
}

/// Whether a script is one Paint a Galaxy can read back: a reserved seat is named by
/// one of [`RESERVED_SEAT_NAMES`], as its traits are, an enabled seat has no marker to
/// make it the player's, and the random value is one some kind is drawn from. A kind
/// drawn from fewer takes the value modulo its own.
pub(crate) fn check(script: &SpawnScript) -> Result<(), OpError> {
    let SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player,
    } = script;
    if *random_value >= SEAT_MODULO {
        return Err(OpError::RandomValueOutOfRange(*random_value, SEAT_MODULO));
    }
    if let PaintSpawnKind::Reserved(name) = kind
        && !RESERVED_SEAT_NAMES.contains(&name.as_str())
    {
        return Err(OpError::InvalidSeatName(name.clone()));
    }
    if *player && matches!(kind, PaintSpawnKind::Enabled) {
        return Err(OpError::EnabledSeatPlayer);
    }
    Ok(())
}

/// What to call the change [`Op::SetSpawnScript`] makes to `system`, as
/// [`named`](crate::ops::rules::named) calls it.
///
/// [`Op::SetSpawnScript`]: crate::ops::Op::SetSpawnScript
pub(crate) fn description(system: &str, script: Option<&SpawnScript>) -> String {
    match script {
        Some(script) => format!("Made {system} a Paint a Galaxy spawn ({})", label(script)),
        None => format!("Cleared {system}'s Paint a Galaxy spawn"),
    }
}

/// The kind as the descriptions name it: `enabled`, `1st Player`, `reserved b` or `Sol`,
/// with `, the player's seat` after the kind of the player's.
pub(crate) fn label(script: &SpawnScript) -> String {
    let SpawnScript::PaintAGalaxy { kind, player, .. } = script;
    let kind = match kind {
        PaintSpawnKind::Enabled => "enabled".to_owned(),
        PaintSpawnKind::Preferred => "1st Player".to_owned(),
        PaintSpawnKind::Reserved(name) => format!("reserved {name}"),
        PaintSpawnKind::Sol => "Sol".to_owned(),
    };
    if *player {
        format!("{kind}, the player's seat")
    } else {
        kind
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
        SpawnScript::PaintAGalaxy {
            kind,
            random_value,
            player: false,
        }
    }

    fn player(random_value: u8) -> SpawnScript {
        seat(PaintSpawnKind::Preferred, random_value)
    }

    fn seat(kind: PaintSpawnKind, random_value: u8) -> SpawnScript {
        SpawnScript::PaintAGalaxy {
            kind,
            random_value,
            player: true,
        }
    }

    fn read(text: &str) -> Option<SpawnScript> {
        let root = parse_script(text.as_bytes(), 0).expect("parse");
        recognise(&root.children()[0], text.as_bytes())
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
    fn a_hand_written_random_value_reads_modulo_its_kinds() {
        assert_eq!(
            recognised("value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|37|"),
            Some(script(PaintSpawnKind::Enabled, 7))
        );
    }

    #[test]
    fn the_players_seat_is_the_marker_for_the_host_alone_beside_a_first_player_value() {
        let statement = weight_statement(&player(7));
        assert_eq!(
            statement,
            "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 has_country_flag = painted_galaxy_host } }"
        );
        assert_eq!(read(&statement), Some(player(7)));
        assert_eq!(label(&player(7)), "1st Player, the player's seat");
        assert_eq!(label(&script(PaintSpawnKind::Preferred, 7)), "1st Player");
        let value = "add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7|";
        for marker in [
            "modifier = { add = 100000 }",
            "modifier = { has_country_flag = painted_galaxy_host add = 100000 }",
        ] {
            let text = format!("spawn_weight = {{ base = 0 {value} {marker} }}");
            assert_eq!(read(&text), Some(player(7)), "{marker}");
        }
        for foreign in [
            "modifier = { add = 100000 has_country_flag = painted_galaxy_host factor = 1 }",
            "modifier = { add = 1000 has_country_flag = painted_galaxy_host }",
            "modifier = { add = 100000 factor = 1 }",
            "modifier = { add = 100001 }",
            "modifier = { add = 100000.0 }",
            "modifier = { factor = 100000 }",
            "modifier = { add = 100000 } modifier = { add = 100000 }",
            "modifier = { add = 100000 } modifier = { factor = 0 is_ai = yes }",
            "modifier = { }",
            "modifier = { add = 100000 has_country_flag = human_1 }",
            "modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_a }",
        ] {
            let text = format!("spawn_weight = {{ base = 0 {value} {foreign} }}");
            assert_eq!(
                read(&text),
                Some(script(PaintSpawnKind::Preferred, 7)),
                "{foreign}"
            );
        }
    }

    #[test]
    fn the_sol_and_reserved_seats_carry_the_marker_under_their_own_condition() {
        let sol = seat(PaintSpawnKind::Sol, 0);
        let statement = weight_statement(&sol);
        assert_eq!(
            statement,
            "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } }"
        );
        assert_eq!(read(&statement), Some(sol.clone()));
        assert_eq!(label(&sol), "Sol, the player's seat");
        let reserved = seat(PaintSpawnKind::Reserved("b".to_owned()), 1);
        let statement = weight_statement(&reserved);
        assert_eq!(
            statement,
            "spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|RESERVED|b|RANDOM_MODULO|3|RANDOM_VALUE|1| modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_b } }"
        );
        assert_eq!(read(&statement), Some(reserved.clone()));
        assert_eq!(label(&reserved), "reserved b, the player's seat");

        // The two statements of the marker are read in either order.
        let sol_value =
            "add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0|";
        let swapped = format!(
            "spawn_weight = {{ base = 0 {sol_value} modifier = {{ has_country_flag = human_1 add = 100000 }} }}"
        );
        assert_eq!(read(&swapped), Some(sol));
        let reserved_value =
            "add = value:painted_galaxy_spawn_weight|RESERVED|b|RANDOM_MODULO|3|RANDOM_VALUE|1|";
        let swapped = format!(
            "spawn_weight = {{ base = 0 {reserved_value} modifier = {{ has_trait = trait_painted_galaxy_reserved_spawn_b add = 100000 }} }}"
        );
        assert_eq!(read(&swapped), Some(reserved));

        // A marker of another kind's shape is foreign script.
        for foreign in [
            "modifier = { add = 100000 }",
            "modifier = { add = 100000 has_country_flag = painted_galaxy_host }",
            "modifier = { add = 100000 has_country_flag = human_2 }",
            "modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_sol }",
            "modifier = { add = 100000 has_country_flag = human_1 factor = 1 }",
            "modifier = { add = 1000 has_country_flag = human_1 }",
            "modifier = { has_country_flag = human_1 }",
            "modifier = { add = 100000 or = { has_country_flag = human_1 } }",
        ] {
            let text = format!("spawn_weight = {{ base = 0 {sol_value} {foreign} }}");
            assert_eq!(
                read(&text),
                Some(script(PaintSpawnKind::Sol, 0)),
                "{foreign}"
            );
        }
        for foreign in [
            "modifier = { add = 100000 }",
            "modifier = { add = 100000 has_trait = trait_painted_galaxy_reserved_spawn_c }",
            "modifier = { add = 100000 has_country_flag = human_1 }",
        ] {
            let text = format!("spawn_weight = {{ base = 0 {reserved_value} {foreign} }}");
            assert_eq!(
                read(&text),
                Some(script(PaintSpawnKind::Reserved("b".to_owned()), 1)),
                "{foreign}"
            );
        }
        // An enabled seat has no marker, so the shape beside one is foreign too.
        let enabled = "add = value:painted_galaxy_spawn_weight|RANDOM_MODULO|10|RANDOM_VALUE|4|";
        for foreign in [
            "modifier = { add = 100000 }",
            "modifier = { add = 100000 has_country_flag = painted_galaxy_host }",
        ] {
            let text = format!("spawn_weight = {{ base = 0 {enabled} {foreign} }}");
            assert_eq!(
                read(&text),
                Some(script(PaintSpawnKind::Enabled, 4)),
                "{foreign}"
            );
        }
        assert_eq!(
            weight_statement(&seat(PaintSpawnKind::Enabled, 4)),
            weight_statement(&script(PaintSpawnKind::Enabled, 4))
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
}
