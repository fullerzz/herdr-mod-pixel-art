// A stand-in for gpui-kit's element builders. It draws nothing: it records the tree a
// render describes and refuses what the app refuses, so a mistake fails in `node --test`
// instead of as an error card in the person's window.
//
// What it enforces, each learned from the app:
// - a builder method must exist in the installed type files (api.json);
// - a color is a #rgb, #rrggbb or #rrggbbaa literal: `hsl(...)` and names fail to render;
// - `loop`, `frames`, `spin` and `transition` take the properties and minimums the types give;
// - `on_click` and `tooltip` need an `.id(...)` first;
// - ids are unique in one render (`check`).

import { readFileSync } from "node:fs";

const api = JSON.parse(readFileSync(new URL("./api.json", import.meta.url), "utf8"));
const METHODS = new Set(api.methods);
const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLORED = new Set(["bg", "text_color", "border_color"]);
const MOTION = new Set(["opacity", "width", "height", "left", "top"]);
const NEEDS_ID = new Set(["on_click", "tooltip"]);

const NODE = Symbol("node");
const fail = (node, message) => {
  throw new TypeError(`${node.kind}()${node.id ? `#${node.id}` : ""}: ${message}`);
};

export class View {}

/** The recorded node behind an element: { kind, args, id, calls, children, handlers, style }. */
export const nodeOf = (el) => el?.[NODE] ?? null;

const isChild = (value) => nodeOf(value) !== null || ["string", "number", "boolean"].includes(typeof value);

function apply(node, proxy, name, args) {
  node.calls.push([name, args]);
  if (COLORED.has(name) && !COLOR.test(args[0])) fail(node, `.${name}(${JSON.stringify(args[0])}) is not a #rgb, #rrggbb or #rrggbbaa color`);
  if (NEEDS_ID.has(name) && node.id === null) fail(node, `.${name}() needs .id(...) before it`);
  switch (name) {
    case "id":
      if (typeof args[0] !== "string" || !args[0]) fail(node, ".id() takes a non-empty string");
      node.id = args[0];
      break;
    case "child":
      if (!isChild(args[0])) fail(node, `.child(${String(args[0])}) is not an element or text`);
      node.children.push(args[0]);
      break;
    case "children": {
      const list = [...args[0]];
      const bad = list.find((child) => !isChild(child));
      if (bad !== undefined || list.includes(undefined)) fail(node, `.children() holds ${String(bad)}, not an element or text`);
      node.children.push(...list);
      break;
    }
    case "when":
      if (args[0]) args[1](proxy);
      break;
    case "hover": {
      const style = element("style");
      args[0](style);
      node.style.hover = nodeOf(style);
      break;
    }
    case "loop": {
      const [property, policy] = args;
      if (!MOTION.has(property)) fail(node, `.loop("${property}") is not one of ${[...MOTION].join(", ")}`);
      if (typeof policy?.from !== "number" || typeof policy?.to !== "number") fail(node, ".loop() needs numeric from and to");
      if (policy.period !== undefined && policy.period < 100) fail(node, ".loop() period is at least 100 ms");
      break;
    }
    case "transition":
    case "spring":
      if (!MOTION.has(args[0])) fail(node, `.${name}("${args[0]}") is not one of ${[...MOTION].join(", ")}`);
      break;
    case "frames":
      if (!Array.isArray(args[0]) || !args[0].every((frame) => typeof frame === "string")) fail(node, ".frames() takes strings");
      if (!(args[1] >= 16)) fail(node, ".frames() ms is at least 16");
      break;
    case "spin":
      if (!(args[0] >= 100)) fail(node, ".spin() ms is at least 100");
      break;
    case "on_mouse_down":
      node.handlers[`on_mouse_down:${args[0]}`] = args[1];
      break;
    default:
      if (name.startsWith("on_")) node.handlers[name] = args[0];
  }
}

/** An element builder: every method chains, as in gpui-kit. */
export function element(kind, args = []) {
  const node = { kind, args, id: null, calls: [], children: [], handlers: {}, style: {} };
  NODES.add(node);
  const proxy = new Proxy(node, {
    get(target, name) {
      if (name === NODE) return target;
      // Not thenable, not inspectable by name: only builder methods.
      if (typeof name !== "string" || name === "then") return undefined;
      if (!METHODS.has(name)) fail(target, `.${name}() is not a gpui-kit element method`);
      return (...callArgs) => {
        apply(target, proxy, name, callArgs);
        return proxy;
      };
    },
  });
  return proxy;
}

/** A component such as `Button` or `TextView`: callable, and every static makes an element. */
export const component = (name) =>
  new Proxy(function () {}, {
    apply: (_target, _this, args) => element(name, args),
    get: (_target, member) => (typeof member === "string" ? (...args) => element(`${name}.${member}`, args) : undefined),
  });

// ---- reading a rendered tree in tests ----

// The readers take an element or a node `find` returned, so `text(find(tree, id))` works.
const NODES = new WeakSet();
const read = (value) => nodeOf(value) ?? (NODES.has(value) ? value : null);

/** Every node under an element or node, itself first. */
export function walk(el, out = []) {
  const node = read(el);
  if (!node) return out;
  out.push(node);
  for (const child of node.children) walk(child, out);
  return out;
}

/** The node with this id, or null. */
export const find = (el, id) => walk(el).find((node) => node.id === id) ?? null;

/** All text under an element or node, in order, joined by spaces. */
export function text(el) {
  const node = read(el);
  if (!node) return typeof el === "string" || typeof el === "number" ? String(el) : "";
  return node.children.map(text).filter(Boolean).join(" ");
}

/** The arguments of each call to a method on a node. */
export const calls = (node, name) => node.calls.filter(([called]) => called === name).map(([, args]) => args);

/** Fails on what only shows once the whole tree exists: an id used twice. Returns the nodes. */
export function check(el) {
  const nodes = walk(el);
  const seen = new Set();
  for (const node of nodes) {
    if (node.id === null) continue;
    if (seen.has(node.id)) throw new TypeError(`id "${node.id}" is used twice in one render`);
    seen.add(node.id);
  }
  return nodes;
}

/** A callback context like the app's: counts `notify`, runs `spawn` at once. */
export function context() {
  const cx = {
    notified: 0,
    stopped: 0,
    notify: () => void cx.notified++,
    stop_propagation: () => void cx.stopped++,
    spawn: (task) => task(cx),
    timer: { every: () => null, after: () => null },
    focus_handle: () => ({ focus() {} }),
  };
  return cx;
}

/** Runs a handler (`on_click`, `on_mouse_down:right`, `on_hover`, ...) of the node with this id. */
export function fire(el, id, handler = "on_click", event = {}, cx = context()) {
  const node = find(el, id);
  if (!node) throw new Error(`no element with id "${id}"`);
  if (!node.handlers[handler]) throw new Error(`"${id}" has no ${handler} handler`);
  node.handlers[handler](event, cx);
  return cx;
}
