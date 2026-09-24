# Steam Workshop page

Galaxy Forge has a page on the Stellaris Workshop (item 3805578137) so
players can find it. The item has no mod content. This folder holds the
page, and the uploader keeps Steam in step with it.

- `description.bbcode`: the description, in Steam's BBCode.
- `preview.png`: the main image. A JPEG works too.
- `carousel/`: the extra images, shown in file-name order, so name them
  `01-*.png`, `02-*.png` and so on.
- `images/`: the images the description shows inline. Steam loads them
  from `main` on GitHub, so merge a new image before pushing a
  description that uses it. The uploader does not upload these.
- `uploader/`: the tool.

Images uploaded to Steam must be PNG or JPEG and at most 1 MB. The
description can be up to 7999 bytes of UTF-8.

## Running it

Run it from the repo root on Windows, with the Steam client open and
logged in as the item's owner:

```
cargo run --release --manifest-path workshop/uploader/Cargo.toml -- <command>
```

- `pull` writes the live description and images into this folder. It
  downloads everything first, and refuses to change or remove a local
  file that differs from Steam's copy unless given `--force`.
- `init` records the current images and `VERSION` in the item's hidden
  metadata as what was last uploaded. It uploads nothing else, and
  refuses if the item already has that record unless given `--force`.
- `push` uploads whatever differs from the last upload: the
  description, the main image, the carousel as a whole. When `VERSION`
  has moved, it posts the changelog sections since the last push as the
  change note. `--dry-run` prints what it would do and the change note,
  and uploads nothing. `--force` uploads everything.

`--item <id>` picks another item.

## First use

1. `pull`.
2. Check what it wrote, and fix anything that came down wrong.
3. Commit the folder.
4. `init`.

After that, run `push` once each GitHub Release is out, or whenever the
page changes.
