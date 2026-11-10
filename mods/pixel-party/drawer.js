// The party drawer: one sprite per agent, moving with what the agent does.
//
// Docked on a side edge as a `peek` drawer, only the 48 px sprite cell next to the edge
// shows until hover, so everything needed to read an agent's state lives in that cell:
// the sprite's motion and status mark, a status stripe on the edge side, and a tint when it
// is blocked.
// The layout depends only on placement().edge, never on hover or drag: Herdr slides the
// block, the content stays. Herdr draws the frame, so this draws content only.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, focused, run, theme, placement } from "herdr";
import { seedFor, openPicker, setAvatar, clearAvatar } from "./identity.js";
import { makeSprite, randomSeed } from "./sprites.js";
import { spriteElement } from "./sprite-view.js";

const PX = 3; // a 36 px sprite
const CELL = 48; // the sprite with 6 px either side: the dock script peeks exactly this
const CELL_H = 44;
const TEXT_W = 168; // text column beside the cell on a side edge
const TILE_W = 76; // one agent on a top or bottom edge

const WORD = { working: "Working", blocked: "Needs you", done: "Finished", idle: "Idle" };

// A title often starts with the agent's own status glyph ("✳ Fix login").
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

const nameOf = (a) => clean(a.title) || a.tab_name || a.program?.name || a.address;

// The agent's own message, else what it is doing and where.
function lineOf(a, terminal) {
  const msg = clean(terminal?.report?.msg);
  if (msg) return msg;
  const word = WORD[a.status] ?? "Unknown";
  return a.space_name ? `${word} in ${a.space_name}` : word;
}

// What the cue says in a theme color. Blocked tints the whole row and its cell too.
const cueColor = (t, status) => (status === "idle" ? t.idle + "99" : t[status] ?? t.unknown);

// The agent keys act on, and the row marked as focused: the pane with the keyboard when it
// is an agent, else Herdr's current agent. `focused().agent` alone is not enough: with the
// keyboard in a shell pane it names an agent chosen earlier, or simply the first one, and
// with the keyboard in another agent's pane it can still name the earlier choice.
function currentAgent(list) {
  const f = focused();
  const known = (address) => Boolean(address) && list.some((a) => a.address === address);
  if (known(f?.terminal)) return f.terminal;
  return known(f?.agent) ? f.agent : null;
}

export default class Drawer {
  command(name) {
    const target = currentAgent(agents());
    if (!target) return;
    if (name === "pick") openPicker(target, "dialog");
    else if (name === "reroll") logFailure(name, setAvatar(target, randomSeed()));
    else if (name === "reset") logFailure(name, clearAvatar(target));
  }

  render(_cx) {
    const list = agents();
    if (!list.length) return div();
    const t = theme();
    const edge = placement()?.edge ?? null;
    const byAddress = new Map(terminals().map((x) => [x.address, x]));
    const shown = currentAgent(list);
    const items = list.map((a) => ({
      a,
      line: lineOf(a, byAddress.get(a.address)),
      on: a.address === shown,
    }));

    if (edge === "top" || edge === "bottom") {
      return h_flex().items_start().children(items.map((it) => tile(t, it)));
    }
    const right = edge === "right";
    const col = v_flex().gap(2).children(items.map((it) => row(t, it, right)));
    // Docked in a layout block it has a fixed size: let a long party scroll.
    return edge === null ? col.id("pp-drawer").size_full().overflow_y_scrollbar() : col;
  }
}

// A key command has nowhere to show a failure: say it in the log rather than drop it.
function logFailure(name, promise) {
  promise
    .then((r) => r?.code && console.log(`pixel-party: ${name} failed: ${r.stderr || r.code}`))
    .catch((e) => console.log(`pixel-party: ${name} failed: ${e?.message ?? e}`));
}

const go = (a) => run("pane.focus", { pane: a.pane });

// The sprite and its cue. `side` is where the stripe goes: "left", "right" or "bottom".
// The sprite draws its own "!" when blocked, so the cell adds only the tint.
function cell(t, a, side) {
  const blocked = a.status === "blocked";
  const color = cueColor(t, a.status);
  const stripe = side === "bottom"
    ? div().absolute().left(12).bottom(0).w(CELL - 24).h(3).rounded(2).bg(color)
    : div().absolute().top(6).bottom(6).w(3).rounded(2).bg(color).when(side === "left", (el) => el.left(0)).when(side === "right", (el) => el.right(0));
  return div()
    .relative()
    .w(CELL)
    .h(CELL_H)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .when(blocked, (el) => el.bg(t.blocked + "40"))
    .child(spriteElement(makeSprite(seedFor(a.address)), { id: `pp-spr-${a.address}`, px: PX, status: a.status }))
    .child(stripe);
}

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// What every agent's element does, whatever its shape: focus marked, click goes there,
// right click opens the picker. The id is the address, unique and stable per agent.
const shell = (t, { a, on }, el, id) =>
  el
    .id(id)
    .rounded(6)
    .cursor_pointer()
    .when(a.status === "blocked" && !on, (el) => el.bg(t.blocked + "1f"))
    .when(on, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .on_click(() => go(a))
    .on_mouse_down("right", () => openPicker(a.address));

// A side edge: the cell on the edge side, the name and status line beside it.
function row(t, it, right) {
  const { a, line } = it;
  const blocked = a.status === "blocked";
  const idle = a.status === "idle" && !it.on;
  const machine = machineOf(a.address);
  const name = h_flex()
    .gap(5)
    .items_center()
    .when(right, (el) => el.justify_end())
    .child(div().min_w(0).truncate().text_size(12.5).font_medium().text_color(idle ? t.muted : t.foreground).child(nameOf(a)))
    .when(Boolean(machine), (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(machine)));
  const status = div()
    .truncate()
    .text_size(11)
    .when(right, (el) => el.text_right())
    .text_color(blocked ? t.blocked : t.dim)
    .when(blocked, (el) => el.font_semibold())
    .child(line);
  const text = v_flex().w(TEXT_W).min_w(0).gap(1).when(right, (el) => el.pl(10)).when(!right, (el) => el.pr(10)).child(name).child(status);
  const parts = [cell(t, a, right ? "right" : "left"), text];
  return shell(t, it, h_flex(), `pp-row-${a.address}`).items_center().children(right ? parts.reverse() : parts);
}

// A top or bottom edge: the sprite standing over its name, the status line under that.
function tile(t, it) {
  const { a, line } = it;
  const blocked = a.status === "blocked";
  return shell(t, it, v_flex(), `pp-tile-${a.address}`)
    .w(TILE_W)
    .pb(4)
    .items_center()
    .tooltip(`${nameOf(a)}: ${line}`)
    .child(cell(t, a, "bottom"))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(11).font_medium().text_color(t.foreground).child(nameOf(a)))
    .child(div().w(TILE_W - 8).truncate().text_center().text_size(10).text_color(blocked ? t.blocked : t.dim).when(blocked, (el) => el.font_semibold()).child(line));
}
