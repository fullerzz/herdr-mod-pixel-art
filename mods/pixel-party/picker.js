// The avatar picker: a popup or dialog for one agent's terminal (props().terminal).
// Herdr opens it 284 by 348 px and draws its frame; this draws the content only.
//
//   header   the current sprite, whose it is, and whether it is chosen or the default
//   grid     16 candidates, four per row; a click saves one and closes
//   footer   Shuffle (new candidates) and Reset (remove the label, then close)
//
// Every write goes through identity.js. A write that fails keeps the popup open and
// says so: closing would hide that nothing changed.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, closeOverlay, theme } from "herdr";
import { clearAvatar, hasAvatar, seedFor, setAvatar } from "./identity.js";
import { makeSprite, randomSeed } from "./sprites.js";
import { spriteElement } from "./sprite-view.js";

const COUNT = 16;
const PER_ROW = 4;
const PX = 3; // 12 cells * 3 = a 36 px sprite
const CELL = 48; // the hover cell: the sprite with 6 px on each side, as in the drawer

/** Distinct new seeds, none of them the one shown now. */
function freshSeeds(current) {
  const seeds = new Set();
  while (seeds.size < COUNT) {
    const seed = randomSeed();
    if (seed !== current) seeds.add(seed);
  }
  return [...seeds];
}

/** Runs one label write. Resolves with null when it saved, else a short reason. */
async function attempt(write) {
  try {
    const r = await write();
    if (r?.code === 0) return null;
    const why = r?.stderr?.trim();
    return `Not saved: hc exited ${r?.code ?? "?"}${why ? ` (${why})` : ""}`;
  } catch (err) {
    return `Not saved: ${err?.message ?? err}`;
  }
}

export default class Picker {
  init(props) {
    this.terminal = props?.terminal ?? null;
    this.overlay = props?.overlay;
    this.error = null;
    this.current = null; // { seed, sprite } of the sprite shown now
    if (this.terminal) this.shuffle();
  }

  /** New candidates. Sprites are made here, once per shuffle, not on every render. */
  shuffle() {
    this.candidates = freshSeeds(seedFor(this.terminal)).map((seed) => ({ seed, sprite: makeSprite(seed) }));
    this.error = null;
  }

  /** Runs a write; closes on success, shows the reason and stays open on failure. */
  save(write, cx) {
    cx.spawn(async (cx) => {
      this.error = await attempt(write);
      if (this.error === null) closeOverlay(this.overlay);
      else cx.notify();
    });
  }

  currentSprite() {
    const seed = seedFor(this.terminal);
    if (this.current?.seed !== seed) this.current = { seed, sprite: makeSprite(seed) };
    return this.current.sprite;
  }

  render(_cx) {
    const t = theme();
    const root = v_flex().id("pp-picker").size_full().min_h(0).p(12).gap(10).text_size(12).text_color(t.foreground);
    if (!this.terminal) return this.renderMissing(root, t);
    return root
      .child(this.renderHeader(t))
      .child(this.renderGrid(t))
      .when(this.error !== null, (el) =>
        el.child(div().id("pp-error").h(16).flex_none().truncate().text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(this.renderFooter(t));
  }

  renderMissing(root, t) {
    return root
      .child(div().text_size(13).font_semibold().child("No agent to pick for"))
      .child(div().flex_1().text_color(t.muted).child("This picker was opened without a terminal, so there is nothing to change."))
      .child(h_flex().justify_end().child(button("pp-close", "Close", t, (_e) => closeOverlay(this.overlay))));
  }

  renderHeader(t) {
    const name = agents().find((a) => a.address === this.terminal)?.title || this.terminal;
    const chosen = hasAvatar(this.terminal);
    return h_flex().id("pp-header").h(40).flex_none().gap(10).items_center()
      .child(h_flex().size(40).flex_none().items_center().justify_center().rounded(8).bg(t.raised)
        .child(spriteElement(this.currentSprite(), { id: "pp-current", px: PX })))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().id("pp-name").truncate().text_size(13).font_semibold().child(name))
        .child(div().id("pp-kind").truncate().text_size(11.5).text_color(chosen ? t.accent : t.muted)
          .child(chosen ? `Chosen sprite · ${seedFor(this.terminal)}` : `Default sprite for ${this.terminal}`)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child("Esc"));
  }

  renderGrid(t) {
    const cell = ({ seed, sprite }, i) =>
      h_flex().id(`pp-cand-${i}`).size(CELL).flex_none().items_center().justify_center().rounded(8)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.save(() => setAvatar(this.terminal, seed), cx))
        .child(spriteElement(sprite, { id: `pp-cand-${i}-sprite`, px: PX }));
    const rows = [];
    for (let at = 0; at < this.candidates.length; at += PER_ROW) {
      rows.push(h_flex().gap(12).justify_center().children(this.candidates.slice(at, at + PER_ROW).map((c, j) => cell(c, at + j))));
    }
    return v_flex().id("pp-grid").flex_1().min_h(0).gap(6).justify_center().children(rows);
  }

  renderFooter(t) {
    const canReset = hasAvatar(this.terminal);
    const shuffle = button("pp-shuffle", "Shuffle", t, (_e, cx) => {
      this.shuffle();
      cx.notify();
    });
    // Without a label there is nothing to clear: dimmed and with no click at all.
    const reset = canReset
      ? button("pp-reset", "Reset", t, (_e, cx) => this.save(() => clearAvatar(this.terminal), cx))
      : button("pp-reset", "Reset", t, null).opacity(0.4).cursor_default();
    return h_flex().id("pp-footer").h(28).flex_none().gap(8).items_center()
      .child(div().flex_1().truncate().text_size(11).text_color(t.dim).child("Click to choose"))
      .child(reset)
      .child(shuffle);
  }
}

function button(id, label, t, onClick) {
  const el = h_flex().id(id).h(28).px(12).flex_none().items_center().rounded(7).border_1().border_color(t.input)
    .bg(t.raised).text_color(t.foreground).text_size(12);
  if (!onClick) return el.child(label);
  return el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick).child(label);
}
