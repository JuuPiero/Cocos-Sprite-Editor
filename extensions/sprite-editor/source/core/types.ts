/**
 * Shared data types for the Sprite Editor.
 *
 * Coordinates of a rect are image pixels with the origin at the TOP-LEFT of the
 * texture (same as the .plist "frame" field). Pivot is normalized with the origin
 * at the BOTTOM-LEFT (same as Unity pivot and Cocos UITransform.anchorPoint).
 */

export interface SpriteRect {
    /** Editor-only identity, never written to disk. */
    id: number;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    pivotX: number;
    pivotY: number;
    borderL: number;
    borderT: number;
    borderR: number;
    borderB: number;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** RGBA pixels, row-major, 4 bytes per pixel (same layout as ImageData). */
export interface Pixels {
    width: number;
    height: number;
    data: Uint8ClampedArray | Uint8Array;
}

export type MaskMode = 'auto' | 'alpha' | 'color';

export interface MaskOptions {
    mode: MaskMode;
    /** Pixel counts as sprite when alpha >= threshold (alpha mode). */
    alphaThreshold: number;
    /** Max RGB distance to the background colour (color mode). */
    colorTolerance: number;
    /** Background colour for color mode; null = median of the 4 corners. */
    keyColor: [number, number, number] | null;
}

export interface AutoSliceOptions extends MaskOptions {
    /** Drop islands whose width or height is below this. */
    minSize: number;
    /** Merge boxes closer than this many pixels (0 = off). */
    mergeDistance: number;
    /** Break thin bridges between sprites by eroding N px before labelling. */
    separate: number;
    /** Grow every box by N px (clamped to the texture). */
    extrude: number;
}

export interface GridOptions {
    cellW: number;
    cellH: number;
    cols: number;
    rows: number;
    offsetX: number;
    offsetY: number;
    padX: number;
    padY: number;
}

export type SliceType = 'auto' | 'cell-size' | 'cell-count';
export type SliceMethod = 'delete' | 'smart' | 'safe';

export type PivotPreset =
    | 'center' | 'top-left' | 'top' | 'top-right'
    | 'left' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right'
    | 'custom';

export const PIVOT_PRESETS: Record<Exclude<PivotPreset, 'custom'>, [number, number]> = {
    'center': [0.5, 0.5],
    'top-left': [0, 1],
    'top': [0.5, 1],
    'top-right': [1, 1],
    'left': [0, 0.5],
    'right': [1, 0.5],
    'bottom-left': [0, 0],
    'bottom': [0.5, 0],
    'bottom-right': [1, 0],
};

export function pivotPresetOf(x: number, y: number): PivotPreset {
    for (const key of Object.keys(PIVOT_PRESETS) as Exclude<PivotPreset, 'custom'>[]) {
        const p = PIVOT_PRESETS[key];
        if (Math.abs(p[0] - x) < 1e-4 && Math.abs(p[1] - y) < 1e-4) return key;
    }
    return 'custom';
}

/** A frame as stored in a .plist (geometry only). */
export interface PlistFrame {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    rotated: boolean;
    /** True when the frame was trimmed by a packer (offset or source size differ). */
    trimmed: boolean;
}

export interface PlistSheet {
    textureFileName: string;
    width: number;
    height: number;
    format: number;
    /** True when this plist was written by this editor. */
    ownFile: boolean;
    frames: PlistFrame[];
}
