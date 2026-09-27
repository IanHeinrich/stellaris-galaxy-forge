import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The thumbnails come from the map's texture cache, which no test renderer can fill.
vi.mock("./useTextureUrl", () => ({ useTextureUrl: () => undefined }));

import { TilePicker, type TileGroup, type TileItem } from "./TilePicker";

const tile = (key: string): TileItem => ({ key, label: key, textures: [`flag:${key}`] });

const GROUPS: TileGroup[] = [
  { key: "pointy", label: "pointy 2", items: [tile("pointy/a"), tile("pointy/b")] },
  {
    key: "stars",
    label: "stars 2 · Star Pack",
    section: "From mods",
    items: [tile("stars/c"), tile("stars/d")],
  },
];

const picker = (open: boolean, current = tile("stars/d")) =>
  renderToStaticMarkup(
    <TilePicker
      label="Emblem"
      current={current}
      groups={GROUPS}
      open={open}
      onOpenChange={() => undefined}
      onPick={() => undefined}
    />,
  );

describe("a tile picker", () => {
  it("draws only its field while closed", () => {
    const html = picker(false);
    expect(html).toContain('aria-label="Emblem: stars/d"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("▾");
    expect(html).not.toContain('role="listbox"');
  });

  it("opens on the current item's group, with the mods' groups under their heading", () => {
    const html = picker(true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("▴");
    expect(html).toMatch(/<optgroup label="From mods"><option value="stars" selected="">/);
    expect(html).toContain('aria-label="Emblem: stars 2 · Star Pack"');
    expect(html).toMatch(/aria-selected="true" aria-label="stars\/d"/);
    expect(html).toContain('aria-label="stars/c"');
    expect(html).not.toContain('aria-label="pointy/a"');
  });

  it("drops the dropdown when there is one group", () => {
    const html = renderToStaticMarkup(
      <TilePicker
        label="Background"
        current={tile("plain")}
        groups={[{ key: "all", label: "All", items: [tile("plain"), tile("stripes")] }]}
        open
        onOpenChange={() => undefined}
        onPick={() => undefined}
      />,
    );
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-label="stripes"');
  });
});
