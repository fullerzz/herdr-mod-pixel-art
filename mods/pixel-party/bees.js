// Worker bees: one small figure per helper an agent has running.
// Contract: docs/DESIGN.md, "Contract: bees.js".
//
// A helper is one of two things:
// - a terminal the agent started with `hc run`: the core records the starter as `parent`.
//   Herdr herds these itself, so each is a sheep;
// - a sub-agent inside the agent's own program. Herdr can't see those, so the agent's hooks
//   say so with a label per sub-agent on the agent's terminal (`tools/bee-hook.sh`). Each
//   is a honey bee.

import { div } from "gpui-kit";
import { terminals, theme } from "herdr";

/** @import { Color, Element } from "gpui-kit" */
/** @import { Theme } from "./sprite-view.js" */

/** The label prefix of a running sub-agent: `pixel.bee.<id>`. */
export const BEE = "pixel.bee.";

/** How a bee looks: flying, asking for attention, or resting. */
/** @typedef {"working" | "blocked" | "idle"} BeeStatus */

/** What a helper is drawn as: a sheep for an `hc` terminal, a honey bee for a sub-agent. */
/** @typedef {"sheep" | "bee"} BeeKind */

/**
 * One helper.
 * @typedef {object} Bee
 * @property {string} key Unique among its agent's bees and stable while the helper lives.
 * @property {BeeKind} kind
 * @property {BeeStatus} status
 */

// A helper that reports no status is a plain command (a test run, a build): it works for
// as long as it lives. A finished agent rests: its parent's "done" is the news, not its own.
/** @type {(status: unknown) => BeeStatus} */
const statusOf = (status) => {
  if (status === "blocked" || status === "error") return "blocked";
  return status === "idle" || status === "done" ? "idle" : "working";
};

/**
 * The bees of one agent: its live `hc` helpers and theirs, even when the helper that
 * started one has ended, then its sub-agents. A helper that has a row of its own is still
 * a bee here, but keeps its own helpers.
 * @param {string} address The agent's terminal.
 * @param {ReadonlySet<string>} [rows] The addresses that have a row of their own.
 * @param {any[]} [all] `terminals()`.
 * @returns {Bee[]}
 */
export function beesOf(address, rows = new Set(), all = terminals()) {
  /** @type {Bee[]} */
  const out = [];
  const seen = new Set([address]);
  // The walk goes through ended helpers too: a live helper whose starter has ended is
  // still the agent's.
  /** @type {(parent: string) => void} */
  const visit = (parent) => {
    for (const k of all) {
      if (k.parent !== parent || seen.has(k.address)) continue;
      seen.add(k.address);
      if (k.state === "live") out.push({ key: k.address, kind: "sheep", status: statusOf(k.status) });
      if (!rows.has(k.address)) visit(k.address);
    }
  };
  visit(address);
  const labels = all.find((x) => x.address === address)?.labels ?? {};
  for (const key of Object.keys(labels).sort()) {
    if (key.startsWith(BEE) && key.length > BEE.length && labels[key]) out.push({ key, kind: "bee", status: "working" });
  }
  return out;
}

// ---- the figures ----
// Both are seven cells by five and face right. The bee: wings over a striped body, a dark
// head, a stinger. The sheep: a fleece with a shaded belly, a dark face, two legs.

export const BEE_W = 7;
export const BEE_H = 5;

const AMBER = "#f7b521";
const DARK = "#2b1b0e";
const WING = "#e6f5ff";

/** @typedef {[x: number, y: number, w: number, h: number]} Cells */
/** @type {Cells[]} */
const WINGS = [[3, 0, 2, 1], [2, 1, 3, 1]];
/** @type {Cells[]} */
const STRIPES_AMBER = [[1, 2, 1, 3], [3, 2, 1, 3], [5, 2, 1, 2]];
/** @type {Cells[]} */
const STRIPES_DARK = [[2, 2, 1, 3], [4, 2, 1, 3], [6, 2, 1, 2], [0, 3, 1, 1]];

const FLEECE = "#f4f1ea";
const BELLY = "#bdb6a8";
const FACE = "#8d8496";

/**
 * One color of a figure. The `cue` layer takes the theme's blocked color when the helper
 * is blocked; the layer with a `beat` flickers at that period (ms) while the helper works:
 * a bee's wings, a sheep's legs.
 * @typedef {{ cells: Cells[], color: Color, cue?: boolean, beat?: number }} Layer
 */
/** @type {Record<BeeKind, Layer[]>} */
const FIGURES = {
  bee: [
    { cells: WINGS, color: WING, cue: true, beat: 120 },
    { cells: STRIPES_AMBER, color: AMBER },
    { cells: STRIPES_DARK, color: DARK },
  ],
  sheep: [
    { cells: [[1, 0, 4, 1], [0, 1, 5, 2]], color: FLEECE, cue: true },
    { cells: [[0, 3, 5, 1]], color: BELLY },
    { cells: [[5, 1, 2, 2]], color: FACE },
    { cells: [[1, 4, 1, 1], [4, 4, 1, 1]], color: FACE, beat: 260 },
  ],
};

/**
 * A full-size layer of rectangles in one color, mirrored when the figure faces left.
 * @param {Cells[]} cells
 * @param {Color} color
 * @param {number} u Pixels per cell.
 * @param {boolean} flip
 * @returns {Element}
 */
const layer = (cells, color, u, flip) =>
  div().absolute().left(0).top(0).w(BEE_W * u).h(BEE_H * u).children(cells.map(([x, y, w, h]) =>
    div().absolute().left((flip ? BEE_W - x - w : x) * u).top(y * u).w(w * u).h(h * u).bg(color)));

/**
 * A helper's figure, `BEE_W * px` by `BEE_H * px`: a honey bee, or a sheep. It lifts by up
 * to `px` while it works (a bee flies, a sheep hops), so leave that much room above it.
 * Motion is native: no ids, no timers.
 * @param {object} options
 * @param {BeeKind} [options.kind]
 * @param {BeeStatus} [options.status]
 * @param {number} [options.px] Pixels per cell (default 2).
 * @param {boolean} [options.flip] Faces left.
 * @param {number} [options.phase] Any integer: bees with different phases fly out of step.
 * @returns {Element}
 */
export function beeElement({ kind = "bee", status = "working", px: u = 2, flip = false, phase = 0 } = {}) {
  const t = /** @type {Theme} */ (theme());
  const bee = div().absolute().left(0).top(0).w(BEE_W * u).h(BEE_H * u);
  if (status === "working") {
    bee.loop("top", { from: 0, to: -u, period: 420 + (Math.abs(phase) % 5) * 70 });
  } else if (status === "blocked") {
    bee.loop("opacity", { from: 1, to: 0.35, period: 800 });
  } else {
    bee.opacity(0.6);
  }
  for (const { cells, color, cue, beat } of FIGURES[kind]) {
    const part = layer(cells, cue && status === "blocked" ? t.blocked : color, u, flip);
    if (beat && status === "working") part.loop("opacity", { from: 0.95, to: 0.35, period: beat });
    bee.child(part);
  }
  return div().relative().w(BEE_W * u).h(BEE_H * u).flex_none().child(bee);
}
