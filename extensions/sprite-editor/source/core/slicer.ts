/**
 * Pixel analysis used by the Slice tools. Pure functions, no DOM / Editor access,
 * so they can be unit-tested in plain Node.
 */
import { AutoSliceOptions, Box, GridOptions, MaskOptions, Pixels } from './types';

/** Upper bound for generated grid cells, protects the editor from freezing. */
export const MAX_GRID_CELLS = 20000;

export function hasTransparency(px: Pixels): boolean {
    const d = px.data;
    for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 255) return true;
    }
    return false;
}

export function cornerColor(px: Pixels): [number, number, number] {
    const { width: w, height: h, data: d } = px;
    const idx = [0, w - 1, (h - 1) * w, (h - 1) * w + w - 1];
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
        const v = idx.map((i) => d[i * 4 + c]).sort((a, b) => a - b);
        out[c] = Math.round((v[1] + v[2]) / 2);
    }
    return out;
}

/** Foreground mask, 1 = sprite pixel. */
export function buildMask(px: Pixels, opts: MaskOptions): Uint8Array {
    const { width: w, height: h, data: d } = px;
    const n = w * h;
    const mask = new Uint8Array(n);
    const alphaT = Math.max(1, Math.round(opts.alphaThreshold));
    let mode = opts.mode;
    if (mode === 'auto') mode = hasTransparency(px) ? 'alpha' : 'color';

    if (mode === 'alpha') {
        for (let i = 0; i < n; i++) mask[i] = d[i * 4 + 3] >= alphaT ? 1 : 0;
        return mask;
    }

    // Colour mode: background = pixels close to the key colour that are connected
    // to the texture edge. Enclosed areas of the same colour stay part of the sprite.
    const key = opts.keyColor || cornerColor(px);
    const tol2 = opts.colorTolerance * opts.colorTolerance;
    const similar = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * 4;
        const dr = d[o] - key[0];
        const dg = d[o + 1] - key[1];
        const db = d[o + 2] - key[2];
        similar[i] = d[o + 3] < alphaT || dr * dr + dg * dg + db * db <= tol2 ? 1 : 0;
    }
    const background = floodFromEdges(similar, w, h);
    for (let i = 0; i < n; i++) mask[i] = background[i] ? 0 : 1;
    return mask;
}

function floodFromEdges(similar: Uint8Array, w: number, h: number): Uint8Array {
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    const push = (i: number) => {
        if (similar[i] && !seen[i]) {
            seen[i] = 1;
            stack[top++] = i;
        }
    };
    for (let x = 0; x < w; x++) {
        push(x);
        push((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
        push(y * w);
        push(y * w + w - 1);
    }
    while (top > 0) {
        const i = stack[--top];
        const x = i % w;
        if (x > 0) push(i - 1);
        if (x < w - 1) push(i + 1);
        if (i >= w) push(i - w);
        if (i < (h - 1) * w) push(i + w);
    }
    return seen;
}

/** Bounding boxes of 8-connected islands (run-length union-find). */
export function labelBoxes(mask: Uint8Array, w: number, h: number): Box[] {
    const parent: number[] = [];
    const find = (i: number): number => {
        while (parent[i] !== i) {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        return i;
    };
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    // runs: y, x0, x1 (exclusive), label
    const runs: number[] = [];
    let prevStart = 0;
    let prevEnd = 0;
    for (let y = 0; y < h; y++) {
        const rowStart = runs.length / 4;
        const off = y * w;
        let x = 0;
        while (x < w) {
            if (!mask[off + x]) {
                x++;
                continue;
            }
            const x0 = x;
            while (x < w && mask[off + x]) x++;
            const lab = parent.length;
            parent.push(lab);
            for (let k = prevStart; k < prevEnd; k++) {
                const px0 = runs[k * 4 + 1];
                if (px0 > x) break;
                if (runs[k * 4 + 2] >= x0) union(lab, runs[k * 4 + 3]);
            }
            runs.push(y, x0, x, lab);
        }
        prevStart = rowStart;
        prevEnd = runs.length / 4;
    }

    const boxes = new Map<number, [number, number, number, number]>();
    for (let k = 0; k < runs.length; k += 4) {
        const y = runs[k];
        const x0 = runs[k + 1];
        const x1 = runs[k + 2];
        const r = find(runs[k + 3]);
        const b = boxes.get(r);
        if (!b) {
            boxes.set(r, [x0, y, x1, y + 1]);
        } else {
            if (x0 < b[0]) b[0] = x0;
            if (x1 > b[2]) b[2] = x1;
            if (y + 1 > b[3]) b[3] = y + 1;
        }
    }
    const out: Box[] = [];
    boxes.forEach((b) => out.push({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }));
    return out;
}

/** Erode with a (2r+1)² square; pixels outside the image count as empty. */
export function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
    if (r <= 0) return mask;
    const tmp = new Uint8Array(w * h);
    const out = new Uint8Array(w * h);
    const win = 2 * r + 1;
    const line = new Int32Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
        const off = y * w;
        for (let x = 0; x < w; x++) line[x + 1] = line[x] + mask[off + x];
        for (let x = r; x < w - r; x++) {
            tmp[off + x] = line[x + r + 1] - line[x - r] === win ? 1 : 0;
        }
    }
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) line[y + 1] = line[y] + tmp[y * w + x];
        for (let y = r; y < h - r; y++) {
            out[y * w + x] = line[y + r + 1] - line[y - r] === win ? 1 : 0;
        }
    }
    return out;
}

export function clampBox(b: Box, w: number, h: number): Box | null {
    const x0 = Math.max(0, Math.min(w, b.x));
    const y0 = Math.max(0, Math.min(h, b.y));
    const x1 = Math.max(0, Math.min(w, b.x + b.w));
    const y1 = Math.max(0, Math.min(h, b.y + b.h));
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function growBox(b: Box, amount: number, w: number, h: number): Box {
    return clampBox({ x: b.x - amount, y: b.y - amount, w: b.w + amount * 2, h: b.h + amount * 2 }, w, h) || b;
}

/** Shrink a box to the mask pixels inside it; null when empty. */
export function trimBox(mask: Uint8Array, w: number, h: number, box: Box): Box | null {
    const b = clampBox(box, w, h);
    if (!b) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;
    for (let y = b.y; y < b.y + b.h; y++) {
        const off = y * w;
        for (let x = b.x; x < b.x + b.w; x++) {
            if (!mask[off + x]) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            maxY = y;
        }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function isBoxEmpty(mask: Uint8Array, w: number, h: number, box: Box): boolean {
    const b = clampBox(box, w, h);
    if (!b) return true;
    for (let y = b.y; y < b.y + b.h; y++) {
        const off = y * w;
        for (let x = b.x; x < b.x + b.w; x++) {
            if (mask[off + x]) return false;
        }
    }
    return true;
}

export function intersectArea(a: Box, b: Box): number {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

export function iou(a: Box, b: Box): number {
    const i = intersectArea(a, b);
    if (!i) return 0;
    return i / (a.w * a.h + b.w * b.h - i);
}

function near(a: Box, b: Box, dist: number): boolean {
    return a.x - dist < b.x + b.w && a.x + a.w + dist > b.x
        && a.y - dist < b.y + b.h && a.y + a.h + dist > b.y;
}

function unionBox(a: Box, b: Box): Box {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function mergeBoxes(boxes: Box[], distance: number): Box[] {
    if (distance <= 0 || boxes.length < 2) return boxes;
    let remaining = boxes.slice();
    let changed = true;
    while (changed) {
        changed = false;
        const out: Box[] = [];
        for (const b of remaining) {
            const i = out.findIndex((o) => near(b, o, distance));
            if (i >= 0) {
                out[i] = unionBox(out[i], b);
                changed = true;
            } else {
                out.push(b);
            }
        }
        remaining = out;
    }
    return remaining;
}

/**
 * Reading order: rows top-to-bottom, then left-to-right inside a row. A box joins
 * the current row when its vertical centre is above the row's lowest top edge + height.
 */
export function sortReadingOrder<T extends Box>(boxes: T[]): T[] {
    const sorted = boxes.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const out: T[] = [];
    let row: T[] = [];
    let rowBottom = -Infinity;
    const flush = () => {
        row.sort((a, b) => a.x - b.x);
        out.push(...row);
        row = [];
    };
    for (const b of sorted) {
        if (row.length && b.y + b.h / 2 >= rowBottom) flush();
        row.push(b);
        rowBottom = row.length === 1 ? b.y + b.h : Math.min(rowBottom, b.y + b.h);
    }
    flush();
    return out;
}

export function detectSprites(px: Pixels, opts: AutoSliceOptions): Box[] {
    const { width: w, height: h } = px;
    const mask = buildMask(px, opts);
    const r = Math.max(0, Math.round(opts.separate));
    let boxes = labelBoxes(r ? erode(mask, w, h, r) : mask, w, h);
    if (r) {
        // Grow each eroded island back by r and fit it to the real pixels again.
        boxes = boxes
            .map((b) => trimBox(mask, w, h, growBox(b, r, w, h)))
            .filter((b): b is Box => !!b);
    }
    boxes = mergeBoxes(boxes, Math.max(0, Math.round(opts.mergeDistance)));
    const minSize = Math.max(1, Math.round(opts.minSize));
    boxes = boxes.filter((b) => b.w >= minSize && b.h >= minSize);
    const extrude = Math.max(0, Math.round(opts.extrude));
    if (extrude) boxes = boxes.map((b) => growBox(b, extrude, w, h));
    return sortReadingOrder(boxes);
}

/** Grid By Cell Size (byCount = false) or Grid By Cell Count (byCount = true). */
export function gridBoxes(width: number, height: number, g: GridOptions, byCount: boolean): Box[] {
    const offX = Math.max(0, Math.round(g.offsetX));
    const offY = Math.max(0, Math.round(g.offsetY));
    const padX = Math.max(0, Math.round(g.padX));
    const padY = Math.max(0, Math.round(g.padY));
    let cw = Math.round(g.cellW);
    let ch = Math.round(g.cellH);
    let maxCols = Infinity;
    let maxRows = Infinity;
    if (byCount) {
        maxCols = Math.max(1, Math.round(g.cols));
        maxRows = Math.max(1, Math.round(g.rows));
        cw = Math.floor((width - offX - padX * (maxCols - 1)) / maxCols);
        ch = Math.floor((height - offY - padY * (maxRows - 1)) / maxRows);
    }
    if (cw < 1 || ch < 1) return [];
    const out: Box[] = [];
    for (let row = 0, y = offY; row < maxRows && y + ch <= height; row++, y += ch + padY) {
        for (let col = 0, x = offX; col < maxCols && x + cw <= width; col++, x += cw + padX) {
            out.push({ x, y, w: cw, h: ch });
            if (out.length >= MAX_GRID_CELLS) return out;
        }
    }
    return out;
}

/** Cell size a Grid By Cell Count slice would produce (for display). */
export function cellSizeForCount(width: number, height: number, g: GridOptions): { w: number; h: number } {
    const cols = Math.max(1, Math.round(g.cols));
    const rows = Math.max(1, Math.round(g.rows));
    return {
        w: Math.floor((width - Math.max(0, g.offsetX) - Math.max(0, g.padX) * (cols - 1)) / cols),
        h: Math.floor((height - Math.max(0, g.offsetY) - Math.max(0, g.padY) * (rows - 1)) / rows),
    };
}
