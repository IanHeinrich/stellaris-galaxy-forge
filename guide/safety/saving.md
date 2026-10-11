---
title: Save, back up and restore
description: Save your edits, find the backups Galaxy Forge keeps, and put the original save back.
aliases: [save, save as, backup, bak, restore, original save, undo save, revert, overwrite, changed on disk, reload, edited in another editor, vs code, keep my changes]
---
# Save, back up and restore

Each time Galaxy Forge saves over a file, it keeps the file that was
there as a backup. The earliest backup is the file as it was before
Galaxy Forge first saved over it.

## Save your edits

<kbd>Ctrl</kbd>+<kbd>S</kbd> saves to the file you opened. "Save as…"
(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) saves somewhere else.
Only the parts you changed are rewritten. Everything else is copied
unchanged.

If the file has changed on disk since you opened or last saved it,
Galaxy Forge asks before overwriting it. See
[Save says the file changed on disk](../reference/troubleshooting.md#save-says-the-file-changed-on-disk).

## When the file changes on disk

Galaxy Forge notices when another program saves the file you have open,
such as your text editor or Stellaris. Its own saves don't count.

- A scenario with no unsaved changes reloads by itself. The status bar
  says "Reloaded my_galaxy.txt after it changed on disk."
- A scenario with unsaved changes shows a bar under the top bar.
  "Reload" reads the file again. Your unsaved changes and their undo
  history are lost. "Keep my changes" leaves your edits as they are.
  The status bar then shows "Changed on disk" until you save, and Save
  asks whether to overwrite the other version.
- A save always asks, with or without unsaved changes, because Stellaris
  may have saved over it. "Not now" leaves the save as you opened it.
- If the file was moved or deleted, the status bar says so. Save writes
  it again.

Galaxy Forge also checks the file when you switch back to its window.

When the map has [issues](issues.md), Save asks "Save this map?" first.
"Save anyway" saves the map as it is. "View issues" opens the Issues tab
and pauses the save. The tab then shows its own "Save anyway" button.
Cancel writes nothing.

## Find the backups

The backups sit beside the file, named `<name>.sav.bak-<date>-<time>`,
such as `2250.03.14.sav.bak-20261008-143205`. A scenario's backups
follow the same rule, with `.txt` in place of `.sav`.

- A backup is made whenever a save replaces a file. That includes
  "Save as…" over an existing file, and "Overwrite" when the game
  changed the file.
- A save that changes nothing writes nothing and makes no backup.
- Up to eight backups are kept per file: the earliest, the three newest
  and four spread across the rest.
- The earliest is never removed to make room. It stays until you move
  or delete it.

## Restore the original

Move the edited `.sav` somewhere else. Then copy the earliest backup and
rename the copy to `<name>.sav`.
