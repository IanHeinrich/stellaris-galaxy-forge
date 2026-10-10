//! Star types: each star class a save's systems have, found by its letter, a colour word,
//! its key or its localised name.

use std::collections::BTreeMap;

use super::{NameResolver, Rank, rank};
use crate::as_u32;
use crate::projections::galaxy::GalaxyGraph;
use crate::projections::name::NameTemplate;
use crate::views::{DocumentKind, SearchHit, SearchKind};

/// The colour words of the base game's classes, as the localisation describes their stars.
const COLOURS: [(&str, &[&str]); 6] = [
    ("yellow", &["sc_g"]),
    ("orange", &["sc_k"]),
    ("red", &["sc_m", "sc_m_giant"]),
    ("blue", &["sc_b"]),
    ("white", &["sc_a", "sc_f"]),
    ("brown", &["sc_t"]),
];

/// Words a query may put round a letter or a colour: "g star", "class g", "g-class".
const FILLER: [&str; 2] = ["class", "star"];

/// One star type: the classes the localisation names alike, and their systems.
pub(super) struct StarType {
    /// Ascending; the first stands for the type.
    classes: Vec<String>,
    /// Ascending.
    pub systems: Vec<u32>,
    name: Option<String>,
}

/// Every star type matching `needle`, best first and then by key, with its place among the
/// galaxy's star types. A scenario has none: a system there has a star class only when its
/// initializer fixes one, so a count would leave out every star the game draws at random.
pub(super) fn matching(
    g: &GalaxyGraph,
    needle: &str,
    resolve: NameResolver<'_>,
) -> Vec<(Rank, u32, StarType)> {
    if g.kind != DocumentKind::Save {
        return Vec::new();
    }
    let mut ranked: Vec<(Rank, u32, StarType)> = star_types(g, resolve)
        .into_iter()
        .enumerate()
        .filter_map(|(i, t)| t.rank(needle).map(|r| (r, as_u32(i), t)))
        .collect();
    ranked.sort_unstable_by_key(|&(rank, id, _)| (rank, id));
    ranked
}

/// The galaxy's star types by their first key. Classes the resolver names alike are one type.
fn star_types(g: &GalaxyGraph, resolve: NameResolver<'_>) -> Vec<StarType> {
    let mut by_class: BTreeMap<&str, Vec<u32>> = BTreeMap::new();
    for s in g.systems.values().filter(|s| !s.star_class.is_empty()) {
        by_class.entry(&s.star_class).or_default().push(s.id);
    }
    let mut types: Vec<StarType> = Vec::new();
    let mut by_name: BTreeMap<String, usize> = BTreeMap::new();
    for (class, systems) in by_class {
        let name = resolve(class).filter(|n| !n.trim().is_empty());
        let alike = name.as_ref().and_then(|n| by_name.get(n).copied());
        if let Some(i) = alike {
            types[i].classes.push(class.to_owned());
            types[i].systems.extend(systems);
            continue;
        }
        if let Some(name) = &name {
            by_name.insert(name.clone(), types.len());
        }
        types.push(StarType {
            classes: vec![class.to_owned()],
            systems,
            name,
        });
    }
    for t in &mut types {
        t.systems.sort_unstable();
    }
    types
}

impl StarType {
    /// The best rank of the query against the type. One letter matches a letter class only,
    /// which a letter or colour query matches exactly; a key or name matches at a word start.
    fn rank(&self, needle: &str) -> Option<Rank> {
        let core: Vec<&str> = needle
            .split(|c: char| c.is_whitespace() || c == '-')
            .filter(|w| !w.is_empty() && !FILLER.contains(w))
            .collect();
        let core = core.join(" ");
        let letter = self
            .classes
            .iter()
            .any(|c| letter_of(c).is_some_and(|l| l == core))
            .then_some(Rank::Exact);
        if needle.chars().count() < 2 {
            return letter;
        }
        let colour = COLOURS
            .iter()
            .filter(|(_, classes)| self.classes.iter().any(|c| classes.contains(&c.as_str())))
            .filter_map(|(word, _)| rank(word, &core).filter(|&r| r <= Rank::Prefix))
            .min();
        let by_key = self
            .classes
            .iter()
            .filter_map(|c| rank(&shown_key(c).to_lowercase(), needle))
            .min();
        let by_name = self
            .name
            .as_deref()
            .and_then(|name| rank(&name.trim().to_lowercase(), needle));
        let words = by_key
            .into_iter()
            .chain(by_name)
            .filter(|&r| r <= Rank::WordStart);
        letter.into_iter().chain(colour).chain(words).min()
    }

    pub(super) fn hit(&self, id: u32) -> SearchHit {
        let class = &self.classes[0];
        SearchHit {
            name_key: shown_key(class),
            system_count: Some(as_u32(self.systems.len())),
            star_class: Some(class.clone()),
            systems: Some(self.systems.clone()),
            ..SearchHit::new(SearchKind::StarType, id, NameTemplate::plain(class), None)
        }
    }
}

/// `g` for `sc_g`; `None` for a class whose key is not one letter.
fn letter_of(class: &str) -> Option<&str> {
    let rest = class.strip_prefix("sc_")?;
    (rest.len() == 1 && rest.chars().all(|c| c.is_ascii_alphabetic())).then_some(rest)
}

/// The class key as shown without game data: `m giant` for `sc_m_giant`.
fn shown_key(class: &str) -> String {
    class
        .strip_prefix("sc_")
        .unwrap_or(class)
        .replace('_', " ")
        .trim()
        .to_owned()
}
