// Status changes: each draw finds the agents whose status is not the one they were last
// drawn with, from and to, and the moment every agent is done. Groundwork for one-shots.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import Drawer from "../mods/pixel-party/drawer.js";
import { check, context } from "./mocks/gpui.mjs";

const draw = (drawer, cx) => check(drawer.render(cx));
const leave = (address) => {
  mock.state.agents = mock.state.agents.filter((a) => a.address !== address);
  mock.state.terminals = mock.state.terminals.filter((x) => x.address !== address);
};

beforeEach(() => mock.reset());

test("the first draw finds no changes, and an all-done first draw is not the moment", () => {
  mock.agent("t1", { status: "working" });
  mock.agent("t2", { status: "blocked" });
  let drawer = new Drawer();
  draw(drawer, context());
  assert.deepEqual(drawer.changes, []);
  assert.equal(drawer.allDone, false);

  mock.reset();
  mock.agent("t1", { status: "done" });
  mock.agent("t2", { status: "done" });
  drawer = new Drawer();
  draw(drawer, context());
  assert.deepEqual(drawer.changes, []);
  assert.equal(drawer.allDone, false, "they were done before the drawer opened");
});

test("a status change is found on the next draw, from and to, and only on that draw", () => {
  const t1 = mock.agent("t1", { status: "blocked" });
  mock.agent("t2", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  t1.status = "working";
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [{ address: "t1", from: "blocked", to: "working" }]);

  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [], "a redraw with nothing new finds nothing");
});

test("each change is from the status of the last draw", () => {
  const t1 = mock.agent("t1", { status: "idle" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);
  t1.status = "working";
  draw(drawer, cx);
  t1.status = "done";
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [{ address: "t1", from: "working", to: "done" }]);
});

test("a new agent and an agent that comes back have no change", () => {
  const drawer = new Drawer();
  const cx = context();
  mock.agent("t1", { status: "working" });
  draw(drawer, cx);

  mock.agent("t2", { status: "done" });
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [], "a new agent has no earlier status");

  leave("t1");
  draw(drawer, cx);
  mock.agent("t1", { status: "blocked" });
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [], "an agent that left is forgotten");

  leave("t1");
  leave("t2");
  draw(drawer, cx);
  mock.agent("t1", { status: "idle" });
  draw(drawer, cx);
  assert.deepEqual(drawer.changes, [], "an empty drawer forgets every agent");
});

test("the moment every agent is done comes on the draw the last one turns done, once", () => {
  const t1 = mock.agent("t1", { status: "working" });
  const t2 = mock.agent("t2", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  t1.status = "done";
  draw(drawer, cx);
  assert.equal(drawer.allDone, false, "one is still working");

  t2.status = "done";
  draw(drawer, cx);
  assert.equal(drawer.allDone, true);
  assert.deepEqual(drawer.changes, [{ address: "t2", from: "working", to: "done" }]);

  draw(drawer, cx);
  assert.equal(drawer.allDone, false, "a redraw is not the moment again");

  t1.status = "working";
  draw(drawer, cx);
  t1.status = "done";
  draw(drawer, cx);
  assert.equal(drawer.allDone, true, "done again after more work is the moment again");
});

test("the last agent still working leaving is not the moment, and no agents never is", () => {
  mock.agent("t1", { status: "done" });
  mock.agent("t2", { status: "working" });
  const drawer = new Drawer();
  const cx = context();
  draw(drawer, cx);

  leave("t2");
  draw(drawer, cx);
  assert.equal(drawer.allDone, false, "no agent turned done");

  leave("t1");
  draw(drawer, cx);
  assert.equal(drawer.allDone, false);
});
