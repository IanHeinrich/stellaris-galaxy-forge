//! How often a rebuild may start, and when to stop rebuilding at all.
//! Pure over the clock: every entry point takes `now`, so the tests drive it
//! by arithmetic. Debouncing the raw file events is the debouncer's job.

use std::collections::{BTreeSet, HashMap, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use sgf_gamedata::RegistryKind;

/// The least time between the starts of two rebuilds.
const FLOOR: Duration = Duration::from_millis(2000);
/// The breaker trips on the `STARTS` th start inside this trailing window.
const WINDOW: Duration = Duration::from_secs(60);
const STARTS: usize = 10;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Idle,
    WakeAt(Instant),
    Rebuild(BTreeSet<RegistryKind>),
    Pause { file: PathBuf, count: u32 },
}

#[derive(Default)]
pub struct Guard {
    pending: BTreeSet<RegistryKind>,
    hot: HashMap<PathBuf, u32>,
    starts: VecDeque<Instant>,
    last_start: Option<Instant>,
    paused: bool,
}

impl Guard {
    /// Take a debounced batch; paused it only accumulates.
    pub fn changed(
        &mut self,
        now: Instant,
        hits: impl IntoIterator<Item = (PathBuf, RegistryKind)>,
    ) -> Action {
        self.prune(now);
        for (path, kind) in hits {
            self.pending.insert(kind);
            *self.hot.entry(path).or_default() += 1;
        }
        self.next(now)
    }

    /// The [`Action::WakeAt`] timer fired.
    pub fn wake(&mut self, now: Instant) -> Action {
        self.next(now)
    }

    /// Forget the breaker's window and rebuild whatever piled up while paused.
    pub fn resume(&mut self, now: Instant) -> Action {
        self.paused = false;
        self.starts.clear();
        self.hot.clear();
        self.next(now)
    }

    fn next(&mut self, now: Instant) -> Action {
        if self.paused || self.pending.is_empty() {
            return Action::Idle;
        }
        let ready = self.last_start.map_or(now, |start| start + FLOOR);
        if ready > now {
            return Action::WakeAt(ready);
        }
        self.prune(now);
        if self.starts.len() + 1 >= STARTS {
            self.paused = true;
            let (file, count) = self.hottest();
            return Action::Pause { file, count };
        }
        self.starts.push_back(now);
        self.last_start = Some(now);
        Action::Rebuild(std::mem::take(&mut self.pending))
    }

    fn prune(&mut self, now: Instant) {
        let had_starts = !self.starts.is_empty();
        while self.starts.front().is_some_and(|&t| now - t >= WINDOW) {
            self.starts.pop_front();
        }
        if had_starts && self.starts.is_empty() {
            self.hot.clear();
        }
    }

    fn hottest(&self) -> (PathBuf, u32) {
        self.hot
            .iter()
            .max_by(|a, b| a.1.cmp(b.1).then_with(|| b.0.cmp(a.0)))
            .map_or_else(|| (PathBuf::new(), 0), |(path, &c)| (path.clone(), c))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(base: Instant, millis: u64) -> Instant {
        base + Duration::from_millis(millis)
    }

    fn hit(name: &str, kind: RegistryKind) -> Vec<(PathBuf, RegistryKind)> {
        vec![(PathBuf::from(name), kind)]
    }

    /// Changes arriving inside the floor coalesce into a single later rebuild
    /// carrying both kinds.
    #[test]
    fn changes_inside_the_floor_coalesce_into_one_rebuild() {
        let base = Instant::now();
        let mut guard = Guard::default();

        let started = guard.changed(base, hit("a.txt", RegistryKind::Colors));
        assert_eq!(
            started,
            Action::Rebuild(BTreeSet::from([RegistryKind::Colors]))
        );

        assert_eq!(
            guard.changed(at(base, 100), hit("b.yml", RegistryKind::Localisation)),
            Action::WakeAt(at(base, 2000))
        );
        assert_eq!(
            guard.changed(at(base, 200), hit("c.txt", RegistryKind::CountryTypes)),
            Action::WakeAt(at(base, 2000))
        );
        assert_eq!(guard.wake(at(base, 1999)), Action::WakeAt(at(base, 2000)));
        assert_eq!(
            guard.wake(at(base, 2000)),
            Action::Rebuild(BTreeSet::from([
                RegistryKind::CountryTypes,
                RegistryKind::Localisation
            ]))
        );
    }

    #[test]
    fn the_tenth_start_in_a_minute_pauses_and_names_the_hottest_file() {
        let base = Instant::now();
        let mut guard = Guard::default();

        for i in 0..9 {
            let now = at(base, i * 2000);
            assert!(
                matches!(
                    guard.changed(now, hit("hot.txt", RegistryKind::Colors)),
                    Action::Rebuild(_)
                ),
                "start {i}"
            );
            guard.changed(now, hit("cold.txt", RegistryKind::Colors));
        }
        assert_eq!(
            guard.changed(at(base, 18_000), hit("hot.txt", RegistryKind::Colors)),
            Action::Pause {
                file: PathBuf::from("hot.txt"),
                count: 10,
            }
        );
        assert_eq!(
            guard.changed(at(base, 19_000), hit("hot.txt", RegistryKind::Scripts)),
            Action::Idle,
            "paused, but still accumulating"
        );
    }

    /// The window is trailing: once the ninth start has aged out, the tenth
    /// change starts a rebuild, and the counts behind the breaker start over.
    #[test]
    fn a_start_after_the_window_has_passed_rebuilds() {
        let base = Instant::now();
        let mut guard = Guard::default();

        for i in 0..9 {
            let now = at(base, i * 2000);
            guard.changed(now, hit("hot.txt", RegistryKind::Colors));
        }
        let later = at(base, 16_000 + 61_000);
        assert_eq!(
            guard.changed(later, hit("cold.txt", RegistryKind::Localisation)),
            Action::Rebuild(BTreeSet::from([RegistryKind::Localisation]))
        );
        assert_eq!(guard.hottest(), (PathBuf::from("cold.txt"), 1));
    }

    #[test]
    fn resume_rebuilds_what_piled_up_while_paused() {
        let base = Instant::now();
        let mut guard = Guard::default();

        for i in 0..9 {
            let now = at(base, i * 2000);
            guard.changed(now, hit("hot.txt", RegistryKind::Colors));
        }
        assert!(matches!(
            guard.changed(at(base, 18_000), hit("hot.txt", RegistryKind::Colors)),
            Action::Pause { .. }
        ));
        guard.changed(at(base, 19_000), hit("one.yml", RegistryKind::Localisation));

        assert_eq!(
            guard.resume(at(base, 20_000)),
            Action::Rebuild(BTreeSet::from([
                RegistryKind::Colors,
                RegistryKind::Localisation
            ]))
        );
    }
}
