//! `sgf special-layouts`.
use crate::common::{SAMPLE_4_5, ok, sgf, stdout, without_install};

#[test]
fn special_layouts_lists_the_menus_layouts_with_what_the_save_holds() {
    let listed = sgf(&["special-layouts", SAMPLE_4_5]);
    if without_install(&listed) {
        return;
    }
    ok(&listed);
    let text = stdout(&listed);
    let wenkwort = text
        .lines()
        .find(|line| line.starts_with("wenkwort_initializer "))
        .expect("Wenkwort is listed");
    assert!(wenkwort.contains("capped"), "{wenkwort}");
    assert!(
        wenkwort.contains("in galaxy 1"),
        "the sample has one: {wenkwort}"
    );
    assert!(!text.contains("fumongus_init_01"), "{text}");
}
