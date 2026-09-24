# Steam Workshop page

Galaxy Forge has a page on the Stellaris Workshop (item 3805578137) so
players can find it. The item carries no mod, only a descriptor and a
thumbnail. This folder holds the page, and the uploader keeps Steam in
step with it.

- `description.bbcode`: the description, in Steam's BBCode.
- `preview.png`: the main image. It also goes up in the item's content
  as `thumbnail.png`, so it has to stay a PNG.
- `content/`: the item's files, uploaded beside `preview.png`.
  `descriptor.mod` is the only one now.
- `carousel/`: the extra images, shown in file-name order, so name them
  `01-*.png`, `02-*.png` and so on.
- `images/`: the images the description shows inline. Steam loads them
  from `main` on GitHub, so merge a new image before pushing a
  description that uses it. The uploader does not upload these.
- `uploader/`: the tool.

Images uploaded to Steam must be PNG, JPEG or GIF and at most 1 MB. The
description can be up to 7999 bytes of UTF-8.

## Running it

Run it from the repo root on Windows, with the Steam client open and
logged in as the item's owner. `cargo workshop` is an alias in
`.cargo/config.toml` for running the uploader:

```
cargo workshop <command>
```

- `pull` writes the live description and images into this folder. It
  downloads everything first, and refuses to change or remove a local
  file that differs from Steam's copy unless given `--force`.
- `init` records the current images and `VERSION` in the item's hidden
  metadata as what was last uploaded. It uploads nothing else, and
  refuses if the item already has that record unless given `--force`.
- `push` shows what differs from the last upload: the description,
  the main image, the carousel as a whole. When `VERSION` has moved,
  it also shows the change note, made from the changelog sections since
  the last push. It asks before uploading. `--dry-run` only shows,
  `--yes` skips the question, and `--force` uploads everything.
- `backfill <x.y.z>` posts one change note per released version from
  that one up to the last push, oldest first, so the newest ends up on
  top. Steam dates each note the day it is posted, so every heading
  carries the release date from the changelog. It asks first, and takes
  `--dry-run` and `--yes` like `push`.

Steam only shows a change note on the Change Notes tab when the content
changes. So every upload that carries a change note also uploads the
content, with the descriptor's `version` set to that release. `push`
does this when `VERSION` has moved, and `backfill` does it once per
version. `--dry-run` lists each upload that would carry content.

`--item <id>` picks another item.

## First use

1. `pull`.
2. Check what it wrote, and fix anything that came down wrong.
3. Commit the folder.
4. `init`.

After that, run `push` once each GitHub Release is out, or whenever the
page changes.
