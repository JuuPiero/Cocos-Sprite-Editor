/**
 * Editor state and actions (Vue reactive). The viewport and the Vue template
 * both read/write through this store.
 */
import { computed, reactive } from 'vue';
import { RectData, SheetBridge, TextureInfo } from '../../core/bridge';
import { validateFrameName } from '../../core/plist';
import {
    buildMask, clampBox, detectSprites, gridBoxes, intersectArea, iou, isBoxEmpty, trimBox,
} from '../../core/slicer';
import {
    AutoSliceOptions, Box, GridOptions, MaskOptions, PIVOT_PRESETS, PivotPreset, SliceMethod, SliceType, SpriteRect,
} from '../../core/types';

export interface SliceSettings {
    type: SliceType;
    method: SliceMethod;
    pivot: PivotPreset;
    pivotX: number;
    pivotY: number;
    keepEmpty: boolean;
    auto: AutoSliceOptions;
    grid: GridOptions;
}

export interface LoadOptions {
    /** Triggered by Assets selection: ignore non-image assets silently. */
    fromSelection?: boolean;
    /** Reload even if the texture is already open. */
    force?: boolean;
}

const UNDO_LIMIT = 200;
const COALESCE_MS = 800;

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

function cleanNumber(v: number, digits = 4): number {
    const p = Math.pow(10, digits);
    return Math.round(v * p) / p;
}

export function createStore(bridge: SheetBridge) {
    const state = reactive({
        texture: null as TextureInfo | null,
        imageUrl: '',
        width: 0,
        height: 0,
        rects: [] as SpriteRect[],
        selected: [] as number[],
        /** Rect ids whose pivot dropdown shows "Custom" even if the value matches a preset. */
        customPivot: [] as number[],
        hasPlist: false,
        readOnly: null as string | null,
        warning: null as string | null,
        loading: false,
        applying: false,
        notice: '',
        noticeError: false,
        noticeSeq: 0,
        showAlpha: false,
        sliceOpen: false,
        pivotUnit: 'normalized' as 'normalized' | 'pixels',
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
        } as SliceSettings,
    });

    /** Large / non-reactive data. */
    const raw = {
        image: null as HTMLImageElement | null,
        pixels: null as ImageData | null,
        alphaCanvas: null as HTMLCanvasElement | null,
        revokeImage: null as null | (() => void),
        maskKey: '',
        mask: null as Uint8Array | null,
        undo: [] as string[],
        redo: [] as string[],
        lastKey: '',
        lastTime: 0,
        uid: 1,
        listeners: new Set<() => void>(),
        loadedListeners: new Set<() => void>(),
    };

    const serialize = () => JSON.stringify(state.rects.map(({ id, ...r }) => r));
    const dirty = computed(() => !!state.texture && serialize() !== state.saved);
    const selectedRects = computed(() => {
        const ids = new Set(state.selected);
        return state.rects.filter((r) => ids.has(r.id));
    });
    const single = computed(() => (selectedRects.value.length === 1 ? selectedRects.value[0] : null));

    function changed() {
        raw.listeners.forEach((fn) => fn());
    }

    function notify(msg: string, error = false) {
        state.notice = msg;
        state.noticeError = error;
        state.noticeSeq++;
    }

    function withIds(list: RectData[]): SpriteRect[] {
        return list.map((r) => ({ ...r, id: raw.uid++ }));
    }

    // ---------------------------------------------------------------- history

    /**
     * Record the current rects before a change. Calls with the same key within a
     * short time collapse into one undo step (used by scrubbing / typing).
     */
    function snapshot(key = '') {
        if (state.readOnly) return;
        const now = Date.now();
        if (key && key === raw.lastKey && now - raw.lastTime < COALESCE_MS) {
            raw.lastTime = now;
            return;
        }
        raw.lastKey = key;
        raw.lastTime = now;
        raw.undo.push(JSON.stringify(state.rects));
        if (raw.undo.length > UNDO_LIMIT) raw.undo.shift();
        raw.redo.length = 0;
    }

    /** Drop the last snapshot if nothing actually changed (e.g. click without drag). */
    function discardSnapshotIfSame() {
        const last = raw.undo[raw.undo.length - 1];
        if (last !== undefined && last === JSON.stringify(state.rects)) raw.undo.pop();
    }

    function restore(json: string) {
        state.rects = JSON.parse(json);
        const ids = new Set(state.rects.map((r) => r.id));
        state.selected = state.selected.filter((id) => ids.has(id));
        raw.lastKey = '';
        changed();
    }

    function undo() {
        const prev = raw.undo.pop();
        if (prev === undefined) return;
        raw.redo.push(JSON.stringify(state.rects));
        restore(prev);
    }

    function redo() {
        const next = raw.redo.pop();
        if (next === undefined) return;
        raw.undo.push(JSON.stringify(state.rects));
        restore(next);
    }

    // -------------------------------------------------------------- selection

    function select(ids: number[], additive = false) {
        if (additive) {
            const set = new Set(state.selected);
            for (const id of ids) {
                if (set.has(id)) set.delete(id);
                else set.add(id);
            }
            state.selected = [...set];
        } else {
            state.selected = ids.slice();
        }
        changed();
    }

    function selectAll() {
        select(state.rects.map((r) => r.id));
    }

    function byId(id: number): SpriteRect | undefined {
        return state.rects.find((r) => r.id === id);
    }

    // ------------------------------------------------------------- rect edits

    function clampRect(r: SpriteRect) {
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

    function nextIndex(): number {
        const base = state.texture ? state.texture.baseName : 'sprite';
        const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`);
        let max = -1;
        for (const r of state.rects) {
            const m = re.exec(r.name);
            if (m) max = Math.max(max, Number(m[1]));
        }
        return max + 1;
    }

    function makeRect(box: Box, index: number, pivot: [number, number]): SpriteRect {
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

    function addRect(box: Box): SpriteRect | null {
        if (state.readOnly || !state.texture) return null;
        const b = clampBox(box, state.width, state.height);
        if (!b) return null;
        snapshot();
        const r = makeRect(b, nextIndex(), [0.5, 0.5]);
        state.rects.push(r);
        state.selected = [r.id];
        changed();
        return r;
    }

    function deleteSelected() {
        if (state.readOnly || !state.selected.length) return;
        snapshot();
        const ids = new Set(state.selected);
        state.rects = state.rects.filter((r) => !ids.has(r.id));
        state.selected = [];
        changed();
    }

    /** Inspector edit of one field. Numbers are clamped; names validated on apply. */
    function patchRect(id: number, patch: Partial<RectData>) {
        const r = byId(id);
        if (!r || state.readOnly) return;
        snapshot(`patch:${id}:${Object.keys(patch).join(',')}`);
        Object.assign(r, patch);
        if (patch.pivotX !== undefined || patch.pivotY !== undefined) {
            r.pivotX = cleanNumber(r.pivotX);
            r.pivotY = cleanNumber(r.pivotY);
        } else {
            clampRect(r);
        }
        changed();
    }

    function setPivotPreset(ids: number[], preset: PivotPreset) {
        if (state.readOnly) return;
        if (preset === 'custom') {
            state.customPivot = [...new Set([...state.customPivot, ...ids])];
            return;
        }
        const idSet = new Set(ids);
        state.customPivot = state.customPivot.filter((id) => !idSet.has(id));
        snapshot();
        const [px, py] = PIVOT_PRESETS[preset];
        for (const r of state.rects) {
            if (!idSet.has(r.id)) continue;
            r.pivotX = px;
            r.pivotY = py;
        }
        changed();
    }

    function nudge(dx: number, dy: number) {
        if (state.readOnly || !state.selected.length) return;
        snapshot('nudge');
        for (const r of selectedRects.value) {
            r.x += dx;
            r.y += dy;
            clampRect(r);
        }
        changed();
    }

    // ---------------------------------------------------------------- pixels

    function maskOptions(): MaskOptions {
        const a = state.slice.auto;
        return { mode: a.mode, alphaThreshold: a.alphaThreshold, colorTolerance: a.colorTolerance, keyColor: a.keyColor };
    }

    function getMask(): Uint8Array | null {
        if (!raw.pixels) return null;
        const opts = maskOptions();
        const key = JSON.stringify(opts);
        if (raw.mask && raw.maskKey === key) return raw.mask;
        raw.mask = buildMask(raw.pixels, opts);
        raw.maskKey = key;
        return raw.mask;
    }

    function trimSelected() {
        if (state.readOnly) return;
        const mask = getMask();
        if (!mask || !state.selected.length) return;
        const W = state.width;
        const H = state.height;
        let empty = 0;
        snapshot();
        for (const r of selectedRects.value) {
            const t = trimBox(mask, W, H, r);
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
        if (empty) notify(`${empty} sprite không có pixel nào để trim.`);
        changed();
    }

    function slicePivot(): [number, number] {
        const s = state.slice;
        return s.pivot === 'custom' ? [cleanNumber(s.pivotX), cleanNumber(s.pivotY)] : PIVOT_PRESETS[s.pivot];
    }

    /** Boxes the current Slice settings would produce (also used for the grid preview). */
    function sliceBoxes(includeEmpty: boolean): Box[] {
        if (!raw.pixels) return [];
        const s = state.slice;
        if (s.type === 'auto') return detectSprites(raw.pixels, s.auto);
        let boxes = gridBoxes(state.width, state.height, s.grid, s.type === 'cell-count');
        if (!includeEmpty && !s.keepEmpty) {
            const mask = getMask();
            if (mask) boxes = boxes.filter((b) => !isBoxEmpty(mask, state.width, state.height, b));
        }
        return boxes;
    }

    function doSlice() {
        if (state.readOnly || !raw.pixels) return;
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
        } else if (method === 'smart') {
            // Update the best-overlapping existing rect (keeps its name, pivot and
            // border, so references to it survive); add the rest as new sprites.
            const used = new Set<number>();
            let index = nextIndex();
            for (const b of boxes) {
                let best: SpriteRect | null = null;
                let bestScore = 0;
                for (const r of state.rects) {
                    if (used.has(r.id)) continue;
                    const score = iou(r, b);
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
                } else {
                    state.rects.push(makeRect(b, index++, pivot));
                }
            }
        } else {
            // Safe: only add sprites that do not touch any existing rect.
            let index = nextIndex();
            const existing = state.rects.slice();
            for (const b of boxes) {
                if (existing.some((r) => intersectArea(r, b) > 0)) continue;
                state.rects.push(makeRect(b, index++, pivot));
            }
        }
        discardSnapshotIfSame();
        state.sliceOpen = false;
        notify(`Slice: ${state.rects.length} sprite.`);
        changed();
    }

    // ----------------------------------------------------------- load / save

    async function decodeImage(url: string): Promise<HTMLImageElement> {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img;
    }

    function readPixels(img: HTMLImageElement): ImageData {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
    }

    function alphaCanvas(): HTMLCanvasElement | null {
        if (raw.alphaCanvas || !raw.pixels) return raw.alphaCanvas;
        const src = raw.pixels;
        const c = document.createElement('canvas');
        c.width = src.width;
        c.height = src.height;
        const ctx = c.getContext('2d')!;
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

    async function setImage(url: string, revoke: () => void) {
        const img = await decodeImage(url);
        if (raw.revokeImage) raw.revokeImage();
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
    async function confirmDiscard(): Promise<boolean> {
        if (!dirty.value || !state.texture) return true;
        const choice = await bridge.ask(
            `Chưa Apply thay đổi cho "${state.texture.fileName}"`,
            'Apply để lưu các sprite vào file .plist, Revert để bỏ thay đổi.',
            ['Apply', 'Revert', 'Hủy'],
            0,
            2,
        );
        if (choice === 2) return false;
        if (choice === 0) return apply();
        revert();
        return true;
    }

    function focusFrame(name: string | null) {
        if (!name) return;
        const r = state.rects.find((x) => x.name === name);
        if (r) select([r.id]);
    }

    let loadSeq = 0;

    async function load(uuid: string, opts: LoadOptions = {}): Promise<boolean> {
        let target;
        try {
            target = await bridge.resolve(uuid);
        } catch (e) {
            if (!opts.fromSelection) notify(String((e as Error).message || e), true);
            return false;
        }
        if (!target) {
            if (!opts.fromSelection) notify('Asset này không phải ảnh (Texture / SpriteFrame / .plist).', true);
            return false;
        }
        const same = state.texture && state.texture.imageUuid === target.info.imageUuid;
        if (same && !opts.force) {
            focusFrame(target.focusFrame);
            return true;
        }
        if (!same && !(await confirmDiscard())) return false;

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
        } catch (e) {
            notify(`Không mở được ảnh: ${(e as Error).message || e}`, true);
            return false;
        } finally {
            if (seq === loadSeq) state.loading = false;
        }
    }

    /** Re-read pixels after the image file changed on disk; keeps the rects. */
    async function reloadImage() {
        if (!state.texture) return;
        try {
            const img = await bridge.loadImage(state.texture);
            await setImage(img.url, img.revoke);
            for (const r of state.rects) clampRect(r);
            changed();
        } catch (e) {
            notify(`Không đọc lại được ảnh: ${(e as Error).message || e}`, true);
        }
    }

    /** First validation problem, with the rect it belongs to. */
    function validate(): { id: number; message: string } | null {
        const seen = new Map<string, number>();
        for (const r of state.rects) {
            const err = validateFrameName(r.name);
            if (err) return { id: r.id, message: `"${r.name}": ${err}` };
            const key = r.name;
            if (seen.has(key)) return { id: r.id, message: `Trùng tên sprite "${r.name}". Mỗi sprite cần một tên riêng.` };
            seen.set(key, r.id);
        }
        return null;
    }

    async function apply(): Promise<boolean> {
        const tex = state.texture;
        if (!tex || state.readOnly || state.applying) return false;
        const problem = validate();
        if (problem) {
            select([problem.id]);
            notify(problem.message, true);
            return false;
        }
        // Renaming/removing a frame changes its sub-asset uuid: warn like Unity does.
        if (state.hasPlist) {
            const before: RectData[] = JSON.parse(state.saved);
            const now = new Set(state.rects.map((r) => r.name));
            const lost = before.map((r) => r.name).filter((n) => !now.has(n));
            if (lost.length) {
                const list = lost.slice(0, 8).join(', ') + (lost.length > 8 ? `… (+${lost.length - 8})` : '');
                const choice = await bridge.ask(
                    'Một số sprite đã bị đổi tên hoặc xóa',
                    `${list}\n\nScene/Prefab/Animation đang dùng các sprite này sẽ mất tham chiếu sau khi Apply.`,
                    ['Vẫn Apply', 'Hủy'],
                    1,
                    1,
                );
                if (choice !== 0) return false;
            }
        }
        state.applying = true;
        try {
            const data: RectData[] = state.rects.map(({ id, ...r }) => r);
            const res = await bridge.writeSheet(tex, data, state.width, state.height);
            state.saved = serialize();
            state.hasPlist = true;
            state.warning = null;
            if (res.warnings.length) notify(res.warnings.join(' '), true);
            else notify(`Đã Apply ${data.length} sprite → ${tex.baseName}.plist`);
            return true;
        } catch (e) {
            notify(`Apply thất bại: ${(e as Error).message || e}`, true);
            return false;
        } finally {
            state.applying = false;
        }
    }

    function revert() {
        if (!dirty.value) return;
        snapshot();
        const saved: RectData[] = JSON.parse(state.saved);
        state.rects = withIds(saved);
        state.selected = [];
        state.customPivot = [];
        changed();
    }

    function onChange(fn: () => void): () => void {
        raw.listeners.add(fn);
        return () => raw.listeners.delete(fn);
    }

    /** Called after a texture has been (re)opened. */
    function onLoaded(fn: () => void): () => void {
        raw.loadedListeners.add(fn);
        return () => raw.loadedListeners.delete(fn);
    }

    function dispose() {
        if (raw.revokeImage) raw.revokeImage();
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

export type Store = ReturnType<typeof createStore>;
