// Departures: an agent that ends leaves the drawer by the arrival trick in reverse. Its row
// stays, as it was last drawn, while a wand taps the creature and smoke goes up, and the cell
// is empty when the smoke clears; then the row is gone.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { calls, check, context, find, nodeOf, text, walk } from "./mocks/gpui.mjs";

const last = (node, name) => calls(node, name).at(-1)?.[0];
const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const leave = (address) => {
  mock.state.agents = mock.state.agents.filter((a) => a.address !== address);
  mock.state.terminals = mock.state.terminals.filter((x) => x.address !== address);
};
const exitOf = (tree, address) => walk(tree).find((n) => /^pp-exit-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-exit-${address}-`)) ?? null;
const trickOf = (tree, address) => walk(tree).find((n) => /^pp-trick-[^-]+-\d+$/.test(n.id ?? "") && n.id.startsWith(`pp-trick-${address}-`)) ?? null;
const clouds = (node) => walk(node).filter((n) => /-cloud-\d+$/.test(n.id ?? ""));
const sprite = (tree, address) => find(tree, `pp-spr-${address}`);
const rows = (tree) => walk(tree).filter((n) => /^pp-(row|tile)-/.test(n.id ?? "")).map((n) => n.id.replace(/^pp-(row|tile)-/, ""));
const colors = (node) => walk(node).flatMap((n) => calls(n, "bg").map(([c]) => c));

/** The px a node's left and top add up to, from the root of `tree`, or null outside it. */
function placeOf(tree, target) {
  const visit = (node, x, y) => {
    const nx = x + (last(node, "left") ?? 0);
    const ny = y + (last(node, "top") ?? 0);
    if (node === target) return [nx, ny];
    for (const child of node.children) {
      const found = typeof child === "object" && visit(walk(child)[0], nx, ny);
      if (found) return found;
    }
    return null;
  };
  return visit(walk(tree)[0], 0, 0);
}

beforeEach(() => mock.reset());

test("an agent that ends leaves by the trick in reverse, and its row is gone when the smoke clears", () => {
  mock.agent("t1");
  mock.agent("t2", { status: "done" });
  const drawer = new Drawer();
  const cx = context();
  let tree = draw(drawer, cx);
  assert.equal(exitOf(tree, "t2"), null, "no exit while it is there");

  leave("t2");
  tree = draw(drawer, cx);
  assert.deepEqual(rows(tree), ["t1", "t2"], "its row stays for the trick");
  assert.ok(exitOf(tree, "t2"), "it leaves by a trick");
  assert.equal(exitOf(tree, "t1"), null, "the agent still there gets none");
  assert.ok(text(tree).includes("Poof!"), "its status line says the word");
  const wandAt = (tree) => find(tree, `${exitOf(tree, "t2").id}-wand`);
  assert.equal(last(wandAt(tree), "opacity"), 1, "wand: the wand shows");
  assert.equal(clouds(exitOf(tree, "t2")).length, 0, "no smoke yet");
  assert.equal(last(sprite(tree, "t2"), "opacity"), 1, "wand: the creature is still there");
  const raised = [last(wandAt(tree), "left"), last(wandAt(tree), "top")];

  cx.run(240);
  tree = draw(drawer, cx);
  const tapped = [last(wandAt(tree), "left"), last(wandAt(tree), "top")];
  assert.ok(tapped[0] < raised[0] && tapped[1] > raised[1], "tap: the wand dips to the creature");
  assert.equal(last(sprite(tree, "t2"), "opacity"), 1, "tap: the creature is still there");

  cx.run(440);
  tree = draw(drawer, cx);
  assert.equal(last(wandAt(tree), "opacity"), 0, "poof: the wand fades");
  const gathered = clouds(exitOf(tree, "t2"));
  assert.ok(gathered.length >= 3 && gathered.every((n) => last(n, "opacity") === 1), "poof: the smoke is up");
  assert.equal(last(sprite(tree, "t2"), "opacity"), 0, "poof: the creature goes under the smoke");
  assert.ok(calls(sprite(tree, "t2"), "transition").some(([p]) => p === "opacity"), "it fades out, not at once");

  cx.run(760);
  tree = draw(drawer, cx);
  const cleared = clouds(exitOf(tree, "t2"));
  assert.ok(cleared.every((n) => last(n, "opacity") === 0), "clear: the smoke fades");
  assert.deepEqual(cleared.map((n) => n.id), gathered.map((n) => n.id), "the same clouds, so they drift rather than jump");
  assert.equal(last(sprite(tree, "t2"), "opacity"), 0, "clear: the cell is empty");
  // Everything the trick draws stays inside the 48 by 44 cell: Herdr clips the rest.
  for (const node of walk(exitOf(tree, "t2")).filter((n) => last(n, "bg"))) {
    const [x, y] = placeOf(find(tree, "pp-box-t2"), node);
    const [w, h] = [last(node, "w") ?? last(node, "size"), last(node, "h") ?? last(node, "size")];
    assert.ok(x >= 0 && y >= 0 && x + w <= 48 && y + h <= 44, `${node.id ?? "a pixel"} at ${x},${y} ${w}x${h} is outside the cell`);
  }

  cx.run(1300);
  tree = draw(drawer, cx);
  assert.deepEqual(rows(tree), ["t1"], "the row is gone");
  assert.ok(!text(tree).includes("Poof!"));
  tree = draw(drawer, cx);
  assert.deepEqual(rows(tree), ["t1"], "and stays gone");
});

test("a leaving agent keeps its place and its creature, on a side edge and on top", () => {
  for (const edge of ["right", "top"]) {
    mock.reset({ placement: { edge } });
    for (const address of ["t1", "t2", "t3"]) mock.agent(address);
    mock.state.terminals[1].labels = { "pixel.avatar": "knight7" };
    const drawer = new Drawer();
    const cx = context();
    let tree = draw(drawer, cx);
    const creature = colors(sprite(tree, "t2"));

    leave("t2");
    tree = draw(drawer, cx);
    assert.deepEqual(rows(tree), ["t1", "t2", "t3"], `${edge}: the trick plays where it stood`);
    assert.deepEqual(colors(sprite(tree, "t2")), creature, `${edge}: its creature, though its terminal and label are gone`);
  }
});

test("a leaving agent's row does nothing when clicked: its pane is gone", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  leave("t1");
  const row = find(draw(drawer, cx), "pp-row-t1");
  assert.deepEqual(Object.keys(row.handlers), []);
});

test("the last agent to leave plays its trick before the drawer empties", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  leave("t1");
  assert.ok(exitOf(draw(drawer, cx), "t1"), "the drawer stays open for the trick");
  cx.run(1300);
  const tree = draw(drawer, cx);
  assert.equal(nodeOf(tree).kind, "div");
  assert.equal(walk(tree).length, 1, "then it is empty");
});

test("an agent that comes back while leaving arrives again, in one row", () => {
  mock.agent("t1");
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  leave("t1");
  draw(drawer, cx);
  mock.agent("t1");
  let tree = draw(drawer, cx);
  assert.deepEqual(rows(tree), ["t1"]);
  assert.equal(exitOf(tree, "t1"), null, "its exit stops");
  assert.ok(trickOf(tree, "t1"), "it arrives by a trick");
  cx.run(1500);
  tree = draw(drawer, cx);
  assert.deepEqual(rows(tree), ["t1"], "the stopped exit takes no row away");
  assert.equal(trickOf(tree, "t1"), null);
});

test("an agent that leaves while arriving stops arriving and leaves", () => {
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.agent("t1");
  assert.ok(trickOf(draw(drawer, cx), "t1"));
  leave("t1");
  const tree = draw(drawer, cx);
  assert.equal(trickOf(tree, "t1"), null);
  assert.ok(exitOf(tree, "t1"));
  assert.ok(!text(tree).includes("Abracadabra!"));
});
