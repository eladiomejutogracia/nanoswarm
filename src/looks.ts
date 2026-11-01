export type LookStyle = 'light' | 'solid';

/**
 * How the swarm is painted. Every field applies to every shape.
 *
 * Color rule (one, for everything): each particle takes a color along
 * `colors` — from its formula's `c` if the formula sets one, otherwise
 * bottom (first color) → top (last color).
 */
export interface Look {
    /** 'light': glowing additive points. 'solid': opaque, lit beads with depth. */
    style: LookStyle;
    /** Three CSS hex colors, from c = 0 (or bottom) to c = 1 (or top). */
    colors: [string, string, string];
    background: string;
    /** Bloom strength, 0 = off. GPU only. */
    bloom: number;
    /** Base point size. Scaled automatically with the particle count. */
    size: number;
}

export const LOOK_DEFAULTS: Look = {
    style: 'light',
    colors: ['#00e5ff', '#7c4dff', '#ff4081'],
    background: '#03040a',
    bloom: 0,
    size: 3,
};

/** Anything you leave out comes from LOOK_DEFAULTS. */
export function resolveLook(look: Partial<Look> = {}): Look {
    return { ...LOOK_DEFAULTS, ...look };
}
