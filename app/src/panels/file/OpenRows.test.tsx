import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));
vi.mock("../useTextureUrl", () => ({ useTextureUrl: vi.fn(() => undefined) }));

import { SCENARIO_FOR_PAINT, SCENARIO_PLAIN } from "../../lib/paintCopy";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { usePaintModStore } from "../../store/paintModStore";
import { paintModView } from "../../test/builders";
import { buttons, shown } from "../../test/elements";
import { saveRow, scenarioListing, scenarioRow } from "../../test/openRows";
import { RowLine } from "./OpenRows";

const noop = () => undefined;

beforeEach(() => {
  useOpenScreenStore.setState({ ...useOpenScreenStore.getInitialState() });
  usePaintModStore.setState({ known: true, paintMod: paintModView({ enabled: false }) });
});

describe("a row", () => {
  it("titles a save with its date, tags an autosave, and carries no button of its own", () => {
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
