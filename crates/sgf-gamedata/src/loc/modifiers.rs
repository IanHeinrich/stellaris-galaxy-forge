//! A modifier line as a tooltip shows it: `district_farming_max_add = 3` is
//! "+3 Max Agriculture Districts".

use sgf_core::projections::galaxy::display_name;

use crate::Localisation;
use crate::loc::localisation::strip_markup;

/// The engine flags percentage modifiers in code, not in the script files; these are the
/// endings and beginnings of the ones it shows as a percentage.
const PERCENT_PREFIXES: [&str; 1] = ["habitability_"];
const PERCENT_SUFFIXES: [&str; 8] = [
    "_mult",
    "_perc",
    "_speed",
    "_happiness",
    "_tolerance",
    "_damage",
    "_exp_gain",
    "_reduction",
];

impl Localisation {
    /// `key = value` as one tooltip line: the signed amount, then the modifier's name.
    pub fn modifier_line(&self, key: &str, value: f64) -> String {
        format!(
            "{} {}",
            modifier_amount(key, value),
            self.modifier_name(key)
        )
    }

    /// The `mod_<key>` (or `MOD_<KEY>`) entry with its references filled and markup
    /// removed. A leading resource icon becomes the resource's name when the text does
    /// not already start with it ("£exotic_gases£ Produced per 100" is "Exotic Gases
    /// Produced per 100"). Without an entry, the key in words.
    pub fn modifier_name(&self, key: &str) -> String {
        let Some(text) = self
            .resolved(&format!("mod_{key}"))
            .or_else(|| self.resolved(&format!("MOD_{}", key.to_uppercase())))
        else {
            return display_name(key);
        };
        let text = self.fill_job_names(&text);
        let (icon, rest) = leading_icon(text.trim_start());
        let label = collapse(&strip_markup(rest));
        let icon_name = icon
            .and_then(|icon| self.get(icon))
            .filter(|name| !name.is_empty() && !starts_with_ignoring_case(&label, name));
        match icon_name {
            Some(name) if label.is_empty() => name,
            Some(name) => format!("{name} {label}"),
            None => label,
        }
    }

    /// `[GetFarmerSwapPluralWithIcon]` or `[farmer.GetNamePlural]` as the job's plural
    /// name. The engine fills these in per planet; other expressions are left for
    /// [`strip_markup`] to remove.
    fn fill_job_names(&self, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut rest = text;
        while let Some(start) = rest.find('[') {
            let Some(len) = rest[start..].find(']') else {
                break;
            };
            out.push_str(&rest[..start]);
            let expression = &rest[start + 1..start + len];
            match job_key(expression).and_then(|key| self.get(&key)) {
                Some(name) => out.push_str(&name),
                None => out.push_str(&rest[start..=start + len]),
            }
            rest = &rest[start + len + 1..];
        }
        out.push_str(rest);
        out
    }
}

/// The value as the game prints it: signed, a percentage for the modifiers it shows as
/// one, at most two decimals.
pub fn modifier_amount(key: &str, value: f64) -> String {
    let percent = PERCENT_SUFFIXES.iter().any(|suffix| key.ends_with(suffix))
        || PERCENT_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix));
    let shown = if percent { value * 100.0 } else { value };
    let rounded = (shown * 100.0).round() / 100.0;
    let digits = format!("{:.2}", rounded.abs());
    let digits = digits.trim_end_matches('0').trim_end_matches('.');
    let sign = match rounded {
        r if r > 0.0 => "+",
        r if r < 0.0 => "-",
        _ => "",
    };
    format!("{sign}{digits}{}", if percent { "%" } else { "" })
}

fn job_key(expression: &str) -> Option<String> {
    if let Some(job) = expression.strip_suffix(".GetNamePlural") {
        return Some(format!("job_{job}_plural"));
    }
    if let Some(job) = expression.strip_suffix(".GetName") {
        return Some(format!("job_{job}"));
    }
    let job = expression
        .strip_prefix("Get")?
        .strip_suffix("PluralWithIcon")?;
    let job = job.strip_suffix("Swap").unwrap_or(job);
    Some(format!("job_{}_plural", snake_case(job)))
}

fn snake_case(camel: &str) -> String {
    let mut out = String::with_capacity(camel.len() + 4);
    for (i, c) in camel.chars().enumerate() {
        if c.is_ascii_uppercase() && i > 0 {
            out.push('_');
        }
        out.push(c.to_ascii_lowercase());
    }
    out
}

/// `£name£ rest` as `(Some(name), rest)`; a `|frame` after the name is dropped.
fn leading_icon(text: &str) -> (Option<&str>, &str) {
    let Some(after) = text.strip_prefix('£') else {
        return (None, text);
    };
    match after.find('£') {
        Some(end) => {
            let icon = &after[..end];
            let icon = icon.split('|').next().unwrap_or(icon);
            (Some(icon), &after[end + '£'.len_utf8()..])
        }
        None => (None, text),
    }
}

fn starts_with_ignoring_case(text: &str, prefix: &str) -> bool {
    text.get(..prefix.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(prefix))
}

fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
