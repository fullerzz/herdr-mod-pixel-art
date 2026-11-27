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
// A commit made in an agent's repository is a stamp of approval: a rubber stamp slams down
// on its sprite, the cell dips under the blow, and the stamp lifts away to leave a check
// mark that holds a moment before it fades.
//
// A new agent arrives by a magic trick: a wand taps the empty cell, a puff of smoke and
// sparkles goes up, and the creature is there when it clears. "Abracadabra!" stands in for
// its status line meanwhile. The agents already there when the drawer first draws get none.
//
// Each helper an agent has running is a small figure (a sheep for an `hc` terminal it
// started, a honey bee for a sub-agent; both are "bees" below) that flies out of its sprite
// to a lane under it, out of a small puff of smoke, and stays there until the helper ends.
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
/** @import { Lines, Move } from "./edits.js" */
/** @import { AgentInfo, ExecResult, Status } from "herdr" */
/** @import { Theme } from "./sprite-view.js" */

/**
 * One agent as the drawer shows it.
 * @typedef {object} Item
 * @property {AgentInfo} a
 * @property {string} line The status line under its name.
 * @property {boolean} on Whether it is the agent keys act on, marked as focused.
 * @property {Hit | null} hit The hit it is taking, if any.
 * @property {Stamp | null} stamp The stamp it is getting, if any.
 * @property {Trick | null} trick The trick it arrives by, if it is new.
 * @property {Puff | null} puff The puff a new bee of its flies out of, if any.
 * @property {Flier[]} bees Its helpers, as bees.
 * @property {string | null} work What it is doing, as its hooks say (`pixel.work`), if they do.
 */

/**
 * A one-shot effect being shown, such as a stamp. Each step is one render; transitions move
 * between them. A new one gets a new `n`, and so new ids: it starts over.
 * @template {string} Step
 * @typedef {{ n: number, step: Step }} Show
 */
/** @typedef {Show<"drop" | "press" | "lift" | "fade">} Stamp A commit's stamp. */
/** @typedef {Show<"wand" | "tap" | "poof" | "reveal">} Trick A new agent's arrival. */
/** @typedef {Show<"cloud" | "clear">} Puff Smoke where a new bee comes out. */

/**
 * An agent whose status is not the one it had when the drawer last drew it.
 * @typedef {{ address: string, from: Status, to: Status }} Change
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
const STAMP_PX = 3; // a stamp's cells, the sprite's size
const STAMP_W = 8 * STAMP_PX; // px: the mark and the tool are as wide
const STAMP_X = 21; // px: the stamp lands on the sprite's lower right (the sprite is 6..42 by 4..40)
const STAMP_FLOOR = 41; // px: where the mark's and the pressed tool's bottoms rest
const STAMP_RISE = 14; // px the tool waits above where it presses, and lifts back to
const STAMP_SLAM = 340; // ms from dropped to down
const STAMP_DIP = 3; // px the cell dips when the tool lands
/** @type {[ms: number, step: Stamp["step"] | null][]} When each step starts; null: gone. */
const STAMP_STEPS = [[30, "press"], [900, "lift"], [2700, "fade"], [3800, null]];
/** @type {[ms: number, step: Trick["step"] | null][]} After "wand": the wand taps, smoke goes up, the creature shows. */
const TRICK_STEPS = [[240, "tap"], [440, "poof"], [760, "reveal"], [1500, null]];
/** @type {[ms: number, step: Puff["step"] | null][]} After "cloud": it clears as the bee flies out. */
const PUFF_STEPS = [[BEE_HOLD + 20, "clear"], [800, null]];
const TRICK_WORD = "Abracadabra!";
/** The label an agent's hooks keep what it is doing in (`tools/bee-hook.sh`): one of sprite-view's WORKS. */
const WORK = "pixel.work";

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
  /** @type {Map<string, Stamp>} By agent address. */
  stamps = new Map();
  /** @type {Set<string> | null} The agents drawn last time; null before the first draw. */
  seen = null;
  /** @type {Map<string, Trick>} By agent address. */
  tricks = new Map();
  /** @type {Set<string>} The ids of the new bees that have had their puff. */
  puffed = new Set();
  /** @type {Map<string, Puff>} By agent address. */
  puffs = new Map();
  /** @type {Map<string, Status>} Each agent's status when it was last drawn, by address. */
  statuses = new Map();
  /** @type {Change[]} The status changes the last draw found. */
  changes = [];
  /** Whether the last draw was the moment every agent was done. */
  allDone = false;
  /** @type {Map<string, Move>} The last move of HEAD, other than a commit, that landed on each agent, by address. */
  moves = new Map();

  /**
   * Plays a one-shot effect on an agent: `first` now, then each step at its time, and gone
   * at null. A new one replaces the last, whose timers then do nothing.
   * @template {string} Step
   * @param {Map<string, Show<Step>>} shows
   * @param {string} address
   * @param {Step} first
   * @param {[ms: number, step: Step | null][]} steps
   * @param {AsyncContext | Context} cx
   */
  play(shows, address, first, steps, cx) {
    /** @type {Show<Step>} */
    const show = { n: ++this.serial, step: first };
    shows.set(address, show);
    for (const [ms, step] of steps) {
      cx.timer.after(ms, (cx) => {
        if (shows.get(address) !== show) return;
        if (step) show.step = step;
        else shows.delete(address);
        cx.notify();
      });
    }
  }

  /**
   * @param {Record<string, any>} _props
   * @param {AsyncContext} cx
   */
  init(_props, cx) {
    this.edits = new EditWatcher(
      (root, lines, cx) => this.strike(root, lines, cx),
      (root, _commit, cx) => this.stamp(root, cx),
      (root, move) => this.moved(root, move),
    );
    /** @type {(cx: AsyncContext) => void} */
    const follow = (cx) => this.edits.follow(folders().values(), cx);
    follow(cx);
    cx.timer.every(FOLLOW_MS, follow);
  }

  /**
   * The agents news from a repository lands on: those working in it, else every agent in it.
   * @param {string} root
   * @returns {string[]} Addresses.
   */
  agentsIn(root) {
    const here = [...folders()].filter(([, dir]) => this.edits.rootOf(dir) === root).map(([address]) => address);
    const working = here.filter((address) => agents().find((a) => a.address === address)?.status === "working");
    return working.length ? working : here;
  }

  /**
   * Lines grew in a repository: a hit on its agents.
   * @param {string} root
   * @param {Lines} lines
   * @param {AsyncContext} cx
   */
  strike(root, lines, cx) {
    for (const address of this.agentsIn(root)) {
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

  /**
   * A commit was made in a repository: a stamp on its agents. A new stamp replaces the last.
   * @param {string} root
   * @param {AsyncContext} cx
   */
  stamp(root, cx) {
    for (const address of this.agentsIn(root)) this.play(this.stamps, address, "drop", STAMP_STEPS, cx);
    cx.notify();
  }

  /**
   * HEAD moved in a repository other than by a commit: a checkout, reset, rebase, pull,
   * cherry-pick, merge or revert. It lands on the agents a hit or a stamp would. Nothing is
   * drawn for it yet: a one-shot for its kind plays from here.
   * @param {string} root
   * @param {Move} move
   */
  moved(root, move) {
    for (const address of this.agentsIn(root)) this.moves.set(address, move);
  }

  /**
   * A trick for each agent not drawn last time, unless this is the first draw: the agents
   * there when the drawer opens were there before it.
   * @param {AgentInfo[]} list
   * @param {Context} cx
   */
  arrivals(list, cx) {
    const now = new Set(list.map((a) => a.address));
    if (this.seen) for (const address of now) if (!this.seen.has(address)) this.play(this.tricks, address, "wand", TRICK_STEPS, cx);
    this.seen = now;
  }

  /**
   * Each agent's status change since it was last drawn, and whether this draw is the moment
   * every agent is done: one of them just turned done and none is anything else. An agent
   * not drawn last time has no earlier status, so the first draw, a new agent and one that
   * comes back report no change. One-shots for a change play from here with `play`, before the items are built.
   * @param {AgentInfo[]} list
   */
  statusChanges(list) {
    /** @type {Change[]} */
    const changes = [];
    for (const a of list) {
      const from = this.statuses.get(a.address);
      if (from && from !== a.status) changes.push({ address: a.address, from, to: a.status });
    }
    this.statuses = new Map(list.map((a) => [a.address, a.status]));
    this.changes = changes;
    this.allDone = changes.some((c) => c.to === "done") && list.every((a) => a.status === "done");
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
   * beat later, so it is drawn twice and flies between the two. It comes out of a puff of
   * smoke, except on the first draw: those helpers were running before the drawer opened.
   * @param {AgentInfo[]} list
   * @param {Context} cx
   * @param {boolean} first The drawer's first draw.
   * @returns {Map<string, Flier[]>} By agent address.
   */
  swarm(list, cx, first) {
    const rows = new Set(list.map((a) => a.address));
    const all = terminals();
    const ids = new Set();
    /** @type {Set<string>} */
    const hatched = new Set();
    const byAgent = new Map(list.map((a) => [a.address, beesOf(a.address, rows, all).map((bee) => {
      const id = `pp-bee-${a.address}-${bee.key}`;
      ids.add(id);
      if (!this.flown.has(id) && !this.puffed.has(id)) {
        this.puffed.add(id);
        hatched.add(a.address);
      }
      return { ...bee, id, out: this.flown.has(id) };
    })]));
    if (!first) for (const address of hatched) this.play(this.puffs, address, "cloud", PUFF_STEPS, cx);
    // A helper that ended is forgotten, so one that comes back flies out again.
    for (const id of this.flown) if (!ids.has(id)) this.flown.delete(id);
    for (const id of this.puffed) if (!ids.has(id)) this.puffed.delete(id);
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
    const first = this.seen === null;
    this.arrivals(list, cx);
    this.statusChanges(list);
    if (!list.length) return div();
    const bees = this.swarm(list, cx, first);
    const t = /** @type {Theme} */ (theme());
    const edge = placement()?.edge ?? null;
    const byAddress = new Map(terminals().map((x) => [x.address, x]));
    const shown = currentAgent(list);
    const items = list.map((a) => {
      const trick = this.tricks.get(a.address) ?? null;
      return {
        a,
        line: trick ? TRICK_WORD : lineOf(a, byAddress.get(a.address)),
        on: a.address === shown,
        hit: this.hits.get(a.address) ?? null,
        stamp: this.stamps.get(a.address) ?? null,
        trick,
        puff: this.puffs.get(a.address) ?? null,
        bees: bees.get(a.address) ?? [],
        work: byAddress.get(a.address)?.labels?.[WORK] ?? null,
      };
    });

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

// A stamp's mark, 8 by 6 cells: a bold check. It says "approved" by its shape, so it reads
// the same in any theme; red alone would read as the "Needs you" cue. It is solid ink, not
// cut out of a block: the creature showing through a cut-out check made it a face.
const MARK = [
  ".......#",
  "......##",
  ".....##.",
  "##..##..",
  ".####...",
  "..##....",
];
// The stamp tool from the side, 8 by 9 cells: h handle, l its light, n neck, b block,
// i the inked rubber.
const TOOL = [
  "..hhhh..",
  ".hllhhh.",
  ".hhhhhh.",
  "..hhhh..",
  "...nn...",
  "...nn...",
  "bbbbbbbb",
  "bbbbbbbb",
  ".iiiiii.",
];
/** @type {Record<string, Color>} The tool's own colors; the rubber takes the ink. */
const TOOL_PAINT = { h: "#c98b4f", l: "#ebbd85", n: "#9aa5b1", b: "#7a4e2d" };
const TOOL_H = TOOL.length * STAMP_PX;
const MARK_H = MARK.length * STAMP_PX;
const STAMP_DARK = "#101016"; // the outline and shadow that keep a stamp readable on any creature
/** @type {(grid: string[]) => [x: number, y: number, w: number, c: string][]} Runs of one letter, row by row. */
const runsOf = (grid) =>
  grid.flatMap((line, y) => [...line.matchAll(/([^.])\1*/g)].map((m) => /** @type {[number, number, number, string]} */ ([m.index, y, m[0].length, m[1]])));
const MARK_RUNS = runsOf(MARK);
const TOOL_RUNS = runsOf(TOOL);

// Cells of STAMP_PX, each run in its color, over dark copies moved by each of `under`.
/**
 * @param {[number, number, number, string][]} runs
 * @param {(c: string) => Color} paint
 * @param {[dx: number, dy: number][]} under
 * @returns {Element[]}
 */
function pixels(runs, paint, under) {
  /** @type {(color: (c: string) => Color, dx: number, dy: number) => Element} */
  const layer = (color, dx, dy) =>
    div().absolute().left(dx).top(dy).size_full().children(runs.map(([x, y, w, c]) =>
      div().absolute().left(x * STAMP_PX).top(y * STAMP_PX).w(w * STAMP_PX).h(STAMP_PX).bg(color(c))));
  return [...under.map(([dx, dy]) => layer(() => STAMP_DARK, dx, dy)), layer(paint, 0, 0)];
}

// A commit's stamp on the sprite. Dropped, the tool waits unseen above the sprite's lower
// right; pressed, it slams down there as it shows, faster as it falls, and covers the spot;
// lifted, it rises away and fades, and leaves the mark where it pressed. The mark holds, then
// fades. The ids carry the stamp's number, so a new stamp starts over instead of easing back.
/**
 * @param {Theme} t
 * @param {string} address
 * @param {Stamp} stamp
 * @returns {Element}
 */
function stampElement(t, address, stamp) {
  const { n, step } = stamp;
  const down = step === "press";
  const mark = div()
    .id(`pp-mark-${address}-${n}`)
    .absolute()
    .left(STAMP_X)
    .top(STAMP_FLOOR - MARK_H)
    .w(STAMP_W)
    .h(MARK_H)
    .opacity(step === "lift" ? 1 : 0)
    .transition("opacity", step === "fade" ? { duration: 1000, easing: "ease-in" } : { duration: 40 })
    .children(pixels(MARK_RUNS, () => t.done, [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]));
  const tool = div()
    .id(`pp-tool-${address}-${n}`)
    .absolute()
    .left(STAMP_X)
    .top(STAMP_FLOOR - TOOL_H - (down ? 0 : STAMP_RISE))
    .w(STAMP_W)
    .h(TOOL_H)
    .opacity(down ? 1 : 0)
    .transition("top", down ? { duration: STAMP_SLAM, easing: "ease-in" } : { duration: 400, easing: "ease-out" })
    .transition("opacity", down ? { duration: 60 } : { duration: 400, easing: "ease-in" })
    .children(pixels(TOOL_RUNS, (c) => (c === "i" ? t.done : TOOL_PAINT[c]), [[1, 1]]));
  return div().id(`pp-stamp-${address}-${n}`).absolute().left(0).top(0).size_full().child(mark).child(tool);
}

// A puff of smoke: round clouds over a spot with sparkles around them, in cells of `u` px.
// Gathered, it covers the spot; cleared, the clouds and sparkles drift out from it and fade.
// Clouds: dx, dy and size in cells from the spot, and their shade: back ones darker so the
// puff reads on a light theme too. Sparkles: a plus sign each, gold and lilac.
/** @type {Color[]} */
const SMOKE = ["#f4f4f8", "#d9d9e3", "#a9a9bb"];
/** @type {[dx: number, dy: number, d: number, shade: number][]} */
const CLOUDS = [[-3, 2, 4, 2], [3, 2, 4, 2], [-3, -2, 4, 1], [3, -2, 4, 1], [0, 0, 6, 0]];
/** @type {[dx: number, dy: number, color: Color][]} */
const SPARKS = [[-5, -4, "#ffd447"], [5, -4, "#c7a6ff"], [-5, 3, "#c7a6ff"], [5, 3, "#ffd447"]];

/**
 * @param {string} id
 * @param {[x: number, y: number]} spot Px in the cell.
 * @param {number} u
 * @param {boolean} clear
 * @returns {Element}
 */
function smoke(id, [x, y], u, clear) {
  const out = clear ? 2 : 1;
  /** @type {(el: Element) => Element} */
  const drift = (el) => el
    .opacity(clear ? 0 : 1)
    .transition("left", { duration: 520, easing: "ease-out" })
    .transition("top", { duration: 520, easing: "ease-out" })
    .transition("opacity", { duration: 520, easing: "ease-in" });
  const clouds = CLOUDS.map(([dx, dy, d, shade], i) =>
    drift(div().id(`${id}-cloud-${i}`).absolute().left(Math.round(x + (dx * out - d / 2) * u)).top(Math.round(y + (dy * out - d / 2) * u)).size(d * u).rounded(d * u).bg(SMOKE[shade])));
  // Sparkles start further out than clouds, so they drift only a cell and stay in the cell.
  const sparks = SPARKS.map(([dx, dy, color], i) =>
    drift(div().id(`${id}-spark-${i}`).absolute().left(Math.round(x + (dx + (clear ? Math.sign(dx) : 0) - 1.5) * u)).top(Math.round(y + (dy + (clear ? Math.sign(dy) : 0) - 1.5) * u)).size(3 * u)
      .child(div().absolute().left(0).top(u).w(3 * u).h(u).bg(color))
      .child(div().absolute().left(u).top(0).w(u).h(3 * u).bg(color))));
  return div().id(id).absolute().left(0).top(0).size_full().children([...clouds, ...sparks]);
}

// A magic wand, 7 by 7 cells from its handle at the lower left to its white tip.
const WAND = [
  ".....tt",
  ".....tt",
  "....h..",
  "...h...",
  "..h....",
  ".h.....",
  "h......",
];
const WAND_RUNS = runsOf(WAND);
const WAND_W = WAND[0].length * STAMP_PX;
/** @type {Record<string, Color>} */
const WAND_PAINT = { h: "#8b6fd6", t: "#ffffff" };
const CENTER = /** @type {[number, number]} */ ([CELL / 2, CELL_H / 2]);

// A new agent's arrival. The wand shows over the cell's upper right, taps down toward the
// middle, and fades as the smoke goes up there; the smoke clears as the creature fades in.
// The cell holds the creature unseen until then.
/**
 * @param {string} address
 * @param {Trick} trick
 * @returns {Element}
 */
function trickElement(address, { n, step }) {
  const id = `pp-trick-${address}-${n}`;
  const shown = step === "wand" || step === "tap";
  const tap = step !== "wand";
  const wand = div()
    .id(`${id}-wand`)
    .absolute()
    .left(tap ? 21 : 26)
    .top(tap ? 9 : 2)
    .w(WAND_W)
    .h(WAND_W)
    .opacity(shown ? 1 : 0)
    .transition("left", { duration: 180, easing: "ease-in" })
    .transition("top", { duration: 180, easing: "ease-in" })
    .transition("opacity", { duration: 160 })
    .children(pixels(WAND_RUNS, (c) => WAND_PAINT[c], [[1, 1]]));
  const el = div().id(id).absolute().left(0).top(0).size_full();
  if (step === "poof" || step === "reveal") el.child(smoke(`${id}-smoke`, CENTER, PX, step === "reveal"));
  return el.child(wand);
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
// so the box adds only the tint. A hit's numbers and a stamp go over the sprite, in the box,
// so a closed drawer shows them too. The box dips as the stamp lands and rises after. A
// trick hides the sprite until it reveals it, and a new bee's puff goes over its middle.
/**
 * @param {Theme} t
 * @param {Item} it
 * @param {"left" | "right" | "bottom"} side
 * @returns {Element}
 */
function cell(t, { a, hit, stamp, trick, puff, bees, work }, side) {
  const hidden = Boolean(trick) && trick.step !== "reveal";
  const blocked = a.status === "blocked";
  const color = cueColor(t, a.status);
  const stripe = side === "bottom"
    ? div().absolute().left(12).bottom(0).w(CELL - 24).h(3).rounded(2).bg(color)
    : div().absolute().top(6).bottom(6).w(3).rounded(2).bg(color).when(side === "left", (el) => el.left(0)).when(side === "right", (el) => el.right(0));
  const box = div()
    .id(`pp-box-${a.address}`)
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
      work,
      hit: hit && { n: hit.n, damage: hit.removed > 0, live: hit.live },
    }).when(Boolean(trick), (el) => el.opacity(hidden ? 0 : 1).transition("opacity", { duration: 360, easing: "ease-out" })))
    .child(stripe)
    .when(Boolean(trick), (el) => el.child(trickElement(a.address, trick)))
    .when(Boolean(puff), (el) => el.child(smoke(`pp-puff-${a.address}-${puff.n}`, CENTER, BEE_PX, puff.step === "clear")))
    .when(Boolean(hit), (el) => el.child(numbers(a.address, hit)))
    .when(Boolean(stamp), (el) => el
      .top(stamp.step === "press" ? STAMP_DIP : 0)
      .transition("top", stamp.step === "press" ? { duration: 60, delay: STAMP_SLAM - 40, easing: "ease-in" } : { duration: 500, easing: "ease-out" })
      .child(stampElement(t, a.address, stamp)));
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
  const parts = [cell(t, it, right ? "right" : "left"), text];
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
    .child(cell(t, it, "bottom"))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(11).font_medium().text_color(t.foreground).child(nameOf(a)))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(10).text_color(blocked ? t.blocked : t.dim).when(blocked, (el) => el.font_semibold()).child(line));
}
