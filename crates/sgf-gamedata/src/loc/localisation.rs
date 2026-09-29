//! `localisation/**/*_l_<lang>.yml`: display names by key. The files are
//! not YAML (`docs/game-data-notes.md`, "Localisation"); each entry is one
//! line, ` key:0 "text"`, read by position of the first and closing `"`.

use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

use crate::Diagnostic;
use crate::install::layers::Layout;

const MAX_REF_DEPTH: usize = 8;

#[derive(Debug, Default)]
pub struct Localisation {
    map: HashMap<String, String>,
    resolved: Mutex<HashMap<String, String>>,
    /// The display text of a key, which every caller of [`Self::get`] wants.
    display: Mutex<HashMap<String, String>>,
    pub language: String,
    /// The requested language had no files at all, so every entry is English.
    pub fell_back: bool,
}

impl Localisation {
    /// English first, then every file of `language` over it, so a key the
    /// language lacks still resolves; within each pass later files win and
    /// `replace/` files win over all.
    pub(crate) fn load(layout: &Layout, language: &str, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let mut map = HashMap::new();
        let mut languages = vec!["english"];
        if language != "english" {
            languages.push(language);
        }
        let mut fell_back = false;
        for lang in languages {
            let (normal, replace) = layout.localisation_files(lang);
            fell_back = lang == language && normal.is_empty() && replace.is_empty();
            for file in normal.iter().chain(&replace) {
                match fs::read(file) {
                    Ok(bytes) => parse_into(&mut map, &String::from_utf8_lossy(&bytes)),
                    Err(e) => diagnostics.push(Diagnostic::Unreadable {
                        file: file.clone(),
                        reason: e.to_string(),
                    }),
                }
            }
        }
        Self {
            map,
            resolved: Mutex::default(),
            display: Mutex::default(),
            language: language.to_owned(),
            fell_back,
        }
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    /// The raw entry, references and markup intact.
    pub fn raw(&self, key: &str) -> Option<&str> {
        self.map.get(key).map(String::as_str)
    }

    /// The display text of `key`, when it has any.
    pub fn name(&self, key: &str) -> Option<String> {
        self.get(key).filter(|text| !text.is_empty())
    }

    /// The display text of `key`, or the key made readable when it has none.
    pub fn name_or_readable(&self, key: &str) -> String {
        self.name(key).unwrap_or_else(|| Self::readable(key))
    }

    /// `star_lifting_system` as `Star Lifting System`.
    pub fn readable(key: &str) -> String {
        key.split('_')
            .filter(|word| !word.is_empty())
            .map(|word| {
                let mut chars = word.chars();
                chars
                    .next()
                    .map(|first| first.to_uppercase().chain(chars).collect::<String>())
                    .unwrap_or_default()
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    /// The display text: `$ref$` resolved, icon, colour and scope markup
    /// removed, whitespace trimmed. Memoised, as the callers ask for the
    /// same key once per system or per row.
    pub fn get(&self, key: &str) -> Option<String> {
        if let Some(done) = self
            .display
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
        {
            return Some(done.clone());
        }
        let resolved = self.resolve_key(key, &mut Vec::new())?;
        let text = strip_markup(&resolved, Scopes::Drop).trim().to_owned();
        self.display
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key.to_owned(), text.clone());
        Some(text)
    }

    /// The text of a description, when it has any: as [`Self::get`], but a
    /// `[scope.GetName]` substitution reads as what it names, such as "this
    /// planet", where a name drops it.
    pub fn description(&self, key: &str) -> Option<String> {
        let resolved = self.resolve_key(key, &mut Vec::new())?;
        let text = strip_markup(&resolved, Scopes::StandIn).trim().to_owned();
        (!text.is_empty()).then_some(text)
    }

    /// `key`'s entry with references substituted and markup intact.
    pub(crate) fn resolved(&self, key: &str) -> Option<String> {
        self.resolve_key(key, &mut Vec::new())
    }

    /// `key`'s entry with references substituted. A reference to a key on
    /// the current chain, or deeper than [`MAX_REF_DEPTH`], stays literal;
    /// only fully resolved entries are memoised.
    fn resolve_key<'a>(&'a self, key: &'a str, chain: &mut Vec<&'a str>) -> Option<String> {
        if let Some(done) = self
            .resolved
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
        {
            return Some(done.clone());
        }
        let raw = self.raw(key)?;
        if !raw.contains('$') {
            return Some(raw.to_owned());
        }
        chain.push(key);
        let (text, complete) = self.substitute(raw, chain);
        chain.pop();
        if complete {
            self.resolved
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(key.to_owned(), text.clone());
        }
        Some(text)
    }

    fn substitute<'a>(&'a self, text: &'a str, chain: &mut Vec<&'a str>) -> (String, bool) {
        let mut out = String::with_capacity(text.len());
        let mut complete = true;
        let mut rest = text;
        while let Some(start) = rest.find('$') {
            let Some(len) = rest[start + 1..].find('$') else {
                break;
            };
            let literal = &rest[start..start + len + 2];
            let inner = &rest[start + 1..start + 1 + len];
            let key = inner.split('|').next().unwrap_or(inner);
            out.push_str(&rest[..start]);
            let blocked = chain.contains(&key) || chain.len() >= MAX_REF_DEPTH;
            match (blocked, is_key(key)) {
                (false, true) => match self.resolve_key(key, chain) {
                    Some(value) if !is_number_format(&value) => out.push_str(&value),
                    _ => out.push_str(literal),
                },
                (true, true) => {
                    complete = false;
                    out.push_str(literal);
                }
                (_, false) => out.push_str(literal),
            }
            rest = &rest[start + len + 2..];
        }
        out.push_str(rest);
        (out, complete)
    }
}

/// A sequential-name number format (`name_system_l_english.yml`): a digit format in
/// parentheses or a conditional one with `def:` rules. `$ORD$ Fleet` keeps its placeholder
/// for the caller to render with the fleet's number.
fn is_number_format(value: &str) -> bool {
    let v = value.trim_start_matches("-1,").trim_start();
    (v.starts_with('(') && v.contains(":(")) || v.contains("def:")
}

fn is_key(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
}

fn parse_into(map: &mut HashMap<String, String>, text: &str) {
    for line in text.trim_start_matches('\u{feff}').lines() {
        if let Some((key, value)) = parse_line(line) {
            map.insert(key.to_owned(), value);
        }
    }
}

/// ` key:0 "text" # comment` → `(key, text)`; headers, comments and blank
/// lines are `None`. The value closes at the first `"` that only whitespace
/// or a `#` comment follows, so inner quotes survive.
fn parse_line(line: &str) -> Option<(&str, String)> {
    let line = line.trim_start();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let (key, rest) = line.split_once(':')?;
    let key = key.trim_end();
    if key.is_empty() || key.contains(char::is_whitespace) {
        return None;
    }
    let first = rest.find('"')?;
    if !rest[..first].trim().chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let body = &rest[first + 1..];
    let close = body.match_indices('"').map(|(i, _)| i).find(|&i| {
        let after = body[i + 1..].trim_start();
        after.is_empty() || after.starts_with('#')
    })?;
    Some((key, unescape(&body[..close])))
}

fn unescape(value: &str) -> String {
    if !value.contains('\\') {
        return value.to_owned();
    }
    value.replace("\\n", "\n").replace("\\\"", "\"")
}

/// What [`strip_markup`] does with a `[scope.Expression]` substitution, which
/// has no scope to fill it from.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scopes {
    /// Remove it, as a name wants.
    Drop,
    /// Put a stand-in for what it names, as running text wants.
    StandIn,
}

/// Remove `£icon£` and `§X` … `§!` colour codes, keeping the text around and
/// inside colour spans, and `[…]` substitutions without a space, or put a
/// stand-in for one as `scopes` says.
pub(crate) fn strip_markup(text: &str, scopes: Scopes) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        match c {
            '£' => {
                let rest = &text[i + c.len_utf8()..];
                match rest.find('£') {
                    Some(end) => skip_to(&mut chars, i + c.len_utf8() + end + '£'.len_utf8()),
                    None => out.push(c),
                }
            }
            '§' => {
                chars.next();
            }
            '[' => {
                let rest = &text[i + 1..];
                match rest.find(']') {
                    Some(end) if end > 0 && !rest[..end].contains(char::is_whitespace) => {
                        let close = i + 1 + end + 1;
                        let taken = (scopes == Scopes::StandIn)
                            .then(|| stand_in(&rest[..end]))
                            .flatten()
                            .map_or(0, |word| push_stand_in(&mut out, word, &text[close..]));
                        skip_to(&mut chars, close + taken);
                    }
                    _ => out.push(c),
                }
            }
            _ => out.push(c),
        }
    }
    out
}

/// The scopes that say nothing of what they hold, so a name read through only
/// these is "it".
const BARE_SCOPES: [&str; 10] = [
    "root",
    "this",
    "from",
    "fromfrom",
    "fromfromfrom",
    "prev",
    "prevprev",
    "target",
    "recipient",
    "actor",
];

/// What a `[From.Planet.GetName]`-style expression reads as without a scope:
/// a pronoun, else the kind of name its function or nearest scope gives, else
/// "it" when it reads only [`BARE_SCOPES`]. `None` for what is to go: an
/// expression without a scope such as `[GetDate]`, one whose function gives no
/// name such as `[miner.GetIcon]`, a name through a scope saved under a name of
/// its own such as `[artisan.GetName]`, and what is not an expression, such as
/// `['concept_pops']`.
fn stand_in(expression: &str) -> Option<&'static str> {
    let expression = expression.split('|').next()?;
    let parts: Vec<String> = expression
        .split('.')
        .map(|part| {
            let part = part.to_ascii_lowercase();
            part.strip_prefix("event_target:")
                .map_or(part.clone(), str::to_owned)
        })
        .collect();
    let valid = |part: &String| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | ':'))
    };
    if !parts.iter().all(valid) {
        return None;
    }
    let (function, scopes) = parts.split_last()?;
    if scopes.is_empty() {
        return None;
    }
    match function.as_str() {
        "gethisher" | "getherhis" => return Some("their"),
        "getheshe" | "getshehe" => return Some("they"),
        "gethimher" | "getherhim" => return Some("them"),
        "getplanetmoon" => return Some("planet"),
        _ => {}
    }
    let names = ["name", "nameplural", "names"]
        .iter()
        .any(|end| function.ends_with(end));
    if !names {
        return None;
    }
    let kind = function.strip_prefix("get").unwrap_or(function);
    scope_stand_in(kind)
        .or_else(|| scopes.iter().rev().find_map(|scope| scope_stand_in(scope)))
        .or_else(|| {
            let bare = |scope: &String| BARE_SCOPES.contains(&scope.as_str());
            scopes.iter().all(bare).then_some("it")
        })
}

fn scope_stand_in(scope: &str) -> Option<&'static str> {
    Some(match scope {
        s if s.contains("species") => "this species",
        s if s.contains("leader") || s.contains("scientist") => "your scientist",
        s if s.contains("ruler") || s.contains("regnal") => "your ruler",
        s if s.contains("system") => "this system",
        s if s.contains("planet") || s.contains("homeworld") || s == "capital" => "this planet",
        s if s.contains("country") || s.contains("empire") || s == "owner" || s == "controller" => {
            "your empire"
        }
        _ => return None,
    })
}

/// `word` after `out`, read into the text around it: "the [x] system" is
/// "this system", "the [x]" is "it", "[x]'s" is "its", and a sentence's first
/// word is capitalised.
/// Returns how many bytes of `after` it took.
fn push_stand_in(out: &mut String, word: &str, after: &str) -> usize {
    if word == "it" || word.contains(' ') {
        drop_article(out);
    }
    let (word, taken) = match word.split_once(' ') {
        Some((determiner, noun)) => {
            let repeated = after
                .trim_start_matches("§!")
                .strip_prefix(' ')
                .and_then(|rest| rest.strip_prefix(noun))
                .is_some_and(|rest| !rest.starts_with(char::is_alphanumeric));
            (if repeated { determiner } else { word }, 0)
        }
        None if word == "it" && after.starts_with("'s") => ("its", 2),
        None => (word, 0),
    };
    let before = out.trim_end_matches([' ', '\t']);
    if before.is_empty() || before.ends_with(['.', '!', '?', '\n']) {
        let mut chars = word.chars();
        if let Some(first) = chars.next() {
            out.extend(first.to_uppercase());
            out.push_str(chars.as_str());
        }
    } else {
        out.push_str(word);
    }
    taken
}

/// A trailing "the ", which "it" and a stand-in with its own determiner do
/// not take.
fn drop_article(out: &mut String) {
    for article in ["the ", "The "] {
        if let Some(kept) = out.strip_suffix(article)
            && !kept.ends_with(char::is_alphanumeric)
        {
            let len = kept.len();
            out.truncate(len);
            return;
        }
    }
}

fn skip_to(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>, offset: usize) {
    while chars.peek().is_some_and(|&(i, _)| i < offset) {
        chars.next();
    }
}
