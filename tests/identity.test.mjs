import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { mock } from "herdr";
import { LABEL, MOD, clearAvatar, hasAvatar, openPicker, seedFor, setAvatar } from "../mods/pixel-party/identity.js";

beforeEach(() => mock.reset());

test("a terminal without the label is drawn from its own address", () => {
  mock.agent("t7");
  assert.equal(seedFor("t7"), "t7");
  assert.equal(hasAvatar("t7"), false);
  // An agent on another machine, and one the core no longer lists.
  assert.equal(seedFor("vps/t3"), "vps/t3");
});

test("a chosen seed is saved as the terminal's label and read back", async () => {
  mock.agent("t7");
  await setAvatar("t7", "knight7");
  assert.deepEqual(mock.of("hc"), [[["label", "t7", `${LABEL}=knight7`]]]);
  assert.equal(seedFor("t7"), "knight7");
  assert.equal(hasAvatar("t7"), true);
});

test("clearing the choice goes back to the address", async () => {
  mock.agent("t7");
  await setAvatar("t7", "knight7");
  await clearAvatar("t7");
  assert.equal(seedFor("t7"), "t7");
  assert.equal(hasAvatar("t7"), false);
});

test("a seed a label can't hold is rejected before it reaches hc", async () => {
  mock.agent("t7");
  for (const seed of ["", "Has Space", "a=b", "x".repeat(33), "-lead"]) {
    await assert.rejects(setAvatar("t7", seed), /not a seed/);
  }
  assert.deepEqual(mock.of("hc"), []);
});

test("a label someone set by hand to something unusable falls back to the address", () => {
  mock.agent("t7");
  mock.state.terminals[0].labels[LABEL] = "Not A Seed";
  assert.equal(seedFor("t7"), "t7");
});

test("the picker opens on this mod, for that terminal", () => {
  openPicker("t7");
  openPicker("t7", "dialog");
  const [[popup], [dialog]] = mock.of("openOverlay");
  assert.equal(popup.mod, MOD);
  assert.deepEqual(popup.props, { view: "picker", terminal: "t7" });
  assert.equal(popup.kind, "popup");
  assert.equal(dialog.kind, "dialog");
});
