import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NameTemplate } from "../generated/NameTemplate";
import { useGameDataStore } from "../store/gameDataStore";
import {
  displayName,
  displayNameExpr,
  displayTemplate,
  planetName,
  stripped,
  templateKey,
  templateKeys,
  templateName,
} from "./names";

const requestName = vi.fn();

beforeEach(() => {
  requestName.mockClear();
  useGameDataStore.setState({ names: new Map(), status: "idle", requestName });
});

function plain(key: string): NameTemplate {
  return { key, literal: false, variables: [] };
}

function literal(key: string): NameTemplate {
  return { key, literal: true, variables: [] };
}

function template(key: string, variables: Record<string, NameTemplate>): NameTemplate {
  return {
    key,
    literal: false,
    variables: Object.entries(variables).map(([name, value]) => ({ name, value })),
  };
}

const PLANET_III = template("PLANET_NAME_FORMAT", {
  PARENT: plain("PRESCRIPTED_system_name_xt489"),
  NUMERAL: literal("III"),
});

const CYGGAN = {
  name: template("%ADJECTIVE%", { adjective: plain("SPEC_Cyggan"), "1": plain("Protectors") }),
  name_key: "SPEC_Cyggan Protectors",
};

function ready(names: Iterable<[string, string]> = []): void {
  useGameDataStore.setState({ names: new Map(names), status: "ready" });
}

describe("stripped", () => {
  it("strips the NAME_ prefix and underscores", () => {
    expect(stripped("NAME_Gamma_Refuge")).toBe("Gamma Refuge");
  });
  it("leaves plain names alone", () => {
    expect(stripped("Grugmora")).toBe("Grugmora");
  });
});

describe("displayName", () => {
  it("prefers the localised name when the store has one", () => {
    useGameDataStore.setState({ names: new Map([["NAME_Gamma_Refuge", "Gamma Refuge Prime"]]) });
    expect(displayName("NAME_Gamma_Refuge")).toBe("Gamma Refuge Prime");
  });
  it("falls back to the stripped key when the store has no name", () => {
    expect(displayName("NAME_Gamma_Refuge")).toBe("Gamma Refuge");
  });
});

describe("displayNameExpr", () => {
  it("localises a key-shaped token and leaves plain words alone", () => {
    useGameDataStore.setState({ names: new Map([["SPEC_RihiNar", "Rihi'Nar"]]) });
    expect(displayNameExpr("SPEC_RihiNar Sovereignty")).toBe("Rihi'Nar Sovereignty");
  });
  it("strips an unknown key-shaped token instead of leaving it raw", () => {
    expect(displayNameExpr("SPEC_RihiNar Sovereignty")).toBe("RihiNar Sovereignty");
    expect(displayNameExpr("EMPIRE_DESIGN_humans1")).toBe("EMPIRE DESIGN humans1");
  });
  it("localises plain words too, since the game does", () => {
    useGameDataStore.setState({ names: new Map([["GrandDuchy", "Grand Duchy"]]) });
    expect(displayNameExpr("GrandDuchy SPEC_Zelvan_system")).toBe("Grand Duchy Zelvan system");
  });
});

describe("templateKey", () => {
  it("writes the whole shape, so two templates share an entry only when they agree", () => {
    expect(templateKey(PLANET_III)).toBe(
      "PLANET_NAME_FORMAT{PARENT=PRESCRIPTED_system_name_xt489{},NUMERAL=!III{}}",
    );
    expect(templateKey(plain("III"))).not.toBe(templateKey(literal("III")));
  });

  it("is never a localisation key, so a plain key keeps its own entry", () => {
    expect(templateKey(plain("NAME_Sol"))).toBe("NAME_Sol{}");
  });
});

describe("templateName", () => {
  it("shows the text the backend resolved", () => {
    ready([[templateKey(CYGGAN.name), "Cyggan Protectors"]]);
    expect(templateName(CYGGAN)).toBe("Cyggan Protectors");
    expect(planetName(CYGGAN)).toBe("Cyggan Protectors");
    expect(requestName).not.toHaveBeenCalled();
  });

  it("asks for a name it has not got, and stands in with the key meanwhile", () => {
    ready();
    expect(templateName(CYGGAN)).toBe("Cyggan Protectors");
    expect(requestName).toHaveBeenCalledWith(CYGGAN.name);
  });

  it("falls back to the stand-in key without game data, and asks for nothing", () => {
    expect(templateName(CYGGAN)).toBe("Cyggan Protectors");
    expect(templateName({ ...CYGGAN, name_key: "SPEC_Cyggan_Protectors Union" })).toBe(
      "Cyggan Protectors Union",
    );
    expect(requestName).not.toHaveBeenCalled();
  });
});

describe("displayTemplate", () => {
  it("shows the text the backend resolved", () => {
    ready([[templateKey(PLANET_III), "Xt489 III"]]);
    expect(displayTemplate(PLANET_III)).toBe("Xt489 III");
  });

  it("localises the backend's stand-in token-wise until game data is loaded", () => {
    const key = templateKey(CYGGAN.name);
    useGameDataStore.setState({ names: new Map([[key, "SPEC_Cyggan Protectors"]]) });
    expect(displayTemplate(CYGGAN.name)).toBe("Cyggan Protectors");

    ready([[key, "Cyggan Protectors"]]);
    expect(displayTemplate(CYGGAN.name)).toBe("Cyggan Protectors");
  });

  it("is empty until the backend answers, which it is asked for either way", () => {
    ready();
    expect(displayTemplate(PLANET_III)).toBe("");
    expect(requestName).toHaveBeenCalledWith(PLANET_III);

    useGameDataStore.setState({ status: "idle" });
    requestName.mockClear();
    expect(displayTemplate(PLANET_III)).toBe("");
    expect(requestName).toHaveBeenCalledWith(PLANET_III);
  });
});

describe("templateKeys", () => {
  it("asks for a sequential name's number format alone", () => {
    const seq = template("%SEQ%", { fmt: plain("HUMAN1_FLEET"), num: literal("1") });
    expect(templateKeys(seq)).toEqual(["HUMAN1_FLEET"]);
  });

  it("collects every non-literal key depth-first and skips literals", () => {
    const moon = template("SUBPLANET_NAME_FORMAT", { PARENT: PLANET_III, NUMERAL: literal("a") });
    expect(templateKeys(moon)).toEqual([
      "SUBPLANET_NAME_FORMAT",
      "PARENT",
      "PLANET_NAME_FORMAT",
      "PARENT",
      "PRESCRIPTED_system_name_xt489",
      "NUMERAL",
      "NUMERAL",
    ]);
  });
});
