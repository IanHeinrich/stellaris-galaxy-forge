use crate::changelog::Version;
use crate::state::UploadedState;

/// A description and the state it was uploaded with, either live on Steam or
/// read from the local files.
pub struct Page<'a> {
    pub description: &'a str,
    pub state: &'a UploadedState,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Plan {
    pub description: bool,
    pub preview: bool,
    pub carousel: bool,
    pub version_moved: Option<(Version, Version)>,
    pub new_state: UploadedState,
}

impl Plan {
    pub fn is_empty(&self) -> bool {
        !self.description && !self.preview && !self.carousel && self.version_moved.is_none()
    }
}

pub fn plan(live: &Page, local: &Page, force: bool) -> Result<Plan, String> {
    let live_version = parse_version(&live.state.version, "the item's metadata")?;
    let local_version = parse_version(&local.state.version, "VERSION")?;
    let version_moved = (local_version > live_version).then_some((live_version, local_version));
    let new_version = if version_moved.is_some() {
        &local.state.version
    } else {
        &live.state.version
    };
    Ok(Plan {
        description: force || normalise(live.description) != normalise(local.description),
        preview: force || live.state.preview != local.state.preview,
        carousel: force || live.state.carousel != local.state.carousel,
        version_moved,
        new_state: UploadedState {
            version: new_version.clone(),
            ..local.state.clone()
        },
    })
}

fn parse_version(text: &str, source: &str) -> Result<Version, String> {
    Version::parse(text).ok_or_else(|| format!("{source} has no x.y.z version: {text:?}"))
}

pub fn normalise(description: &str) -> String {
    description
        .replace("\r\n", "\n")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

/// The URLs of the images the description embeds with `[img]URL[/img]`.
pub fn embedded_images(description: &str) -> Vec<&str> {
    let lower = description.to_ascii_lowercase();
    let mut urls = Vec::new();
    let mut from = 0;
    while let Some(open) = lower[from..]
        .find("[img]")
        .map(|i| from + i + "[img]".len())
    {
        let Some(close) = lower[open..].find("[/img]").map(|i| open + i) else {
            break;
        };
        urls.push(description[open..close].trim());
        from = close + "[/img]".len();
    }
    urls
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_embedded_images_in_order() {
        let description = "\
[h1]Galaxy Forge[/h1]
[img]https://example.com/a.gif[/img] text [IMG] https://example.com/b.png [/IMG]
[url=https://example.com]not an image[/url] [img]unclosed";
        assert_eq!(
            embedded_images(description),
            ["https://example.com/a.gif", "https://example.com/b.png"]
        );
    }

    fn state(version: &str, preview: &str, carousel: &[&str]) -> UploadedState {
        UploadedState {
            version: version.into(),
            preview: preview.into(),
            carousel: carousel.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn page<'a>(description: &'a str, state: &'a UploadedState) -> Page<'a> {
        Page { description, state }
    }

    #[test]
    fn nothing_changed_is_empty() {
        let s = state("0.12.0", "p", &["a", "b"]);
        let plan = plan(&page("text", &s), &page("text", &s), false).unwrap();
        assert!(plan.is_empty());
        assert_eq!(plan.new_state, s);
    }

    #[test]
    fn line_endings_and_trailing_whitespace_are_not_changes() {
        let s = state("0.12.0", "p", &[]);
        let live = "[h1]Title[/h1]\nLine  \nEnd";
        let local = "[h1]Title[/h1]\r\nLine\r\nEnd\r\n\r\n";
        assert!(
            plan(&page(live, &s), &page(local, &s), false)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn an_edited_description_is_uploaded_alone() {
        let s = state("0.12.0", "p", &["a"]);
        let plan = plan(&page("old", &s), &page("new", &s), false).unwrap();
        assert!(plan.description && !plan.preview && !plan.carousel);
        assert_eq!(plan.version_moved, None);
    }

    #[test]
    fn a_new_preview_image_is_uploaded() {
        let live = state("0.12.0", "old", &["a"]);
        let local = state("0.12.0", "new", &["a"]);
        let plan = plan(&page("d", &live), &page("d", &local), false).unwrap();
        assert!(!plan.description && plan.preview && !plan.carousel);
        assert_eq!(plan.new_state.preview, "new");
    }

    #[test]
    fn a_reordered_carousel_is_replaced() {
        let live = state("0.12.0", "p", &["a", "b"]);
        let local = state("0.12.0", "p", &["b", "a"]);
        let plan = plan(&page("d", &live), &page("d", &local), false).unwrap();
        assert!(plan.carousel && !plan.preview);
        assert_eq!(plan.new_state.carousel, ["b", "a"]);
    }

    #[test]
    fn a_new_version_alone_is_a_change() {
        let live = state("0.11.1", "p", &[]);
        let local = state("0.12.0", "p", &[]);
        let plan = plan(&page("d", &live), &page("d", &local), false).unwrap();
        assert!(!plan.is_empty());
        assert!(!plan.description && !plan.preview && !plan.carousel);
        assert_eq!(
            plan.version_moved,
            Some((
                Version::parse("0.11.1").unwrap(),
                Version::parse("0.12.0").unwrap()
            ))
        );
        assert_eq!(plan.new_state.version, "0.12.0");
    }

    #[test]
    fn an_older_local_version_keeps_the_uploaded_one() {
        let live = state("0.12.0", "p", &[]);
        let local = state("0.11.1", "p", &[]);
        let plan = plan(&page("d", &live), &page("d", &local), false).unwrap();
        assert!(plan.is_empty());
        assert_eq!(plan.new_state.version, "0.12.0");
    }

    #[test]
    fn force_uploads_everything_but_leaves_the_version() {
        let s = state("0.12.0", "p", &["a"]);
        let plan = plan(&page("d", &s), &page("d", &s), true).unwrap();
        assert!(plan.description && plan.preview && plan.carousel);
        assert_eq!(plan.version_moved, None);
    }

    #[test]
    fn a_bad_version_is_an_error() {
        let live = state("banana", "p", &[]);
        let local = state("0.12.0", "p", &[]);
        let error = plan(&page("d", &live), &page("d", &local), false).unwrap_err();
        assert_eq!(
            error,
            "the item's metadata has no x.y.z version: \"banana\""
        );
    }
}
