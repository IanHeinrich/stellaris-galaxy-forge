import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { toCss } from "../../lib/visual/ownerColors";
import { WATCH_COLOURS } from "../../lib/watchlist";
import { useWatchlistStore } from "../../store/watchlistStore";
import { PINNED_GROUP, PinnedRows, PinToggle } from "./Pins";

const noop = () => undefined;

beforeEach(() => {
  useWatchlistStore.setState({
    ...useWatchlistStore.getInitialState(),
    entries: [
      { query: "salvager", colour: WATCH_COLOURS[0], shown: true },
      { query: "gaia", colour: WATCH_COLOURS[1], shown: false },
    ],
    results: new Map([
      ["salvager", [0, 1, 2]],
      ["gaia", [4]],
    ]),
  });
});

const rows = (active: number) =>
  renderToStaticMarkup(<PinnedRows active={active} onHover={noop} onRun={noop} />);

describe("the empty palette's pinned group", () => {
  it("heads the group once and lists each pinned search with its colour and count", () => {
    const html = rows(-1);

    expect(html.split(PINNED_GROUP)).toHaveLength(2);
    expect(html).toContain('<span class="palette-name">salvager</span>');
    expect(html).toContain('<span class="palette-name">gaia</span>');
    expect(html).toContain(`background:${toCss(WATCH_COLOURS[0])}`);
    expect(html).toContain(`background:${toCss(WATCH_COLOURS[1])}`);
    expect(html).toContain('<span class="palette-sub">3 systems</span>');
    expect(html).toContain('<span class="palette-sub">1 system</span>');
  });

  it("offers to hide a shown search, show a hidden one and unpin either", () => {
    const html = rows(-1);

    expect(html).toContain('aria-label="Hide &quot;salvager&quot; on the map"');
    expect(html).toContain('aria-label="Show &quot;gaia&quot; on the map"');
    expect(html).toContain('aria-label="Unpin &quot;salvager&quot;"');
    expect(html).toContain('aria-label="Unpin &quot;gaia&quot;"');
    expect(html).toContain('class="palette-row pinned off"');
  });

  it("highlights the active row", () => {
    const html = rows(1);

    expect(html).toContain('aria-selected="false" class="palette-row pinned"');
    expect(html).toContain('aria-selected="true" class="palette-row pinned active off"');
  });
});

describe("the field's pin button", () => {
  it("offers to pin a search that is not pinned", () => {
    const html = renderToStaticMarkup(<PinToggle text="alpha refuge" />);

    expect(html).toContain('class="pin-toggle"');
    expect(html).toContain('title="Pin this search: its systems stay ringed on every save"');
    expect(html).toMatch(/<\/svg>Pin<\/button>$/);
  });

  it("shows a pinned search in its colour, whatever the case it was typed in", () => {
    const html = renderToStaticMarkup(<PinToggle text="SALVAGER" />);

    expect(html).toContain('class="pin-toggle on"');
    expect(html).toContain('title="Unpin this search"');
    expect(html).toContain(`background:${toCss(WATCH_COLOURS[0])}`);
    expect(html).toMatch(/>Pinned<\/button>$/);
  });
});
