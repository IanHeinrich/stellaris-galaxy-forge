import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { elements } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import * as ipc from "../../api/ipc";
import { PAINT_URL } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { usePaintModStore } from "../../store/paintModStore";
import { NewScenarioDialog, RouteCards, RouteFoot, RouteHelp } from "./NewScenarioDialog";

const BLANK = { name: "new_galaxy", radius: 400, coreRadius: 100, profile: "plain" as const };

const noop = () => undefined;

function button(tree: ReactNode, text: string): ReactElement<{ onClick: () => void }> {
  const found = elements(tree).find(
    (el): el is ReactElement<{ onClick: () => void }> =>
      el.type === "button" && renderToStaticMarkup(el).includes(text),
  );
  expect(found).toBeDefined();
  return found!;
}

function radiogroup(tree: ReactNode): ReactElement<{ onKeyDown: (e: unknown) => void }> {
  const found = elements(tree).find(
    (el): el is ReactElement<{ onKeyDown: (e: unknown) => void }> =>
      (el.props as { role?: string }).role === "radiogroup",
  );
  expect(found).toBeDefined();
  return found!;
}

/** What the group hands its key handler; the focus move needs a DOM the static renderer has none of. */
const arrow = (key: string) => ({
  key,
  preventDefault: vi.fn(),
  currentTarget: { querySelector: () => null },
});

const checked = (tree: ReactNode) =>
  elements(tree)
    .filter((el) => el.type === "button")
    .map((el) => (el.props as { "aria-checked": boolean })["aria-checked"]);

const stored = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState(), paintChoice: true });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState(), scenarioDialog: true });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
});

describe("the three ways to start a scenario", () => {
  it("offers each as a card, crediting paint-a-galaxy's author in the open", () => {
    const html = renderToStaticMarkup(<NewScenarioDialog />);
    expect(html).toContain("Blank canvas");
    expect(html).toContain("A galaxy from the game");
    expect(html).toContain("Paint a galaxy");
    expect(html).toContain("Download the scenario file");
    expect(html).toContain('role="radiogroup"');
  });

  it("marks only the chosen one", () => {
    expect(checked(<RouteCards route="blank" onRoute={noop} />)).toEqual([true, false, false]);
    expect(checked(<RouteCards route="paint" onRoute={noop} />)).toEqual([false, false, true]);
  });

  it("moves the choice with the arrow keys, wrapping at both ends", () => {
    const onRoute = vi.fn();
    radiogroup(<RouteCards route="blank" onRoute={onRoute} />).props.onKeyDown(arrow("ArrowRight"));
    expect(onRoute).toHaveBeenCalledWith("game");

    radiogroup(<RouteCards route="blank" onRoute={onRoute} />).props.onKeyDown(arrow("ArrowLeft"));
    expect(onRoute).toHaveBeenLastCalledWith("paint");

    radiogroup(<RouteCards route="paint" onRoute={onRoute} />).props.onKeyDown(arrow("ArrowDown"));
    expect(onRoute).toHaveBeenLastCalledWith("blank");
  });
});

describe("the blank canvas", () => {
  it("starts on the name and size the form shows", () => {
    const html = renderToStaticMarkup(<NewScenarioDialog />);
    expect(html).toContain(`value="${BLANK.name}"`);
    expect(html).toContain(`value="${BLANK.coreRadius}"`);
  });

  it("creates the scenario the form describes", () => {
    const newScenario = vi.fn();
    useFileSessionStore.setState({ newScenario });

    button(<RouteFoot route="blank" blank={BLANK} />, "Create").props.onClick();

    expect(newScenario).toHaveBeenCalledWith(BLANK.name, BLANK.radius, BLANK.coreRadius, "plain");
    expect(useLayoutStore.getState().scenarioDialog).toBe(false);
  });

  it("offers the Paint a Galaxy choice as a box that follows the standing choice, and says why", () => {
    let html = renderToStaticMarkup(<NewScenarioDialog />);
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).toContain("checked=");
    expect(html).toContain("For the Paint a Galaxy mod");
    expect(html).toContain(
      "Custom galaxies hit game-breaking bugs in the generator that this mod fixes.",
    );
    expect(html).toContain("Untick it only if the map is for a mod of your own.");

    useFileSessionStore.setState({ paintChoice: false });
    html = renderToStaticMarkup(<NewScenarioDialog />);
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).not.toContain("checked=");
  });

  it("shows the mod's state under the box only while it is ticked", () => {
    usePaintModStore.setState({
      known: true,
      paintMod: {
        scenarios_dir: "C:/mods/pag/map/setup_scenarios",
        enabled: true,
        reserved_spawns: true,
      },
    });
    expect(renderToStaticMarkup(<NewScenarioDialog />)).toContain("Paint a Galaxy mod enabled ✓");

    useFileSessionStore.setState({ paintChoice: false });
    const unticked = renderToStaticMarkup(<NewScenarioDialog />);
    expect(unticked).not.toContain("paint-mod-status");
    expect(unticked).toContain('class="setup-warn" role="alert"');
    expect(unticked).toContain("Only go on if you know what you");
  });

  it("creates the scenario under the Paint a Galaxy profile once the box is checked", () => {
    const newScenario = vi.fn();
    useFileSessionStore.setState({ newScenario });

    const blank = { ...BLANK, profile: "paint_a_galaxy" as const };
    button(<RouteFoot route="blank" blank={blank} />, "Create").props.onClick();

    expect(newScenario).toHaveBeenCalledWith(
      BLANK.name,
      BLANK.radius,
      BLANK.coreRadius,
      "paint_a_galaxy",
    );
  });
});

describe("a galaxy from the game", () => {
  it("picks a save and opens it as a plain scenario while the box is unticked", () => {
    const pickAndOpen = vi.fn();
    useFileSessionStore.setState({ pickAndOpen });

    const foot = <RouteFoot route="game" blank={BLANK} />;
    expect(renderToStaticMarkup(foot)).toContain("Open a save…");
    button(foot, "Open a save…").props.onClick();

    expect(pickAndOpen).toHaveBeenCalledWith("scenario", "plain");
    expect(useLayoutStore.getState().scenarioDialog).toBe(false);
  });

  it("opens the save under the Paint a Galaxy profile once the box is checked", () => {
    const pickAndOpen = vi.fn();
    useFileSessionStore.setState({ pickAndOpen });

    const blank = { ...BLANK, profile: "paint_a_galaxy" as const };
    button(<RouteFoot route="game" blank={blank} />, "Open a save…").props.onClick();

    expect(pickAndOpen).toHaveBeenCalledWith("scenario", "paint_a_galaxy");
  });

  it("says in two steps where that save comes from, with the Paint a Galaxy box under them", () => {
    const html = renderToStaticMarkup(<RouteHelp route="game" />);
    expect(html).toContain("save on day one");
    expect(html).toContain("Open that save here as a scenario.");
    expect(html).toContain("For the Paint a Galaxy mod");
    expect(html.match(/<input type="checkbox"[^>]*>/)![0]).toContain("checked=");

    useFileSessionStore.setState({ paintChoice: false });
    const unticked = renderToStaticMarkup(<RouteHelp route="game" />);
    expect(unticked.match(/<input type="checkbox"[^>]*>/)![0]).not.toContain("checked=");
    expect(unticked).toContain('class="setup-warn" role="alert"');
    expect(renderToStaticMarkup(<RouteHelp route="paint" />)).not.toContain(
      "For the Paint a Galaxy mod",
    );
  });
});

describe("a painted galaxy", () => {
  it("opens the site through the allowlisted link, and leaves the dialog open", () => {
    const foot = <RouteFoot route="paint" blank={BLANK} />;
    expect(renderToStaticMarkup(foot)).toContain("Open Paint a Galaxy in your browser");
    button(foot, "Open Paint a Galaxy in your browser").props.onClick();

    expect(ipc.openUrl).toHaveBeenCalledWith(PAINT_URL);
    expect(useLayoutStore.getState().scenarioDialog).toBe(true);
  });

  it("credits the author and says to download and open the scenario file", () => {
    const html = renderToStaticMarkup(<RouteHelp route="paint" />);
    expect(html).toContain("by Oatmeal Problem");
    expect(html).toContain("Download the scenario file");
  });

  it("picks a Paint a Galaxy file as painted, and closes once it is open", async () => {
    const pickAndOpenScenario = vi.fn(async () => true);
    useFileSessionStore.setState({ pickAndOpenScenario });

    button(<RouteHelp route="paint" />, "Open a Paint a Galaxy file…").props.onClick();

    await vi.waitFor(() => expect(useLayoutStore.getState().scenarioDialog).toBe(false));
    expect(pickAndOpenScenario).toHaveBeenCalledWith("paint_a_galaxy");
  });

  it("stays open when nothing was opened: no file picked, or the discard refused", async () => {
    const pickAndOpenScenario = vi.fn(async () => false);
    useFileSessionStore.setState({ pickAndOpenScenario });

    button(<RouteHelp route="paint" />, "Open a Paint a Galaxy file…").props.onClick();

    await vi.waitFor(() => expect(pickAndOpenScenario).toHaveBeenCalledTimes(1));
    expect(useLayoutStore.getState().scenarioDialog).toBe(true);
  });
});
