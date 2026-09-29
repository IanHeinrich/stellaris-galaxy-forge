import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** What a test does with a button it found: press it, or ask whether it can be pressed. */
type ButtonElement = ReactElement<{ onClick(): void; disabled?: boolean }>;

/**
 * Walks a pure element tree, calling function components to reach their handlers. This is safe
 * only for components that take no hooks of their own, since it runs outside React's render pass:
 * one that calls React's own hooks, such as a submenu, is passed over with what it holds. Any
 * other error it throws reaches the test.
 */
export function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    let rendered: ReactNode;
    try {
      rendered = (element.type as (props: unknown) => ReactNode)(element.props);
    } catch (e) {
      if (hookOutsideRender(e)) return [];
      throw e;
    }
    return elements(rendered);
  }
  return [element, ...elements(element.props.children)];
}

/**
 * Whether `e` is what React throws when a hook runs with no render pass to hold it: its hook
 * dispatcher is null, so reading `useState`, `useEffect` or another hook off it fails.
 */
function hookOutsideRender(e: unknown): boolean {
  return (
    e instanceof TypeError &&
    /^Cannot read properties of null \(reading 'use\w*'\)$/.test(e.message)
  );
}

/** The first button in `tree` named `label`, by its `aria-label` or its whole text; undefined with none. */
export function buttonIn(tree: ReactNode, label: string): ButtonElement | undefined {
  return elements(tree).find(
    (el): el is ButtonElement =>
      el.type === "button" &&
      ((el.props as { "aria-label"?: string })["aria-label"] === label ||
        renderToStaticMarkup(el).includes(`>${label}<`)),
  );
}

/** The menu's button reading `label`, whose `onClick` a test calls in place of a click. */
export function menuItem(tree: ReactNode, label: string): ButtonElement {
  const item = buttonIn(tree, label);
  if (!item) throw new Error(`no menu item reading "${label}"`);
  return item;
}

/** `text` as the markup writes it, where an apostrophe is an entity. */
export function escaped(text: string): string {
  return text.replace(/'/g, "&#x27;");
}

/** The text a reader sees: no markup, no attributes, one space between words. */
export function shown(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The label of every button, in order. */
export function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => shown(m[1]));
}
