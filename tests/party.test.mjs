// The party: when the last agent turns done and every agent is, an "ALL DONE" banner drops
// over the first cell while the last one's cheer plays, then every creature jumps together,
// on the same step at every draw, and settles into its done pose as the banner fades. Once.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock, theme } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { TURNS } from "../mods/pixel-party/sprite-view.js";
import { calls, check, context, find, text, walk } from "./mocks/gpui.mjs";

const draw = (drawer, cx) => {
  const tree = drawer.render(cx);
  check(tree);
  return tree;
};
const last = (node, name) => calls(node, name).at(-1)?.[0];
const leave = (address) => {
  mock.state.agents = mock.state.agents.filter((a) => a.address !== address);
  mock.state.terminals = mock.state.terminals.filter((x) => x.address !== address);
};
/** The banner in a tree, or null. */
const bannerOf = (tree) => walk(tree).find((n) => /^pp-banner-\d+$/.test(n.id ?? "")) ?? null;
/** The party an agent's sprite plays: its number and the body's top, or null for none. */
const danceOf = (tree, address) => {
  const body = walk(tree).find((n) => new RegExp(`^pp-spr-${address}-party-\\d+-body$`).test(n.id ?? ""));
  return body ? { n: Number(body.id.split("-").at(-2)), top: last(body, "top") } : null;
};
const cheers = (tree, address) => walk(tree).some((n) => new RegExp(`^pp-spr-${address}-cheer-\\d+-bit-0$`).test(n.id ?? ""));
/** The party waits for the last agent's cheer; its jumps' steps start from there. */
const WAIT = TURNS.cheer.steps.at(-1)[0];
const at = Object.fromEntries(TURNS.party.steps.map(([ms, step]) => [step ?? "over", WAIT + ms]));

beforeEach(() => mock.reset());

/** Two agents at work, drawn once, the first then done: the second's finish is the moment. */
function finishing() {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  mock.state.agents[0].status = "done";
  draw(drawer, cx);
  cx.run(5000); // the first's cheer is long over, so its creature is out of step with the next
  draw(drawer, cx);
  return { drawer, cx };
}

test("the last agent to finish cheers while a banner drops over the first cell, then every creature jumps together", () => {
  const { drawer, cx } = finishing();
  assert.equal(bannerOf(draw(drawer, cx)), null, "no party while one is still working");

  mock.state.agents[1].status = "done";
  let tree = draw(drawer, cx);
  assert.ok(drawer.allDone);
  assert.ok(cheers(tree, "t2"), "the last one cheers first, as any finish does");
  assert.equal(danceOf(tree, "t1"), null, "the others keep their done pose meanwhile");
  const banner = bannerOf(tree);
  assert.ok(banner, "the banner starts on that draw");
  assert.equal(last(banner, "opacity"), 0, "rolled up, unseen");
  assert.ok(walk(find(tree, "pp-box-t1")).includes(banner), "over the first cell, so a closed drawer shows it");
  assert.ok(!walk(find(tree, "pp-box-t2")).includes(banner), "and only there");
  assert.equal(text(banner), "ALL DONE");
  assert.ok(walk(banner).every((n) => calls(n, "bg").every(([c]) => c !== theme().done && c !== theme().blocked)), "no status cue");

  cx.run(30);
  tree = draw(drawer, cx);
  assert.equal(last(bannerOf(tree), "opacity"), 1, "it drops in and hangs");
  assert.ok(last(bannerOf(tree), "top") >= 0, "inside the cell");
  assert.ok(cheers(tree, "t2"), "while the cheer plays on");

  // Then the party: both on the same step of one party, at every draw.
  const steps = [["crouch", WAIT], ["hop", at.hop], ["land", at.land], ["leap", at.leap], ["settle", at.settle]];
  let n = null;
  for (const [step, ms] of steps) {
    cx.run(ms);
    tree = draw(drawer, cx);
    const [one, two] = [danceOf(tree, "t1"), danceOf(tree, "t2")];
    assert.ok(one && two, `${step}: both creatures dance`);
    assert.deepEqual(one, two, `${step}: in step, one party`);
    n ??= one.n;
    assert.equal(one.n, n, `${step}: the same party all through`);
    assert.equal(one.top < 0, step === "hop" || step === "leap", `${step}: up only on a jump`);
    assert.ok(!cheers(tree, "t2"), "the cheer is over: the party does not fight it");
    assert.equal(last(bannerOf(tree), "opacity"), 1, `${step}: the banner hangs`);
  }

  cx.run(at.over);
  tree = draw(drawer, cx);
  assert.equal(danceOf(tree, "t1"), null, "the party is over");
  assert.equal(danceOf(tree, "t2"), null);
  assert.equal(last(bannerOf(tree), "opacity"), 0, "and the banner fades");
  for (const address of ["t1", "t2"]) {
    assert.ok(walk(find(tree, `pp-spr-${address}`)).some((node) => calls(node, "bg").some(([c]) => c === theme().done)), `${address} settles into its done pose`);
  }

  cx.run(at.over + 1000);
  tree = draw(drawer, cx);
  assert.equal(bannerOf(tree), null, "the banner is gone");
  const notified = cx.notified;
  cx.run(60_000);
  draw(drawer, cx);
  assert.equal(cx.notified, notified, "nothing more wakes it: it plays once");
});

test("a redraw keeps the same party, and a lone agent that finishes has one too", () => {
  const { drawer, cx } = finishing();
  mock.state.agents[1].status = "done";
  const first = bannerOf(draw(drawer, cx)).id;
  assert.equal(bannerOf(draw(drawer, cx)).id, first, "a redraw does not start it over");

  mock.reset();
  const t1 = mock.agent("t1", { status: "idle" });
  const lone = new Drawer();
  const lx = context();
  draw(lone, lx);
  t1.status = "done";
  assert.ok(bannerOf(draw(lone, lx)), "every agent is done: the one there is");
  assert.equal(lone.turnOf("t1"), null, "it is no turn of its own change");
  lx.run(at.hop);
  assert.ok(danceOf(draw(lone, lx), "t1").top < 0, "and it jumps");
});

test("no party for an all-done first draw, the last agent still working leaving, or an empty drawer", () => {
  mock.agent("t1", { status: "done" });
  mock.agent("t2", { status: "done" });
  let drawer = new Drawer();
  let cx = context();
  assert.equal(bannerOf(draw(drawer, cx)), null, "they were done before the drawer opened");
  cx.run(at.hop);
  assert.equal(danceOf(draw(drawer, cx), "t1"), null);

  mock.reset();
  mock.agent("t1", { status: "done" });
  mock.agent("t2", { status: "working" });
  drawer = new Drawer();
  cx = context();
  draw(drawer, cx);
  leave("t2");
  let tree = draw(drawer, cx);
  assert.equal(bannerOf(tree), null, "no agent turned done");
  cx.run(at.hop);
  tree = draw(drawer, cx);
  assert.equal(danceOf(tree, "t1"), null);

  // A party under way ends when every agent has gone: a done agent that comes next gets none.
  mock.reset();
  const t1 = mock.agent("t1", { status: "working" });
  drawer = new Drawer();
  cx = context();
  draw(drawer, cx);
  t1.status = "done";
  assert.ok(bannerOf(draw(drawer, cx)), "the party starts");
  leave("t1");
  draw(drawer, cx);
  cx.run(1500); // the exit plays out, and the drawer is empty
  draw(drawer, cx);
  mock.agent("t2", { status: "done" });
  tree = draw(drawer, cx);
  cx.run(at.hop);
  tree = draw(drawer, cx);
  assert.equal(bannerOf(tree), null, "an empty drawer ends the party");
  assert.equal(danceOf(tree, "t2"), null);
});

test("an agent going back to work ends the party at once for everyone, and its steps wake nothing", () => {
  const { drawer, cx } = finishing();
  mock.state.agents[1].status = "done";
  draw(drawer, cx);
  cx.run(at.hop);
  let tree = draw(drawer, cx);
  assert.ok(danceOf(tree, "t1"), "mid-party");

  mock.state.agents[0].status = "working";
  tree = draw(drawer, cx);
  assert.equal(bannerOf(tree), null, "not every agent is done any more: no banner");
  assert.equal(danceOf(tree, "t1"), null);
  assert.equal(danceOf(tree, "t2"), null, "and the one still done is back in its done pose");
  assert.equal(drawer.turnOf("t1").kind, "stretch", "the one at work wakes up as usual");
  const notified = cx.notified;
  cx.run(at.over + 1000);
  assert.equal(cx.notified, notified + TURNS.stretch.steps.length, "only the stretch's steps wake it");

  mock.state.agents[0].status = "done";
  tree = draw(drawer, cx);
  assert.ok(bannerOf(tree), "done again: a new party");
});
