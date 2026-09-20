//! The backups a save leaves beside the file: `<file name>.bak-YYYYmmdd-HHMMSS[-n]`, capped
//! per file at the original, the newest few and a spread of the rest.

use std::fs;
use std::path::{Path, PathBuf};

use time::macros::format_description;
use time::{Date, Month, OffsetDateTime, PrimitiveDateTime, Time};

pub(crate) const NEWEST: usize = 3;
pub(crate) const SPREAD: usize = 4;

struct Backup {
    instant: i64,
    n: u32,
    path: PathBuf,
}

pub(crate) fn path_for(path: &Path) -> PathBuf {
    let now = OffsetDateTime::now_local().unwrap_or_else(|_| OffsetDateTime::now_utc());
    let stamp = now
        .format(format_description!(
            "[year][month][day]-[hour][minute][second]"
        ))
        .unwrap_or_else(|_| "unknown".to_owned());
    let base = path.file_name().map(|n| n.to_owned()).unwrap_or_default();
    // Never reuse a backup name: a second save in the same second must not
    // overwrite the only copy of the original.
    let mut n = 0u32;
    loop {
        let mut name = base.clone();
        name.push(format!(".bak-{stamp}"));
        if n > 0 {
            name.push(format!("-{n}"));
        }
        let candidate = path.with_file_name(name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Delete the backups of `path` in excess of the cap, thinning the densest stretch first.
pub(crate) fn prune(path: &Path) {
    let mut backups = backups_of(path);
    if backups.len() <= 1 + SPREAD + NEWEST {
        return;
    }
    // The original is the only copy of what the user started from, and the newest are
    // what they most likely want back, so only the stretch between them is thinned.
    let recent = backups.split_off(backups.len() - NEWEST);
    let original = backups.remove(0);
    let mut middle = backups;
    while middle.len() > SPREAD {
        let gap = |i: usize| {
            let before = if i == 0 { &original } else { &middle[i - 1] };
            let after = middle.get(i + 1).unwrap_or(&recent[0]);
            after.instant - before.instant
        };
        let densest = (0..middle.len())
            .min_by_key(|&i| gap(i))
            .expect("middle is not empty");
        let _ = fs::remove_file(middle.remove(densest).path);
    }
}

fn backups_of(path: &Path) -> Vec<Backup> {
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return Vec::new();
    };
    let prefix = format!("{name}.bak-");
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut backups: Vec<Backup> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|entry| {
            let file_name = entry.file_name();
            let (instant, n) = parse_stamp(file_name.to_str()?.strip_prefix(&prefix)?)?;
            Some(Backup {
                instant,
                n,
                path: entry.path(),
            })
        })
        .collect();
    backups.sort_by_key(|b| (b.instant, b.n));
    backups
}

/// `YYYYmmdd-HHMMSS` or `YYYYmmdd-HHMMSS-N` as (unix seconds, N).
fn parse_stamp(stamp: &str) -> Option<(i64, u32)> {
    let (date, rest) = stamp.split_at_checked(8)?;
    let (clock, rest) = rest.strip_prefix('-')?.split_at_checked(6)?;
    if !date
        .bytes()
        .chain(clock.bytes())
        .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let n = match rest {
        "" => 0,
        suffix => suffix
            .strip_prefix('-')
            .filter(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))?
            .parse()
            .ok()?,
    };
    let field = |s: &str| s.parse::<u8>().ok();
    let date = Date::from_calendar_date(
        date[..4].parse().ok()?,
        Month::try_from(field(&date[4..6])?).ok()?,
        field(&date[6..])?,
    )
    .ok()?;
    let time = Time::from_hms(
        field(&clock[..2])?,
        field(&clock[2..4])?,
        field(&clock[4..])?,
    )
    .ok()?;
    let instant = PrimitiveDateTime::new(date, time)
        .assume_utc()
        .unix_timestamp();
    Some((instant, n))
}
