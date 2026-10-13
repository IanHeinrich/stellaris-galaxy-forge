use super::Session;
use crate::format::scenario::effect;
use crate::ops::{Op, OpError, Plan};
use crate::search;
use crate::views::{SearchKind, SearchResult};

impl Session {
    /// A scenario system's own `effect = { … }` block and the line it starts on.
    pub fn scenario_system_effect(&self, id: u32) -> Option<(String, u32)> {
        effect::system_effect(&self.doc, id)
    }

    /// Every scenario system carrying an `effect = { … }` block, in file order: its id,
    /// the block's text and the line it starts on. A save document has none.
    pub fn scenario_system_effects(&self) -> Vec<(u32, String, u32)> {
        effect::system_effects(&self.doc)
    }

    /// Systems, countries, planets, fleets, nebulae and star types matching `query` by id,
    /// key or resolved name; see [`search::search`].
    ///
    /// Planets and fleets are only searched once the details projection is built, which
    /// search never does itself: it runs under the session lock, and building parses about
    /// half the file. The app calls [`Session::warm_details`] after a save opens. A document
    /// whose layouts are rolled has no star types: a system there has a star class only when
    /// its initializer fixes one, so a count would leave out every star the game draws at
    /// random.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        resolve: search::NameResolver<'_>,
        special: search::SpecialLabels<'_>,
    ) -> SearchResult {
        let mut result = search::search(
            &self.graph,
            self.built_details().as_deref(),
            &self.stars,
            query,
            limit,
            resolve,
            special,
        );
        if self.rolls_stars() {
            result.hits.retain(|hit| hit.kind != SearchKind::StarType);
        }
        result
    }

    /// Why `op` would be refused, or `None` when it would apply. Nothing is written: the op
    /// is planned against the session and dropped. A batch is refused, since its members
    /// after the first would be planned against a session none of them had changed, and so
    /// is an op with a second step, which is planned against its first.
    pub fn check_op(&self, op: &Op) -> Option<String> {
        if matches!(op, Op::Batch { .. }) {
            return Some("a batch cannot be checked: check each of its ops".to_owned());
        }
        if let Err(error) = op.check_kind(self.kind()) {
            return Some(error.to_string());
        }
        if let Err(error) = op.check_sendable() {
            return Some(error.to_string());
        }
        if op.reach().follow_up {
            return Some(format!(
                "{} cannot be checked: its second step needs its first applied",
                op.name()
            ));
        }
        self.refusal(op).map(|error| error.to_string())
    }

    /// The error the format refuses `op` with, planned against the session as it is, or
    /// `None` when it would apply. Nothing is written. Unlike [`Self::check_op`], it plans any
    /// op it is given, so a caller checking a batch or a two-step op owns what that means.
    pub fn refusal(&self, op: &Op) -> Option<OpError> {
        self.format().write(&mut Plan::new(), self, op).err()
    }
}
