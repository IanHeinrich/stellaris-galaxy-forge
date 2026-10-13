import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "./capabilities";
import { isDocumentKind, kindCapabilities } from "./documentKinds";

describe("the document kinds", () => {
  it("know every kind and nothing else", () => {
    expect(isDocumentKind("save")).toBe(true);
    expect(isDocumentKind("scenario")).toBe(true);
    expect(isDocumentKind("toString")).toBe(false);
    expect(isDocumentKind("initializers")).toBe(false);
    expect(isDocumentKind(null)).toBe(false);
  });

  it("report what each kind supports, a save's set while no document is open", () => {
    expect(kindCapabilities("save")).toBe(SAVE_CAPABILITIES);
    expect(kindCapabilities("scenario")).toBe(SCENARIO_CAPABILITIES);
    expect(kindCapabilities(null).scripted_owners).toBe(false);
  });
});
