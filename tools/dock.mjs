#!/usr/bin/env node
// Adds the party drawer to a Herdr layout as a floating block, or removes it.
//
//   node tools/dock.mjs dock   [layout] [--node main] [--edge right] [--align center] [--peek off]
//   node tools/dock.mjs undock [layout]
//
// `layout` defaults to the one the running window shows. Shipped layouts are replaced on
// every start, so dock a personal one (`herdr-app do layout.clone`). The first dock keeps
// the untouched file beside it as `<layout>.json.pre-pixel-party`. On a side edge the block
// is a drawer: a strip of sprites shows until hover. `--peek off` keeps it open instead.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ID = "pixel-party";
// The strip left showing at the edge: one sprite cell of the drawer (docs/DESIGN.md).
const PEEK = 48;

const [action, ...rest] = process.argv.slice(2);
const flags = {};
const names = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[++i];
  else names.push(rest[i]);
}
if (!["dock", "undock"].includes(action) || names.length > 1) {
  console.error("usage: dock.mjs dock|undock [layout] [--node id] [--edge top|right|bottom|left] [--align start|center|end] [--peek off]");
  process.exit(2);
}

const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const shown = () => JSON.parse(execFileSync("herdr-app", ["status"], { encoding: "utf8" })).layout;
const name = names[0] ?? shown();
const file = join(home, "layouts", `${name}.json`);
const layout = JSON.parse(readFileSync(file, "utf8"));

const find = (node, id) => {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
};

// One drawer per layout: a dock elsewhere moves it.
const strip = (node) => {
  let removed = 0;
  if (node.floating) {
    const kept = node.floating.filter((f) => f.id !== ID);
    removed += node.floating.length - kept.length;
    if (kept.length) node.floating = kept;
    else delete node.floating;
  }
  for (const child of node.children ?? []) removed += strip(child);
  return removed;
};

const removed = strip(layout);
if (action === "dock") {
  const host = flags.node ? find(layout, flags.node) : (find(layout, "main") ?? layout);
  if (!host) {
    console.error(`no node "${flags.node}" in layout ${name}`);
    process.exit(1);
  }
  const edge = flags.edge ?? "right";
  const block = { id: ID, content: { mod: ID }, edge, align: flags.align ?? "center" };
  // Only side edges can be drawers.
  if ((edge === "left" || edge === "right") && flags.peek !== "off") block.peek = PEEK;
  (host.floating ??= []).push(block);
  const backup = `${file}.pre-pixel-party`;
  if (!existsSync(backup)) copyFileSync(file, backup);
  console.log(`docked on "${host.id}" (${edge}) in ${file}`);
} else if (!removed) {
  console.log(`no drawer in ${file}`);
  process.exit(0);
} else {
  console.log(`undocked from ${file}`);
}

// The app reloads the layout when the file changes: never let it read half of one.
const next = `${file}.tmp-pixel-party`;
writeFileSync(next, `${JSON.stringify(layout, null, 2)}\n`);
renameSync(next, file);
