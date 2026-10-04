//! The class menus an added body or system offers, named from the real install.

use crate::common;

use common::INSTALL;

/// `pc_gray_goo` and `pc_nanotech` are both "Nanite World" in the install, and `pc_barren` and
/// `pc_barren_cold` both "Barren World": each row of the class menu has a name of its own.
#[test]
fn no_two_body_classes_in_the_menu_share_a_name() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    for moon in [false, true] {
        let picks = gd.body_class_picks(moon);
        assert!(!picks.is_empty(), "moon {moon}");
        let mut names: Vec<&str> = picks.iter().map(|c| c.name.as_str()).collect();
        names.sort_unstable();
        let before = names.len();
        names.dedup();
        assert_eq!(before, names.len(), "moon {moon}: {names:?}");

        let name = |key: &str| picks.iter().find(|c| c.key == key).map(|c| c.name.as_str());
        assert_eq!(name("pc_gray_goo"), Some("Nanite World (pc_gray_goo)"));
        assert_eq!(name("pc_nanotech"), Some("Nanite World (pc_nanotech)"));
        assert_eq!(
            name("pc_desert"),
            Some("Desert World"),
            "a name nobody shares stays plain, from the localisation"
        );
        assert!(name("pc_ark").is_none());
        assert!(
            picks.iter().all(|c| c.min_size <= c.max_size),
            "moon {moon}"
        );
    }
}
