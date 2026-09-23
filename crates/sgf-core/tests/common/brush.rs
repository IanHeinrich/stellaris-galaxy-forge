//! The ops the map's brushes send, shaped as `app/src/store/editorStore.brush.ts` builds
//! them: each a `Batch`, so one stroke is one undo step.
use sgf_core::ops::{LanePair, NewSystem, Op};

pub fn new_system(id: u32, x: f64, y: f64) -> NewSystem {
    NewSystem {
        id,
        x,
        y,
        name: None,
        initializer: None,
        spawn_weight: None,
        spawn_script: None,
        statement: None,
    }
}

/// A painted grid: `cols` by `rows` systems 10 apart from `origin`, numbered from
/// `first` row by row, each laned to its right and lower neighbour.
pub fn grid(
    first: u32,
    origin: (f64, f64),
    cols: u32,
    rows: u32,
) -> (Vec<NewSystem>, Vec<LanePair>) {
    let id_at = |row: u32, col: u32| first + row * cols + col;
    let mut systems = Vec::new();
    let mut lanes = Vec::new();
    for row in 0..rows {
        for col in 0..cols {
            systems.push(new_system(
                id_at(row, col),
                origin.0 + f64::from(col) * 10.0,
                origin.1 + f64::from(row) * 10.0,
            ));
            if col + 1 < cols {
                lanes.push(lane(id_at(row, col), id_at(row, col + 1)));
            }
            if row + 1 < rows {
                lanes.push(lane(id_at(row, col), id_at(row + 1, col)));
            }
        }
    }
    (systems, lanes)
}

pub fn lane(a: u32, b: u32) -> LanePair {
    LanePair {
        a,
        b,
        bridge: false,
    }
}

/// The paint brush's stroke: its systems, then its lanes.
pub fn paint(systems: Vec<NewSystem>, lanes: Vec<LanePair>) -> Op {
    Op::Batch {
        description: format!(
            "Painted {} systems and {} lanes",
            systems.len(),
            lanes.len()
        ),
        ops: vec![Op::AddSystems { systems }, Op::AddLanePairs { lanes }],
    }
}

/// The erase brush's stroke.
pub fn erase(ids: Vec<u32>) -> Op {
    Op::Batch {
        description: format!("Erased {} systems", ids.len()),
        ops: vec![Op::RemoveSystems { ids }],
    }
}

/// The connect brush's stroke.
pub fn connect(lanes: Vec<LanePair>) -> Op {
    Op::Batch {
        description: format!("Connected {} lanes", lanes.len()),
        ops: vec![Op::AddLanePairs { lanes }],
    }
}

/// The cut brush's stroke.
pub fn cut(lanes: Vec<(u32, u32)>) -> Op {
    Op::Batch {
        description: format!("Cut {} lanes", lanes.len()),
        ops: vec![Op::RemoveLanePairs { lanes }],
    }
}
