/**
 * Canvas view of the texture, modelled on Unity's Sprite Editor:
 * - drag on empty space to create a sprite rect, click to select, drag to move
 * - corner / edge handles resize, the inner side of an edge drags the 9-slice border
 * - the blue disc is the pivot (Ctrl snaps to 0 / 0.5 / 1)
 * - wheel zooms, middle / right mouse, Alt+drag or Space+drag pans
 */
import { Box, SpriteRect } from '../../core/types';
import { Store } from './store';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Side = 'L' | 'R' | 'T' | 'B';

type Hit =
    | { kind: 'pivot'; rect: SpriteRect }
    | { kind: 'resize'; rect: SpriteRect; handle: Handle }
    | { kind: 'border'; rect: SpriteRect; side: Side }
    | { kind: 'rect'; rect: SpriteRect }
    | { kind: 'empty' };

type Drag =
    | { kind: 'pan'; sx: number; sy: number; panX: number; panY: number }
    | { kind: 'create'; ix: number; iy: number; cx: number; cy: number; sx: number; sy: number; moved: boolean }
    | { kind: 'move'; ix: number; iy: number; origin: { id: number; x: number; y: number }[]; bounds: Box }
    | { kind: 'resize'; rect: SpriteRect; handle: Handle; origin: Box }
    | { kind: 'pivot'; rect: SpriteRect }
    | { kind: 'border'; rect: SpriteRect; side: Side };

export const COLORS = {
    background: '#232323',
    checkerA: '#4a4a4a',
    checkerB: '#3d3d3d',
    textureEdge: 'rgba(0,0,0,0.6)',
    rect: 'rgba(255,255,255,0.62)',
    rectHover: 'rgba(255,255,255,0.95)',
    selected: '#4a9ff5',
    selectedFill: 'rgba(74,159,245,0.10)',
    handleEdge: '#0e2440',
    border: '#38d24a',
    pivotRing: '#ffffff',
    preview: 'rgba(255,196,64,0.75)',
    creating: '#ffffff',
    pixelGrid: 'rgba(0,0,0,0.22)',
    label: '#e8e8e8',
    labelBg: 'rgba(20,20,20,0.82)',
};

const HANDLE = 7;
const HIT = 6;
const MIN_ZOOM = 0.03;
const MAX_ZOOM = 64;

export class Viewport {
    zoom = 1;
    panX = 0;
    panY = 0;

    private ctx: CanvasRenderingContext2D;
    private raf = 0;
    private checker: CanvasPattern | null = null;
    private hover: Hit = { kind: 'empty' };
    private drag: Drag | null = null;
    private space = false;
    private cssW = 0;
    private cssH = 0;
    private resizeObserver: ResizeObserver;
    private disposers: (() => void)[] = [];
    private mouse: { x: number; y: number } | null = null;

    constructor(private canvas: HTMLCanvasElement, private store: Store) {
        this.ctx = canvas.getContext('2d')!;
        this.resizeObserver = new ResizeObserver(() => this.invalidate());
        this.resizeObserver.observe(canvas);

        const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
            el.addEventListener(type, fn as EventListener, opts);
            this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
        };
        on(canvas, 'mousedown', (e) => this.onDown(e));
        on(canvas, 'mousemove', (e) => {
            if (!this.drag) this.onHover(e);
        });
        on(canvas, 'mouseleave', () => {
            this.mouse = null;
            if (!this.drag && this.hover.kind !== 'empty') {
                this.hover = { kind: 'empty' };
                this.invalidate();
            }
        });
        on(canvas, 'wheel', (e) => this.onWheel(e), { passive: false });
        on(canvas, 'contextmenu', (e) => e.preventDefault());
        on(canvas, 'auxclick', (e) => e.preventDefault());

        this.disposers.push(store.onChange(() => this.invalidate()));
        this.disposers.push(store.onLoaded(() => this.fit()));
    }

    destroy() {
        cancelAnimationFrame(this.raf);
        this.resizeObserver.disconnect();
        this.endWindowDrag();
        this.disposers.forEach((fn) => fn());
        this.disposers = [];
    }

    // ------------------------------------------------------------------ view

    invalidate() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.render();
        });
    }

    private size() {
        const r = this.canvas.getBoundingClientRect();
        return { w: r.width, h: r.height };
    }

    fit() {
        const { width, height } = this.store.state;
        const { w, h } = this.size();
        if (!width || !height || !w || !h) {
            this.invalidate();
            return;
        }
        const pad = 40;
        const z = Math.min((w - pad) / width, (h - pad) / height);
        this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z > 1 ? Math.floor(z) : z));
        this.panX = Math.round((w - width * this.zoom) / 2);
        this.panY = Math.round((h - height * this.zoom) / 2);
        this.store.state.zoom = this.zoom;
        this.invalidate();
    }

    /** Zoom keeping the image point under (cx, cy) fixed; defaults to the view centre. */
    setZoom(z: number, cx?: number, cy?: number) {
        const { w, h } = this.size();
        const x = cx ?? w / 2;
        const y = cy ?? h / 2;
        const ix = (x - this.panX) / this.zoom;
        const iy = (y - this.panY) / this.zoom;
        this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
        this.panX = x - ix * this.zoom;
        this.panY = y - iy * this.zoom;
        this.store.state.zoom = this.zoom;
        this.invalidate();
    }

    frameSelection() {
        const sel = this.store.selectedRects.value;
        if (!sel.length) {
            this.fit();
            return;
        }
        const x0 = Math.min(...sel.map((r) => r.x));
        const y0 = Math.min(...sel.map((r) => r.y));
        const x1 = Math.max(...sel.map((r) => r.x + r.w));
        const y1 = Math.max(...sel.map((r) => r.y + r.h));
        const { w, h } = this.size();
        const z = Math.min((w - 80) / (x1 - x0), (h - 80) / (y1 - y0), MAX_ZOOM);
        this.zoom = Math.max(MIN_ZOOM, z);
        this.panX = w / 2 - ((x0 + x1) / 2) * this.zoom;
        this.panY = h / 2 - ((y0 + y1) / 2) * this.zoom;
        this.store.state.zoom = this.zoom;
        this.invalidate();
    }

    setSpace(down: boolean) {
        if (this.space === down) return;
        this.space = down;
        this.updateCursor();
    }

    private toImage(sx: number, sy: number) {
        return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
    }

    private eventPos(e: MouseEvent) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    // ----------------------------------------------------------------- input

    private onWheel(e: WheelEvent) {
        if (!this.store.state.texture) return;
        e.preventDefault();
        const p = this.eventPos(e);
        const step = e.ctrlKey ? 1.04 : 1.15;
        const factor = e.deltaY < 0 ? step : 1 / step;
        this.setZoom(this.zoom * factor, p.x, p.y);
    }

    private hitTest(ix: number, iy: number): Hit {
        const store = this.store;
        const tol = HIT / this.zoom;
        const one = store.single.value;
        const readOnly = !!store.state.readOnly;

        if (one && !readOnly) {
            const r = one;
            const px = r.x + r.pivotX * r.w;
            const py = r.y + (1 - r.pivotY) * r.h;
            if (Math.hypot(ix - px, iy - py) <= (HIT + 1) / this.zoom) return { kind: 'pivot', rect: r };

            for (const [handle, hx, hy] of this.handles(r)) {
                if (Math.abs(ix - hx) <= tol && Math.abs(iy - hy) <= tol) return { kind: 'resize', rect: r, handle };
            }

            const inX = ix >= r.x - tol && ix <= r.x + r.w + tol;
            const inY = iy >= r.y - tol && iy <= r.y + r.h + tol;
            // On tiny rects the inner band would cover everything; keep them movable.
            const bandX = r.w * this.zoom > HIT * 4;
            const bandY = r.h * this.zoom > HIT * 4;
            if (inY && iy > r.y && iy < r.y + r.h) {
                // Inner band (or an existing border line) -> border, outer band -> resize.
                const lx = r.x + r.borderL;
                const rx = r.x + r.w - r.borderR;
                if (r.borderL > 0 ? Math.abs(ix - lx) <= tol : bandX && ix >= r.x && ix - r.x <= tol) return { kind: 'border', rect: r, side: 'L' };
                if (r.borderR > 0 ? Math.abs(ix - rx) <= tol : bandX && ix <= r.x + r.w && r.x + r.w - ix <= tol) return { kind: 'border', rect: r, side: 'R' };
                if (ix < r.x && r.x - ix <= tol) return { kind: 'resize', rect: r, handle: 'w' };
                if (ix > r.x + r.w && ix - (r.x + r.w) <= tol) return { kind: 'resize', rect: r, handle: 'e' };
            }
            if (inX && ix > r.x && ix < r.x + r.w) {
                const ty = r.y + r.borderT;
                const by = r.y + r.h - r.borderB;
                if (r.borderT > 0 ? Math.abs(iy - ty) <= tol : bandY && iy >= r.y && iy - r.y <= tol) return { kind: 'border', rect: r, side: 'T' };
                if (r.borderB > 0 ? Math.abs(iy - by) <= tol : bandY && iy <= r.y + r.h && r.y + r.h - iy <= tol) return { kind: 'border', rect: r, side: 'B' };
                if (iy < r.y && r.y - iy <= tol) return { kind: 'resize', rect: r, handle: 'n' };
                if (iy > r.y + r.h && iy - (r.y + r.h) <= tol) return { kind: 'resize', rect: r, handle: 's' };
            }
        }

        // Prefer an already-selected rect under the cursor, then the smallest one.
        const selected = new Set(store.state.selected);
        let best: SpriteRect | null = null;
        let bestArea = Infinity;
        for (const r of store.state.rects) {
            if (ix < r.x || iy < r.y || ix > r.x + r.w || iy > r.y + r.h) continue;
            if (selected.has(r.id)) return { kind: 'rect', rect: r };
            const a = r.w * r.h;
            if (a < bestArea) {
                bestArea = a;
                best = r;
            }
        }
        return best ? { kind: 'rect', rect: best } : { kind: 'empty' };
    }

    private handles(r: Box): [Handle, number, number][] {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return [
            ['nw', r.x, r.y], ['n', cx, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, cy],
            ['se', r.x + r.w, r.y + r.h], ['s', cx, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, cy],
        ];
    }

    private onHover(e: MouseEvent) {
        const p = this.eventPos(e);
        this.mouse = p;
        if (!this.store.state.texture) return;
        const im = this.toImage(p.x, p.y);
        const hit = this.hitTest(im.x, im.y);
        const prev = this.hover;
        this.hover = hit;
        const key = (h: Hit) => h.kind + ('rect' in h ? h.rect.id : '') + ('handle' in h ? h.handle : '') + ('side' in h ? h.side : '');
        if (key(prev) !== key(hit)) this.invalidate();
        this.updateCursor();
    }

    private updateCursor() {
        let cursor = 'default';
        const d = this.drag;
        const h = this.hover;
        if (d && d.kind === 'pan') cursor = 'grabbing';
        else if (this.space && !d) cursor = 'grab';
        else if (d && d.kind === 'create') cursor = 'crosshair';
        else if (d && d.kind === 'move') cursor = 'move';
        else if (h.kind === 'pivot') cursor = 'pointer';
        else if (h.kind === 'resize') {
            cursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h.handle];
        } else if (h.kind === 'border') cursor = h.side === 'L' || h.side === 'R' ? 'col-resize' : 'row-resize';
        else if (h.kind === 'rect' && this.store.state.selected.includes(h.rect.id) && !this.store.state.readOnly) cursor = 'move';
        else if (this.store.state.texture && !this.store.state.readOnly) cursor = 'crosshair';
        this.canvas.style.cursor = cursor;
    }

    private onDown(e: MouseEvent) {
        const store = this.store;
        if (!store.state.texture) return;
        const p = this.eventPos(e);
        const im = this.toImage(p.x, p.y);
        store.state.sliceOpen = false;

        if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || this.space))) {
            e.preventDefault();
            this.drag = { kind: 'pan', sx: p.x, sy: p.y, panX: this.panX, panY: this.panY };
            this.beginWindowDrag();
            return;
        }
        if (e.button !== 0) return;

        const hit = this.hitTest(im.x, im.y);
        const readOnly = !!store.state.readOnly;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;

        if (hit.kind === 'pivot' || hit.kind === 'resize' || hit.kind === 'border') {
            store.snapshot();
            if (hit.kind === 'pivot') this.drag = { kind: 'pivot', rect: hit.rect };
            else if (hit.kind === 'border') this.drag = { kind: 'border', rect: hit.rect, side: hit.side };
            else this.drag = { kind: 'resize', rect: hit.rect, handle: hit.handle, origin: { x: hit.rect.x, y: hit.rect.y, w: hit.rect.w, h: hit.rect.h } };
            this.beginWindowDrag();
            return;
        }

        if (hit.kind === 'rect') {
            const id = hit.rect.id;
            if (additive) {
                store.select([id], true);
                return;
            }
            if (!store.state.selected.includes(id)) store.select([id]);
            if (readOnly) return;
            const sel = store.selectedRects.value;
            store.snapshot();
            const x0 = Math.min(...sel.map((r) => r.x));
            const y0 = Math.min(...sel.map((r) => r.y));
            this.drag = {
                kind: 'move',
                ix: im.x,
                iy: im.y,
                origin: sel.map((r) => ({ id: r.id, x: r.x, y: r.y })),
                bounds: {
                    x: x0,
                    y: y0,
                    w: Math.max(...sel.map((r) => r.x + r.w)) - x0,
                    h: Math.max(...sel.map((r) => r.y + r.h)) - y0,
                },
            };
            this.beginWindowDrag();
            return;
        }

        // Empty space: click deselects, drag creates a new rect.
        if (!additive) store.select([]);
        if (readOnly) return;
        this.drag = { kind: 'create', ix: im.x, iy: im.y, cx: im.x, cy: im.y, sx: p.x, sy: p.y, moved: false };
        this.beginWindowDrag();
    }

    private onWindowMove = (e: MouseEvent) => {
        const d = this.drag;
        if (!d) return;
        const p = this.eventPos(e);
        this.mouse = p;
        const im = this.toImage(p.x, p.y);
        const store = this.store;
        const W = store.state.width;
        const H = store.state.height;

        switch (d.kind) {
            case 'pan':
                this.panX = d.panX + (p.x - d.sx);
                this.panY = d.panY + (p.y - d.sy);
                break;
            case 'create':
                d.cx = im.x;
                d.cy = im.y;
                if (Math.abs(p.x - d.sx) > 3 || Math.abs(p.y - d.sy) > 3) d.moved = true;
                break;
            case 'move': {
                let dx = Math.round(im.x - d.ix);
                let dy = Math.round(im.y - d.iy);
                dx = Math.max(-d.bounds.x, Math.min(W - (d.bounds.x + d.bounds.w), dx));
                dy = Math.max(-d.bounds.y, Math.min(H - (d.bounds.y + d.bounds.h), dy));
                for (const o of d.origin) {
                    const r = store.byId(o.id);
                    if (!r) continue;
                    r.x = o.x + dx;
                    r.y = o.y + dy;
                }
                break;
            }
            case 'resize': {
                const o = d.origin;
                let x0 = o.x;
                let y0 = o.y;
                let x1 = o.x + o.w;
                let y1 = o.y + o.h;
                const ix = Math.max(0, Math.min(W, Math.round(im.x)));
                const iy = Math.max(0, Math.min(H, Math.round(im.y)));
                if (d.handle.includes('w')) x0 = ix;
                if (d.handle.includes('e')) x1 = ix;
                if (d.handle.includes('n')) y0 = iy;
                if (d.handle.includes('s')) y1 = iy;
                const r = d.rect;
                r.x = Math.min(x0, x1);
                r.y = Math.min(y0, y1);
                r.w = Math.max(1, Math.abs(x1 - x0));
                r.h = Math.max(1, Math.abs(y1 - y0));
                store.clampRect(r);
                break;
            }
            case 'pivot': {
                const r = d.rect;
                let px = Math.round(im.x - r.x) / r.w;
                let py = 1 - Math.round(im.y - r.y) / r.h;
                if (e.ctrlKey || e.metaKey) {
                    px = Math.round(px * 2) / 2;
                    py = Math.round(py * 2) / 2;
                }
                r.pivotX = Math.round(Math.max(0, Math.min(1, px)) * 10000) / 10000;
                r.pivotY = Math.round(Math.max(0, Math.min(1, py)) * 10000) / 10000;
                store.state.customPivot = store.state.customPivot.filter((id) => id !== r.id);
                break;
            }
            case 'border': {
                const r = d.rect;
                if (d.side === 'L') r.borderL = Math.max(0, Math.min(r.w - r.borderR, Math.round(im.x - r.x)));
                if (d.side === 'R') r.borderR = Math.max(0, Math.min(r.w - r.borderL, Math.round(r.x + r.w - im.x)));
                if (d.side === 'T') r.borderT = Math.max(0, Math.min(r.h - r.borderB, Math.round(im.y - r.y)));
                if (d.side === 'B') r.borderB = Math.max(0, Math.min(r.h - r.borderT, Math.round(r.y + r.h - im.y)));
                break;
            }
        }
        this.updateCursor();
        this.invalidate();
    };

    private onWindowUp = () => {
        const d = this.drag;
        this.drag = null;
        this.endWindowDrag();
        if (!d) return;
        const store = this.store;
        if (d.kind === 'create') {
            if (d.moved) {
                const x0 = Math.round(Math.min(d.ix, d.cx));
                const y0 = Math.round(Math.min(d.iy, d.cy));
                const x1 = Math.round(Math.max(d.ix, d.cx));
                const y1 = Math.round(Math.max(d.iy, d.cy));
                if (x1 - x0 >= 1 && y1 - y0 >= 1) store.addRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
            }
        } else if (d.kind !== 'pan') {
            store.discardSnapshotIfSame();
            store.changed();
        }
        this.updateCursor();
        this.invalidate();
    };

    private beginWindowDrag() {
        window.addEventListener('mousemove', this.onWindowMove, true);
        window.addEventListener('mouseup', this.onWindowUp, true);
        this.updateCursor();
    }

    private endWindowDrag() {
        window.removeEventListener('mousemove', this.onWindowMove, true);
        window.removeEventListener('mouseup', this.onWindowUp, true);
    }

    // ---------------------------------------------------------------- render

    private ensureChecker() {
        if (this.checker) return this.checker;
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        const g = c.getContext('2d')!;
        g.fillStyle = COLORS.checkerA;
        g.fillRect(0, 0, 16, 16);
        g.fillStyle = COLORS.checkerB;
        g.fillRect(0, 0, 8, 8);
        g.fillRect(8, 8, 8, 8);
        this.checker = this.ctx.createPattern(c, 'repeat');
        return this.checker;
    }

    /** Screen-space rect snapped to device pixels for crisp 1px strokes. */
    private screenRect(b: Box) {
        const x0 = Math.round(this.panX + b.x * this.zoom);
        const y0 = Math.round(this.panY + b.y * this.zoom);
        const x1 = Math.round(this.panX + (b.x + b.w) * this.zoom);
        const y1 = Math.round(this.panY + (b.y + b.h) * this.zoom);
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    render() {
        const ctx = this.ctx;
        const dpr = window.devicePixelRatio || 1;
        const { w, h } = this.size();
        if (!w || !h) return;
        if (this.cssW !== w || this.cssH !== h || this.canvas.width !== Math.round(w * dpr)) {
            const firstSize = !this.cssW;
            this.cssW = w;
            this.cssH = h;
            this.canvas.width = Math.round(w * dpr);
            this.canvas.height = Math.round(h * dpr);
            if (firstSize && this.store.state.texture) {
                this.fit();
                return;
            }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, w, h);

        const store = this.store;
        const { texture, width, height } = store.state;
        const image = store.state.showAlpha ? store.alphaCanvas() : store.raw.image;
        if (!texture || !image) return;

        const tex = this.screenRect({ x: 0, y: 0, w: width, h: height });
        ctx.fillStyle = this.ensureChecker()!;
        ctx.fillRect(tex.x, tex.y, tex.w, tex.h);
        ctx.imageSmoothingEnabled = this.zoom < 1;
        ctx.drawImage(image, tex.x, tex.y, tex.w, tex.h);
        ctx.strokeStyle = COLORS.textureEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(tex.x - 0.5, tex.y - 0.5, tex.w + 1, tex.h + 1);

        if (this.zoom >= 12) this.drawPixelGrid(tex);

        if (store.state.sliceOpen && store.state.slice.type !== 'auto') {
            ctx.save();
            ctx.strokeStyle = COLORS.preview;
            ctx.setLineDash([4, 3]);
            for (const b of store.sliceBoxes(true)) {
                const s = this.screenRect(b);
                ctx.strokeRect(s.x + 0.5, s.y + 0.5, s.w - 1, s.h - 1);
            }
            ctx.restore();
        }

        const selected = new Set(store.state.selected);
        const hoverId = this.hover.kind === 'rect' ? this.hover.rect.id : -1;
        ctx.lineWidth = 1;
        for (const r of store.state.rects) {
            if (selected.has(r.id)) continue;
            const s = this.screenRect(r);
            ctx.strokeStyle = r.id === hoverId ? COLORS.rectHover : COLORS.rect;
            ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
        }
        for (const r of store.selectedRects.value) this.drawSelected(r, selected.size === 1);

        const d = this.drag;
        if (d && d.kind === 'create' && d.moved) {
            const box = {
                x: Math.round(Math.min(d.ix, d.cx)),
                y: Math.round(Math.min(d.iy, d.cy)),
                w: Math.round(Math.max(d.ix, d.cx)) - Math.round(Math.min(d.ix, d.cx)),
                h: Math.round(Math.max(d.iy, d.cy)) - Math.round(Math.min(d.iy, d.cy)),
            };
            const s = this.screenRect(box);
            ctx.save();
            ctx.strokeStyle = COLORS.creating;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
            ctx.restore();
            this.drawSizeLabel(box, s);
        } else if (d && d.kind === 'resize') {
            this.drawSizeLabel(d.rect, this.screenRect(d.rect));
        }
    }

    private drawPixelGrid(tex: Box) {
        const ctx = this.ctx;
        const { w, h } = this.size();
        const z = this.zoom;
        const ix0 = Math.max(0, Math.floor(-this.panX / z));
        const iy0 = Math.max(0, Math.floor(-this.panY / z));
        const ix1 = Math.min(this.store.state.width, Math.ceil((w - this.panX) / z));
        const iy1 = Math.min(this.store.state.height, Math.ceil((h - this.panY) / z));
        ctx.save();
        ctx.beginPath();
        for (let x = ix0; x <= ix1; x++) {
            const sx = Math.round(this.panX + x * z) + 0.5;
            ctx.moveTo(sx, Math.max(tex.y, 0));
            ctx.lineTo(sx, Math.min(tex.y + tex.h, h));
        }
        for (let y = iy0; y <= iy1; y++) {
            const sy = Math.round(this.panY + y * z) + 0.5;
            ctx.moveTo(Math.max(tex.x, 0), sy);
            ctx.lineTo(Math.min(tex.x + tex.w, w), sy);
        }
        ctx.strokeStyle = COLORS.pixelGrid;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    private drawSelected(r: SpriteRect, withHandles: boolean) {
        const ctx = this.ctx;
        const s = this.screenRect(r);
        ctx.fillStyle = COLORS.selectedFill;
        ctx.fillRect(s.x, s.y, s.w, s.h);

        if (withHandles) {
            // 9-slice border lines (green), drawn even at 0 like Unity.
            const hover = this.hover.kind === 'border' && this.hover.rect.id === r.id ? this.hover.side : null;
            const active = this.drag && this.drag.kind === 'border' ? this.drag.side : null;
            const line = (side: Side, x0: number, y0: number, x1: number, y1: number) => {
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.lineWidth = side === hover || side === active ? 2 : 1;
                ctx.stroke();
            };
            ctx.save();
            ctx.strokeStyle = COLORS.border;
            const lx = Math.round(this.panX + (r.x + r.borderL) * this.zoom) + 0.5;
            const rx = Math.round(this.panX + (r.x + r.w - r.borderR) * this.zoom) - 0.5;
            const ty = Math.round(this.panY + (r.y + r.borderT) * this.zoom) + 0.5;
            const by = Math.round(this.panY + (r.y + r.h - r.borderB) * this.zoom) - 0.5;
            if (r.borderL || hover === 'L') line('L', lx, s.y, lx, s.y + s.h);
            if (r.borderR || hover === 'R') line('R', rx, s.y, rx, s.y + s.h);
            if (r.borderT || hover === 'T') line('T', s.x, ty, s.x + s.w, ty);
            if (r.borderB || hover === 'B') line('B', s.x, by, s.x + s.w, by);
            ctx.restore();
        }

        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
        if (!withHandles) return;

        if (!this.store.state.readOnly) {
            const hs = HANDLE;
            for (const [, hx, hy] of this.handles(r)) {
                const x = Math.round(this.panX + hx * this.zoom - hs / 2);
                const y = Math.round(this.panY + hy * this.zoom - hs / 2);
                ctx.fillStyle = COLORS.selected;
                ctx.fillRect(x, y, hs, hs);
                ctx.strokeStyle = COLORS.handleEdge;
                ctx.strokeRect(x + 0.5, y + 0.5, hs - 1, hs - 1);
            }
        }

        // Pivot: Unity-style disc.
        const px = this.panX + (r.x + r.pivotX * r.w) * this.zoom;
        const py = this.panY + (r.y + (1 - r.pivotY) * r.h) * this.zoom;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.selected;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = COLORS.pivotRing;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.pivotRing;
        ctx.fill();
    }

    private drawSizeLabel(b: Box, s: Box) {
        const ctx = this.ctx;
        const text = `${b.w} × ${b.h}`;
        ctx.save();
        ctx.font = '11px system-ui, "Segoe UI", sans-serif';
        const tw = ctx.measureText(text).width + 10;
        const x = s.x + s.w - tw;
        const y = s.y + s.h + 4;
        ctx.fillStyle = COLORS.labelBg;
        ctx.fillRect(x, y, tw, 17);
        ctx.fillStyle = COLORS.label;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 5, y + 9);
        ctx.restore();
    }
}
