# `test/`

Builders and stand-ins that tests of every layer share.

Two ways to open a document in a panel test. `inspectorFixture.open(kind)`
opens the sample save or scenario through the stores and selects its first
system, which suits a test of a page under the inspector. `armSession()` from
`store/storeFixture` answers the commands any open needs, and
`test/session.openWith(result, patch)` then opens any result with fields
changed, which suits a test of a bar, menu or dialog that needs a particular
document.

To wait for an async action's effect, use `until(check)` from `test/wait`
in place of a bare `vi.waitFor`. It polls every millisecond, where
`vi.waitFor` polls every 50 ms, and works under fake timers as well.
A wait on a debounce advances fake timers instead.

To let every answer already on its way land before asserting, `await flush()`
from `test/flush`. It waits one real macrotask, so under fake timers it never
resolves: there, `await vi.advanceTimersByTimeAsync(0)` does the same.
