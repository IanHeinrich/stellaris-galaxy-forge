import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { WATCH_COLOURS } from "../../lib/watchlist";
import { toCss } from "../../lib/visual/ownerColors";
import { OPEN_RESULT } from "../../store/fixture";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useWatchlistStore } from "../../store/watchlistStore";
import { Watchlist, WATCHLIST_EMPTY } from "./Watchlist";

const systemName = (id: number) => systemNameOf(useGalaxyStore.getState().systems, new Map(), id);

beforeEach(() => {
  useGalaxyStore.getState().clear();
  useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
  useWatchlistStore.setState({ ...useWatchlistStore.getInitialState(), entries: [] });
});

const render = () => renderToStaticMarkup(<Watchlist />);

describe("the Pinned searches tab", () => {
  it("suggests searches to pin while nothing is", () => {
    const html = render();

    expect(html).toContain('placeholder="Pin a search…"');
    expect(html).toContain(WATCHLIST_EMPTY.replace(/"/g, "&quot;"));
    expect(html).not.toContain("Clear all");
  });

  it("lists each entry with its colour, its count and the systems it finds", () => {
    useWatchlistStore.setState({
      entries: [
        { query: "salvager", colour: WATCH_COLOURS[0], shown: true },
        { query: "gaia", colour: WATCH_COLOURS[1], shown: false },
      ],
      results: new Map([
        ["salvager", [0, 1]],
        ["gaia", []],
      ]),
    });

    const html = render();

    expect(html).not.toContain("No pinned searches yet");
    expect(html).toContain("2 searches pinned");
    expect(html).toContain(">Clear all</button>");
    expect(html).toContain(">salvager</button>");
    expect(html).toContain(">gaia</button>");
    expect(html).toContain(`background:${toCss(WATCH_COLOURS[0])}`);
    expect(html).toContain('aria-label="Hide &quot;salvager&quot; on the map"');
    expect(html).toContain('aria-label="Show &quot;gaia&quot; on the map"');
    expect(html).toContain('aria-label="Unpin &quot;salvager&quot;"');
    expect(html.match(/class="browser-count">(\d+)</g)).toEqual([
      'class="browser-count">2<',
      'class="browser-count">0<',
    ]);
    expect(html).toContain(`Go to ${systemName(0)}`);
    expect(html).toContain(`Go to ${systemName(1)}`);
  });
});
