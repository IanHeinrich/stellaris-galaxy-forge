import type { ComponentType, ReactNode } from "react";
import { vi } from "vitest";

type Runtime = typeof import("react/jsx-dev-runtime");
const actual = await vi.importActual<Runtime>("react/jsx-dev-runtime");

/** The props of one element some component drew during a render. */
export type DrawnProps = Record<string, unknown>;

const drawn: { type: unknown; props: DrawnProps }[] = [];

/**
 * Stands in for React's JSX runtime in a component test, keeping every element a render draws so
 * the test can press the real control: `vi.mock("react/jsx-dev-runtime", () => import(...))`.
 */
export const Fragment = actual.Fragment;
export const jsxDEV: Runtime["jsxDEV"] = (type, props, ...rest) => {
  drawn.push({ type, props: props as DrawnProps });
  return actual.jsxDEV(type, props, ...rest);
};

/** Renders with what earlier renders drew forgotten, so a press reaches only what this one drew. */
export function drawnBy(render: () => string): string {
  drawn.length = 0;
  return render();
}

function text(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return "";
}

/** The props of the last element drawn that passes `test`; it throws when none does. */
export function lastDrawn(
  test: (el: { type: unknown; props: DrawnProps }) => boolean,
  what: string,
) {
  for (let i = drawn.length - 1; i >= 0; i--) if (test(drawn[i])) return drawn[i].props;
  throw new Error(`nothing drawn: ${what}`);
}

/** The last checkbox drawn. */
export function drawnCheckbox(): { onChange(): void; checked: boolean; disabled?: boolean } {
  return lastDrawn(
    ({ type, props }) => type === "input" && props.type === "checkbox",
    "checkbox",
  ) as never;
}

/** The last button drawn with `name` as its text, title or `aria-label`. */
export function drawnButton(name: string): { onClick(): void; disabled?: boolean } {
  return lastDrawn(
    ({ type, props }) =>
      type === "button" &&
      (text(props.children as ReactNode).trim() === name ||
        props.title === name ||
        props["aria-label"] === name),
    `button ${name}`,
  ) as never;
}

/** The props of the last `field` drawn with `label`, as `EditField`'s fields name themselves. */
export function drawnField<P extends { label: string }>(field: ComponentType<P>, label: string): P {
  return lastDrawn(
    ({ type, props }) => type === field && props.label === label,
    `${field.name} ${label}`,
  ) as P;
}
