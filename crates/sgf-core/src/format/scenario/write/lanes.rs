//! Hyperlanes: the `add_hyperlane` statements that link two systems and the
//! `prevent_hyperlane` statements that bar the generator from linking them.

use std::collections::BTreeSet;

use super::{erase, index, lane_indent, matching, undirected};
use crate::cst;
use crate::format::scenario::emit::{hyperlane_stmt, prevent_hyperlane_stmt};
use crate::format::scenario::index::LaneStmt;
use crate::ops::rules::lanes as lane_rules;
use crate::ops::rules::{named, named_all};
use crate::ops::{Emitted, LanePair, Op, OpError, Plan, Planned, projected_lane};
use crate::plural;
use crate::session::Session;
use crate::views::DocumentKind;

pub(super) fn add_lane(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
    bridge: bool,
) -> Result<Planned, OpError> {
    emit_lanes(plan, s, &[LanePair { a, b, bridge }])?;
    Ok(Planned {
        description: format!(
            "Added lane {} <-> {}",
            named(&s.graph, a),
            named(&s.graph, b)
        ),
        inverse: Op::RemoveLane { a, b },
    })
}

pub(super) fn add_lanes(
    plan: &mut Plan,
    s: &Session,
    from: u32,
    to: &[(u32, bool)],
) -> Result<Planned, OpError> {
    if to.is_empty() {
        return Err(OpError::NoEntries);
    }
    let pairs: Vec<LanePair> = to
        .iter()
        .map(|&(b, bridge)| LanePair { a: from, b, bridge })
        .collect();
    emit_lanes(plan, s, &pairs)?;
    let ids: Vec<u32> = to.iter().map(|&(id, _)| id).collect();
    Ok(Planned {
        description: format!(
            "Added {} from {} to {}",
            plural(to.len(), "lane"),
            named(&s.graph, from),
            named_all(&s.graph, &ids)
        ),
        inverse: Op::RemoveLanes {
            from,
            to: to.iter().map(|&(id, _)| id).collect(),
        },
    })
}

pub(super) fn add_lane_pairs(
    plan: &mut Plan,
    s: &Session,
    pairs: &[LanePair],
) -> Result<Planned, OpError> {
    if pairs.is_empty() {
        return Err(OpError::NoEntries);
    }
    emit_lanes(plan, s, pairs)?;
    Ok(Planned {
        description: format!("Added {}", plural(pairs.len(), "lane")),
        inverse: Op::RemoveLanePairs {
            lanes: pairs.iter().map(|l| (l.a, l.b)).collect(),
        },
    })
}

/// One `add_hyperlane` statement per pair, refusing a pair the graph already links and a
/// bridge, which a scenario has no way to write.
fn emit_lanes(plan: &mut Plan, s: &Session, pairs: &[LanePair]) -> Result<(), OpError> {
    let mut seen = BTreeSet::new();
    for lane in pairs {
        if lane.bridge {
            return Err(OpError::Unsupported {
                op: "a bridge lane",
                kind: DocumentKind::Scenario,
            });
        }
        lane_rules::check_new_lane(&s.graph, lane.a, lane.b)?;
        if !seen.insert(undirected(lane.a, lane.b)) {
            return Err(OpError::DuplicateLane(lane.a, lane.b));
        }
    }
    let scenario = index(&s.doc);
    let indent = lane_indent(&s.doc, scenario);
    let eol = cst::eol_at(s.doc.original(), scenario.insert_at);
    for lane in pairs {
        plan.emit(
            Emitted::Lane(lane.a, lane.b),
            scenario.insert_at,
            cst::with_eol(&hyperlane_stmt(&indent, lane.a, lane.b), eol),
        );
    }
    Ok(())
}

pub(super) fn remove_lane(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    for id in [a, b] {
        if !s.graph.systems.contains_key(&id) {
            return Err(OpError::UnknownSystem(id));
        }
    }
    let (erased, _) = erase_lanes(plan, s, &[(a, b)])?;
    Ok(Planned {
        description: format!(
            "Removed lane {} <-> {} ({erased} statements)",
            named(&s.graph, a),
            named(&s.graph, b)
        ),
        inverse: Op::AddLane {
            a,
            b,
            bridge: false,
        },
    })
}

pub(super) fn remove_lanes(
    plan: &mut Plan,
    s: &Session,
    from: u32,
    to: &[u32],
) -> Result<Planned, OpError> {
    let pairs: Vec<(u32, u32)> = to.iter().map(|&other| (from, other)).collect();
    let (erased, restore) = erase_lanes(plan, s, &pairs)?;
    Ok(Planned {
        description: format!(
            "Removed {} from {} to {} ({erased} statements)",
            plural(to.len(), "lane"),
            named(&s.graph, from),
            named_all(&s.graph, to)
        ),
        inverse: Op::AddLanes {
            from,
            to: restore
                .iter()
                .filter(|l| l.b != from)
                .map(|l| (l.b, false))
                .collect(),
        },
    })
}

pub(super) fn remove_lane_pairs(
    plan: &mut Plan,
    s: &Session,
    pairs: &[(u32, u32)],
) -> Result<Planned, OpError> {
    let (erased, restore) = erase_lanes(plan, s, pairs)?;
    Ok(Planned {
        description: format!(
            "Removed {} ({erased} statements)",
            plural(pairs.len(), "lane")
        ),
        inverse: Op::AddLanePairs { lanes: restore },
    })
}

pub(super) fn isolate_one(plan: &mut Plan, s: &Session, id: u32) -> Result<Planned, OpError> {
    let cut = lane_rules::decide_isolate(&s.graph, &[id])?;
    let (erased, _) = erase_lanes(plan, s, &ends(&cut))?;
    Ok(Planned {
        description: format!(
            "Isolated {}: removed {} ({erased} statements)",
            named(&s.graph, id),
            plural(cut.len(), "lane")
        ),
        inverse: Op::AddLanes {
            from: id,
            to: cut
                .iter()
                .filter(|&&(_, to, _)| to != id && s.graph.systems.contains_key(&to))
                .map(|&(_, to, _)| (to, false))
                .collect(),
        },
    })
}

pub(super) fn isolate_many(plan: &mut Plan, s: &Session, ids: &[u32]) -> Result<Planned, OpError> {
    let cut = lane_rules::decide_isolate(&s.graph, ids)?;
    let (erased, _) = erase_lanes(plan, s, &ends(&cut))?;
    let restore: Vec<LanePair> = cut
        .iter()
        .filter(|&&(a, b, _)| a != b && s.graph.systems.contains_key(&b))
        .map(|&(a, b, _)| LanePair {
            a,
            b,
            bridge: false,
        })
        .collect();
    Ok(Planned {
        description: format!(
            "Isolated {}; removed {} ({erased} statements)",
            plural(ids.len(), "system"),
            plural(restore.len(), "lane")
        ),
        inverse: Op::AddLanePairs { lanes: restore },
    })
}

/// Empty every `add_hyperlane` statement naming one of `pairs`, whichever way round and
/// however many times the file lists it. `prevent_hyperlane` is not a lane and stays.
/// Returns how many statements were emptied and the lanes that put them back.
fn erase_lanes(
    plan: &mut Plan,
    s: &Session,
    pairs: &[(u32, u32)],
) -> Result<(usize, Vec<LanePair>), OpError> {
    let restore = lane_rules::decide_remove_pairs(&s.graph, pairs)?;
    let wanted: BTreeSet<(u32, u32)> = pairs.iter().map(|&(a, b)| undirected(a, b)).collect();
    let mut erased = 0;
    let ends = pairs.iter().map(|&(a, _)| a);
    for stmt in matching(&s.doc, ends, |l| {
        !l.prevent && wanted.contains(&undirected(l.from, l.to))
    }) {
        erase(plan, &s.doc, &stmt)?;
        erased += 1;
    }
    if erased == 0 {
        let (a, b) = pairs[0];
        return Err(OpError::NoSuchLane(a, b));
    }
    Ok((erased, restore))
}

fn ends(cut: &[(u32, u32, bool)]) -> Vec<(u32, u32)> {
    cut.iter().map(|&(a, b, _)| (a, b)).collect()
}

/// One `prevent_hyperlane` statement, refused when the file already prevents the pair and
/// when it links it: a file that both lays and forbids a lane leaves the generator
/// undefined, so the lane goes first.
pub(super) fn prevent_lane(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    if a == b {
        return Err(OpError::SelfLane(a));
    }
    for id in [a, b] {
        if !s.graph.systems.contains_key(&id) {
            return Err(OpError::UnknownSystem(id));
        }
    }
    if !prevented(s, a, b).is_empty() {
        return Err(OpError::PreventExists(a, b));
    }
    if projected_lane(&s.graph, a, b).is_some() {
        return Err(OpError::PreventLinked(a, b));
    }
    let scenario = index(&s.doc);
    let indent = lane_indent(&s.doc, scenario);
    plan.emit(
        Emitted::Lane(a, b),
        scenario.insert_at,
        cst::with_eol(
            &prevent_hyperlane_stmt(&indent, a, b),
            cst::eol_at(s.doc.original(), scenario.insert_at),
        ),
    );
    Ok(Planned {
        description: format!(
            "Prevented lane {} <-> {}",
            named(&s.graph, a),
            named(&s.graph, b)
        ),
        inverse: Op::AllowLane { a, b },
    })
}

/// Empty every `prevent_hyperlane` statement naming the pair, whichever way round and
/// however many times the file lists it. `add_hyperlane` is not a prevention and stays.
pub(super) fn unprevent_lane(
    plan: &mut Plan,
    s: &Session,
    a: u32,
    b: u32,
) -> Result<Planned, OpError> {
    let statements = prevented(s, a, b);
    if statements.is_empty() {
        return Err(OpError::NotPrevented(a, b));
    }
    for stmt in &statements {
        erase(plan, &s.doc, stmt)?;
    }
    Ok(Planned {
        description: format!(
            "Unprevented lane {} <-> {} ({} statements)",
            named(&s.graph, a),
            named(&s.graph, b),
            statements.len()
        ),
        inverse: Op::PreventLane { a, b },
    })
}

fn prevented(s: &Session, a: u32, b: u32) -> Vec<LaneStmt> {
    let pair = undirected(a, b);
    matching(&s.doc, [a], |l| {
        l.prevent && undirected(l.from, l.to) == pair
    })
}
