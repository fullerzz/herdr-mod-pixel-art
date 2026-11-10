// Which sprite a terminal shows, and the one place that changes it.
//
// The choice is a label on the terminal in herdr-core, so every Herdr client sees it and it
// stays with the terminal when its agent restarts. Without the label, the terminal's own
// address is the seed: every agent still gets a stable sprite.

import { terminals, hc, openOverlay } from "herdr";

/** @import { ExecResult, OverlaySpec } from "herdr" */

/** This mod's folder name: overlays it opens on itself name it. */
export const MOD = "pixel-party";

/** The label that holds a terminal's chosen seed. */
export const LABEL = "pixel.avatar";

const SEED = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * @param {string} address A terminal address, e.g. "t7" or "mini/t7".
 * @returns {string | null} The terminal's label seed, or null when it has none or it isn't a seed.
 */
const chosen = (address) => {
  const seed = terminals().find((t) => t.address === address)?.labels?.[LABEL];
  return SEED.test(seed ?? "") ? seed : null;
};

/**
 * The seed to draw for a terminal: its label, else its address.
 * @param {string} address
 * @returns {string}
 */
export const seedFor = (address) => chosen(address) ?? address;

/**
 * Whether the terminal has a chosen seed, rather than the address fallback.
 * @param {string} address
 * @returns {boolean}
 */
export const hasAvatar = (address) => chosen(address) !== null;

/**
 * Saves a seed on the terminal. Rejects a seed a label can't hold.
 * @param {string} address
 * @param {string} seed 1 to 32 characters from `a-z`, `0-9` and `-`, not starting with `-`.
 * @returns {Promise<ExecResult>} The `hc label` run: check `code`.
 */
export function setAvatar(address, seed) {
  if (!SEED.test(seed)) return Promise.reject(new Error(`pixel-party: not a seed: ${seed}`));
  return hc(["label", address, `${LABEL}=${seed}`]);
}

/**
 * Removes the chosen seed: the terminal goes back to its address's sprite.
 * @param {string} address
 * @returns {Promise<ExecResult>} The `hc label` run: check `code`.
 */
export const clearAvatar = (address) => hc(["label", address, `${LABEL}=`]);

/**
 * Opens the picker for a terminal: a popup at the pointer for a click, a centered dialog for a key.
 * @param {string} address
 * @param {OverlaySpec["kind"]} [kind]
 * @returns {string} The overlay's id.
 */
export const openPicker = (address, kind = "popup") =>
  openOverlay({ mod: MOD, props: { view: "picker", terminal: address }, kind, width: 284, height: 348 });
