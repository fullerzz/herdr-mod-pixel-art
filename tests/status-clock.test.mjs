// The status clock: each draw knows since when every agent has had its status, and how many
// of that status's stages it has held for. The drawer wakes itself when the next is due.
// A look that changes the longer a status holds reads it: a blocked fire burns hotter.

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { FIRE, SMOKE, STAGES, TURNS } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

const draw = (drawer, cx) => check(drawer.render(cx));
const MIN = 60_000;
/** A change to blocked jolts first: runs the jolt's steps out, so only the clock's timers are left. */
const settle = (cx) => cx.run(TURNS.jolt.steps.at(-1)[0]);
const saved = Object.fromEntries(Object.entries(STAGES).map(([status, marks]) => [status, [...marks]]));
/** A tab of its own in spaces(), with its times. */
const tab = (id, times = {}) => ({ id, index: 1, name: id, named: false, active: true, status: null, panes: 1, zoomed: false, settled: false, settled_at: null, changed_at: null, working_since: null, ...times });
const space = (...tabs) => ({ id: "sp1", index: 1, name: "repo", named: false, folder: "", machine: null, branch: null, active: true, status: null, tabs });

beforeEach(() => {
  mock.reset();
  // Blocked ships with these; idle gets some too, to test two statuses at once.
  STAGES.blocked.splice(0, Infinity, 1 * MIN, 5 * MIN);
  STAGES.idle.splice(0, Infinity, 10 * MIN);
});
afterEach(() => {
  for (const [status, marks] of Object.entries(saved)) STAGES[status].splice(0, Infinity, ...marks);
});

test("blocked ships with stages at one and five minutes; no other status has any yet", () => {
  assert.deepEqual(saved.blocked, [1 * MIN, 5 * MIN]);
  for (const status of ["working", "done", "idle"]) assert.deepEqual(saved[status], [], status);
});

test("a blocked agent's fire grows after a minute and smokes after five, as the drawer wakes", (t) => {
  // Blocked since the drawer opened, from its own tab: no change, so no turn plays first.
  t.mock.timers.enable({ apis: ["Date"], now: 10 * MIN });
  mock.agent("t1", { status: "blocked", tab: "tb1" });
  mock.state.spaces = [space(tab("tb1", { changed_at: 10 * MIN }))];
  const drawer = new Drawer();
  const cx = context();
  /** The sprite's fire and smoke, as the number of rectangles in each. */
  const heat = () => {
    const nodes = walk(find(drawer.render(cx), "pp-spr-t1"));
    const of = (colors) => nodes.filter((n) => calls(n, "bg").some(([c]) => Object.values(colors).includes(c))).length;
    return { fire: of(FIRE), smoke: of(SMOKE) };
  };

  const small = heat();
  assert.ok(small.fire > 0, "on fire from the first second");
  assert.equal(small.smoke, 0);

  t.mock.timers.tick(1 * MIN);
  cx.run(1 * MIN);
  const big = heat();
  assert.ok(big.fire > small.fire, "a minute in, the fire is bigger");
  assert.equal(big.smoke, 0);

  t.mock.timers.tick(4 * MIN);
  cx.run(4 * MIN);
  const hot = heat();
  assert.ok(hot.fire > big.fire, "five minutes in, embers fly");
  assert.ok(hot.smoke > 0, "and it smokes");
  assert.equal(cx.timers.length, 0, "the hottest fire wakes nothing");
});

test("an agent of the first draw has no known start, stays at stage 0, and wakes nothing", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  mock.agent("t1", { status: "blocked" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  assert.equal(drawer.since.get("t1"), null);
  assert.equal(drawer.stages.get("t1"), 0);
  assert.equal(cx.timers.length, 0);

  t.mock.timers.tick(30 * MIN);
  draw(drawer, cx);
  assert.equal(drawer.stages.get("t1"), 0, "a start never seen is not guessed");
});

test("a change starts the clock, the drawer wakes when each stage is due, and the stage climbs", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  const t1 = mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  t1.status = "blocked";
  draw(drawer, cx);
  settle(cx);
  assert.equal(drawer.since.get("t1"), 1_000_000);
  assert.equal(drawer.stages.get("t1"), 0);
  assert.deepEqual(cx.timers.map((timer) => timer.ms), [1 * MIN]);

  t.mock.timers.tick(20_000);
  draw(drawer, cx);
  draw(drawer, cx);
  assert.equal(cx.timers.length, 1, "a redraw before the stage is due adds no timer");

  t.mock.timers.tick(40_000);
  const notified = cx.notified;
  cx.run(1 * MIN);
  assert.equal(cx.notified, notified + 1, "the timer wakes the drawer");
  draw(drawer, cx);
  assert.equal(drawer.stages.get("t1"), 1);
  assert.deepEqual(cx.timers.map((timer) => timer.ms), [4 * MIN], "the next stage, counted from the start");

  t.mock.timers.tick(4 * MIN);
  cx.run(4 * MIN);
  draw(drawer, cx);
  assert.equal(drawer.stages.get("t1"), 2);
  assert.equal(cx.timers.length, 0, "the last stage has no next one");
  assert.equal(drawer.since.get("t1"), 1_000_000, "the clock runs from the change, not from each draw");
});

test("a new change restarts the clock, and a stale timer does nothing", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const t1 = mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "blocked";
  draw(drawer, cx);
  settle(cx);

  t.mock.timers.tick(30_000);
  t1.status = "idle";
  draw(drawer, cx);
  assert.equal(drawer.since.get("t1"), 30_000);
  assert.equal(drawer.stages.get("t1"), 0);

  // The timer for blocked's first stage is still pending, and sooner than idle's: it stays.
  assert.deepEqual(cx.timers.map((timer) => timer.ms), [1 * MIN]);
  t.mock.timers.tick(30_000);
  cx.run(1 * MIN);
  draw(drawer, cx);
  assert.equal(drawer.stages.get("t1"), 0, "idle's first stage is 10 min from its start");
  assert.deepEqual(cx.timers.map((timer) => timer.ms), [9.5 * MIN]);

  // A timer replaced by a sooner one does nothing when it fires.
  t1.status = "blocked";
  draw(drawer, cx);
  settle(cx);
  assert.deepEqual(cx.timers.map((timer) => timer.ms), [9.5 * MIN, 1 * MIN]);
  const notified = cx.notified;
  cx.run(9.5 * MIN);
  assert.equal(cx.notified, notified + 1, "only the timer still wanted wakes the drawer");
});

test("a status that flips and flips back between two draws keeps its clock", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const t1 = mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "blocked";
  draw(drawer, cx);
  t.mock.timers.tick(2 * MIN);
  t1.status = "working";
  t1.status = "blocked";
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, []);
  assert.equal(drawer.since.get("t1"), 0);
  assert.equal(drawer.stages.get("t1"), 1);
});

test("an agent with a tab to itself takes its start from the tab, and keeps it when the drawer reopens", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10 * MIN });
  mock.agent("t1", { status: "blocked", tab: "tb1" });
  mock.agent("t2", { status: "working", tab: "tb2" });
  mock.state.spaces = [space(tab("tb1", { changed_at: 3 * MIN }), tab("tb2", { changed_at: 9 * MIN, working_since: 1 * MIN }))];
  let drawer = new Drawer();
  draw(drawer, context());
  assert.equal(drawer.since.get("t1"), 3 * MIN, "a status other than working began when the tab last changed state");
  assert.equal(drawer.since.get("t2"), 1 * MIN, "working began when the tab started working");
  assert.equal(drawer.stages.get("t1"), 2, "blocked for 7 min");

  drawer = new Drawer();
  draw(drawer, context());
  assert.equal(drawer.since.get("t1"), 3 * MIN);
  assert.equal(drawer.stages.get("t1"), 2);
});

test("agents sharing a tab, or with a tab that has no time, have no known start when first drawn", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10 * MIN });
  mock.agent("t1", { status: "blocked", tab: "tb1" });
  mock.agent("t2", { status: "idle", tab: "tb1" });
  mock.agent("t3", { status: "blocked", tab: "tb3" });
  mock.state.spaces = [space(tab("tb1", { changed_at: 3 * MIN, panes: 2 }), tab("tb3"))];
  const drawer = new Drawer();
  draw(drawer, context());
  assert.equal(drawer.since.get("t1"), null, "a shared tab's times are not one agent's");
  assert.equal(drawer.since.get("t2"), null);
  assert.equal(drawer.since.get("t3"), null, "nothing changed in the tab since the app started");
});

test("a new agent takes its start from its tab, else has none; an empty drawer forgets every clock", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 10 * MIN });
  mock.agent("t1", { status: "working", tab: "tb1" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  mock.agent("t2", { status: "blocked", tab: "tb2" });
  mock.agent("t3", { status: "blocked", tab: "tb3" });
  mock.state.spaces = [space(tab("tb1"), tab("tb2", { changed_at: 8 * MIN }))];
  draw(drawer, cx);
  assert.equal(drawer.since.get("t2"), 8 * MIN);
  assert.equal(drawer.stages.get("t2"), 1);
  assert.equal(drawer.since.get("t3"), null, "a tab that is not in spaces() tells nothing");

  mock.state.agents = [];
  mock.state.terminals = [];
  draw(drawer, cx);
  assert.equal(drawer.since.size, 0);
  assert.equal(drawer.stages.size, 0);
});
