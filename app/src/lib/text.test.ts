import { describe, expect, it } from "vitest";
import { listed, savedAgo, withArticle } from "./text";

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

describe("savedAgo", () => {
  const NOW = 1_800_000_000;
  it("says how long ago, in the largest whole unit", () => {
    expect(savedAgo(NOW - 20, NOW)).toBe("just now");
    expect(savedAgo(NOW - 60, NOW)).toBe("1 minute ago");
    expect(savedAgo(NOW - 4 * 60 - 30, NOW)).toBe("4 minutes ago");
    expect(savedAgo(NOW - 3 * 3600, NOW)).toBe("3 hours ago");
    expect(savedAgo(NOW - 2 * 86400, NOW)).toBe("2 days ago");
  });
});

describe("withArticle", () => {
  it("picks a or an from the first letter", () => {
    expect(withArticle("Habitat")).toBe("a Habitat");
    expect(withArticle("Ocean world")).toBe("an Ocean world");
    expect(withArticle("arid")).toBe("an arid");
  });
});
