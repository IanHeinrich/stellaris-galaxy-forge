import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeightMark } from "./HeightMark";

describe("the height mark", () => {
  it("draws the star on a drop line over its hexagon, in the text colour by default", () => {
    const html = renderToStaticMarkup(<HeightMark />);
    expect(html).toContain("<polygon");
    expect(html).toContain("<line");
    expect(html).toContain('<circle cx="8" cy="3.6"');
    expect(html).toContain('stroke="currentColor"');
  });

  it("drops the line for a star on the plane, and takes the colour it is given", () => {
    const html = renderToStaticMarkup(<HeightMark plane={12} star={12} color="#abcdef" />);
    expect(html).not.toContain("<line");
    expect(html).toContain('fill="#abcdef"');
  });
});
