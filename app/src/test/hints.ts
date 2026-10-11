/** What a row's hover card says, for the tests that render a page with `drawn`'s runtime. */
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Hinted } from "../panels/inspector/states";
import { lastDrawn } from "./drawn";

/** The markup of the card the last value labelled `label` shows on hover; it throws when none has one. */
export function hintOf(label: string): string {
  const props = lastDrawn(
    ({ type, props }) => type === Hinted && props.label === label,
    `the ${label} card`,
  );
  return renderToStaticMarkup(createElement(Fragment, null, props.hint as ReactNode));
}
