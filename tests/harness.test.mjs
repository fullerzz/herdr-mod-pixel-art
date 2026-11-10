// The stand-ins must refuse what the app refuses, or a passing test proves nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { div } from "gpui-kit";
import * as herdr from "herdr";
import { check, find, text, walk } from "./mocks/gpui.mjs";

const api = JSON.parse(readFileSync(new URL("./mocks/api.json", import.meta.url), "utf8"));

test("the herdr stand-in has every function the installed herdr.d.ts declares", () => {
  assert.deepEqual(api.herdr.filter((name) => typeof herdr[name] !== "function"), []);
});

test("a color that is not a hex literal is refused, as the app refuses it", () => {
  assert.throws(() => div().bg("hsl(2, 70%, 60%)"), /not a #rgb, #rrggbb or #rrggbbaa color/);
  assert.throws(() => div().text_color("red"), /color/);
  div().bg("#abc").text_color("#aabbcc").border_color("#aabbccdd");
});

test("a method the type files don't declare is refused", () => {
  assert.throws(() => div().backgroundColor("#000000"), /not a gpui-kit element method/);
});

test("on_click needs an id first, and ids are unique in a render", () => {
  assert.throws(() => div().on_click(() => {}), /needs \.id/);
  const twice = div().child(div().id("a")).child(div().id("a"));
  assert.throws(() => check(twice), /used twice/);
});

test("loop takes a motion property and a period of at least 100 ms", () => {
  assert.throws(() => div().loop("scale", { from: 0, to: 1 }), /not one of/);
  assert.throws(() => div().loop("top", { from: 0, to: 1, period: 50 }), /at least 100/);
  div().loop("top", { from: 0, to: -3, period: 600 });
});

test("a missing child is refused", () => {
  assert.throws(() => div().child(undefined), /not an element or text/);
  assert.throws(() => div().children([div(), null]), /not an element or text/);
});

test("the readers take a node that find returned, as well as an element", () => {
  const tree = div().child(div().id("row").child("hello").child(div().child("there")));
  const row = find(tree, "row");
  assert.equal(text(row), "hello there");
  assert.equal(walk(row).length, 2);
});
