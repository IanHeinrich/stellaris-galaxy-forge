/** What a body's page and the system view's menus offer to edit, from the document's capabilities. */
import type { Capabilities } from "../../generated/Capabilities";

/** What the offers read of one body. */
export interface PlanetFacts {
  /** A star, which has its own fields in place of a planet's. */
  star: boolean;
  /** A body the Ring checkbox suits, found in its system's read details. */
  ringable: boolean;
  /** A body a moon can be added around. */
  moonHost: boolean;
}

/** Empty space in the system view, which no body stands in. */
export const NO_BODY: PlanetFacts = { star: false, ringable: false, moonHost: false };

export interface PlanetOffers {
  /** A planet's name and size. */
  planetFields: boolean;
  /** A star's type and size. */
  starFields: boolean;
  /** A planet's class and model. */
  planetClass: boolean;
  modifiers: boolean;
  digSite: boolean;
  /** The game places some anomalies on stars, so a star takes one too. */
  anomaly: boolean;
  deposits: boolean;
  ring: boolean;
  /** The System field that moves a planet into another system. */
  move: boolean;
  addPlanet: boolean;
  addMoon: boolean;
  /** The system view's Add megastructure, on a body or in empty space. */
  addMegastructure: boolean;
  /** Any body's Delete in its menu; the core says why one cannot go, a star among them. */
  deleteBody: boolean;
  /** The page's Delete and Remove colony, which a star's page leaves out. */
  pageRemoval: boolean;
}

export function planetPageOffers(
  capabilities: Capabilities,
  facts: PlanetFacts = NO_BODY,
): PlanetOffers {
  const planet = !facts.star;
  return {
    planetFields: capabilities.bodies && planet,
    starFields: capabilities.bodies && facts.star,
    planetClass: capabilities.planet_classes && planet,
    modifiers: capabilities.modifiers && planet,
    digSite: capabilities.dig_sites && planet,
    anomaly: capabilities.anomalies,
    deposits: capabilities.deposits,
    ring: capabilities.geometry && facts.ringable,
    move: capabilities.planet_moves,
    addPlanet: capabilities.add_bodies,
    addMoon: capabilities.add_bodies && facts.moonHost,
    addMegastructure: capabilities.add_megastructures,
    deleteBody: capabilities.remove_bodies,
    pageRemoval: capabilities.remove_bodies && planet,
  };
}

/** What a body's Overview shows beside the fields its offers give. */
export interface OverviewParts {
  /** A star's own fields. */
  starBlock: boolean;
  /** The line shown in their place while the star's system is read. */
  starWait: boolean;
  /** Plain rows for the class, size and ring no field shows. */
  classRow: boolean;
  sizeRow: boolean;
  ringRow: boolean;
}

/**
 * The parts of a body's Overview: `listed` where its system's details list it, `sized` where it
 * has a size, and `systemRead` once its system is read.
 */
export function overviewParts(
  offers: PlanetOffers,
  body: { star: boolean; listed: boolean; sized: boolean; systemRead: boolean },
): OverviewParts {
  const starFields = offers.starFields && body.listed;
  return {
    starBlock: starFields && body.systemRead,
    starWait: starFields && !body.systemRead,
    classRow: !offers.planetClass && !starFields,
    sizeRow: body.sized && !offers.planetFields && !starFields,
    ringRow: !body.star && !offers.ring && body.listed,
  };
}
