// The party drawer: one sprite per agent, moving with what the agent does.
//
// Docked on a side edge as a `peek` drawer, only the 48 px sprite cell next to the edge
// shows until hover, so everything needed to read an agent's state lives in that cell:
// the sprite's motion and status mark, a status stripe on the edge side, and a tint when it
// is blocked. The current agent, the one the key commands act on, wears a small gold crown
// at the top of that cell.
// The layout depends only on placement().edge, never on hover or drag: Herdr slides the
// block, the content stays. Herdr draws the frame, so this draws content only. On hover,
// only the creatures move: they turn toward the side the drawer opens to.
//
// Lines an agent adds or removes are hits, as in a fighting game: the numbers ("+12" green,
// "−3" red) pop over its sprite and curve away, up-left and up-right, while the sprite
// flashes and is knocked. A change of a line or a few is a tick: small numbers, a faint
// flash. A big one is a crit: big numbers under a CRIT tag, a solid flash, a longer stop.
// Three or more hits on one agent, each within a few seconds of the last, are a combo: a
// "3 HIT COMBO" counter at the bottom of its cell counts each hit and fades when they stop.
//
// A commit made in an agent's repository is a stamp of approval: a rubber stamp slams down
// on its sprite, the cell dips under the blow, and the stamp lifts away to leave a check
// mark that holds a moment before it fades. An agent's tenth stamp of the day is gold: a
// milestone, inked gold instead of "done". The other agents in that repository, the ones the
// stamp does not land on, clap: a pair of white gloves claps three times in front of each,
// with gold sparks at each clap.
//
// The lines changed in an agent's repository since its last commit fill an XP bar in a strip
// of its own under the sprite's box. A commit cashes it in: the stamp lands, the bar drains,
// and a commit that took a level's worth of lines pops a LEVEL UP over the creature.
//
// A checkout in an agent's repository flips a signpost by its sprite: it shows pointing the
// way HEAD came from, turns edge-on, and points the other way before it fades. A reset rewinds
// the creature: it spins backwards, jittering like a worn tape, under a "◀◀". A rebase is a
// deck of cards the creature shuffles in front of itself, twice. A pull, or a fast-forward, is
// a package that drops in from above and lands in front of the creature with a bounce and a
// puff of dust. A cherry-pick is a pair of cherries the creature plucks from a twig at the
// cell's upper right and holds in front of itself. Other kinds of move plug into the same
// table (`ONE_SHOTS`), one entry each.
//
// A command an agent runs that fails is a puff of black smoke: the creature coughs, and the
// smoke goes up from its face and clears. Tests show how they came out instead: passed, a
// thumbs up pops up over the creature's right side; failed, it drops its test tube, which
// spills.
//
// A new agent arrives by a magic trick: a wand taps the empty cell, a puff of smoke and
// sparkles goes up, and the creature is there when it clears. "Abracadabra!" stands in for
// its status line meanwhile. The agents already there when the drawer first draws get none.
// An agent that ends leaves by the same trick in reverse: its row stays, as it was last
// drawn, while the wand taps the creature and the smoke goes up, and is gone when it clears.
//
// An agent that becomes blocked jolts into it: its creature jumps as if startled, drops
// back, and the fire catches at its feet before the badge shows.
// A blocked agent that goes on has its fire put out: water pours on the flames, they die,
// and steam rises before the creature goes back to work. A working agent that finishes
// cheers once: a burst of confetti goes up and falls before the creature settles into its
// done pose. An idle or finished agent that starts work wakes up first: its creature
// yawns, stretches and pops its eyes open. Each such one-shot for a status change is one
// of sprite-view's TURNS.
//
// Each helper an agent has running is a small figure (a sheep for an `hc` terminal it
// started, a honey bee for a sub-agent; both are "bees" below) that flies out of its sprite
// to a lane under it, out of a small puff of smoke, and stays there until the helper ends.
// Then a bee flies back into the creature and fades, and a sheep hops off to the side; the
// others glide up a place when it has gone. Herdr clips a floating mod to its frame, so the
// lane is inside the drawer: it is as wide as the sprite cell, and a closed drawer shows it.
//
// A creature at rest keeps a prop for the local time of day: a lantern at night, a cup of
// coffee in the morning. Sprite motion has no timers, so the drawer looks at the clock each
// minute and redraws when the part of the day has changed.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, run, theme, placement } from "herdr";
import { seedFor, openPicker, setAvatar, clearAvatar } from "./identity.js";
import { GRID, makeSprite, randomSeed } from "./sprites.js";
import { faceRects, spriteElement, daytimeOf, HIT, STAGES, TURNS } from "./sprite-view.js";
import { EditWatcher, LEVEL_LINES, hitSize } from "./edits.js";
import { beesOf, beeElement, BEE_W, BEE_H } from "./bees.js";

/** @import { AsyncContext, Color, Context, Element } from "gpui-kit" */
/** @import { Bee } from "./bees.js" */
/** @import { HitSize, Lines, Move, MoveKind } from "./edits.js" */
/** @import { AgentInfo, ExecResult, Status, TabInfo } from "herdr" */
/** @import { Daytime, Face, Facing, SpriteTurn, Theme } from "./sprite-view.js" */

/**
 * One agent as the drawer shows it.
 * @typedef {object} Item
 * @property {AgentInfo} a
 * @property {string} seed The seed its creature is drawn from.
 * @property {string} line The status line under its name.
 * @property {boolean} on Whether it is the agent keys act on, marked as focused.
 * @property {Hit | null} hit The hit it is taking, if any.
 * @property {Combo | null} combo The combo its hits make, once it has COMBO_MIN of them.
 * @property {Xp | null} xp Its XP bar, while its repository has uncommitted lines or a commit cashes them in.
 * @property {Stamp | null} stamp The stamp it is getting, if any.
 * @property {Clap | null} clap The clap it gives for a commit another agent in its repository made, if any.
 * @property {Shot | null} move The one-shot for the last move of HEAD that landed on it, while it plays.
 * @property {Trick | null} trick The trick it arrives by, if it is new.
 * @property {Exit | null} exit The trick it leaves by, if it is gone.
 * @property {Puff | null} puff The puff a new bee of its flies out of, if any.
 * @property {Soot | null} soot The black smoke a failed command of its coughs up, if any.
 * @property {Verdict | null} verdict How its last tests came out, while that shows.
 * @property {Flier[]} bees Its helpers, as bees.
 * @property {string | null} work What it is doing, as its hooks say (`pixel.work`), if they do.
 * @property {number} stage How many of its status's STAGES it has held for: 0 when its start is unknown.
 * @property {SpriteTurn | null} turn The turn its last status change plays, if any.
 * @property {Daytime | null} daytime The part of the day it was drawn in, for its prop at rest.
 */

/**
 * A one-shot effect being shown, such as a stamp. Each step is one render; transitions move
 * between them. A new one gets a new `n`, and so new ids: it starts over.
 * @template {string} Step
 * @typedef {{ n: number, step: Step }} Show
 */
/** @typedef {Show<"drop" | "press" | "lift" | "fade"> & { gold: boolean }} Stamp A commit's stamp; `gold` for a milestone. */
/** @typedef {Show<"clap" | "fade">} Clap The other agents' applause for a commit. */
/** @typedef {Show<"wand" | "tap" | "poof" | "reveal">} Trick A new agent's arrival. */
/** @typedef {Show<"wand" | "tap" | "poof" | "clear">} Exit An agent's departure: the trick in reverse. */
/** @typedef {Show<"cloud" | "clear">} Puff Smoke where a new bee comes out. */
/** @typedef {Show<"home" | "hop" | "off">} Leave A bee whose helper ended: a bee flies home, a sheep hops and goes off. */
/** @typedef {Show<string> & { move: Move }} Shot A move of HEAD being shown, and the move. */
/**
 * What one kind of move plays: its first step, when each next step starts (null: gone), and
 * how a step draws, in the box over the sprite. `hides` keeps the sprite unseen while it
 * plays, for a one-shot that draws the creature itself.
 * @typedef {{ first: string, steps: [ms: number, step: string | null][], draw: (t: Theme, address: string, shot: Shot) => Element, hides?: boolean }} OneShot
 */
/** @typedef {Show<"cough" | "rise">} Soot Black smoke from a failed command. */
/** @typedef {"raise" | "up" | "fade"} ThumbStep */
/** @typedef {"hold" | "tip" | "fall" | "spill" | "fade"} DropStep */
/**
 * How tests came out: passed, a thumbs up; failed, the test tube dropped.
 * @typedef {Show<ThumbStep | DropStep> & { passed: boolean }} Verdict
 */
/** @typedef {Show<"hold" | "fade"> & { count: number }} Combo Hits on one agent in quick succession, and how many. */
/**
 * A commit cashing in the XP bar: its repository, the lines the bar held, and the lines the
 * commit left, from the read after it (until then, all of them: it took none).
 * @typedef {Show<"hold" | "drain" | "pop" | "fade"> & { root: string, lines: number, left: number }} Cash
 */
/** @typedef {{ lines: number, cash: Cash | null }} Xp An XP bar: its repository's uncommitted lines, and the commit cashing them in. */

/**
 * A result an agent's hooks reported since it was last drawn: the kind its `pixel.result`
 * label names ("failed", "tests-passed", "tests-failed").
 * @typedef {{ address: string, kind: string }} Report
 */

/**
 * An agent whose status is not the one it had when the drawer last drew it.
 * @typedef {{ address: string, from: Status, to: Status }} Change
 */

/**
 * A bee being shown.
 * @typedef {Bee & { id: string, out: boolean, leave?: Leave }} Flier `out` once it has left the sprite for its
 * place; `leave` once its helper has ended, while it goes.
 */

/**
 * Lines one agent added or removed, being shown.
 * @typedef {Lines & { n: number, live: boolean, size: HitSize }} Hit `live` for its first frames, until it moves.
 */

const PX = 3; // a 36 px sprite
const CELL = 48; // the sprite with 6 px either side: the dock script peeks exactly this
const CELL_H = 44;
const TEXT_W = 168; // text column beside the cell on a side edge
const TILE_W = 76; // one agent on a top or bottom edge
/**
 * The side a drawer on each edge opens to, where its creatures turn on hover: away from
 * the edge. Herdr gives no pointer position, only that the pointer is on the drawer.
 * @type {Record<"top" | "right" | "bottom" | "left", Facing>}
 */
const OPEN_SIDE = { top: "down", right: "left", bottom: "up", left: "right" };
const HIT_HOLD = 90; // ms a hit stays still at full strength, a fighting game's hit stop
const CRIT_HOLD = 240; // ms a crit stays still: a longer stop, so it lands harder
const HIT_MS = 1400; // ms a hit shows in all
const HIT_RISE = 14; // px a hit's numbers rise
const HIT_SWING = 14; // px they swing aside: left for added lines, right for removed ones
const COMBO_MIN = 3; // hits in a row from which they show as a combo
const COMBO_GAP = 2500; // ms a combo waits for its next hit before it fades
const COMBO_FADE = 400; // ms it takes to fade
/** @type {[ms: number, step: Combo["step"] | null][]} After "hold": with no next hit, it fades. */
const COMBO_STEPS = [[COMBO_GAP, "fade"], [COMBO_GAP + COMBO_FADE, null]];
const COMBO_H = 20; // px: the counter's two rows, at the bottom of the box
const COMBO_COLOR = "#f7b521"; // amber, as the bees' count: no hit, fire or status color
const XP_H = 4; // px: the XP bar's strip under the box, its 3 px bar and a 1 px gap over it
const XP_X = 6; // px: the bar is as wide as the sprite over it
const XP_W = CELL - 2 * XP_X;
const XP_COLOR = "#8f9bff"; // periwinkle: no hit, fire, douse, confetti, combo or status color
const XP_TRACK = "#10101699"; // the empty part of the bar: the stamp's dark, see-through
const XP_DRAIN = 500; // ms the bar takes to drain
/** @type {[ms: number, step: Cash["step"] | null][]} After "hold": it drains as the stamp lands, then a level up pops once the tool has lifted away, and fades. */
const CASH_STEPS = [[30 + 340, "drain"], [1300, "pop"], [2100, "fade"], [2700, null]];
const LEVEL_TOP = 2; // px: the LEVEL UP at the box's top, clear of the stamp's mark at its lower right
const LEVEL_RISE = 8; // px it rises as it pops in, and again as it fades
/**
 * A hit's numbers by its size: text px, px from one row to the next, and the first row's
 * top. A crit's rows start higher, so two fit under its tag in the 44 px box, and its text
 * fits "+1.2k" in the 48 px cell.
 * @type {Record<HitSize, { text: number, row: number, top: number }>}
 */
const HIT_TEXT = { tick: { text: 10, row: 12, top: 12 }, hit: { text: 13, row: 15, top: 12 }, crit: { text: 16, row: 17, top: 10 } };
const BEE_PX = 2; // a 14 by 10 px bee
const BEE_MAX = 6; // bees drawn per agent; past that the last place holds a count
const BEE_HOLD = 40; // ms a new bee sits inside its sprite before it flies out
const BEE_ROW = 3; // bees side by side under a sprite
const BEE_STEP = 15; // px from one bee to the next: three fill the 48 px cell
const BEE_LANE = 12; // px a row of bees takes
const BEE_LIFT = 2; // px over the first row: a flying bee lifts by one of its cells
/** @type {(n: number) => number} The height of the lanes under a sprite with n bees. */
const lanes = (n) => (n ? BEE_LIFT + Math.ceil(Math.min(n, BEE_MAX) / BEE_ROW) * BEE_LANE : 0);
const HOME_MS = 450; // ms a leaving bee flies back into the middle of its sprite
/** @type {[ms: number, step: Leave["step"] | null][]} After "home": gone once it is in. */
const HOME_STEPS = [[HOME_MS + 50, null]];
const HOP_MS = 200; // ms each half of a leaving sheep's hop takes
const HOP_X = 14; // px a leaving sheep hops aside from its place, within its row, which has that much room on the side it hops to: the text column on a side edge, or the 14 px tile margin on a top or bottom edge
const HOP_UP = 6; // px it leaps
/** @type {[ms: number, step: Leave["step"] | null][]} After "hop": it lands off to the side as it fades, then is gone. */
const HOP_STEPS = [[HOP_MS, "off"], [2 * HOP_MS + 20, null]];
const FOLLOW_MS = 2000; // ms between looks at which folders the agents are in
const DAYTIME_MS = 60_000; // ms between looks at the clock for a new part of the day
const STAMP_PX = 3; // a stamp's cells, the sprite's size
const STAMP_W = 8 * STAMP_PX; // px: the mark and the tool are as wide
const STAMP_X = 21; // px: the stamp lands on the sprite's lower right (the sprite is 6..42 by 4..40)
const STAMP_FLOOR = 41; // px: where the mark's and the pressed tool's bottoms rest
const STAMP_RISE = 14; // px the tool waits above where it presses, and lifts back to
const STAMP_SLAM = 340; // ms from dropped to down
const STAMP_DIP = 3; // px the cell dips when the tool lands
/** @type {[ms: number, step: Stamp["step"] | null][]} When each step starts; null: gone. */
const STAMP_STEPS = [[30, "press"], [900, "lift"], [2700, "fade"], [3800, null]];
const MILESTONE = 10; // an agent's stamp of the day that is gold
/** The gold a milestone stamp inks with: deep and ochre, its own, never FIRE's, the clap sparks' or the combo's. */
export const GOLD = "#c9971c";
const CLAP_BEAT = 240; // ms from one clap to the next: the hands meet and part again
const CLAPS = 3;
/** @type {[ms: number, step: Clap["step"] | null][]} After "clap": the hands clap CLAPS times, then fade. */
const CLAP_STEPS = [[CLAPS * CLAP_BEAT, "fade"], [CLAPS * CLAP_BEAT + 300, null]];
/** @type {[ms: number, step: Trick["step"] | null][]} After "wand": the wand taps, smoke goes up, the creature shows. */
const TRICK_STEPS = [[240, "tap"], [440, "poof"], [760, "reveal"], [1500, null]];
/** @type {[ms: number, step: Exit["step"] | null][]} After "wand": the wand taps, smoke goes up as the creature goes, and clears. */
const EXIT_STEPS = [[240, "tap"], [440, "poof"], [760, "clear"], [1300, null]];
/** @type {[ms: number, step: Puff["step"] | null][]} After "cloud": it clears as the bee flies out. */
const PUFF_STEPS = [[BEE_HOLD + 20, "clear"], [800, null]];
/** @type {[ms: number, step: Soot["step"] | null][]} After "cough": the smoke goes up and clears. */
const SOOT_STEPS = [[250, "rise"], [1000, null]];
const COUGH = 2; // px the creature lurches down as it coughs
/** @type {[ms: number, step: ThumbStep | null][]} After "raise": it pops up, holds, and fades. */
const THUMB_STEPS = [[30, "up"], [1400, "fade"], [2000, null]];
/** @type {[ms: number, step: DropStep | null][]} After "hold": the tube tips, lands on its side, spills, and fades. */
const DROP_STEPS = [[80, "tip"], [180, "fall"], [480, "spill"], [1700, "fade"], [2300, null]];
const TRICK_WORD = "Abracadabra!";
const EXIT_WORD = "Poof!";
/** The label an agent's hooks keep what it is doing in (`tools/bee-hook.sh`): one of sprite-view's WORKS. */
const WORK = "pixel.work";
/** The label an agent's hooks keep its last result in (`tools/bee-hook.sh fail` and `pass`): `<kind>.<nonce>`, new for each one. */
const RESULT = "pixel.result";

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
  /** @type {Map<string, Combo>} By agent address, from its first hit; shown from COMBO_MIN. */
  combos = new Map();
  /** @type {Map<string, Cash>} By agent address: a commit cashing in its XP bar. */
  cashes = new Map();
  serial = 0;
  /** @type {Set<string>} The ids of the bees that have flown out to their places. */
  flown = new Set();
  launching = false;
  /** @type {Map<string, Stamp>} By agent address. */
  stamps = new Map();
  /** @type {Map<string, Clap>} By agent address. */
  claps = new Map();
  /** @type {Map<string, { day: string, count: number }>} The stamps each agent got on its local day, by address; kept only while the drawer is open. */
  tally = new Map();
  /** @type {Set<string> | null} The agents drawn last time; null before the first draw. */
  seen = null;
  /** @type {Map<string, Trick>} By agent address. */
  tricks = new Map();
  /** @type {Map<string, Exit>} By agent address. */
  exits = new Map();
  /** @type {Map<string, Item>} The agents that left, as they were last drawn, while their exit plays; by address. */
  ghosts = new Map();
  /** @type {Item[]} The rows drawn last time, in order, ghosts included. */
  drawn = [];
  /** @type {Set<string>} The ids of the new bees that have had their puff. */
  puffed = new Set();
  /** @type {Map<string, Flier[]>} Each row's bees as last drawn, leaving ones included, by agent address. */
  hived = new Map();
  /** @type {Map<string, Leave>} The bees leaving because their helper ended, by bee id. */
  leaving = new Map();
  /** @type {Map<string, Puff>} By agent address. */
  puffs = new Map();
  /** @type {Map<string, Status>} Each agent's status when it was last drawn, by address. */
  statuses = new Map();
  /** @type {Change[]} The status changes the last draw found. */
  changes = [];
  /** Whether the last draw was the moment every agent was done. */
  allDone = false;
  /** @type {Map<string, Shot>} The one-shot playing for the last move of HEAD, other than a commit, that landed on each agent, by address. */
  moves = new Map();
  /** @type {Map<string, string>} Each agent's `pixel.result` when it was last drawn ("" for none), by address. */
  results = new Map();
  /** @type {Report[]} The results the last draw found. */
  reports = [];
  /** @type {Map<string, Soot>} By agent address. */
  soots = new Map();
  /** @type {Map<string, Verdict>} By agent address: one at a time, so the next tests replace it. */
  verdicts = new Map();
  /** @type {Map<string, number | null>} When each agent's status began, ms since the epoch, by address; null when unknown. */
  since = new Map();
  /** @type {Map<string, number>} Each agent's stage on the last draw, by address. */
  stages = new Map();
  /** @type {number | null} When the pending stage timer wakes the drawer, ms since the epoch; null for none. */
  wake = null;
  /** @type {Record<string, Map<string, Show<string>>>} The turns being played, by name in TURNS, then by agent address. */
  turns = Object.fromEntries(Object.keys(TURNS).map((kind) => [kind, new Map()]));
  /** @type {Daytime | null | undefined} The part of the day of the last draw; undefined before the first. */
  daytime = undefined;

  /**
   * Plays a one-shot effect on an agent: `first` now, then each step at its time, and gone
   * at null. A new one replaces the last, whose timers then do nothing.
   * @template {Show<string>} S
   * @param {Map<string, S>} shows
   * @param {string} address
   * @param {S["step"]} first
   * @param {[ms: number, step: S["step"] | null][]} steps
   * @param {AsyncContext | Context} cx
   * @param {Omit<S, "n" | "step">} [more] Kept on the show beside its step, such as the move it shows.
   */
  play(shows, address, first, steps, cx, more) {
    const show = /** @type {S} */ ({ ...more, n: ++this.serial, step: first });
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
      (root, move, cx) => this.moved(root, move, cx),
      (root, lines, cx) => this.left(root, lines, cx),
    );
    /** @type {(cx: AsyncContext) => void} */
    const follow = (cx) => this.edits.follow(folders().values(), cx);
    follow(cx);
    cx.timer.every(FOLLOW_MS, follow);
    // The local clock moves on without a render: redraw when the part of the day is new.
    cx.timer.every(DAYTIME_MS, (cx) => {
      if (daytimeOf(new Date().getHours()) !== this.daytime) cx.notify();
    });
  }

  /**
   * The agents in a repository: those whose folder is in it.
   * @param {string} root
   * @returns {string[]} Addresses.
   */
  agentsOf(root) {
    return [...folders()].filter(([, dir]) => this.edits.rootOf(dir) === root).map(([address]) => address);
  }

  /**
   * The agents news from a repository lands on: those working in it, else every agent in it.
   * @param {string} root
   * @param {string[]} [here] The agents in it (`agentsOf`).
   * @returns {string[]} Addresses.
   */
  agentsIn(root, here = this.agentsOf(root)) {
    const working = here.filter((address) => agents().find((a) => a.address === address)?.status === "working");
    return working.length ? working : here;
  }

  /**
   * Lines grew in a repository: a hit on its agents. A hit while an agent's combo holds adds
   * to it; one after it faded starts a new count.
   * @param {string} root
   * @param {Lines} lines
   * @param {AsyncContext} cx
   */
  strike(root, lines, cx) {
    for (const address of this.agentsIn(root)) {
      const hit = { ...lines, n: ++this.serial, live: true, size: hitSize(lines.added + lines.removed) };
      this.hits.set(address, hit);
      const was = this.combos.get(address);
      this.play(this.combos, address, "hold", COMBO_STEPS, cx, { count: was?.step === "hold" ? was.count + 1 : 1 });
      cx.timer.after(hit.size === "crit" ? CRIT_HOLD : HIT_HOLD, (cx) => {
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
   * A commit was made in a repository: a stamp on its agents, and a clap from the others in
   * it, the ones the stamp does not land on. A new stamp or clap replaces the last.
   * It cashes in the stamped agents' XP bar: the lines the repository held before the
   * commit, still the watcher's until the read after it is kept.
   * @param {string} root
   * @param {AsyncContext} cx
   */
  stamp(root, cx) {
    const here = this.agentsOf(root);
    const stamped = new Set(this.agentsIn(root, here));
    const lines = this.edits?.uncommitted(root) ?? 0;
    for (const address of here) {
      if (!stamped.has(address)) {
        this.play(this.claps, address, "clap", CLAP_STEPS, cx);
        continue;
      }
      this.play(this.stamps, address, "drop", STAMP_STEPS, cx, { gold: this.count(address) === MILESTONE });
      if (lines) this.play(this.cashes, address, "hold", CASH_STEPS, cx, { root, lines, left: lines });
    }
    cx.notify();
  }

  /**
   * A repository's uncommitted lines changed: its bars are drawn anew. While a commit's
   * cash-in still holds, they are what the commit left, so how much it took is known.
   * @param {string} root
   * @param {number} lines
   * @param {AsyncContext} cx
   */
  left(root, lines, cx) {
    for (const cash of this.cashes.values()) if (cash.root === root && cash.step === "hold") cash.left = lines;
    cx.notify();
  }

  /**
   * Counts a stamp on an agent: its number among the agent's stamps of this local day. A new
   * day starts over at one.
   * @param {string} address
   * @returns {number}
   */
  count(address) {
    const day = new Date().toDateString();
    const was = this.tally.get(address);
    const count = was?.day === day ? was.count + 1 : 1;
    this.tally.set(address, { day, count });
    return count;
  }

  /**
   * HEAD moved in a repository other than by a commit: a checkout, reset, rebase, pull,
   * cherry-pick, merge or revert. It lands on the agents a hit or a stamp would, as the
   * one-shot for its kind (`ONE_SHOTS`). A kind without one shows nothing yet. A new move on
   * an agent replaces the last.
   * @param {string} root
   * @param {Move} move
   * @param {AsyncContext} cx
   */
  moved(root, move, cx) {
    const shot = ONE_SHOTS[move.kind];
    if (!shot) return;
    for (const address of this.agentsIn(root)) this.play(this.moves, address, shot.first, shot.steps, cx, { move });
    cx.notify();
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
   * An exit for each agent drawn last time and gone now. Its row is kept as it was drawn, a
   * ghost, while the exit plays, and goes with it. An agent that comes back is no ghost: its
   * exit stops, and it arrives again. A trick it was arriving by stops too.
   * @param {AgentInfo[]} list
   * @param {Context} cx
   */
  departures(list, cx) {
    const now = new Set(list.map((a) => a.address));
    for (const it of this.drawn) {
      const address = it.a.address;
      if (it.exit || now.has(address)) continue;
      this.ghosts.set(address, it);
      this.tricks.delete(address);
      this.play(this.exits, address, "wand", EXIT_STEPS, cx);
    }
    for (const address of this.ghosts.keys()) {
      if (now.has(address)) this.exits.delete(address);
      if (!this.exits.has(address)) this.ghosts.delete(address);
    }
  }

  /**
   * Each agent's status change since it was last drawn, and whether this draw is the moment
   * every agent is done: one of them just turned done and none is anything else. An agent
   * not drawn last time has no earlier status, so the first draw, a new agent and one that
   * comes back report no change. A change's turn plays from them (`react`), before the items are built.
   *
   * It also keeps each agent's status clock: a change starts it at this draw. An agent not
   * drawn last time takes its start from its tab when it has the tab to itself, since a
   * tab's times are the tab's, and else has no known start. A status that flips and flips
   * back between two draws is no change, so its clock keeps running.
   * @param {AgentInfo[]} list
   * @param {number} now ms since the epoch.
   */
  statusChanges(list, now) {
    /** @type {Change[]} */
    const changes = [];
    /** @type {Map<string, number | null>} */
    const since = new Map();
    /** @type {Map<string, TabInfo> | null} Read only when an agent is new. */
    let solo = null;
    for (const a of list) {
      const from = this.statuses.get(a.address);
      if (from && from !== a.status) changes.push({ address: a.address, from, to: a.status });
      if (!from) since.set(a.address, startOf(a, (solo ??= soloTabs(list)).get(a.tab)));
      else since.set(a.address, from === a.status ? this.since.get(a.address) ?? null : now);
    }
    this.since = since;
    this.statuses = new Map(list.map((a) => [a.address, a.status]));
    this.changes = changes;
    this.allDone = changes.some((c) => c.to === "done") && list.every((a) => a.status === "done");
  }

  /**
   * Each agent's stage: how many of its status's STAGES its status has held for, from its
   * clock. Sprite motion has no timers, so the drawer wakes itself when the nearest next
   * stage is due. One timer is pending at a time: a redraw before it is due adds none, and
   * a stage due sooner replaces it.
   * @param {AgentInfo[]} list
   * @param {number} now ms since the epoch.
   * @param {Context} cx
   */
  clock(list, now, cx) {
    this.stages = new Map();
    let next = Infinity;
    for (const a of list) {
      const start = this.since.get(a.address) ?? null;
      const marks = STAGES[a.status] ?? [];
      const age = start === null ? 0 : Math.max(0, now - start);
      const stage = start === null ? 0 : marks.filter((ms) => age >= ms).length;
      this.stages.set(a.address, stage);
      if (start !== null && stage < marks.length) next = Math.min(next, now + marks[stage] - age);
    }
    if (next === Infinity || (this.wake !== null && this.wake <= next)) return;
    const at = next;
    this.wake = at;
    cx.timer.after(Math.max(0, at - now), (cx) => {
      if (this.wake !== at) return;
      this.wake = null;
      cx.notify();
    });
  }

  /**
   * The results each agent's hooks reported since it was last drawn: a `pixel.result` with a
   * value it did not have then. Its value is new for each result, so a second failure in a
   * row is a second report, and a label taken away is none. As with status changes, an
   * agent not drawn last time reports nothing: its label is older than the drawer's look.
   * One-shots for a result play from here with `play`, before the items are built.
   * @param {AgentInfo[]} list
   * @param {Map<string, { labels?: Record<string, string> }>} byAddress `terminals()` by address.
   */
  reported(list, byAddress) {
    /** @type {Report[]} */
    const reports = [];
    const results = new Map(list.map((a) => [a.address, byAddress.get(a.address)?.labels?.[RESULT] ?? ""]));
    for (const [address, value] of results) {
      const before = this.results.get(address);
      if (value && before !== undefined && before !== value) reports.push({ address, kind: value.split(".")[0] });
    }
    this.results = results;
    this.reports = reports;
  }

  /**
   * Plays a turn for each status change the last draw found: the first of TURNS whose `from`
   * and `to` match it (null: any). A change ends the turn an earlier one started on the same
   * agent, even when it plays none: a fire lit again is not still being put out.
   * @param {Context} cx
   */
  react(cx) {
    for (const { address, from, to } of this.changes) {
      for (const shows of Object.values(this.turns)) shows.delete(address);
      const kind = Object.keys(TURNS).find((k) => (TURNS[k].from ?? from) === from && (TURNS[k].to ?? to) === to);
      if (kind) this.play(this.turns[kind], address, TURNS[kind].first, TURNS[kind].steps, cx);
    }
  }

  /**
   * The turn an agent is being shown, if any.
   * @param {string} address
   * @returns {SpriteTurn | null}
   */
  turnOf(address) {
    for (const [kind, shows] of Object.entries(this.turns)) {
      const show = shows.get(address);
      if (show) return { kind, n: show.n, step: show.step };
    }
    return null;
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
   *
   * A bee drawn last time whose helper has ended keeps its place while it leaves, and the
   * ones after it glide up when it has gone. A leaving agent's row, a ghost, sends all its
   * bees off at once, and keeps them, gone, until the row goes, so the row keeps its height.
   * A helper that comes back while its bee is leaving stops it, and flies out again.
   * @param {AgentInfo[]} list
   * @param {Context} cx
   * @param {boolean} first The drawer's first draw.
   * @returns {Map<string, Flier[]>} By agent address, ghosts included.
   */
  swarm(list, cx, first) {
    const rows = new Set(list.map((a) => a.address));
    const all = terminals();
    const ids = new Set();
    /** @type {Set<string>} */
    const hatched = new Set();
    /** @type {Map<string, Flier[]>} */
    const byAgent = new Map(list.map((a) => [a.address, beesOf(a.address, rows, all).map((bee) => {
      const id = `pp-bee-${a.address}-${bee.key}`;
      ids.add(id);
      if (!this.flown.has(id) && !this.puffed.has(id)) {
        this.puffed.add(id);
        hatched.add(a.address);
      }
      return { ...bee, id, out: this.flown.has(id) };
    })]));
    for (const address of this.ghosts.keys()) byAgent.set(address, []);
    for (const [address, before] of this.hived) {
      const now = byAgent.get(address);
      if (!now) continue;
      const ghost = !rows.has(address);
      for (const [i, bee] of before.entries()) {
        if (ids.has(bee.id)) continue;
        let leave = bee.leave;
        if (!leave) {
          const [step, steps] = bee.kind === "sheep" ? /** @type {const} */ (["hop", HOP_STEPS]) : /** @type {const} */ (["home", HOME_STEPS]);
          this.play(this.leaving, bee.id, step, [...steps], cx);
          leave = this.leaving.get(bee.id);
        } else if (this.leaving.get(bee.id) !== leave && !ghost) continue;
        now.splice(Math.min(i, now.length), 0, { ...bee, leave });
      }
    }
    for (const id of this.leaving.keys()) if (ids.has(id)) this.leaving.delete(id);
    this.hived = byAgent;
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
    const now = Date.now();
    const daytime = daytimeOf(new Date(now).getHours());
    this.daytime = daytime;
    const byAddress = new Map(terminals().map((x) => [x.address, x]));
    this.departures(list, cx);
    this.arrivals(list, cx);
    this.statusChanges(list, now);
    this.react(cx);
    this.clock(list, now, cx);
    this.reported(list, byAddress);
    for (const { address, kind } of this.reports) {
      if (kind === "failed") this.play(this.soots, address, "cough", SOOT_STEPS, cx);
      else if (kind === "tests-passed") this.play(this.verdicts, address, "raise", THUMB_STEPS, cx, { passed: true });
      else if (kind === "tests-failed") this.play(this.verdicts, address, "hold", DROP_STEPS, cx, { passed: false });
    }
    if (!list.length && !this.ghosts.size) {
      this.drawn = [];
      this.hived = new Map();
      this.leaving = new Map();
      return div();
    }
    const bees = this.swarm(list, cx, first);
    const t = /** @type {Theme} */ (theme());
    const where = placement();
    const edge = where?.edge ?? null;
    const face = where?.hovered && !where.dragging ? OPEN_SIDE[where.edge] : null;
    const shown = currentAgent(list);
    const dirs = folders();
    /** @type {(address: string) => Xp | null} */
    const xpOf = (address) => {
      const dir = dirs.get(address);
      const root = dir && this.edits?.rootOf(dir);
      const lines = (root && this.edits?.uncommitted(root)) || 0;
      const cash = this.cashes.get(address) ?? null;
      return lines || cash ? { lines, cash } : null;
    };
    /** @type {Item[]} */
    const items = list.map((a) => {
      const trick = this.tricks.get(a.address) ?? null;
      const combo = this.combos.get(a.address);
      return {
        a,
        seed: seedFor(a.address),
        line: trick ? TRICK_WORD : lineOf(a, byAddress.get(a.address)),
        on: a.address === shown,
        hit: this.hits.get(a.address) ?? null,
        combo: combo && combo.count >= COMBO_MIN ? combo : null,
        xp: xpOf(a.address),
        stamp: this.stamps.get(a.address) ?? null,
        clap: this.claps.get(a.address) ?? null,
        move: this.moves.get(a.address) ?? null,
        trick,
        exit: /** @type {Exit | null} */ (null),
        puff: this.puffs.get(a.address) ?? null,
        soot: this.soots.get(a.address) ?? null,
        verdict: this.verdicts.get(a.address) ?? null,
        bees: bees.get(a.address) ?? [],
        work: byAddress.get(a.address)?.labels?.[WORK] ?? null,
        stage: this.stages.get(a.address) ?? 0,
        turn: this.turnOf(a.address),
        daytime,
      };
    });
    // A ghost keeps its place, so its exit plays where its creature stood. It shows only the
    // creature, its exit and its bees leaving: its news went with it.
    for (const [i, old] of this.drawn.entries()) {
      const ghost = this.ghosts.get(old.a.address);
      const exit = this.exits.get(old.a.address);
      if (!ghost || !exit) continue;
      items.splice(Math.min(i, items.length), 0, { ...ghost, line: EXIT_WORD, on: false, hit: null, combo: null, xp: null, stamp: null, clap: null, move: null, trick: null, exit, puff: null, soot: null, verdict: null, bees: bees.get(old.a.address) ?? [] });
    }
    this.drawn = items;

    if (edge === "top" || edge === "bottom") {
      return h_flex().items_start().children(items.map((it) => tile(t, it, face)));
    }
    const right = edge === "right";
    const col = v_flex().gap(2).children(items.map((it) => row(t, it, right, face)));
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

/**
 * The tab of each agent that has its tab to itself, by tab id: only there are a tab's times
 * its agent's. `terminals()` has no times of its own.
 * @param {AgentInfo[]} list
 * @returns {Map<string, TabInfo>}
 */
function soloTabs(list) {
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const a of list) count.set(a.tab, (count.get(a.tab) ?? 0) + 1);
  /** @type {Map<string, TabInfo>} */
  const out = new Map();
  for (const space of spaces()) for (const tab of space.tabs ?? []) if (count.get(tab.id) === 1) out.set(tab.id, tab);
  return out;
}

/**
 * When an agent's status began, from its own tab: since when it has been working, else when
 * the tab last changed state. Null without a tab of its own or a time.
 * @type {(a: AgentInfo, tab: TabInfo | undefined) => number | null}
 */
const startOf = (a, tab) => (tab ? (a.status === "working" ? tab.working_since : tab.changed_at) ?? null : null);

/** @type {(n: number) => string} A line count as a hit shows it: 12, 1.2k, 34k. */
const amount = (n) => (n < 1000 ? String(n) : n < 9950 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n / 1000)}k`);

// The hit's numbers over the sprite, each with a dark copy behind it for an outline. They
// hold still while the hit is live, then fly off on a curve and fade: added lines up and
// to the left, removed lines up and to the right. The curve is two transitions: `top`
// eases out while `left` eases in, so a number rises first and then swings aside.
// Their ids carry the hit's number, so a new hit starts over instead of easing back.
// The hit's size sets how big they are; a crit adds a CRIT tag over them that rises straight
// up and fades with them, in the color of its bigger number.
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
  const { text, row, top } = HIT_TEXT[hit.size];
  /** @type {(s: string, color: Color, d: number, size?: number) => Element} */
  const digits = (s, color, d, size = text) => div().absolute().left(d).top(d).w(CELL).text_center().text_size(size).font_extrabold().text_color(color).child(s);
  /** @type {(el: Element) => Element} */
  const fly = (el) => el
    .opacity(hit.live ? 1 : 0)
    .transition("top", { duration: 900, easing: "ease-out" })
    .transition("left", { duration: 900, easing: "ease-in" })
    .transition("opacity", { duration: 450, delay: 600 });
  const tag = HIT[hit.removed > hit.added ? "removed" : "added"];
  return div()
    .id(id)
    .absolute()
    .left(0)
    .top(0)
    .w(CELL)
    .children(kinds.map(([kind, s, side], i) =>
      fly(div()
        .id(`${id}-${kind}`)
        .absolute()
        .w(CELL)
        .h(row)
        .left(hit.live ? 0 : side * HIT_SWING)
        .top((hit.live ? top : top - HIT_RISE) + i * row))
        .child(digits(s, "#000000c0", 1))
        .child(digits(s, HIT[kind], 0))))
    .when(hit.size === "crit", (el) => el.child(
      fly(div().id(`${id}-crit`).absolute().left(0).w(CELL).h(10).top(hit.live ? 0 : -HIT_RISE))
        .child(digits("CRIT", "#000000c0", 1, 9))
        .child(digits("CRIT", tag, 0, 9))));
}

// A combo's counter at the bottom of the box, clear of the hit numbers' first row: "3 HIT"
// over "COMBO" in amber, outlined dark as the numbers are, so it reads on any creature. Each
// hit draws it anew with the new count; when the hits stop it fades.
/**
 * @param {string} address
 * @param {Combo} combo
 * @returns {Element}
 */
function comboElement(address, combo) {
  /** @type {(s: string, size: number, top: number, color: Color, d: number) => Element} */
  const glyphs = (s, size, top, color, d) => div().absolute().left(d).top(top + d).w(CELL).text_center().text_size(size).font_extrabold().text_color(color).child(s);
  const count = `${combo.count} HIT`;
  return div()
    .id(`pp-combo-${address}-${combo.n}`)
    .absolute()
    .left(0)
    .top(CELL_H - COMBO_H)
    .w(CELL)
    .h(COMBO_H)
    .opacity(combo.step === "fade" ? 0 : 1)
    .transition("opacity", { duration: COMBO_FADE, easing: "ease-in" })
    .child(glyphs(count, 10, 0, "#000000c0", 1))
    .child(glyphs(count, 10, 0, COMBO_COLOR, 0))
    .child(glyphs("COMBO", 7, 11, "#000000c0", 1))
    .child(glyphs("COMBO", 7, 11, COMBO_COLOR, 0));
}

// An XP bar in its strip under the box: a dark track, filled from the left by the uncommitted
// lines, full at a level's worth. Its ids carry no number, so a change of the lines eases
// the fill to its new width. Cashed in, it holds the lines the commit took until the stamp
// lands, then drains to what is left, slower.
/**
 * @param {string} address
 * @param {Xp} xp
 * @returns {Element}
 */
function xpBar(address, { lines, cash }) {
  const shown = cash?.step === "hold" ? cash.lines : lines;
  const fill = shown > 0 ? Math.max(1, Math.round((XP_W * Math.min(shown, LEVEL_LINES)) / LEVEL_LINES)) : 0;
  return div()
    .id(`pp-xp-${address}`)
    .absolute()
    .left(XP_X)
    .top(CELL_H + 1)
    .w(XP_W)
    .h(XP_H - 1)
    .bg(XP_TRACK)
    .child(div()
      .id(`pp-xp-${address}-fill`)
      .absolute()
      .left(0)
      .top(0)
      .h(XP_H - 1)
      .w(fill)
      .bg(XP_COLOR)
      .transition("width", cash && cash.step !== "hold" ? { duration: XP_DRAIN, easing: "ease-in" } : { duration: 300, easing: "ease-out" }));
}

// A level up over the creature, for a commit that took a full bar, a level's worth of lines: "LEVEL UP" in the
// bar's color, outlined dark as the hit numbers are, at the box's top. It waits unseen while
// the bar drains, pops up into place once the stamp's tool has lifted away, and rises on as
// it fades.
/**
 * @param {string} address
 * @param {Cash} cash
 * @returns {Element}
 */
function levelElement(address, { n, step }) {
  /** @type {(color: Color, d: number) => Element} */
  const glyphs = (color, d) => div().absolute().left(d).top(d).w(CELL).text_center().text_size(8).font_extrabold().text_color(color).child("LEVEL UP");
  return div()
    .id(`pp-level-${address}-${n}`)
    .absolute()
    .left(0)
    .top(LEVEL_TOP + (step === "drain" ? LEVEL_RISE : step === "fade" ? -LEVEL_RISE : 0))
    .w(CELL)
    .h(10)
    .opacity(step === "pop" ? 1 : 0)
    .transition("top", step === "fade" ? { duration: 600, easing: "ease-in" } : { duration: 200, easing: "ease-out" })
    .transition("opacity", step === "fade" ? { duration: 600, easing: "ease-in" } : { duration: 120, easing: "ease-out" })
    .child(glyphs("#000000c0", 1))
    .child(glyphs(XP_COLOR, 0));
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
// A gold stamp is the same stamp, inked in GOLD instead of the "done" color.
/**
 * @param {Theme} t
 * @param {string} address
 * @param {Stamp} stamp
 * @returns {Element}
 */
function stampElement(t, address, stamp) {
  const { n, step } = stamp;
  const ink = stamp.gold ? GOLD : t.done;
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
    .children(pixels(MARK_RUNS, () => ink, [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]));
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
    .children(pixels(TOOL_RUNS, (c) => (c === "i" ? ink : TOOL_PAINT[c]), [[1, 1]]));
  return div().id(`pp-stamp-${address}-${n}`).absolute().left(0).top(0).size_full().child(mark).child(tool);
}

// A clap's glove, 3 by 4 cells of the stamp's size: g the glove, c its cuff.
const GLOVE = [
  ".g.",
  "ggg",
  "ggg",
  ".c.",
];
const GLOVE_RUNS = runsOf(GLOVE);
const GLOVE_W = GLOVE[0].length * STAMP_PX;
/** @type {Record<string, Color>} White gloves, outlined dark, read on any creature. */
const GLOVE_PAINT = { g: "#ffffff", c: "#d9d9e3" };
const CLAP_X = CELL / 2; // px: where the hands meet, in front of the creature
const CLAP_Y = 22; // px: the hands' top
const CLAP_GAP = 5; // px each hand stands off the middle when apart
/** @type {[dx: number, dy: number][]} Gold sparks around where the hands meet, 2 px each. */
const CLAP_SPARKS = [[-12, 0], [-1, -4], [10, 0]];

// A clap in front of the sprite. Two gloves meet in the middle and part again, once a beat,
// and gold sparks flash where they meet. Both loop on the same beat, so a spark shows as the
// hands come together, with no timer per clap. The gloves fade at the end.
/**
 * @param {string} address
 * @param {Clap} clap
 * @returns {Element}
 */
function clapElement(address, { n, step }) {
  const id = `pp-clap-${address}-${n}`;
  /** @type {(side: string, apart: number, together: number) => Element} */
  const glove = (side, apart, together) =>
    div().id(`${id}-${side}`).absolute().left(apart).top(CLAP_Y).w(GLOVE_W).h(GLOVE.length * STAMP_PX)
      .loop("left", { from: apart, to: together, period: CLAP_BEAT })
      .children(pixels(GLOVE_RUNS, (c) => GLOVE_PAINT[c], OUTLINE));
  const sparks = CLAP_SPARKS.map(([dx, dy], i) =>
    div().id(`${id}-spark-${i}`).absolute().left(CLAP_X + dx).top(CLAP_Y + dy).size(2).bg("#ffd447")
      .loop("opacity", { from: 0, to: 1, period: CLAP_BEAT }));
  return div()
    .id(id)
    .absolute()
    .left(0)
    .top(0)
    .size_full()
    .opacity(step === "fade" ? 0 : 1)
    .transition("opacity", { duration: 250, easing: "ease-in" })
    .child(glove("left", CLAP_X - GLOVE_W - CLAP_GAP, CLAP_X - GLOVE_W))
    .child(glove("right", CLAP_X + CLAP_GAP, CLAP_X))
    .children(sparks);
}

// A puff of smoke: round clouds over a spot with sparkles around them, in cells of `u` px.
// Gathered, it covers the spot; cleared, the clouds and sparkles drift out from it, and up
// by the look's `rise`, and fade.
// Clouds: dx, dy and size in cells from the spot, and their shade: back ones darker so the
// puff reads on a light theme too. Sparkles: a plus sign each, gold and lilac.
/** @type {Color[]} */
const SMOKE = ["#f4f4f8", "#d9d9e3", "#a9a9bb"];
/** @type {[dx: number, dy: number, d: number, shade: number][]} */
const CLOUDS = [[-3, 2, 4, 2], [3, 2, 4, 2], [-3, -2, 4, 1], [3, -2, 4, 1], [0, 0, 6, 0]];
/** @type {[dx: number, dy: number, color: Color][]} */
const SPARKS = [[-5, -4, "#ffd447"], [5, -4, "#c7a6ff"], [-5, 3, "#c7a6ff"], [5, 3, "#ffd447"]];
/**
 * What a puff looks like: its cloud shades, front to back, its sparkles, and the cells it
 * goes up as it clears.
 * @typedef {{ shades: Color[], sparks: [dx: number, dy: number, color: Color][], rise: number }} Look
 */
/** @type {Look} Magic: white smoke and sparkles. */
const MAGIC = { shades: SMOKE, sparks: SPARKS, rise: 0 };
/** @type {Look} A failed command: black smoke going up. The back clouds are lighter, so it reads on a dark theme too. */
const SOOT = { shades: ["#141418", "#4a4a56", "#7a7a88"], sparks: [], rise: 3 };

/**
 * @param {string} id
 * @param {[x: number, y: number]} spot Px in the cell.
 * @param {number} u
 * @param {boolean} clear
 * @param {Look} [look]
 * @returns {Element}
 */
function smoke(id, [x, y], u, clear, { shades, sparks, rise } = MAGIC) {
  const out = clear ? 2 : 1;
  const up = clear ? rise : 0;
  /** @type {(el: Element) => Element} */
  const drift = (el) => el
    .opacity(clear ? 0 : 1)
    .transition("left", { duration: 520, easing: "ease-out" })
    .transition("top", { duration: 520, easing: "ease-out" })
    .transition("opacity", { duration: 520, easing: "ease-in" });
  const clouds = CLOUDS.map(([dx, dy, d, shade], i) =>
    drift(div().id(`${id}-cloud-${i}`).absolute().left(Math.round(x + (dx * out - d / 2) * u)).top(Math.round(y + (dy * out - up - d / 2) * u)).size(d * u).rounded(d * u).bg(shades[shade])));
  // Sparkles start further out than clouds, so they drift only a cell and stay in the cell.
  const plus = sparks.map(([dx, dy, color], i) =>
    drift(div().id(`${id}-spark-${i}`).absolute().left(Math.round(x + (dx + (clear ? Math.sign(dx) : 0) - 1.5) * u)).top(Math.round(y + (dy + (clear ? Math.sign(dy) : 0) - up - 1.5) * u)).size(3 * u)
      .child(div().absolute().left(0).top(u).w(3 * u).h(u).bg(color))
      .child(div().absolute().left(u).top(0).w(u).h(3 * u).bg(color))));
  return div().id(id).absolute().left(0).top(0).size_full().children([...clouds, ...plus]);
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
const FACE = /** @type {[number, number]} */ ([CELL / 2, 18]); // where a cough's smoke starts: it rises to the cell's top

// A magic trick in the box. The wand shows over the cell's upper right, taps down toward the
// middle, and fades as the smoke goes up there; then the smoke clears. Arriving, the cell
// holds the creature unseen until the smoke clears ("reveal"); leaving, the creature goes
// under the smoke ("poof") and the smoke clears to an empty cell ("clear"). The cell hides
// the creature: this draws the wand and the smoke only.
/**
 * @param {string} id
 * @param {Trick["step"] | Exit["step"]} step
 * @returns {Element}
 */
function trickElement(id, step) {
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
  if (!shown) el.child(smoke(`${id}-smoke`, CENTER, PX, step !== "poof"));
  return el.child(wand);
}

// A signpost, 7 by 9 cells: a board on a post. The board points right; `mirror` turns it to
// point left, and seen edge-on it is one plank. b board, w its writing, e the plank, p post.
const BOARD = [
  "bbbbb..",
  "bbbbbb.",
  "bwwwbbb",
  "bbbbbb.",
  "bbbbb..",
];
/** @type {(grid: string[]) => string[]} */
const mirror = (grid) => grid.map((line) => [...line].reverse().join(""));
const EDGE = BOARD.map(() => "...e...");
const POST = [...BOARD.map(() => "......."), "...p...", "...p...", "...p...", "..ppp.."];
/** @type {Record<string, Color>} The sign's own wood, the stamp tool's. */
const SIGN_PAINT = { b: "#ebbd85", w: "#7a4e2d", e: "#c98b4f", p: "#7a4e2d" };
/** @typedef {"plant" | "left" | "edge" | "right" | "fade"} SignStep */
/** @type {Record<"left" | "edge" | "right", [x: number, y: number, w: number, c: string][]>} The board as each step of its turn shows it. */
const BOARD_RUNS = { left: runsOf(mirror(BOARD)), edge: runsOf(EDGE), right: runsOf(BOARD) };
const POST_RUNS = runsOf(POST);
const SIGN_W = POST[0].length * STAMP_PX;
const SIGN_H = POST.length * STAMP_PX;
const SIGN_X = 0; // px: the sign stands at the sprite's lower left, clear of a stamp at its lower right
/** @type {[dx: number, dy: number][]} A dark outline, so the sign reads on any creature. */
const OUTLINE = [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]];
/** @type {[ms: number, step: SignStep | null][]} After "plant": it shows pointing back, turns, points on, and fades. */
const SIGN_STEPS = [[30, "left"], [700, "edge"], [820, "right"], [2400, "fade"], [3100, null]];

// A checkout's signpost at the sprite's lower left. Planted unseen with its board pointing
// left, the way HEAD came from, it shows; the board turns edge-on, then points right, the way
// HEAD went. It holds there, then fades. Each frame of the turn is its own layer, shown in its
// step. The ids carry the shot's number, so a new checkout starts over.
/**
 * @param {Theme} _t
 * @param {string} address
 * @param {Shot} shot
 * @returns {Element}
 */
function signElement(_t, address, { n, step }) {
  const id = `pp-sign-${address}-${n}`;
  const facing = step === "plant" ? "left" : step === "fade" ? "right" : step;
  /** @type {(runs: [number, number, number, string][]) => Element[]} */
  const paint = (runs) => pixels(runs, (c) => SIGN_PAINT[c], OUTLINE);
  const boards = /** @type {const} */ (["left", "edge", "right"]).map((side) =>
    div().id(`${id}-${side}`).absolute().left(0).top(0).size_full().opacity(facing === side ? 1 : 0).transition("opacity", { duration: 60 }).children(paint(BOARD_RUNS[side])));
  return div()
    .id(id)
    .absolute()
    .left(SIGN_X)
    .top(STAMP_FLOOR - SIGN_H)
    .w(SIGN_W)
    .h(SIGN_H)
    .opacity(step === "plant" || step === "fade" ? 0 : 1)
    .transition("opacity", step === "fade" ? { duration: 600, easing: "ease-in" } : { duration: 200, easing: "ease-out" })
    .children([div().absolute().left(0).top(0).size_full().children(paint(POST_RUNS)), ...boards]);
}

// A reset's rewind: the creature itself, drawn in turn from the front, turned to its left, from
// the back and turned to its right (`faceRects`), three times over. That is the other way
// from where it walks: it spins backwards. Like a worn tape, its rows slip sideways in three
// bands, each on its own beat, a tracking bar rolls over it, and a "◀◀" blinks at the box's
// upper left.
const SPRITE = GRID * PX; // px: the sprite, square, centered in the box
const SPRITE_X = (CELL - SPRITE) / 2;
const SPRITE_Y = (CELL_H - SPRITE) / 2;
/** @type {Face[]} One turn, backwards. */
const TURN = ["front", "left", "back", "right"];
const REWIND_FRAME = 80; // ms each face shows
const REWIND_TURNS = 3;
/** @type {[ms: number, step: Face | null][]} After "front": each face in turn, then gone. */
const REWIND_STEPS = [
  ...Array.from({ length: REWIND_TURNS * TURN.length - 1 }, (_, i) => /** @type {[number, Face]} */ ([(i + 1) * REWIND_FRAME, TURN[(i + 1) % TURN.length]])),
  [REWIND_TURNS * TURN.length * REWIND_FRAME, null],
];
/** @type {[from: number, to: number, period: number, swing: number][]} The bands of rows that slip, and how: ms there and back, px each way. */
const BANDS = [[0, 4, 100, 1], [4, 8, 130, 2], [8, GRID, 110, 1]];
// "◀◀", 6 by 5 cells of 2 px.
const REWIND_GLYPH = [
  "..x..x",
  ".xx.xx",
  "xxxxxx",
  ".xx.xx",
  "..x..x",
];
const GLYPH_PX = 2;
const GLYPH_RUNS = runsOf(REWIND_GLYPH);
const GLYPH_W = REWIND_GLYPH[0].length * GLYPH_PX;
const GLYPH_H = REWIND_GLYPH.length * GLYPH_PX;
/** @type {Color} A tape deck's on-screen white, over a dark shadow so it reads on a light theme. */
const GLYPH_INK = "#ffffff";
/** @type {Color} */
const TRACKING = "#ffffff73";

/**
 * @param {Theme} _t
 * @param {string} address
 * @param {Shot} shot
 * @returns {Element}
 */
function rewindElement(_t, address, { n, step }) {
  const id = `pp-rewind-${address}-${n}`;
  const rects = faceRects(makeSprite(seedFor(address)), /** @type {Face} */ (step), PX);
  // Each band keeps its id from face to face, so its slip runs on through the turn.
  const bands = BANDS.map(([from, to, period, swing], i) =>
    div().id(`${id}-band-${i}`).absolute().left(0).top(0).size(SPRITE).loop("left", { from: -swing, to: swing, period, easing: "linear" }).children(
      rects.flatMap((r) => {
        const [top, bottom] = [Math.max(r.y, from * PX), Math.min(r.y + r.h, to * PX)];
        return top < bottom ? [div().absolute().left(r.x).top(top).w(r.w).h(bottom - top).bg(r.color)] : [];
      })));
  const bar = div().id(`${id}-bar`).absolute().left(0).top(0).w(SPRITE).h(2).bg(TRACKING).loop("top", { from: PX, to: SPRITE - 2 * PX, period: 700, easing: "linear" });
  /** @type {(color: Color, d: number) => Element} The glyph in one color, moved by `d` px. */
  const ink = (color, d) => div().absolute().left(d).top(d).size_full().children(GLYPH_RUNS.map(([x, y, w]) =>
    div().absolute().left(x * GLYPH_PX).top(y * GLYPH_PX).w(w * GLYPH_PX).h(GLYPH_PX).bg(color)));
  const glyph = div().id(`${id}-glyph`).absolute().left(3).top(2).w(GLYPH_W).h(GLYPH_H).loop("opacity", { from: 1, to: 0.35, period: 480 })
    .child(ink(STAMP_DARK, 1))
    .child(ink(GLYPH_INK, 0));
  const tape = div().id(`${id}-tape`).absolute().left(SPRITE_X).top(SPRITE_Y).size(SPRITE).children([...bands, bar]);
  return div().id(id).absolute().left(0).top(0).size_full().child(tape).child(glyph);
}

// A rebase's deck of cards, shuffled in front of the creature, low in the middle of its box.
// Each card is 10 by 14 px: a dark edge, a white border and a blue back with a light mark.
// Squared, the cards stack 2 px apart, so the deck's side shows a line per card. Split, the
// even cards go to the left half and the odd ones to the right, each half lifted; riffled,
// they drop back into the middle one at a time, bottom first, so the halves take turns and
// the deck is whole again. It shuffles twice, holds, and fades.
const DECK = 6;
const CARD_W = 10;
const CARD_H = 14;
const CARD_DY = 2; // px between one card and the next in a stack
const DECK_X = (CELL - CARD_W) / 2; // px: a squared deck's left
const DECK_SPREAD = 8; // px each half goes aside
const DECK_LIFT = 3; // px the halves lift as they split
const RIFFLE_GAP = 45; // ms from one card's drop to the next
/** @type {[x: number, y: number, w: number, h: number, color: Color][]} One card, back up: a dark edge, a white border, a blue back, a light mark. */
const CARD = [
  [0, 0, CARD_W, CARD_H, STAMP_DARK],
  [1, 1, CARD_W - 2, CARD_H - 2, "#ffffff"],
  [2, 2, CARD_W - 4, CARD_H - 4, "#3b6fd4"],
  [4, 5, 2, 4, "#a9c3f5"],
  [3, 6, 4, 2, "#a9c3f5"],
];
/** @typedef {"deal" | "show" | "split" | "riffle" | "fade"} DeckStep */
/** @type {[ms: number, step: DeckStep | null][]} After "deal": it shows, splits and riffles twice, holds, and fades. */
const DECK_STEPS = [[30, "show"], [350, "split"], [600, "riffle"], [1000, "split"], [1250, "riffle"], [2300, "fade"], [2800, null]];

// Dealt unseen and squared, the deck shows; at each split its halves part and lift, and at
// each riffle the cards fall back in turn. Each card keeps its id through the shuffle, so it
// glides from place to place; the ids carry the shot's number, so a new rebase starts over.
/**
 * @param {Theme} _t
 * @param {string} address
 * @param {Shot} shot
 * @returns {Element}
 */
function deckElement(_t, address, { n, step }) {
  const id = `pp-deck-${address}-${n}`;
  const split = step === "split";
  const cards = Array.from({ length: DECK }, (_, i) => {
    const half = i % 2 ? 1 : -1;
    const height = (split ? i >> 1 : i) * CARD_DY;
    /** @type {import("gpui-shell").TransitionPolicy} Riffled, each card falls after the one under it. */
    const glide = step === "riffle" ? { duration: 90, delay: i * RIFFLE_GAP, easing: "ease-in" } : { duration: 160, easing: "ease-out" };
    return div()
      .id(`${id}-card-${i}`)
      .absolute()
      .left(DECK_X + (split ? half * DECK_SPREAD : 0))
      .top(STAMP_FLOOR - CARD_H - height - (split ? DECK_LIFT : 0))
      .w(CARD_W)
      .h(CARD_H)
      .transition("left", glide)
      .transition("top", glide)
      .children(CARD.map(([x, y, w, h, color]) => div().absolute().left(x).top(y).w(w).h(h).bg(color)));
  });
  return div()
    .id(id)
    .absolute()
    .left(0)
    .top(0)
    .size_full()
    .opacity(step === "deal" || step === "fade" ? 0 : 1)
    .transition("opacity", step === "fade" ? { duration: 500, easing: "ease-in" } : { duration: 150, easing: "ease-out" })
    .children(cards);
}

// A pull's package, 6 by 5 cells of the stamp's size: a cardboard box seen from the front, its
// lid on top and a strip of tape down the middle of both, a white label on its front. l the
// lid, d the lid's edge, c the box, t the tape, w the label.
const PACKAGE = [
  "llttll",
  "dddddd",
  "cctccc",
  "wctccc",
  "cctccc",
];
/** @type {Record<string, Color>} Cardboard in the stamp tool's wood, with paler tape and a white label. */
const PACKAGE_PAINT = { l: "#ebbd85", d: "#7a4e2d", c: "#c98b4f", t: "#f3d9a4", w: "#ffffff" };
const PACKAGE_RUNS = runsOf(PACKAGE);
const PACKAGE_W = PACKAGE[0].length * STAMP_PX;
const PACKAGE_H = PACKAGE.length * STAMP_PX;
const PACKAGE_X = (CELL - PACKAGE_W) / 2; // px: in front of the creature, over its middle columns
const PACKAGE_REST = STAMP_FLOOR - PACKAGE_H; // px: its top when it rests, its bottom on the stamp's floor
const PACKAGE_FALL = 300; // ms from the box's top to the floor
const PACKAGE_BOUNCE = 4; // px it bounces back up when it lands
/** @type {[dx: number, dy: number][]} Where each puff of dust goes as it spreads from under the package, from its lower corners. */
const DUST = [[-6, -3], [6, -3]];
const DUST_PX = 2;
/** @type {Color} */
const DUST_COLOR = "#d9d9e3";
/** @typedef {"drop" | "fall" | "bounce" | "rest" | "fade"} PackageStep */
/** @type {[ms: number, step: PackageStep | null][]} After "drop": it falls, bounces, rests, holds, and fades. */
const PACKAGE_STEPS = [[30, "fall"], [30 + PACKAGE_FALL, "bounce"], [30 + PACKAGE_FALL + 90, "rest"], [2200, "fade"], [2700, null]];

// Dropped unseen at the top of the box, the package falls onto the stamp's floor in front of
// the creature, faster as it falls, and shows on the way down. It bounces once, and a puff of
// dust spreads from each of its lower corners as it lands. It rests there, holds, and fades.
// The ids carry the shot's number, so a new pull starts over.
/**
 * @param {Theme} _t
 * @param {string} address
 * @param {Shot} shot
 * @returns {Element}
 */
function packageElement(_t, address, { n, step }) {
  const id = `pp-package-${address}-${n}`;
  const top = step === "drop" ? 0 : step === "bounce" ? PACKAGE_REST - PACKAGE_BOUNCE : PACKAGE_REST;
  /** @type {import("gpui-shell").TransitionPolicy} */
  const move = step === "fall" ? { duration: PACKAGE_FALL, easing: "ease-in" } : step === "bounce" ? { duration: 90, easing: "ease-out" } : { duration: 90, easing: "ease-in" };
  const box = div()
    .id(`${id}-box`)
    .absolute()
    .left(PACKAGE_X)
    .top(top)
    .w(PACKAGE_W)
    .h(PACKAGE_H)
    .opacity(step === "drop" || step === "fade" ? 0 : 1)
    .transition("top", move)
    .transition("opacity", step === "fade" ? { duration: 500, easing: "ease-in" } : { duration: 80 })
    .children(pixels(PACKAGE_RUNS, (c) => PACKAGE_PAINT[c], OUTLINE));
  // Each puff stands at a lower corner, unseen, until the package lands; then it shows and spreads.
  const spread = step === "rest" || step === "fade";
  const dust = DUST.map(([dx, dy], i) => {
    const [x, y] = [PACKAGE_X + (i ? PACKAGE_W - DUST_PX : 0), STAMP_FLOOR - DUST_PX];
    return div()
      .id(`${id}-dust-${i}`)
      .absolute()
      .left(x + (spread ? dx : 0))
      .top(y + (spread ? dy : 0))
      .w(DUST_PX)
      .h(DUST_PX)
      .bg(DUST_COLOR)
      .opacity(step === "bounce" ? 1 : 0)
      .transition("left", { duration: 300, easing: "ease-out" })
      .transition("top", { duration: 300, easing: "ease-out" })
      .transition("opacity", spread ? { duration: 300, easing: "ease-in" } : { duration: 40 });
  });
  return div().id(id).absolute().left(0).top(0).size_full().children([...dust, box]);
}

// A cherry-pick's twig, 5 by 2 cells of the stamp's size, coming in from the box's right
// edge: b the branch, l a leaf at its tip.
const TWIG = [
  "lbbbb",
  "ll...",
];
// Its pair of cherries, 5 by 4 cells, hanging from the branch by their stems: s the stems,
// r the cherries, h a shine on each.
const CHERRY = [
  "..s..",
  ".s.s.",
  "hr.hr",
  "rr.rr",
];
/** @type {Record<string, Color>} The branch in the stamp tool's dark wood, a green leaf and stems, red cherries. */
const CHERRY_PAINT = { b: "#7a4e2d", l: "#6cc24a", s: "#4a9a3a", r: "#d7263d", h: "#ffffff" };
const TWIG_RUNS = runsOf(TWIG);
const CHERRY_RUNS = runsOf(CHERRY);
const TWIG_W = TWIG[0].length * STAMP_PX;
const TWIG_H = TWIG.length * STAMP_PX;
const CHERRY_W = CHERRY[0].length * STAMP_PX;
const CHERRY_H = CHERRY.length * STAMP_PX;
const TWIG_X = CELL - TWIG_W - 1; // px: at the box's upper right, its outline inside the box
const TWIG_TOP = 3; // px: low enough that its spring-back keeps its outline inside the box
const CHERRY_HANG = TWIG_TOP + STAMP_PX; // px: the stems' top, under the branch
const CHERRY_X = Math.floor((CELL - CHERRY_W) / 2); // px: plucked, in front of the creature's middle
const CHERRY_HELD = STAMP_FLOOR - CHERRY_H; // px: plucked, its bottom on the stamp's floor
const CHERRY_TUG = 2; // px the creature pulls the cherries, and the branch with them, down
/** @typedef {"hang" | "show" | "tug" | "pluck" | "held" | "fade"} CherryStep */
/** @type {[ms: number, step: CherryStep | null][]} After "hang": it shows, is tugged, plucked as the branch springs back, held, and fades. */
const CHERRY_STEPS = [[30, "show"], [600, "tug"], [800, "pluck"], [900, "held"], [2300, "fade"], [2800, null]];

// Hung unseen from a twig at the box's upper right, a pair of cherries shows. The creature
// tugs at them: they and the branch bend down. Then it plucks them: they swing down into its
// hands, in front of its middle, while the branch springs up past where it was and settles.
// It holds them, and both fade. The ids carry the shot's number, so a new cherry-pick starts
// over.
/**
 * @param {Theme} _t
 * @param {string} address
 * @param {Shot} shot
 * @returns {Element}
 */
function cherryElement(_t, address, { n, step }) {
  const id = `pp-cherry-${address}-${n}`;
  const tugged = step === "tug" ? CHERRY_TUG : 0;
  const plucked = step === "pluck" || step === "held" || step === "fade";
  const twig = div()
    .id(`${id}-twig`)
    .absolute()
    .left(TWIG_X)
    .top(TWIG_TOP + tugged - (step === "pluck" ? CHERRY_TUG : 0))
    .w(TWIG_W)
    .h(TWIG_H)
    .transition("top", step === "pluck" ? { duration: 100, easing: "ease-out" } : { duration: 150, easing: "ease-in-out" })
    .children(pixels(TWIG_RUNS, (c) => CHERRY_PAINT[c], OUTLINE));
  // Plucked, the cherries go aside easing out and down easing in, so they swing down in an arc.
  const cherries = div()
    .id(`${id}-pair`)
    .absolute()
    .left(plucked ? CHERRY_X : TWIG_X)
    .top(plucked ? CHERRY_HELD : CHERRY_HANG + tugged)
    .w(CHERRY_W)
    .h(CHERRY_H)
    .transition("left", plucked ? { duration: 250, easing: "ease-out" } : { duration: 150 })
    .transition("top", plucked ? { duration: 250, easing: "ease-in" } : { duration: 150, easing: "ease-in-out" })
    .children(pixels(CHERRY_RUNS, (c) => CHERRY_PAINT[c], OUTLINE));
  return div()
    .id(id)
    .absolute()
    .left(0)
    .top(0)
    .size_full()
    .opacity(step === "hang" || step === "fade" ? 0 : 1)
    .transition("opacity", step === "fade" ? { duration: 500, easing: "ease-in" } : { duration: 150, easing: "ease-out" })
    .children([twig, cherries]);
}

/** @type {OneShot} A pull's, and a fast-forward's: what a `git merge` that makes no commit is. */
const PACKAGE_SHOT = { first: "drop", steps: PACKAGE_STEPS, draw: packageElement };

/** @type {Partial<Record<MoveKind, OneShot>>} The one-shot each kind of move plays; a kind not here shows nothing yet. */
const ONE_SHOTS = {
  checkout: { first: "plant", steps: SIGN_STEPS, draw: signElement },
  reset: { first: "front", steps: REWIND_STEPS, draw: rewindElement, hides: true },
  rebase: { first: "deal", steps: DECK_STEPS, draw: deckElement },
  pull: PACKAGE_SHOT,
  merge: PACKAGE_SHOT,
  "cherry-pick": { first: "hang", steps: CHERRY_STEPS, draw: cherryElement },
};

// A thumbs up, 7 by 7 cells: the thumb up, the fist under it with its fingers to the right.
// h the hand, f the folds between the fingers.
const THUMB = [
  "...hh..",
  "...hh..",
  "..hhh..",
  "hhhhhhh",
  "hhfffff",
  "hhhhhhh",
  ".hfffff",
];
/** @type {Record<string, Color>} A hand of its own gold, the stamp's outline round it. */
const THUMB_PAINT = { h: "#ffcf4a", f: "#d99a2b" };
const THUMB_RUNS = runsOf(THUMB);
const THUMB_W = THUMB[0].length * STAMP_PX;
const THUMB_H = THUMB.length * STAMP_PX;
const THUMB_X = CELL - 6 - THUMB_W; // px: over the creature's right side, its right edge the tube's
const THUMB_TOP = 16; // px, up
const THUMB_RISE = 6; // px it pops up by

// The current agent's crown, 6 by 2 cells: three points over a band. h the points, f the band.
const CROWN = [
  "h.hh.h",
  "ffffff",
];
const CROWN_RUNS = runsOf(CROWN);
const CROWN_W = CROWN[0].length * STAMP_PX;
const CROWN_H = CROWN.length * STAMP_PX;
const CROWN_X = (CELL - CROWN_W) / 2; // px: over the sprite's middle columns
const CROWN_TOP = 1; // px: its outline starts at the box's top

// The crown over the current agent's creature: the agent the key commands act on, so a closed
// drawer shows it. It stands at the top of the box, behind the sprite, in the thumb's gold
// with the stamp's outline. It reaches 8 px down the box; a creature's eyes start no higher
// than 13 px, its fourth row, and the sprite is drawn over it, so it never covers the
// creature. It holds still: it neither moves nor turns.
/** @type {(address: string) => Element} */
const crownElement = (address) =>
  div()
    .id(`pp-crown-${address}`)
    .absolute()
    .left(CROWN_X)
    .top(CROWN_TOP)
    .w(CROWN_W)
    .h(CROWN_H)
    .children(pixels(CROWN_RUNS, (c) => THUMB_PAINT[c], OUTLINE));

// The test tube from the sprite's testing, falling. Its 10 by 8 cells have the upright tube in
// the two columns at the right, just where the sprite holds it (36..42 by 19..40 in the cell),
// and room to the left for it to fall into. g glass, a the liquid, the theme's accent as in
// the sprite. It tips to its left and lands on its side, open end first, and the liquid runs
// out of it into a puddle.
/** @type {Record<"hold" | "tip" | "fall" | "spill", string[]>} */
const TUBE = {
  hold: ["........gg", "........gg", "........gg", "........aa", "........aa", "........aa", "........aa", ".........."],
  tip: ["..........", "..........", "....gg....", ".....gg...", "......gaa.", ".......aaa", "........aa", ".........."],
  fall: ["..........", "..........", "..........", "..........", "..........", "..........", "...gggaaaa", "...gggaaaa"],
  spill: ["..........", "..........", "..........", "..........", "..........", "..........", "...ggggggg", "aaaggggggg"],
};
const TUBE_RUNS = /** @type {Record<keyof typeof TUBE, [x: number, y: number, w: number, c: string][]>} */ (
  Object.fromEntries(Object.entries(TUBE).map(([step, grid]) => [step, runsOf(grid)]))
);
const TUBE_X = 6 + 10 * PX - 8 * STAMP_PX; // px: the box's left, so its 9th column is the sprite's 11th
const TUBE_TOP = 4 + 5 * PX; // px: its top row is the sprite's 6th, the tube's top
const GLASS = "#cfe3ea"; // the sprite's glass

// How tests came out, beside the creature, which has put its own tube down meanwhile.
// Passed: a thumbs up, unseen a little low, pops up, holds and fades. Failed: the tube, drawn
// where the creature held it, tips over, lands on its side, spills, and fades. Each frame of
// the fall is its own layer, shown in its step, as the signpost's turn is. The ids carry the
// verdict's number, so the next tests start over.
/**
 * @param {Theme} t
 * @param {string} address
 * @param {Verdict} verdict
 * @returns {Element}
 */
function verdictElement(t, address, { n, step, passed }) {
  const id = `pp-verdict-${address}-${n}`;
  if (passed) {
    return div()
      .id(id)
      .absolute()
      .left(THUMB_X)
      .top(THUMB_TOP + (step === "raise" ? THUMB_RISE : 0))
      .w(THUMB_W)
      .h(THUMB_H)
      .opacity(step === "up" ? 1 : 0)
      .transition("top", { duration: 220, easing: "ease-out" })
      .transition("opacity", step === "fade" ? { duration: 600, easing: "ease-in" } : { duration: 120, easing: "ease-out" })
      .children(pixels(THUMB_RUNS, (c) => THUMB_PAINT[c], OUTLINE));
  }
  const frame = step === "fade" ? "spill" : step;
  /** @type {(c: string) => Color} */
  const paint = (c) => (c === "g" ? GLASS : t.accent);
  const frames = /** @type {const} */ (["hold", "tip", "fall", "spill"]).map((at) =>
    div().id(`${id}-${at}`).absolute().left(0).top(0).size_full().opacity(frame === at ? 1 : 0).transition("opacity", { duration: 40 }).children(pixels(TUBE_RUNS[at], paint, OUTLINE)));
  return div()
    .id(id)
    .absolute()
    .left(TUBE_X)
    .top(TUBE_TOP)
    .w(10 * STAMP_PX)
    .h(8 * STAMP_PX)
    .opacity(step === "fade" ? 0 : 1)
    .transition("opacity", { duration: 600, easing: "ease-in" })
    .children(frames);
}

// The bees in the lanes under the sprite's box. Each has a place by its position in the
// list, so when one leaves the ones after it glide up a place. A new bee starts unseen in
// the middle of the sprite. A leaving bee keeps its place until it has gone: a bee flies
// back into the middle of the sprite and fades as it gets there; a sheep hops off to the
// side, away from the edge the drawer is docked on (`side`), into its row, and fades as it
// lands, facing the way it goes.
/**
 * @param {Flier[]} bees
 * @param {"left" | "right" | "bottom"} side
 * @param {number} below Px from the cell's top where the lanes start: under the box, and its XP bar.
 * @returns {Element[]}
 */
function hive(bees, side, below) {
  /** @type {(i: number) => [number, number]} The i-th place: left and top in the cell. */
  const spot = (i) => [2 + (i % BEE_ROW) * BEE_STEP, below + BEE_LIFT + Math.floor(i / BEE_ROW) * BEE_LANE];
  const [w, h] = [BEE_W * BEE_PX, BEE_H * BEE_PX];
  const home = [(CELL - w) / 2, (CELL_H - h) / 2];
  const away = side === "right" ? -1 : 1;
  const more = bees.length > BEE_MAX ? bees.length - (BEE_MAX - 1) : 0;
  const shown = more ? bees.slice(0, BEE_MAX - 1) : bees;
  const out = shown.map((bee, i) => {
    const [left, top] = spot(i);
    const step = bee.leave?.step;
    const el = div().id(bee.id).absolute();
    if (step === "home") {
      el.left(home[0]).top(home[1]).opacity(0)
        .transition("left", { duration: HOME_MS, easing: "ease-in" })
        .transition("top", { duration: HOME_MS, easing: "ease-in" })
        .transition("opacity", { duration: 200, delay: HOME_MS - 200 });
    } else if (step) {
      const off = step === "off";
      el.left(left + away * (off ? HOP_X : HOP_X / 2)).top(off ? top : top - HOP_UP).opacity(off ? 0 : 1)
        .transition("left", { duration: HOP_MS, easing: "linear" })
        .transition("top", { duration: HOP_MS, easing: off ? "ease-in" : "ease-out" })
        .transition("opacity", { duration: HOP_MS, easing: "ease-in" });
    } else {
      el.left(bee.out ? left : home[0]).top(bee.out ? top : home[1]).opacity(bee.out ? 1 : 0)
        .transition("left", { duration: 450, easing: "ease-out" })
        .transition("top", { duration: 450, easing: "ease-out" })
        .transition("opacity", { duration: 200 });
    }
    return el.child(beeElement({ kind: bee.kind, status: bee.status, px: BEE_PX, phase: i, flip: Boolean(step && step !== "home") && away < 0 }));
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
// the stripe goes: "left", "right" or "bottom". Between the box and the lanes, the XP bar
// takes a strip of its own while it shows. The sprite draws its own "!" when blocked,
// so the box adds only the tint. A hit's numbers, a combo's counter, a stamp, a clap and a
// move's one-shot go over the sprite, in the box, so a closed drawer shows them too. The box dips
// as the stamp lands and rises after. A trick hides the sprite until it reveals it, an exit hides it under its
// smoke, a one-shot that draws the creature itself hides it while it plays, and a new bee's
// puff goes over its middle. A failed command's black smoke goes over its face and up, while
// the sprite lurches with the cough; the box's own top is the stamp's. How tests came out
// goes beside it, while it holds no tube of its own. The current agent's crown stands behind
// the sprite at the box's top, and goes while a trick or an exit hides the sprite.
/**
 * @param {Theme} t
 * @param {Item} it
 * @param {"left" | "right" | "bottom"} side
 * @param {Facing | null} face The way the creature faces: toward the open side while hovered.
 * @returns {Element}
 */
function cell(t, { a, seed, on, hit, combo, xp, stamp, clap, move, trick, exit, puff, soot, verdict, bees, work, stage, turn, daytime }, side, face) {
  const hidden = trick ? trick.step !== "reveal" : Boolean(exit) && (exit.step === "poof" || exit.step === "clear");
  const shot = move && ONE_SHOTS[move.move.kind];
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
    .when(on && !hidden, (el) => el.child(crownElement(a.address)))
    .child(spriteElement(makeSprite(seed), {
      id: `pp-spr-${a.address}`,
      px: PX,
      status: a.status,
      work,
      hit: hit && { n: hit.n, damage: hit.removed > 0, live: hit.live, size: hit.size },
      stage,
      turn,
      tube: !verdict,
      daytime,
      face,
    })
      .when(Boolean(trick || exit), (el) => el.opacity(hidden ? 0 : 1).transition("opacity", { duration: 360, easing: "ease-out" }))
      .when(Boolean(shot?.hides), (el) => el.opacity(0))
      .when(Boolean(soot), (el) => el
        .top(soot.step === "cough" ? COUGH : 0)
        .transition("top", soot.step === "cough" ? { duration: 60, easing: "ease-out" } : { duration: 300, easing: "ease-out" })))
    .child(stripe)
    .when(Boolean(trick), (el) => el.child(trickElement(`pp-trick-${a.address}-${trick.n}`, trick.step)))
    .when(Boolean(exit), (el) => el.child(trickElement(`pp-exit-${a.address}-${exit.n}`, exit.step)))
    .when(Boolean(puff), (el) => el.child(smoke(`pp-puff-${a.address}-${puff.n}`, CENTER, BEE_PX, puff.step === "clear")))
    .when(Boolean(soot), (el) => el.child(smoke(`pp-soot-${a.address}-${soot.n}`, FACE, BEE_PX, soot.step === "rise", SOOT)))
    .when(Boolean(verdict), (el) => el.child(verdictElement(t, a.address, verdict)))
    .when(Boolean(shot), (el) => el.child(shot.draw(t, a.address, move)))
    .when(Boolean(combo), (el) => el.child(comboElement(a.address, combo)))
    .when(Boolean(clap), (el) => el.child(clapElement(a.address, clap)))
    .when(Boolean(xp?.cash && xp.cash.lines - xp.cash.left >= LEVEL_LINES && xp.cash.step !== "hold"), (el) => el.child(levelElement(a.address, xp.cash)))
    .when(Boolean(hit), (el) => el.child(numbers(a.address, hit)))
    .when(Boolean(stamp), (el) => el
      .top(stamp.step === "press" ? STAMP_DIP : 0)
      .transition("top", stamp.step === "press" ? { duration: 60, delay: STAMP_SLAM - 40, easing: "ease-in" } : { duration: 500, easing: "ease-out" })
      .child(stampElement(t, a.address, stamp)));
  const below = CELL_H + (xp ? XP_H : 0);
  return div().relative().w(CELL).h(below + lanes(bees.length)).flex_none().child(box).when(Boolean(xp), (el) => el.child(xpBar(a.address, xp))).children(hive(bees, side, below));
}

/** @type {(address: string) => string | null} The machine of a remote address ("mini/t7"), else null. */
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// What every agent's element does, whatever its shape: focus marked, click goes there,
// right click opens the picker. The id is the address, unique and stable per agent. A
// leaving agent's element does nothing: its pane and terminal are gone.
/** @type {(t: Theme, it: Item, el: Element, id: string) => Element} */
const shell = (t, { a, on, exit }, el, id) =>
  el
    .id(id)
    .rounded(6)
    .when(a.status === "blocked" && !on, (el) => el.bg(`${t.blocked}1f`))
    .when(on, (el) => el.bg(t.selected))
    .when(!exit, (el) => el
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => go(a))
      .on_mouse_down("right", () => openPicker(a.address)));

// A side edge: the cell on the edge side, the name and status line beside it.
/**
 * @param {Theme} t
 * @param {Item} it
 * @param {boolean} right Docked on the right edge: the cell goes on the right.
 * @param {Facing | null} face
 * @returns {Element}
 */
function row(t, it, right, face) {
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
  const parts = [cell(t, it, right ? "right" : "left", face), text];
  return shell(t, it, h_flex(), `pp-row-${a.address}`).items_center().children(right ? parts.reverse() : parts);
}

// A top or bottom edge: the sprite standing over its name, the status line under that.
/**
 * @param {Theme} t
 * @param {Item} it
 * @param {Facing | null} face
 * @returns {Element}
 */
function tile(t, it, face) {
  const { a, line } = it;
  const blocked = a.status === "blocked";
  return shell(t, it, v_flex(), `pp-tile-${a.address}`)
    .w(TILE_W)
    .pb(4)
    .items_center()
    .tooltip(`${nameOf(a)}: ${line}`)
    .child(cell(t, it, "bottom", face))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(11).font_medium().text_color(t.foreground).child(nameOf(a)))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(10).text_color(blocked ? t.blocked : t.dim).when(blocked, (el) => el.font_semibold()).child(line));
}
