/**
 * cards.js — where a card sits, and which group it belongs to.
 *
 * The companion to the chat window. That draws one conversation; this one holds
 * the arithmetic a host needs to lay several of them out and draw a box round
 * the ones that belong together.
 *
 * Everything here is pure. No DOM, no filesystem, no Node built-ins, no state
 * of its own: plain objects in, plain objects out. That is what lets the same
 * file serve an Electron main process reasoning about a canvas it never draws
 * and a browser page drawing one it never persists.
 *
 * What it deliberately does not do is store anything. A host owns its own
 * file — board.json, canvas.json, whatever it already has — and this module
 * never learns its shape. Same boundary the Node engine draws: a session has
 * no opinion on where it is drawn, and a layout has no opinion on where it is
 * written down.
 *
 * Two shapes run through all of it:
 *
 *   Geometry  {x, y, width, height, z}   where one card sits
 *   Rect      {x, y, width, height}      the box around a group of them
 *
 * Usable two ways, the same as the chat bundle. As a module:
 *
 *   import { arrangeRow, nextZ } from '@tiagopedras/ai-chat-engine/cards.js'
 *
 * or as a script, which sets one global:
 *
 *   <script type="module" src="/ai-chat/cards.js"></script>
 *   AICards.arrangeRow(...)
 *
 * A module script is deferred, so the global is not there for a classic
 * script running at parse time. Every host so far reads it when something is
 * drawn rather than at load, which is long after that.
 */

/** Where a card lands when nothing has said otherwise. */
export const DEFAULT_GEOMETRY = { x: 80, y: 80, width: 320, height: 190, z: 1 };

/**
 * How a group is laid out: the gap between cards dealt out in a row, the
 * padding inside its box, and the bar along the top that the box has to leave
 * room for.
 *
 * `fallbackHeight` is for a card whose real height has not been measured yet.
 * A card grows to fit its own content, so its stored height is a starting
 * guess rather than a fact, and a host that has measured passes what it
 * measured instead.
 */
export const LAYOUT = { gap: 20, pad: 18, head: 34, fallbackHeight: 190 };

/**
 * A card's durable identity: the session id once it exists, and whatever
 * temporary id the host made until then.
 *
 * A card exists before its session does. It is on screen, it has a place, it
 * can already be filed, and only once the first event comes back does it
 * learn the id that will survive a restart. Anything keyed on identity has to
 * go through here rather than reaching for either id on its own, or a card
 * gets filed under one and looked up under the other.
 */
export function keyOf(card) {
  return (card && (card.sessionId || card.id)) || '';
}

/**
 * The depth that puts something above everything already on the canvas.
 *
 * Cards and groups share one pool rather than having a layer each, so a card
 * brought to the front outranks every group too, and a group brought to the
 * front outranks every card. Two pools would mean a card that could never be
 * lifted above a box, which is not something a person would ever expect.
 *
 * Takes anything with a `z`, in as many lists as the host has.
 */
export function nextZ() {
  var top = 0;
  for (var i = 0; i < arguments.length; i++) {
    var items = arguments[i];
    if (!items) continue;
    var list = typeof items.values === 'function' ? Array.from(items.values()) : items;
    for (var j = 0; j < list.length; j++) {
      var z = list[j] && list[j].z;
      if (typeof z === 'number' && z > top) top = z;
    }
  }
  return top + 1;
}

/** A card's starting place: the default, whatever the host asked for on top
    of it, and a depth that puts it above everything already there. */
export function placeCard(geometry, z) {
  return Object.assign({}, DEFAULT_GEOMETRY, geometry || {}, { z: z });
}

/**
 * Deals cards out in a row and returns the box that holds them.
 *
 * Ordering is by where the cards already are, left to right, so a card
 * dropped to the right of a group does not jump to the front of it. The
 * arrangement is the point of the gesture: dropping one card onto another
 * leaves it sitting on top, which is a stack rather than a group, and the
 * grouping is not legible until they have been separated.
 *
 * Returns `{cards, rect}` and moves nothing itself. The host applies both.
 * With no members it returns an empty list and a null rect, since there is
 * nothing to derive a box from.
 */
export function arrangeRow(members, layout) {
  var L = Object.assign({}, LAYOUT, layout || {});
  var list = (members || []).slice().sort(function (a, b) {
    return a.geometry.x - b.geometry.x;
  });
  if (list.length === 0) return { cards: [], rect: null };

  var left = Math.min.apply(null, list.map(function (c) { return c.geometry.x; }));
  var top = Math.min.apply(null, list.map(function (c) { return c.geometry.y; }));

  var x = left;
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var card = list[i];
    out.push({ id: card.id, geometry: Object.assign({}, card.geometry, { x: x, y: top }) });
    x += card.geometry.width + L.gap;
  }

  var height = Math.max.apply(null, list.map(function (c) { return c.geometry.height; }));
  return {
    cards: out,
    rect: {
      x: left - L.pad,
      y: top - L.pad - L.head,
      width: x - L.gap - left + L.pad * 2,
      height: height + L.pad * 2 + L.head
    }
  };
}

/**
 * A box big enough for what is in it.
 *
 * A group is resizable by hand, and the box is stored, so this is the floor
 * rather than the answer: it grows a hand-set box to cover its members and
 * never shrinks one, so dragging a corner inwards past the cards is allowed
 * as a gesture and simply has no effect below that floor. A card can then
 * never end up outside its own group.
 *
 * `heights` is measured heights by card id, for cards that have grown past
 * what they were stored as. Anything missing falls back.
 *
 * A box with no size yet — one made a moment ago, or restored from a file
 * written before groups had a box — comes back as its members' own extent.
 * With no members either there is nothing to derive one from, so it comes
 * back null and the host decides where to stand it.
 */
export function containBox(rect, members, heights, layout) {
  var L = Object.assign({}, LAYOUT, layout || {});
  var h = heights || {};
  var list = members || [];

  if (list.length === 0) {
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  var left = Math.min.apply(null, list.map(function (c) { return c.geometry.x; })) - L.pad;
  var top = Math.min.apply(null, list.map(function (c) { return c.geometry.y; })) - L.pad - L.head;
  var right = Math.max.apply(null, list.map(function (c) {
    return c.geometry.x + c.geometry.width;
  })) + L.pad;
  var bottom = Math.max.apply(null, list.map(function (c) {
    var measured = h[c.id];
    return c.geometry.y + (typeof measured === 'number' ? measured : L.fallbackHeight);
  })) + L.pad;

  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  var x = Math.min(rect.x, left);
  var y = Math.min(rect.y, top);
  return {
    x: x,
    y: y,
    width: Math.max(rect.x + rect.width, right) - x,
    height: Math.max(rect.y + rect.height, bottom) - y
  };
}

/**
 * Moves a box and everything in it by the same amount.
 *
 * Dragging a group by its bar moves the work, not just the frame around it.
 * Returns `{rect, cards}` and moves nothing itself.
 */
export function shiftBox(rect, members, dx, dy) {
  return {
    rect: rect ? Object.assign({}, rect, { x: rect.x + dx, y: rect.y + dy }) : null,
    cards: (members || []).map(function (card) {
      return {
        id: card.id,
        geometry: Object.assign({}, card.geometry, {
          x: card.geometry.x + dx,
          y: card.geometry.y + dy
        })
      };
    })
  };
}

/**
 * Turns the durable keys a group was filed under into the ids its cards are
 * called right now.
 *
 * Membership is stored against the identity that survives a restart, because
 * that is the only one that does. The id a card carries on screen is not.
 * Every read has to translate, and a member whose card is not on the canvas
 * any more is simply dropped rather than returned as a hole — resolving this
 * anywhere but one place is what once had a group of three reporting the
 * wrong count.
 */
export function resolveMembers(keys, cards) {
  var list = cards || [];
  var out = [];
  for (var i = 0; i < (keys || []).length; i++) {
    var key = keys[i];
    var hit = null;
    for (var j = 0; j < list.length; j++) {
      if (keyOf(list[j]) === key) { hit = list[j]; break; }
    }
    if (!hit) {
      for (var k = 0; k < list.length; k++) {
        if (list[k].id === key) { hit = list[k]; break; }
      }
    }
    if (hit) out.push(hit.id);
  }
  return out;
}

/** The cards a group holds, as cards rather than ids. The companion to
    resolveMembers, for a host that wants the objects it is about to measure. */
export function membersOf(keys, cards) {
  var ids = resolveMembers(keys, cards);
  return ids
    .map(function (id) {
      return (cards || []).find(function (c) { return c.id === id; });
    })
    .filter(Boolean);
}

/* The global, for a host loading this with a script tag rather than an
   import. Same shape as the named exports, same objects. */
if (typeof globalThis !== 'undefined') {
  globalThis.AICards = {
    DEFAULT_GEOMETRY: DEFAULT_GEOMETRY,
    LAYOUT: LAYOUT,
    keyOf: keyOf,
    nextZ: nextZ,
    placeCard: placeCard,
    arrangeRow: arrangeRow,
    containBox: containBox,
    shiftBox: shiftBox,
    resolveMembers: resolveMembers,
    membersOf: membersOf
  };
}
