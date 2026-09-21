import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { useFileSessionStore } from "../../store/fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT } from "../../store/fixture";
import { usePaintModStore } from "../../store/paintModStore";
import { elements } from "../../test/elements";
import { PaintNotice } from "./PaintNotice";

const notice = () => renderToStaticMarkup(<PaintNotice />);

const DIR = "C:/mods/pag/map/setup_scenarios";

/** The notice's button reading `label`. */
function button(label: string): ReactElement<{ onClick(): void; disabled?: boolean }> {
  const found = elements(<PaintNotice />).find(
    (el): el is ReactElement<{ onClick(): void; disabled?: boolean }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(label),
  );
  expect(found).toBeDefined();
  return found!;
}

function open(result: typeof OPEN_RESULT): void {
  useFileSessionStore.setState({ status: "ready", kind: result.kind, path: result.path });
}

const stored = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the notice for a scenario outside the mod", () => {
  it("is absent with nothing open, for a save, and for a scenario already on the layer", () => {
    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: true } });
    expect(notice()).toBe("");

    open(OPEN_RESULT);
    expect(notice()).toBe("");

    open(SCENARIO_RESULT);
    useFileSessionStore.setState({ painted: true });
    expect(notice()).toBe("");

    useFileSessionStore.setState({ painted: false, path: `${DIR}/mine.txt` });
    expect(notice()).toBe("");
  });

  it("says the map needs the mod, with the mod's state and the way in", () => {
    open(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: true } });

    const html = notice();
    expect(html).toContain('class="paint-notice"');
    expect(html).toContain(
      "Custom galaxies hit game-breaking bugs without the Paint a Galaxy mod. Save this map into " +
        "the mod unless it belongs to a mod of your own.",
    );
    expect(html).toContain("Paint a Galaxy mod enabled ✓");
    expect(html).toContain("Save into the Paint a Galaxy mod…");
    expect(html).toContain("Not for me");
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(false);

    const saveIntoPaintMod = vi.fn();
    useFileSessionStore.setState({ saveIntoPaintMod });
    button("Save into the Paint a Galaxy mod…").props.onClick();
    expect(saveIntoPaintMod).toHaveBeenCalledTimes(1);
  });

  it("shows the steps and keeps the save dead while the mod is not installed", () => {
    open(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: null });

    const html = notice();
    expect(html).toContain("Subscribe to the ");
    expect(html).toContain("then enable it in your playset.");
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(true);

    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: false } });
    expect(notice()).toContain(
      "The Paint a Galaxy mod is installed but not enabled. Turn it on in your playset in the launcher.",
    );
    expect(button("Save into the Paint a Galaxy mod…").props.disabled).toBe(false);
  });

  it("goes for good on Not for me", () => {
    open(SCENARIO_RESULT);
    usePaintModStore.setState({ known: true, paintMod: { scenarios_dir: DIR, enabled: true } });
    expect(notice()).not.toBe("");

    button("Not for me").props.onClick();
    expect(notice()).toBe("");
    expect(stored.get("sgf.paint.noticeDismissed")).toBe("true");
    expect(usePaintModStore.getState().noticeDismissed).toBe(true);
  });
});
