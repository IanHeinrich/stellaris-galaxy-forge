import { describe, expect, it } from "vitest";
import { listed, withArticle } from "./text";

describe("listed", () => {
  it("joins with and, without a comma before the last", () => {
    expect(listed([], "and")).toBe("");
    expect(listed(["a"], "and")).toBe("a");
    expect(listed(["a", "b"], "and")).toBe("a and b");
    expect(listed(["a", "b", "c"], "and")).toBe("a, b and c");
  });

  it("joins with or the same way", () => {
    expect(listed(["a"], "or")).toBe("a");
    expect(listed(["a", "b"], "or")).toBe("a or b");
    expect(listed(["Kanthe II", "Kanthe III", "Kanthe IV"], "or")).toBe(
      "Kanthe II, Kanthe III or Kanthe IV",
    );
  });
});

describe("withArticle", () => {
  it("picks a or an from the first letter", () => {
    expect(withArticle("Habitat")).toBe("a Habitat");
    expect(withArticle("Ocean world")).toBe("an Ocean world");
    expect(withArticle("arid")).toBe("an arid");
  });
});
