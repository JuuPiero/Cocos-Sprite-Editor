"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStore = createStore;
/**
 * Editor state and actions (Vue reactive). The viewport and the Vue template
 * both read/write through this store.
 */
const vue_1 = require("vue");
const plist_1 = require("../../core/plist");
const slicer_1 = require("../../core/slicer");
const types_1 = require("../../core/types");
const UNDO_LIMIT = 200;
const COALESCE_MS = 800;
function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
function cleanNumber(v, digits = 4) {
    const p = Math.pow(10, digits);
    return Math.round(v * p) / p;
}
function createStore(bridge) {
    const state = (0, vue_1.reactive)({
        texture: null,
        imageUrl: '',
        width: 0,
        height: 0,
        rects: [],
        selected: [],
        /** Rect ids whose pivot dropdown shows "Custom" even if the value matches a preset. */
        customPivot: [],
        hasPlist: false,
        readOnly: null,
        warning: null,
        loading: false,
        applying: false,
        notice: '',
        noticeError: false,
        noticeSeq: 0,
        showAlpha: false,
        sliceOpen: false,
        pivotUnit: 'normalized',
        followSelection: true,
        zoom: 1,
        saved: '[]',
        slice: {
            type: 'auto',
            method: 'delete',
            pivot: 'center',
            pivotX: 0.5,
            pivotY: 0.5,
            keepEmpty: false,
            auto: {
                mode: 'auto',
                alphaThreshold: 1,
                colorTolerance: 24,
                keyColor: null,
                minSize: 4,
                mergeDistance: 0,
                separate: 0,
                extrude: 0,
            },
            grid: { cellW: 32, cellH: 32, cols: 4, rows: 4, offsetX: 0, offsetY: 0, padX: 0, padY: 0 },
        },
    });
    /** Large / non-reactive data. */
    const raw = {
        image: null,
        pixels: null,
        alphaCanvas: null,
        revokeImage: null,
        maskKey: '',
        mask: null,
        undo: [],
        redo: [],
        lastKey: '',
        lastTime: 0,
        uid: 1,
        listeners: new Set(),
        loadedListeners: new Set(),
    };
    const serialize = () => JSON.stringify(state.rects.map((_a) => {
        var { id } = _a, r = __rest(_a, ["id"]);
        return r;
    }));
    const dirty = (0, vue_1.computed)(() => !!state.texture && serialize() !== state.saved);
    const selectedRects = (0, vue_1.computed)(() => {
        const ids = new Set(state.selected);
        return state.rects.filter((r) => ids.has(r.id));
    });
    const single = (0, vue_1.computed)(() => (selectedRects.value.length === 1 ? selectedRects.value[0] : null));
    function changed() {
        raw.listeners.forEach((fn) => fn());
    }
    function notify(msg, error = false) {
        state.notice = msg;
        state.noticeError = error;
        state.noticeSeq++;
    }
    function withIds(list) {
        return list.map((r) => (Object.assign(Object.assign({}, r), { id: raw.uid++ })));
    }
    // ---------------------------------------------------------------- history
    /**
     * Record the current rects before a change. Calls with the same key within a
     * short time collapse into one undo step (used by scrubbing / typing).
     */
    function snapshot(key = '') {
        if (state.readOnly)
            return;
        const now = Date.now();
        if (key && key === raw.lastKey && now - raw.lastTime < COALESCE_MS) {
            raw.lastTime = now;
            return;
        }
        raw.lastKey = key;
        raw.lastTime = now;
        raw.undo.push(JSON.stringify(state.rects));
        if (raw.undo.length > UNDO_LIMIT)
            raw.undo.shift();
        raw.redo.length = 0;
    }
    /** Drop the last snapshot if nothing actually changed (e.g. click without drag). */
    function discardSnapshotIfSame() {
        const last = raw.undo[raw.undo.length - 1];
        if (last !== undefined && last === JSON.stringify(state.rects))
            raw.undo.pop();
    }
    function restore(json) {
        state.rects = JSON.parse(json);
        const ids = new Set(state.rects.map((r) => r.id));
        state.selected = state.selected.filter((id) => ids.has(id));
        raw.lastKey = '';
        changed();
    }
    function undo() {
        const prev = raw.undo.pop();
        if (prev === undefined)
            return;
        raw.redo.push(JSON.stringify(state.rects));
        restore(prev);
    }
    function redo() {
        const next = raw.redo.pop();
        if (next === undefined)
            return;
        raw.undo.push(JSON.stringify(state.rects));
        restore(next);
    }
    // -------------------------------------------------------------- selection
    function select(ids, additive = false) {
        if (additive) {
            const set = new Set(state.selected);
            for (const id of ids) {
                if (set.has(id))
                    set.delete(id);
                else
                    set.add(id);
            }
            state.selected = [...set];
        }
        else {
            state.selected = ids.slice();
        }
        changed();
    }
    function selectAll() {
        select(state.rects.map((r) => r.id));
    }
    function byId(id) {
        return state.rects.find((r) => r.id === id);
    }
    // ------------------------------------------------------------- rect edits
    function clampRect(r) {
        const W = state.width;
        const H = state.height;
        r.w = clamp(Math.round(r.w), 1, W);
        r.h = clamp(Math.round(r.h), 1, H);
        r.x = clamp(Math.round(r.x), 0, W - r.w);
        r.y = clamp(Math.round(r.y), 0, H - r.h);
        r.borderL = clamp(Math.round(r.borderL), 0, r.w);
        r.borderR = clamp(Math.round(r.borderR), 0, r.w - r.borderL);
        r.borderT = clamp(Math.round(r.borderT), 0, r.h);
        r.borderB = clamp(Math.round(r.borderB), 0, r.h - r.borderT);
    }
    function nextIndex() {
        const base = state.texture ? state.texture.baseName : 'sprite';
        const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`);
        let max = -1;
        for (const r of state.rects) {
            const m = re.exec(r.name);
            if (m)
                max = Math.max(max, Number(m[1]));
        }
        return max + 1;
    }
    function makeRect(box, index, pivot) {
        const base = state.texture ? state.texture.baseName : 'sprite';
        return {
            id: raw.uid++,
            name: `${base}_${index}`,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            pivotX: pivot[0],
            pivotY: pivot[1],
            borderL: 0,
            borderT: 0,
            borderR: 0,
            borderB: 0,
        };
    }
    function addRect(box) {
        if (state.readOnly || !state.texture)
            return null;
        const b = (0, slicer_1.clampBox)(box, state.width, state.height);
        if (!b)
            return null;
        snapshot();
        const r = makeRect(b, nextIndex(), [0.5, 0.5]);
        state.rects.push(r);
        state.selected = [r.id];
        changed();
        return r;
    }
    function deleteSelected() {
        if (state.readOnly || !state.selected.length)
            return;
        snapshot();
        const ids = new Set(state.selected);
        state.rects = state.rects.filter((r) => !ids.has(r.id));
        state.selected = [];
        changed();
    }
    /** Inspector edit of one field. Numbers are clamped; names validated on apply. */
    function patchRect(id, patch) {
        const r = byId(id);
        if (!r || state.readOnly)
            return;
        snapshot(`patch:${id}:${Object.keys(patch).join(',')}`);
        Object.assign(r, patch);
        if (patch.pivotX !== undefined || patch.pivotY !== undefined) {
            r.pivotX = cleanNumber(r.pivotX);
            r.pivotY = cleanNumber(r.pivotY);
        }
        else {
            clampRect(r);
        }
        changed();
    }
    function setPivotPreset(ids, preset) {
        if (state.readOnly)
            return;
        if (preset === 'custom') {
            state.customPivot = [...new Set([...state.customPivot, ...ids])];
            return;
        }
        const idSet = new Set(ids);
        state.customPivot = state.customPivot.filter((id) => !idSet.has(id));
        snapshot();
        const [px, py] = types_1.PIVOT_PRESETS[preset];
        for (const r of state.rects) {
            if (!idSet.has(r.id))
                continue;
            r.pivotX = px;
            r.pivotY = py;
        }
        changed();
    }
    function nudge(dx, dy) {
        if (state.readOnly || !state.selected.length)
            return;
        snapshot('nudge');
        for (const r of selectedRects.value) {
            r.x += dx;
            r.y += dy;
            clampRect(r);
        }
        changed();
    }
    // ---------------------------------------------------------------- pixels
    function maskOptions() {
        const a = state.slice.auto;
        return { mode: a.mode, alphaThreshold: a.alphaThreshold, colorTolerance: a.colorTolerance, keyColor: a.keyColor };
    }
    function getMask() {
        if (!raw.pixels)
            return null;
        const opts = maskOptions();
        const key = JSON.stringify(opts);
        if (raw.mask && raw.maskKey === key)
            return raw.mask;
        raw.mask = (0, slicer_1.buildMask)(raw.pixels, opts);
        raw.maskKey = key;
        return raw.mask;
    }
    function trimSelected() {
        if (state.readOnly)
            return;
        const mask = getMask();
        if (!mask || !state.selected.length)
            return;
        const W = state.width;
        const H = state.height;
        let empty = 0;
        snapshot();
        for (const r of selectedRects.value) {
            const t = (0, slicer_1.trimBox)(mask, W, H, r);
            if (!t) {
                empty++;
                continue;
            }
            r.x = t.x;
            r.y = t.y;
            r.w = t.w;
            r.h = t.h;
            clampRect(r);
        }
        discardSnapshotIfSame();
        if (empty)
            notify(`${empty} sprite không có pixel nào để trim.`);
        changed();
    }
    function slicePivot() {
        const s = state.slice;
        return s.pivot === 'custom' ? [cleanNumber(s.pivotX), cleanNumber(s.pivotY)] : types_1.PIVOT_PRESETS[s.pivot];
    }
    /** Boxes the current Slice settings would produce (also used for the grid preview). */
    function sliceBoxes(includeEmpty) {
        if (!raw.pixels)
            return [];
        const s = state.slice;
        if (s.type === 'auto')
            return (0, slicer_1.detectSprites)(raw.pixels, s.auto);
        let boxes = (0, slicer_1.gridBoxes)(state.width, state.height, s.grid, s.type === 'cell-count');
        if (!includeEmpty && !s.keepEmpty) {
            const mask = getMask();
            if (mask)
                boxes = boxes.filter((b) => !(0, slicer_1.isBoxEmpty)(mask, state.width, state.height, b));
        }
        return boxes;
    }
    function doSlice() {
        if (state.readOnly || !raw.pixels)
            return;
        const boxes = sliceBoxes(false);
        if (!boxes.length) {
            notify('Không tìm thấy sprite nào với thiết lập này.', true);
            return;
        }
        const pivot = slicePivot();
        const method = state.slice.method;
        snapshot();
        if (method === 'delete') {
            state.rects = boxes.map((b, i) => makeRect(b, i, pivot));
            state.selected = [];
            state.customPivot = [];
        }
        else if (method === 'smart') {
            // Update the best-overlapping existing rect (keeps its name, pivot and
            // border, so references to it survive); add the rest as new sprites.
            const used = new Set();
            let index = nextIndex();
            for (const b of boxes) {
                let best = null;
                let bestScore = 0;
                for (const r of state.rects) {
                    if (used.has(r.id))
                        continue;
                    const score = (0, slicer_1.iou)(r, b);
                    if (score > bestScore) {
                        bestScore = score;
                        best = r;
                    }
                }
                if (best && bestScore >= 0.3) {
                    used.add(best.id);
                    best.x = b.x;
                    best.y = b.y;
                    best.w = b.w;
                    best.h = b.h;
                    clampRect(best);
                }
                else {
                    state.rects.push(makeRect(b, index++, pivot));
                }
            }
        }
        else {
            // Safe: only add sprites that do not touch any existing rect.
            let index = nextIndex();
            const existing = state.rects.slice();
            for (const b of boxes) {
                if (existing.some((r) => (0, slicer_1.intersectArea)(r, b) > 0))
                    continue;
                state.rects.push(makeRect(b, index++, pivot));
            }
        }
        discardSnapshotIfSame();
        state.sliceOpen = false;
        notify(`Slice: ${state.rects.length} sprite.`);
        changed();
    }
    // ----------------------------------------------------------- load / save
    async function decodeImage(url) {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    }
    function readPixels(img) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
    }
    function alphaCanvas() {
        if (raw.alphaCanvas || !raw.pixels)
            return raw.alphaCanvas;
        const src = raw.pixels;
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const ctx = c.getContext('2d');
        const out = ctx.createImageData(src.width, src.height);
        for (let i = 0; i < src.data.length; i += 4) {
            const a = src.data[i + 3];
            out.data[i] = a;
            out.data[i + 1] = a;
            out.data[i + 2] = a;
            out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        raw.alphaCanvas = c;
        return c;
    }
    async function setImage(url, revoke) {
        const img = await decodeImage(url);
        if (raw.revokeImage)
            raw.revokeImage();
        raw.revokeImage = revoke;
        raw.image = img;
        raw.pixels = readPixels(img);
        raw.alphaCanvas = null;
        raw.mask = null;
        raw.maskKey = '';
        state.imageUrl = url;
        state.width = img.naturalWidth;
        state.height = img.naturalHeight;
    }
    /**
     * Ask what to do with unapplied changes. Resolves false when the user cancels.
     * Mirrors Unity's "Unapplied import settings" dialog.
     */
    async function confirmDiscard() {
        if (!dirty.value || !state.texture)
            return true;
        const choice = await bridge.ask(`Chưa Apply thay đổi cho "${state.texture.fileName}"`, 'Apply để lưu các sprite vào file .plist, Revert để bỏ thay đổi.', ['Apply', 'Revert', 'Hủy'], 0, 2);
        if (choice === 2)
            return false;
        if (choice === 0)
            return apply();
        revert();
        return true;
    }
    function focusFrame(name) {
        if (!name)
            return;
        const r = state.rects.find((x) => x.name === name);
        if (r)
            select([r.id]);
    }
    let loadSeq = 0;
    async function load(uuid, opts = {}) {
        let target;
        try {
            target = await bridge.resolve(uuid);
        }
        catch (e) {
            if (!opts.fromSelection)
                notify(String(e.message || e), true);
            return false;
        }
        if (!target) {
            if (!opts.fromSelection)
                notify('Asset này không phải ảnh (Texture / SpriteFrame / .plist).', true);
            return false;
        }
        const same = state.texture && state.texture.imageUuid === target.info.imageUuid;
        if (same && !opts.force) {
            focusFrame(target.focusFrame);
            return true;
        }
        if (!same && !(await confirmDiscard()))
            return false;
        const seq = ++loadSeq;
        state.loading = true;
        try {
            const [img, sheet] = await Promise.all([bridge.loadImage(target.info), bridge.readSheet(target.info)]);
            if (seq !== loadSeq) {
                img.revoke();
                return false;
            }
            await setImage(img.url, img.revoke);
            state.texture = target.info;
            state.rects = withIds(sheet.rects);
            state.saved = serialize();
            state.selected = [];
            state.customPivot = [];
            state.hasPlist = sheet.hasPlist;
            state.readOnly = sheet.readOnlyReason;
            state.warning = sheet.warning;
            state.sliceOpen = false;
            raw.undo.length = 0;
            raw.redo.length = 0;
            raw.lastKey = '';
            const g = state.slice.grid;
            if (!sheet.hasPlist) {
                // Sensible grid defaults for a new texture.
                g.cellW = Math.min(g.cellW, state.width);
                g.cellH = Math.min(g.cellH, state.height);
            }
            focusFrame(target.focusFrame);
            changed();
            raw.loadedListeners.forEach((fn) => fn());
            return true;
        }
        catch (e) {
            notify(`Không mở được ảnh: ${e.message || e}`, true);
            return false;
        }
        finally {
            if (seq === loadSeq)
                state.loading = false;
        }
    }
    /** Re-read pixels after the image file changed on disk; keeps the rects. */
    async function reloadImage() {
        if (!state.texture)
            return;
        try {
            const img = await bridge.loadImage(state.texture);
            await setImage(img.url, img.revoke);
            for (const r of state.rects)
                clampRect(r);
            changed();
        }
        catch (e) {
            notify(`Không đọc lại được ảnh: ${e.message || e}`, true);
        }
    }
    /** First validation problem, with the rect it belongs to. */
    function validate() {
        const seen = new Map();
        for (const r of state.rects) {
            const err = (0, plist_1.validateFrameName)(r.name);
            if (err)
                return { id: r.id, message: `"${r.name}": ${err}` };
            const key = r.name;
            if (seen.has(key))
                return { id: r.id, message: `Trùng tên sprite "${r.name}". Mỗi sprite cần một tên riêng.` };
            seen.set(key, r.id);
        }
        return null;
    }
    async function apply() {
        const tex = state.texture;
        if (!tex || state.readOnly || state.applying)
            return false;
        const problem = validate();
        if (problem) {
            select([problem.id]);
            notify(problem.message, true);
            return false;
        }
        // Renaming/removing a frame changes its sub-asset uuid: warn like Unity does.
        if (state.hasPlist) {
            const before = JSON.parse(state.saved);
            const now = new Set(state.rects.map((r) => r.name));
            const lost = before.map((r) => r.name).filter((n) => !now.has(n));
            if (lost.length) {
                const list = lost.slice(0, 8).join(', ') + (lost.length > 8 ? `… (+${lost.length - 8})` : '');
                const choice = await bridge.ask('Một số sprite đã bị đổi tên hoặc xóa', `${list}\n\nScene/Prefab/Animation đang dùng các sprite này sẽ mất tham chiếu sau khi Apply.`, ['Vẫn Apply', 'Hủy'], 1, 1);
                if (choice !== 0)
                    return false;
            }
        }
        state.applying = true;
        try {
            const data = state.rects.map((_a) => {
                var { id } = _a, r = __rest(_a, ["id"]);
                return r;
            });
            const res = await bridge.writeSheet(tex, data, state.width, state.height);
            state.saved = serialize();
            state.hasPlist = true;
            state.warning = null;
            if (res.warnings.length)
                notify(res.warnings.join(' '), true);
            else
                notify(`Đã Apply ${data.length} sprite → ${tex.baseName}.plist`);
            return true;
        }
        catch (e) {
            notify(`Apply thất bại: ${e.message || e}`, true);
            return false;
        }
        finally {
            state.applying = false;
        }
    }
    function revert() {
        if (!dirty.value)
            return;
        snapshot();
        const saved = JSON.parse(state.saved);
        state.rects = withIds(saved);
        state.selected = [];
        state.customPivot = [];
        changed();
    }
    function onChange(fn) {
        raw.listeners.add(fn);
        return () => raw.listeners.delete(fn);
    }
    /** Called after a texture has been (re)opened. */
    function onLoaded(fn) {
        raw.loadedListeners.add(fn);
        return () => raw.loadedListeners.delete(fn);
    }
    function dispose() {
        if (raw.revokeImage)
            raw.revokeImage();
        raw.revokeImage = null;
        raw.listeners.clear();
        raw.loadedListeners.clear();
    }
    return {
        state,
        raw,
        dirty,
        selectedRects,
        single,
        changed,
        notify,
        snapshot,
        discardSnapshotIfSame,
        undo,
        redo,
        select,
        selectAll,
        byId,
        clampRect,
        addRect,
        deleteSelected,
        patchRect,
        setPivotPreset,
        nudge,
        trimSelected,
        sliceBoxes,
        doSlice,
        alphaCanvas,
        load,
        reloadImage,
        confirmDiscard,
        apply,
        revert,
        onChange,
        onLoaded,
        dispose,
        canUndo: () => raw.undo.length > 0,
        canRedo: () => raw.redo.length > 0,
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvc3RvcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7OztBQTRDQSxrQ0E0b0JDO0FBeHJCRDs7O0dBR0c7QUFDSCw2QkFBeUM7QUFFekMsNENBQXFEO0FBQ3JELDhDQUUyQjtBQUMzQiw0Q0FFMEI7QUFvQjFCLE1BQU0sVUFBVSxHQUFHLEdBQUcsQ0FBQztBQUN2QixNQUFNLFdBQVcsR0FBRyxHQUFHLENBQUM7QUFFeEIsU0FBUyxLQUFLLENBQUMsQ0FBUyxFQUFFLEVBQVUsRUFBRSxFQUFVO0lBQzVDLE9BQU8sQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUN6QyxDQUFDO0FBRUQsU0FBUyxXQUFXLENBQUMsQ0FBUyxFQUFFLE1BQU0sR0FBRyxDQUFDO0lBQ3RDLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQy9CLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0FBQ2pDLENBQUM7QUFFRCxTQUFnQixXQUFXLENBQUMsTUFBbUI7SUFDM0MsTUFBTSxLQUFLLEdBQUcsSUFBQSxjQUFRLEVBQUM7UUFDbkIsT0FBTyxFQUFFLElBQTBCO1FBQ25DLFFBQVEsRUFBRSxFQUFFO1FBQ1osS0FBSyxFQUFFLENBQUM7UUFDUixNQUFNLEVBQUUsQ0FBQztRQUNULEtBQUssRUFBRSxFQUFrQjtRQUN6QixRQUFRLEVBQUUsRUFBYztRQUN4Qix1RkFBdUY7UUFDdkYsV0FBVyxFQUFFLEVBQWM7UUFDM0IsUUFBUSxFQUFFLEtBQUs7UUFDZixRQUFRLEVB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QUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDakQsQ0FBQyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzdELENBQUMsQ0FBQyxPQUFPLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDakQsQ0FBQyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ2pFLENBQUM7SUFFRCxTQUFTLFNBQVM7UUFDZCxNQUFNLElBQUksR0FBRyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUMsUUFBUSxDQUFDO1FBQy9ELE1BQU0sRUFBRSxHQUFHLElBQUksTUFBTSxDQUFDLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRSxNQUFNLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDakYsSUFBSSxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUM7UUFDYixLQUFLLE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUMxQixNQUFNLENBQUMsR0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMxQixJQUFJLENBQUM7Z0JBQUUsR0FBRyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzdD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QUM7S0FDckMsQ0FBQztBQUNOLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEVkaXRvciBzdGF0ZSBhbmQgYWN0aW9ucyAoVnVlIHJlYWN0aXZlKS4gVGhlIHZpZXdwb3J0IGFuZCB0aGUgVnVlIHRlbXBsYXRlXG4gKiBib3RoIHJlYWQvd3JpdGUgdGhyb3VnaCB0aGlzIHN0b3JlLlxuICovXG5pbXBvcnQgeyBjb21wdXRlZCwgcmVhY3RpdmUgfSBmcm9tICd2dWUnO1xuaW1wb3J0IHsgUmVjdERhdGEsIFNoZWV0QnJpZGdlLCBUZXh0dXJlSW5mbyB9IGZyb20gJy4uLy4uL2NvcmUvYnJpZGdlJztcbmltcG9ydCB7IHZhbGlkYXRlRnJhbWVOYW1lIH0gZnJvbSAnLi4vLi4vY29yZS9wbGlzdCc7XG5pbXBvcnQge1xuICAgIGJ1aWxkTWFzaywgY2xhbXBCb3gsIGRldGVjdFNwcml0ZXMsIGdyaWRCb3hlcywgaW50ZXJzZWN0QXJlYSwgaW91LCBpc0JveEVtcHR5LCB0cmltQm94LFxufSBmcm9tICcuLi8uLi9jb3JlL3NsaWNlcic7XG5pbXBvcnQge1xuICAgIEF1dG9TbGljZU9wdGlvbnMsIEJveCwgR3JpZE9wdGlvbnMsIE1hc2tPcHRpb25zLCBQSVZPVF9QUkVTRVRTLCBQaXZvdFByZXNldCwgU2xpY2VNZXRob2QsIFNsaWNlVHlwZSwgU3ByaXRlUmVjdCxcbn0gZnJvbSAnLi4vLi4vY29yZS90eXBlcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2xpY2VTZXR0aW5ncyB7XG4gICAgdHlwZTogU2xpY2VUeXBlO1xuICAgIG1ldGhvZDogU2xpY2VNZXRob2Q7XG4gICAgcGl2b3Q6IFBpdm90UHJlc2V0O1xuICAgIHBpdm90WDogbnVtYmVyO1xuICAgIHBpdm90WTogbnVtYmVyO1xuICAgIGtlZXBFbXB0eTogYm9vbGVhbjtcbiAgICBhdXRvOiBBdXRvU2xpY2VPcHRpb25zO1xuICAgIGdyaWQ6IEdyaWRPcHRpb25zO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvYWRPcHRpb25zIHtcbiAgICAvKiogVHJpZ2dlcmVkIGJ5IEFzc2V0cyBzZWxlY3Rpb246IGlnbm9yZSBub24taW1hZ2UgYXNzZXRzIHNpbGVudGx5LiAqL1xuICAgIGZyb21TZWxlY3Rpb24/OiBib29sZWFuO1xuICAgIC8qKiBSZWxvYWQgZXZlbiBpZiB0aGUgdGV4dHVyZSBpcyBhbHJlYWR5IG9wZW4uICovXG4gICAgZm9yY2U/OiBib29sZWFuO1xufVxuXG5jb25zdCBVTkRPX0xJTUlUID0gMjAwO1xuY29uc3QgQ09BTEVTQ0VfTVMgPSA4MDA7XG5cbmZ1bmN0aW9uIGNsYW1wKHY6IG51bWJlciwgbG86IG51bWJlciwgaGk6IG51bWJlcik6IG51bWJlciB7XG4gICAgcmV0dXJuIHYgPCBsbyA/IGxvIDogdiA+IGhpID8gaGkgOiB2O1xufVxuXG5mdW5jdGlvbiBjbGVhbk51bWJlcih2OiBudW1iZXIsIGRpZ2l0cyA9IDQpOiBudW1iZXIge1xuICAgIGNvbnN0IHAgPSBNYXRoLnBvdygxMCwgZGlnaXRzKTtcbiAgICByZXR1cm4gTWF0aC5yb3VuZCh2ICogcCkgLyBwO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlU3RvcmUoYnJpZGdlOiBTaGVldEJyaWRnZSkge1xuICAgIGNvbnN0IHN0YXRlID0gcmVhY3RpdmUoe1xuICAgICAgICB0ZXh0dXJlOiBudWxsIGFzIFRleHR1cmVJbmZvIHwgbnVsbCxcbiAgICAgICAgaW1hZ2VVcmw6ICcnLFxuICAgICAgICB3aWR0aDogMCxcbiAgICAgICAgaGVpZ2h0OiAwLFxuICAgICAgICByZWN0czogW10gYXMgU3ByaXRlUmVjdFtdLFxuICAgICAgICBzZWxlY3RlZDogW10gYXMgbnVtYmVyW10sXG4gICAgICAgIC8qKiBSZWN0IGlkcyB3aG9zZSBwaXZvdCBkcm9wZG93biBzaG93cyBcIkN1c3RvbVwiIGV2ZW4gaWYgdGhlIHZhbHVlIG1hdGNoZXMgYSBwcmVzZXQuICovXG4gICAgICAgIGN1c3RvbVBpdm90OiBbXSBhcyBudW1iZXJbXSxcbiAgICAgICAgaGFzUGxpc3Q6IGZhbHNlLFxuICAgICAgICByZWFkT25seTogbnVsbCBhcyBzdHJpbmcgfCBudWxsLFxuICAgICAgICB3YXJuaW5nOiBudWxsIGFzIHN0cmluZyB8IG51bGwsXG4gICAgICAgIGxvYWRpbmc6IGZhbHNlLFxuICAgICAgICBhcHBseWluZzogZmFsc2UsXG4gICAgICAgIG5vdGljZTogJycsXG4gICAgICAgIG5vdGljZUVycm9yOiBmYWxzZSxcbiAgICAgICAgbm90aWNlU2VxOiAwLFxuICAgICAgICBzaG93QWxwaGE6IGZhbHNlLFxuICAgICAgICBzbGljZU9wZW46IGZhbHNlLFxuICAgICAgICBwaXZvdFVuaXQ6ICdub3JtYWxpemVkJyBhcyAnbm9ybWFsaXplZCcgfCAncGl4ZWxzJyxcbiAgICAgICAgZm9sbG93U2VsZWN0aW9uOiB0cnVlLFxuICAgICAgICB6b29tOiAxLFxuICAgICAgICBzYXZlZDogJ1tdJyxcbiAgICAgICAgc2xpY2U6IHtcbiAgICAgICAgICAgIHR5cGU6ICdhdXRvJyxcbiAgICAgICAgICAgIG1ldGhvZDogJ2RlbGV0ZScsXG4gICAgICAgICAgICBwaXZvdDogJ2NlbnRlcicsXG4gICAgICAgICAgICBwaXZvdFg6IDAuNSxcbiAgICAgICAgICAgIHBpdm90WTogMC41LFxuICAgICAgICAgICAga2VlcEVtcHR5OiBmYWxzZSxcbiAgICAgICAgICAgIGF1dG86IHtcbiAgICAgICAgICAgICAgICBtb2RlOiAnYXV0bycsXG4gICAgICAgICAgICAgICAgYWxwaGFUaHJlc2hvbGQ6IDEsXG4gICAgICAgICAgICAgICAgY29sb3JUb2xlcmFuY2U6IDI0LFxuICAgICAgICAgICAgICAgIGtleUNvbG9yOiBudWxsLFxuICAgICAgICAgICAgICAgIG1pblNpemU6IDQsXG4gICAgICAgICAgICAgICAgbWVyZ2VEaXN0YW5jZTogMCxcbiAgICAgICAgICAgICAgICBzZXBhcmF0ZTogMCxcbiAgICAgICAgICAgICAgICBleHRydWRlOiAwLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIGdyaWQ6IHsgY2VsbFc6IDMyLCBjZWxsSDogMzIsIGNvbHM6IDQsIHJvd3M6IDQsIG9mZnNldFg6IDAsIG9mZnNldFk6IDAsIHBhZFg6IDAsIHBhZFk6IDAgfSxcbiAgICAgICAgfSBhcyBTbGljZVNldHRpbmdzLFxuICAgIH0pO1xuXG4gICAgLyoqIExhcmdlIC8gbm9uLXJlYWN0aXZlIGRhdGEuICovXG4gICAgY29uc3QgcmF3ID0ge1xuICAgICAgICBpbWFnZTogbnVsbCBhcyBIVE1MSW1hZ2VFbGVtZW50IHwgbnVsbCxcbiAgICAgICAgcGl4ZWxzOiBudWxsIGFzIEltYWdlRGF0YSB8IG51bGwsXG4gICAgICAgIGFscGhhQ2FudmFzOiBudWxsIGFzIEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbCxcbiAgICAgICAgcmV2b2tlSW1hZ2U6IG51bGwgYXMgbnVsbCB8ICgoKSA9PiB2b2lkKSxcbiAgICAgICAgbWFza0tleTogJycsXG4gICAgICAgIG1hc2s6IG51bGwgYXMgVWludDhBcnJheSB8IG51bGwsXG4gICAgICAgIHVuZG86IFtdIGFzIHN0cmluZ1tdLFxuICAgICAgICByZWRvOiBbXSBhcyBzdHJpbmdbXSxcbiAgICAgICAgbGFzdEtleTogJycsXG4gICAgICAgIGxhc3RUaW1lOiAwLFxuICAgICAgICB1aWQ6IDEsXG4gICAgICAgIGxpc3RlbmVyczogbmV3IFNldDwoKSA9PiB2b2lkPigpLFxuICAgICAgICBsb2FkZWRMaXN0ZW5lcnM6IG5ldyBTZXQ8KCkgPT4gdm9pZD4oKSxcbiAgICB9O1xuXG4gICAgY29uc3Qgc2VyaWFsaXplID0gKCkgPT4gSlNPTi5zdHJpbmdpZnkoc3RhdGUucmVjdHMubWFwKCh7IGlkLCAuLi5yIH0pID0+IHIpKTtcbiAgICBjb25zdCBkaXJ0eSA9IGNvbXB1dGVkKCgpID0+ICEhc3RhdGUudGV4dHVyZSAmJiBzZXJpYWxpemUoKSAhPT0gc3RhdGUuc2F2ZWQpO1xuICAgIGNvbnN0IHNlbGVjdGVkUmVjdHMgPSBjb21wdXRlZCgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQoc3RhdGUuc2VsZWN0ZWQpO1xuICAgICAgICByZXR1cm4gc3RhdGUucmVjdHMuZmlsdGVyKChyKSA9PiBpZHMuaGFzKHIuaWQpKTtcbiAgICB9KTtcbiAgICBjb25zdCBzaW5nbGUgPSBjb21wdXRlZCgoKSA9PiAoc2VsZWN0ZWRSZWN0cy52YWx1ZS5sZW5ndGggPT09IDEgPyBzZWxlY3RlZFJlY3RzLnZhbHVlWzBdIDogbnVsbCkpO1xuXG4gICAgZnVuY3Rpb24gY2hhbmdlZCgpIHtcbiAgICAgICAgcmF3Lmxpc3RlbmVycy5mb3JFYWNoKChmbikgPT4gZm4oKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbm90aWZ5KG1zZzogc3RyaW5nLCBlcnJvciA9IGZhbHNlKSB7XG4gICAgICAgIHN0YXRlLm5vdGljZSA9IG1zZztcbiAgICAgICAgc3RhdGUubm90aWNlRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgc3RhdGUubm90aWNlU2VxKys7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gd2l0aElkcyhsaXN0OiBSZWN0RGF0YVtdKTogU3ByaXRlUmVjdFtdIHtcbiAgICAgICAgcmV0dXJuIGxpc3QubWFwKChyKSA9PiAoeyAuLi5yLCBpZDogcmF3LnVpZCsrIH0pKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGhpc3RvcnlcblxuICAgIC8qKlxuICAgICAqIFJlY29yZCB0aGUgY3VycmVudCByZWN0cyBiZWZvcmUgYSBjaGFuZ2UuIENhbGxzIHdpdGggdGhlIHNhbWUga2V5IHdpdGhpbiBhXG4gICAgICogc2hvcnQgdGltZSBjb2xsYXBzZSBpbnRvIG9uZSB1bmRvIHN0ZXAgKHVzZWQgYnkgc2NydWJiaW5nIC8gdHlwaW5nKS5cbiAgICAgKi9cbiAgICBmdW5jdGlvbiBzbmFwc2hvdChrZXkgPSAnJykge1xuICAgICAgICBpZiAoc3RhdGUucmVhZE9ubHkpIHJldHVybjtcbiAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgaWYgKGtleSAmJiBrZXkgPT09IHJhdy5sYXN0S2V5ICYmIG5vdyAtIHJhdy5sYXN0VGltZSA8IENPQUxFU0NFX01TKSB7XG4gICAgICAgICAgICByYXcubGFzdFRpbWUgPSBub3c7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcmF3Lmxhc3RLZXkgPSBrZXk7XG4gICAgICAgIHJhdy5sYXN0VGltZSA9IG5vdztcbiAgICAgICAgcmF3LnVuZG8ucHVzaChKU09OLnN0cmluZ2lmeShzdGF0ZS5yZWN0cykpO1xuICAgICAgICBpZiAocmF3LnVuZG8ubGVuZ3RoID4gVU5ET19MSU1JVCkgcmF3LnVuZG8uc2hpZnQoKTtcbiAgICAgICAgcmF3LnJlZG8ubGVuZ3RoID0gMDtcbiAgICB9XG5cbiAgICAvKiogRHJvcCB0aGUgbGFzdCBzbmFwc2hvdCBpZiBub3RoaW5nIGFjdHVhbGx5IGNoYW5nZWQgKGUuZy4gY2xpY2sgd2l0aG91dCBkcmFnKS4gKi9cbiAgICBmdW5jdGlvbiBkaXNjYXJkU25hcHNob3RJZlNhbWUoKSB7XG4gICAgICAgIGNvbnN0IGxhc3QgPSByYXcudW5kb1tyYXcudW5kby5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKGxhc3QgIT09IHVuZGVmaW5lZCAmJiBsYXN0ID09PSBKU09OLnN0cmluZ2lmeShzdGF0ZS5yZWN0cykpIHJhdy51bmRvLnBvcCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlc3RvcmUoanNvbjogc3RyaW5nKSB7XG4gICAgICAgIHN0YXRlLnJlY3RzID0gSlNPTi5wYXJzZShqc29uKTtcbiAgICAgICAgY29uc3QgaWRzID0gbmV3IFNldChzdGF0ZS5yZWN0cy5tYXAoKHIpID0+IHIuaWQpKTtcbiAgICAgICAgc3RhdGUuc2VsZWN0ZWQgPSBzdGF0ZS5zZWxlY3RlZC5maWx0ZXIoKGlkKSA9PiBpZHMuaGFzKGlkKSk7XG4gICAgICAgIHJhdy5sYXN0S2V5ID0gJyc7XG4gICAgICAgIGNoYW5nZWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB1bmRvKCkge1xuICAgICAgICBjb25zdCBwcmV2ID0gcmF3LnVuZG8ucG9wKCk7XG4gICAgICAgIGlmIChwcmV2ID09PSB1bmRlZmluZWQpIHJldHVybjtcbiAgICAgICAgcmF3LnJlZG8ucHVzaChKU09OLnN0cmluZ2lmeShzdGF0ZS5yZWN0cykpO1xuICAgICAgICByZXN0b3JlKHByZXYpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHJlZG8oKSB7XG4gICAgICAgIGNvbnN0IG5leHQgPSByYXcucmVkby5wb3AoKTtcbiAgICAgICAgaWYgKG5leHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuO1xuICAgICAgICByYXcudW5kby5wdXNoKEpTT04uc3RyaW5naWZ5KHN0YXRlLnJlY3RzKSk7XG4gICAgICAgIHJlc3RvcmUobmV4dCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2VsZWN0aW9uXG5cbiAgICBmdW5jdGlvbiBzZWxlY3QoaWRzOiBudW1iZXJbXSwgYWRkaXRpdmUgPSBmYWxzZSkge1xuICAgICAgICBpZiAoYWRkaXRpdmUpIHtcbiAgICAgICAgICAgIGNvbnN0IHNldCA9IG5ldyBTZXQoc3RhdGUuc2VsZWN0ZWQpO1xuICAgICAgICAgICAgZm9yIChjb25zdCBpZCBvZiBpZHMpIHtcbiAgICAgICAgICAgICAgICBpZiAoc2V0LmhhcyhpZCkpIHNldC5kZWxldGUoaWQpO1xuICAgICAgICAgICAgICAgIGVsc2Ugc2V0LmFkZChpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzdGF0ZS5zZWxlY3RlZCA9IFsuLi5zZXRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgc3RhdGUuc2VsZWN0ZWQgPSBpZHMuc2xpY2UoKTtcbiAgICAgICAgfVxuICAgICAgICBjaGFuZ2VkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2VsZWN0QWxsKCkge1xuICAgICAgICBzZWxlY3Qoc3RhdGUucmVjdHMubWFwKChyKSA9PiByLmlkKSk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gYnlJZChpZDogbnVtYmVyKTogU3ByaXRlUmVjdCB8IHVuZGVmaW5lZCB7XG4gICAgICAgIHJldHVybiBzdGF0ZS5yZWN0cy5maW5kKChyKSA9PiByLmlkID09PSBpZCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZWN0IGVkaXRzXG5cbiAgICBmdW5jdGlvbiBjbGFtcFJlY3QocjogU3ByaXRlUmVjdCkge1xuICAgICAgICBjb25zdCBXID0gc3RhdGUud2lkdGg7XG4gICAgICAgIGNvbnN0IEggPSBzdGF0ZS5oZWlnaHQ7XG4gICAgICAgIHIudyA9IGNsYW1wKE1hdGgucm91bmQoci53KSwgMSwgVyk7XG4gICAgICAgIHIuaCA9IGNsYW1wKE1hdGgucm91bmQoci5oKSwgMSwgSCk7XG4gICAgICAgIHIueCA9IGNsYW1wKE1hdGgucm91bmQoci54KSwgMCwgVyAtIHIudyk7XG4gICAgICAgIHIueSA9IGNsYW1wKE1hdGgucm91bmQoci55KSwgMCwgSCAtIHIuaCk7XG4gICAgICAgIHIuYm9yZGVyTCA9IGNsYW1wKE1hdGgucm91bmQoci5ib3JkZXJMKSwgMCwgci53KTtcbiAgICAgICAgci5ib3JkZXJSID0gY2xhbXAoTWF0aC5yb3VuZChyLmJvcmRlclIpLCAwLCByLncgLSByLmJvcmRlckwpO1xuICAgICAgICByLmJvcmRlclQgPSBjbGFtcChNYXRoLnJvdW5kKHIuYm9yZGVyVCksIDAsIHIuaCk7XG4gICAgICAgIHIuYm9yZGVyQiA9IGNsYW1wKE1hdGgucm91bmQoci5ib3JkZXJCKSwgMCwgci5oIC0gci5ib3JkZXJUKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBuZXh0SW5kZXgoKTogbnVtYmVyIHtcbiAgICAgICAgY29uc3QgYmFzZSA9IHN0YXRlLnRleHR1cmUgPyBzdGF0ZS50ZXh0dXJlLmJhc2VOYW1lIDogJ3Nwcml0ZSc7XG4gICAgICAgIGNvbnN0IHJlID0gbmV3IFJlZ0V4cChgXiR7YmFzZS5yZXBsYWNlKC9bLiorP14ke30oKXxbXFxdXFxcXF0vZywgJ1xcXFwkJicpfV8oXFxcXGQrKSRgKTtcbiAgICAgICAgbGV0IG1heCA9IC0xO1xuICAgICAgICBmb3IgKGNvbnN0IHIgb2Ygc3RhdGUucmVjdHMpIHtcbiAgICAgICAgICAgIGNvbnN0IG0gPSByZS5leGVjKHIubmFtZSk7XG4gICAgICAgICAgICBpZiAobSkgbWF4ID0gTWF0aC5tYXgobWF4LCBOdW1iZXIobVsxXSkpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBtYXggKyAxO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1ha2VSZWN0KGJveDogQm94LCBpbmRleDogbnVtYmVyLCBwaXZvdDogW251bWJlciwgbnVtYmVyXSk6IFNwcml0ZVJlY3Qge1xuICAgICAgICBjb25zdCBiYXNlID0gc3RhdGUudGV4dHVyZSA/IHN0YXRlLnRleHR1cmUuYmFzZU5hbWUgOiAnc3ByaXRlJztcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiByYXcudWlkKyssXG4gICAgICAgICAgICBuYW1lOiBgJHtiYXNlfV8ke2luZGV4fWAsXG4gICAgICAgICAgICB4OiBib3gueCxcbiAgICAgICAgICAgIHk6IGJveC55LFxuICAgICAgICAgICAgdzogYm94LncsXG4gICAgICAgICAgICBoOiBib3guaCxcbiAgICAgICAgICAgIHBpdm90WDogcGl2b3RbMF0sXG4gICAgICAgICAgICBwaXZvdFk6IHBpdm90WzFdLFxuICAgICAgICAgICAgYm9yZGVyTDogMCxcbiAgICAgICAgICAgIGJvcmRlclQ6IDAsXG4gICAgICAgICAgICBib3JkZXJSOiAwLFxuICAgICAgICAgICAgYm9yZGVyQjogMCxcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBhZGRSZWN0KGJveDogQm94KTogU3ByaXRlUmVjdCB8IG51bGwge1xuICAgICAgICBpZiAoc3RhdGUucmVhZE9ubHkgfHwgIXN0YXRlLnRleHR1cmUpIHJldHVybiBudWxsO1xuICAgICAgICBjb25zdCBiID0gY2xhbXBCb3goYm94LCBzdGF0ZS53aWR0aCwgc3RhdGUuaGVpZ2h0KTtcbiAgICAgICAgaWYgKCFiKSByZXR1cm4gbnVsbDtcbiAgICAgICAgc25hcHNob3QoKTtcbiAgICAgICAgY29uc3QgciA9IG1ha2VSZWN0KGIsIG5leHRJbmRleCgpLCBbMC41LCAwLjVdKTtcbiAgICAgICAgc3RhdGUucmVjdHMucHVzaChyKTtcbiAgICAgICAgc3RhdGUuc2VsZWN0ZWQgPSBbci5pZF07XG4gICAgICAgIGNoYW5nZWQoKTtcbiAgICAgICAgcmV0dXJuIHI7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGVsZXRlU2VsZWN0ZWQoKSB7XG4gICAgICAgIGlmIChzdGF0ZS5yZWFkT25seSB8fCAhc3RhdGUuc2VsZWN0ZWQubGVuZ3RoKSByZXR1cm47XG4gICAgICAgIHNuYXBzaG90KCk7XG4gICAgICAgIGNvbnN0IGlkcyA9IG5ldyBTZXQoc3RhdGUuc2VsZWN0ZWQpO1xuICAgICAgICBzdGF0ZS5yZWN0cyA9IHN0YXRlLnJlY3RzLmZpbHRlcigocikgPT4gIWlkcy5oYXMoci5pZCkpO1xuICAgICAgICBzdGF0ZS5zZWxlY3RlZCA9IFtdO1xuICAgICAgICBjaGFuZ2VkKCk7XG4gICAgfVxuXG4gICAgLyoqIEluc3BlY3RvciBlZGl0IG9mIG9uZSBmaWVsZC4gTnVtYmVycyBhcmUgY2xhbXBlZDsgbmFtZXMgdmFsaWRhdGVkIG9uIGFwcGx5LiAqL1xuICAgIGZ1bmN0aW9uIHBhdGNoUmVjdChpZDogbnVtYmVyLCBwYXRjaDogUGFydGlhbDxSZWN0RGF0YT4pIHtcbiAgICAgICAgY29uc3QgciA9IGJ5SWQoaWQpO1xuICAgICAgICBpZiAoIXIgfHwgc3RhdGUucmVhZE9ubHkpIHJldHVybjtcbiAgICAgICAgc25hcHNob3QoYHBhdGNoOiR7aWR9OiR7T2JqZWN0LmtleXMocGF0Y2gpLmpvaW4oJywnKX1gKTtcbiAgICAgICAgT2JqZWN0LmFzc2lnbihyLCBwYXRjaCk7XG4gICAgICAgIGlmIChwYXRjaC5waXZvdFggIT09IHVuZGVmaW5lZCB8fCBwYXRjaC5waXZvdFkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgci5waXZvdFggPSBjbGVhbk51bWJlcihyLnBpdm90WCk7XG4gICAgICAgICAgICByLnBpdm90WSA9IGNsZWFuTnVtYmVyKHIucGl2b3RZKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNsYW1wUmVjdChyKTtcbiAgICAgICAgfVxuICAgICAgICBjaGFuZ2VkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gc2V0UGl2b3RQcmVzZXQoaWRzOiBudW1iZXJbXSwgcHJlc2V0OiBQaXZvdFByZXNldCkge1xuICAgICAgICBpZiAoc3RhdGUucmVhZE9ubHkpIHJldHVybjtcbiAgICAgICAgaWYgKHByZXNldCA9PT0gJ2N1c3RvbScpIHtcbiAgICAgICAgICAgIHN0YXRlLmN1c3RvbVBpdm90ID0gWy4uLm5ldyBTZXQoWy4uLnN0YXRlLmN1c3RvbVBpdm90LCAuLi5pZHNdKV07XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaWRTZXQgPSBuZXcgU2V0KGlkcyk7XG4gICAgICAgIHN0YXRlLmN1c3RvbVBpdm90ID0gc3RhdGUuY3VzdG9tUGl2b3QuZmlsdGVyKChpZCkgPT4gIWlkU2V0LmhhcyhpZCkpO1xuICAgICAgICBzbmFwc2hvdCgpO1xuICAgICAgICBjb25zdCBbcHgsIHB5XSA9IFBJVk9UX1BSRVNFVFNbcHJlc2V0XTtcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHN0YXRlLnJlY3RzKSB7XG4gICAgICAgICAgICBpZiAoIWlkU2V0LmhhcyhyLmlkKSkgY29udGludWU7XG4gICAgICAgICAgICByLnBpdm90WCA9IHB4O1xuICAgICAgICAgICAgci5waXZvdFkgPSBweTtcbiAgICAgICAgfVxuICAgICAgICBjaGFuZ2VkKCk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbnVkZ2UoZHg6IG51bWJlciwgZHk6IG51bWJlcikge1xuICAgICAgICBpZiAoc3RhdGUucmVhZE9ubHkgfHwgIXN0YXRlLnNlbGVjdGVkLmxlbmd0aCkgcmV0dXJuO1xuICAgICAgICBzbmFwc2hvdCgnbnVkZ2UnKTtcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHNlbGVjdGVkUmVjdHMudmFsdWUpIHtcbiAgICAgICAgICAgIHIueCArPSBkeDtcbiAgICAgICAgICAgIHIueSArPSBkeTtcbiAgICAgICAgICAgIGNsYW1wUmVjdChyKTtcbiAgICAgICAgfVxuICAgICAgICBjaGFuZ2VkKCk7XG4gICAgfVxuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwaXhlbHNcblxuICAgIGZ1bmN0aW9uIG1hc2tPcHRpb25zKCk6IE1hc2tPcHRpb25zIHtcbiAgICAgICAgY29uc3QgYSA9IHN0YXRlLnNsaWNlLmF1dG87XG4gICAgICAgIHJldHVybiB7IG1vZGU6IGEubW9kZSwgYWxwaGFUaHJlc2hvbGQ6IGEuYWxwaGFUaHJlc2hvbGQsIGNvbG9yVG9sZXJhbmNlOiBhLmNvbG9yVG9sZXJhbmNlLCBrZXlDb2xvcjogYS5rZXlDb2xvciB9O1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGdldE1hc2soKTogVWludDhBcnJheSB8IG51bGwge1xuICAgICAgICBpZiAoIXJhdy5waXhlbHMpIHJldHVybiBudWxsO1xuICAgICAgICBjb25zdCBvcHRzID0gbWFza09wdGlvbnMoKTtcbiAgICAgICAgY29uc3Qga2V5ID0gSlNPTi5zdHJpbmdpZnkob3B0cyk7XG4gICAgICAgIGlmIChyYXcubWFzayAmJiByYXcubWFza0tleSA9PT0ga2V5KSByZXR1cm4gcmF3Lm1hc2s7XG4gICAgICAgIHJhdy5tYXNrID0gYnVpbGRNYXNrKHJhdy5waXhlbHMsIG9wdHMpO1xuICAgICAgICByYXcubWFza0tleSA9IGtleTtcbiAgICAgICAgcmV0dXJuIHJhdy5tYXNrO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHRyaW1TZWxlY3RlZCgpIHtcbiAgICAgICAgaWYgKHN0YXRlLnJlYWRPbmx5KSByZXR1cm47XG4gICAgICAgIGNvbnN0IG1hc2sgPSBnZXRNYXNrKCk7XG4gICAgICAgIGlmICghbWFzayB8fCAhc3RhdGUuc2VsZWN0ZWQubGVuZ3RoKSByZXR1cm47XG4gICAgICAgIGNvbnN0IFcgPSBzdGF0ZS53aWR0aDtcbiAgICAgICAgY29uc3QgSCA9IHN0YXRlLmhlaWdodDtcbiAgICAgICAgbGV0IGVtcHR5ID0gMDtcbiAgICAgICAgc25hcHNob3QoKTtcbiAgICAgICAgZm9yIChjb25zdCByIG9mIHNlbGVjdGVkUmVjdHMudmFsdWUpIHtcbiAgICAgICAgICAgIGNvbnN0IHQgPSB0cmltQm94KG1hc2ssIFcsIEgsIHIpO1xuICAgICAgICAgICAgaWYgKCF0KSB7XG4gICAgICAgICAgICAgICAgZW1wdHkrKztcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHIueCA9IHQueDtcbiAgICAgICAgICAgIHIueSA9IHQueTtcbiAgICAgICAgICAgIHIudyA9IHQudztcbiAgICAgICAgICAgIHIuaCA9IHQuaDtcbiAgICAgICAgICAgIGNsYW1wUmVjdChyKTtcbiAgICAgICAgfVxuICAgICAgICBkaXNjYXJkU25hcHNob3RJZlNhbWUoKTtcbiAgICAgICAgaWYgKGVtcHR5KSBub3RpZnkoYCR7ZW1wdHl9IHNwcml0ZSBraMO0bmcgY8OzIHBpeGVsIG7DoG8gxJHhu4MgdHJpbS5gKTtcbiAgICAgICAgY2hhbmdlZCgpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHNsaWNlUGl2b3QoKTogW251bWJlciwgbnVtYmVyXSB7XG4gICAgICAgIGNvbnN0IHMgPSBzdGF0ZS5zbGljZTtcbiAgICAgICAgcmV0dXJuIHMucGl2b3QgPT09ICdjdXN0b20nID8gW2NsZWFuTnVtYmVyKHMucGl2b3RYKSwgY2xlYW5OdW1iZXIocy5waXZvdFkpXSA6IFBJVk9UX1BSRVNFVFNbcy5waXZvdF07XG4gICAgfVxuXG4gICAgLyoqIEJveGVzIHRoZSBjdXJyZW50IFNsaWNlIHNldHRpbmdzIHdvdWxkIHByb2R1Y2UgKGFsc28gdXNlZCBmb3IgdGhlIGdyaWQgcHJldmlldykuICovXG4gICAgZnVuY3Rpb24gc2xpY2VCb3hlcyhpbmNsdWRlRW1wdHk6IGJvb2xlYW4pOiBCb3hbXSB7XG4gICAgICAgIGlmICghcmF3LnBpeGVscykgcmV0dXJuIFtdO1xuICAgICAgICBjb25zdCBzID0gc3RhdGUuc2xpY2U7XG4gICAgICAgIGlmIChzLnR5cGUgPT09ICdhdXRvJykgcmV0dXJuIGRldGVjdFNwcml0ZXMocmF3LnBpeGVscywgcy5hdXRvKTtcbiAgICAgICAgbGV0IGJveGVzID0gZ3JpZEJveGVzKHN0YXRlLndpZHRoLCBzdGF0ZS5oZWlnaHQsIHMuZ3JpZCwgcy50eXBlID09PSAnY2VsbC1jb3VudCcpO1xuICAgICAgICBpZiAoIWluY2x1ZGVFbXB0eSAmJiAhcy5rZWVwRW1wdHkpIHtcbiAgICAgICAgICAgIGNvbnN0IG1hc2sgPSBnZXRNYXNrKCk7XG4gICAgICAgICAgICBpZiAobWFzaykgYm94ZXMgPSBib3hlcy5maWx0ZXIoKGIpID0+ICFpc0JveEVtcHR5KG1hc2ssIHN0YXRlLndpZHRoLCBzdGF0ZS5oZWlnaHQsIGIpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYm94ZXM7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZG9TbGljZSgpIHtcbiAgICAgICAgaWYgKHN0YXRlLnJlYWRPbmx5IHx8ICFyYXcucGl4ZWxzKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGJveGVzID0gc2xpY2VCb3hlcyhmYWxzZSk7XG4gICAgICAgIGlmICghYm94ZXMubGVuZ3RoKSB7XG4gICAgICAgICAgICBub3RpZnkoJ0tow7RuZyB0w6xtIHRo4bqleSBzcHJpdGUgbsOgbyB24bubaSB0aGnhur90IGzhuq1wIG7DoHkuJywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcGl2b3QgPSBzbGljZVBpdm90KCk7XG4gICAgICAgIGNvbnN0IG1ldGhvZCA9IHN0YXRlLnNsaWNlLm1ldGhvZDtcbiAgICAgICAgc25hcHNob3QoKTtcbiAgICAgICAgaWYgKG1ldGhvZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgICAgICAgIHN0YXRlLnJlY3RzID0gYm94ZXMubWFwKChiLCBpKSA9PiBtYWtlUmVjdChiLCBpLCBwaXZvdCkpO1xuICAgICAgICAgICAgc3RhdGUuc2VsZWN0ZWQgPSBbXTtcbiAgICAgICAgICAgIHN0YXRlLmN1c3RvbVBpdm90ID0gW107XG4gICAgICAgIH0gZWxzZSBpZiAobWV0aG9kID09PSAnc21hcnQnKSB7XG4gICAgICAgICAgICAvLyBVcGRhdGUgdGhlIGJlc3Qtb3ZlcmxhcHBpbmcgZXhpc3RpbmcgcmVjdCAoa2VlcHMgaXRzIG5hbWUsIHBpdm90IGFuZFxuICAgICAgICAgICAgLy8gYm9yZGVyLCBzbyByZWZlcmVuY2VzIHRvIGl0IHN1cnZpdmUpOyBhZGQgdGhlIHJlc3QgYXMgbmV3IHNwcml0ZXMuXG4gICAgICAgICAgICBjb25zdCB1c2VkID0gbmV3IFNldDxudW1iZXI+KCk7XG4gICAgICAgICAgICBsZXQgaW5kZXggPSBuZXh0SW5kZXgoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYiBvZiBib3hlcykge1xuICAgICAgICAgICAgICAgIGxldCBiZXN0OiBTcHJpdGVSZWN0IHwgbnVsbCA9IG51bGw7XG4gICAgICAgICAgICAgICAgbGV0IGJlc3RTY29yZSA9IDA7XG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCByIG9mIHN0YXRlLnJlY3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh1c2VkLmhhcyhyLmlkKSkgY29udGludWU7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHNjb3JlID0gaW91KHIsIGIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoc2NvcmUgPiBiZXN0U2NvcmUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJlc3RTY29yZSA9IHNjb3JlO1xuICAgICAgICAgICAgICAgICAgICAgICAgYmVzdCA9IHI7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKGJlc3QgJiYgYmVzdFNjb3JlID49IDAuMykge1xuICAgICAgICAgICAgICAgICAgICB1c2VkLmFkZChiZXN0LmlkKTtcbiAgICAgICAgICAgICAgICAgICAgYmVzdC54ID0gYi54O1xuICAgICAgICAgICAgICAgICAgICBiZXN0LnkgPSBiLnk7XG4gICAgICAgICAgICAgICAgICAgIGJlc3QudyA9IGIudztcbiAgICAgICAgICAgICAgICAgICAgYmVzdC5oID0gYi5oO1xuICAgICAgICAgICAgICAgICAgICBjbGFtcFJlY3QoYmVzdCk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUucmVjdHMucHVzaChtYWtlUmVjdChiLCBpbmRleCsrLCBwaXZvdCkpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFNhZmU6IG9ubHkgYWRkIHNwcml0ZXMgdGhhdCBkbyBub3QgdG91Y2ggYW55IGV4aXN0aW5nIHJlY3QuXG4gICAgICAgICAgICBsZXQgaW5kZXggPSBuZXh0SW5kZXgoKTtcbiAgICAgICAgICAgIGNvbnN0IGV4aXN0aW5nID0gc3RhdGUucmVjdHMuc2xpY2UoKTtcbiAgICAgICAgICAgIGZvciAoY29uc3QgYiBvZiBib3hlcykge1xuICAgICAgICAgICAgICAgIGlmIChleGlzdGluZy5zb21lKChyKSA9PiBpbnRlcnNlY3RBcmVhKHIsIGIpID4gMCkpIGNvbnRpbnVlO1xuICAgICAgICAgICAgICAgIHN0YXRlLnJlY3RzLnB1c2gobWFrZVJlY3QoYiwgaW5kZXgrKywgcGl2b3QpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBkaXNjYXJkU25hcHNob3RJZlNhbWUoKTtcbiAgICAgICAgc3RhdGUuc2xpY2VPcGVuID0gZmFsc2U7XG4gICAgICAgIG5vdGlmeShgU2xpY2U6ICR7c3RhdGUucmVjdHMubGVuZ3RofSBzcHJpdGUuYCk7XG4gICAgICAgIGNoYW5nZWQoKTtcbiAgICB9XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBsb2FkIC8gc2F2ZVxuXG4gICAgYXN5bmMgZnVuY3Rpb24gZGVjb2RlSW1hZ2UodXJsOiBzdHJpbmcpOiBQcm9taXNlPEhUTUxJbWFnZUVsZW1lbnQ+IHtcbiAgICAgICAgY29uc3QgaW1nID0gbmV3IEltYWdlKCk7XG4gICAgICAgIGltZy5zcmMgPSB1cmw7XG4gICAgICAgIGF3YWl0IGltZy5kZWNvZGUoKTtcbiAgICAgICAgcmV0dXJuIGltZztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiByZWFkUGl4ZWxzKGltZzogSFRNTEltYWdlRWxlbWVudCk6IEltYWdlRGF0YSB7XG4gICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgICAgYy53aWR0aCA9IGltZy5uYXR1cmFsV2lkdGg7XG4gICAgICAgIGMuaGVpZ2h0ID0gaW1nLm5hdHVyYWxIZWlnaHQ7XG4gICAgICAgIGNvbnN0IGN0eCA9IGMuZ2V0Q29udGV4dCgnMmQnLCB7IHdpbGxSZWFkRnJlcXVlbnRseTogdHJ1ZSB9IGFzIENhbnZhc1JlbmRlcmluZ0NvbnRleHQyRFNldHRpbmdzKSE7XG4gICAgICAgIGN0eC5kcmF3SW1hZ2UoaW1nLCAwLCAwKTtcbiAgICAgICAgcmV0dXJuIGN0eC5nZXRJbWFnZURhdGEoMCwgMCwgYy53aWR0aCwgYy5oZWlnaHQpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGFscGhhQ2FudmFzKCk6IEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbCB7XG4gICAgICAgIGlmIChyYXcuYWxwaGFDYW52YXMgfHwgIXJhdy5waXhlbHMpIHJldHVybiByYXcuYWxwaGFDYW52YXM7XG4gICAgICAgIGNvbnN0IHNyYyA9IHJhdy5waXhlbHM7XG4gICAgICAgIGNvbnN0IGMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKTtcbiAgICAgICAgYy53aWR0aCA9IHNyYy53aWR0aDtcbiAgICAgICAgYy5oZWlnaHQgPSBzcmMuaGVpZ2h0O1xuICAgICAgICBjb25zdCBjdHggPSBjLmdldENvbnRleHQoJzJkJykhO1xuICAgICAgICBjb25zdCBvdXQgPSBjdHguY3JlYXRlSW1hZ2VEYXRhKHNyYy53aWR0aCwgc3JjLmhlaWdodCk7XG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgc3JjLmRhdGEubGVuZ3RoOyBpICs9IDQpIHtcbiAgICAgICAgICAgIGNvbnN0IGEgPSBzcmMuZGF0YVtpICsgM107XG4gICAgICAgICAgICBvdXQuZGF0YVtpXSA9IGE7XG4gICAgICAgICAgICBvdXQuZGF0YVtpICsgMV0gPSBhO1xuICAgICAgICAgICAgb3V0LmRhdGFbaSArIDJdID0gYTtcbiAgICAgICAgICAgIG91dC5kYXRhW2kgKyAzXSA9IDI1NTtcbiAgICAgICAgfVxuICAgICAgICBjdHgucHV0SW1hZ2VEYXRhKG91dCwgMCwgMCk7XG4gICAgICAgIHJhdy5hbHBoYUNhbnZhcyA9IGM7XG4gICAgICAgIHJldHVybiBjO1xuICAgIH1cblxuICAgIGFzeW5jIGZ1bmN0aW9uIHNldEltYWdlKHVybDogc3RyaW5nLCByZXZva2U6ICgpID0+IHZvaWQpIHtcbiAgICAgICAgY29uc3QgaW1nID0gYXdhaXQgZGVjb2RlSW1hZ2UodXJsKTtcbiAgICAgICAgaWYgKHJhdy5yZXZva2VJbWFnZSkgcmF3LnJldm9rZUltYWdlKCk7XG4gICAgICAgIHJhdy5yZXZva2VJbWFnZSA9IHJldm9rZTtcbiAgICAgICAgcmF3LmltYWdlID0gaW1nO1xuICAgICAgICByYXcucGl4ZWxzID0gcmVhZFBpeGVscyhpbWcpO1xuICAgICAgICByYXcuYWxwaGFDYW52YXMgPSBudWxsO1xuICAgICAgICByYXcubWFzayA9IG51bGw7XG4gICAgICAgIHJhdy5tYXNrS2V5ID0gJyc7XG4gICAgICAgIHN0YXRlLmltYWdlVXJsID0gdXJsO1xuICAgICAgICBzdGF0ZS53aWR0aCA9IGltZy5uYXR1cmFsV2lkdGg7XG4gICAgICAgIHN0YXRlLmhlaWdodCA9IGltZy5uYXR1cmFsSGVpZ2h0O1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEFzayB3aGF0IHRvIGRvIHdpdGggdW5hcHBsaWVkIGNoYW5nZXMuIFJlc29sdmVzIGZhbHNlIHdoZW4gdGhlIHVzZXIgY2FuY2Vscy5cbiAgICAgKiBNaXJyb3JzIFVuaXR5J3MgXCJVbmFwcGxpZWQgaW1wb3J0IHNldHRpbmdzXCIgZGlhbG9nLlxuICAgICAqL1xuICAgIGFzeW5jIGZ1bmN0aW9uIGNvbmZpcm1EaXNjYXJkKCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgICAgICBpZiAoIWRpcnR5LnZhbHVlIHx8ICFzdGF0ZS50ZXh0dXJlKSByZXR1cm4gdHJ1ZTtcbiAgICAgICAgY29uc3QgY2hvaWNlID0gYXdhaXQgYnJpZGdlLmFzayhcbiAgICAgICAgICAgIGBDaMawYSBBcHBseSB0aGF5IMSR4buVaSBjaG8gXCIke3N0YXRlLnRleHR1cmUuZmlsZU5hbWV9XCJgLFxuICAgICAgICAgICAgJ0FwcGx5IMSR4buDIGzGsHUgY8OhYyBzcHJpdGUgdsOgbyBmaWxlIC5wbGlzdCwgUmV2ZXJ0IMSR4buDIGLhu48gdGhheSDEkeG7lWkuJyxcbiAgICAgICAgICAgIFsnQXBwbHknLCAnUmV2ZXJ0JywgJ0jhu6d5J10sXG4gICAgICAgICAgICAwLFxuICAgICAgICAgICAgMixcbiAgICAgICAgKTtcbiAgICAgICAgaWYgKGNob2ljZSA9PT0gMikgcmV0dXJuIGZhbHNlO1xuICAgICAgICBpZiAoY2hvaWNlID09PSAwKSByZXR1cm4gYXBwbHkoKTtcbiAgICAgICAgcmV2ZXJ0KCk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIGZvY3VzRnJhbWUobmFtZTogc3RyaW5nIHwgbnVsbCkge1xuICAgICAgICBpZiAoIW5hbWUpIHJldHVybjtcbiAgICAgICAgY29uc3QgciA9IHN0YXRlLnJlY3RzLmZpbmQoKHgpID0+IHgubmFtZSA9PT0gbmFtZSk7XG4gICAgICAgIGlmIChyKSBzZWxlY3QoW3IuaWRdKTtcbiAgICB9XG5cbiAgICBsZXQgbG9hZFNlcSA9IDA7XG5cbiAgICBhc3luYyBmdW5jdGlvbiBsb2FkKHV1aWQ6IHN0cmluZywgb3B0czogTG9hZE9wdGlvbnMgPSB7fSk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgICAgICBsZXQgdGFyZ2V0O1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGFyZ2V0ID0gYXdhaXQgYnJpZGdlLnJlc29sdmUodXVpZCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGlmICghb3B0cy5mcm9tU2VsZWN0aW9uKSBub3RpZnkoU3RyaW5nKChlIGFzIEVycm9yKS5tZXNzYWdlIHx8IGUpLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXRhcmdldCkge1xuICAgICAgICAgICAgaWYgKCFvcHRzLmZyb21TZWxlY3Rpb24pIG5vdGlmeSgnQXNzZXQgbsOgeSBraMO0bmcgcGjhuqNpIOG6o25oIChUZXh0dXJlIC8gU3ByaXRlRnJhbWUgLyAucGxpc3QpLicsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHNhbWUgPSBzdGF0ZS50ZXh0dXJlICYmIHN0YXRlLnRleHR1cmUuaW1hZ2VVdWlkID09PSB0YXJnZXQuaW5mby5pbWFnZVV1aWQ7XG4gICAgICAgIGlmIChzYW1lICYmICFvcHRzLmZvcmNlKSB7XG4gICAgICAgICAgICBmb2N1c0ZyYW1lKHRhcmdldC5mb2N1c0ZyYW1lKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc2FtZSAmJiAhKGF3YWl0IGNvbmZpcm1EaXNjYXJkKCkpKSByZXR1cm4gZmFsc2U7XG5cbiAgICAgICAgY29uc3Qgc2VxID0gKytsb2FkU2VxO1xuICAgICAgICBzdGF0ZS5sb2FkaW5nID0gdHJ1ZTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IFtpbWcsIHNoZWV0XSA9IGF3YWl0IFByb21pc2UuYWxsKFticmlkZ2UubG9hZEltYWdlKHRhcmdldC5pbmZvKSwgYnJpZGdlLnJlYWRTaGVldCh0YXJnZXQuaW5mbyldKTtcbiAgICAgICAgICAgIGlmIChzZXEgIT09IGxvYWRTZXEpIHtcbiAgICAgICAgICAgICAgICBpbWcucmV2b2tlKCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYXdhaXQgc2V0SW1hZ2UoaW1nLnVybCwgaW1nLnJldm9rZSk7XG4gICAgICAgICAgICBzdGF0ZS50ZXh0dXJlID0gdGFyZ2V0LmluZm87XG4gICAgICAgICAgICBzdGF0ZS5yZWN0cyA9IHdpdGhJZHMoc2hlZXQucmVjdHMpO1xuICAgICAgICAgICAgc3RhdGUuc2F2ZWQgPSBzZXJpYWxpemUoKTtcbiAgICAgICAgICAgIHN0YXRlLnNlbGVjdGVkID0gW107XG4gICAgICAgICAgICBzdGF0ZS5jdXN0b21QaXZvdCA9IFtdO1xuICAgICAgICAgICAgc3RhdGUuaGFzUGxpc3QgPSBzaGVldC5oYXNQbGlzdDtcbiAgICAgICAgICAgIHN0YXRlLnJlYWRPbmx5ID0gc2hlZXQucmVhZE9ubHlSZWFzb247XG4gICAgICAgICAgICBzdGF0ZS53YXJuaW5nID0gc2hlZXQud2FybmluZztcbiAgICAgICAgICAgIHN0YXRlLnNsaWNlT3BlbiA9IGZhbHNlO1xuICAgICAgICAgICAgcmF3LnVuZG8ubGVuZ3RoID0gMDtcbiAgICAgICAgICAgIHJhdy5yZWRvLmxlbmd0aCA9IDA7XG4gICAgICAgICAgICByYXcubGFzdEtleSA9ICcnO1xuICAgICAgICAgICAgY29uc3QgZyA9IHN0YXRlLnNsaWNlLmdyaWQ7XG4gICAgICAgICAgICBpZiAoIXNoZWV0Lmhhc1BsaXN0KSB7XG4gICAgICAgICAgICAgICAgLy8gU2Vuc2libGUgZ3JpZCBkZWZhdWx0cyBmb3IgYSBuZXcgdGV4dHVyZS5cbiAgICAgICAgICAgICAgICBnLmNlbGxXID0gTWF0aC5taW4oZy5jZWxsVywgc3RhdGUud2lkdGgpO1xuICAgICAgICAgICAgICAgIGcuY2VsbEggPSBNYXRoLm1pbihnLmNlbGxILCBzdGF0ZS5oZWlnaHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZm9jdXNGcmFtZSh0YXJnZXQuZm9jdXNGcmFtZSk7XG4gICAgICAgICAgICBjaGFuZ2VkKCk7XG4gICAgICAgICAgICByYXcubG9hZGVkTGlzdGVuZXJzLmZvckVhY2goKGZuKSA9PiBmbigpKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgICBub3RpZnkoYEtow7RuZyBt4bufIMSRxrDhu6NjIOG6o25oOiAkeyhlIGFzIEVycm9yKS5tZXNzYWdlIHx8IGV9YCwgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBpZiAoc2VxID09PSBsb2FkU2VxKSBzdGF0ZS5sb2FkaW5nID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKiogUmUtcmVhZCBwaXhlbHMgYWZ0ZXIgdGhlIGltYWdlIGZpbGUgY2hhbmdlZCBvbiBkaXNrOyBrZWVwcyB0aGUgcmVjdHMuICovXG4gICAgYXN5bmMgZnVuY3Rpb24gcmVsb2FkSW1hZ2UoKSB7XG4gICAgICAgIGlmICghc3RhdGUudGV4dHVyZSkgcmV0dXJuO1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3QgaW1nID0gYXdhaXQgYnJpZGdlLmxvYWRJbWFnZShzdGF0ZS50ZXh0dXJlKTtcbiAgICAgICAgICAgIGF3YWl0IHNldEltYWdlKGltZy51cmwsIGltZy5yZXZva2UpO1xuICAgICAgICAgICAgZm9yIChjb25zdCByIG9mIHN0YXRlLnJlY3RzKSBjbGFtcFJlY3Qocik7XG4gICAgICAgICAgICBjaGFuZ2VkKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIG5vdGlmeShgS2jDtG5nIMSR4buNYyBs4bqhaSDEkcaw4bujYyDhuqNuaDogJHsoZSBhcyBFcnJvcikubWVzc2FnZSB8fCBlfWAsIHRydWUpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqIEZpcnN0IHZhbGlkYXRpb24gcHJvYmxlbSwgd2l0aCB0aGUgcmVjdCBpdCBiZWxvbmdzIHRvLiAqL1xuICAgIGZ1bmN0aW9uIHZhbGlkYXRlKCk6IHsgaWQ6IG51bWJlcjsgbWVzc2FnZTogc3RyaW5nIH0gfCBudWxsIHtcbiAgICAgICAgY29uc3Qgc2VlbiA9IG5ldyBNYXA8c3RyaW5nLCBudW1iZXI+KCk7XG4gICAgICAgIGZvciAoY29uc3QgciBvZiBzdGF0ZS5yZWN0cykge1xuICAgICAgICAgICAgY29uc3QgZXJyID0gdmFsaWRhdGVGcmFtZU5hbWUoci5uYW1lKTtcbiAgICAgICAgICAgIGlmIChlcnIpIHJldHVybiB7IGlkOiByLmlkLCBtZXNzYWdlOiBgXCIke3IubmFtZX1cIjogJHtlcnJ9YCB9O1xuICAgICAgICAgICAgY29uc3Qga2V5ID0gci5uYW1lO1xuICAgICAgICAgICAgaWYgKHNlZW4uaGFzKGtleSkpIHJldHVybiB7IGlkOiByLmlkLCBtZXNzYWdlOiBgVHLDuW5nIHTDqm4gc3ByaXRlIFwiJHtyLm5hbWV9XCIuIE3hu5dpIHNwcml0ZSBj4bqnbiBt4buZdCB0w6puIHJpw6puZy5gIH07XG4gICAgICAgICAgICBzZWVuLnNldChrZXksIHIuaWQpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIGFzeW5jIGZ1bmN0aW9uIGFwcGx5KCk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgICAgICBjb25zdCB0ZXggPSBzdGF0ZS50ZXh0dXJlO1xuICAgICAgICBpZiAoIXRleCB8fCBzdGF0ZS5yZWFkT25seSB8fCBzdGF0ZS5hcHBseWluZykgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBwcm9ibGVtID0gdmFsaWRhdGUoKTtcbiAgICAgICAgaWYgKHByb2JsZW0pIHtcbiAgICAgICAgICAgIHNlbGVjdChbcHJvYmxlbS5pZF0pO1xuICAgICAgICAgICAgbm90aWZ5KHByb2JsZW0ubWVzc2FnZSwgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgLy8gUmVuYW1pbmcvcmVtb3ZpbmcgYSBmcmFtZSBjaGFuZ2VzIGl0cyBzdWItYXNzZXQgdXVpZDogd2FybiBsaWtlIFVuaXR5IGRvZXMuXG4gICAgICAgIGlmIChzdGF0ZS5oYXNQbGlzdCkge1xuICAgICAgICAgICAgY29uc3QgYmVmb3JlOiBSZWN0RGF0YVtdID0gSlNPTi5wYXJzZShzdGF0ZS5zYXZlZCk7XG4gICAgICAgICAgICBjb25zdCBub3cgPSBuZXcgU2V0KHN0YXRlLnJlY3RzLm1hcCgocikgPT4gci5uYW1lKSk7XG4gICAgICAgICAgICBjb25zdCBsb3N0ID0gYmVmb3JlLm1hcCgocikgPT4gci5uYW1lKS5maWx0ZXIoKG4pID0+ICFub3cuaGFzKG4pKTtcbiAgICAgICAgICAgIGlmIChsb3N0Lmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIGNvbnN0IGxpc3QgPSBsb3N0LnNsaWNlKDAsIDgpLmpvaW4oJywgJykgKyAobG9zdC5sZW5ndGggPiA4ID8gYOKApiAoKyR7bG9zdC5sZW5ndGggLSA4fSlgIDogJycpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGNob2ljZSA9IGF3YWl0IGJyaWRnZS5hc2soXG4gICAgICAgICAgICAgICAgICAgICdN4buZdCBz4buRIHNwcml0ZSDEkcOjIGLhu4sgxJHhu5VpIHTDqm4gaG/hurdjIHjDs2EnLFxuICAgICAgICAgICAgICAgICAgICBgJHtsaXN0fVxcblxcblNjZW5lL1ByZWZhYi9BbmltYXRpb24gxJFhbmcgZMO5bmcgY8OhYyBzcHJpdGUgbsOgeSBz4bq9IG3huqV0IHRoYW0gY2hp4bq/dSBzYXUga2hpIEFwcGx5LmAsXG4gICAgICAgICAgICAgICAgICAgIFsnVuG6q24gQXBwbHknLCAnSOG7p3knXSxcbiAgICAgICAgICAgICAgICAgICAgMSxcbiAgICAgICAgICAgICAgICAgICAgMSxcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGlmIChjaG9pY2UgIT09IDApIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzdGF0ZS5hcHBseWluZyA9IHRydWU7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhOiBSZWN0RGF0YVtdID0gc3RhdGUucmVjdHMubWFwKCh7IGlkLCAuLi5yIH0pID0+IHIpO1xuICAgICAgICAgICAgY29uc3QgcmVzID0gYXdhaXQgYnJpZGdlLndyaXRlU2hlZXQodGV4LCBkYXRhLCBzdGF0ZS53aWR0aCwgc3RhdGUuaGVpZ2h0KTtcbiAgICAgICAgICAgIHN0YXRlLnNhdmVkID0gc2VyaWFsaXplKCk7XG4gICAgICAgICAgICBzdGF0ZS5oYXNQbGlzdCA9IHRydWU7XG4gICAgICAgICAgICBzdGF0ZS53YXJuaW5nID0gbnVsbDtcbiAgICAgICAgICAgIGlmIChyZXMud2FybmluZ3MubGVuZ3RoKSBub3RpZnkocmVzLndhcm5pbmdzLmpvaW4oJyAnKSwgdHJ1ZSk7XG4gICAgICAgICAgICBlbHNlIG5vdGlmeShgxJDDoyBBcHBseSAke2RhdGEubGVuZ3RofSBzcHJpdGUg4oaSICR7dGV4LmJhc2VOYW1lfS5wbGlzdGApO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIG5vdGlmeShgQXBwbHkgdGjhuqV0IGLhuqFpOiAkeyhlIGFzIEVycm9yKS5tZXNzYWdlIHx8IGV9YCwgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBzdGF0ZS5hcHBseWluZyA9IGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcmV2ZXJ0KCkge1xuICAgICAgICBpZiAoIWRpcnR5LnZhbHVlKSByZXR1cm47XG4gICAgICAgIHNuYXBzaG90KCk7XG4gICAgICAgIGNvbnN0IHNhdmVkOiBSZWN0RGF0YVtdID0gSlNPTi5wYXJzZShzdGF0ZS5zYXZlZCk7XG4gICAgICAgIHN0YXRlLnJlY3RzID0gd2l0aElkcyhzYXZlZCk7XG4gICAgICAgIHN0YXRlLnNlbGVjdGVkID0gW107XG4gICAgICAgIHN0YXRlLmN1c3RvbVBpdm90ID0gW107XG4gICAgICAgIGNoYW5nZWQoKTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvbkNoYW5nZShmbjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgICAgICByYXcubGlzdGVuZXJzLmFkZChmbik7XG4gICAgICAgIHJldHVybiAoKSA9PiByYXcubGlzdGVuZXJzLmRlbGV0ZShmbik7XG4gICAgfVxuXG4gICAgLyoqIENhbGxlZCBhZnRlciBhIHRleHR1cmUgaGFzIGJlZW4gKHJlKW9wZW5lZC4gKi9cbiAgICBmdW5jdGlvbiBvbkxvYWRlZChmbjogKCkgPT4gdm9pZCk6ICgpID0+IHZvaWQge1xuICAgICAgICByYXcubG9hZGVkTGlzdGVuZXJzLmFkZChmbik7XG4gICAgICAgIHJldHVybiAoKSA9PiByYXcubG9hZGVkTGlzdGVuZXJzLmRlbGV0ZShmbik7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gZGlzcG9zZSgpIHtcbiAgICAgICAgaWYgKHJhdy5yZXZva2VJbWFnZSkgcmF3LnJldm9rZUltYWdlKCk7XG4gICAgICAgIHJhdy5yZXZva2VJbWFnZSA9IG51bGw7XG4gICAgICAgIHJhdy5saXN0ZW5lcnMuY2xlYXIoKTtcbiAgICAgICAgcmF3LmxvYWRlZExpc3RlbmVycy5jbGVhcigpO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHN0YXRlLFxuICAgICAgICByYXcsXG4gICAgICAgIGRpcnR5LFxuICAgICAgICBzZWxlY3RlZFJlY3RzLFxuICAgICAgICBzaW5nbGUsXG4gICAgICAgIGNoYW5nZWQsXG4gICAgICAgIG5vdGlmeSxcbiAgICAgICAgc25hcHNob3QsXG4gICAgICAgIGRpc2NhcmRTbmFwc2hvdElmU2FtZSxcbiAgICAgICAgdW5kbyxcbiAgICAgICAgcmVkbyxcbiAgICAgICAgc2VsZWN0LFxuICAgICAgICBzZWxlY3RBbGwsXG4gICAgICAgIGJ5SWQsXG4gICAgICAgIGNsYW1wUmVjdCxcbiAgICAgICAgYWRkUmVjdCxcbiAgICAgICAgZGVsZXRlU2VsZWN0ZWQsXG4gICAgICAgIHBhdGNoUmVjdCxcbiAgICAgICAgc2V0UGl2b3RQcmVzZXQsXG4gICAgICAgIG51ZGdlLFxuICAgICAgICB0cmltU2VsZWN0ZWQsXG4gICAgICAgIHNsaWNlQm94ZXMsXG4gICAgICAgIGRvU2xpY2UsXG4gICAgICAgIGFscGhhQ2FudmFzLFxuICAgICAgICBsb2FkLFxuICAgICAgICByZWxvYWRJbWFnZSxcbiAgICAgICAgY29uZmlybURpc2NhcmQsXG4gICAgICAgIGFwcGx5LFxuICAgICAgICByZXZlcnQsXG4gICAgICAgIG9uQ2hhbmdlLFxuICAgICAgICBvbkxvYWRlZCxcbiAgICAgICAgZGlzcG9zZSxcbiAgICAgICAgY2FuVW5kbzogKCkgPT4gcmF3LnVuZG8ubGVuZ3RoID4gMCxcbiAgICAgICAgY2FuUmVkbzogKCkgPT4gcmF3LnJlZG8ubGVuZ3RoID4gMCxcbiAgICB9O1xufVxuXG5leHBvcnQgdHlwZSBTdG9yZSA9IFJldHVyblR5cGU8dHlwZW9mIGNyZWF0ZVN0b3JlPjtcbiJdfQ==