#!/usr/bin/env node
// Records the names Herdr's installed type files declare, so the tests can refuse a
// call the app doesn't have without needing the app. Copies the type files themselves
// into types/, so `pnpm typecheck` checks the mod against them without the app, as in CI.
//
//   node tools/snapshot-api.mjs   # rewrites tests/mocks/api.json and types/*.d.ts
//
// Run it after a Herdr update. The type files are the app's own, rewritten on every start.
// Review THIRD_PARTY_NOTICES.md and upstream licenses when refreshing these copies.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.HERDR_APP_HOME ?? join(homedir(), ".config/herdr-app");
const kit = readFileSync(join(home, "gpui-kit.d.ts"), "utf8");
const herdr = readFileSync(join(home, "herdr.d.ts"), "utf8");

const unique = (list) => [...new Set(list)].sort();
const names = (source, pattern) => unique([...source.matchAll(pattern)].map((m) => m[1]));
// One `declare module "name" { ... }` block: up to the next top-level declaration.
const block = (name) => {
  const start = kit.indexOf(`declare module "${name}" {`);
  if (start < 0) throw new Error(`no module "${name}" in gpui-kit.d.ts`);
  const end = kit.indexOf("\ndeclare module ", start + 1);
  return kit.slice(start, end < 0 ? undefined : end);
};
const functions = /^\s*export function (\w+)/gm;
// `View`, and components such as `Button` and `TextView`.
const classes = /^\s*export (?:abstract class|class|const) (\w+)/gm;

const api = {
  // Chained builder methods on any element.
  methods: names(kit, /^\s+(\w+)<Self extends Element>\(/gm),
  kit: names(block("gpui-kit"), functions),
  kitClasses: names(block("gpui-kit"), classes),
  base: names(block("gpui-base"), functions),
  baseClasses: names(block("gpui-base"), classes),
  herdr: names(herdr, functions),
  app: execFileSync("herdr-app", ["--version"], { encoding: "utf8" }).trim(),
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests/mocks/api.json");
writeFileSync(out, `${JSON.stringify(api)}\n`);
console.log(`${out}: ${api.methods.length} methods, ${api.kit.length} gpui-kit, ${api.base.length} gpui-base, ${api.herdr.length} herdr functions`);

// Verbatim: tsconfig.json maps the "herdr" import to herdr.d.ts.
const types = join(root, "types");
mkdirSync(types, { recursive: true });
writeFileSync(join(types, "gpui-kit.d.ts"), kit);
writeFileSync(join(types, "herdr.d.ts"), herdr);
console.log(`${types}: gpui-kit.d.ts, herdr.d.ts from ${api.app}`);
