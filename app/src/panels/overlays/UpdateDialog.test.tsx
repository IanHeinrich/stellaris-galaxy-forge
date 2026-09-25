import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buttonIn } from "../../test/elements";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));

import type { UpdateView } from "../../generated/UpdateView";
import { UpdateBody, type UpdateBodyProps } from "./UpdateDialog";

const UPDATE: UpdateView = {
  version: "0.6.0",
  notes: "Lanes keep their length\nNebulae move with their systems",
  date: "2026-09-19T09:30:00Z",
  install: "app",
};

const noop = () => undefined;

function body(props: Partial<UpdateBodyProps>): ReactElement {
  return (
    <UpdateBody
      status="available"
      version="0.5.1"
      update={UPDATE}
      progress={null}
      error={null}
      onInstall={noop}
      onReleases={noop}
      onSkip={noop}
      onClose={noop}
      {...props}
    />
  );
}

describe("an update the app can install itself", () => {
  it("names both versions, shows the notes as they were written, and installs on the button", () => {
    const onInstall = vi.fn();
    const tree = body({ onInstall });

    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Version 0.6.0 is available");
    expect(html).toContain("You are running 0.5.1");
    expect(html).toContain("published");
    expect(html).toContain("Nebulae move with their systems");

    buttonIn(tree, "Install and restart")!.props.onClick();
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it("formats notes written as the changelog writes them", () => {
    const notes = [
      "### Added",
      "",
      "- Binary and trinary systems show each of their stars on",
      "  the map.",
      "- `sgf lane` takes **two** systems.",
      "",
      "### Fixed",
      "",
      "- Waystations no longer clutter the whole-galaxy view.",
    ].join("\n");
    const html = renderToStaticMarkup(body({ update: { ...UPDATE, notes } }));

    expect(html).toContain("<h2>Added</h2>");
    expect(html).toContain(
      "<li>Binary and trinary systems show each of their stars on the map.</li>",
    );
    expect(html).toContain("<li><code>sgf lane</code> takes <strong>two</strong> systems.</li>");
    expect(html).toContain("<h2>Fixed</h2>");
    expect(html).not.toContain("###");
  });

  it("says why an install failed over the buttons that try it again", () => {
    const tree = body({ error: "signature mismatch" });

    expect(renderToStaticMarkup(tree)).toContain('class="warn">signature mismatch');
    expect(buttonIn(tree, "Install and restart")!.props).toMatchObject({ disabled: false });
  });

  it("keeps the raw date when it is not one a clock can read", () => {
    const html = renderToStaticMarkup(body({ update: { ...UPDATE, date: "whenever" } }));
    expect(html).toContain("whenever");
  });

  it("says how far the download has got, and does not offer to start it twice", () => {
    const tree = body({
      status: "installing",
      progress: { downloaded: 1 << 20, total: 4 << 20, done: false },
    });

    const html = renderToStaticMarkup(tree);
    expect(html).toContain("Downloading… 1.0 MB of 4.0 MB");
    expect(html).toContain("The app closes while the installer runs");
    expect(html).toContain('style="width:25%"');
    expect(buttonIn(tree, "Install and restart")!.props).toMatchObject({ disabled: true });
  });
});

describe("a copy that is replaced by hand", () => {
  it("offers the releases page instead of an install", () => {
    const tree = body({ update: { ...UPDATE, install: "manual" } });

    expect(renderToStaticMarkup(tree)).toContain("This copy is replaced by hand");
    expect(buttonIn(tree, "Install and restart")).toBeUndefined();
    expect(buttonIn(tree, "Open releases page")).toBeDefined();
  });
});

describe("the other answers a check can give", () => {
  it("says the running copy is up to date, with nothing to do about it", () => {
    const tree = body({ status: "current", update: null });

    expect(renderToStaticMarkup(tree)).toContain("Stellaris Galaxy Forge 0.5.1 is up to date.");
    expect(buttonIn(tree, "Skip this version")).toBeUndefined();
  });

  it("shows a failure as a warning and keeps the releases page reachable", () => {
    const onReleases = vi.fn();
    const tree = body({ status: "failed", update: null, error: "endpoint 403", onReleases });

    expect(renderToStaticMarkup(tree)).toContain('class="warn">endpoint 403');

    buttonIn(tree, "Open releases page")!.props.onClick();
    expect(onReleases).toHaveBeenCalledTimes(1);
  });
});
