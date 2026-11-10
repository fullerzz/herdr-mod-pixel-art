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

import { div } from "gpui-kit";
import { theme } from "herdr";
import { GRID } from "./sprites.js";

const cell = (r, u) => div().absolute().left(r.x * u).top(r.y * u).w(r.w * u).h(r.h * u).bg(r.color);
const layer = (rects, u) => div().absolute().left(0).top(0).size(GRID * u).children(rects.map((r) => cell(r, u)));

/** Rectangles in cells, for accents. Any color. */
const mark = (cells, color, u) => layer(cells.map(([x, y, w = 1, h = 1]) => ({ x, y, w, h, color })), u);

const EYES = { working: "look", done: "happy", idle: "closed" };

function accents(status, u) {
  const t = theme();
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

export function spriteElement(sprite, { id, px: u = 3, status = null } = {}) {
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
  return div().id(id).relative().size(size).flex_none().children([...behind, figure, ...front]);
}
