//! What the undo list says: the description of every op on the sample save and a scenario
//! names each system or body it mentions, with its id, as `ops::rules::named` and
//! `named_body` do ("Lachium I #2447"), and mentions the system or body the op addresses.

use sgf_core::ops::Op;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::projections::name::looks_like_key;
use sgf_core::session::Session;

use common::examples::{self, one_of_each};

use crate::common;

/// The words a description puts before an id when it leaves out the name.
const BARE_KINDS: &[&str] = &["system", "planet", "moon", "habitat", "star"];

/// The system or body `op` addresses, read from its `system` or `body` field.
fn addressed(op: &Op) -> Option<u64> {
    let value = serde_json::to_value(op).expect("an op serialises");
    ["body", "system"]
        .into_iter()
        .find_map(|field| value.get(field).and_then(serde_json::Value::as_u64))
}

/// The name a description shows for system `id`, when `graph` holds one it can show.
fn shown_name(graph: &GalaxyGraph, id: u32) -> Option<String> {
    let shown = graph.systems.get(&id)?.display_name();
    (!shown.is_empty() && !shown.split(' ').any(looks_like_key)).then_some(shown)
}

/// Whether body `id` has a name a description can show, as the session's details read it
/// before the op. A body they don't hold, such as one the op adds, has one.
fn body_shows_a_name(session: &Session, id: u32) -> bool {
    let Ok(details) = session.details() else {
        return true;
    };
    session
        .graph()
        .systems
        .keys()
        .filter_map(|&system| details.raw(system))
        .flat_map(|system| system.planets.iter())
        .find(|planet| planet.id == id)
        .is_none_or(|planet| !planet.name.shown().is_empty())
}

/// Each `<kind> #<id>` in `description` with no name between the kind and the id, left out
/// where the system or body has no name to show. A system whose name ends in "system" is
/// named.
fn bare_mentions(before: &Session, description: &str) -> Vec<String> {
    let mut found = Vec::new();
    for (at, _) in description.match_indices(" #") {
        let text = &description[..at];
        let word = text.rsplit(' ').next().unwrap_or(text);
        let id: String = description[at + 2..]
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        let id_number: u32 = id.parse().unwrap_or(0);
        let bare = match word {
            "system" => {
                shown_name(before.graph(), id_number).is_some_and(|shown| !text.ends_with(&shown))
            }
            _ => BARE_KINDS.contains(&word) && body_shows_a_name(before, id_number),
        };
        if bare {
            found.push(format!("{word} #{id}"));
        }
    }
    found
}

/// The description `op` reads in the undo list, and the session as it stood before it.
fn description(session: Session, op: Op) -> (String, Session) {
    let name = op.name();
    let before = session.clone();
    let mut session = session;
    let text = session
        .apply_inverse(op)
        .unwrap_or_else(|e| panic!("{name}: {e}"))
        .entry
        .description;
    (text, before)
}

#[test]
fn a_description_names_what_it_mentions_with_its_id() {
    let mut failures = Vec::new();
    for example in one_of_each() {
        let name = example.name();
        let open_save = example.open_save;
        let cases = example
            .save
            .map(|op| (open_save(), op))
            .into_iter()
            .chain(example.scenario.map(|op| (examples::scenario(), op)));
        for (session, op) in cases {
            let target = addressed(&op);
            let (text, before) = description(session, op);
            if let Some(id) = target.filter(|id| !text.contains(&format!("#{id}"))) {
                failures.push(format!("{name}: \"{text}\" leaves out #{id}"));
            }
            let bare = bare_mentions(&before, &text);
            if !bare.is_empty() {
                failures.push(format!(
                    "{name}: \"{text}\" names {} without a name",
                    bare.join(", ")
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// A megastructure that spawns a planet names the planet after the row, as a body is named.
#[test]
fn a_megastructure_names_the_planet_it_spawns() {
    let (text, before) = description(common::open_4_5(), examples::sol_shipyard());
    assert_eq!(
        text,
        "Added megastructure #16 (eq_shipyard_2) in Alari system #169, with planet Processing Ring #16777273"
    );
    assert!(bare_mentions(&before, &text).is_empty(), "{text}");
}
