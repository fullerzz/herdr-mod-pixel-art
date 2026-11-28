// Turns: the one-shots the drawer plays when an agent's status changes. A blocked agent that
// goes on has its fire put out: water pours on it, it dies, and steam rises, then the
// creature goes back to work.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { FIRE, TURNS } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, walk } from "./mocks/gpui.mjs";

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const last = (node, name) => calls(node, name).at(-1)?.[0];
/** The douse on an agent's sprite: its number, or null for none. */
const douseOf = (tree, address) => {
  const water = walk(tree).find((n) => new RegExp(`^pp-spr-${address}-douse-\\d+-water$`).test(n.id ?? ""));
  return water ? Number(water.id.split("-").at(-2)) : null;
};
const part = (tree, address, n, name) => find(tree, `pp-spr-${address}-douse-${n}-${name}`);
/** The ms each step of the douse starts at, by step. */
const at = Object.fromEntries(TURNS.douse.steps.map(([ms, step]) => [step ?? "over", ms]));

beforeEach(() => mock.reset());

test("a blocked agent that goes on has its fire put out on that draw, step by step, then it works", () => {
  const t1 = mock.agent("t1", { status: "blocked" });
  mock.agent("t2", { status: "blocked" });
  const drawer = new Drawer();
  const cx = context();
  assert.equal(douseOf(draw(drawer, cx), "t1"), null, "a fire there when the drawer opens is no douse");

  t1.status = "working";
  let tree = draw(drawer, cx);
  const n = douseOf(tree, "t1");
  assert.ok(n, "the douse starts on the draw that sees the change");
  assert.equal(douseOf(tree, "t2"), null, "the agent still blocked keeps its fire");
  assert.equal(last(part(tree, "t1", n, "fire"), "opacity"), 1, "pour: the fire still burns");

  const notified = cx.notified;
  cx.run(at.splash);
  assert.ok(cx.notified > notified, "each step redraws");
  tree = draw(drawer, cx);
  assert.equal(last(part(tree, "t1", n, "fire"), "opacity"), 0, "splash: the fire goes out");
  assert.ok(last(part(tree, "t1", n, "water"), "top") > 0, "the water falls onto it");

  cx.run(at.steam);
  tree = draw(drawer, cx);
  assert.equal(last(part(tree, "t1", n, "steam"), "opacity"), 0, "steam: it rises and fades");
  assert.ok(last(part(tree, "t1", n, "steam"), "top") < 0);

  cx.run(at.over);
  tree = draw(drawer, cx);
  assert.equal(douseOf(tree, "t1"), null, "the douse is over");
  const nodes = walk(find(tree, "pp-spr-t1"));
  assert.ok(!nodes.some((node) => calls(node, "bg").some(([c]) => Object.values(FIRE).includes(c))), "the fire is out for good");
  assert.ok(nodes.some((node) => calls(node, "loop").length), "and the creature is back at work");
});

test("only blocked to working puts a fire out: no other change and no new agent plays a turn", () => {
  const pairs = [["idle", "working"], ["done", "working"], ["blocked", "done"], ["blocked", "idle"], ["working", "blocked"], ["working", "done"]];
  for (const [from, to] of pairs) {
    mock.reset();
    const t1 = mock.agent("t1", { status: from });
    const drawer = new Drawer();
    const cx = context();
    draw(drawer, cx);
    t1.status = to;
    assert.equal(douseOf(draw(drawer, cx), "t1"), null, `${from} to ${to}`);
    assert.equal(drawer.turnOf("t1"), null, `${from} to ${to}`);
  }

  mock.reset();
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.agent("t1", { status: "working" });
  assert.equal(douseOf(draw(drawer, cx), "t1"), null, "a new agent has no earlier fire");
});

test("a block again ends the douse at once, its steps do nothing, and the next douse starts over", () => {
  const t1 = mock.agent("t1", { status: "blocked" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "working";
  const first = douseOf(draw(drawer, cx), "t1");

  t1.status = "blocked";
  let tree = draw(drawer, cx);
  assert.equal(douseOf(tree, "t1"), null, "the fire is lit again, not still being put out");
  assert.ok(walk(find(tree, "pp-spr-t1")).some((node) => calls(node, "bg").some(([c]) => c === theme().blocked)), "and the badge is back");
  const notified = cx.notified;
  cx.run(at.over);
  assert.equal(cx.notified, notified, "the ended douse's steps wake nothing");

  t1.status = "working";
  tree = draw(drawer, cx);
  const second = douseOf(tree, "t1");
  assert.ok(second && second !== first, "a new douse, with new ids, from its first step");
  assert.equal(last(part(tree, "t1", second, "fire"), "opacity"), 1);
});

test("a douse keeps going through redraws, and under a hit on the same agent", () => {
  const t1 = mock.agent("t1", { status: "blocked" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "working";
  const n = douseOf(draw(drawer, cx), "t1");
  assert.equal(douseOf(draw(drawer, cx), "t1"), n, "a redraw with nothing new keeps it");
  drawer.hits.set("t1", { added: 3, removed: 0, n: 99, live: true });
  assert.equal(douseOf(draw(drawer, cx), "t1"), n, "a hit lands on the creature being doused");
});
