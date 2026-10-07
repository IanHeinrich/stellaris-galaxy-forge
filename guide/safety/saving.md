---
title: Save, back up and restore
description: Save your edits, find the backups Galaxy Forge keeps, and put the original save back.
aliases: [save, save as, backup, bak, restore, original save, undo save, revert, overwrite, changed on disk]
---
# Save, back up and restore

Galaxy Forge keeps a backup every time it saves, so you can always go
back to the file you started from.

## Save your edits

<kbd>Ctrl</kbd>+<kbd>S</kbd> saves to the file you opened. "Save as…"
(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>) saves somewhere else.
Only the parts you changed are rewritten. Everything else is copied
unchanged.

If Stellaris wrote the file after you opened it, Save asks before
replacing it. See
[Save says the file changed on disk](../reference/troubleshooting.md#save-says-the-file-changed-on-disk).

When the map has [issues](issues.md), Save asks "Save this map?" first.
"Save anyway" saves the map as it is. "View issues" opens the Issues tab
and pauses the save. The tab then shows its own "Save anyway" button.
Cancel writes nothing.

## Find the backups

::: tip Backups
Each save keeps the previous file beside the new one, as
`<name>.sav.bak-<date>-<time>`. The earliest backup is the file you
originally opened. Up to eight backups are kept per file: the original,
the three newest and a spread of the rest.
:::

## Restore the original

Move or delete the edited `.sav`, then rename its earliest backup to
`<name>.sav`.
