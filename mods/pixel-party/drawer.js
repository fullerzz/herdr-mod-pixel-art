// The party drawer: one sprite per agent, moving with what the agent does.
//
// Docked on a side edge as a `peek` drawer, only the 48 px sprite cell next to the edge
// shows until hover, so everything needed to read an agent's state lives in that cell:
// the sprite's motion and status mark, a status stripe on the edge side, and a tint when it
// is blocked.
// The layout depends only on placement().edge, never on hover or drag: Herdr slides the
// block, the content stays. Herdr draws the frame, so this draws content only.
//
// Lines an agent adds or removes are hits, as in a fighting game: the numbers ("+12" green,
// "−3" red) pop over its sprite and curve away, up-left and up-right, while the sprite
// flashes and is knocked.
//
// Each helper an agent has running is a small figure (a sheep for an `hc` terminal it
// started, a honey bee for a sub-agent; both are "bees" below) that flies out of its sprite
// to a lane under it, and stays there until the helper ends.
// Herdr clips a floating mod to its frame, so the lane is inside the drawer: it is as wide
// as the sprite cell, and a closed drawer shows it.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, run, theme, placement } from "herdr";
import { seedFor, openPicker, setAvatar, clearAvatar } from "./identity.js";
import { makeSprite, randomSeed } from "./sprites.js";
import { spriteElement, HIT } from "./sprite-view.js";
import { EditWatcher } from "./edits.js";
import { beesOf, beeElement, BEE_W, BEE_H } from "./bees.js";

/** @import { AsyncContext, Color, Context, Element } from "gpui-kit" */
/** @import { Bee } from "./bees.js" */
/** @import { Lines } from "./edits.js" */
/** @import { AgentInfo, ExecResult, Status } from "herdr" */
/** @import { Theme } from "./sprite-view.js" */

/**
 * One agent as the drawer shows it.
 * @typedef {object} Item
 * @property {AgentInfo} a
 * @property {string} line The status line under its name.
 * @property {boolean} on Whether it is the agent keys act on, marked as focused.
 * @property {Hit | null} hit The hit it is taking, if any.
 * @property {Flier[]} bees Its helpers, as bees.
 */

/**
 * A bee being shown.
 * @typedef {Bee & { id: string, out: boolean }} Flier `out` once it has left the sprite for its place.
 */

/**
 * Lines one agent added or removed, being shown.
 * @typedef {Lines & { n: number, live: boolean }} Hit `live` for its first frames, until it moves.
 */

const PX = 3; // a 36 px sprite
const CELL = 48; // the sprite with 6 px either side: the dock script peeks exactly this
const CELL_H = 44;
const TEXT_W = 168; // text column beside the cell on a side edge
const TILE_W = 76; // one agent on a top or bottom edge
const HIT_HOLD = 90; // ms a hit stays still at full strength, a fighting game's hit stop
const HIT_MS = 1400; // ms a hit shows in all
const HIT_RISE = 14; // px a hit's numbers rise
const HIT_SWING = 14; // px they swing aside: left for added lines, right for removed ones
const BEE_PX = 2; // a 14 by 10 px bee
const BEE_MAX = 6; // bees drawn per agent; past that the last place holds a count
const BEE_HOLD = 40; // ms a new bee sits inside its sprite before it flies out
const BEE_ROW = 3; // bees side by side under a sprite
const BEE_STEP = 15; // px from one bee to the next: three fill the 48 px cell
const BEE_LANE = 12; // px a row of bees takes
const BEE_LIFT = 2; // px over the first row: a flying bee lifts by one of its cells
/** @type {(n: number) => number} The height of the lanes under a sprite with n bees. */
const lanes = (n) => (n ? BEE_LIFT + Math.ceil(Math.min(n, BEE_MAX) / BEE_ROW) * BEE_LANE : 0);
const FOLLOW_MS = 2000; // ms between looks at which folders the agents are in

/** @type {Record<Status, string>} */
const WORD = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Idle" };

// A title often starts with the agent's own status glyph ("✳ Fix login").
/** @type {(s: string | null | undefined) => string} */
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

/** @type {(a: AgentInfo) => string} */
const nameOf = (a) => clean(a.title) || a.tab_name || a.program?.name || a.address;

/**
 * The agent's own message, else what it is doing and where.
 * @param {AgentInfo} a
 * @param {{ report?: { msg?: string } } | undefined} terminal Its `terminals()` entry.
 * @returns {string}
 */
function lineOf(a, terminal) {
  const msg = clean(terminal?.report?.msg);
  if (msg) return msg;
  const word = WORD[a.status] ?? "Unknown";
  return a.space_name ? `${word} in ${a.space_name}` : word;
}

// What the cue says in a theme color. Blocked tints the whole row and its cell too.
/** @type {(t: Theme, status: Status) => Color} */
const cueColor = (t, status) => (status === "idle" ? `${t.idle}99` : t[status] ?? t.unknown);

// The agent keys act on, and the row marked as focused: the pane with the keyboard when it
// is an agent, else Herdr's current agent. `focused().agent` alone is not enough: with the
// keyboard in a shell pane it names an agent chosen earlier, or simply the first one, and
// with the keyboard in another agent's pane it can still name the earlier choice.
/**
 * @param {AgentInfo[]} list
 * @returns {string | null} An address in `list`, or null for none.
 */
function currentAgent(list) {
  const f = focused();
  /** @type {(address: string | null) => boolean} */
  const known = (address) => Boolean(address) && list.some((a) => a.address === address);
  if (known(f?.terminal)) return f.terminal;
  return known(f?.agent) ? f.agent : null;
}

export default class Drawer {
  /** @type {Map<string, Hit>} By agent address. */
  hits = new Map();
  serial = 0;
  /** @type {Set<string>} The ids of the bees that have flown out to their places. */
  flown = new Set();
  launching = false;

  /**
   * @param {Record<string, any>} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    this.edits = new EditWatcher((root, lines, cx) => this.strike(root, lines, cx));
    /** @type {(cx: AsyncContext) => void} */
    const follow = (cx) => this.edits.follow(folders().values(), cx);
    follow(cx);
    cx.timer.every(FOLLOW_MS, follow);
  }

  /**
   * Lines grew in a repository: a hit on the agents working in it, else on every agent in it.
   * @param {string} root
   * @param {Lines} lines
   * @param {AsyncContext} cx
   */
  strike(root, lines, cx) {
    const here = [...folders()].filter(([, dir]) => this.edits.rootOf(dir) === root).map(([address]) => address);
    const working = here.filter((address) => agents().find((a) => a.address === address)?.status === "working");
    for (const address of working.length ? working : here) {
      const hit = { ...lines, n: ++this.serial, live: true };
      this.hits.set(address, hit);
      cx.timer.after(HIT_HOLD, (cx) => {
        hit.live = false;
        cx.notify();
      });
      cx.timer.after(HIT_MS, (cx) => {
        if (this.hits.get(address) !== hit) return;
        this.hits.delete(address);
        cx.notify();
      });
    }
    cx.notify();
  }

  /** @param {string} name A `pixel-party.<name>` key command: "pick", "reroll" or "reset". */
  command(name) {
    const target = currentAgent(agents());
    if (!target) return;
    if (name === "pick") openPicker(target, "dialog");
    else if (name === "reroll") logFailure(name, setAvatar(target, randomSeed()));
    else if (name === "reset") logFailure(name, clearAvatar(target));
  }

  /**
   * The agents' bees. A bee not seen before starts inside its sprite, and is let out a
   * beat later, so it is drawn twice and flies between the two.
   * @param {AgentInfo[]} list
   * @param {Context} cx
   * @returns {Map<string, Flier[]>} By agent address.
   */
  swarm(list, cx) {
    const rows = new Set(list.map((a) => a.address));
    const all = terminals();
    const ids = new Set();
    const byAgent = new Map(list.map((a) => [a.address, beesOf(a.address, rows, all).map((bee) => {
      const id = `pp-bee-${a.address}-${bee.key}`;
      ids.add(id);
      return { ...bee, id, out: this.flown.has(id) };
    })]));
    // A helper that ended is forgotten, so one that comes back flies out again.
    for (const id of this.flown) if (!ids.has(id)) this.flown.delete(id);
    if (!this.launching && ids.size > this.flown.size) {
      this.launching = true;
      cx.timer.after(BEE_HOLD, (cx) => {
        this.launching = false;
        for (const id of ids) this.flown.add(id);
        cx.notify();
      });
    }
    return byAgent;
  }

  /** @param {Context} cx */
  render(cx) {
    const list = agents();
    if (!list.length) return div();
    const bees = this.swarm(list, cx);
    const t = /** @type {Theme} */ (theme());
    const edge = placement()?.edge ?? null;
    const byAddress = new Map(terminals().map((x) => [x.address, x]));
    const shown = currentAgent(list);
    const items = list.map((a) => ({
      a,
      line: lineOf(a, byAddress.get(a.address)),
      on: a.address === shown,
      hit: this.hits.get(a.address) ?? null,
      bees: bees.get(a.address) ?? [],
    }));

    if (edge === "top" || edge === "bottom") {
      return h_flex().items_start().children(items.map((it) => tile(t, it)));
    }
    const right = edge === "right";
    const col = v_flex().gap(2).children(items.map((it) => row(t, it, right)));
    // Docked in a layout block it has a fixed size: let a long party scroll.
    return edge === null ? col.id("pp-drawer").size_full().overflow_y_scrollbar() : col;
  }
}

// A key command has nowhere to show a failure: say it in the log rather than drop it.
/**
 * @param {string} name
 * @param {Promise<ExecResult>} promise
 */
function logFailure(name, promise) {
  promise
    .then((r) => r?.code && console.log(`pixel-party: ${name} failed: ${r.stderr || r.code}`))
    .catch((e) => console.log(`pixel-party: ${name} failed: ${e?.message ?? e}`));
}

/**
 * The folder each agent on this computer is in, by address. Agents on other machines are
 * left out: their folders can't be watched from here.
 * @returns {Map<string, string>}
 */
function folders() {
  const cwd = new Map(panes().map((p) => [p.pane, p.cwd]));
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const a of agents()) {
    const dir = cwd.get(a.pane);
    if (dir && !machineOf(a.address)) out.set(a.address, dir);
  }
  return out;
}

/** @type {(n: number) => string} A line count as a hit shows it: 12, 1.2k, 34k. */
const amount = (n) => (n < 1000 ? String(n) : n < 9950 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n / 1000)}k`);

// The hit's numbers over the sprite, each with a dark copy behind it for an outline. They
// hold still while the hit is live, then fly off on a curve and fade: added lines up and
// to the left, removed lines up and to the right. The curve is two transitions: `top`
// eases out while `left` eases in, so a number rises first and then swings aside.
// Their ids carry the hit's number, so a new hit starts over instead of easing back.
/**
 * @param {string} address
 * @param {Hit} hit
 * @returns {Element}
 */
function numbers(address, hit) {
  const id = `pp-hit-${address}-${hit.n}`;
  /** @type {["added" | "removed", string, number][]} Kind, text, and which way it swings. */
  const kinds = [];
  if (hit.added) kinds.push(["added", `+${amount(hit.added)}`, -1]);
  if (hit.removed) kinds.push(["removed", `\u2212${amount(hit.removed)}`, 1]);
  /** @type {(s: string, color: Color, d: number) => Element} */
  const digits = (s, color, d) => div().absolute().left(d).top(d).w(CELL).text_center().text_size(13).font_extrabold().text_color(color).child(s);
  return div()
    .id(id)
    .absolute()
    .left(0)
    .top(0)
    .w(CELL)
    .children(kinds.map(([kind, s, side], i) =>
      div()
        .id(`${id}-${kind}`)
        .absolute()
        .w(CELL)
        .h(15)
        .left(hit.live ? 0 : side * HIT_SWING)
        .top((hit.live ? 12 : 12 - HIT_RISE) + i * 15)
        .opacity(hit.live ? 1 : 0)
        .transition("top", { duration: 900, easing: "ease-out" })
        .transition("left", { duration: 900, easing: "ease-in" })
        .transition("opacity", { duration: 450, delay: 600 })
        .child(digits(s, "#000000c0", 1))
        .child(digits(s, HIT[kind], 0))));
}

// The bees in the lanes under the sprite's box. Each has a place by its position in the
// list, so when one leaves the ones after it glide up a place. A new bee starts unseen in
// the middle of the sprite.
/**
 * @param {Flier[]} bees
 * @returns {Element[]}
 */
function hive(bees) {
  /** @type {(i: number) => [number, number]} The i-th place: left and top in the cell. */
  const spot = (i) => [2 + (i % BEE_ROW) * BEE_STEP, CELL_H + BEE_LIFT + Math.floor(i / BEE_ROW) * BEE_LANE];
  const [w, h] = [BEE_W * BEE_PX, BEE_H * BEE_PX];
  const more = bees.length > BEE_MAX ? bees.length - (BEE_MAX - 1) : 0;
  const shown = more ? bees.slice(0, BEE_MAX - 1) : bees;
  const out = shown.map((bee, i) => {
    const [left, top] = spot(i);
    return div()
      .id(bee.id)
      .absolute()
      .left(bee.out ? left : (CELL - w) / 2)
      .top(bee.out ? top : (CELL_H - h) / 2)
      .opacity(bee.out ? 1 : 0)
      .transition("left", { duration: 450, easing: "ease-out" })
      .transition("top", { duration: 450, easing: "ease-out" })
      .transition("opacity", { duration: 200 })
      .child(beeElement({ kind: bee.kind, status: bee.status, px: BEE_PX, phase: i }));
  });
  if (more) {
    const [left, top] = spot(BEE_MAX - 1);
    /** @type {(color: Color, d: number) => Element} */
    const count = (color, d) => div().absolute().left(left - 2 + d).top(top - 2 + d).w(w + 4).text_center().text_size(10).font_extrabold().text_color(color).child(`+${more}`);
    out.push(count("#000000c0", 1), count("#f7b521", 0));
  }
  return out;
}

/** @type {(a: AgentInfo) => null} Focuses the agent's pane. */
const go = (a) => run("pane.focus", { pane: a.pane });

// The sprite and its cue in a box, and under the box the lanes of its bees. `side` is where
// the stripe goes: "left", "right" or "bottom". The sprite draws its own "!" when blocked,
// so the box adds only the tint. A hit's numbers go over the sprite, in the box, so a
// closed drawer shows them too.
/**
 * @param {Theme} t
 * @param {AgentInfo} a
 * @param {"left" | "right" | "bottom"} side
 * @param {Hit | null} hit
 * @param {Flier[]} bees
 * @returns {Element}
 */
function cell(t, a, side, hit, bees) {
  const blocked = a.status === "blocked";
  const color = cueColor(t, a.status);
  const stripe = side === "bottom"
    ? div().absolute().left(12).bottom(0).w(CELL - 24).h(3).rounded(2).bg(color)
    : div().absolute().top(6).bottom(6).w(3).rounded(2).bg(color).when(side === "left", (el) => el.left(0)).when(side === "right", (el) => el.right(0));
  const box = div()
    .relative()
    .w(CELL)
    .h(CELL_H)
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .when(blocked, (el) => el.bg(`${t.blocked}40`))
    .child(spriteElement(makeSprite(seedFor(a.address)), {
      id: `pp-spr-${a.address}`,
      px: PX,
      status: a.status,
      hit: hit && { n: hit.n, damage: hit.removed > 0, live: hit.live },
    }))
    .child(stripe)
    .when(Boolean(hit), (el) => el.child(numbers(a.address, hit)));
  return div().relative().w(CELL).h(CELL_H + lanes(bees.length)).flex_none().child(box).children(hive(bees));
}

/** @type {(address: string) => string | null} The machine of a remote address ("mini/t7"), else null. */
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// What every agent's element does, whatever its shape: focus marked, click goes there,
// right click opens the picker. The id is the address, unique and stable per agent.
/** @type {(t: Theme, it: Item, el: Element, id: string) => Element} */
const shell = (t, { a, on }, el, id) =>
  el
    .id(id)
    .rounded(6)
    .cursor_pointer()
    .when(a.status === "blocked" && !on, (el) => el.bg(`${t.blocked}1f`))
    .when(on, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .on_click(() => go(a))
    .on_mouse_down("right", () => openPicker(a.address));

// A side edge: the cell on the edge side, the name and status line beside it.
/**
 * @param {Theme} t
 * @param {Item} it
 * @param {boolean} right Docked on the right edge: the cell goes on the right.
 * @returns {Element}
 */
function row(t, it, right) {
  const { a, line } = it;
  const blocked = a.status === "blocked";
  const idle = a.status === "idle" && !it.on;
  const machine = machineOf(a.address);
  const name = h_flex()
    .gap(5)
    .items_center()
    .when(right, (el) => el.justify_end())
    .child(div().min_w(0).truncate().text_size(12.5).font_medium().text_color(idle ? t.muted : t.foreground).child(nameOf(a)))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)));
  const status = div()
    .truncate()
    .text_size(11)
    .when(right, (el) => el.text_right())
    .text_color(blocked ? t.blocked : t.dim)
    .when(blocked, (el) => el.font_semibold())
    .child(line);
  const text = v_flex().w(TEXT_W).min_w(0).gap(1).when(right, (el) => el.pl(10)).when(!right, (el) => el.pr(10)).child(name).child(status);
  const parts = [cell(t, a, right ? "right" : "left", it.hit, it.bees), text];
  return shell(t, it, h_flex(), `pp-row-${a.address}`).items_center().children(right ? parts.reverse() : parts);
}

// A top or bottom edge: the sprite standing over its name, the status line under that.
/**
 * @param {Theme} t
 * @param {Item} it
 * @returns {Element}
 */
function tile(t, it) {
  const { a, line } = it;
  const blocked = a.status === "blocked";
  return shell(t, it, v_flex(), `pp-tile-${a.address}`)
    .w(TILE_W)
    .pb(4)
    .items_center()
    .tooltip(`${nameOf(a)}: ${line}`)
    .child(cell(t, a, "bottom", it.hit, it.bees))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(11).font_medium().text_color(t.foreground).child(nameOf(a)))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(10).text_color(blocked ? t.blocked : t.dim).when(blocked, (el) => el.font_semibold()).child(line));
}
