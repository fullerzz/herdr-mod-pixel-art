// `node --import ./tests/mocks/register.mjs --test tests/`: lets the mod's files import
// "gpui-kit", "gpui-base" and "herdr" under node, as stand-ins that record what was built.

import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
