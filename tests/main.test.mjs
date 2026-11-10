// The mod as Herdr loads it: main.js picks the view from props and renders it for every
// agent status and every edge, with no call the app would refuse.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import PixelParty from "../mods/pixel-party/main.js";
import { check, context, text } from "./mocks/gpui.mjs";

const STATUSES = ["working", "blocked", "done", "idle"];
const EDGES = ["top", "right", "bottom", "left"];

function open(props = {}) {
  mock.state.props = props;
  const view = new PixelParty();
  view.init(props, context());
  return view;
}

beforeEach(() => mock.reset());

test("with no view it is the drawer, and renders one row per agent in every status", () => {
  STATUSES.forEach((status, i) => mock.agent(`t${i}`, { status, title: `job ${status}` }));
  const tree = open().render(context());
  check(tree);
  for (const status of STATUSES) assert.match(text(tree), new RegExp(`job ${status}`));
});

test("the drawer renders floating on every edge, and docked in a layout block", () => {
  mock.agent("t1", { status: "working" });
  mock.agent("vps/t2", { status: "blocked" });
  for (const edge of EDGES) {
    for (const hovered of [false, true]) {
      mock.state.placement = { edge, align: "center", vertical: edge === "left" || edge === "right", hovered, dragging: false };
      check(open().render(context()));
    }
  }
  mock.state.placement = null;
  check(open().render(context()));
});

test("the drawer renders with no agents", () => {
  check(open().render(context()));
});

test("view: picker is the picker for props().terminal", () => {
  mock.agent("t1");
  const tree = open({ view: "picker", terminal: "t1", overlay: "ov9" }).render(context());
  check(tree);
});

test("an unknown view says so instead of throwing", () => {
  assert.match(text(open({ view: "nope" }).render(context())), /no view "nope"/);
});

test("key commands reach the drawer: pick opens the picker for the focused agent", async () => {
  mock.agent("t1", { focused: true });
  mock.state.focused = { space: "sp1", tab: "tb1", pane: "p-t1", terminal: "t1", shown: null, agent: "t1", cwd: null };
  open();
  mock.send("pick");
  await new Promise((resolve) => setImmediate(resolve));
  const [[spec]] = mock.of("openOverlay");
  assert.deepEqual(spec.props, { view: "picker", terminal: "t1" });
  assert.equal(spec.kind, "dialog");
});
