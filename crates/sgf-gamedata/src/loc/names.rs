//! Templated names (`NameTemplate`) as the game shows them: the key's
//! localisation with its `$slot$`s filled from the template's variables, plus
//! the two formats the engine resolves in code, `%SEQ%` and `%ACRONYM%`.

use sgf_core::emit::roman;
use sgf_core::projections::galaxy::display_name;
use sgf_core::projections::name::NameTemplate;

use crate::Localisation;

const MAX_DEPTH: usize = 8;
/// The game's sequential name: `fmt` is a key whose text holds a number format placeholder,
/// `num` the number.
const SEQUENTIAL_KEY: &str = "%SEQ%";
/// The game's ship prefix: the acronym of the name its `base` variable holds.
const ACRONYM_KEY: &str = "%ACRONYM%";
/// The game's species or empire adjective: `adjective` names the noun, `1` the word it
/// qualifies.
const ADJECTIVE_KEY: &str = "%ADJECTIVE%";
/// `adj_NN<ending>` turns a noun into an adjective by its last letters, and `adj_format`
/// places an adjective that has no `$1$` slot.
const ADJECTIVE_PATTERN: &str = "adj_NN";
const ADJECTIVE_FORMAT: &str = "adj_format";
const ADJECTIVE_SLOT: &str = "$1$";

impl Localisation {
    /// The text the game shows for a templated name: the key's localisation with every
    /// `$name$` placeholder replaced by the variable of that name, then the variables no
    /// placeholder consumed appended in order. Without game data the caller shows
    /// [`NameTemplate::stand_in`] instead.
    pub fn resolve_template(&self, name: &NameTemplate) -> String {
        self.resolve(name, 0)
    }

    fn resolve(&self, template: &NameTemplate, depth: usize) -> String {
        if template.literal {
            return template.key.clone();
        }
        if template.key == SEQUENTIAL_KEY {
            let fmt = variable(template, "fmt").map_or("", |v| v.key.as_str());
            let num = variable(template, "num")
                .map_or("0", |v| v.key.as_str())
                .parse()
                .unwrap_or(0);
            let format = self.get(fmt).unwrap_or_else(|| display_name(fmt));
            return sequential(&format, num);
        }
        if template.key == ACRONYM_KEY {
            return variable(template, "base")
                .map_or_else(String::new, |base| acronym(&self.resolve(base, depth + 1)));
        }
        let adjective = (template.key == ADJECTIVE_KEY).then(|| variable(template, "adjective"));
        let entry = match adjective {
            Some(Some(noun)) if depth < MAX_DEPTH => self.adjective(noun, depth + 1),
            Some(_) => ADJECTIVE_SLOT.to_owned(),
            None => format_key(&template.key)
                .map(str::to_owned)
                .or_else(|| self.get(&template.key))
                .unwrap_or_else(|| display_name(&template.key)),
        };
        if depth >= MAX_DEPTH {
            return collapse(&fill(&entry, |_| String::new()));
        }
        let text = self.restore_slots(&entry, template);
        let mut consumed: Vec<&str> = if adjective.is_some() {
            vec!["adjective"]
        } else {
            Vec::new()
        };
        let filled = fill(&text, |name| match variable(template, name) {
            Some(value) => {
                consumed.push(name);
                self.resolve(value, depth + 1)
            }
            None => String::new(),
        });
        let rest = template
            .variables
            .iter()
            .filter(|v| !consumed.contains(&v.name.as_str()))
            .map(|v| self.resolve(&v.value, depth + 1));
        collapse(
            &[filled]
                .into_iter()
                .chain(rest)
                .collect::<Vec<_>>()
                .join(" "),
        )
    }

    /// The adjective for `noun`, with its `$1$` slot: the noun's own `_adj` entry when it
    /// has one, else the noun through the install's `adj_NN` ending patterns.
    fn adjective(&self, noun: &NameTemplate, depth: usize) -> String {
        if !noun.literal && noun.variables.is_empty() {
            let explicit = self
                .get(&format!("{}_adj", noun.key))
                .filter(|text| !text.is_empty());
            if let Some(text) = explicit {
                return self.with_adjective_slot(text);
            }
        }
        self.adjectivize(&self.resolve(noun, depth))
    }

    /// The pattern for the noun's last two letters, else its last letter, else the
    /// zero-letter one. The matched ending is dropped and the rest takes the `*`. A noun
    /// no pattern matches stays as it is.
    fn adjectivize(&self, noun: &str) -> String {
        let letters: Vec<char> = noun.chars().collect();
        for ending_len in [2, 1, 0] {
            let Some(split) = letters.len().checked_sub(ending_len) else {
                continue;
            };
            let ending = letters[split..].iter().collect::<String>().to_lowercase();
            if let Some(pattern) = self.raw(&format!("{ADJECTIVE_PATTERN}{ending}")) {
                return pattern.replace('*', &letters[..split].iter().collect::<String>());
            }
        }
        self.with_adjective_slot(noun.to_owned())
    }

    fn with_adjective_slot(&self, adjective: String) -> String {
        if adjective.contains(ADJECTIVE_SLOT) {
            return adjective;
        }
        let format = self.raw(ADJECTIVE_FORMAT).unwrap_or("adj $1$");
        format.replacen("adj", &adjective, 1)
    }

    /// A `$NAME$` slot whose name is itself a localisation key (`NAME`, `PLANET`, `SYSTEM`)
    /// arrives already filled with that entry's generic text, so put the slot back before
    /// filling it from the template's own variables.
    fn restore_slots(&self, text: &str, template: &NameTemplate) -> String {
        let mut out = text.to_owned();
        for var in &template.variables {
            let slot = format!("${}$", var.name);
            if out.contains(&slot) {
                continue;
            }
            let Some(word) = self.get(&var.name).filter(|w| !w.is_empty()) else {
                continue;
            };
            let mut found = out.find(&word);
            while let Some(at) = found {
                if stands_alone(&out, at, word.len()) {
                    break;
                }
                let next = at + out[at..].chars().next().map_or(1, char::len_utf8);
                found = out[next..].find(&word).map(|i| next + i);
            }
            if let Some(at) = found {
                out = format!("{}{slot}{}", &out[..at], &out[at + word.len()..]);
            }
        }
        out
    }
}

/// Format keys the game resolves in code rather than through localisation.
fn format_key(key: &str) -> Option<&'static str> {
    match key {
        "%ADJ%" => Some("$1$"),
        _ => None,
    }
}

fn variable<'a>(template: &'a NameTemplate, name: &str) -> Option<&'a NameTemplate> {
    template
        .variables
        .iter()
        .find(|v| v.name == name)
        .map(|v| &v.value)
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Replace every `$name$` with what `value` makes of `name`. A name is never empty, so
/// the first `$` of a `$$` is text and the second one opens a placeholder.
fn fill<'t>(text: &'t str, mut value: impl FnMut(&'t str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('$') {
        let Some(len) = rest[start + 1..].find('$') else {
            break;
        };
        if len == 0 {
            out.push_str(&rest[..start + 1]);
            rest = &rest[start + 1..];
            continue;
        }
        out.push_str(&rest[..start]);
        out.push_str(&value(&rest[start + 1..start + 1 + len]));
        rest = &rest[start + len + 2..];
    }
    out.push_str(rest);
    out
}

fn stands_alone(text: &str, at: usize, len: usize) -> bool {
    let word = |c: char| c.is_alphanumeric() || c == '_';
    !text[..at].chars().next_back().is_some_and(word)
        && !text[at + len..].chars().next().is_some_and(word)
}

/// `$ORD$ Fleet` with 2 → `2nd Fleet`: the number formats of `name_system_l_english.yml`
/// (`C`/`CC`/`CCC` cardinals, `CC0` zero-based, `R` roman, `HEX`, `ORD`/`ORD0` ordinals, `N`
/// plain), in English; an unknown format shows the plain number.
fn sequential(format: &str, num: i64) -> String {
    fill(format, |name| match name {
        "CC" => format!("{num:0>2}"),
        "CCC" => format!("{num:0>3}"),
        "CC0" => format!("{:0>2}", num - 1),
        "R" => roman(usize::try_from(num).unwrap_or(0)),
        "HEX" => format!("{num:x}"),
        "ORD" => ordinal(num),
        "ORD0" => ordinal(num - 1),
        _ => num.to_string(),
    })
}

fn ordinal(num: i64) -> String {
    let suffix = match (num % 100, num % 10) {
        (11..=13, _) => "th",
        (_, 1) => "st",
        (_, 2) => "nd",
        (_, 3) => "rd",
        _ => "th",
    };
    format!("{num}{suffix}")
}

/// `%ACRONYM%`, the engine's ship prefix: the initials of the base name's capitalised
/// words ("United Nations of Earth" → "UNE").
fn acronym(base: &str) -> String {
    base.split_whitespace()
        .filter_map(|word| word.chars().next())
        .filter(|c| c.is_uppercase())
        .collect()
}
