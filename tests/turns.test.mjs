// Turns: the one-shots the drawer plays when an agent's status changes. A blocked agent that
// goes on has its fire put out: water pours on it, it dies, and steam rises, then the
// creature goes back to work. An agent that finishes cheers once: confetti bursts out and
// falls, then the creature settles into the done pose.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { CONFETTI, FIRE, TURNS } from "../mods/pixel-party/sprite-view.js";
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
  const pairs = [["idle", "working"], ["done", "working"], ["blocked", "done"], ["blocked", "idle"], ["working", "blocked"]];
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
  drawer.hits.set("t1", { added: 3, removed: 0, n: 99, live: true, size: "tick" });
  assert.equal(douseOf(draw(drawer, cx), "t1"), n, "a hit lands on the creature being doused");
});

/** The cheer on an agent's sprite: its number, or null for none. */
const cheerOf = (tree, address) => {
  const bit = walk(tree).find((n) => new RegExp(`^pp-spr-${address}-cheer-\\d+-bit-0$`).test(n.id ?? ""));
  return bit ? Number(bit.id.split("-").at(-3)) : null;
};
/** The ms each step of the cheer starts at, by step. */
const cheerAt = Object.fromEntries(TURNS.cheer.steps.map(([ms, step]) => [step ?? "over", ms]));
const colored = (node, colors) => walk(node).some((n) => calls(n, "bg").some(([c]) => colors.includes(c)));

test("an agent that finishes cheers once, on that draw: confetti bursts and falls, then it is done", () => {
  const t1 = mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  t1.status = "done";
  let tree = draw(drawer, cx);
  const n = cheerOf(tree, "t1");
  assert.ok(n, "the cheer starts on the draw that sees the change");
  assert.equal(drawer.turnOf("t1").kind, "cheer");
  assert.equal(cheerOf(tree, "t2"), null, "the agent still working does not cheer");
  const bit = (tree) => find(tree, `pp-spr-t1-cheer-${n}-bit-0`);
  assert.equal(last(bit(tree), "opacity"), 0, "pop: the confetti waits behind the creature");
  assert.equal(cheerOf(draw(drawer, cx), "t1"), n, "a redraw keeps the same cheer: it plays once");

  cx.run(cheerAt.burst);
  tree = draw(drawer, cx);
  assert.equal(last(bit(tree), "opacity"), 1, "burst: the confetti flies out");
  cx.run(cheerAt.fall);
  tree = draw(drawer, cx);
  assert.ok(last(bit(tree), "top") > 0, "fall: it drifts down");
  assert.equal(last(bit(tree), "opacity"), 0, "and fades");

  cx.run(cheerAt.over);
  tree = draw(drawer, cx);
  assert.equal(cheerOf(tree, "t1"), null, "the cheer is over");
  assert.equal(drawer.turnOf("t1"), null);
  const sprite = find(tree, "pp-spr-t1");
  assert.ok(!colored(sprite, Object.values(CONFETTI)), "the confetti is gone for good");
  assert.ok(colored(sprite, [theme().done]), "and the done pose's sparkles are there");
  const notified = cx.notified;
  cx.run(5000);
  tree = draw(drawer, cx);
  assert.equal(cx.notified, notified, "nothing more wakes it");
  assert.equal(cheerOf(tree, "t1"), null, "no second burst");
});

test("only working to done cheers: no other way to done, no first draw and no new agent", () => {
  for (const from of ["blocked", "idle"]) {
    mock.reset();
    const t1 = mock.agent("t1", { status: from });
    const drawer = new Drawer();
    const cx = context();
    draw(drawer, cx);
    t1.status = "done";
    assert.equal(cheerOf(draw(drawer, cx), "t1"), null, `${from} to done`);
    assert.equal(drawer.turnOf("t1"), null, `${from} to done`);
  }

  mock.reset();
  mock.agent("t1", { status: "done" });
  let drawer = new Drawer();
  let cx = context();
  assert.equal(cheerOf(draw(drawer, cx), "t1"), null, "done when the drawer opens is no cheer");

  mock.reset();
  drawer = new Drawer();
  cx = context();
  mock.agent("t0", { status: "working" });
  draw(drawer, cx);
  mock.agent("t1", { status: "done" });
  assert.equal(cheerOf(draw(drawer, cx), "t1"), null, "a new agent that is done has not just finished");
});

test("going back to work ends the cheer at once, its steps do nothing, and the next finish cheers again", () => {
  const t1 = mock.agent("t1", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "done";
  const first = cheerOf(draw(drawer, cx), "t1");

  t1.status = "working";
  let tree = draw(drawer, cx);
  assert.equal(cheerOf(tree, "t1"), null, "back at work, not still cheering");
  const notified = cx.notified;
  cx.run(cheerAt.over);
  assert.equal(cx.notified, notified, "the ended cheer's steps wake nothing");

  t1.status = "done";
  tree = draw(drawer, cx);
  const second = cheerOf(tree, "t1");
  assert.ok(second && second !== first, "a new cheer, with new ids, from its first step");
});
