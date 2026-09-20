#![allow(dead_code)]

pub mod scripts;

use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use sgf_gamedata::install::discovery::find_install;
use sgf_gamedata::{GameData, LoadOptions, Phase};

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");

pub fn fixture(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(rel)
}

/// The synthetic install with its two loadable mods and one missing one.
pub fn load_fixture(mods: bool) -> GameData {
    let opts = LoadOptions {
        install: Some(fixture("install")),
        user_dir: Some(fixture("userdata")),
        language: "english".to_owned(),
        mods,
    };
    let mut phases = Vec::new();
    let gd = sgf_gamedata::load(&opts, &mut |p| phases.push(p)).expect("fixture loads");
    assert_eq!(
        phases,
        [Phase::Discover, Phase::Definitions, Phase::Localisation]
    );
    gd
}

/// The synthetic install without mods, parsed once and shared by every test
/// that only reads it. Tests that need different `LoadOptions` call
/// [`load_fixture`] directly for a fresh load.
pub fn cached_fixture() -> &'static GameData {
    static FIXTURE: LazyLock<GameData> = LazyLock::new(|| load_fixture(false));
    &FIXTURE
}

/// The synthetic install with its mod layer, parsed once and shared by
/// every test that only reads it.
pub fn cached_fixture_with_mods() -> &'static GameData {
    static FIXTURE: LazyLock<GameData> = LazyLock::new(|| load_fixture(true));
    &FIXTURE
}

/// Whether this machine has a Stellaris install. Without one the tests that
/// need it return green, which is what happens on CI; `SGF_REQUIRE_INSTALL`
/// turns that skip into a failure.
pub fn have_install() -> bool {
    if find_install(None).is_ok() {
        return true;
    }
    let required = std::env::var_os("SGF_REQUIRE_INSTALL").is_some_and(|v| !v.is_empty());
    assert!(
        !required,
        "SGF_REQUIRE_INSTALL is set and no Stellaris install was found: \
         the tests that read one would have asserted nothing",
    );
    false
}

/// The real Stellaris install, vanilla only. `None`, with a message, when
/// this machine has none.
pub fn load_real() -> Option<GameData> {
    if !have_install() {
        eprintln!("skipped: no Stellaris install");
        return None;
    }
    let opts = LoadOptions {
        mods: false,
        ..LoadOptions::default()
    };
    sgf_gamedata::load(&opts, &mut |_| {}).ok()
}
