import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageSequence
except ImportError:
    sys.exit('label.py needs Pillow: py -m pip install Pillow')

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'source'
CAPTIONS = HERE / 'captions.json'
LIMIT = 1_048_576
FPS_STEPS = (12, 10, 8, 6)
WIDTH_STEPS = (0.9, 0.8, 0.7, 0.6)

BOLD = r'C:\Windows\Fonts\segoeuib.ttf'
SEMI = r'C:\Windows\Fonts\seguisb.ttf'

SAVE, SCEN, BOTH = (150, 200, 255), (245, 195, 95), (210, 215, 230)
TAG = {'save': 'SAVE', 'scenario': 'SCENARIO', 'both': 'SAVE \u00b7 SCENARIO'}
STYLES = ('overlay', 'strip', 'none')


def shadowed(img, x, y, t, f):
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((x + 1, y + 2), t, font=f, fill=(0, 0, 0, 210))
    layer = layer.filter(ImageFilter.GaussianBlur(max(2, f.size / 20)))
    img = Image.alpha_composite(img, layer)
    ImageDraw.Draw(img).text((x, y), t, font=f, fill=(255, 255, 255, 255))
    return img


def tag_width(mode, fs):
    f = ImageFont.truetype(SEMI, fs)
    text = TAG[mode]
    sp = max(1, round(fs * 0.14))
    tw = sum(f.getlength(c) for c in text) + sp * (len(text) - 1)
    return tw + 2 * round(fs * 0.75)


def tag(img, left, cy, mode, fs):
    """Pill with letter-spaced caps, left edge at `left`, centred on `cy`."""
    f = ImageFont.truetype(SEMI, fs)
    text = TAG[mode]
    sp = max(1, round(fs * 0.14))
    parts = [(c, f.getlength(c)) for c in text]
    tw = sum(w for _, w in parts) + sp * (len(parts) - 1)
    padx, pady = round(fs * 0.75), round(fs * 0.45)
    th = f.getbbox('SCENARIO')[3]
    x0, x1 = left, round(left + tw + 2 * padx)
    y0, y1 = round(cy - th / 2 - pady), round(cy + th / 2 + pady)
    col = {'save': SAVE, 'scenario': SCEN, 'both': BOTH}[mode]
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        [x0, y0, x1, y1], radius=(y1 - y0) // 2,
        fill=(8, 10, 20, 200), outline=col + (235,), width=1)
    img = Image.alpha_composite(img, layer)
    d = ImageDraw.Draw(img)
    x = x0 + padx
    sep = text.find('\u00b7')
    for i, (c, w) in enumerate(parts):
        if mode == 'both':
            cc = (150, 155, 175) if i == sep else (SAVE if i < sep else SCEN)
        else:
            cc = col
        d.text((x, y0 + pady - round(fs * 0.08)), c, font=f, fill=cc + (255,))
        x += w + sp
    return img, x1


def overlay_layer(size, text, mode):
    w, h = size
    fs = round(min(w, h) * 0.07)
    f = ImageFont.truetype(BOLD, fs)
    m = round(fs * 0.6)
    bb = f.getbbox(text)
    y = h - m - bb[3] - round(fs * 0.1)
    ts = round(fs * 0.4)
    beside = m + f.getlength(text) + round(fs * 0.45)
    img = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if beside + tag_width(mode, ts) <= w - m:
        img = shadowed(img, m, y, text, f)
        img, _ = tag(img, beside, y + bb[3] * 0.56, mode, ts)
    else:
        # no room on the line: stack the tag above the label
        gap = round(ts * 2.1)
        img = shadowed(img, m, y, text, f)
        img, _ = tag(img, m, y - gap, mode, ts)
    return img


def with_strip(src, text, mode):
    w, h = src.size
    fs = max(16, round(w * 0.045))
    f = ImageFont.truetype(BOLD, fs)
    strip = round(fs * 2.2)
    out = Image.new('RGBA', (w, h + strip), (19, 24, 38, 255))
    out.paste(src.convert('RGBA'), (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, h), (w, h)], fill=(40, 47, 66), width=1)
    bb = f.getbbox(text)
    tx = round(fs * 0.8)
    d.text((tx, h + (strip - bb[3]) // 2 - round(fs * 0.08)), text,
           font=f, fill=(240, 242, 248, 255))
    out, _ = tag(out, tx + f.getlength(text) + round(fs * 0.5),
                 h + strip / 2, mode, max(10, round(fs * 0.5)))
    return out


def build_png(entry, src_path, out_path):
    src = Image.open(src_path)
    text, mode = entry['caption'], entry['tag']
    if entry['style'] == 'overlay':
        img = overlay_layer(src.size, text, mode)
        out = Image.alpha_composite(src.convert('RGBA'), img)
    else:
        out = with_strip(src, text, mode)
    out.convert('RGB').save(out_path, optimize=True)
    print(f'{out_path}: {out.width}x{out.height}, {out_path.stat().st_size:,} bytes')


def source_fps(src):
    durations = [frame.info.get('duration', 100) for frame in ImageSequence.Iterator(src)]
    return len(durations) * 1000 / sum(durations)


def gif_attempts(fps, width):
    yield None, None
    lower = [step for step in FPS_STEPS if step < round(fps)]
    for step in lower:
        yield step, None
    for scale in WIDTH_STEPS:
        yield (lower[-1] if lower else None), round(width * scale / 2) * 2


def encode_gif(src_path, layer_path, out_path, fps, width):
    chain = ['overlay=0:0']
    if fps:
        chain.append(f'fps={fps}')
    if width:
        chain.append(f'scale={width}:-2:flags=lanczos')
    graph = (f'[0:v][1:v]{",".join(chain)},split[a][b];'
             '[a]palettegen=max_colors=128:stats_mode=diff[p];'
             '[b][p]paletteuse=dither=none')
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-i', str(src_path), '-i', str(layer_path),
         '-filter_complex', graph, str(out_path)],
        check=True)


def build_gif(entry, src_path, out_path, work):
    src = Image.open(src_path)
    layer_path = work / f'{entry["file"]}.overlay.png'
    overlay_layer(src.size, entry['caption'], entry['tag']).save(layer_path)
    trial = work / f'{entry["file"]}.gif'
    fps = source_fps(src)
    for fps_choice, width_choice in gif_attempts(fps, src.width):
        encode_gif(src_path, layer_path, trial, fps_choice, width_choice)
        size = trial.stat().st_size
        rate = f'{fps_choice} fps' if fps_choice else f'source timing ({fps:.1f} fps)'
        width = width_choice or src.width
        if size <= LIMIT:
            shutil.move(trial, out_path)
            print(f'{out_path}: width {width}, {rate}, {size:,} bytes')
            return True
        print(f'  {entry["file"]}: width {width}, {rate} is {size:,} bytes, over 1 MB')
    print(f'{entry["file"]}: still over 1 MB at the smallest step; shorten or crop the recording',
          file=sys.stderr)
    return False


def load_entries():
    entries = json.loads(CAPTIONS.read_text(encoding='utf-8'))
    problems, seen = [], set()
    for entry in entries:
        name = entry.get('file')
        if name in seen:
            problems.append(f'{name}: listed twice')
        seen.add(name)
        if entry.get('style') not in STYLES:
            problems.append(f'{name}: style must be one of {", ".join(STYLES)}')
        elif entry['style'] == 'none':
            if entry.get('caption') is not None or entry.get('tag') is not None:
                problems.append(f'{name}: style "none" takes no caption and no tag')
        else:
            if not entry.get('caption'):
                problems.append(f'{name}: needs a caption')
            if entry.get('tag') not in TAG:
                problems.append(f'{name}: tag must be one of {", ".join(TAG)}')
        sources = [p for p in SOURCE.glob(f'{name}.*') if p.suffix in ('.png', '.gif')]
        if len(sources) != 1:
            problems.append(f'{name}: expected one source/{name}.png or .gif, found {len(sources)}')
        else:
            entry['source'] = sources[0]
            if sources[0].suffix == '.gif' and entry.get('style') == 'strip':
                problems.append(f'{name}: the strip style is for PNGs; use overlay for a GIF')
    if problems:
        sys.exit('captions.json:\n  ' + '\n  '.join(problems))
    return entries


def check_tools(todo):
    captioned = [e for e in todo if e['style'] != 'none']
    for font in (BOLD, SEMI) if captioned else ():
        if not Path(font).is_file():
            sys.exit(f'font not found: {font} (Segoe UI ships with Windows)')
    if any(e['source'].suffix == '.gif' for e in captioned) and not shutil.which('ffmpeg'):
        sys.exit('ffmpeg is not on PATH: winget install Gyan.FFmpeg')


def main():
    parser = argparse.ArgumentParser(
        description='Caption the Workshop carousel images listed in captions.json.')
    parser.add_argument('--force', nargs='+', action='extend', default=[], metavar='NAME',
                        help='rebuild these entries even if their output exists, or "all"')
    parser.add_argument('--preview', action='store_true',
                        help='write to a temporary folder instead of carousel/')
    args = parser.parse_args()

    entries = load_entries()
    names = {e['file'] for e in entries}
    unknown = [n for n in args.force if n != 'all' and n not in names]
    if unknown:
        sys.exit(f'not in captions.json: {", ".join(unknown)}')

    images = {p.name for p in HERE.iterdir() if p.suffix in ('.png', '.gif')}
    expected = {e['file'] + e['source'].suffix for e in entries}
    stray = sorted(images - expected)
    if stray:
        print('Not in captions.json, but the uploader will still upload: ' + ', '.join(stray))

    forced = names if 'all' in args.force else set(args.force)
    todo = [e for e in entries
            if e['file'] in forced or e['file'] + e['source'].suffix not in images]
    if not todo:
        print('Nothing to build: every entry in captions.json has its image in carousel/.')
        return

    check_tools(todo)
    dest = Path(tempfile.mkdtemp(prefix='carousel-preview-')) if args.preview else HERE
    ok = True
    with tempfile.TemporaryDirectory() as work:
        for entry in todo:
            out_path = dest / (entry['file'] + entry['source'].suffix)
            if entry['style'] == 'none':
                shutil.copyfile(entry['source'], out_path)
                print(f'{out_path}: copied as is')
            elif entry['source'].suffix == '.gif':
                ok = build_gif(entry, entry['source'], out_path, Path(work)) and ok
            else:
                build_png(entry, entry['source'], out_path)
            if out_path.exists() and out_path.stat().st_size > LIMIT:
                print(f'{out_path.name} is over 1 MB; Steam will refuse it', file=sys.stderr)
                ok = False
    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
