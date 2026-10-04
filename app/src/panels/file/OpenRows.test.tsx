import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("../useTextureUrl", () => ({ useTextureUrl: vi.fn(() => undefined) }));

import { SCENARIO_FOR_PAINT, SCENARIO_PLAIN } from "../../lib/paintCopy";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { usePaintModStore } from "../../store/paintModStore";
import { paintModView, saveRow, scenarioListing, scenarioRow } from "../../test/builders";
import { buttons, shown } from "../../test/elements";
import type { RecentRow, Section } from "../../lib/openRows";
import { RowLine, SectionRows } from "./OpenRows";

const noop = () => undefined;

beforeEach(() => {
  useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
  usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
});

describe("a row", () => {
  it("titles a save with its name and puts the date under it", () => {
    const html = renderToStaticMarkup(
      <RowLine row={saveRow({ title: "my run", sub: "2250.01.01" })} onForget={noop} />,
    );
    expect(shown(html)).toMatch(/^my run 2250\.01\.01 /);
    expect(html).toContain('<span class="open-sub open-date">2250.01.01</span>');
  });

  it("titles a recent save with its file name and keeps empire, date and version under it", () => {
    const html = renderToStaticMarkup(
      <RowLine
        row={recentRow({
          kind: "save",
          path: "C:/saves/terran/my run.sav",
          title: "Terran Federation",
          subtitle: "Terran Federation · 2250.01.01 · v4.5.0",
        })}
        onForget={noop}
      />,
    );
    expect(shown(html)).toMatch(/^SAVE my run Terran Federation · 2250\.01\.01 · v4\.5\.0 /);
  });

  it("tags an autosave under its date, and carries no button of its own", () => {
    const html = renderToStaticMarkup(
      <RowLine row={saveRow({ title: "2207.01.01", autosave: true })} onForget={noop} />,
    );
    expect(shown(html)).toMatch(/^2207\.01\.01 autosave /);
    expect(buttons(html)).toEqual([]);
  });

  it("gives a scenario its systems and mod, and no scenario action", () => {
    const html = renderToStaticMarkup(<RowLine row={scenarioRow()} onForget={noop} />);
    expect(shown(html)).toContain("a_galaxy Plain 100 systems · Stellaris");
    expect(buttons(html)).toEqual([]);
  });

  it("tags a scenario row PaG or Plain, with the full wording on hover", () => {
    const painted = renderToStaticMarkup(
      <RowLine
        row={scenarioRow({ listing: scenarioListing({ painted: true }) })}
        onForget={noop}
      />,
    );
    expect(painted).toContain(`title="${SCENARIO_FOR_PAINT.line}">PaG<`);
    const plain = renderToStaticMarkup(<RowLine row={scenarioRow()} onForget={noop} />);
    expect(plain).toContain(`title="${SCENARIO_PLAIN.line}">Plain<`);
  });

  it("tags a recent scenario only when the listing or the mod's folder can tell", () => {
    const recent = (path: string) =>
      renderToStaticMarkup(
        <RowLine
          row={{
            kind: "recent",
            key: `recent:${path}`,
            doc: { kind: "scenario", path, title: "mine", subtitle: "", openedAt: 5 },
            missing: false,
          }}
          onForget={noop}
        />,
      );
    usePaintModStore.setState({
      paintMod: paintModView({ scenarios_dir: "C:/mods/pag/map/setup_scenarios" }),
    });
    expect(shown(recent("C:/mods/pag/map/setup_scenarios/mine.txt"))).toContain("PaG");
    useOpenScreenStore.setState({ scenarios: [scenarioListing()] });
    expect(shown(recent(scenarioListing().path))).toContain("Plain");
    expect(shown(recent("C:/elsewhere/mine.txt"))).not.toMatch(/PaG|Plain/);
  });
});

function recentRow(over: Partial<RecentRow["doc"]> = {}): RecentRow {
  const doc = {
    kind: "scenario" as const,
    path: "C:/mods/a.txt",
    title: "a",
    subtitle: "",
    openedAt: 5,
    ...over,
  };
  return { kind: "recent", key: `recent:${doc.path}`, doc, missing: false };
}

describe("the Recent section", () => {
  const rows = { current: new Map<string, HTMLDivElement>() };

  function heading(over: Partial<Section> = {}): string {
    const section: Section = {
      id: "recent",
      label: "Recent",
      rows: [recentRow()],
      count: 1,
      note: null,
      notices: [],
      ...over,
    };
    return renderToStaticMarkup(
      <SectionRows
        section={section}
        current={undefined}
        busy={null}
        rowError={null}
        rows={rows}
        onPress={noop}
        onForget={noop}
        onClear={noop}
        onShowAll={noop}
      />,
    );
  }

  it("has a Clear button in its heading while it lists rows", () => {
    expect(buttons(heading())).toEqual(["Clear"]);
    expect(buttons(heading({ rows: [], note: "Nothing opened yet." }))).toEqual([]);
  });

  it("links to the Recent tab when the All tab left rows out", () => {
    expect(buttons(heading({ count: 10, more: 5 }))).toEqual(["Clear", "Show all 10 recent"]);
  });

  it("gives the Saves section no Clear button", () => {
    expect(buttons(heading({ id: "saves", label: "Saves", rows: [] }))).toEqual([]);
  });
});
