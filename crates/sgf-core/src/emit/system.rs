//! A new save system's statements in the shape the game writes a system it spawns by
//! script: the `galactic_object` entry, each body's `planets.planet` entry and each
//! deposit's `deposit` entry. `indent` is the entry's own indentation, copied from the
//! table it joins; every entry ends with the newline that separates it from what follows.

use super::{coord, hyperlane_block, lane_entry, quoted};
use crate::keys;
use crate::projections::name::NameTemplate;

/// What a spawned system's coordinate carries besides its position; a new entry copies
/// the value from a spawned system the game accepted rather than inventing one.
const VISUAL_HEIGHT: &str = "4.31213";
/// `carrier_binary_flags` of a star body and of any other body.
const STAR_CARRIER_FLAGS: u32 = 3;
const BODY_CARRIER_FLAGS: u32 = 1;
/// The `binary_flags` bits of a body: a name fixed by its layout, a model named in
/// `entity_name`, a ring and a moon. The game sets 64 beside any of them, and writes no
/// `binary_flags` when none is set.
const FIXED_NAME_FLAG: u32 = 1;
const ENTITY_NAME_FLAG: u32 = 2;
const ANY_FLAG: u32 = 64;
pub(crate) const RING_FLAG: u32 = 256;
const MOON_FLAG: u32 = 512;
/// How long a modifier the layout gives a body lasts: for ever.
const PERMANENT: &str = "-1";
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
    for planet in s.planets {
        w.pair(1, keys::PLANET, &planet.to_string());
    }
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
        w.open(1, keys::ASTEROID_BELTS);
        w.line(2, "");
        for &(kind, radius) in s.belts {
            w.line(2, "{");
            w.pair(3, keys::TYPE, &quoted(kind));
            w.pair(3, keys::INNER_RADIUS, &coord(radius));
            w.line(2, "}");
            w.separator();
        }
        w.close(1);
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

pub fn planet_entry(indent: &[u8], p: &PlanetEntry<'_>) -> Vec<u8> {
    let carrier = if p.star || is_star_class(p.class) {
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
        w.open(1, keys::TIMED_MODIFIER);
        w.open(2, keys::ITEMS);
        w.line(3, "");
        for modifier in p.modifiers {
            w.line(3, "{");
            w.pair(4, keys::MODIFIER, &quoted(modifier));
            w.pair(4, keys::DAYS, PERMANENT);
            w.line(3, "}");
            w.separator();
        }
        w.close(2);
        w.close(1);
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

/// Whether a body of `class` is a star, as the extra black holes of a layout are. The
/// vanilla star classes all match; a mod's star class named otherwise is taken as a planet.
fn is_star_class(class: &str) -> bool {
    class.ends_with("star") || matches!(class, "pc_black_hole" | "pc_pulsar")
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
    w.pair(2, keys::TYPE, "0");
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

/// Lines at a depth below the entry's own indentation.
struct Lines {
    base: String,
    out: String,
}

impl Lines {
    fn new(indent: &[u8]) -> Self {
        Self {
            base: String::from_utf8_lossy(indent).into_owned(),
            out: String::new(),
        }
    }

    fn indent(&self, depth: usize) -> String {
        format!("{}{}", self.base, "\t".repeat(depth))
    }

    fn line(&mut self, depth: usize, text: &str) {
        let indent = self.indent(depth);
        self.out.push_str(&format!("{indent}{text}\n"));
    }

    fn pair(&mut self, depth: usize, key: &str, value: &str) {
        self.line(depth, &format!("{key}={value}"));
    }

    /// `key=` and the opening brace below it.
    fn open(&mut self, depth: usize, key: &str) {
        self.line(depth, &format!("{key}="));
        self.line(depth, "{");
    }

    fn close(&mut self, depth: usize) {
        self.line(depth, "}");
    }

    /// `key={ a b }` as the game writes a list of ids: one line, a space after each.
    fn list(&mut self, depth: usize, key: &str, ids: &[u32]) {
        self.open(depth, key);
        let items: String = ids.iter().map(|id| format!("{id} ")).collect();
        self.line(depth + 1, &items);
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

    /// The single-space line the game writes after each entry of an anonymous list.
    fn separator(&mut self) {
        self.out.push_str(" \n");
    }

    fn bytes(&mut self, bytes: &[u8]) {
        self.out.push_str(&String::from_utf8_lossy(bytes));
    }

    fn into_bytes(self) -> Vec<u8> {
        self.out.into_bytes()
    }
}
