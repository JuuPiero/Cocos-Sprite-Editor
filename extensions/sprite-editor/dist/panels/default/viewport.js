"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Viewport = exports.COLORS = void 0;
exports.COLORS = {
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
class Viewport {
    constructor(canvas, store) {
        this.canvas = canvas;
        this.store = store;
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.raf = 0;
        this.checker = null;
        this.hover = { kind: 'empty' };
        this.drag = null;
        this.space = false;
        this.cssW = 0;
        this.cssH = 0;
        this.disposers = [];
        this.mouse = null;
        this.onWindowMove = (e) => {
            const d = this.drag;
            if (!d)
                return;
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
                    if (Math.abs(p.x - d.sx) > 3 || Math.abs(p.y - d.sy) > 3)
                        d.moved = true;
                    break;
                case 'move': {
                    let dx = Math.round(im.x - d.ix);
                    let dy = Math.round(im.y - d.iy);
                    dx = Math.max(-d.bounds.x, Math.min(W - (d.bounds.x + d.bounds.w), dx));
                    dy = Math.max(-d.bounds.y, Math.min(H - (d.bounds.y + d.bounds.h), dy));
                    for (const o of d.origin) {
                        const r = store.byId(o.id);
                        if (!r)
                            continue;
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
                    if (d.handle.includes('w'))
                        x0 = ix;
                    if (d.handle.includes('e'))
                        x1 = ix;
                    if (d.handle.includes('n'))
                        y0 = iy;
                    if (d.handle.includes('s'))
                        y1 = iy;
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
                    if (d.side === 'L')
                        r.borderL = Math.max(0, Math.min(r.w - r.borderR, Math.round(im.x - r.x)));
                    if (d.side === 'R')
                        r.borderR = Math.max(0, Math.min(r.w - r.borderL, Math.round(r.x + r.w - im.x)));
                    if (d.side === 'T')
                        r.borderT = Math.max(0, Math.min(r.h - r.borderB, Math.round(im.y - r.y)));
                    if (d.side === 'B')
                        r.borderB = Math.max(0, Math.min(r.h - r.borderT, Math.round(r.y + r.h - im.y)));
                    break;
                }
            }
            this.updateCursor();
            this.invalidate();
        };
        this.onWindowUp = () => {
            const d = this.drag;
            this.drag = null;
            this.endWindowDrag();
            if (!d)
                return;
            const store = this.store;
            if (d.kind === 'create') {
                if (d.moved) {
                    const x0 = Math.round(Math.min(d.ix, d.cx));
                    const y0 = Math.round(Math.min(d.iy, d.cy));
                    const x1 = Math.round(Math.max(d.ix, d.cx));
                    const y1 = Math.round(Math.max(d.iy, d.cy));
                    if (x1 - x0 >= 1 && y1 - y0 >= 1)
                        store.addRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
                }
            }
            else if (d.kind !== 'pan') {
                store.discardSnapshotIfSame();
                store.changed();
            }
            this.updateCursor();
            this.invalidate();
        };
        this.ctx = canvas.getContext('2d');
        this.resizeObserver = new ResizeObserver(() => this.invalidate());
        this.resizeObserver.observe(canvas);
        const on = (el, type, fn, opts) => {
            el.addEventListener(type, fn, opts);
            this.disposers.push(() => el.removeEventListener(type, fn, opts));
        };
        on(canvas, 'mousedown', (e) => this.onDown(e));
        on(canvas, 'mousemove', (e) => {
            if (!this.drag)
                this.onHover(e);
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
        if (this.raf)
            return;
        this.raf = requestAnimationFrame(() => {
            this.raf = 0;
            this.render();
        });
    }
    size() {
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
    setZoom(z, cx, cy) {
        const { w, h } = this.size();
        const x = cx !== null && cx !== void 0 ? cx : w / 2;
        const y = cy !== null && cy !== void 0 ? cy : h / 2;
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
    setSpace(down) {
        if (this.space === down)
            return;
        this.space = down;
        this.updateCursor();
    }
    toImage(sx, sy) {
        return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
    }
    eventPos(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    // ----------------------------------------------------------------- input
    onWheel(e) {
        if (!this.store.state.texture)
            return;
        e.preventDefault();
        const p = this.eventPos(e);
        const step = e.ctrlKey ? 1.04 : 1.15;
        const factor = e.deltaY < 0 ? step : 1 / step;
        this.setZoom(this.zoom * factor, p.x, p.y);
    }
    hitTest(ix, iy) {
        const store = this.store;
        const tol = HIT / this.zoom;
        const one = store.single.value;
        const readOnly = !!store.state.readOnly;
        if (one && !readOnly) {
            const r = one;
            const px = r.x + r.pivotX * r.w;
            const py = r.y + (1 - r.pivotY) * r.h;
            if (Math.hypot(ix - px, iy - py) <= (HIT + 1) / this.zoom)
                return { kind: 'pivot', rect: r };
            for (const [handle, hx, hy] of this.handles(r)) {
                if (Math.abs(ix - hx) <= tol && Math.abs(iy - hy) <= tol)
                    return { kind: 'resize', rect: r, handle };
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
                if (r.borderL > 0 ? Math.abs(ix - lx) <= tol : bandX && ix >= r.x && ix - r.x <= tol)
                    return { kind: 'border', rect: r, side: 'L' };
                if (r.borderR > 0 ? Math.abs(ix - rx) <= tol : bandX && ix <= r.x + r.w && r.x + r.w - ix <= tol)
                    return { kind: 'border', rect: r, side: 'R' };
                if (ix < r.x && r.x - ix <= tol)
                    return { kind: 'resize', rect: r, handle: 'w' };
                if (ix > r.x + r.w && ix - (r.x + r.w) <= tol)
                    return { kind: 'resize', rect: r, handle: 'e' };
            }
            if (inX && ix > r.x && ix < r.x + r.w) {
                const ty = r.y + r.borderT;
                const by = r.y + r.h - r.borderB;
                if (r.borderT > 0 ? Math.abs(iy - ty) <= tol : bandY && iy >= r.y && iy - r.y <= tol)
                    return { kind: 'border', rect: r, side: 'T' };
                if (r.borderB > 0 ? Math.abs(iy - by) <= tol : bandY && iy <= r.y + r.h && r.y + r.h - iy <= tol)
                    return { kind: 'border', rect: r, side: 'B' };
                if (iy < r.y && r.y - iy <= tol)
                    return { kind: 'resize', rect: r, handle: 'n' };
                if (iy > r.y + r.h && iy - (r.y + r.h) <= tol)
                    return { kind: 'resize', rect: r, handle: 's' };
            }
        }
        // Prefer an already-selected rect under the cursor, then the smallest one.
        const selected = new Set(store.state.selected);
        let best = null;
        let bestArea = Infinity;
        for (const r of store.state.rects) {
            if (ix < r.x || iy < r.y || ix > r.x + r.w || iy > r.y + r.h)
                continue;
            if (selected.has(r.id))
                return { kind: 'rect', rect: r };
            const a = r.w * r.h;
            if (a < bestArea) {
                bestArea = a;
                best = r;
            }
        }
        return best ? { kind: 'rect', rect: best } : { kind: 'empty' };
    }
    handles(r) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        return [
            ['nw', r.x, r.y], ['n', cx, r.y], ['ne', r.x + r.w, r.y], ['e', r.x + r.w, cy],
            ['se', r.x + r.w, r.y + r.h], ['s', cx, r.y + r.h], ['sw', r.x, r.y + r.h], ['w', r.x, cy],
        ];
    }
    onHover(e) {
        const p = this.eventPos(e);
        this.mouse = p;
        if (!this.store.state.texture)
            return;
        const im = this.toImage(p.x, p.y);
        const hit = this.hitTest(im.x, im.y);
        const prev = this.hover;
        this.hover = hit;
        const key = (h) => h.kind + ('rect' in h ? h.rect.id : '') + ('handle' in h ? h.handle : '') + ('side' in h ? h.side : '');
        if (key(prev) !== key(hit))
            this.invalidate();
        this.updateCursor();
    }
    updateCursor() {
        let cursor = 'default';
        const d = this.drag;
        const h = this.hover;
        if (d && d.kind === 'pan')
            cursor = 'grabbing';
        else if (this.space && !d)
            cursor = 'grab';
        else if (d && d.kind === 'create')
            cursor = 'crosshair';
        else if (d && d.kind === 'move')
            cursor = 'move';
        else if (h.kind === 'pivot')
            cursor = 'pointer';
        else if (h.kind === 'resize') {
            cursor = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[h.handle];
        }
        else if (h.kind === 'border')
            cursor = h.side === 'L' || h.side === 'R' ? 'col-resize' : 'row-resize';
        else if (h.kind === 'rect' && this.store.state.selected.includes(h.rect.id) && !this.store.state.readOnly)
            cursor = 'move';
        else if (this.store.state.texture && !this.store.state.readOnly)
            cursor = 'crosshair';
        this.canvas.style.cursor = cursor;
    }
    onDown(e) {
        const store = this.store;
        if (!store.state.texture)
            return;
        const p = this.eventPos(e);
        const im = this.toImage(p.x, p.y);
        store.state.sliceOpen = false;
        if (e.button === 1 || e.button === 2 || (e.button === 0 && (e.altKey || this.space))) {
            e.preventDefault();
            this.drag = { kind: 'pan', sx: p.x, sy: p.y, panX: this.panX, panY: this.panY };
            this.beginWindowDrag();
            return;
        }
        if (e.button !== 0)
            return;
        const hit = this.hitTest(im.x, im.y);
        const readOnly = !!store.state.readOnly;
        const additive = e.shiftKey || e.ctrlKey || e.metaKey;
        if (hit.kind === 'pivot' || hit.kind === 'resize' || hit.kind === 'border') {
            store.snapshot();
            if (hit.kind === 'pivot')
                this.drag = { kind: 'pivot', rect: hit.rect };
            else if (hit.kind === 'border')
                this.drag = { kind: 'border', rect: hit.rect, side: hit.side };
            else
                this.drag = { kind: 'resize', rect: hit.rect, handle: hit.handle, origin: { x: hit.rect.x, y: hit.rect.y, w: hit.rect.w, h: hit.rect.h } };
            this.beginWindowDrag();
            return;
        }
        if (hit.kind === 'rect') {
            const id = hit.rect.id;
            if (additive) {
                store.select([id], true);
                return;
            }
            if (!store.state.selected.includes(id))
                store.select([id]);
            if (readOnly)
                return;
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
        if (!additive)
            store.select([]);
        if (readOnly)
            return;
        this.drag = { kind: 'create', ix: im.x, iy: im.y, cx: im.x, cy: im.y, sx: p.x, sy: p.y, moved: false };
        this.beginWindowDrag();
    }
    beginWindowDrag() {
        window.addEventListener('mousemove', this.onWindowMove, true);
        window.addEventListener('mouseup', this.onWindowUp, true);
        this.updateCursor();
    }
    endWindowDrag() {
        window.removeEventListener('mousemove', this.onWindowMove, true);
        window.removeEventListener('mouseup', this.onWindowUp, true);
    }
    // ---------------------------------------------------------------- render
    ensureChecker() {
        if (this.checker)
            return this.checker;
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 16;
        const g = c.getContext('2d');
        g.fillStyle = exports.COLORS.checkerA;
        g.fillRect(0, 0, 16, 16);
        g.fillStyle = exports.COLORS.checkerB;
        g.fillRect(0, 0, 8, 8);
        g.fillRect(8, 8, 8, 8);
        this.checker = this.ctx.createPattern(c, 'repeat');
        return this.checker;
    }
    /** Screen-space rect snapped to device pixels for crisp 1px strokes. */
    screenRect(b) {
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
        if (!w || !h)
            return;
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
        ctx.fillStyle = exports.COLORS.background;
        ctx.fillRect(0, 0, w, h);
        const store = this.store;
        const { texture, width, height } = store.state;
        const image = store.state.showAlpha ? store.alphaCanvas() : store.raw.image;
        if (!texture || !image)
            return;
        const tex = this.screenRect({ x: 0, y: 0, w: width, h: height });
        ctx.fillStyle = this.ensureChecker();
        ctx.fillRect(tex.x, tex.y, tex.w, tex.h);
        ctx.imageSmoothingEnabled = this.zoom < 1;
        ctx.drawImage(image, tex.x, tex.y, tex.w, tex.h);
        ctx.strokeStyle = exports.COLORS.textureEdge;
        ctx.lineWidth = 1;
        ctx.strokeRect(tex.x - 0.5, tex.y - 0.5, tex.w + 1, tex.h + 1);
        if (this.zoom >= 12)
            this.drawPixelGrid(tex);
        if (store.state.sliceOpen && store.state.slice.type !== 'auto') {
            ctx.save();
            ctx.strokeStyle = exports.COLORS.preview;
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
            if (selected.has(r.id))
                continue;
            const s = this.screenRect(r);
            ctx.strokeStyle = r.id === hoverId ? exports.COLORS.rectHover : exports.COLORS.rect;
            ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
        }
        for (const r of store.selectedRects.value)
            this.drawSelected(r, selected.size === 1);
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
            ctx.strokeStyle = exports.COLORS.creating;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
            ctx.restore();
            this.drawSizeLabel(box, s);
        }
        else if (d && d.kind === 'resize') {
            this.drawSizeLabel(d.rect, this.screenRect(d.rect));
        }
    }
    drawPixelGrid(tex) {
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
        ctx.strokeStyle = exports.COLORS.pixelGrid;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }
    drawSelected(r, withHandles) {
        const ctx = this.ctx;
        const s = this.screenRect(r);
        ctx.fillStyle = exports.COLORS.selectedFill;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        if (withHandles) {
            // 9-slice border lines (green), drawn even at 0 like Unity.
            const hover = this.hover.kind === 'border' && this.hover.rect.id === r.id ? this.hover.side : null;
            const active = this.drag && this.drag.kind === 'border' ? this.drag.side : null;
            const line = (side, x0, y0, x1, y1) => {
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.lineWidth = side === hover || side === active ? 2 : 1;
                ctx.stroke();
            };
            ctx.save();
            ctx.strokeStyle = exports.COLORS.border;
            const lx = Math.round(this.panX + (r.x + r.borderL) * this.zoom) + 0.5;
            const rx = Math.round(this.panX + (r.x + r.w - r.borderR) * this.zoom) - 0.5;
            const ty = Math.round(this.panY + (r.y + r.borderT) * this.zoom) + 0.5;
            const by = Math.round(this.panY + (r.y + r.h - r.borderB) * this.zoom) - 0.5;
            if (r.borderL || hover === 'L')
                line('L', lx, s.y, lx, s.y + s.h);
            if (r.borderR || hover === 'R')
                line('R', rx, s.y, rx, s.y + s.h);
            if (r.borderT || hover === 'T')
                line('T', s.x, ty, s.x + s.w, ty);
            if (r.borderB || hover === 'B')
                line('B', s.x, by, s.x + s.w, by);
            ctx.restore();
        }
        ctx.strokeStyle = exports.COLORS.selected;
        ctx.lineWidth = 1;
        ctx.strokeRect(s.x + 0.5, s.y + 0.5, Math.max(0, s.w - 1), Math.max(0, s.h - 1));
        if (!withHandles)
            return;
        if (!this.store.state.readOnly) {
            const hs = HANDLE;
            for (const [, hx, hy] of this.handles(r)) {
                const x = Math.round(this.panX + hx * this.zoom - hs / 2);
                const y = Math.round(this.panY + hy * this.zoom - hs / 2);
                ctx.fillStyle = exports.COLORS.selected;
                ctx.fillRect(x, y, hs, hs);
                ctx.strokeStyle = exports.COLORS.handleEdge;
                ctx.strokeRect(x + 0.5, y + 0.5, hs - 1, hs - 1);
            }
        }
        // Pivot: Unity-style disc.
        const px = this.panX + (r.x + r.pivotX * r.w) * this.zoom;
        const py = this.panY + (r.y + (1 - r.pivotY) * r.h) * this.zoom;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = exports.COLORS.selected;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = exports.COLORS.pivotRing;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = exports.COLORS.pivotRing;
        ctx.fill();
    }
    drawSizeLabel(b, s) {
        const ctx = this.ctx;
        const text = `${b.w} × ${b.h}`;
        ctx.save();
        ctx.font = '11px system-ui, "Segoe UI", sans-serif';
        const tw = ctx.measureText(text).width + 10;
        const x = s.x + s.w - tw;
        const y = s.y + s.h + 4;
        ctx.fillStyle = exports.COLORS.labelBg;
        ctx.fillRect(x, y, tw, 17);
        ctx.fillStyle = exports.COLORS.label;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 5, y + 9);
        ctx.restore();
    }
}
exports.Viewport = Viewport;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmlld3BvcnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvdmlld3BvcnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBNEJhLFFBQUEsTUFBTSxHQUFHO0lBQ2xCLFVBQVUsRUFBRSxTQUFTO0lBQ3JCLFFBQVEsRUFBRSxTQUFTO0lBQ25CLFFBQVEsRUFBRSxTQUFTO0lBQ25CLFdBQVcsRUFBRSxpQkFBaUI7SUFDOUIsSUFBSSxFQUFFLHdCQUF3QjtJQUM5QixTQUFTLEVBQUUsd0JBQXdCO0lBQ25DLFFBQVEsRUFBRSxTQUFTO0lBQ25CLFlBQVksRUFBRSx1QkFBdUI7SUFDckMsVUFBVSxFQUFFLFNBQVM7SUFDckIsTUFBTSxFQUFFLFNBQVM7SUFDakIsU0FBUyxFQUFFLFNBQVM7SUFDcEIsT0FBTyxFQUFFLHVCQUF1QjtJQUNoQyxRQUFRLEVBQUUsU0FBUztJQUNuQixTQUFTLEVBQUUsa0JBQWtCO0lBQzdCLEtBQUssRUFBRSxTQUFTO0lBQ2hCLE9BQU8sRUFBRSxxQkFBcUI7Q0FDakMsQ0FBQztBQUVGLE1BQU0sTUFBTSxHQUFHLENBQUMsQ0FBQztBQUNqQixNQUFNLEdBQUcsR0FBRyxDQUFDLENBQUM7QUFDZCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUM7QUFDdEIsTUFBTSxRQUFRLEdBQUcsRUFBRSxDQUFDO0FBRXBCLE1BQWEsUUFBUTtJQWlCakIsWUFBb0IsTUFBeUIsRUFBVSxLQUFZO1FBQS9DLFdBQU0sR0FBTixNQUFNLENBQW1CO1FBQVUsVUFBSyxHQUFMLEtBQUssQ0FBTztRQWhCbkUsU0FBSSxHQUFHLENBQUMsQ0FBQztRQUNULFNBQUksR0FBRyxDQUFDLENBQUM7UUFDVCxTQUFJLEdBQUcsQ0FBQyxDQUFDO1FBR0QsUUFBRyxHQUFHLENBQUMsQ0FBQztRQUNSLFlBQU8sR0FBeUIsSUFBSSxDQUFDO1FBQ3JDLFVBQUssR0FBUSxFQUFFLElBQUksRUFBRSxPQUFPLEVB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QyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQzt3QkFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDO29CQUNwQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQzt3QkFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDO29CQUNwQyxJQUFJLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQzt3QkFBRSxFQUFFLEdBQUcsRUFBRSxDQUFDO29CQUNwQyxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO29CQUNqQixDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO29CQUN2QixDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO29CQUN2QixDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUM7b0JBQ3JDLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQztvQkFDckMsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDbkIsTUFBTTtnQkFDVixDQUFDO2dCQUNELEtBQUssT0FBTyxDQUFDLENBQUMsQ0FBQztvQkFDWCxNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO29CQUNqQixJQUFJLEVBQUUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3RDLElBQUksRUFBRSxHQUFHLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQzFDLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUM7d0JBQ3pCLEVBQUUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7d0JBQzVCLEVBQUUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ2hDLENBQUM7b0JBQ0QsQ0FBQyxDQUFDLE1BQU0sR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLEdBQUcsS0FBSyxDQUFDLEdBQUcsS0FBSyxDQUFDO29CQUNwRSxDQUFDLENBQUMsTUFBTSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUMsR0FBRyxLQUFLLENBQUM7b0JBQ3BFLEtBQUssQ0FBQyxLQUFLLENBQUMsV0FBVyxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsRUFBRSxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQztvQkFDOUUsTUFBTTtnQkFDVixDQUFDO2dCQUNELEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQztvQkFDWixNQUFNLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDO29CQUNqQixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssR0FBRzt3QkFBRSxDQUFDLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUMvRixJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssR0FBRzt3QkFBRSxDQUFDLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsT0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQ3JHLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHO3dCQUFFLENBQUMsQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7b0JBQy9GLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHO3dCQUFFLENBQUMsQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDckcsTUFBTTtnQkFDVixDQUFDO1lB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RSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUM1QyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsRCxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsRCxNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM3QixNQUFNLENBQUMsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1FBQ3pFLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDbEMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQztRQUNoRCxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsR0FBRyxFQUFFLENBQUMsR0FBRyxD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QyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO1NBQzdGLENBQUM7SUFDTixDQUFDO0lBRU8sT0FBTyxDQUFDLENBQWE7UUFDekIsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMzQixJQUFJLENBQUMsS0FBSyxHQUFHLENBQUMsQ0FBQztRQUNmLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPO1lBQUUsT0FBTztRQUN0QyxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2xDLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDckMsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUN4QixJQUFJLENBQUMsS0FBSyxHQUFHLEdBQUcsQ0FBQztRQUNqQixNQUFNLEdBQUcsR0FBRyxDQUFDLENBQU0sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLElBQUksR0FBRyxDQUFDLE1BQU0sSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLFFBQVEsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsTUFBTSxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDaEksSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssR0FBRyxDQUFDLEdBQUcsQ0FBQztZQUFFLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUM5QyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7SUFDeEIsQ0FBQztJQUVPLFlBQVk7UUFDaEIsSUFBSSxNQUFNLEdBQUcsU0FBUyxDQUFDO1FBQ3ZCLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDcEIsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUNyQixJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLEtBQUs7WUFBRSxNQUFNLEdBQUcsVUFBVSxDQUFDO2FBQzFDLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxDQUFDLENBQUM7WUFBRSxNQUFNLEdBQUcsTUFBTSxDQUFDO2FBQ3RDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssUUFBUTtZQUFFLE1BQU0sR0FBRyxXQUFXLENBQUM7YUFDbkQsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNO1lBQUUsTUFBTSxHQUFHLE1BQU0sQ0FBQzthQUM1QyxJQUFJLENBQUMsQ0FBQyxJQUFJLEtBQUssT0FBTztZQUFFLE1BQU0sR0FBRyxTQUFTLENBQUM7YUFDM0MsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQzNCLE1BQU0sR0FBRyxFQUFFLENBQUMsRUFBRSxXQUFXLEVBQUUsQ0FBQyxFQUFFLFdBQVcsRUFBRSxDQUFDLEVBQUUsV0FBVyxFQUFFLENBQUMsRUFBRSxXQUFXLEVBQUUsRUFBRSxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsYUFBYSxFQUFFLEVBQUUsRUFBRSxhQUFhLEVBQUUsRUFBRSxFQUFFLGFBQWEsRUFBRSxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN0SyxDQUFDO2FBQU0sSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVE7WUFBRSxNQUFNLEdBQUcsQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLFlBQVksQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDO2FBQ25HLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUTtZQUFFLE1BQU0sR0FBRyxNQUFNLENBQUM7YUFDdEgsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxRQUFRO1lBQUUsTUFBTSxHQUFHLFdBQVcsQ0FBQztRQUN0RixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0lBQ3RDLENBQUM7SUFFTyxNQUFNLENBQUMsQ0FBYTtRQUN4QixNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDO1FBQ3pCLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQU87WUFBRSxPQUFPO1FBQ2pDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDM0IsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNsQyxLQUFLLENBQUMsS0FBSyxDQUFDLFNBQVMsR0FBRyxLQUFLLENBQUM7UUFFOUIsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLE1BQU0sSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ25GLENBQUMsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsSUFBSSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ2hGLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUN2QixPQUFPO1FBQ1gsQ0FBQztRQUNELElBQUksQ0FBQyxDQUFDLE1BQU0sS0FBSyxDQUFDO1lBQUUsT0FBTztRQUUzQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3JDLE1BQU0sUUFBUSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQztRQUN4QyxNQUFNLFFBQVEsR0FBRyxDQUFDLENBQUMsUUFBUSxJQUFJLENBQUMsQ0FBQyxPQUFPLElBQUksQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUV0RCxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUssT0FBTyxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUssUUFBUSxJQUFJLEdBQUcsQ0FBQyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7WUFDekUsS0FBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ2pCLElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxPQUFPO2dCQUFFLElBQUksQ0FBQyxJQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7aUJBQ25FLElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxRQUFRO2dCQUFFLElBQUksQ0FBQyxJQUFJLEdBQUcsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksRUFBRSxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7O2dCQUMxRixJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLE1BQU0sRUFBRSxNQUFNLEVBQUUsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDO1lBQ2hKLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUN2QixPQUFPO1FBQ1gsQ0FBQztRQUVELElBQUksR0FBRyxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztZQUN0QixNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN2QixJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUNYLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDekIsT0FBTztZQUNYLENBQUM7WUFDRCxJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQztnQkFBRSxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUMzRCxJQUFJLFFBQVE7Z0JBQUUsT0FBTztZQUNyQixNQUFNLEdBQUcsR0FBRyxLQUFLLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztZQUN0QyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDakIsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUM1QyxJQUFJLENBQUMsSUFBSSxHQUFHO2dCQUNSLElBQUksRUFBRSxNQUFNO2dCQUNaLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztnQkFDUixFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUM7Z0JBQ1IsTUFBTSxFQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3RELE1BQU0sRUFBRTtvQkFDSixDQUFDLEVBQUUsRUFBRTtvQkFDTCxDQUFDLEVBQUUsRUFBRTtvQkFDTCxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRTtvQkFDOUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FB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QU0sRUFBRSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMzRCxNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDM0QsT0FBTyxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDLEVBQUUsRUFBRSxHQUFHLEVBQUUsRUFBRSxDQUFDO0lBQ3BELENBQUM7SUFFRCxNQUFNO1FBQ0YsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQztRQUNyQixNQUFNLEdBQUcsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxDQUFDO1FBQ3pDLE1BQU0sRUFBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQUUsT0FBTztRQUNyQixJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxJQUFJLEtBQUssQ0FBQyxJQUFJLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxLQUFLLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDbEYsTUFBTSxTQUFTLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO1lBQzdCLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDO1lBQ2QsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUM7WUFDZCxJQUFJLENBQUMsTUFBTSxD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QUFDLENBQUMsQ0FBQyxHQUFHLEdBQUcsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNyRixDQUFDO1FBQ0QsS0FBSyxNQUFNLENBQUMsSUFBSSxLQUFLLENBQUMsYUFBYSxDQUFDLEtBQUs7WUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsRUFBRSxRQUFRLENBQUMsSUFBSSxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBRXJGLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDcEIsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksS0FBSyxRQUFRLElBQUksQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3RDLE1BQU0sR0FBRyxHQUFHO2dCQUNSLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ25DLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ25DLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7Z0JBQ3RFLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7YUFDekUsQ0FBQztZQUNGLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDL0IsR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1gsR0FBRyxDQUFDLFdBQVcsR0FBRyxjQUFNLENBQUMsUUFBUSxDQUFDO1lBQ2xDLEdBQUcsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUN4QixHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2pGLEdBQUcsQ0FBQyxPQUFPLEVBQUUsQ0FBQztZQUNkLElBQUksQ0FBQyxhQUFhLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQy9CLENBQUM7YUFBTSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ3hELENBQUM7SUFDTCxDQUFDO0lBRU8sYUFBYSxDQUFDLEdBQVE7UUFDMUIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQztRQUNyQixNQUFNLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUM3QixNQUFNLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQ3BCLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEQsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNwRCxNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzdFLE1BQU0sR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDOUUsR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ1gsR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hCLEtBQUssSUFBSSxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztZQUM5QixNQUFNLEVBQUUsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQztZQUMvQyxHQUFHLENBQUMsTUFBTSxDQUFDLEVBQUUsRUFBRSxJ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R0FBRyxjQUFNLENBQUMsTUFBTSxDQUFDO1lBQ2hDLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUM7WUFDdkUsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDO1lBQzdFLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxHQUFHLENBQUM7WUFDdkUsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsR0FBRyxDQUFDO1lBQzdFLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxLQUFLLEtBQUssR0FBRztnQkFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUNsRSxJQUFJLENBQUMsQ0FBQyxPQUFPLElBQUksS0FBSyxLQUFLLEdBQUc7Z0JBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDbEUsSUFBSSxDQUFDLENBQUMsT0FBTyxJQUFJLEtBQUssS0FBSyxHQUFHO2dCQUFFLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQ2xFLElBQUksQ0FBQyxDQUFDLE9BQU8sSUFBSSxLQUFLLEtBQUssR0FBRztnQkFBRSxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztZQUNsRSxHQUFHLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDbEIsQ0FBQztRQUVELEdBQUcsQ0FBQyxXQUFXLEdBQUcsY0FBTSxDQUFDLFFBQVEsQ0FBQztRQUNsQyxHQUFHLENBQUMsU0FBUyxHQUFHLENBQUMsQ0FBQztRQUNsQixHQUFHLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsR0FBRyxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2pGLElBQUksQ0FBQyxXQUFXO1lBQUUsT0FBTztRQUV6QixJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDN0IsTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDO1lBQ2xCLEtBQUssTUFBTSxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxJQUFJLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQztnQkFDdkMsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztnQkFDMUQsTUFBTSxDQUFDLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsR0FBRyxJQUFJLENBQUMsSUFBSSxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQztnQkFDMUQsR0FBRyxDQUFDLFNBQVMsR0FBRyxjQUFNLENBQUMsUUFBUSxDQUFDO2dCQUNoQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxDQUFDO2dCQUMzQixHQUFHLENBQUMsV0FBVyxHQUFHLGNBQU0sQ0FBQyxVQUFVLENBQUM7Z0JBQ3BDLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQyxHQUFHLEdBQUcsRUFBRSxDQUFDLEdBQUcsR0FBRyxFQUFFLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1lBQ3JELENBQUM7UUFDTCxDQUFDO1FBRUQsMkJBQTJCO1FBQzNCLE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxJQUFJLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUM7UUFDMUQsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLElBQUksR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO1FBQ2hFLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUNoQixHQUFHLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRSxFQUFFLEVBQUUsQ0FBQyxFQUFFLENBQUMsRUFBRSxJQUFJLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBQ25DLEdBQUcsQ0FBQyxTQUFTLEdBQUcsY0FBTSxDQUFDLFFBQVEsQ0FBQztRQUNoQyxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDWCxHQUFHLENBQUMsU0FBUyxHQUFHLEdBQUcsQ0FBQztRQUNwQixHQUFHLENBQUMsV0FBVyxHQUFHLGNBQU0sQ0FBQyxTQUFTLENBQUM7UUFDbkMsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2IsR0FBRyxDQUFDLFNBQVMsRUFBRSxDQUFDO1FBQ2hCLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLEVBQUUsRUFBRSxHQUFHLEVBQUUsQ0FBQyxFQUFFLElBQUksQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDckMsR0FBRyxDQUFDLFNBQVMsR0FBRyxjQUFNLENBQUMsU0FBUyxDQUFDO1FBQ2pDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUNmLENBQUM7SUFFTyxhQUFhLENBQUMsQ0FBTSxFQUFFLENBQU07UUFDaEMsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQztRQUNyQixNQUFNLElBQUksR0FBRyxHQUFHLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQy9CLEdBQUcsQ0FBQyxJQUFJLEVBQUUsQ0FBQztRQUNYLEdBQUcsQ0FBQyxJQUFJLEdBQUcsd0NBQXdDLENBQUM7UUFDcEQsTUFBTSxFQUFFLEdBQUcsR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEdBQUcsRUFBRSxDQUFDO1FBQzVDLE1BQU0sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDekIsTUFBTSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUN4QixHQUFHLENBQUMsU0FBUyxHQUFHLGNBQU0sQ0FBQyxPQUFPLENBQUM7UUFDL0IsR0FBRyxDQUFDLFFBQVEsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMzQixHQUFHLENBQUMsU0FBUyxHQUFHLGNBQU0sQ0FBQyxLQUFLLENBQUM7UUFDN0IsR0FBRyxDQUFDLFlBQVksR0FBRyxRQUFRLENBQUM7UUFDNUIsR0FBRyxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDakMsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ2xCLENBQUM7Q0FDSjtBQTdtQkQsNEJBNm1CQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ2FudmFzIHZpZXcgb2YgdGhlIHRleHR1cmUsIG1vZGVsbGVkIG9uIFVuaXR5J3MgU3ByaXRlIEVkaXRvcjpcbiAqIC0gZHJhZyBvbiBlbXB0eSBzcGFjZSB0byBjcmVhdGUgYSBzcHJpdGUgcmVjdCwgY2xpY2sgdG8gc2VsZWN0LCBkcmFnIHRvIG1vdmVcbiAqIC0gY29ybmVyIC8gZWRnZSBoYW5kbGVzIHJlc2l6ZSwgdGhlIGlubmVyIHNpZGUgb2YgYW4gZWRnZSBkcmFncyB0aGUgOS1zbGljZSBib3JkZXJcbiAqIC0gdGhlIGJsdWUgZGlzYyBpcyB0aGUgcGl2b3QgKEN0cmwgc25hcHMgdG8gMCAvIDAuNSAvIDEpXG4gKiAtIHdoZWVsIHpvb21zLCBtaWRkbGUgLyByaWdodCBtb3VzZSwgQWx0K2RyYWcgb3IgU3BhY2UrZHJhZyBwYW5zXG4gKi9cbmltcG9ydCB7IEJveCwgU3ByaXRlUmVjdCB9IGZyb20gJy4uLy4uL2NvcmUvdHlwZXMnO1xuaW1wb3J0IHsgU3RvcmUgfSBmcm9tICcuL3N0b3JlJztcblxudHlwZSBIYW5kbGUgPSAnbicgfCAncycgfCAnZScgfCAndycgfCAnbmUnIHwgJ253JyB8ICdzZScgfCAnc3cnO1xudHlwZSBTaWRlID0gJ0wnIHwgJ1InIHwgJ1QnIHwgJ0InO1xuXG50eXBlIEhpdCA9XG4gICAgfCB7IGtpbmQ6ICdwaXZvdCc7IHJlY3Q6IFNwcml0ZVJlY3QgfVxuICAgIHwgeyBraW5kOiAncmVzaXplJzsgcmVjdDogU3ByaXRlUmVjdDsgaGFuZGxlOiBIYW5kbGUgfVxuICAgIHwgeyBraW5kOiAnYm9yZGVyJzsgcmVjdDogU3ByaXRlUmVjdDsgc2lkZTogU2lkZSB9XG4gICAgfCB7IGtpbmQ6ICdyZWN0JzsgcmVjdDogU3ByaXRlUmVjdCB9XG4gICAgfCB7IGtpbmQ6ICdlbXB0eScgfTtcblxudHlwZSBEcmFnID1cbiAgICB8IHsga2luZDogJ3Bhbic7IHN4OiBudW1iZXI7IHN5OiBudW1iZXI7IHBhblg6IG51bWJlcjsgcGFuWTogbnVtYmVyIH1cbiAgICB8IHsga2luZDogJ2NyZWF0ZSc7IGl4OiBudW1iZXI7IGl5OiBudW1iZXI7IGN4OiBudW1iZXI7IGN5OiBudW1iZXI7IHN4OiBudW1iZXI7IHN5OiBudW1iZXI7IG1vdmVkOiBib29sZWFuIH1cbiAgICB8IHsga2luZDogJ21vdmUnOyBpeDogbnVtYmVyOyBpeTogbnVtYmVyOyBvcmlnaW46IHsgaWQ6IG51bWJlcjsgeDogbnVtYmVyOyB5OiBudW1iZXIgfVtdOyBib3VuZHM6IEJveCB9XG4gICAgfCB7IGtpbmQ6ICdyZXNpemUnOyByZWN0OiBTcHJpdGVSZWN0OyBoYW5kbGU6IEhhbmRsZTsgb3JpZ2luOiBCb3ggfVxuICAgIHwgeyBraW5kOiAncGl2b3QnOyByZWN0OiBTcHJpdGVSZWN0IH1cbiAgICB8IHsga2luZDogJ2JvcmRlcic7IHJlY3Q6IFNwcml0ZVJlY3Q7IHNpZGU6IFNpZGUgfTtcblxuZXhwb3J0IGNvbnN0IENPTE9SUyA9IHtcbiAgICBiYWNrZ3JvdW5kOiAnIzIzMjMyMycsXG4gICAgY2hlY2tlckE6ICcjNGE0YTRhJyxcbiAgICBjaGVja2VyQjogJyMzZDNkM2QnLFxuICAgIHRleHR1cmVFZGdlOiAncmdiYSgwLDAsMCwwLjYpJyxcbiAgICByZWN0OiAncmdiYSgyNTUsMjU1LDI1NSwwLjYyKScsXG4gICAgcmVjdEhvdmVyOiAncmdiYSgyNTUsMjU1LDI1NSwwLjk1KScsXG4gICAgc2VsZWN0ZWQ6ICcjNGE5ZmY1JyxcbiAgICBzZWxlY3RlZEZpbGw6ICdyZ2JhKDc0LDE1OSwyNDUsMC4xMCknLFxuICAgIGhhbmRsZUVkZ2U6ICcjMGUyNDQwJyxcbiAgICBib3JkZXI6ICcjMzhkMjRhJyxcbiAgICBwaXZvdFJpbmc6ICcjZmZmZmZmJyxcbiAgICBwcmV2aWV3OiAncmdiYSgyNTUsMTk2LDY0LDAuNzUpJyxcbiAgICBjcmVhdGluZzogJyNmZmZmZmYnLFxuICAgIHBpeGVsR3JpZDogJ3JnYmEoMCwwLDAsMC4yMiknLFxuICAgIGxhYmVsOiAnI2U4ZThlOCcsXG4gICAgbGFiZWxCZzogJ3JnYmEoMjAsMjAsMjAsMC44MiknLFxufTtcblxuY29uc3QgSEFORExFID0gNztcbmNvbnN0IEhJVCA9IDY7XG5jb25zdCBNSU5fWk9PTSA9IDAuMDM7XG5jb25zdCBNQVhfWk9PTSA9IDY0O1xuXG5leHBvcnQgY2xhc3MgVmlld3BvcnQge1xuICAgIHpvb20gPSAxO1xuICAgIHBhblggPSAwO1xuICAgIHBhblkgPSAwO1xuXG4gICAgcHJpdmF0ZSBjdHg6IENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRDtcbiAgICBwcml2YXRlIHJhZiA9IDA7XG4gICAgcHJpdmF0ZSBjaGVja2VyOiBDYW52YXNQYXR0ZXJuIHwgbnVsbCA9IG51bGw7XG4gICAgcHJpdmF0ZSBob3ZlcjogSGl0ID0geyBraW5kOiAnZW1wdHknIH07XG4gICAgcHJpdmF0ZSBkcmFnOiBEcmFnIHwgbnVsbCA9IG51bGw7XG4gICAgcHJpdmF0ZSBzcGFjZSA9IGZhbHNlO1xuICAgIHByaXZhdGUgY3NzVyA9IDA7XG4gICAgcHJpdmF0ZSBjc3NIID0gMDtcbiAgICBwcml2YXRlIHJlc2l6ZU9ic2VydmVyOiBSZXNpemVPYnNlcnZlcjtcbiAgICBwcml2YXRlIGRpc3Bvc2VyczogKCgpID0+IHZvaWQpW10gPSBbXTtcbiAgICBwcml2YXRlIG1vdXNlOiB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0gfCBudWxsID0gbnVsbDtcblxuICAgIGNvbnN0cnVjdG9yKHByaXZhdGUgY2FudmFzOiBIVE1MQ2FudmFzRWxlbWVudCwgcHJpdmF0ZSBzdG9yZTogU3RvcmUpIHtcbiAgICAgICAgdGhpcy5jdHggPSBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKSE7XG4gICAgICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4gdGhpcy5pbnZhbGlkYXRlKCkpO1xuICAgICAgICB0aGlzLnJlc2l6ZU9ic2VydmVyLm9ic2VydmUoY2FudmFzKTtcblxuICAgICAgICBjb25zdCBvbiA9IDxLIGV4dGVuZHMga2V5b2YgSFRNTEVsZW1lbnRFdmVudE1hcD4oZWw6IEhUTUxFbGVtZW50LCB0eXBlOiBLLCBmbjogKGU6IEhUTUxFbGVtZW50RXZlbnRNYXBbS10pID0+IHZvaWQsIG9wdHM/OiBBZGRFdmVudExpc3RlbmVyT3B0aW9ucykgPT4ge1xuICAgICAgICAgICAgZWwuYWRkRXZlbnRMaXN0ZW5lcih0eXBlLCBmbiBhcyBFdmVudExpc3RlbmVyLCBvcHRzKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goKCkgPT4gZWwucmVtb3ZlRXZlbnRMaXN0ZW5lcih0eXBlLCBmbiBhcyBFdmVudExpc3RlbmVyLCBvcHRzKSk7XG4gICAgICAgIH07XG4gICAgICAgIG9uKGNhbnZhcywgJ21vdXNlZG93bicsIChlKSA9PiB0aGlzLm9uRG93bihlKSk7XG4gICAgICAgIG9uKGNhbnZhcywgJ21vdXNlbW92ZScsIChlKSA9PiB7XG4gICAgICAgICAgICBpZiAoIXRoaXMuZHJhZykgdGhpcy5vbkhvdmVyKGUpO1xuICAgICAgICB9KTtcbiAgICAgICAgb24oY2FudmFzLCAnbW91c2VsZWF2ZScsICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMubW91c2UgPSBudWxsO1xuICAgICAgICAgICAgaWYgKCF0aGlzLmRyYWcgJiYgdGhpcy5ob3Zlci5raW5kICE9PSAnZW1wdHknKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5ob3ZlciA9IHsga2luZDogJ2VtcHR5JyB9O1xuICAgICAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgb24oY2FudmFzLCAnd2hlZWwnLCAoZSkgPT4gdGhpcy5vbldoZWVsKGUpLCB7IHBhc3NpdmU6IGZhbHNlIH0pO1xuICAgICAgICBvbihjYW52YXMsICdjb250ZXh0bWVudScsIChlKSA9PiBlLnByZXZlbnREZWZhdWx0KCkpO1xuICAgICAgICBvbihjYW52YXMsICdhdXhjbGljaycsIChlKSA9PiBlLnByZXZlbnREZWZhdWx0KCkpO1xuXG4gICAgICAgIHRoaXMuZGlzcG9zZXJzLnB1c2goc3RvcmUub25DaGFuZ2UoKCkgPT4gdGhpcy5pbnZhbGlkYXRlKCkpKTtcbiAgICAgICAgdGhpcy5kaXNwb3NlcnMucHVzaChzdG9yZS5vbkxvYWRlZCgoKSA9PiB0aGlzLmZpdCgpKSk7XG4gICAgfVxuXG4gICAgZGVzdHJveSgpIHtcbiAgICAgICAgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5yYWYpO1xuICAgICAgICB0aGlzLnJlc2l6ZU9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcbiAgICAgICAgdGhpcy5lbmRXaW5kb3dEcmFnKCk7XG4gICAgICAgIHRoaXMuZGlzcG9zZXJzLmZvckVhY2goKGZuKSA9PiBmbigpKTtcbiAgICAgICAgdGhpcy5kaXNwb3NlcnMgPSBbXTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gdmlld1xuXG4gICAgaW52YWxpZGF0ZSgpIHtcbiAgICAgICAgaWYgKHRoaXMucmFmKSByZXR1cm47XG4gICAgICAgIHRoaXMucmFmID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmFmID0gMDtcbiAgICAgICAgICAgIHRoaXMucmVuZGVyKCk7XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIHByaXZhdGUgc2l6ZSgpIHtcbiAgICAgICAgY29uc3QgciA9IHRoaXMuY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4geyB3OiByLndpZHRoLCBoOiByLmhlaWdodCB9O1xuICAgIH1cblxuICAgIGZpdCgpIHtcbiAgICAgICAgY29uc3QgeyB3aWR0aCwgaGVpZ2h0IH0gPSB0aGlzLnN0b3JlLnN0YXRlO1xuICAgICAgICBjb25zdCB7IHcsIGggfSA9IHRoaXMuc2l6ZSgpO1xuICAgICAgICBpZiAoIXdpZHRoIHx8ICFoZWlnaHQgfHwgIXcgfHwgIWgpIHtcbiAgICAgICAgICAgIHRoaXMuaW52YWxpZGF0ZSgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHBhZCA9IDQwO1xuICAgICAgICBjb25zdCB6ID0gTWF0aC5taW4oKHcgLSBwYWQpIC8gd2lkdGgsIChoIC0gcGFkKSAvIGhlaWdodCk7XG4gICAgICAgIHRoaXMuem9vbSA9IE1hdGgubWF4KE1JTl9aT09NLCBNYXRoLm1pbihNQVhfWk9PTSwgeiA+IDEgPyBNYXRoLmZsb29yKHopIDogeikpO1xuICAgICAgICB0aGlzLnBhblggPSBNYXRoLnJvdW5kKCh3IC0gd2lkdGggKiB0aGlzLnpvb20pIC8gMik7XG4gICAgICAgIHRoaXMucGFuWSA9IE1hdGgucm91bmQoKGggLSBoZWlnaHQgKiB0aGlzLnpvb20pIC8gMik7XG4gICAgICAgIHRoaXMuc3RvcmUuc3RhdGUuem9vbSA9IHRoaXMuem9vbTtcbiAgICAgICAgdGhpcy5pbnZhbGlkYXRlKCk7XG4gICAgfVxuXG4gICAgLyoqIFpvb20ga2VlcGluZyB0aGUgaW1hZ2UgcG9pbnQgdW5kZXIgKGN4LCBjeSkgZml4ZWQ7IGRlZmF1bHRzIHRvIHRoZSB2aWV3IGNlbnRyZS4gKi9cbiAgICBzZXRab29tKHo6IG51bWJlciwgY3g/OiBudW1iZXIsIGN5PzogbnVtYmVyKSB7XG4gICAgICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5zaXplKCk7XG4gICAgICAgIGNvbnN0IHggPSBjeCA/PyB3IC8gMjtcbiAgICAgICAgY29uc3QgeSA9IGN5ID8/IGggLyAyO1xuICAgICAgICBjb25zdCBpeCA9ICh4IC0gdGhpcy5wYW5YKSAvIHRoaXMuem9vbTtcbiAgICAgICAgY29uc3QgaXkgPSAoeSAtIHRoaXMucGFuWSkgLyB0aGlzLnpvb207XG4gICAgICAgIHRoaXMuem9vbSA9IE1hdGgubWF4KE1JTl9aT09NLCBNYXRoLm1pbihNQVhfWk9PTSwgeikpO1xuICAgICAgICB0aGlzLnBhblggPSB4IC0gaXggKiB0aGlzLnpvb207XG4gICAgICAgIHRoaXMucGFuWSA9IHkgLSBpeSAqIHRoaXMuem9vbTtcbiAgICAgICAgdGhpcy5zdG9yZS5zdGF0ZS56b29tID0gdGhpcy56b29tO1xuICAgICAgICB0aGlzLmludmFsaWRhdGUoKTtcbiAgICB9XG5cbiAgICBmcmFtZVNlbGVjdGlvbigpIHtcbiAgICAgICAgY29uc3Qgc2VsID0gdGhpcy5zdG9yZS5zZWxlY3RlZFJlY3RzLnZhbHVlO1xuICAgICAgICBpZiAoIXNlbC5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuZml0KCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgeDAgPSBNYXRoLm1pbiguLi5zZWwubWFwKChyKSA9PiByLngpKTtcbiAgICAgICAgY29uc3QgeTAgPSBNYXRoLm1pbiguLi5zZWwubWFwKChyKSA9PiByLnkpKTtcbiAgICAgICAgY29uc3QgeDEgPSBNYXRoLm1heCguLi5zZWwubWFwKChyKSA9PiByLnggKyByLncpKTtcbiAgICAgICAgY29uc3QgeTEgPSBNYXRoLm1heCguLi5zZWwubWFwKChyKSA9PiByLnkgKyByLmgpKTtcbiAgICAgICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzLnNpemUoKTtcbiAgICAgICAgY29uc3QgeiA9IE1hdGgubWluKCh3IC0gODApIC8gKHgxIC0geDApLCAoaCAtIDgwKSAvICh5MSAtIHkwKSwgTUFYX1pPT00pO1xuICAgICAgICB0aGlzLnpvb20gPSBNYXRoLm1heChNSU5fWk9PTSwgeik7XG4gICAgICAgIHRoaXMucGFuWCA9IHcgLyAyIC0gKCh4MCArIHgxKSAvIDIpICogdGhpcy56b29tO1xuICAgICAgICB0aGlzLnBhblkgPSBoIC8gMiAtICgoeTAgKyB5MSkgLyAyKSAqIHRoaXMuem9vbTtcbiAgICAgICAgdGhpcy5zdG9yZS5zdGF0ZS56b29tID0gdGhpcy56b29tO1xuICAgICAgICB0aGlzLmludmFsaWRhdGUoKTtcbiAgICB9XG5cbiAgICBzZXRTcGFjZShkb3duOiBib29sZWFuKSB7XG4gICAgICAgIGlmICh0aGlzLnNwYWNlID09PSBkb3duKSByZXR1cm47XG4gICAgICAgIHRoaXMuc3BhY2UgPSBkb3duO1xuICAgICAgICB0aGlzLnVwZGF0ZUN1cnNvcigpO1xuICAgIH1cblxuICAgIHByaXZhdGUgdG9JbWFnZShzeDogbnVtYmVyLCBzeTogbnVtYmVyKSB7XG4gICAgICAgIHJldHVybiB7IHg6IChzeCAtIHRoaXMucGFuWCkgLyB0aGlzLnpvb20sIHk6IChzeSAtIHRoaXMucGFuWSkgLyB0aGlzLnpvb20gfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGV2ZW50UG9zKGU6IE1vdXNlRXZlbnQpIHtcbiAgICAgICAgY29uc3QgciA9IHRoaXMuY2FudmFzLmdldEJvdW5kaW5nQ2xpZW50UmVjdCgpO1xuICAgICAgICByZXR1cm4geyB4OiBlLmNsaWVudFggLSByLmxlZnQsIHk6IGUuY2xpZW50WSAtIHIudG9wIH07XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gaW5wdXRcblxuICAgIHByaXZhdGUgb25XaGVlbChlOiBXaGVlbEV2ZW50KSB7XG4gICAgICAgIGlmICghdGhpcy5zdG9yZS5zdGF0ZS50ZXh0dXJlKSByZXR1cm47XG4gICAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgcCA9IHRoaXMuZXZlbnRQb3MoZSk7XG4gICAgICAgIGNvbnN0IHN0ZXAgPSBlLmN0cmxLZXkgPyAxLjA0IDogMS4xNTtcbiAgICAgICAgY29uc3QgZmFjdG9yID0gZS5kZWx0YVkgPCAwID8gc3RlcCA6IDEgLyBzdGVwO1xuICAgICAgICB0aGlzLnNldFpvb20odGhpcy56b29tICogZmFjdG9yLCBwLngsIHAueSk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBoaXRUZXN0KGl4OiBudW1iZXIsIGl5OiBudW1iZXIpOiBIaXQge1xuICAgICAgICBjb25zdCBzdG9yZSA9IHRoaXMuc3RvcmU7XG4gICAgICAgIGNvbnN0IHRvbCA9IEhJVCAvIHRoaXMuem9vbTtcbiAgICAgICAgY29uc3Qgb25lID0gc3RvcmUuc2luZ2xlLnZhbHVlO1xuICAgICAgICBjb25zdCByZWFkT25seSA9ICEhc3RvcmUuc3RhdGUucmVhZE9ubHk7XG5cbiAgICAgICAgaWYgKG9uZSAmJiAhcmVhZE9ubHkpIHtcbiAgICAgICAgICAgIGNvbnN0IHIgPSBvbmU7XG4gICAgICAgICAgICBjb25zdCBweCA9IHIueCArIHIucGl2b3RYICogci53O1xuICAgICAgICAgICAgY29uc3QgcHkgPSByLnkgKyAoMSAtIHIucGl2b3RZKSAqIHIuaDtcbiAgICAgICAgICAgIGlmIChNYXRoLmh5cG90KGl4IC0gcHgsIGl5IC0gcHkpIDw9IChISVQgKyAxKSAvIHRoaXMuem9vbSkgcmV0dXJuIHsga2luZDogJ3Bpdm90JywgcmVjdDogciB9O1xuXG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtoYW5kbGUsIGh4LCBoeV0gb2YgdGhpcy5oYW5kbGVzKHIpKSB7XG4gICAgICAgICAgICAgICAgaWYgKE1hdGguYWJzKGl4IC0gaHgpIDw9IHRvbCAmJiBNYXRoLmFicyhpeSAtIGh5KSA8PSB0b2wpIHJldHVybiB7IGtpbmQ6ICdyZXNpemUnLCByZWN0OiByLCBoYW5kbGUgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgY29uc3QgaW5YID0gaXggPj0gci54IC0gdG9sICYmIGl4IDw9IHIueCArIHIudyArIHRvbDtcbiAgICAgICAgICAgIGNvbnN0IGluWSA9IGl5ID49IHIueSAtIHRvbCAmJiBpeSA8PSByLnkgKyByLmggKyB0b2w7XG4gICAgICAgICAgICAvLyBPbiB0aW55IHJlY3RzIHRoZSBpbm5lciBiYW5kIHdvdWxkIGNvdmVyIGV2ZXJ5dGhpbmc7IGtlZXAgdGhlbSBtb3ZhYmxlLlxuICAgICAgICAgICAgY29uc3QgYmFuZFggPSByLncgKiB0aGlzLnpvb20gPiBISVQgKiA0O1xuICAgICAgICAgICAgY29uc3QgYmFuZFkgPSByLmggKiB0aGlzLnpvb20gPiBISVQgKiA0O1xuICAgICAgICAgICAgaWYgKGluWSAmJiBpeSA+IHIueSAmJiBpeSA8IHIueSArIHIuaCkge1xuICAgICAgICAgICAgICAgIC8vIElubmVyIGJhbmQgKG9yIGFuIGV4aXN0aW5nIGJvcmRlciBsaW5lKSAtPiBib3JkZXIsIG91dGVyIGJhbmQgLT4gcmVzaXplLlxuICAgICAgICAgICAgICAgIGNvbnN0IGx4ID0gci54ICsgci5ib3JkZXJMO1xuICAgICAgICAgICAgICAgIGNvbnN0IHJ4ID0gci54ICsgci53IC0gci5ib3JkZXJSO1xuICAgICAgICAgICAgICAgIGlmIChyLmJvcmRlckwgPiAwID8gTWF0aC5hYnMoaXggLSBseCkgPD0gdG9sIDogYmFuZFggJiYgaXggPj0gci54ICYmIGl4IC0gci54IDw9IHRvbCkgcmV0dXJuIHsga2luZDogJ2JvcmRlcicsIHJlY3Q6IHIsIHNpZGU6ICdMJyB9O1xuICAgICAgICAgICAgICAgIGlmIChyLmJvcmRlclIgPiAwID8gTWF0aC5hYnMoaXggLSByeCkgPD0gdG9sIDogYmFuZFggJiYgaXggPD0gci54ICsgci53ICYmIHIueCArIHIudyAtIGl4IDw9IHRvbCkgcmV0dXJuIHsga2luZDogJ2JvcmRlcicsIHJlY3Q6IHIsIHNpZGU6ICdSJyB9O1xuICAgICAgICAgICAgICAgIGlmIChpeCA8IHIueCAmJiByLnggLSBpeCA8PSB0b2wpIHJldHVybiB7IGtpbmQ6ICdyZXNpemUnLCByZWN0OiByLCBoYW5kbGU6ICd3JyB9O1xuICAgICAgICAgICAgICAgIGlmIChpeCA+IHIueCArIHIudyAmJiBpeCAtIChyLnggKyByLncpIDw9IHRvbCkgcmV0dXJuIHsga2luZDogJ3Jlc2l6ZScsIHJlY3Q6IHIsIGhhbmRsZTogJ2UnIH07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaW5YICYmIGl4ID4gci54ICYmIGl4IDwgci54ICsgci53KSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHkgPSByLnkgKyByLmJvcmRlclQ7XG4gICAgICAgICAgICAgICAgY29uc3QgYnkgPSByLnkgKyByLmggLSByLmJvcmRlckI7XG4gICAgICAgICAgICAgICAgaWYgKHIuYm9yZGVyVCA+IDAgPyBNYXRoLmFicyhpeSAtIHR5KSA8PSB0b2wgOiBiYW5kWSAmJiBpeSA+PSByLnkgJiYgaXkgLSByLnkgPD0gdG9sKSByZXR1cm4geyBraW5kOiAnYm9yZGVyJywgcmVjdDogciwgc2lkZTogJ1QnIH07XG4gICAgICAgICAgICAgICAgaWYgKHIuYm9yZGVyQiA+IDAgPyBNYXRoLmFicyhpeSAtIGJ5KSA8PSB0b2wgOiBiYW5kWSAmJiBpeSA8PSByLnkgKyByLmggJiYgci55ICsgci5oIC0gaXkgPD0gdG9sKSByZXR1cm4geyBraW5kOiAnYm9yZGVyJywgcmVjdDogciwgc2lkZTogJ0InIH07XG4gICAgICAgICAgICAgICAgaWYgKGl5IDwgci55ICYmIHIueSAtIGl5IDw9IHRvbCkgcmV0dXJuIHsga2luZDogJ3Jlc2l6ZScsIHJlY3Q6IHIsIGhhbmRsZTogJ24nIH07XG4gICAgICAgICAgICAgICAgaWYgKGl5ID4gci55ICsgci5oICYmIGl5IC0gKHIueSArIHIuaCkgPD0gdG9sKSByZXR1cm4geyBraW5kOiAncmVzaXplJywgcmVjdDogciwgaGFuZGxlOiAncycgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIFByZWZlciBhbiBhbHJlYWR5LXNlbGVjdGVkIHJlY3QgdW5kZXIgdGhlIGN1cnNvciwgdGhlbiB0aGUgc21hbGxlc3Qgb25lLlxuICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RvcmUuc3RhdGUuc2VsZWN0ZWQpO1xuICAgICAgICBsZXQgYmVzdDogU3ByaXRlUmVjdCB8IG51bGwgPSBudWxsO1xuICAgICAgICBsZXQgYmVzdEFyZWEgPSBJbmZpbml0eTtcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHN0b3JlLnN0YXRlLnJlY3RzKSB7XG4gICAgICAgICAgICBpZiAoaXggPCByLnggfHwgaXkgPCByLnkgfHwgaXggPiByLnggKyByLncgfHwgaXkgPiByLnkgKyByLmgpIGNvbnRpbnVlO1xuICAgICAgICAgICAgaWYgKHNlbGVjdGVkLmhhcyhyLmlkKSkgcmV0dXJuIHsga2luZDogJ3JlY3QnLCByZWN0OiByIH07XG4gICAgICAgICAgICBjb25zdCBhID0gci53ICogci5oO1xuICAgICAgICAgICAgaWYgKGEgPCBiZXN0QXJlYSkge1xuICAgICAgICAgICAgICAgIGJlc3RBcmVhID0gYTtcbiAgICAgICAgICAgICAgICBiZXN0ID0gcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYmVzdCA/IHsga2luZDogJ3JlY3QnLCByZWN0OiBiZXN0IH0gOiB7IGtpbmQ6ICdlbXB0eScgfTtcbiAgICB9XG5cbiAgICBwcml2YXRlIGhhbmRsZXMocjogQm94KTogW0hhbmRsZSwgbnVtYmVyLCBudW1iZXJdW10ge1xuICAgICAgICBjb25zdCBjeCA9IHIueCArIHIudyAvIDI7XG4gICAgICAgIGNvbnN0IGN5ID0gci55ICsgci5oIC8gMjtcbiAgICAgICAgcmV0dXJuIFtcbiAgICAgICAgICAgIFsnbncnLCByLngsIHIueV0sIFsnbicsIGN4LCByLnldLCBbJ25lJywgci54ICsgci53LCByLnldLCBbJ2UnLCByLnggKyByLncsIGN5XSxcbiAgICAgICAgICAgIFsnc2UnLCByLnggKyByLncsIHIueSArIHIuaF0sIFsncycsIGN4LCByLnkgKyByLmhdLCBbJ3N3Jywgci54LCByLnkgKyByLmhdLCBbJ3cnLCByLngsIGN5XSxcbiAgICAgICAgXTtcbiAgICB9XG5cbiAgICBwcml2YXRlIG9uSG92ZXIoZTogTW91c2VFdmVudCkge1xuICAgICAgICBjb25zdCBwID0gdGhpcy5ldmVudFBvcyhlKTtcbiAgICAgICAgdGhpcy5tb3VzZSA9IHA7XG4gICAgICAgIGlmICghdGhpcy5zdG9yZS5zdGF0ZS50ZXh0dXJlKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGltID0gdGhpcy50b0ltYWdlKHAueCwgcC55KTtcbiAgICAgICAgY29uc3QgaGl0ID0gdGhpcy5oaXRUZXN0KGltLngsIGltLnkpO1xuICAgICAgICBjb25zdCBwcmV2ID0gdGhpcy5ob3ZlcjtcbiAgICAgICAgdGhpcy5ob3ZlciA9IGhpdDtcbiAgICAgICAgY29uc3Qga2V5ID0gKGg6IEhpdCkgPT4gaC5raW5kICsgKCdyZWN0JyBpbiBoID8gaC5yZWN0LmlkIDogJycpICsgKCdoYW5kbGUnIGluIGggPyBoLmhhbmRsZSA6ICcnKSArICgnc2lkZScgaW4gaCA/IGguc2lkZSA6ICcnKTtcbiAgICAgICAgaWYgKGtleShwcmV2KSAhPT0ga2V5KGhpdCkpIHRoaXMuaW52YWxpZGF0ZSgpO1xuICAgICAgICB0aGlzLnVwZGF0ZUN1cnNvcigpO1xuICAgIH1cblxuICAgIHByaXZhdGUgdXBkYXRlQ3Vyc29yKCkge1xuICAgICAgICBsZXQgY3Vyc29yID0gJ2RlZmF1bHQnO1xuICAgICAgICBjb25zdCBkID0gdGhpcy5kcmFnO1xuICAgICAgICBjb25zdCBoID0gdGhpcy5ob3ZlcjtcbiAgICAgICAgaWYgKGQgJiYgZC5raW5kID09PSAncGFuJykgY3Vyc29yID0gJ2dyYWJiaW5nJztcbiAgICAgICAgZWxzZSBpZiAodGhpcy5zcGFjZSAmJiAhZCkgY3Vyc29yID0gJ2dyYWInO1xuICAgICAgICBlbHNlIGlmIChkICYmIGQua2luZCA9PT0gJ2NyZWF0ZScpIGN1cnNvciA9ICdjcm9zc2hhaXInO1xuICAgICAgICBlbHNlIGlmIChkICYmIGQua2luZCA9PT0gJ21vdmUnKSBjdXJzb3IgPSAnbW92ZSc7XG4gICAgICAgIGVsc2UgaWYgKGgua2luZCA9PT0gJ3Bpdm90JykgY3Vyc29yID0gJ3BvaW50ZXInO1xuICAgICAgICBlbHNlIGlmIChoLmtpbmQgPT09ICdyZXNpemUnKSB7XG4gICAgICAgICAgICBjdXJzb3IgPSB7IG46ICducy1yZXNpemUnLCBzOiAnbnMtcmVzaXplJywgZTogJ2V3LXJlc2l6ZScsIHc6ICdldy1yZXNpemUnLCBudzogJ253c2UtcmVzaXplJywgc2U6ICdud3NlLXJlc2l6ZScsIG5lOiAnbmVzdy1yZXNpemUnLCBzdzogJ25lc3ctcmVzaXplJyB9W2guaGFuZGxlXTtcbiAgICAgICAgfSBlbHNlIGlmIChoLmtpbmQgPT09ICdib3JkZXInKSBjdXJzb3IgPSBoLnNpZGUgPT09ICdMJyB8fCBoLnNpZGUgPT09ICdSJyA/ICdjb2wtcmVzaXplJyA6ICdyb3ctcmVzaXplJztcbiAgICAgICAgZWxzZSBpZiAoaC5raW5kID09PSAncmVjdCcgJiYgdGhpcy5zdG9yZS5zdGF0ZS5zZWxlY3RlZC5pbmNsdWRlcyhoLnJlY3QuaWQpICYmICF0aGlzLnN0b3JlLnN0YXRlLnJlYWRPbmx5KSBjdXJzb3IgPSAnbW92ZSc7XG4gICAgICAgIGVsc2UgaWYgKHRoaXMuc3RvcmUuc3RhdGUudGV4dHVyZSAmJiAhdGhpcy5zdG9yZS5zdGF0ZS5yZWFkT25seSkgY3Vyc29yID0gJ2Nyb3NzaGFpcic7XG4gICAgICAgIHRoaXMuY2FudmFzLnN0eWxlLmN1cnNvciA9IGN1cnNvcjtcbiAgICB9XG5cbiAgICBwcml2YXRlIG9uRG93bihlOiBNb3VzZUV2ZW50KSB7XG4gICAgICAgIGNvbnN0IHN0b3JlID0gdGhpcy5zdG9yZTtcbiAgICAgICAgaWYgKCFzdG9yZS5zdGF0ZS50ZXh0dXJlKSByZXR1cm47XG4gICAgICAgIGNvbnN0IHAgPSB0aGlzLmV2ZW50UG9zKGUpO1xuICAgICAgICBjb25zdCBpbSA9IHRoaXMudG9JbWFnZShwLngsIHAueSk7XG4gICAgICAgIHN0b3JlLnN0YXRlLnNsaWNlT3BlbiA9IGZhbHNlO1xuXG4gICAgICAgIGlmIChlLmJ1dHRvbiA9PT0gMSB8fCBlLmJ1dHRvbiA9PT0gMiB8fCAoZS5idXR0b24gPT09IDAgJiYgKGUuYWx0S2V5IHx8IHRoaXMuc3BhY2UpKSkge1xuICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgdGhpcy5kcmFnID0geyBraW5kOiAncGFuJywgc3g6IHAueCwgc3k6IHAueSwgcGFuWDogdGhpcy5wYW5YLCBwYW5ZOiB0aGlzLnBhblkgfTtcbiAgICAgICAgICAgIHRoaXMuYmVnaW5XaW5kb3dEcmFnKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGUuYnV0dG9uICE9PSAwKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgaGl0ID0gdGhpcy5oaXRUZXN0KGltLngsIGltLnkpO1xuICAgICAgICBjb25zdCByZWFkT25seSA9ICEhc3RvcmUuc3RhdGUucmVhZE9ubHk7XG4gICAgICAgIGNvbnN0IGFkZGl0aXZlID0gZS5zaGlmdEtleSB8fCBlLmN0cmxLZXkgfHwgZS5tZXRhS2V5O1xuXG4gICAgICAgIGlmIChoaXQua2luZCA9PT0gJ3Bpdm90JyB8fCBoaXQua2luZCA9PT0gJ3Jlc2l6ZScgfHwgaGl0LmtpbmQgPT09ICdib3JkZXInKSB7XG4gICAgICAgICAgICBzdG9yZS5zbmFwc2hvdCgpO1xuICAgICAgICAgICAgaWYgKGhpdC5raW5kID09PSAncGl2b3QnKSB0aGlzLmRyYWcgPSB7IGtpbmQ6ICdwaXZvdCcsIHJlY3Q6IGhpdC5yZWN0IH07XG4gICAgICAgICAgICBlbHNlIGlmIChoaXQua2luZCA9PT0gJ2JvcmRlcicpIHRoaXMuZHJhZyA9IHsga2luZDogJ2JvcmRlcicsIHJlY3Q6IGhpdC5yZWN0LCBzaWRlOiBoaXQuc2lkZSB9O1xuICAgICAgICAgICAgZWxzZSB0aGlzLmRyYWcgPSB7IGtpbmQ6ICdyZXNpemUnLCByZWN0OiBoaXQucmVjdCwgaGFuZGxlOiBoaXQuaGFuZGxlLCBvcmlnaW46IHsgeDogaGl0LnJlY3QueCwgeTogaGl0LnJlY3QueSwgdzogaGl0LnJlY3QudywgaDogaGl0LnJlY3QuaCB9IH07XG4gICAgICAgICAgICB0aGlzLmJlZ2luV2luZG93RHJhZygpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGhpdC5raW5kID09PSAncmVjdCcpIHtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gaGl0LnJlY3QuaWQ7XG4gICAgICAgICAgICBpZiAoYWRkaXRpdmUpIHtcbiAgICAgICAgICAgICAgICBzdG9yZS5zZWxlY3QoW2lkXSwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCFzdG9yZS5zdGF0ZS5zZWxlY3RlZC5pbmNsdWRlcyhpZCkpIHN0b3JlLnNlbGVjdChbaWRdKTtcbiAgICAgICAgICAgIGlmIChyZWFkT25seSkgcmV0dXJuO1xuICAgICAgICAgICAgY29uc3Qgc2VsID0gc3RvcmUuc2VsZWN0ZWRSZWN0cy52YWx1ZTtcbiAgICAgICAgICAgIHN0b3JlLnNuYXBzaG90KCk7XG4gICAgICAgICAgICBjb25zdCB4MCA9IE1hdGgubWluKC4uLnNlbC5tYXAoKHIpID0+IHIueCkpO1xuICAgICAgICAgICAgY29uc3QgeTAgPSBNYXRoLm1pbiguLi5zZWwubWFwKChyKSA9PiByLnkpKTtcbiAgICAgICAgICAgIHRoaXMuZHJhZyA9IHtcbiAgICAgICAgICAgICAgICBraW5kOiAnbW92ZScsXG4gICAgICAgICAgICAgICAgaXg6IGltLngsXG4gICAgICAgICAgICAgICAgaXk6IGltLnksXG4gICAgICAgICAgICAgICAgb3JpZ2luOiBzZWwubWFwKChyKSA9PiAoeyBpZDogci5pZCwgeDogci54LCB5OiByLnkgfSkpLFxuICAgICAgICAgICAgICAgIGJvdW5kczoge1xuICAgICAgICAgICAgICAgICAgICB4OiB4MCxcbiAgICAgICAgICAgICAgICAgICAgeTogeTAsXG4gICAgICAgICAgICAgICAgICAgIHc6IE1hdGgubWF4KC4uLnNlbC5tYXAoKHIpID0+IHIueCArIHIudykpIC0geDAsXG4gICAgICAgICAgICAgICAgICAgIGg6IE1hdGgubWF4KC4uLnNlbC5tYXAoKHIpID0+IHIueSArIHIuaCkpIC0geTAsXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB0aGlzLmJlZ2luV2luZG93RHJhZygpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRW1wdHkgc3BhY2U6IGNsaWNrIGRlc2VsZWN0cywgZHJhZyBjcmVhdGVzIGEgbmV3IHJlY3QuXG4gICAgICAgIGlmICghYWRkaXRpdmUpIHN0b3JlLnNlbGVjdChbXSk7XG4gICAgICAgIGlmIChyZWFkT25seSkgcmV0dXJuO1xuICAgICAgICB0aGlzLmRyYWcgPSB7IGtpbmQ6ICdjcmVhdGUnLCBpeDogaW0ueCwgaXk6IGltLnksIGN4OiBpbS54LCBjeTogaW0ueSwgc3g6IHAueCwgc3k6IHAueSwgbW92ZWQ6IGZhbHNlIH07XG4gICAgICAgIHRoaXMuYmVnaW5XaW5kb3dEcmFnKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBvbldpbmRvd01vdmUgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICBjb25zdCBkID0gdGhpcy5kcmFnO1xuICAgICAgICBpZiAoIWQpIHJldHVybjtcbiAgICAgICAgY29uc3QgcCA9IHRoaXMuZXZlbnRQb3MoZSk7XG4gICAgICAgIHRoaXMubW91c2UgPSBwO1xuICAgICAgICBjb25zdCBpbSA9IHRoaXMudG9JbWFnZShwLngsIHAueSk7XG4gICAgICAgIGNvbnN0IHN0b3JlID0gdGhpcy5zdG9yZTtcbiAgICAgICAgY29uc3QgVyA9IHN0b3JlLnN0YXRlLndpZHRoO1xuICAgICAgICBjb25zdCBIID0gc3RvcmUuc3RhdGUuaGVpZ2h0O1xuXG4gICAgICAgIHN3aXRjaCAoZC5raW5kKSB7XG4gICAgICAgICAgICBjYXNlICdwYW4nOlxuICAgICAgICAgICAgICAgIHRoaXMucGFuWCA9IGQucGFuWCArIChwLnggLSBkLnN4KTtcbiAgICAgICAgICAgICAgICB0aGlzLnBhblkgPSBkLnBhblkgKyAocC55IC0gZC5zeSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlICdjcmVhdGUnOlxuICAgICAgICAgICAgICAgIGQuY3ggPSBpbS54O1xuICAgICAgICAgICAgICAgIGQuY3kgPSBpbS55O1xuICAgICAgICAgICAgICAgIGlmIChNYXRoLmFicyhwLnggLSBkLnN4KSA+IDMgfHwgTWF0aC5hYnMocC55IC0gZC5zeSkgPiAzKSBkLm1vdmVkID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgJ21vdmUnOiB7XG4gICAgICAgICAgICAgICAgbGV0IGR4ID0gTWF0aC5yb3VuZChpbS54IC0gZC5peCk7XG4gICAgICAgICAgICAgICAgbGV0IGR5ID0gTWF0aC5yb3VuZChpbS55IC0gZC5peSk7XG4gICAgICAgICAgICAgICAgZHggPSBNYXRoLm1heCgtZC5ib3VuZHMueCwgTWF0aC5taW4oVyAtIChkLmJvdW5kcy54ICsgZC5ib3VuZHMudyksIGR4KSk7XG4gICAgICAgICAgICAgICAgZHkgPSBNYXRoLm1heCgtZC5ib3VuZHMueSwgTWF0aC5taW4oSCAtIChkLmJvdW5kcy55ICsgZC5ib3VuZHMuaCksIGR5KSk7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBvIG9mIGQub3JpZ2luKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHIgPSBzdG9yZS5ieUlkKG8uaWQpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXIpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgICAgICByLnggPSBvLnggKyBkeDtcbiAgICAgICAgICAgICAgICAgICAgci55ID0gby55ICsgZHk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY2FzZSAncmVzaXplJzoge1xuICAgICAgICAgICAgICAgIGNvbnN0IG8gPSBkLm9yaWdpbjtcbiAgICAgICAgICAgICAgICBsZXQgeDAgPSBvLng7XG4gICAgICAgICAgICAgICAgbGV0IHkwID0gby55O1xuICAgICAgICAgICAgICAgIGxldCB4MSA9IG8ueCArIG8udztcbiAgICAgICAgICAgICAgICBsZXQgeTEgPSBvLnkgKyBvLmg7XG4gICAgICAgICAgICAgICAgY29uc3QgaXggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihXLCBNYXRoLnJvdW5kKGltLngpKSk7XG4gICAgICAgICAgICAgICAgY29uc3QgaXkgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihILCBNYXRoLnJvdW5kKGltLnkpKSk7XG4gICAgICAgICAgICAgICAgaWYgKGQuaGFuZGxlLmluY2x1ZGVzKCd3JykpIHgwID0gaXg7XG4gICAgICAgICAgICAgICAgaWYgKGQuaGFuZGxlLmluY2x1ZGVzKCdlJykpIHgxID0gaXg7XG4gICAgICAgICAgICAgICAgaWYgKGQuaGFuZGxlLmluY2x1ZGVzKCduJykpIHkwID0gaXk7XG4gICAgICAgICAgICAgICAgaWYgKGQuaGFuZGxlLmluY2x1ZGVzKCdzJykpIHkxID0gaXk7XG4gICAgICAgICAgICAgICAgY29uc3QgciA9IGQucmVjdDtcbiAgICAgICAgICAgICAgICByLnggPSBNYXRoLm1pbih4MCwgeDEpO1xuICAgICAgICAgICAgICAgIHIueSA9IE1hdGgubWluKHkwLCB5MSk7XG4gICAgICAgICAgICAgICAgci53ID0gTWF0aC5tYXgoMSwgTWF0aC5hYnMoeDEgLSB4MCkpO1xuICAgICAgICAgICAgICAgIHIuaCA9IE1hdGgubWF4KDEsIE1hdGguYWJzKHkxIC0geTApKTtcbiAgICAgICAgICAgICAgICBzdG9yZS5jbGFtcFJlY3Qocik7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjYXNlICdwaXZvdCc6IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gZC5yZWN0O1xuICAgICAgICAgICAgICAgIGxldCBweCA9IE1hdGgucm91bmQoaW0ueCAtIHIueCkgLyByLnc7XG4gICAgICAgICAgICAgICAgbGV0IHB5ID0gMSAtIE1hdGgucm91bmQoaW0ueSAtIHIueSkgLyByLmg7XG4gICAgICAgICAgICAgICAgaWYgKGUuY3RybEtleSB8fCBlLm1ldGFLZXkpIHtcbiAgICAgICAgICAgICAgICAgICAgcHggPSBNYXRoLnJvdW5kKHB4ICogMikgLyAyO1xuICAgICAgICAgICAgICAgICAgICBweSA9IE1hdGgucm91bmQocHkgKiAyKSAvIDI7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHIucGl2b3RYID0gTWF0aC5yb3VuZChNYXRoLm1heCgwLCBNYXRoLm1pbigxLCBweCkpICogMTAwMDApIC8gMTAwMDA7XG4gICAgICAgICAgICAgICAgci5waXZvdFkgPSBNYXRoLnJvdW5kKE1hdGgubWF4KDAsIE1hdGgubWluKDEsIHB5KSkgKiAxMDAwMCkgLyAxMDAwMDtcbiAgICAgICAgICAgICAgICBzdG9yZS5zdGF0ZS5jdXN0b21QaXZvdCA9IHN0b3JlLnN0YXRlLmN1c3RvbVBpdm90LmZpbHRlcigoaWQpID0+IGlkICE9PSByLmlkKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhc2UgJ2JvcmRlcic6IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gZC5yZWN0O1xuICAgICAgICAgICAgICAgIGlmIChkLnNpZGUgPT09ICdMJykgci5ib3JkZXJMID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oci53IC0gci5ib3JkZXJSLCBNYXRoLnJvdW5kKGltLnggLSByLngpKSk7XG4gICAgICAgICAgICAgICAgaWYgKGQuc2lkZSA9PT0gJ1InKSByLmJvcmRlclIgPSBNYXRoLm1heCgwLCBNYXRoLm1pbihyLncgLSByLmJvcmRlckwsIE1hdGgucm91bmQoci54ICsgci53IC0gaW0ueCkpKTtcbiAgICAgICAgICAgICAgICBpZiAoZC5zaWRlID09PSAnVCcpIHIuYm9yZGVyVCA9IE1hdGgubWF4KDAsIE1hdGgubWluKHIuaCAtIHIuYm9yZGVyQiwgTWF0aC5yb3VuZChpbS55IC0gci55KSkpO1xuICAgICAgICAgICAgICAgIGlmIChkLnNpZGUgPT09ICdCJykgci5ib3JkZXJCID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oci5oIC0gci5ib3JkZXJULCBNYXRoLnJvdW5kKHIueSArIHIuaCAtIGltLnkpKSk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy51cGRhdGVDdXJzb3IoKTtcbiAgICAgICAgdGhpcy5pbnZhbGlkYXRlKCk7XG4gICAgfTtcblxuICAgIHByaXZhdGUgb25XaW5kb3dVcCA9ICgpID0+IHtcbiAgICAgICAgY29uc3QgZCA9IHRoaXMuZHJhZztcbiAgICAgICAgdGhpcy5kcmFnID0gbnVsbDtcbiAgICAgICAgdGhpcy5lbmRXaW5kb3dEcmFnKCk7XG4gICAgICAgIGlmICghZCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBzdG9yZSA9IHRoaXMuc3RvcmU7XG4gICAgICAgIGlmIChkLmtpbmQgPT09ICdjcmVhdGUnKSB7XG4gICAgICAgICAgICBpZiAoZC5tb3ZlZCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHgwID0gTWF0aC5yb3VuZChNYXRoLm1pbihkLml4LCBkLmN4KSk7XG4gICAgICAgICAgICAgICAgY29uc3QgeTAgPSBNYXRoLnJvdW5kKE1hdGgubWluKGQuaXksIGQuY3kpKTtcbiAgICAgICAgICAgICAgICBjb25zdCB4MSA9IE1hdGgucm91bmQoTWF0aC5tYXgoZC5peCwgZC5jeCkpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHkxID0gTWF0aC5yb3VuZChNYXRoLm1heChkLml5LCBkLmN5KSk7XG4gICAgICAgICAgICAgICAgaWYgKHgxIC0geDAgPj0gMSAmJiB5MSAtIHkwID49IDEpIHN0b3JlLmFkZFJlY3QoeyB4OiB4MCwgeTogeTAsIHc6IHgxIC0geDAsIGg6IHkxIC0geTAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoZC5raW5kICE9PSAncGFuJykge1xuICAgICAgICAgICAgc3RvcmUuZGlzY2FyZFNuYXBzaG90SWZTYW1lKCk7XG4gICAgICAgICAgICBzdG9yZS5jaGFuZ2VkKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy51cGRhdGVDdXJzb3IoKTtcbiAgICAgICAgdGhpcy5pbnZhbGlkYXRlKCk7XG4gICAgfTtcblxuICAgIHByaXZhdGUgYmVnaW5XaW5kb3dEcmFnKCkge1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbldpbmRvd01vdmUsIHRydWUpO1xuICAgICAgICB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub25XaW5kb3dVcCwgdHJ1ZSk7XG4gICAgICAgIHRoaXMudXBkYXRlQ3Vyc29yKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBlbmRXaW5kb3dEcmFnKCkge1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgdGhpcy5vbldpbmRvd01vdmUsIHRydWUpO1xuICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIHRoaXMub25XaW5kb3dVcCwgdHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZW5kZXJcblxuICAgIHByaXZhdGUgZW5zdXJlQ2hlY2tlcigpIHtcbiAgICAgICAgaWYgKHRoaXMuY2hlY2tlcikgcmV0dXJuIHRoaXMuY2hlY2tlcjtcbiAgICAgICAgY29uc3QgYyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpO1xuICAgICAgICBjLndpZHRoID0gMTY7XG4gICAgICAgIGMuaGVpZ2h0ID0gMTY7XG4gICAgICAgIGNvbnN0IGcgPSBjLmdldENvbnRleHQoJzJkJykhO1xuICAgICAgICBnLmZpbGxTdHlsZSA9IENPTE9SUy5jaGVja2VyQTtcbiAgICAgICAgZy5maWxsUmVjdCgwLCAwLCAxNiwgMTYpO1xuICAgICAgICBnLmZpbGxTdHlsZSA9IENPTE9SUy5jaGVja2VyQjtcbiAgICAgICAgZy5maWxsUmVjdCgwLCAwLCA4LCA4KTtcbiAgICAgICAgZy5maWxsUmVjdCg4LCA4LCA4LCA4KTtcbiAgICAgICAgdGhpcy5jaGVja2VyID0gdGhpcy5jdHguY3JlYXRlUGF0dGVybihjLCAncmVwZWF0Jyk7XG4gICAgICAgIHJldHVybiB0aGlzLmNoZWNrZXI7XG4gICAgfVxuXG4gICAgLyoqIFNjcmVlbi1zcGFjZSByZWN0IHNuYXBwZWQgdG8gZGV2aWNlIHBpeGVscyBmb3IgY3Jpc3AgMXB4IHN0cm9rZXMuICovXG4gICAgcHJpdmF0ZSBzY3JlZW5SZWN0KGI6IEJveCkge1xuICAgICAgICBjb25zdCB4MCA9IE1hdGgucm91bmQodGhpcy5wYW5YICsgYi54ICogdGhpcy56b29tKTtcbiAgICAgICAgY29uc3QgeTAgPSBNYXRoLnJvdW5kKHRoaXMucGFuWSArIGIueSAqIHRoaXMuem9vbSk7XG4gICAgICAgIGNvbnN0IHgxID0gTWF0aC5yb3VuZCh0aGlzLnBhblggKyAoYi54ICsgYi53KSAqIHRoaXMuem9vbSk7XG4gICAgICAgIGNvbnN0IHkxID0gTWF0aC5yb3VuZCh0aGlzLnBhblkgKyAoYi55ICsgYi5oKSAqIHRoaXMuem9vbSk7XG4gICAgICAgIHJldHVybiB7IHg6IHgwLCB5OiB5MCwgdzogeDEgLSB4MCwgaDogeTEgLSB5MCB9O1xuICAgIH1cblxuICAgIHJlbmRlcigpIHtcbiAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5jdHg7XG4gICAgICAgIGNvbnN0IGRwciA9IHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG4gICAgICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5zaXplKCk7XG4gICAgICAgIGlmICghdyB8fCAhaCkgcmV0dXJuO1xuICAgICAgICBpZiAodGhpcy5jc3NXICE9PSB3IHx8IHRoaXMuY3NzSCAhPT0gaCB8fCB0aGlzLmNhbnZhcy53aWR0aCAhPT0gTWF0aC5yb3VuZCh3ICogZHByKSkge1xuICAgICAgICAgICAgY29uc3QgZmlyc3RTaXplID0gIXRoaXMuY3NzVztcbiAgICAgICAgICAgIHRoaXMuY3NzVyA9IHc7XG4gICAgICAgICAgICB0aGlzLmNzc0ggPSBoO1xuICAgICAgICAgICAgdGhpcy5jYW52YXMud2lkdGggPSBNYXRoLnJvdW5kKHcgKiBkcHIpO1xuICAgICAgICAgICAgdGhpcy5jYW52YXMuaGVpZ2h0ID0gTWF0aC5yb3VuZChoICogZHByKTtcbiAgICAgICAgICAgIGlmIChmaXJzdFNpemUgJiYgdGhpcy5zdG9yZS5zdGF0ZS50ZXh0dXJlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5maXQoKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgY3R4LnNldFRyYW5zZm9ybShkcHIsIDAsIDAsIGRwciwgMCwgMCk7XG4gICAgICAgIGN0eC5maWxsU3R5bGUgPSBDT0xPUlMuYmFja2dyb3VuZDtcbiAgICAgICAgY3R4LmZpbGxSZWN0KDAsIDAsIHcsIGgpO1xuXG4gICAgICAgIGNvbnN0IHN0b3JlID0gdGhpcy5zdG9yZTtcbiAgICAgICAgY29uc3QgeyB0ZXh0dXJlLCB3aWR0aCwgaGVpZ2h0IH0gPSBzdG9yZS5zdGF0ZTtcbiAgICAgICAgY29uc3QgaW1hZ2UgPSBzdG9yZS5zdGF0ZS5zaG93QWxwaGEgPyBzdG9yZS5hbHBoYUNhbnZhcygpIDogc3RvcmUucmF3LmltYWdlO1xuICAgICAgICBpZiAoIXRleHR1cmUgfHwgIWltYWdlKSByZXR1cm47XG5cbiAgICAgICAgY29uc3QgdGV4ID0gdGhpcy5zY3JlZW5SZWN0KHsgeDogMCwgeTogMCwgdzogd2lkdGgsIGg6IGhlaWdodCB9KTtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IHRoaXMuZW5zdXJlQ2hlY2tlcigpITtcbiAgICAgICAgY3R4LmZpbGxSZWN0KHRleC54LCB0ZXgueSwgdGV4LncsIHRleC5oKTtcbiAgICAgICAgY3R4LmltYWdlU21vb3RoaW5nRW5hYmxlZCA9IHRoaXMuem9vbSA8IDE7XG4gICAgICAgIGN0eC5kcmF3SW1hZ2UoaW1hZ2UsIHRleC54LCB0ZXgueSwgdGV4LncsIHRleC5oKTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gQ09MT1JTLnRleHR1cmVFZGdlO1xuICAgICAgICBjdHgubGluZVdpZHRoID0gMTtcbiAgICAgICAgY3R4LnN0cm9rZVJlY3QodGV4LnggLSAwLjUsIHRleC55IC0gMC41LCB0ZXgudyArIDEsIHRleC5oICsgMSk7XG5cbiAgICAgICAgaWYgKHRoaXMuem9vbSA+PSAxMikgdGhpcy5kcmF3UGl4ZWxHcmlkKHRleCk7XG5cbiAgICAgICAgaWYgKHN0b3JlLnN0YXRlLnNsaWNlT3BlbiAmJiBzdG9yZS5zdGF0ZS5zbGljZS50eXBlICE9PSAnYXV0bycpIHtcbiAgICAgICAgICAgIGN0eC5zYXZlKCk7XG4gICAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBDT0xPUlMucHJldmlldztcbiAgICAgICAgICAgIGN0eC5zZXRMaW5lRGFzaChbNCwgM10pO1xuICAgICAgICAgICAgZm9yIChjb25zdCBiIG9mIHN0b3JlLnNsaWNlQm94ZXModHJ1ZSkpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBzID0gdGhpcy5zY3JlZW5SZWN0KGIpO1xuICAgICAgICAgICAgICAgIGN0eC5zdHJva2VSZWN0KHMueCArIDAuNSwgcy55ICsgMC41LCBzLncgLSAxLCBzLmggLSAxKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGN0eC5yZXN0b3JlKCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzZWxlY3RlZCA9IG5ldyBTZXQoc3RvcmUuc3RhdGUuc2VsZWN0ZWQpO1xuICAgICAgICBjb25zdCBob3ZlcklkID0gdGhpcy5ob3Zlci5raW5kID09PSAncmVjdCcgPyB0aGlzLmhvdmVyLnJlY3QuaWQgOiAtMTtcbiAgICAgICAgY3R4LmxpbmVXaWR0aCA9IDE7XG4gICAgICAgIGZvciAoY29uc3QgciBvZiBzdG9yZS5zdGF0ZS5yZWN0cykge1xuICAgICAgICAgICAgaWYgKHNlbGVjdGVkLmhhcyhyLmlkKSkgY29udGludWU7XG4gICAgICAgICAgICBjb25zdCBzID0gdGhpcy5zY3JlZW5SZWN0KHIpO1xuICAgICAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gci5pZCA9PT0gaG92ZXJJZCA/IENPTE9SUy5yZWN0SG92ZXIgOiBDT0xPUlMucmVjdDtcbiAgICAgICAgICAgIGN0eC5zdHJva2VSZWN0KHMueCArIDAuNSwgcy55ICsgMC41LCBNYXRoLm1heCgwLCBzLncgLSAxKSwgTWF0aC5tYXgoMCwgcy5oIC0gMSkpO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgciBvZiBzdG9yZS5zZWxlY3RlZFJlY3RzLnZhbHVlKSB0aGlzLmRyYXdTZWxlY3RlZChyLCBzZWxlY3RlZC5zaXplID09PSAxKTtcblxuICAgICAgICBjb25zdCBkID0gdGhpcy5kcmFnO1xuICAgICAgICBpZiAoZCAmJiBkLmtpbmQgPT09ICdjcmVhdGUnICYmIGQubW92ZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IGJveCA9IHtcbiAgICAgICAgICAgICAgICB4OiBNYXRoLnJvdW5kKE1hdGgubWluKGQuaXgsIGQuY3gpKSxcbiAgICAgICAgICAgICAgICB5OiBNYXRoLnJvdW5kKE1hdGgubWluKGQuaXksIGQuY3kpKSxcbiAgICAgICAgICAgICAgICB3OiBNYXRoLnJvdW5kKE1hdGgubWF4KGQuaXgsIGQuY3gpKSAtIE1hdGgucm91bmQoTWF0aC5taW4oZC5peCwgZC5jeCkpLFxuICAgICAgICAgICAgICAgIGg6IE1hdGgucm91bmQoTWF0aC5tYXgoZC5peSwgZC5jeSkpIC0gTWF0aC5yb3VuZChNYXRoLm1pbihkLml5LCBkLmN5KSksXG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3QgcyA9IHRoaXMuc2NyZWVuUmVjdChib3gpO1xuICAgICAgICAgICAgY3R4LnNhdmUoKTtcbiAgICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IENPTE9SUy5jcmVhdGluZztcbiAgICAgICAgICAgIGN0eC5zZXRMaW5lRGFzaChbNCwgM10pO1xuICAgICAgICAgICAgY3R4LnN0cm9rZVJlY3Qocy54ICsgMC41LCBzLnkgKyAwLjUsIE1hdGgubWF4KDAsIHMudyAtIDEpLCBNYXRoLm1heCgwLCBzLmggLSAxKSk7XG4gICAgICAgICAgICBjdHgucmVzdG9yZSgpO1xuICAgICAgICAgICAgdGhpcy5kcmF3U2l6ZUxhYmVsKGJveCwgcyk7XG4gICAgICAgIH0gZWxzZSBpZiAoZCAmJiBkLmtpbmQgPT09ICdyZXNpemUnKSB7XG4gICAgICAgICAgICB0aGlzLmRyYXdTaXplTGFiZWwoZC5yZWN0LCB0aGlzLnNjcmVlblJlY3QoZC5yZWN0KSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBwcml2YXRlIGRyYXdQaXhlbEdyaWQodGV4OiBCb3gpIHtcbiAgICAgICAgY29uc3QgY3R4ID0gdGhpcy5jdHg7XG4gICAgICAgIGNvbnN0IHsgdywgaCB9ID0gdGhpcy5zaXplKCk7XG4gICAgICAgIGNvbnN0IHogPSB0aGlzLnpvb207XG4gICAgICAgIGNvbnN0IGl4MCA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoLXRoaXMucGFuWCAvIHopKTtcbiAgICAgICAgY29uc3QgaXkwID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcigtdGhpcy5wYW5ZIC8geikpO1xuICAgICAgICBjb25zdCBpeDEgPSBNYXRoLm1pbih0aGlzLnN0b3JlLnN0YXRlLndpZHRoLCBNYXRoLmNlaWwoKHcgLSB0aGlzLnBhblgpIC8geikpO1xuICAgICAgICBjb25zdCBpeTEgPSBNYXRoLm1pbih0aGlzLnN0b3JlLnN0YXRlLmhlaWdodCwgTWF0aC5jZWlsKChoIC0gdGhpcy5wYW5ZKSAvIHopKTtcbiAgICAgICAgY3R4LnNhdmUoKTtcbiAgICAgICAgY3R4LmJlZ2luUGF0aCgpO1xuICAgICAgICBmb3IgKGxldCB4ID0gaXgwOyB4IDw9IGl4MTsgeCsrKSB7XG4gICAgICAgICAgICBjb25zdCBzeCA9IE1hdGgucm91bmQodGhpcy5wYW5YICsgeCAqIHopICsgMC41O1xuICAgICAgICAgICAgY3R4Lm1vdmVUbyhzeCwgTWF0aC5tYXgodGV4LnksIDApKTtcbiAgICAgICAgICAgIGN0eC5saW5lVG8oc3gsIE1hdGgubWluKHRleC55ICsgdGV4LmgsIGgpKTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGxldCB5ID0gaXkwOyB5IDw9IGl5MTsgeSsrKSB7XG4gICAgICAgICAgICBjb25zdCBzeSA9IE1hdGgucm91bmQodGhpcy5wYW5ZICsgeSAqIHopICsgMC41O1xuICAgICAgICAgICAgY3R4Lm1vdmVUbyhNYXRoLm1heCh0ZXgueCwgMCksIHN5KTtcbiAgICAgICAgICAgIGN0eC5saW5lVG8oTWF0aC5taW4odGV4LnggKyB0ZXgudywgdyksIHN5KTtcbiAgICAgICAgfVxuICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBDT0xPUlMucGl4ZWxHcmlkO1xuICAgICAgICBjdHgubGluZVdpZHRoID0gMTtcbiAgICAgICAgY3R4LnN0cm9rZSgpO1xuICAgICAgICBjdHgucmVzdG9yZSgpO1xuICAgIH1cblxuICAgIHByaXZhdGUgZHJhd1NlbGVjdGVkKHI6IFNwcml0ZVJlY3QsIHdpdGhIYW5kbGVzOiBib29sZWFuKSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4O1xuICAgICAgICBjb25zdCBzID0gdGhpcy5zY3JlZW5SZWN0KHIpO1xuICAgICAgICBjdHguZmlsbFN0eWxlID0gQ09MT1JTLnNlbGVjdGVkRmlsbDtcbiAgICAgICAgY3R4LmZpbGxSZWN0KHMueCwgcy55LCBzLncsIHMuaCk7XG5cbiAgICAgICAgaWYgKHdpdGhIYW5kbGVzKSB7XG4gICAgICAgICAgICAvLyA5LXNsaWNlIGJvcmRlciBsaW5lcyAoZ3JlZW4pLCBkcmF3biBldmVuIGF0IDAgbGlrZSBVbml0eS5cbiAgICAgICAgICAgIGNvbnN0IGhvdmVyID0gdGhpcy5ob3Zlci5raW5kID09PSAnYm9yZGVyJyAmJiB0aGlzLmhvdmVyLnJlY3QuaWQgPT09IHIuaWQgPyB0aGlzLmhvdmVyLnNpZGUgOiBudWxsO1xuICAgICAgICAgICAgY29uc3QgYWN0aXZlID0gdGhpcy5kcmFnICYmIHRoaXMuZHJhZy5raW5kID09PSAnYm9yZGVyJyA/IHRoaXMuZHJhZy5zaWRlIDogbnVsbDtcbiAgICAgICAgICAgIGNvbnN0IGxpbmUgPSAoc2lkZTogU2lkZSwgeDA6IG51bWJlciwgeTA6IG51bWJlciwgeDE6IG51bWJlciwgeTE6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgICAgICAgICAgICBjdHgubW92ZVRvKHgwLCB5MCk7XG4gICAgICAgICAgICAgICAgY3R4LmxpbmVUbyh4MSwgeTEpO1xuICAgICAgICAgICAgICAgIGN0eC5saW5lV2lkdGggPSBzaWRlID09PSBob3ZlciB8fCBzaWRlID09PSBhY3RpdmUgPyAyIDogMTtcbiAgICAgICAgICAgICAgICBjdHguc3Ryb2tlKCk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY3R4LnNhdmUoKTtcbiAgICAgICAgICAgIGN0eC5zdHJva2VTdHlsZSA9IENPTE9SUy5ib3JkZXI7XG4gICAgICAgICAgICBjb25zdCBseCA9IE1hdGgucm91bmQodGhpcy5wYW5YICsgKHIueCArIHIuYm9yZGVyTCkgKiB0aGlzLnpvb20pICsgMC41O1xuICAgICAgICAgICAgY29uc3QgcnggPSBNYXRoLnJvdW5kKHRoaXMucGFuWCArIChyLnggKyByLncgLSByLmJvcmRlclIpICogdGhpcy56b29tKSAtIDAuNTtcbiAgICAgICAgICAgIGNvbnN0IHR5ID0gTWF0aC5yb3VuZCh0aGlzLnBhblkgKyAoci55ICsgci5ib3JkZXJUKSAqIHRoaXMuem9vbSkgKyAwLjU7XG4gICAgICAgICAgICBjb25zdCBieSA9IE1hdGgucm91bmQodGhpcy5wYW5ZICsgKHIueSArIHIuaCAtIHIuYm9yZGVyQikgKiB0aGlzLnpvb20pIC0gMC41O1xuICAgICAgICAgICAgaWYgKHIuYm9yZGVyTCB8fCBob3ZlciA9PT0gJ0wnKSBsaW5lKCdMJywgbHgsIHMueSwgbHgsIHMueSArIHMuaCk7XG4gICAgICAgICAgICBpZiAoci5ib3JkZXJSIHx8IGhvdmVyID09PSAnUicpIGxpbmUoJ1InLCByeCwgcy55LCByeCwgcy55ICsgcy5oKTtcbiAgICAgICAgICAgIGlmIChyLmJvcmRlclQgfHwgaG92ZXIgPT09ICdUJykgbGluZSgnVCcsIHMueCwgdHksIHMueCArIHMudywgdHkpO1xuICAgICAgICAgICAgaWYgKHIuYm9yZGVyQiB8fCBob3ZlciA9PT0gJ0InKSBsaW5lKCdCJywgcy54LCBieSwgcy54ICsgcy53LCBieSk7XG4gICAgICAgICAgICBjdHgucmVzdG9yZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gQ09MT1JTLnNlbGVjdGVkO1xuICAgICAgICBjdHgubGluZVdpZHRoID0gMTtcbiAgICAgICAgY3R4LnN0cm9rZVJlY3Qocy54ICsgMC41LCBzLnkgKyAwLjUsIE1hdGgubWF4KDAsIHMudyAtIDEpLCBNYXRoLm1heCgwLCBzLmggLSAxKSk7XG4gICAgICAgIGlmICghd2l0aEhhbmRsZXMpIHJldHVybjtcblxuICAgICAgICBpZiAoIXRoaXMuc3RvcmUuc3RhdGUucmVhZE9ubHkpIHtcbiAgICAgICAgICAgIGNvbnN0IGhzID0gSEFORExFO1xuICAgICAgICAgICAgZm9yIChjb25zdCBbLCBoeCwgaHldIG9mIHRoaXMuaGFuZGxlcyhyKSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IHggPSBNYXRoLnJvdW5kKHRoaXMucGFuWCArIGh4ICogdGhpcy56b29tIC0gaHMgLyAyKTtcbiAgICAgICAgICAgICAgICBjb25zdCB5ID0gTWF0aC5yb3VuZCh0aGlzLnBhblkgKyBoeSAqIHRoaXMuem9vbSAtIGhzIC8gMik7XG4gICAgICAgICAgICAgICAgY3R4LmZpbGxTdHlsZSA9IENPTE9SUy5zZWxlY3RlZDtcbiAgICAgICAgICAgICAgICBjdHguZmlsbFJlY3QoeCwgeSwgaHMsIGhzKTtcbiAgICAgICAgICAgICAgICBjdHguc3Ryb2tlU3R5bGUgPSBDT0xPUlMuaGFuZGxlRWRnZTtcbiAgICAgICAgICAgICAgICBjdHguc3Ryb2tlUmVjdCh4ICsgMC41LCB5ICsgMC41LCBocyAtIDEsIGhzIC0gMSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQaXZvdDogVW5pdHktc3R5bGUgZGlzYy5cbiAgICAgICAgY29uc3QgcHggPSB0aGlzLnBhblggKyAoci54ICsgci5waXZvdFggKiByLncpICogdGhpcy56b29tO1xuICAgICAgICBjb25zdCBweSA9IHRoaXMucGFuWSArIChyLnkgKyAoMSAtIHIucGl2b3RZKSAqIHIuaCkgKiB0aGlzLnpvb207XG4gICAgICAgIGN0eC5iZWdpblBhdGgoKTtcbiAgICAgICAgY3R4LmFyYyhweCwgcHksIDUsIDAsIE1hdGguUEkgKiAyKTtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IENPTE9SUy5zZWxlY3RlZDtcbiAgICAgICAgY3R4LmZpbGwoKTtcbiAgICAgICAgY3R4LmxpbmVXaWR0aCA9IDEuNTtcbiAgICAgICAgY3R4LnN0cm9rZVN0eWxlID0gQ09MT1JTLnBpdm90UmluZztcbiAgICAgICAgY3R4LnN0cm9rZSgpO1xuICAgICAgICBjdHguYmVnaW5QYXRoKCk7XG4gICAgICAgIGN0eC5hcmMocHgsIHB5LCAxLjUsIDAsIE1hdGguUEkgKiAyKTtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IENPTE9SUy5waXZvdFJpbmc7XG4gICAgICAgIGN0eC5maWxsKCk7XG4gICAgfVxuXG4gICAgcHJpdmF0ZSBkcmF3U2l6ZUxhYmVsKGI6IEJveCwgczogQm94KSB7XG4gICAgICAgIGNvbnN0IGN0eCA9IHRoaXMuY3R4O1xuICAgICAgICBjb25zdCB0ZXh0ID0gYCR7Yi53fSDDlyAke2IuaH1gO1xuICAgICAgICBjdHguc2F2ZSgpO1xuICAgICAgICBjdHguZm9udCA9ICcxMXB4IHN5c3RlbS11aSwgXCJTZWdvZSBVSVwiLCBzYW5zLXNlcmlmJztcbiAgICAgICAgY29uc3QgdHcgPSBjdHgubWVhc3VyZVRleHQodGV4dCkud2lkdGggKyAxMDtcbiAgICAgICAgY29uc3QgeCA9IHMueCArIHMudyAtIHR3O1xuICAgICAgICBjb25zdCB5ID0gcy55ICsgcy5oICsgNDtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IENPTE9SUy5sYWJlbEJnO1xuICAgICAgICBjdHguZmlsbFJlY3QoeCwgeSwgdHcsIDE3KTtcbiAgICAgICAgY3R4LmZpbGxTdHlsZSA9IENPTE9SUy5sYWJlbDtcbiAgICAgICAgY3R4LnRleHRCYXNlbGluZSA9ICdtaWRkbGUnO1xuICAgICAgICBjdHguZmlsbFRleHQodGV4dCwgeCArIDUsIHkgKyA5KTtcbiAgICAgICAgY3R4LnJlc3RvcmUoKTtcbiAgICB9XG59XG4iXX0=