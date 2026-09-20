import { isValidElement, type ReactElement, type ReactNode } from "react";

/**
 * Walks a pure element tree, calling function components to reach their handlers. This is safe
 * only for components that take no hooks of their own, since it runs outside React's render pass.
 */
export function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    return elements((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return [element, ...elements(element.props.children)];
}
