//! The 4.5 sample edited as text before it opens, and the entity texts the tests read back.
use sgf_core::entity::views::EntityKind;
use sgf_core::session::Session;

use super::{SAMPLE_4_5, entity_text, open_edited_sample};

/// The 4.5 sample's capital system, Alari: star 0, the capital 2 with its moon 3, barren
/// planet 4 and gas giant 6. Of 2, 4 and 6 only the capital has a `flags` block, and 4 has
/// no moons. Country 0 owns it and lists no megastructure.
pub const ALARI: u32 = 169;

/// The 4.5 sample with `edit` applied to its gamestate.
pub fn open_4_5_edited(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE_4_5, |gamestate, _| edit(gamestate))
}

/// `text` with `insert` written after the last of `anchors`, each found from where the one
/// before starts.
#[track_caller]
pub fn insert_after(text: &mut String, anchors: &[&str], insert: &str) {
    let mut start = 0;
    let mut end = 0;
    for anchor in anchors {
        start += text[start..]
            .find(anchor)
            .unwrap_or_else(|| panic!("{anchor:?}"));
        end = start + anchor.len();
    }
    text.insert_str(end, insert);
}

/// A row of the top-level `megastructures`, `kind` in `system` with `tie` among its keys,
/// written after the last.
pub fn megastructure_row(text: &mut String, id: u32, kind: &str, system: u32, tie: &str) {
    insert_after(
        text,
        &["\nmegastructures=\n{\n", "\t16777231=none\n"],
        &format!(
            "\t{id}=\n\t{{\n\t\ttype=\"{kind}\"\n\t\tcoordinate=\n\t\t{{\n\t\t\tx=10\n\t\t\ty=20\n\t\t\torigin={system}\n\t\t}}\n{tie}\t\torbitals=\n\t\t{{\n\t\t}}\n\t\tbuild_queue=4294967295\n\t\tdismantle_progress=0\n\t\tdismantle_finish_date=\"0.01.01\"\n\t}}\n"
        ),
    );
}

/// System `id`'s text as it stands.
pub fn system_text(session: &Session, id: u32) -> String {
    entity_text(session, EntityKind::System, id)
}

/// Planet `id`'s text as it stands.
pub fn planet_text(session: &Session, id: u32) -> String {
    entity_text(session, EntityKind::Planet, id)
}
