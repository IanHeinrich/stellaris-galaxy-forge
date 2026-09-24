use std::fmt;

const RELEASE_URL: &str = "https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/tag/v";
const CHANGELOG_URL: &str =
    "https://github.com/IanHeinrich/stellaris-galaxy-forge/blob/main/CHANGELOG.md";
// Steam's change note buffer, NUL included.
const MAX_CHANGE_NOTE_BYTES: usize =
    steamworks::sys::k_cchPublishedDocumentChangeDescriptionMax as usize - 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Version(u32, u32, u32);

impl Version {
    pub fn parse(text: &str) -> Option<Version> {
        let mut parts = text.trim().split('.').map(|part| part.parse().ok());
        let version = Version(parts.next()??, parts.next()??, parts.next()??);
        parts.next().is_none().then_some(version)
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}.{}.{}", self.0, self.1, self.2)
    }
}

struct Section<'a> {
    version: Version,
    body: Vec<&'a str>,
}

/// The change note for moving from `since` to `current`, or an error when
/// CHANGELOG.md has no section for `current`.
pub fn change_note(changelog: &str, since: Version, current: Version) -> Result<String, String> {
    let mut sections: Vec<Section> = sections(changelog)
        .into_iter()
        .filter(|section| section.version > since && section.version <= current)
        .collect();
    if !sections.iter().any(|section| section.version == current) {
        return Err(format!("CHANGELOG.md has no section for {current}"));
    }
    sections.sort_by_key(|section| std::cmp::Reverse(section.version));

    let rendered: Vec<String> = sections
        .iter()
        .map(|section| format!("[h2]{}[/h2]\n{}", section.version, to_bbcode(&section.body)))
        .collect();
    let note = (0..=rendered.len())
        .rev()
        .map(|kept| assemble(&rendered[..kept], current, kept < rendered.len()))
        .find(|note| note.len() <= MAX_CHANGE_NOTE_BYTES)
        .expect("the note with no sections fits");
    Ok(note)
}

fn assemble(sections: &[String], current: Version, cut: bool) -> String {
    let mut parts = sections.to_vec();
    parts.push(format!(
        "[url={RELEASE_URL}{current}]{RELEASE_URL}{current}[/url]"
    ));
    if cut {
        parts.push(format!(
            "Earlier versions: [url={CHANGELOG_URL}]{CHANGELOG_URL}[/url]"
        ));
    }
    parts.join("\n\n")
}

fn sections(changelog: &str) -> Vec<Section<'_>> {
    let mut sections = Vec::new();
    let mut current: Option<Section> = None;
    for line in changelog.lines() {
        if line.starts_with("## ") {
            sections.extend(current.take());
            current = heading_version(line).map(|version| Section {
                version,
                body: Vec::new(),
            });
        } else if let Some(section) = current.as_mut() {
            section.body.push(line);
        }
    }
    sections.extend(current);
    sections
}

fn heading_version(line: &str) -> Option<Version> {
    let rest = line.strip_prefix("## [")?;
    let (version, after) = rest.split_once(']')?;
    if !(after.is_empty() || after.starts_with(' ')) {
        return None;
    }
    Version::parse(version)
}

enum Block {
    Heading(String),
    List(Vec<String>),
    Paragraph(String),
}

fn to_bbcode(body: &[&str]) -> String {
    blocks(body)
        .iter()
        .map(|block| match block {
            Block::Heading(text) => format!("[h3]{}[/h3]", inline(text)),
            Block::List(items) => {
                let items: Vec<String> = items
                    .iter()
                    .map(|item| format!("[*]{}", inline(item)))
                    .collect();
                format!("[list]\n{}\n[/list]", items.join("\n"))
            }
            Block::Paragraph(text) => inline(text),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn blocks(body: &[&str]) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut open: Option<Block> = None;
    for line in body {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            blocks.extend(open.take());
        } else if let Some(heading) = trimmed.strip_prefix("### ") {
            blocks.extend(open.take());
            blocks.push(Block::Heading(heading.trim().to_string()));
        } else if let Some(item) = line.strip_prefix("- ") {
            match open.as_mut() {
                Some(Block::List(items)) => items.push(item.trim().to_string()),
                _ => {
                    blocks.extend(open.take());
                    open = Some(Block::List(vec![item.trim().to_string()]));
                }
            }
        } else {
            match open.as_mut() {
                Some(Block::List(items)) if line.starts_with(char::is_whitespace) => {
                    append(items.last_mut().expect("a list has an item"), trimmed)
                }
                Some(Block::Paragraph(text)) => append(text, trimmed),
                _ => {
                    blocks.extend(open.take());
                    open = Some(Block::Paragraph(trimmed.to_string()));
                }
            }
        }
    }
    blocks.extend(open);
    blocks
}

fn append(text: &mut String, line: &str) {
    text.push(' ');
    text.push_str(line);
}

fn inline(text: &str) -> String {
    bold(&links(text)).replace('`', "")
}

fn links(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('[') {
        let Some((label, url, after)) = link_at(&rest[start..]) else {
            out.push_str(&rest[..=start]);
            rest = &rest[start + 1..];
            continue;
        };
        out.push_str(&rest[..start]);
        out.push_str(&format!("[url={url}]{label}[/url]"));
        rest = after;
    }
    out.push_str(rest);
    out
}

fn link_at(text: &str) -> Option<(&str, &str, &str)> {
    let (label, rest) = text.strip_prefix('[')?.split_once("](")?;
    let (url, after) = rest.split_once(')')?;
    (!label.contains('[')).then_some((label, url, after))
}

fn bold(text: &str) -> String {
    let parts: Vec<&str> = text.split("**").collect();
    let paired_markers = (parts.len() - 1) / 2 * 2;
    let mut out = String::from(parts[0]);
    for (i, part) in parts.iter().enumerate().skip(1) {
        if i <= paired_markers {
            out.push_str(if i % 2 == 1 { "[b]" } else { "[/b]" });
        } else {
            out.push_str("**");
        }
        out.push_str(part);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHANGELOG: &str = include_str!("../../../CHANGELOG.md");

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    #[test]
    fn versions_parse_and_order() {
        assert!(v("0.12.0") > v("0.11.1"));
        assert!(v("0.10.0") > v("0.9.9"));
        assert_eq!(Version::parse("Unreleased"), None);
        assert_eq!(Version::parse("1.2"), None);
        assert_eq!(Version::parse("1.2.3.4"), None);
        assert_eq!(v("0.12.0").to_string(), "0.12.0");
    }

    #[test]
    fn converts_the_0_12_0_section() {
        let note = change_note(CHANGELOG, v("0.11.1"), v("0.12.0")).unwrap();
        let expected = "\
[h2]0.12.0[/h2]
[h3]Added[/h3]
[list]
[*]A system's stars can be edited in a save: type and size per star, or one star class for several selected systems at once.
[*]Binary and trinary systems show each of their stars on the map.
[*]In a Stellaris 4.5 save, an empire's map colours can be picked from its inspector page.
[*]The inspector has a Back button, and fields you can edit have an outlined style.
[/list]
[h3]Changed[/h3]
[list]
[*]The L-Gate outcome is hidden again each time you open a save.
[/list]
[h3]Fixed[/h3]
[list]
[*]Hyperlanes can be added and removed in saves from Stellaris 3.4 to 3.9.
[*]Waystations no longer clutter the whole-galaxy view or get dimmed under empire territories.
[/list]

[url=https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/tag/v0.12.0]https://github.com/IanHeinrich/stellaris-galaxy-forge/releases/tag/v0.12.0[/url]";
        assert_eq!(note, expected);
    }

    #[test]
    fn includes_every_version_since_the_last_upload_newest_first() {
        let note = change_note(CHANGELOG, v("0.10.1"), v("0.12.0")).unwrap();
        let headings: Vec<&str> = note.lines().filter(|l| l.starts_with("[h2]")).collect();
        assert_eq!(
            headings,
            ["[h2]0.12.0[/h2]", "[h2]0.11.1[/h2]", "[h2]0.11.0[/h2]"]
        );
        assert!(note.ends_with("releases/tag/v0.12.0[/url]"));
    }

    #[test]
    fn stops_at_the_current_version_and_ignores_unreleased() {
        let note = change_note(CHANGELOG, v("0.11.0"), v("0.11.1")).unwrap();
        assert!(note.starts_with("[h2]0.11.1[/h2]\n[h3]Changed[/h3]"));
        assert!(!note.contains("0.12.0"));
        assert!(!note.contains("raw Markdown"));
    }

    #[test]
    fn a_version_missing_from_the_changelog_is_an_error() {
        let error = change_note(CHANGELOG, v("0.12.0"), v("99.0.0")).unwrap_err();
        assert_eq!(error, "CHANGELOG.md has no section for 99.0.0");
    }

    #[test]
    fn a_long_note_drops_the_oldest_sections_and_links_the_changelog() {
        let bullet = format!("- {}\n", "x".repeat(1000));
        let changelog: String = (1..=5)
            .rev()
            .map(|minor| {
                format!(
                    "## [0.{minor}.0] - 2026-01-01\n\n### Added\n\n{}\n",
                    bullet.repeat(3)
                )
            })
            .collect();
        let note = change_note(&changelog, v("0.0.1"), v("0.5.0")).unwrap();
        assert!(note.len() <= 7999, "{} bytes", note.len());
        let headings: Vec<&str> = note.lines().filter(|l| l.starts_with("[h2]")).collect();
        assert_eq!(headings, ["[h2]0.5.0[/h2]", "[h2]0.4.0[/h2]"]);
        assert!(note.ends_with(
            "releases/tag/v0.5.0[/url]\n\nEarlier versions: [url=https://github.com/IanHeinrich/stellaris-galaxy-forge/blob/main/CHANGELOG.md]https://github.com/IanHeinrich/stellaris-galaxy-forge/blob/main/CHANGELOG.md[/url]"
        ));
    }

    #[test]
    fn a_note_that_fits_has_no_changelog_link() {
        let note = change_note(CHANGELOG, v("0.9.0"), v("0.12.0")).unwrap();
        assert!(note.len() <= 7999);
        assert!(!note.contains("CHANGELOG.md"));
    }

    #[test]
    fn converts_links_bold_and_backticks() {
        let changelog = "\
## [1.0.0] - 2026-01-01

A [guide](https://example.com/guide) with **bold** and `code`.

### Added

- `sgf export` names a [scenario](https://example.com/s) after
  the output file, **always**.
";
        let note = change_note(changelog, v("0.9.0"), v("1.0.0")).unwrap();
        let body: Vec<&str> = note.lines().skip(1).take(5).collect();
        assert_eq!(
            body,
            [
                "A [url=https://example.com/guide]guide[/url] with [b]bold[/b] and code.",
                "[h3]Added[/h3]",
                "[list]",
                "[*]sgf export names a [url=https://example.com/s]scenario[/url] after the output file, [b]always[/b].",
                "[/list]",
            ]
        );
    }

    #[test]
    fn unpaired_markup_is_left_alone() {
        assert_eq!(inline("a ** b [c] (d) [e]"), "a ** b [c] (d) [e]");
    }
}
