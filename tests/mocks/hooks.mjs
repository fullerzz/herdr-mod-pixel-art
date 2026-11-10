// Module hooks: resolve Herdr's host modules to the stand-ins beside this file.

import { readFileSync } from "node:fs";

const api = JSON.parse(readFileSync(new URL("./api.json", import.meta.url), "utf8"));
const core = new URL("./gpui.mjs", import.meta.url).href;
const GPUI = { "gpui-kit": "kit", "gpui-base": "base" };

export async function resolve(specifier, context, next) {
  if (specifier === "herdr") return { url: new URL("./herdr.mjs", import.meta.url).href, shortCircuit: true };
  if (GPUI[specifier]) return { url: `mock:${GPUI[specifier]}`, shortCircuit: true };
  return next(specifier, context);
}

// The gpui modules export exactly the names the installed type files declare, so an
// import of anything else fails here as it would in the app.
export async function load(url, context, next) {
  if (!url.startsWith("mock:")) return next(url, context);
  const which = url.slice("mock:".length);
  const lines = [`import { element, component, View as BaseView } from ${JSON.stringify(core)};`];
  for (const name of api[which]) lines.push(`export const ${name} = (...args) => element(${JSON.stringify(name)}, args);`);
  for (const name of api[`${which}Classes`]) {
    lines.push(name === "View" ? "export const View = BaseView;" : `export const ${name} = component(${JSON.stringify(name)});`);
  }
  return { format: "module", source: lines.join("\n"), shortCircuit: true };
}
