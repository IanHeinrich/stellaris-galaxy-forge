//! A new save system's statements in the shape the game writes a system it spawns by
//! script: the `galactic_object` entry, each body's `planets.planet` entry and each
//! deposit's `deposit` entry. `indent` is the entry's own indentation, copied from the
//! table it joins; every entry ends with the newline that separates it from what follows.

use super::{DEFAULT_SYSTEM_HEIGHT, Lines, NULL_DATE, coord, hyperlane_block, lane_entry, quoted};
use crate::keys;
use crate::projections::name::NameTemplate;

/// `carrier_binary_flags` of a star body and of any other body.
pub(crate) const STAR_CARRIER_FLAGS: u32 = 3;
const BODY_CARRIER_FLAGS: u32 = 1;
/// The `binary_flags` bits of a body: a name fixed by its layout, a model its layout set in
/// `entity_name`, a ring and a moon. The game sets 64 beside any of them, and writes no
/// `binary_flags` when none is set. A model set by an event's `set_planet_entity` has no bit
/// 2, and the game draws `entity_name` either way.
pub(crate) const FIXED_NAME_FLAG: u32 = 1;
pub(crate) const ENTITY_NAME_FLAG: u32 = 2;
pub(crate) const ANY_FLAG: u32 = 64;
/// The bit `trigger_megastructure_icon = yes` sets on the body that shows a megastructure's
/// icon, a ring world's habitable section.
pub(crate) const MEGASTRUCTURE_ICON_FLAG: u32 = 16;
pub(crate) const RING_FLAG: u32 = 256;
pub(crate) const MOON_FLAG: u32 = 512;
/// `deposit_holder.type` of a planet.
pub(crate) const PLANET_HOLDER: &str = "0";

/// A `galactic_object` entry.
#[derive(Debug, Clone, PartialEq)]
pub struct SystemEntry<'a> {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub name: &'a str,
    /// Every body, star first, in the order the system lists them.
    pub planets: &'a [u32],
    pub star_class: &'a str,
    /// `(to, length)`; no `hyperlane` block is written when empty.
    pub lanes: &'a [(u32, u32)],
    /// `(type, inner_radius)`; no `asteroid_belts` block is written when empty.
    pub belts: &'a [(&'a str, f64)],
    /// Star flags, each dated `flag_date`; no `flags` block is written when empty.
    pub flags: &'a [String],
    pub flag_date: &'a str,
    pub initializer: &'a str,
    pub inner_radius: f64,
    pub outer_radius: f64,
}

/// A `planets.planet` entry.
#[derive(Debug, Clone, PartialEq)]
pub struct PlanetEntry<'a> {
    pub id: u32,
    pub class: &'a str,
    pub size: u32,
    pub star: bool,
    pub name: &'a NameTemplate,
    /// Relative to the system's centre.
    pub x: f64,
    pub y: f64,
    pub system: u32,
    pub orbit: f64,
    /// The planet a moon orbits.
    pub moon_of: Option<u32>,
    pub moons: &'a [u32],
    /// The name is the layout's own rather than one built from the system's.
    pub fixed_name: bool,
    pub ring: bool,
    /// Timed modifiers with their days, `-1` for one that never expires.
    pub modifiers: &'a [(&'a str, i32)],
    /// Planet features, each a `planet_modifier` line.
    pub features: &'a [&'a str],
    pub entity: u32,
    pub entity_name: Option<&'a str>,
    pub deposits: &'a [u32],
    /// Planet flags, each dated `flag_date`.
    pub flags: &'a [String],
    pub flag_date: &'a str,
}

/// The `planets.planet` entry of a planet a build effect spawns, as the game's
/// `spawn_planet` and `spawn_habitat_effect` write one: a name it fixes, a model set by
/// `set_planet_entity`, which has no bit 2, the body it orbits in `moon_of` without the moon
/// bit, and the megastructure icon bit on a ring world's section that shows it.
#[derive(Debug, Clone, PartialEq)]
pub struct SpawnedEntry<'a> {
    pub id: u32,
    pub class: &'a str,
    pub size: u32,
    pub name: &'a NameTemplate,
    /// Relative to the system's centre.
    pub x: f64,
    pub y: f64,
    pub system: u32,
    /// Its distance from what it orbits.
    pub orbit: f64,
    /// The body it orbits; `None` round the system's centre.
    pub moon_of: Option<u32>,
    /// Planet flags, each dated `flag_date`.
    pub flags: &'a [String],
    pub flag_date: &'a str,
    pub entity_name: Option<&'a str>,
    pub megastructure_icon: bool,
    /// Timed modifiers, each with its days.
    pub modifiers: &'a [(&'a str, i32)],
}

pub fn spawned_entry(indent: &[u8], s: &SpawnedEntry<'_>) -> Vec<u8> {
    let icon = if s.megastructure_icon {
        MEGASTRUCTURE_ICON_FLAG
    } else {
        0
    };
    entry(
        indent,
        &Entry {
            binary_flags: FIXED_NAME_FLAG | ANY_FLAG | icon,
            moon_of: s.moon_of,
            modifiers: s.modifiers,
            flags: s.flags,
            flag_date: s.flag_date,
            entity_name: s.entity_name,
            ..Entry::new(s.id, s.class, s.size, s.name, (s.x, s.y), s.system, s.orbit)
        },
    )
}

/// One `planets.planet` entry, in the keys and order the game writes; an empty list, a
/// `None` and 0 binary flags write no line.
struct Entry<'a> {
    id: u32,
    class: &'a str,
    size: u32,
    name: &'a NameTemplate,
    /// Relative to the system's centre.
    at: (f64, f64),
    system: u32,
    orbit: f64,
    carrier_flags: u32,
    binary_flags: u32,
    moon_of: Option<u32>,
    moons: &'a [u32],
    modifiers: &'a [(&'a str, i32)],
    features: &'a [&'a str],
    /// Planet flags, each dated `flag_date`.
    flags: &'a [String],
    flag_date: &'a str,
    entity: u32,
    entity_name: Option<&'a str>,
    deposits: &'a [u32],
}

impl<'a> Entry<'a> {
    /// A body with nothing but its place, class, size and name.
    fn new(
        id: u32,
        class: &'a str,
        size: u32,
        name: &'a NameTemplate,
        at: (f64, f64),
        system: u32,
        orbit: f64,
    ) -> Self {
        Self {
            id,
            class,
            size,
            name,
            at,
            system,
            orbit,
            carrier_flags: BODY_CARRIER_FLAGS,
            binary_flags: 0,
            moon_of: None,
            moons: &[],
            modifiers: &[],
            features: &[],
            flags: &[],
            flag_date: "",
            entity: 0,
            entity_name: None,
            deposits: &[],
        }
    }
}

fn entry(indent: &[u8], e: &Entry<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &e.id.to_string());
    w.pair(1, keys::PLANET_CLASS, &quoted(e.class));
    w.pair(1, keys::PLANET_SIZE, &e.size.to_string());
    w.pair(1, keys::CARRIER_BINARY_FLAGS, &e.carrier_flags.to_string());
    w.line(1, &format!("{}=", keys::NAME));
    w.name(1, e.name);
    if e.binary_flags != 0 {
        w.pair(1, keys::BINARY_FLAGS, &e.binary_flags.to_string());
    }
    w.coordinate(1, e.at, e.system, None);
    w.pair(1, keys::ORBIT, &coord(e.orbit));
    // The game writes the date after three tabs.
    w.pair(1, keys::LAST_BOMBARDMENT, &format!("\t\t\t{NULL_DATE}"));
    if let Some(parent) = e.moon_of {
        w.pair(1, keys::MOON_OF, &parent.to_string());
    }
    if !e.moons.is_empty() {
        w.list(1, keys::MOONS, e.moons);
    }
    w.open(1, keys::PLANET_ORBITALS);
    w.close(1);
    w.pair(1, keys::BOMBARDMENT_DAMAGE, "0");
    if !e.modifiers.is_empty() {
        w.timed_modifiers(1, e.modifiers);
    }
    for feature in e.features {
        w.pair(1, keys::PLANET_MODIFIER, &quoted(feature));
    }
    if !e.flags.is_empty() {
        w.flags(1, e.flags, e.flag_date);
    }
    w.pair(1, keys::ENTITY, &e.entity.to_string());
    if let Some(name) = e.entity_name {
        w.pair(1, keys::ENTITY_NAME, &quoted(name));
    }
    if !e.deposits.is_empty() {
        w.list(1, keys::DEPOSITS, e.deposits);
    }
    w.close(0);
    w.into_bytes()
}

/// A `deposit` entry held by planet `holder`.
#[derive(Debug, Clone, PartialEq)]
pub struct DepositEntry<'a> {
    pub id: u32,
    pub kind: &'a str,
    pub holder: u32,
}

pub fn system_entry(indent: &[u8], s: &SystemEntry<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &s.id.to_string());
    w.coordinate(1, (s.x, s.y), crate::NULL_ID, Some(DEFAULT_SYSTEM_HEIGHT));
    w.open(1, keys::NAME);
    w.pair(2, keys::KEY, &quoted(s.name));
    w.close(1);
    w.planets(1, s.planets);
    w.pair(1, keys::STAR_CLASS, &quoted(s.star_class));
    if !s.lanes.is_empty() {
        let key = w.indent(1);
        let entry = w.indent(2);
        let entries: Vec<u8> = s
            .lanes
            .iter()
            .flat_map(|&(to, length)| lane_entry(entry.as_bytes(), to, length, false))
            .collect();
        w.bytes(&hyperlane_block(key.as_bytes(), &entries));
    }
    if !s.belts.is_empty() {
        w.belts(1, s.belts);
    }
    if !s.flags.is_empty() {
        w.flags(1, s.flags, s.flag_date);
    }
    w.pair(1, keys::INITIALIZER, &quoted(s.initializer));
    w.pair(1, keys::INNER_RADIUS, &coord(s.inner_radius));
    w.pair(1, keys::OUTER_RADIUS, &coord(s.outer_radius));
    w.list(1, keys::STARBASES, &[crate::NULL_ID]);
    w.pair(1, keys::SECTOR, &crate::NULL_ID.to_string());
    w.pair(1, keys::INDEX, "0");
    w.pair(1, keys::STORM, &crate::NULL_ID.to_string());
    w.close(0);
    w.into_bytes()
}

/// A system's `planet=` lines, one per body, star first.
pub fn planet_lines(indent: &[u8], planets: &[u32]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.planets(0, planets);
    w.into_bytes()
}

/// A system's `asteroid_belts` block of `(type, inner_radius)`.
pub fn belts_block(indent: &[u8], belts: &[(&str, f64)]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.belts(0, belts);
    w.into_bytes()
}

/// One belt entry `{ type=".." inner_radius=N }` followed by the single-space line that
/// separates entries of an `asteroid_belts` block. `indent` is the entry's own indentation,
/// one tab deeper than `asteroid_belts`'s.
pub fn belt_entry(indent: &[u8], kind: &str, radius: f64) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.line(0, "{");
    w.pair(1, keys::TYPE, &quoted(kind));
    w.pair(1, keys::INNER_RADIUS, &coord(radius));
    w.line(0, "}");
    w.separator();
    w.into_bytes()
}

/// A system's `flags` block, each flag dated `date`.
pub fn flags_block(indent: &[u8], flags: &[String], date: &str) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.flags(0, flags, date);
    w.into_bytes()
}

pub fn planet_entry(indent: &[u8], p: &PlanetEntry<'_>) -> Vec<u8> {
    let carrier_flags = if p.star {
        STAR_CARRIER_FLAGS
    } else {
        BODY_CARRIER_FLAGS
    };
    entry(
        indent,
        &Entry {
            carrier_flags,
            binary_flags: binary_flags(p),
            moon_of: p.moon_of,
            moons: p.moons,
            modifiers: p.modifiers,
            features: p.features,
            entity: p.entity,
            entity_name: p.entity_name,
            deposits: p.deposits,
            flags: p.flags,
            flag_date: p.flag_date,
            ..Entry::new(p.id, p.class, p.size, p.name, (p.x, p.y), p.system, p.orbit)
        },
    )
}

fn binary_flags(p: &PlanetEntry<'_>) -> u32 {
    let bits = [
        (p.fixed_name, FIXED_NAME_FLAG),
        (p.entity_name.is_some(), ENTITY_NAME_FLAG),
        (p.ring, RING_FLAG),
        (p.moon_of.is_some(), MOON_FLAG),
    ];
    let flags: u32 = bits
        .iter()
        .filter(|(set, _)| *set)
        .map(|(_, bit)| bit)
        .sum();
    match flags {
        0 => 0,
        flags => flags | ANY_FLAG,
    }
}

pub fn deposit_entry(indent: &[u8], d: &DepositEntry<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &d.id.to_string());
    w.pair(1, keys::TYPE, &quoted(d.kind));
    w.open(1, keys::DEPOSIT_HOLDER);
    w.pair(2, keys::TYPE, PLANET_HOLDER);
    w.pair(2, keys::ID, &d.holder.to_string());
    w.close(1);
    w.close(0);
    w.into_bytes()
}

/// A country's `events.anomalies` list, for an `events` block that has none.
pub fn anomalies_list(indent: &[u8], ids: &[u32]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.list(0, keys::ANOMALIES, ids);
    w.into_bytes()
}

/// A nebula cloud's entry in the top-level `ambient_object` table.
#[derive(Debug, Clone, PartialEq)]
pub struct AmbientEntry<'a> {
    pub id: u32,
    pub kind: &'a str,
    pub system: u32,
    /// The star's position in the system.
    pub star: (f64, f64),
    /// Where the object stands beside the star.
    pub at: (f64, f64),
}

pub fn ambient_entry(indent: &[u8], a: &AmbientEntry<'_>) -> Vec<u8> {
    let mut w = Lines::new(indent);
    let null = |w: &mut Lines, key: &str| {
        w.open(2, key);
        w.pair(3, keys::TYPE, "10");
        w.pair(3, keys::ID, &crate::NULL_ID.to_string());
        w.close(2);
    };
    w.open(0, &a.id.to_string());
    w.coordinate(1, a.star, a.system, None);
    w.pair(1, keys::DATA, &quoted(a.kind));
    w.open(1, keys::PROPERTIES);
    w.coordinate(2, a.at, a.system, None);
    null(&mut w, keys::ATTACH);
    w.open(2, keys::OFFSET);
    w.line(3, "0 0 0 ");
    w.close(2);
    w.pair(2, keys::SCALE, "1");
    null(&mut w, keys::ENTITY_FACE_OBJECT);
    w.pair(2, keys::APPEAR_STATE, "\"\"");
    w.close(1);
    w.close(0);
    w.into_bytes()
}

/// A system's `ambient_object` list, for a system that has none.
pub fn ambient_list(indent: &[u8], ids: &[u32]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.list(0, keys::AMBIENT_OBJECT, ids);
    w.into_bytes()
}

/// One end of a new wormhole pair: its entry in the top-level `natural_wormholes` table and
/// its bypass's in `bypasses`. The game fills in the rest of both on load.
#[derive(Debug, Clone, PartialEq)]
pub struct WormholeEnd {
    /// The `natural_wormholes` id.
    pub id: u32,
    pub bypass: u32,
    /// The other end's bypass.
    pub linked_to: u32,
    pub system: u32,
    /// Relative to the system's centre.
    pub at: (f64, f64),
}

/// `owner.type` of a bypass whose owner is a `natural_wormholes` row.
const NATURAL_WORMHOLE_OWNER: &str = "7";

pub fn natural_wormhole_entry(indent: &[u8], end: &WormholeEnd) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &end.id.to_string());
    w.coordinate(1, end.at, end.system, None);
    w.pair(1, keys::BYPASS, &end.bypass.to_string());
    w.close(0);
    w.into_bytes()
}

pub fn wormhole_bypass_entry(indent: &[u8], end: &WormholeEnd) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.open(0, &end.bypass.to_string());
    w.pair(1, keys::TYPE, &quoted("wormhole"));
    w.pair(1, keys::ACTIVE, "yes");
    w.pair(1, keys::LINKED_TO, &end.linked_to.to_string());
    w.open(1, keys::OWNER);
    w.pair(2, keys::TYPE, NATURAL_WORMHOLE_OWNER);
    w.pair(2, keys::ID, &end.id.to_string());
    w.close(1);
    w.close(0);
    w.into_bytes()
}

/// A `timed_modifier` block of `items`, each a modifier and its days (`-1` for one that
/// never expires), for an entity that has none.
pub fn timed_modifiers(indent: &[u8], items: &[(&str, i32)]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.timed_modifiers(0, items);
    w.into_bytes()
}

/// One modifier lasting `days` as an entry of `timed_modifier.items`, with the separator
/// line after it.
pub fn timed_modifier_item(indent: &[u8], modifier: &str, days: i32) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.timed_modifier(0, modifier, days);
    w.into_bytes()
}

/// The system entry's own blocks, beside the lines every emitter writes.
impl Lines {
    fn planets(&mut self, depth: usize, planets: &[u32]) {
        for planet in planets {
            self.pair(depth, keys::PLANET, &planet.to_string());
        }
    }

    fn belts(&mut self, depth: usize, belts: &[(&str, f64)]) {
        self.open(depth, keys::ASTEROID_BELTS);
        self.line(depth + 1, "");
        for &(kind, radius) in belts {
            self.line(depth + 1, "{");
            self.pair(depth + 2, keys::TYPE, &quoted(kind));
            self.pair(depth + 2, keys::INNER_RADIUS, &coord(radius));
            self.line(depth + 1, "}");
            self.separator();
        }
        self.close(depth);
    }

    fn flags(&mut self, depth: usize, flags: &[String], date: &str) {
        self.open(depth, keys::FLAGS);
        for flag in flags {
            self.pair(depth + 1, flag, date);
        }
        self.close(depth);
    }

    /// A name's braces at `depth`, with its key, `literal` and variables inside.
    pub(crate) fn name(&mut self, depth: usize, name: &NameTemplate) {
        self.line(depth, "{");
        self.pair(depth + 1, keys::KEY, &quoted(&name.key));
        if name.literal {
            self.pair(depth + 1, keys::LITERAL, "yes");
        }
        if !name.variables.is_empty() {
            self.open(depth + 1, keys::VARIABLES);
            self.line(depth + 2, "");
            for variable in &name.variables {
                self.line(depth + 2, "{");
                self.pair(depth + 3, keys::KEY, &quoted(&variable.name));
                self.line(depth + 3, &format!("{}=", keys::VALUE));
                self.name(depth + 3, &variable.value);
                self.line(depth + 2, "}");
                self.separator();
            }
            self.close(depth + 1);
        }
        self.close(depth);
    }

    /// `coordinate={ x y origin }` at `depth`, with a `visual_height` when given one.
    pub(crate) fn coordinate(
        &mut self,
        depth: usize,
        (x, y): (f64, f64),
        origin: u32,
        height: Option<f64>,
    ) {
        self.open(depth, keys::COORDINATE);
        self.pair(depth + 1, keys::X, &coord(x));
        self.pair(depth + 1, keys::Y, &coord(y));
        self.pair(depth + 1, keys::ORIGIN, &origin.to_string());
        if let Some(height) = height {
            self.pair(depth + 1, keys::VISUAL_HEIGHT, &coord(height));
        }
        self.close(depth);
    }

    fn timed_modifiers(&mut self, depth: usize, items: &[(&str, i32)]) {
        self.open(depth, keys::TIMED_MODIFIER);
        self.open(depth + 1, keys::ITEMS);
        self.line(depth + 2, "");
        for &(modifier, days) in items {
            self.timed_modifier(depth + 2, modifier, days);
        }
        self.close(depth + 1);
        self.close(depth);
    }

    fn timed_modifier(&mut self, depth: usize, modifier: &str, days: i32) {
        self.line(depth, "{");
        self.pair(depth + 1, keys::MODIFIER, &quoted(modifier));
        self.pair(depth + 1, keys::DAYS, &days.to_string());
        self.line(depth, "}");
        self.separator();
    }
}
