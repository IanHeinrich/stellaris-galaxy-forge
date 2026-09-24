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
  `01-*.png`, `02-*.png` and so on. `carousel/source/` holds the same
  images without captions, and `carousel/label.py` captions them from
  `carousel/captions.json`. The uploader only looks at the images
  directly in `carousel/`.
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

## Adding a carousel image

`label.py` needs Python with Pillow (`py -m pip install Pillow`),
ffmpeg on `PATH` for GIFs, and the Segoe UI fonts that come with
Windows. Run these steps from the repo root.

1. Record or screenshot the app.
2. Put the uncaptioned file in `workshop/carousel/source/` with the next
   number, for example `16-paint-export.png`.
3. Add an entry for it to the end of `workshop/carousel/captions.json`:
   `{"file": "16-paint-export", "caption": "Export for Paint a Galaxy", "tag": "scenario", "style": "strip"}`.
   `file` is the file name without its extension.
4. Run `py workshop/carousel/label.py`. It builds only the images that
   are not in `carousel/` yet, so the uploaded ones keep their bytes.
   `--preview` writes to a temporary folder instead and prints where,
   and `--force <file>` (or `--force all`) rebuilds an image that
   already exists.
5. Open the new image in `workshop/carousel/` and look at it.
6. `cargo workshop push`.

Map views, and every GIF, use the `overlay` style: the caption sits
bottom left on the image. Screenshots of a panel or a menu use `strip`:
the caption goes in a dark band added below the image. The hero GIF uses
`none`, with no caption and no tag, and is copied as it is.

The tag says what a feature works on: `save` for a `.sav` file,
`scenario` for a scenario script, and `both` for either.

Steam refuses any image over 1 MB. Use a PNG for a still and a GIF for a
recording. `label.py` fits a GIF under the limit by lowering its frame
rate and then its width, and prints what it chose. A PNG over the limit
is an error, so crop the screenshot.

To reorder the carousel, renumber the files in both `carousel/` and
`carousel/source/`, and rename and reorder the entries in
`captions.json` to match. Renaming a file without changing its bytes or
its place in the order does not count as a change to the uploader.
