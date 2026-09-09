/**
 * Types for cards.js. The file itself is plain JavaScript, on purpose — it
 * has to load in a browser with no build step — so the types live beside it
 * rather than in it.
 */

export interface CardGeometry {
  x: number
  y: number
  width: number
  height: number
  z: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The least a card has to be for anything here to place it. A host's own
    card type is this plus everything else it knows. */
export interface PlacedCard {
  id: string
  geometry: CardGeometry
}

/** A card's two identities. `sessionId` is null until the session exists. */
export interface IdentifiedCard {
  id: string
  sessionId?: string | null
}

export interface Layout {
  gap: number
  pad: number
  head: number
  fallbackHeight: number
}

export declare const DEFAULT_GEOMETRY: CardGeometry
export declare const LAYOUT: Layout

export declare function keyOf(card: IdentifiedCard): string

/** Anything with a `z`, in as many lists (arrays or Maps) as the host has. */
export declare function nextZ(
  ...groups: Array<Iterable<{ z: number }> | { values(): Iterable<{ z: number }> } | null | undefined>
): number

export declare function placeCard(
  geometry: Partial<CardGeometry> | undefined,
  z: number
): CardGeometry

export declare function arrangeRow<T extends PlacedCard>(
  members: T[],
  layout?: Partial<Layout>
): { cards: PlacedCard[]; rect: Rect | null }

export declare function containBox<T extends PlacedCard>(
  rect: Rect | undefined | null,
  members: T[],
  heights?: Record<string, number>,
  layout?: Partial<Layout>
): Rect | null

export declare function shiftBox<T extends PlacedCard>(
  rect: Rect | null | undefined,
  members: T[],
  dx: number,
  dy: number
): { rect: Rect | null; cards: PlacedCard[] }

export declare function resolveMembers<T extends IdentifiedCard>(
  keys: string[],
  cards: T[]
): string[]

export declare function membersOf<T extends IdentifiedCard>(
  keys: string[],
  cards: T[]
): T[]
