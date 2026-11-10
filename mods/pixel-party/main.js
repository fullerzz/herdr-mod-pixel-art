// Pixel Party: one generated pixel sprite per agent.
//   (no view)       the party drawer: a floating block, or any layout block
//   view: "picker"  the avatar picker popup for props().terminal

import { View, div } from "gpui-kit";
import { props, nextCommand } from "herdr";
import Drawer from "./drawer.js";
import Picker from "./picker.js";

const VIEWS = { drawer: Drawer, picker: Picker };

export default class PixelParty extends View {
  init(p, cx) {
    const pr = props() ?? p ?? {};
    const V = VIEWS[pr.view ?? "drawer"];
    this.view = V ? new V() : null;
    this.view?.init?.(pr, cx);
    // Keys bound to `pixel-party.<command>` reach every shown copy; only a view that
    // defines `command` answers, so an open picker doesn't act on the drawer's keys.
    if (this.view?.command) {
      cx.spawn(async (cx) => {
        for (;;) {
          this.view.command(await nextCommand(), cx);
          cx.notify();
        }
      });
    }
  }

  render(cx) {
    if (!this.view) return div().child(`pixel-party: no view "${props()?.view}"`);
    return this.view.render(cx);
  }
}
