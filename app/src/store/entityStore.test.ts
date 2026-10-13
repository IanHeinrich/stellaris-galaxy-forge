import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");

import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { addrKey, useEntityStore, viewKey } from "./entityStore";
import { editResult, entityAddrOf, entitySchema, entitySource, entityView } from "./fixture";
import { useFileSessionStore } from "./fileSessionStore";
import { planetSummary, systemDetails } from "../test/builders";
import { until } from "../test/wait";

const getEntity = vi.mocked(ipc.getEntity);
const getEntitySource = vi.mocked(ipc.getEntitySource);
const getEntitySchema = vi.mocked(ipc.getEntitySchema);

bindStores();

const entities = () => useEntityStore.getState();
const PLANET = entityAddrOf("planet");
const FLEET = entityAddrOf("fleet");

beforeEach(() => {
  vi.clearAllMocks();
  entities().clear();
  getEntity.mockImplementation(async (addr, path) => entityView(addr.kind, { addr, path }));
  getEntitySource.mockImplementation(async (addr) => entitySource(addr.kind));
  getEntitySchema.mockImplementation(async (kind) => entitySchema(kind));
});

describe("request", () => {
  it("reads one level once and answers every later request from the cache", async () => {
    entities().request(PLANET);
    expect(entities().pending.has(viewKey(PLANET))).toBe(true);
    await until(() => expect(entities().views.has(viewKey(PLANET))).toBe(true));

    entities().request(PLANET);
    expect(getEntity).toHaveBeenCalledTimes(1);
    expect(entities().pending.size).toBe(0);
  });

  it("keeps a drilled level beside the root it was drilled from", async () => {
    entities().request(PLANET);
    entities().request(PLANET, ["coordinate"]);
    await until(() => expect(entities().views.size).toBe(2));

    expect(getEntity).toHaveBeenCalledWith(PLANET, []);
    expect(getEntity).toHaveBeenCalledWith(PLANET, ["coordinate"]);
    expect(entities().views.get(viewKey(PLANET, ["coordinate"]))?.path).toEqual(["coordinate"]);
  });

  it("keeps a refused read's message and does not ask again", async () => {
    getEntity.mockRejectedValue({ kind: "not_found", message: "no planet #1207" });
    entities().request(PLANET);
    await until(() => expect(entities().errors.get(viewKey(PLANET))).toBeDefined());

    expect(entities().errors.get(viewKey(PLANET))).toContain("no planet #1207");
    entities().request(PLANET);
    expect(getEntity).toHaveBeenCalledTimes(1);
  });

  it("reads a source per entity and a schema per kind", async () => {
    entities().requestSource(PLANET);
    entities().requestSchema("planet");
    await until(() => expect(entities().schemas.has("planet")).toBe(true));

    expect(entities().sources.get(addrKey(PLANET))?.addr).toEqual(PLANET);
    entities().requestSource(PLANET);
    entities().requestSchema("planet");
    expect(getEntitySource).toHaveBeenCalledTimes(1);
    expect(getEntitySchema).toHaveBeenCalledTimes(1);
  });
});

describe("an applied edit", () => {
  it("drops every level and the source of what it touched", async () => {
    entities().request(PLANET);
    entities().request(PLANET, ["coordinate"]);
    entities().request(FLEET);
    entities().requestSource(PLANET);
    await until(() => expect(entities().views.size).toBe(3));

    entities().noteEdit(editResult({ touched_entities: [PLANET] }));

    expect([...entities().views.keys()]).toEqual([viewKey(FLEET)]);
    expect(entities().sources.size).toBe(0);

    entities().request(PLANET);
    await until(() => expect(entities().views.has(viewKey(PLANET))).toBe(true));
    expect(getEntity).toHaveBeenCalledTimes(4);
  });

  it("throws away a read it overtook rather than caching the bytes as they were", async () => {
    let answer = (): void => undefined;
    getEntity.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = () => resolve(entityView("planet", { bytes: 1 }));
        }),
    );
    entities().request(PLANET);
    entities().noteEdit(editResult({ touched_entities: [PLANET] }));
    answer();
    await Promise.resolve();
    expect(entities().views.has(viewKey(PLANET))).toBe(false);
    expect(entities().pending.size).toBe(0);

    getEntity.mockImplementation(async (addr, path) =>
      entityView(addr.kind, { addr, path, bytes: 2 }),
    );
    entities().request(PLANET);
    await until(() => expect(entities().views.get(viewKey(PLANET))?.bytes).toBe(2));
  });

  it("lets a refused source be asked for again once the entity has been edited", async () => {
    getEntitySource.mockRejectedValue({ kind: "internal", message: "read failed" });
    entities().requestSource(PLANET);
    await until(() => expect(entities().errors.size).toBe(1));

    entities().noteEdit(editResult({ touched_entities: [PLANET] }));
    expect(entities().errors.size).toBe(0);

    getEntitySource.mockImplementation(async (addr) => entitySource(addr.kind));
    entities().requestSource(PLANET);
    await until(() => expect(entities().sources.has(addrKey(PLANET))).toBe(true));
  });
});

describe("a save body read alone", () => {
  const SYSTEM = 7;
  const BODY = 40;
  const MOON = 41;
  const getUnlistedBody = vi.mocked(ipc.getUnlistedBody);

  async function readAlone(): Promise<void> {
    entities().requestUnlisted(BODY, SYSTEM);
    await until(() => expect(entities().pending.size).toBe(0));
  }

  it.each([
    ["the body", { kind: "planet" as const, id: BODY }],
    ["a moon it hosts", { kind: "planet" as const, id: MOON }],
    ["its system, whose star class it resolves through", { kind: "system" as const, id: SYSTEM }],
  ])(
    "keeps its read through an edit to %s, and reads it again on the next request",
    async (_, addr) => {
      getUnlistedBody.mockResolvedValue(
        systemDetails({
          id: SYSTEM,
          planets: [
            planetSummary({ id: BODY }),
            planetSummary({ id: MOON, moon: true, role: "moon", parent: BODY }),
          ],
        }),
      );
      await readAlone();
      entities().requestUnlisted(BODY, SYSTEM);
      expect(getUnlistedBody).toHaveBeenCalledTimes(1);

      entities().noteEdit(editResult({ touched_entities: [addr] }));
      expect(entities().unlisted.has(BODY)).toBe(true);
      expect(entities().staleUnlisted.has(BODY)).toBe(true);

      await readAlone();
      expect(getUnlistedBody).toHaveBeenCalledTimes(2);
      expect(entities().staleUnlisted.has(BODY)).toBe(false);
    },
  );
});

describe("clear", () => {
  it("forgets everything and drops the answer to a read the closed document asked for", async () => {
    let answer = (): void => undefined;
    getEntity.mockImplementation(
      () => new Promise((resolve) => (answer = () => resolve(entityView("planet")))),
    );
    entities().request(PLANET);
    entities().clear();
    answer();
    await Promise.resolve();

    expect(entities().views.size).toBe(0);
    expect(entities().pending.size).toBe(0);
  });

  it("follows the open document: closing one forgets what was read from it", async () => {
    useFileSessionStore.setState({ status: "ready" });
    entities().request(PLANET);
    await until(() => expect(entities().views.size).toBe(1));

    useFileSessionStore.setState({ status: "empty" });
    expect(entities().views.size).toBe(0);
  });
});
