//! A new save system's statements in the shape the game writes a system it spawns by
//! script: the `galactic_object` entry, each body's `planets.planet` entry and each
//! deposit's `deposit` entry. `indent` is the entry's own indentation, copied from the
//! table it joins; every entry ends with the newline that separates it from what follows.

use super::{Lines, coord, hyperlane_block, lane_entry, quoted};
use crate::keys;
use crate::projections::name::NameTemplate;

/// What a spawned system's coordinate carries besides its position; a new entry copies
/// the value from a spawned system the game accepted rather than inventing one.
const VISUAL_HEIGHT: &str = "4.31213";
/// `carrier_binary_flags` of a star body and of any other body.
pub(crate) const STAR_CARRIER_FLAGS: u32 = 3;
const BODY_CARRIER_FLAGS: u32 = 1;
/// The `binary_flags` bits of a body: a name fixed by its layout, a model named in
/// `entity_name`, a ring and a moon. The game sets 64 beside any of them, and writes no
/// `binary_flags` when none is set.
const FIXED_NAME_FLAG: u32 = 1;
const ENTITY_NAME_FLAG: u32 = 2;
const ANY_FLAG: u32 = 64;
pub(crate) const RING_FLAG: u32 = 256;
const MOON_FLAG: u32 = 512;
/// `deposit_holder.type` of a planet.
pub(crate) const PLANET_HOLDER: &str = "0";
/// How long a modifier the layout gives a body lasts: for ever.
pub(crate) const PERMANENT: &str = "-1";
/// `last_bombardment` as a body that was never bombarded holds it, tabs included.
const NEVER_BOMBARDED: &str = "\t\t\t\"0.01.01\"";

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
    /// Planet modifiers, each written as a timed modifier that never expires.
    pub modifiers: &'a [String],
    pub entity: u32,
    pub entity_name: Option<&'a str>,
    pub deposits: &'a [u32],
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
    w.open(1, keys::COORDINATE);
    w.pair(2, keys::X, &coord(s.x));
    w.pair(2, keys::Y, &coord(s.y));
    w.pair(2, keys::ORIGIN, &crate::NULL_ID.to_string());
    w.pair(2, keys::VISUAL_HEIGHT, VISUAL_HEIGHT);
    w.close(1);
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

/// A system's `flags` block, each flag dated `date`.
pub fn flags_block(indent: &[u8], flags: &[String], date: &str) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.flags(0, flags, date);
    w.into_bytes()
}

pub fn planet_entry(indent: &[u8], p: &PlanetEntry<'_>) -> Vec<u8> {
    let carrier = if p.star {
        STAR_CARRIER_FLAGS
    } else {
        BODY_CARRIER_FLAGS
    };
    let mut w = Lines::new(indent);
    w.open(0, &p.id.to_string());
    w.pair(1, keys::PLANET_CLASS, &quoted(p.class));
    w.pair(1, keys::PLANET_SIZE, &p.size.to_string());
    w.pair(1, keys::CARRIER_BINARY_FLAGS, &carrier.to_string());
    w.line(1, &format!("{}=", keys::NAME));
    w.name(1, p.name);
    let flags = binary_flags(p);
    if flags != 0 {
        w.pair(1, keys::BINARY_FLAGS, &flags.to_string());
    }
    w.open(1, keys::COORDINATE);
    w.pair(2, keys::X, &coord(p.x));
    w.pair(2, keys::Y, &coord(p.y));
    w.pair(2, keys::ORIGIN, &p.system.to_string());
    w.close(1);
    w.pair(1, keys::ORBIT, &coord(p.orbit));
    w.pair(1, keys::LAST_BOMBARDMENT, NEVER_BOMBARDED);
    if let Some(parent) = p.moon_of {
        w.pair(1, keys::MOON_OF, &parent.to_string());
    }
    if !p.moons.is_empty() {
        w.list(1, keys::MOONS, p.moons);
    }
    w.open(1, keys::PLANET_ORBITALS);
    w.close(1);
    w.pair(1, keys::BOMBARDMENT_DAMAGE, "0");
    if !p.modifiers.is_empty() {
        w.timed_modifiers(1, p.modifiers);
    }
    w.pair(1, keys::ENTITY, &p.entity.to_string());
    if let Some(name) = p.entity_name {
        w.pair(1, keys::ENTITY_NAME, &quoted(name));
    }
    if !p.deposits.is_empty() {
        w.list(1, keys::DEPOSITS, p.deposits);
    }
    w.close(0);
    w.into_bytes()
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

/// A planet's `deposits` list, for a planet entry that has none.
pub fn deposits_list(indent: &[u8], ids: &[u32]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.list(0, keys::DEPOSITS, ids);
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
    w.coordinate(1, a.star, a.system);
    w.pair(1, keys::DATA, &quoted(a.kind));
    w.open(1, keys::PROPERTIES);
    w.coordinate(2, a.at, a.system);
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

/// A `timed_modifier` block of permanent `modifiers`, for an entity that has none.
pub fn timed_modifiers(indent: &[u8], modifiers: &[&str]) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.timed_modifiers(0, modifiers);
    w.into_bytes()
}

/// One permanent modifier as an entry of `timed_modifier.items`, with the separator line
/// after it.
pub fn timed_modifier_item(indent: &[u8], modifier: &str) -> Vec<u8> {
    let mut w = Lines::new(indent);
    w.timed_modifier(0, modifier);
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
    fn name(&mut self, depth: usize, name: &NameTemplate) {
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

    /// `coordinate={ x y origin }` at `depth`.
    fn coordinate(&mut self, depth: usize, (x, y): (f64, f64), origin: u32) {
        self.open(depth, keys::COORDINATE);
        self.pair(depth + 1, keys::X, &coord(x));
        self.pair(depth + 1, keys::Y, &coord(y));
        self.pair(depth + 1, keys::ORIGIN, &origin.to_string());
        self.close(depth);
    }

    fn timed_modifiers<S: AsRef<str>>(&mut self, depth: usize, modifiers: &[S]) {
        self.open(depth, keys::TIMED_MODIFIER);
        self.open(depth + 1, keys::ITEMS);
        self.line(depth + 2, "");
        for modifier in modifiers {
            self.timed_modifier(depth + 2, modifier.as_ref());
        }
        self.close(depth + 1);
        self.close(depth);
    }

    fn timed_modifier(&mut self, depth: usize, modifier: &str) {
        self.line(depth, "{");
        self.pair(depth + 1, keys::MODIFIER, &quoted(modifier));
        self.pair(depth + 1, keys::DAYS, PERMANENT);
        self.line(depth, "}");
        self.separator();
    }
}
