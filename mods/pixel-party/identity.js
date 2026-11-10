// Which sprite a terminal shows, and the one place that changes it.
//
// The choice is a label on the terminal in herdr-core, so every Herdr client sees it and it
// stays with the terminal when its agent restarts. Without the label, the terminal's own
// address is the seed: every agent still gets a stable sprite.

import { terminals, hc, openOverlay } from "herdr";

/** This mod's folder name: overlays it opens on itself name it. */
export const MOD = "pixel-party";

/** The label that holds a terminal's chosen seed. */
export const LABEL = "pixel.avatar";

const SEED = /^[a-z0-9][a-z0-9-]{0,31}$/;

const chosen = (address) => {
  const seed = terminals().find((t) => t.address === address)?.labels?.[LABEL];
  return SEED.test(seed ?? "") ? seed : null;
};

/** The seed to draw for a terminal: its label, else its address. */
export const seedFor = (address) => chosen(address) ?? address;

/** Whether the terminal has a chosen seed, rather than the address fallback. */
export const hasAvatar = (address) => chosen(address) !== null;

/** Saves a seed on the terminal. Rejects a seed a label can't hold. */
export function setAvatar(address, seed) {
  if (!SEED.test(seed)) return Promise.reject(new Error(`pixel-party: not a seed: ${seed}`));
  return hc(["label", address, `${LABEL}=${seed}`]);
}

/** Removes the chosen seed: the terminal goes back to its address's sprite. */
export const clearAvatar = (address) => hc(["label", address, `${LABEL}=`]);

/** Opens the picker for a terminal: a popup at the pointer for a click, a centered dialog for a key. */
export const openPicker = (address, kind = "popup") =>
  openOverlay({ mod: MOD, props: { view: "picker", terminal: address }, kind, width: 284, height: 348 });
