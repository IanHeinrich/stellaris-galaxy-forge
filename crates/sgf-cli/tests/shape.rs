//! `sgf shape`.
use crate::common::{SAMPLE, SAMPLE_4_5, ok, sgf, stdout};

#[test]
fn shape_diff_lists_the_keys_one_game_version_added_and_dropped() {
    let out = sgf(&[
        "shape",
        "--diff",
        SAMPLE,
        SAMPLE_4_5,
        "--section",
        "country,galactic_object,galaxy",
    ]);
    ok(&out);
    let text = stdout(&out);
    assert!(
        text.contains(
            "
+ country/#/flag/use_map_color
"
        ),
        "{text}"
    );
    assert!(
        text.contains(
            "
+ galactic_object/#/arm
"
        ),
        "{text}"
    );
    assert!(
        text.contains(
            "
- galaxy/design
"
        ),
        "{text}"
    );
    assert!(
        text.ends_with(
            "
3 sections differ
"
        ),
        "{text}"
    );
    assert!(
        !text.contains(
            "
planets
"
        ),
        "{text}"
    );
}
