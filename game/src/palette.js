// The look plan for FOUNDRY: dusk over a derelict smelter. One hue family (warm sand to
// rust) against a cold violet shadow, with two accents that only ever mark something the
// player must read at a glance: sodium amber for danger, forge teal for the objective.
// The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191a20',       // dusk sky and clear colour
  fog: '#20222b',          // distance haze
  sand: '#b0a08a',         // lit concrete, the base surface
  sandDark: '#7d7264',     // concrete in shadow
  rust: '#8b4a33',         // corrugated steel, containers
  steel: '#3c424a',        // structural metal, catwalks
  ink: '#e8e2d6',          // text and the lightest trim
  muted: '#9a958d',        // secondary text
  amber: '#f2a33c',        // sodium lamps, muzzle flash, damage
  teal: '#38c9ad',         // objective markers, defuse, friendly UI
  blood: '#b23b2c',        // hit confirmation, enemy tracers
};

export function shade(name) {
  return PALETTE[name];
}