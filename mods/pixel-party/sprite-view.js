// Sprite to element, with a look and a motion per agent status.
// Contract: docs/DESIGN.md, "Contract: sprite-view.js".
//
// Every pixel is an absolutely positioned div. Moving parts sit in their own full-size
// layers so one `.loop("top", ...)` moves the whole part. Motion is native (`.loop`) and
// costs no script time. Each status also differs in a still frame: eyes and accents change,
// not only the motion, because a screenshot is one frame.
//
//   null     open eyes, still
//   working  eyes glance right, feet step in turn, body bobs, speed lines behind
//   blocked  open eyes, still, a blinking "!" badge in the top right corner
//   done     happy ^ ^ eyes, hops, two sparkles twinkle in turn
//   idle     closed eyes, dimmed, breathes slowly, a fading "z"
//
// A hit (lines its agent added or removed) adds, on top of any status, a flash of the
// creature's silhouette and a knock: up for added lines, sideways for removed ones. Both
// start at full strength and ease back with `.transition`, so the caller renders a hit
// twice: `live` first, then settled.

import { div } from "gpui-kit";
import { theme } from "herdr";
import { GRID } from "./sprites.js";

/** @import { Color, Element } from "gpui-kit" */
/** @import { Status } from "herdr" */
/** @import { Mood, Rect, Sprite } from "./sprites.js" */

/**
 * `theme()`, its values typed as the hex colors they are so they can go to `.bg()`.
 * `herdr.d.ts` declares them as plain strings.
 * @typedef {Record<string, Color>} Theme
 */

/** @type {(r: Rect, u: number) => Element} One rectangle, `u` px per cell. */
const cell = (r, u) => div().absolute().left(r.x * u).top(r.y * u).w(r.w * u).h(r.h * u).bg(r.color);
/** @type {(rects: Rect[], u: number) => Element} A full-size layer of rectangles. */
const layer = (rects, u) => div().absolute().left(0).top(0).size(GRID * u).children(rects.map((r) => cell(r, u)));

/** @typedef {[x: number, y: number, w?: number, h?: number][]} Cells w and h default to 1. */

/**
 * Rectangles in cells, for accents. Any color.
 * @param {Cells} cells
 * @param {Color} color
 * @param {number} u
 * @returns {Element}
 */
const mark = (cells, color, u) => layer(cells.map(([x, y, w = 1, h = 1]) => ({ x, y, w, h, color })), u);

/** The colors of hits: added lines heal, removed lines hurt. */
export const HIT = /** @type {const} */ ({ added: "#3ddc6a", removed: "#ff4d5e" });

/**
 * A hit as the sprite shows it.
 * @typedef {object} SpriteHit
 * @property {number} n The hit's number: a new number is a new hit, drawn from the start.
 * @property {boolean} damage Lines were removed: a red flash and a sideways knock.
 * @property {boolean} live Its first frame, at full strength. Settled, it eases back.
 */

/** @type {Partial<Record<Status, Mood>>} */
const EYES = { working: "look", done: "happy", idle: "closed" };

/**
 * The status's marks, drawn behind or in front of the creature.
 * @param {Status | null} status
 * @param {number} u
 * @returns {{ behind: Element[], front: Element[] }}
 */
function accents(status, u) {
  const t = /** @type {Theme} */ (theme());
  switch (status) {
    case "working": {
      const lines = mark([[0, 5], [0, 7]], t.working, u);
      return { behind: [lines.loop("opacity", { from: 1, to: 0.25, period: 480 })], front: [] };
    }
    case "blocked": {
      // A badge over the top right corner: a theme-colored tile with a white "!".
      const badge = div().absolute().left(9 * u).top(0).w(3 * u).h(5 * u).rounded(u).bg(t.blocked)
        .child(div().absolute().left(u).top(Math.round(u / 2)).w(u).h(2 * u).bg("#ffffff"))
        .child(div().absolute().left(u).top(Math.round(3.25 * u)).w(u).h(u).bg("#ffffff"));
      return { behind: [], front: [badge.loop("opacity", { from: 1, to: 0.35, period: 800 })] };
    }
    case "done": {
      /** @type {(x: number, y: number) => Cells} A plus sign centered on x, y. */
      const plus = (x, y) => [[x - 1, y, 3, 1], [x, y - 1, 1, 3]];
      const a = mark(plus(1, 1), t.done, u).loop("opacity", { from: 1, to: 0.15, period: 900 });
      const b = mark(plus(10, 3), t.done, u).loop("opacity", { from: 0.15, to: 1, period: 900 });
      return { behind: [a, b], front: [] };
    }
    case "idle": {
      // Behind the creature, so it shows only where the art leaves room.
      const z = mark([[8, 0, 4, 1], [10, 1], [9, 2], [8, 3, 4, 1]], t.idle, u);
      return { behind: [z.loop("opacity", { from: 1, to: 0.3, period: 2600 })], front: [] };
    }
    default:
      return { behind: [], front: [] };
  }
}

/**
 * A sprite as an element, with the look and motion of its agent's status.
 * @param {Sprite} sprite
 * @param {object} options
 * @param {string} options.id The element id: unique in the view and stable across renders.
 * @param {number} [options.px] Pixels per cell (default 3).
 * @param {Status | null} [options.status] The agent's status; null draws it still.
 * @param {SpriteHit | null} [options.hit] A hit being shown, or null.
 * @returns {Element} GRID * px square.
 */
export function spriteElement(sprite, { id, px: u = 3, status = null, hit = null } = /** @type {any} */ ({})) {
  if (typeof id !== "string" || !id) throw new TypeError("spriteElement needs an id");
  const size = GRID * u;
  const { body, feet, eyes } = sprite.parts;
  const nudge = Math.max(1, Math.round(u / 3)); // a sub-cell move, at least one pixel

  const left = layer(feet[0], u);
  const right = layer(feet[1], u);
  const torso = div().absolute().left(0).top(0).size(size)
    .child(layer(body, u))
    .child(layer(eyes[EYES[status] ?? "open"], u));
  const figure = div().absolute().left(0).top(0).size(size);

  if (status === "working") {
    // Feet in turn: swapped from/to puts them half a stride apart.
    left.loop("top", { from: 0, to: -u, period: 480 });
    right.loop("top", { from: -u, to: 0, period: 480 });
    torso.loop("top", { from: 0, to: -nudge, period: 240 });
  } else if (status === "done") {
    figure.loop("top", { from: 0, to: -u, period: 700, easing: "ease-out" });
  } else if (status === "idle") {
    torso.loop("top", { from: 0, to: nudge, period: 2600 });
    figure.opacity(0.75);
  }
  figure.child(left).child(right).child(torso);

  const { behind, front } = accents(status, u);
  return div().id(id).relative().size(size).flex_none().children([...behind, hit ? struck(figure, sprite, id, u, hit) : figure, ...front]);
}

/**
 * The figure taking a hit: knocked out of place under a flash of its silhouette.
 * The ids carry the hit's number, so a new hit starts over rather than easing from the last.
 * @param {Element} figure
 * @param {Sprite} sprite
 * @param {string} id
 * @param {number} u
 * @param {SpriteHit} hit
 * @returns {Element}
 */
function struck(figure, sprite, id, u, hit) {
  const { body, feet } = sprite.parts;
  const color = hit.damage ? HIT.removed : HIT.added;
  const flash = layer([...body, ...feet[0], ...feet[1]].map((r) => ({ ...r, color })), u)
    .id(`${id}-flash-${hit.n}`)
    .opacity(hit.live ? 0.9 : 0)
    .transition("opacity", { duration: 320, easing: "ease-out" });
  return div()
    .id(`${id}-knock-${hit.n}`)
    .absolute()
    .left(hit.live && hit.damage ? -u : 0)
    .top(hit.live && !hit.damage ? -u : 0)
    .size(GRID * u)
    .transition("left", { duration: 220, easing: "ease-out" })
    .transition("top", { duration: 220, easing: "ease-out" })
    .child(figure)
    .child(flash);
}
