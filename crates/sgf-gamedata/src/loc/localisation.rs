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
        let text = strip_markup(&resolved).trim().to_owned();
        self.display
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key.to_owned(), text.clone());
        Some(text)
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

/// Remove `£icon£`, `§X` … `§!` colour codes and `[scope.Expression]`
/// substitutions, keeping the text around and inside colour spans.
pub(crate) fn strip_markup(text: &str) -> String {
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
                        skip_to(&mut chars, i + 1 + end + 1);
                    }
                    _ => out.push(c),
                }
            }
            _ => out.push(c),
        }
    }
    out
}

fn skip_to(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>, offset: usize) {
    while chars.peek().is_some_and(|&(i, _)| i < offset) {
        chars.next();
    }
}
