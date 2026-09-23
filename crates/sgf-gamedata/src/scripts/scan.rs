//! One pass over a script file's bytes, collecting the flags, event targets
//! and event calls it names, each with the line it sits on and the depth-0
//! block that owns it.
//!
//! Reading the CST of every `events/` file would cost far more than the few
//! keys this needs, so the file is walked as bytes: braces are counted,
//! `#` comments and quoted strings skipped, `\n` tallied.

/// Which directory a file came from; it decides what a hit is owned by and
/// how an event call is described.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dir {
    Initializers,
    Effects,
    Events,
    OnActions,
}

/// Keys that *read* a flag, and so name the system carrying it. Setting a
/// flag is not a reference to anyone: vanilla has over a hundred
/// `set_star_flag = empire_cluster` sites, and none of them has anything to
/// say about a particular system. Where a token is first saved is read from
/// the chain's own CST instead ([`crate::scripts::chain::Chain`]).
const TRACKED: [&str; 4] = [
    "has_star_flag",
    "remove_star_flag",
    "has_global_flag",
    "has_country_flag",
];

/// Keys that set or clear a global flag. They name no system, so they are
/// kept apart from [`TRACKED`], for the game-wide outcomes a flag decides.
const GLOBAL_WRITES: [&str; 2] = ["set_global_flag", "remove_global_flag"];

pub(crate) const EVENT_TARGET: &str = "event_target";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawHit {
    /// The depth-0 key that owns the hit; an event block yields its `id`.
    pub owner: String,
    pub verb: &'static str,
    pub token: String,
    pub line: u32,
}

/// A depth-0 `event = { … }` block, so the claim walk can reach the event
/// the on_actions name without scanning the directory a second time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawEvent {
    pub id: String,
    /// Byte offset of the block's `{`.
    pub offset: usize,
    pub line: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RawFired {
    pub event: String,
    pub by: String,
}

#[derive(Debug, Default)]
pub(crate) struct Scan {
    pub hits: Vec<RawHit>,
    pub global_writes: Vec<RawHit>,
    pub fired: Vec<RawFired>,
    pub events: Vec<RawEvent>,
}

pub(crate) fn scan(src: &[u8], dir: Dir) -> Scan {
    Walk::new(src, dir).run()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tok<'a> {
    Word(&'a str),
    Eq,
    Open,
    Close,
    /// A comparison operator, or a word that is not UTF-8.
    Other,
}

struct Lexer<'a> {
    src: &'a [u8],
    at: usize,
    line: u32,
}

impl<'a> Lexer<'a> {
    fn new(src: &'a [u8]) -> Self {
        Self {
            src,
            at: 0,
            line: 1,
        }
    }

    fn next(&mut self) -> Option<(Tok<'a>, u32, usize)> {
        loop {
            let byte = *self.src.get(self.at)?;
            let at = self.at;
            match byte {
                b'\n' => {
                    self.line += 1;
                    self.at += 1;
                }
                b' ' | b'\t' | b'\r' => self.at += 1,
                b'#' => {
                    while self.at < self.src.len() && self.src[self.at] != b'\n' {
                        self.at += 1;
                    }
                }
                b'{' => return Some((self.punct(Tok::Open), self.line, at)),
                b'}' => return Some((self.punct(Tok::Close), self.line, at)),
                b'=' => return Some((self.punct(Tok::Eq), self.line, at)),
                b'<' | b'>' | b'!' | b'?' => return Some((self.punct(Tok::Other), self.line, at)),
                b'"' => {
                    let (tok, line) = self.quoted();
                    return Some((tok, line, at));
                }
                _ => {
                    let (tok, line) = self.bare();
                    return Some((tok, line, at));
                }
            }
        }
    }

    fn punct(&mut self, tok: Tok<'a>) -> Tok<'a> {
        self.at += 1;
        tok
    }

    fn quoted(&mut self) -> (Tok<'a>, u32) {
        let line = self.line;
        self.at += 1;
        let start = self.at;
        while self.at < self.src.len() && self.src[self.at] != b'"' {
            if self.src[self.at] == b'\n' {
                self.line += 1;
            }
            self.at += 1;
        }
        let text = &self.src[start..self.at];
        self.at = (self.at + 1).min(self.src.len());
        (word(text), line)
    }

    fn bare(&mut self) -> (Tok<'a>, u32) {
        let line = self.line;
        let start = self.at;
        while self.at < self.src.len() && !is_delimiter(self.src[self.at]) {
            self.at += 1;
        }
        (word(&self.src[start..self.at]), line)
    }
}

fn word(bytes: &[u8]) -> Tok<'_> {
    std::str::from_utf8(bytes).map_or(Tok::Other, Tok::Word)
}

fn is_delimiter(byte: u8) -> bool {
    matches!(
        byte,
        b' ' | b'\t' | b'\r' | b'\n' | b'{' | b'}' | b'=' | b'<' | b'>' | b'!' | b'?' | b'#' | b'"'
    )
}

struct Walk<'a> {
    lexer: Lexer<'a>,
    dir: Dir,
    out: Scan,
    /// The key of each open block, outermost first.
    frames: Vec<Option<&'a str>>,
    /// The last bare word; a key until `=` or `{` claims it.
    last: Option<(&'a str, u32)>,
    /// The key of a `key =` still waiting for its value.
    key: Option<(&'a str, u32)>,
    top: String,
    event_id: Option<String>,
    /// Where the open depth-0 block starts, and the line its key sits on.
    top_at: usize,
    top_line: u32,
    hits: Vec<RawHit>,
    writes: Vec<RawHit>,
    calls: Vec<String>,
}

impl<'a> Walk<'a> {
    fn new(src: &'a [u8], dir: Dir) -> Self {
        Self {
            lexer: Lexer::new(src),
            dir,
            out: Scan::default(),
            frames: Vec::new(),
            last: None,
            key: None,
            top: String::new(),
            event_id: None,
            top_at: 0,
            top_line: 1,
            hits: Vec::new(),
            writes: Vec::new(),
            calls: Vec::new(),
        }
    }

    fn run(mut self) -> Scan {
        while let Some((tok, line, at)) = self.lexer.next() {
            match tok {
                Tok::Eq => self.key = self.last.take(),
                Tok::Open => self.open(at, line),
                Tok::Close => self.close(),
                Tok::Word(w) => self.word(w, line),
                Tok::Other => {
                    self.last = None;
                    self.key = None;
                }
            }
        }
        self.out
    }

    fn open(&mut self, at: usize, line: u32) {
        let opener = self.key.take().or_else(|| self.last.take());
        self.last = None;
        if self.frames.is_empty() {
            self.top = opener.map_or_else(String::new, |(w, _)| w.to_owned());
            self.top_at = at;
            self.top_line = opener.map_or(line, |(_, w_line)| w_line);
            self.event_id = None;
            self.hits.clear();
            self.writes.clear();
            self.calls.clear();
        }
        self.frames.push(opener.map(|(w, _)| w));
    }

    fn close(&mut self) {
        self.frames.pop();
        self.last = None;
        self.key = None;
        if self.frames.is_empty() {
            self.flush();
        }
    }

    fn word(&mut self, text: &'a str, line: u32) {
        if let Some((key, key_line)) = self.key.take() {
            self.assign(key, text, key_line);
            self.last = None;
        } else {
            self.bare(text, line);
            self.last = Some((text, line));
        }
    }

    fn bare(&mut self, text: &str, line: u32) {
        if let Some(token) = text.strip_prefix("event_target:") {
            self.hit(EVENT_TARGET, token, line);
        }
        if self.dir == Dir::OnActions && self.frames.last().copied().flatten() == Some("events") {
            self.calls.push(text.to_owned());
        }
    }

    fn assign(&mut self, key: &str, value: &'a str, line: u32) {
        if let Some(verb) = TRACKED.iter().find(|v| **v == key) {
            self.hit(verb, value, line);
        }
        if let Some(verb) = GLOBAL_WRITES.iter().find(|v| **v == key)
            && let Some(write) = self.raw(verb, value, line)
        {
            self.writes.push(write);
        }
        if key == "flag"
            && let Some(verb) = self
                .frames
                .last()
                .copied()
                .flatten()
                .and_then(|parent| TRACKED.iter().find(|v| **v == parent))
        {
            self.hit(verb, value, line);
        }
        if key == "id" {
            if self.frames.len() == 1 && self.dir == Dir::Events {
                self.event_id = Some(value.to_owned());
            } else if self.frames.last().copied().flatten().is_some_and(is_event) {
                self.calls.push(value.to_owned());
            }
        }
        self.bare(value, line);
    }

    fn hit(&mut self, verb: &'static str, token: &str, line: u32) {
        if let Some(hit) = self.raw(verb, token, line) {
            self.hits.push(hit);
        }
    }

    fn raw(&self, verb: &'static str, token: &str, line: u32) -> Option<RawHit> {
        (!token.is_empty() && !self.frames.is_empty()).then(|| RawHit {
            owner: String::new(),
            verb,
            token: token.to_owned(),
            line,
        })
    }

    fn flush(&mut self) {
        let event_id = self.event_id.take();
        if let Some(id) = event_id.clone() {
            self.out.events.push(RawEvent {
                id,
                offset: self.top_at,
                line: self.top_line,
            });
        }
        let owner = event_id.unwrap_or_else(|| self.top.clone());
        for mut hit in self.hits.drain(..) {
            hit.owner.clone_from(&owner);
            self.out.hits.push(hit);
        }
        for mut write in self.writes.drain(..) {
            write.owner.clone_from(&owner);
            self.out.global_writes.push(write);
        }
        let by = caller(self.dir, &owner);
        for event in self.calls.drain(..) {
            self.out.fired.push(RawFired {
                event,
                by: by.clone(),
            });
        }
    }
}

fn is_event(key: &str) -> bool {
    key == "event" || key.ends_with("_event")
}

fn caller(dir: Dir, owner: &str) -> String {
    match dir {
        Dir::OnActions => owner.to_owned(),
        Dir::Events => format!("from event {owner}"),
        Dir::Effects => format!("from effect {owner}"),
        Dir::Initializers => format!("from initializer {owner}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    type Hit = (String, &'static str, String, u32);

    fn hits(src: &str, dir: Dir) -> Vec<Hit> {
        scan(src.as_bytes(), dir)
            .hits
            .into_iter()
            .map(|h| (h.owner, h.verb, h.token, h.line))
            .collect()
    }

    fn one(owner: &str, verb: &'static str, token: &str, line: u32) -> Hit {
        (owner.to_owned(), verb, token.to_owned(), line)
    }

    #[test]
    fn a_hash_inside_a_quoted_string_does_not_start_a_comment() {
        let src = "e = {\n\tset_name = \"Gate # 7\"\n\thas_star_flag = beacon\n}\n";
        assert_eq!(
            hits(src, Dir::Initializers),
            [one("e", "has_star_flag", "beacon", 3)]
        );
    }

    #[test]
    fn a_quote_inside_a_comment_does_not_open_a_string() {
        let src = "e = {\n\t# it's \"half quoted\n\thas_star_flag = beacon\n}\n";
        assert_eq!(
            hits(src, Dir::Initializers),
            [one("e", "has_star_flag", "beacon", 3)]
        );
    }

    #[test]
    fn crlf_and_a_missing_final_newline_read_the_same_as_plain_lf() {
        let lf = "e = {\n\thas_star_flag = beacon\n}";
        let crlf = "e = {\r\n\thas_star_flag = beacon\r\n}\r\n";
        assert_eq!(hits(lf, Dir::Initializers), hits(crlf, Dir::Initializers));
        assert_eq!(
            hits(lf, Dir::Initializers),
            [one("e", "has_star_flag", "beacon", 2)]
        );
    }

    #[test]
    fn nested_braces_in_a_random_list_keep_the_owning_block() {
        let src = "e = {\n\trandom_list = {\n\t\t10 = { has_star_flag = a }\n\t\t20 = { modifier = { factor = 0 } has_star_flag = b }\n\t}\n}\n";
        assert_eq!(
            hits(src, Dir::Initializers),
            [
                one("e", "has_star_flag", "a", 3),
                one("e", "has_star_flag", "b", 4)
            ]
        );
    }

    #[test]
    fn tabs_around_the_equals_sign_still_find_the_event_target() {
        let src = "e = {\n\tset_owner\t=\tevent_target:x\n}\n";
        assert_eq!(
            hits(src, Dir::Initializers),
            [one("e", EVENT_TARGET, "x", 2)]
        );
    }

    #[test]
    fn setting_a_flag_is_never_a_reference() {
        let src = "e = {\n\tset_star_flag = beacon\n\tset_global_flag = seen\n\tset_planet_flag = home\n}\n";
        assert!(hits(src, Dir::Initializers).is_empty());
    }

    #[test]
    fn every_depth_zero_event_reports_where_its_block_starts() {
        let src = "namespace = fx\nevent = {\n\tid = fx.1\n\timmediate = { every_system = { } }\n}\n\nevent = {\n\tid = fx.2\n}\n";
        let scanned = scan(src.as_bytes(), Dir::Events);
        let found: Vec<(&str, u32)> = scanned
            .events
            .iter()
            .map(|e| (e.id.as_str(), e.line))
            .collect();
        assert_eq!(found, [("fx.1", 2), ("fx.2", 7)]);
        for event in &scanned.events {
            assert_eq!(src.as_bytes()[event.offset], b'{');
        }
    }

    #[test]
    fn a_block_that_is_not_an_event_reports_none() {
        let src = "e = {\n\tid = not_an_event\n}\n";
        assert!(scan(src.as_bytes(), Dir::Initializers).events.is_empty());
        assert!(scan(src.as_bytes(), Dir::OnActions).events.is_empty());
    }

    #[test]
    fn an_event_owns_its_hits_by_id_and_an_on_action_lists_what_it_fires() {
        let event = "namespace = fx\nevent = {\n\tid = fx.1\n\ttrigger = { has_star_flag = beacon }\n\timmediate = { country_event = { id = fx.2 days = 3 } }\n}\n";
        let scanned = scan(event.as_bytes(), Dir::Events);
        assert_eq!(scanned.hits[0].owner, "fx.1");
        assert_eq!(scanned.hits[0].line, 4);
        assert_eq!(scanned.fired.len(), 1);
        assert_eq!(scanned.fired[0].event, "fx.2");
        assert_eq!(scanned.fired[0].by, "from event fx.1");

        let on_action = "on_game_start = {\n\tevents = {\n\t\tfx.1 # a comment\n\t}\n}\n";
        let scanned = scan(on_action.as_bytes(), Dir::OnActions);
        assert_eq!(scanned.fired[0].event, "fx.1");
        assert_eq!(scanned.fired[0].by, "on_game_start");
    }
}
