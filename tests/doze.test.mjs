// The window away and back: while the Herdr window is not active, the creatures doze, but a
// blocked one keeps burning. When the window comes back, they all glance up at once.

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock as clock, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { makeSprite } from "../mods/pixel-party/sprites.js";
import { TURNS, spriteElement } from "../mods/pixel-party/sprite-view.js";
import { check, context, find, nodeOf, walk } from "./mocks/gpui.mjs";

const STATUSES = ["working", "blocked", "done", "idle"];

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const away = () => void (mock.state.window = { active: false });
const back = () => void (mock.state.window = { active: true });

// A tree as plain data, handlers dropped: two renders compare equal when they look the same.
const SKIP = new Set(["child", "children", "when", "hover"]);
const shape = (node, inside = true) => ({
  kind: node.kind,
  id: node.id,
  calls: JSON.stringify(node.calls.filter(([name]) => !SKIP.has(name) && !name.startsWith("on_"))),
  children: !inside && node.id?.startsWith("pp-spr-") ? [] : node.children.map((c) => (nodeOf(c) ? shape(nodeOf(c), inside) : c)),
});
/** The drawer's sprite for an agent, and the one spriteElement draws in its place. */
const spriteIn = (tree, address) => shape(find(tree, `pp-spr-${address}`));
const spriteOf = (address, options) => shape(nodeOf(spriteElement(makeSprite(address), { id: `pp-spr-${address}`, px: 3, ...options })));
/** A tree's look with each sprite's insides left out: the stripes, tints and text around them. */
const layoutOf = (tree) => shape(nodeOf(tree), false);
/** The glance an agent's sprite plays: its number and step's top, or null for none. */
const glanceOf = (tree, address) => {
  const body = walk(tree).find((n) => new RegExp(`^pp-spr-${address}-glance-\\d+-body$`).test(n.id ?? ""));
  return body ? { n: Number(body.id.split("-").at(-2)), top: body.calls.filter(([name]) => name === "top").at(-1)?.[1][0] } : null;
};
const [UP, OVER] = [TURNS.glance.steps[0][0], TURNS.glance.steps.at(-1)[0]];

// Noon on the local clock: no prop for the time of day, so a sprite here is the plain one.
beforeEach(() => {
  mock.reset();
  clock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 5, 12).getTime() });
});
afterEach(() => clock.timers.reset());

/** One agent of each status, t0 to t3, drawn once with the window active. */
function four() {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status }));
  const drawer = new Drawer();
  const cx = context();
  const tree = draw(drawer, cx);
  return { drawer, cx, tree };
}

test("while the window is not active every creature dozes as an idle one does, but a blocked one keeps burning", () => {
  const { drawer, cx, tree: active } = four();
  away();
  const tree = draw(drawer, cx);
  STATUSES.forEach((status, i) => {
    const address = `t${i}`;
    const dozing = status === "blocked" ? { status } : { status: "idle" };
    assert.deepEqual(spriteIn(tree, address), spriteOf(address, dozing), `${status}: ${status === "blocked" ? "burns on" : "rests as idle"}`);
    if (status === "working" || status === "done") assert.notDeepEqual(spriteIn(tree, address), spriteIn(active, address), `${status}: it dozes off`);
    else assert.deepEqual(spriteIn(tree, address), spriteIn(active, address), `${status}: no change`);
  });
  assert.deepEqual(layoutOf(tree), layoutOf(active), "the stripes, tints and lines keep each agent's own status");
  assert.equal(glanceOf(tree, "t0"), null, "no glance while it is away");
});

test("a long work's tiredness is no dust while it dozes, and a long block burns as hot", () => {
  mock.agent("t1", { status: "idle" });
  mock.agent("t2", { status: "idle" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.state.agents[0].status = "working";
  mock.state.agents[1].status = "blocked";
  draw(drawer, cx); // their clocks start here
  cx.run(2000); // the stretch and the jolt are over
  clock.timers.tick(31 * 60_000); // half an hour on: coffee for the one at work, embers for the block
  away();
  const tree = draw(drawer, cx);
  assert.deepEqual([drawer.stages.get("t1"), drawer.stages.get("t2")], [2, 2]);
  assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", { status: "idle" }), "a nap's start: no cobweb or dust");
  assert.deepEqual(spriteIn(tree, "t2"), spriteOf("t2", { status: "blocked", stage: 2 }), "smoke and embers still");
});

test("when the window comes back every creature but a blocked one glances up at once, then goes on", () => {
  const { drawer, cx } = four();
  away();
  draw(drawer, cx);
  back();
  let tree = draw(drawer, cx);
  const glances = STATUSES.map((_, i) => glanceOf(tree, `t${i}`));
  const [working, blocked, done, idle] = glances;
  for (const g of [working, done, idle]) assert.ok(g && g.top < 0, "it glances up");
  assert.ok(working.n === done.n && done.n === idle.n, "all in one glance");
  assert.equal(blocked, null, "a blocked one never dozed, and a glance would hide its fire");
  assert.deepEqual(spriteIn(tree, "t1"), spriteOf("t1", { status: "blocked" }));

  cx.run(UP);
  tree = draw(drawer, cx);
  for (const address of ["t0", "t2", "t3"]) assert.deepEqual(glanceOf(tree, address), { n: working.n, top: 0 }, `${address}: its head goes down again`);

  cx.run(OVER);
  tree = draw(drawer, cx);
  STATUSES.forEach((status, i) => {
    assert.equal(glanceOf(tree, `t${i}`), null, "the glance is over");
    assert.deepEqual(spriteIn(tree, `t${i}`), spriteOf(`t${i}`, { status }), `${status}: back to its own look`);
  });
  const notified = cx.notified;
  cx.run(OVER + 1000);
  draw(drawer, cx);
  assert.equal(cx.notified, notified, "nothing more wakes it: it plays once");
});

test("no glance on the first draw or a redraw; going away mid-glance ends it, and its steps wake nothing", () => {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status }));
  let drawer = new Drawer();
  let cx = context();
  assert.equal(glanceOf(draw(drawer, cx), "t0"), null, "the first draw has no window before it");
  assert.equal(glanceOf(draw(drawer, cx), "t0"), null, "nor a redraw with it still active");

  away();
  drawer = new Drawer();
  cx = context();
  draw(drawer, cx);
  back();
  assert.ok(glanceOf(draw(drawer, cx), "t0"), "a drawer first drawn away glances up when the window comes back");
  away();
  const tree = draw(drawer, cx);
  assert.equal(glanceOf(tree, "t0"), null, "away again: no glance");
  assert.deepEqual(spriteIn(tree, "t0"), spriteOf("t0", { status: "idle" }), "it dozes at once");
  const notified = cx.notified;
  cx.run(OVER);
  assert.equal(cx.notified, notified, "the ended glance's steps wake nothing");
});

test("with no window at all, as `herdr-app check` draws, the creatures are awake", () => {
  mock.state.window = null;
  mock.agent("t1", { status: "working" });
  assert.deepEqual(spriteIn(draw(new Drawer(), context()), "t1"), spriteOf("t1", { status: "working" }));
});

test("an agent's own turn wins over the glance", () => {
  const { drawer, cx } = four();
  away();
  draw(drawer, cx);
  back();
  mock.state.agents[3].status = "working";
  const tree = draw(drawer, cx);
  assert.equal(drawer.turnOf("t3").kind, "stretch", "the idle one going to work stretches");
  assert.equal(glanceOf(tree, "t3"), null);
  assert.ok(glanceOf(tree, "t0"), "the others glance up");
});
