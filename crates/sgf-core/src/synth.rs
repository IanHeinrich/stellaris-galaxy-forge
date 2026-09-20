//! A synthetic Stellaris-shaped galaxy: the `gamestate` and `meta` bytes of a save for
//! stress-testing the loader and the renderer, and for reaching shapes the sample save
//! does not hold. Never loaded in the game; it only needs to satisfy this crate's
//! projections and validator.

use std::collections::HashMap;
use std::f64::consts::TAU;

use crate::emit;
use crate::{NULL_ID, as_u32, keys};

/// What to generate: a spiral of `systems` laid out from `seed`, plus one waystation
/// network per entry of `waystation_networks`, each naming the systems that hold one.
#[derive(Debug, Clone, Default)]
pub struct SynthOptions {
    pub systems: u32,
    pub seed: u64,
    pub waystation_networks: Vec<Vec<u32>>,
}

/// A generated save, as `archive::write_sav` takes it.
#[derive(Debug, Clone)]
pub struct Synth {
    pub gamestate: Vec<u8>,
    pub meta: Vec<u8>,
    /// Undirected hyperlanes, those a waystation network needed included.
    pub lanes: usize,
}

/// One waystation: which starbase it is, where it stands and which network it joins.
struct Station {
    id: u32,
    system: u32,
    network: u32,
}

/// Star classes with weights that make g/k/m common, as in a real galaxy.
const STAR_CLASSES: &[(&str, u32)] = &[
    ("sc_b", 2),
    ("sc_a", 3),
    ("sc_f", 6),
    ("sc_g", 16),
    ("sc_k", 20),
    ("sc_m", 24),
    ("sc_black_hole", 1),
    ("sc_neutron_star", 1),
    ("sc_pulsar", 1),
    ("sc_binary_1", 3),
    ("sc_trinary_1", 1),
];

/// A small xorshift64 generator: deterministic, no external crate.
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(if seed == 0 {
            0x9E37_79B9_7F4A_7C15
        } else {
            seed
        })
    }

    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }
}

/// Generate the galaxy `opts` describes.
pub fn galaxy(opts: &SynthOptions) -> Result<Synth, String> {
    let systems = opts.systems;
    if systems == 0 {
        return Err("systems must be at least 1".to_owned());
    }
    let stations = stations(opts)?;
    let n = systems as usize;
    let mut rng = Rng::new(opts.seed);

    let galaxy_radius = (500.0 * (systems as f64 / 1000.0).sqrt()).max(200.0);
    let core_radius = 0.225 * galaxy_radius;

    let mut coords = Vec::with_capacity(n);
    let mut star_classes = Vec::with_capacity(n);
    let mut neighbor_k = Vec::with_capacity(n);
    for i in 0..n {
        coords.push(spiral_point(i, n, galaxy_radius, &mut rng));
        star_classes.push(pick_star_class(&mut rng));
        neighbor_k.push(2 + (rng.next_u64() % 3) as usize);
    }

    let edges = nearest_neighbour_edges(&coords, &neighbor_k, galaxy_radius);
    let mut adjacency: Vec<Vec<(u32, u32)>> = vec![Vec::new(); n];
    let link = |adjacency: &mut Vec<Vec<(u32, u32)>>, a: u32, b: u32| {
        let length = coord_distance(coords[a as usize], coords[b as usize]).floor() as u32;
        adjacency[a as usize].push((b, length));
        adjacency[b as usize].push((a, length));
    };
    for &(a, b) in &edges {
        link(&mut adjacency, a, b);
    }
    // Waystations of one network only run a wayline where their systems are connected,
    // so each consecutive pair no lane already joins gets one.
    let mut lanes = edges.len();
    for network in &opts.waystation_networks {
        for pair in network.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if a == b || adjacency[a as usize].iter().any(|&(to, _)| to == b) {
                continue;
            }
            link(&mut adjacency, a, b);
            lanes += 1;
        }
    }
    for entries in &mut adjacency {
        entries.sort_unstable();
    }

    let mut gamestate = Vec::with_capacity(n * 220);
    write_header(&mut gamestate, galaxy_radius, core_radius);
    write_nebulae(&mut gamestate, &coords, galaxy_radius, systems);
    gamestate.extend_from_slice(b"galactic_object=\n{\n");
    for id in 0..n {
        let starbase = stations
            .iter()
            .find(|s| s.system == id as u32)
            .map(|s| s.id);
        write_system(
            &mut gamestate,
            id as u32,
            coords[id],
            star_classes[id],
            &adjacency[id],
            starbase,
        );
    }
    gamestate.extend_from_slice(b"}\n");
    write_starbase_mgr(&mut gamestate, &stations);
    write_waystation_networks(&mut gamestate, &stations);

    let meta = b"version=\"Pegasus v4.4.6\"\nname=\"synth\"\ndate=\"2200.01.01\"\n".to_vec();
    Ok(Synth {
        gamestate,
        meta,
        lanes,
    })
}

/// One station per system a network names, ids allocated from 0 in the order the
/// networks list them.
fn stations(opts: &SynthOptions) -> Result<Vec<Station>, String> {
    let mut stations: Vec<Station> = Vec::new();
    for (network, systems) in opts.waystation_networks.iter().enumerate() {
        for &system in systems {
            if system >= opts.systems {
                return Err(format!("waystation system {system} does not exist"));
            }
            if stations.iter().any(|s| s.system == system) {
                return Err(format!("waystation system {system} is listed twice"));
            }
            stations.push(Station {
                id: as_u32(stations.len()),
                system,
                network: as_u32(network),
            });
        }
    }
    Ok(stations)
}

/// A point on a 4-arm spiral: `i`'s radius grows with `sqrt(i / n)` (uniform over the
/// disc's area), its angle is its arm plus a twist that grows with radius, both jittered.
fn spiral_point(i: usize, n: usize, galaxy_radius: f64, rng: &mut Rng) -> (f64, f64) {
    let t = if n > 1 {
        i as f64 / (n - 1) as f64
    } else {
        0.0
    };
    let radius = t.sqrt() * galaxy_radius;
    let arm_angle = (i % 4) as f64 * TAU / 4.0;
    let winding = 1.8 * TAU;
    let angle_jitter = (rng.next_f64() - 0.5) * 0.6;
    let radius_jitter = (rng.next_f64() - 0.5) * galaxy_radius * 0.06;
    let angle = arm_angle + winding * t + angle_jitter;
    let r = (radius + radius_jitter).max(0.0);
    (r * angle.cos(), r * angle.sin())
}

fn pick_star_class(rng: &mut Rng) -> &'static str {
    let total: u32 = STAR_CLASSES.iter().map(|&(_, w)| w).sum();
    let mut roll = (rng.next_f64() * f64::from(total)) as u32;
    for &(name, weight) in STAR_CLASSES {
        if roll < weight {
            return name;
        }
        roll -= weight;
    }
    STAR_CLASSES[STAR_CLASSES.len() - 1].0
}

fn coord_distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}

/// Each system's 2-4 nearest neighbours, found via a grid of buckets (O(N) for a roughly
/// uniform distribution) and symmetrised into an undirected edge set.
fn nearest_neighbour_edges(
    coords: &[(f64, f64)],
    neighbor_k: &[usize],
    galaxy_radius: f64,
) -> Vec<(u32, u32)> {
    let n = coords.len();
    if n < 2 {
        return Vec::new();
    }
    let cell_size = (2.0 * galaxy_radius / (n as f64).sqrt().max(1.0)).max(1.0);
    let cell_of = |x: f64, y: f64| -> (i32, i32) {
        (
            (x / cell_size).floor() as i32,
            (y / cell_size).floor() as i32,
        )
    };
    let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
    for (i, &(x, y)) in coords.iter().enumerate() {
        grid.entry(cell_of(x, y)).or_default().push(i as u32);
    }

    const MAX_RING: i32 = 50;
    let mut edges = std::collections::HashSet::new();
    for i in 0..n {
        let (xi, yi) = coords[i];
        let (cx, cy) = cell_of(xi, yi);
        let k = neighbor_k[i].min(n - 1);
        let mut candidates: Vec<u32> = Vec::new();
        let mut ring = 0i32;
        loop {
            add_ring(&grid, cx, cy, ring, &mut candidates);
            // `> k`, not `>= k`: `i` itself is always among the candidates once ring 0 is in.
            if candidates.len() > k || ring >= MAX_RING {
                break;
            }
            ring += 1;
        }
        candidates.retain(|&j| j as usize != i);
        candidates.sort_by(|&a, &b| {
            coord_distance(coords[a as usize], (xi, yi))
                .partial_cmp(&coord_distance(coords[b as usize], (xi, yi)))
                .unwrap()
        });
        candidates.truncate(k);
        for c in candidates {
            let a = i as u32;
            edges.insert((a.min(c), a.max(c)));
        }
    }
    edges.into_iter().collect()
}

fn add_ring(
    grid: &HashMap<(i32, i32), Vec<u32>>,
    cx: i32,
    cy: i32,
    ring: i32,
    candidates: &mut Vec<u32>,
) {
    let mut push = |x: i32, y: i32| {
        if let Some(v) = grid.get(&(x, y)) {
            candidates.extend(v.iter().copied());
        }
    };
    if ring == 0 {
        push(cx, cy);
        return;
    }
    for dx in -ring..=ring {
        push(cx + dx, cy - ring);
        push(cx + dx, cy + ring);
    }
    for dy in -(ring - 1)..=(ring - 1) {
        push(cx - ring, cy + dy);
        push(cx + ring, cy + dy);
    }
}

fn write_header(buf: &mut Vec<u8>, galaxy_radius: f64, core_radius: f64) {
    buf.extend_from_slice(b"version=\"Pegasus v4.4.6\"\n");
    buf.extend_from_slice(b"version_control_revision=0\n");
    buf.extend_from_slice(b"name=\"synth\"\n");
    buf.extend_from_slice(b"date=\"2200.01.01\"\n");
    buf.extend_from_slice(format!("galaxy_radius={}\n", emit::coord(galaxy_radius)).as_bytes());
    buf.extend_from_slice(b"galaxy=\n{\n");
    buf.extend_from_slice(format!("\tcore_radius={}\n", emit::coord(core_radius)).as_bytes());
    buf.extend_from_slice(b"}\n");
}

/// Three minimal `nebula=` blocks, cheap to satisfy `extract_nebula`: a coordinate, a
/// name, a radius and one member system each.
fn write_nebulae(buf: &mut Vec<u8>, coords: &[(f64, f64)], galaxy_radius: f64, systems: u32) {
    for i in 0..3u32 {
        let member = i % systems;
        let (x, y) = coords[member as usize];
        buf.extend_from_slice(b"nebula=\n{\n");
        buf.extend_from_slice(b"\tcoordinate=\n\t{\n");
        buf.extend_from_slice(format!("\t\tx={}\n", emit::coord(x)).as_bytes());
        buf.extend_from_slice(format!("\t\ty={}\n", emit::coord(y)).as_bytes());
        buf.extend_from_slice(b"\t\torigin=4294967295\n");
        buf.extend_from_slice(b"\t}\n");
        buf.extend_from_slice(b"\tname=\n\t{\n");
        buf.extend_from_slice(format!("\t\tkey=\"NAME_Synth_Nebula_{i}\"\n").as_bytes());
        buf.extend_from_slice(b"\t}\n");
        buf.extend_from_slice(
            format!("\tradius={}\n", emit::coord(galaxy_radius * 0.05)).as_bytes(),
        );
        buf.extend_from_slice(format!("\tgalactic_object={member}\n").as_bytes());
        buf.extend_from_slice(b"}\n");
    }
}

fn write_system(
    buf: &mut Vec<u8>,
    id: u32,
    (x, y): (f64, f64),
    star_class: &str,
    lanes: &[(u32, u32)],
    starbase: Option<u32>,
) {
    buf.extend_from_slice(format!("\t{id}=\n\t{{\n").as_bytes());
    buf.extend_from_slice(b"\t\tcoordinate=\n\t\t{\n");
    buf.extend_from_slice(format!("\t\t\tx={}\n", emit::coord(x)).as_bytes());
    buf.extend_from_slice(format!("\t\t\ty={}\n", emit::coord(y)).as_bytes());
    buf.extend_from_slice(b"\t\t\torigin=4294967295\n");
    buf.extend_from_slice(b"\t\t\trandomized=no\n");
    buf.extend_from_slice(b"\t\t\tvisual_height=0\n");
    buf.extend_from_slice(b"\t\t}\n");
    buf.extend_from_slice(b"\t\ttype=star\n");
    buf.extend_from_slice(b"\t\tname=\n\t\t{\n");
    buf.extend_from_slice(format!("\t\t\tkey=\"NAME_Synth_{id}\"\n").as_bytes());
    buf.extend_from_slice(b"\t\t}\n");
    buf.extend_from_slice(format!("\t\tplanet={id}\n").as_bytes());
    buf.extend_from_slice(format!("\t\tstar_class=\"{star_class}\"\n").as_bytes());
    if !lanes.is_empty() {
        let mut entries = Vec::with_capacity(lanes.len() * 40);
        for &(to, length) in lanes {
            entries.extend_from_slice(&emit::lane_entry(b"\t\t\t", to, length, false));
        }
        buf.extend_from_slice(&emit::hyperlane_block(b"\t\t", &entries));
    }
    if let Some(starbase) = starbase {
        // A system whose only station is a waystation writes a null in the first slot,
        // where a regular starbase would stand.
        let line = format!(
            "\t\t{}=\n\t\t{{\n\t\t\t{NULL_ID} {starbase} \n\t\t}}\n",
            keys::STARBASES
        );
        buf.extend_from_slice(line.as_bytes());
    }
    buf.extend_from_slice(b"\t}\n");
}

/// The `starbase_mgr.starbases` table: one waystation entry per station, in the shape
/// the game writes a starbase entry.
fn write_starbase_mgr(buf: &mut Vec<u8>, stations: &[Station]) {
    buf.extend_from_slice(b"starbase_mgr=\n{\n\tstarbases=\n\t{\n");
    for station in stations {
        buf.extend_from_slice(format!("\t\t{}=\n\t\t{{\n", station.id).as_bytes());
        buf.extend_from_slice(b"\t\t\tlevel=\"starbase_level_waystation_1\"\n");
        buf.extend_from_slice(b"\t\t\ttype=\"swaystation_research\"\n");
        buf.extend_from_slice(b"\t\t\tmodules=\n\t\t\t{\n");
        buf.extend_from_slice(b"\t\t\t\t0=waystation_research_module\n");
        buf.extend_from_slice(b"\t\t\t}\n");
        buf.extend_from_slice(format!("\t\t\tstation={NULL_ID}\n").as_bytes());
        buf.extend_from_slice(b"\t\t\torbitals=\n\t\t\t{\n\t\t\t}\n");
        buf.extend_from_slice(b"\t\t}\n");
    }
    buf.extend_from_slice(b"\t}\n}\n");
}

/// The `waystation_networks` table: one entry per network, listing its starbase ids.
fn write_waystation_networks(buf: &mut Vec<u8>, stations: &[Station]) {
    let Some(last) = stations.iter().map(|s| s.network).max() else {
        return;
    };
    buf.extend_from_slice(format!("{}=\n{{\n", keys::WAYSTATION_NETWORKS).as_bytes());
    for network in 0..=last {
        buf.extend_from_slice(format!("\t{network}=\n\t{{\n").as_bytes());
        buf.extend_from_slice(format!("\t\t{}=\n\t\t{{\n\t\t\t", keys::WAYSTATIONS).as_bytes());
        for station in stations.iter().filter(|s| s.network == network) {
            buf.extend_from_slice(format!("{} ", station.id).as_bytes());
        }
        buf.extend_from_slice(b"\n\t\t}\n\t}\n");
    }
    buf.extend_from_slice(b"}\n");
}
