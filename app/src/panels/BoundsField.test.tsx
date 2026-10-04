import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoundsField } from "./BoundsField";
import { withEdge } from "./boundsEdge";

const noop = () => undefined;

describe("a bounds field", () => {
  it("is one field where the source takes no range, and one for each end where it does", () => {
    const fixed = renderToStaticMarkup(
      <BoundsField label="Size" value={{ min: 5, max: 5 }} ranges={false} onCommit={noop} />,
    );
    expect(fixed.match(/<input/g)).toHaveLength(1);
    expect(fixed).toMatch(/aria-label="Size"[^>]*value="5"/);

    const ranged = renderToStaticMarkup(
      <BoundsField label="Size" value={{ min: 4, max: 9 }} ranges onCommit={noop} />,
    );
    expect(ranged).toMatch(/aria-label="Size min"[^>]*value="4"/);
    expect(ranged).toMatch(/aria-label="Size max"[^>]*value="9"/);
  });

  it("moves the other end along rather than crossing it", () => {
    const range = { min: 4, max: 9 };
    expect(withEdge(range, "min", 6)).toEqual({ min: 6, max: 9 });
    expect(withEdge(range, "min", 12)).toEqual({ min: 12, max: 12 });
    expect(withEdge(range, "max", 7)).toEqual({ min: 4, max: 7 });
    expect(withEdge(range, "max", 2)).toEqual({ min: 2, max: 2 });
  });
});
