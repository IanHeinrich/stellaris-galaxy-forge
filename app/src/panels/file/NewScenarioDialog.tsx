import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import * as ipc from "../../api/ipc";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { Dialog } from "../overlays/Dialog";
import "./open.css";

export const MAX_RADIUS = 460;
export const PAINT_URL = "https://oatmealproblem.github.io/paint-a-galaxy/";
const DEFAULT_NAME = "new_galaxy";

/** The galaxy sizes the generator offers, by the radius each one lays out. */
const PRESETS = [
  { id: "tiny", label: "Tiny · 200", radius: 200 },
  { id: "small", label: "Small · 300", radius: 300 },
  { id: "medium", label: "Medium · 400", radius: 400 },
  { id: "large", label: "Large · 450", radius: 450 },
  { id: "huge", label: "Huge · 450", radius: 450 },
];

function clampRadius(radius: number): number {
  if (!Number.isFinite(radius)) return MAX_RADIUS;
  return Math.min(MAX_RADIUS, Math.max(1, Math.round(radius)));
}

/** The shapes keep a quarter of the radius clear of stars; a new scenario starts there. */
const CORE_FRACTION = 0.25;

function clampCore(core: number, radius: number): number {
  if (!Number.isFinite(core)) return 0;
  return Math.min(radius, Math.max(0, Math.round(core)));
}

type Route = "blank" | "game" | "paint";

/** The name and canvas size a blank scenario starts from. */
type Blank = { name: string; radius: number; coreRadius: number };

const ROUTES: { id: Route; title: string; copy: string; primary: string }[] = [
  {
    id: "blank",
    title: "Blank canvas",
    copy: "Place every system yourself.",
    primary: "Create",
  },
  {
    id: "game",
    title: "A galaxy from the game",
    copy:
      "Start a new game in Stellaris with the size and shape you want, save on day one, then open " +
      "that save here. You get the generator's layout, names and empires to edit.",
    primary: "Open a save…",
  },
  {
    id: "paint",
    title: "Paint a galaxy",
    copy:
      "Draw systems and lanes in your browser with paint-a-galaxy by Oatmeal Problem, export its " +
      "scenario file, then open that file here.",
    primary: "Open a file…",
  },
];

const STEPS: Record<Route, string[]> = {
  blank: [],
  game: [
    "Start a new game in Stellaris, any size and shape, and save on day one.",
    "Open that save here as a scenario.",
  ],
  paint: [
    "Draw your galaxy on paint-a-galaxy and export its scenario file.",
    "Open the exported file here.",
  ],
};

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="route-icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const DOTS = [3.2, 8, 12.8];

function glyphOf(route: Route): ReactNode {
  switch (route) {
    case "blank":
      return (
        <Glyph>
          <g fill="currentColor" stroke="none">
            {DOTS.flatMap((cy) =>
              DOTS.map((cx) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="1" />),
            )}
          </g>
        </Glyph>
      );
    case "game":
      return (
        <Glyph>
          <circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <path d="M8 4.4c3.4 0 5.4 2.4 4.9 5.2-.4 2.4-2.6 4-5.3 3.9" />
          <path d="M8 11.6c-3.4 0-5.4-2.4-4.9-5.2.4-2.4 2.6-4 5.3-3.9" />
        </Glyph>
      );
    case "paint":
      return (
        <Glyph>
          <path d="M13.6 2.4 8.9 7.1" />
          <path d="M7.4 5.6 10.4 8.6 8.6 10.4 5.6 7.4Z" />
          <path d="M5.6 7.4 2.4 13.6 8.6 10.4Z" />
        </Glyph>
      );
  }
}

const ARROW: Record<string, number | undefined> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/** The three ways to start, as a radio group: arrows move the choice, Enter and Space take it. */
export function RouteCards({ route, onRoute }: { route: Route; onRoute: (route: Route) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const at = ROUTES.findIndex((r) => r.id === route);
    const next = ROUTES[(at + step + ROUTES.length) % ROUTES.length].id;
    onRoute(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-route="${next}"]`)?.focus();
  };

  return (
    <div className="route-cards" role="radiogroup" aria-label="How to start" onKeyDown={onKeyDown}>
      {ROUTES.map((r) => (
        <button
          key={r.id}
          type="button"
          role="radio"
          aria-checked={route === r.id}
          data-route={r.id}
          className="route-card"
          onClick={() => onRoute(r.id)}
        >
          <span className="route-head">
            {glyphOf(r.id)}
            <span className="route-title">{r.title}</span>
          </span>
          <span className="muted">{r.copy}</span>
        </button>
      ))}
    </div>
  );
}

/** What the chosen route asks of the user before the file it wants exists. */
export function RouteHelp({ route }: { route: Exclude<Route, "blank"> }) {
  const openSite = () => {
    void ipc
      .openUrl(PAINT_URL)
      .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
  };

  return (
    <div className="route-help">
      <ol className="route-steps">
        {STEPS[route].map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {route === "paint" && (
        <button type="button" className="link route-link" onClick={openSite}>
          Open paint-a-galaxy by Oatmeal Problem ↗
        </button>
      )}
    </div>
  );
}

/** The primary action of each route; a blank scenario needs a name before it has one. */
function start(route: Route, blank: Blank): void {
  if (route === "blank" && blank.name === "") return;
  const file = useFileSessionStore.getState();
  useLayoutStore.getState().hideScenarioDialog();
  switch (route) {
    case "blank":
      void file.newScenario(blank.name, blank.radius, blank.coreRadius);
      break;
    case "game":
      void file.pickAndOpen("scenario");
      break;
    case "paint":
      void file.pickAndOpen();
      break;
  }
}

export function RouteFoot({ route, blank }: { route: Route; blank: Blank }) {
  return (
    <div className="setup-actions">
      <button type="button" onClick={() => useLayoutStore.getState().hideScenarioDialog()}>
        Cancel
      </button>
      <button
        type="button"
        disabled={route === "blank" && blank.name === ""}
        onClick={() => start(route, blank)}
      >
        {ROUTES.find((r) => r.id === route)?.primary}
      </button>
    </div>
  );
}

/** Where a scenario comes from: a canvas of your own, a game's own galaxy, or a painted one. */
export function NewScenarioDialog() {
  const hide = useLayoutStore((s) => s.hideScenarioDialog);
  const [route, setRoute] = useState<Route>("blank");
  const [name, setName] = useState(DEFAULT_NAME);
  const [preset, setPreset] = useState("medium");
  const [custom, setCustom] = useState(400);
  const [core, setCore] = useState<number | null>(null);

  const radius =
    preset === "custom" ? clampRadius(custom) : (PRESETS.find((p) => p.id === preset)?.radius ?? 0);
  const coreRadius = clampCore(core ?? radius * CORE_FRACTION, radius);
  const blank: Blank = { name: name.trim(), radius, coreRadius };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(route, blank);
  };

  return (
    <Dialog className="open-dialog" label="New scenario" onClose={hide} onDismiss={hide}>
      <form onSubmit={submit}>
        <div className="open-dialog-head">
          <h1>New scenario</h1>
        </div>
        <div className="open-dialog-body">
          <RouteCards route={route} onRoute={setRoute} />
          {route === "blank" ? (
            <>
              <label className="field">
                <span>Name</span>
                <input
                  value={name}
                  required
                  onChange={(e) => setName(e.currentTarget.value)}
                  placeholder={DEFAULT_NAME}
                />
              </label>
              <label className="field">
                <span>Size</span>
                <select value={preset} onChange={(e) => setPreset(e.currentTarget.value)}>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </label>
              {preset === "custom" && (
                <label className="field">
                  <span>Radius</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_RADIUS}
                    value={custom}
                    onChange={(e) => setCustom(e.currentTarget.valueAsNumber)}
                  />
                </label>
              )}
              <label className="field">
                <span>Core radius</span>
                <input
                  type="number"
                  min={0}
                  max={radius}
                  value={coreRadius}
                  onChange={(e) => setCore(e.currentTarget.valueAsNumber)}
                />
              </label>
              <div className="muted">
                The radius only sizes the canvas until the systems you add give it an extent. The
                core radius is written to the file and drawn as a ring: keep stars outside it.
              </div>
            </>
          ) : (
            <RouteHelp route={route} />
          )}
        </div>
        <div className="open-dialog-foot">
          <RouteFoot route={route} blank={blank} />
        </div>
      </form>
    </Dialog>
  );
}
