import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { countryNode, OPEN_RESULT, planetPage } from "../../store/fixture";

vi.mock("../../api/ipc");
vi.mock("../../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../../api/__mocks__/dialog"));
vi.mock("zustand", () => import("../../test/zustandSnapshot"));

import { bindStores } from "../../store/bindStores";
import { useEntityStore } from "../../store/entityStore";
import { useInspectorStore, type Entry } from "../../store/inspectorStore";
import { armSession, resetStores } from "../../store/storeFixture";
import { openWith } from "../../test/session";
import { Breadcrumb } from "./Inspector";

bindStores();

const EMPIRE = countryNode();
const RENAMED = {
  ...EMPIRE,
  name: { key: "Check Rename", literal: true, variables: [] },
  name_key: "Check Rename",
};
const PAGE: Entry = { ref: { kind: "country", id: EMPIRE.id }, label: "Test Empire" };

beforeEach(() => {
  resetStores();
  armSession();
});

describe("the breadcrumb", () => {
  it("names an open empire page by the empire's name as it now stands", async () => {
    await openWith(OPEN_RESULT, { galaxy: { countries: [RENAMED] } });
    useInspectorStore.setState({
      stack: [{ ref: { kind: "system", id: 1 }, label: "Sol" }, PAGE],
    });

    const html = renderToStaticMarkup(<Breadcrumb />);
    expect(html).toContain('<span class="here">Check Rename</span>');
    expect(html).not.toContain("Test Empire");
    expect(html).toContain("Sol");
  });

  it("keeps the label a page opened with for a country the galaxy does not list", async () => {
    await openWith(OPEN_RESULT, { galaxy: { countries: [] } });
    useInspectorStore.setState({ stack: [{ ref: { kind: "system", id: 1 }, label: "Sol" }, PAGE] });

    expect(renderToStaticMarkup(<Breadcrumb />)).toContain('<span class="here">Test Empire</span>');
  });

  it("names an open planet page by the planet's name as its page was last read", async () => {
    await openWith(OPEN_RESULT, { galaxy: { countries: [] } });
    const MOON: Entry = { ref: { kind: "body", system: 1, id: 141 }, label: "Shuckon Ia" };
    useInspectorStore.setState({ stack: [{ ref: { kind: "system", id: 1 }, label: "Sol" }, MOON] });
    useEntityStore.setState({
      pages: new Map([
        [
          141,
          planetPage({
            id: 141,
            name: { key: "Pebble", literal: true, variables: [] },
            name_key: "Pebble",
          }),
        ],
      ]),
    });
    expect(renderToStaticMarkup(<Breadcrumb />)).toContain('<span class="here">Pebble</span>');

    useEntityStore.setState({ pages: new Map() });
    expect(renderToStaticMarkup(<Breadcrumb />)).toContain('<span class="here">Shuckon Ia</span>');
  });
});
