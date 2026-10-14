"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PIVOT_OPTIONS = void 0;
exports.createEditorApp = createEditorApp;
/**
 * Vue application of the Sprite Editor panel. Kept free of Node / Editor APIs
 * (those come through the SheetBridge) so it can also run in a plain browser.
 */
const vue_1 = require("vue");
const slicer_1 = require("../../core/slicer");
const types_1 = require("../../core/types");
const store_1 = require("./store");
const viewport_1 = require("./viewport");
exports.PIVOT_OPTIONS = [
    { value: 'center', label: 'Center' },
    { value: 'top-left', label: 'Top Left' },
    { value: 'top', label: 'Top' },
    { value: 'top-right', label: 'Top Right' },
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
    { value: 'bottom-left', label: 'Bottom Left' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'bottom-right', label: 'Bottom Right' },
    { value: 'custom', label: 'Custom' },
];
const MIN_ZOOM = 0.03;
const MAX_ZOOM = 64;
function formatNumber(v, digits) {
    if (!Number.isFinite(v))
        return '0';
    if (digits <= 0)
        return String(Math.round(v));
    return String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
}
/** Unity-like number field: drag the label to scrub, type to edit, Enter/blur to commit. */
const NumField = (0, vue_1.defineComponent)({
    name: 'NumField',
    props: {
        label: { type: String, default: '' },
        modelValue: { type: Number, default: 0 },
        step: { type: Number, default: 1 },
        digits: { type: Number, default: 0 },
        min: { type: Number, default: -Infinity },
        max: { type: Number, default: Infinity },
        disabled: { type: Boolean, default: false },
        title: { type: String, default: '' },
    },
    emits: ['update:modelValue'],
    setup(props, { emit }) {
        const editing = (0, vue_1.ref)(false);
        const draft = (0, vue_1.ref)('');
        const text = (0, vue_1.computed)(() => (editing.value ? draft.value : formatNumber(props.modelValue, props.digits)));
        const clampValue = (v) => {
            const p = Math.pow(10, Math.max(0, props.digits));
            const r = props.digits <= 0 ? Math.round(v) : Math.round(v * p) / p;
            return Math.min(props.max, Math.max(props.min, r));
        };
        const commit = () => {
            if (!editing.value)
                return;
            editing.value = false;
            const v = Number(String(draft.value).replace(',', '.'));
            if (Number.isFinite(v)) {
                const c = clampValue(v);
                if (c !== props.modelValue)
                    emit('update:modelValue', c);
            }
        };
        const onFocus = (e) => {
            editing.value = true;
            draft.value = formatNumber(props.modelValue, props.digits);
            (0, vue_1.nextTick)(() => e.target.select());
        };
        const onInput = (e) => {
            draft.value = e.target.value;
        };
        const onKey = (e) => {
            const input = e.target;
            if (e.key === 'Enter') {
                commit();
                input.blur();
            }
            else if (e.key === 'Escape') {
                editing.value = false;
                input.blur();
            }
            else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const delta = (e.key === 'ArrowUp' ? 1 : -1) * props.step * (e.shiftKey ? 10 : 1);
                const base = Number(draft.value);
                const c = clampValue((Number.isFinite(base) ? base : props.modelValue) + delta);
                draft.value = formatNumber(c, props.digits);
                emit('update:modelValue', c);
            }
        };
        const onScrub = (e) => {
            if (props.disabled || e.button !== 0)
                return;
            e.preventDefault();
            const startX = e.clientX;
            const start = props.modelValue;
            const move = (ev) => {
                const speed = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
                const c = clampValue(start + Math.round((ev.clientX - startX) / 2) * props.step * speed);
                if (c !== props.modelValue)
                    emit('update:modelValue', c);
            };
            const up = () => {
                window.removeEventListener('mousemove', move, true);
                window.removeEventListener('mouseup', up, true);
                document.body.style.cursor = '';
            };
            document.body.style.cursor = 'ew-resize';
            window.addEventListener('mousemove', move, true);
            window.addEventListener('mouseup', up, true);
        };
        return { text, commit, onFocus, onInput, onKey, onScrub };
    },
    template: `
        <label class="nf" :class="{ disabled }" :title="title">
            <span v-if="label" class="nf-label" @mousedown="onScrub">{{ label }}</span>
            <input class="field nf-input" type="text" spellcheck="false" :value="text" :disabled="disabled"
                @focus="onFocus" @input="onInput" @blur="commit" @keydown="onKey" />
        </label>`,
});
function createEditorApp(el, bridge, templates) {
    const store = (0, store_1.createStore)(bridge);
    const { state } = store;
    let viewport = null;
    // The same key press can arrive twice: first as a DOM keydown in this panel,
    // then as an Editor shortcut message. The keydown always runs (so holding
    // Ctrl+Z repeats); the shortcut message is skipped if keydown just handled it.
    let keyAction = '';
    let keyTime = 0;
    const runAction = (action, fromKeydown) => {
        const now = Date.now();
        if (fromKeydown) {
            keyAction = action;
            keyTime = now;
        }
        else if (action === keyAction && now - keyTime < 250) {
            return;
        }
        if (action === 'undo')
            store.undo();
        else if (action === 'redo')
            store.redo();
        else if (action === 'apply')
            store.apply();
        else if (action === 'delete')
            store.deleteSelected();
        else if (action === 'select-all')
            store.selectAll();
    };
    const Root = (0, vue_1.defineComponent)({
        name: 'SpriteEditor',
        components: { NumField },
        setup() {
            const root = (0, vue_1.ref)(null);
            const canvas = (0, vue_1.ref)(null);
            const sliceBtn = (0, vue_1.ref)(null);
            const noticeVisible = (0, vue_1.ref)(false);
            let noticeTimer = 0;
            (0, vue_1.onMounted)(() => {
                viewport = new viewport_1.Viewport(canvas.value, store);
                viewport.invalidate();
            });
            (0, vue_1.onBeforeUnmount)(() => {
                viewport === null || viewport === void 0 ? void 0 : viewport.destroy();
                viewport = null;
                clearTimeout(noticeTimer);
            });
            (0, vue_1.watch)(() => state.noticeSeq, () => {
                noticeVisible.value = !!state.notice;
                clearTimeout(noticeTimer);
                noticeTimer = window.setTimeout(() => (noticeVisible.value = false), state.noticeError ? 5000 : 2200);
            });
            // Redraw the grid preview while Slice settings change.
            (0, vue_1.watch)(() => [state.sliceOpen, JSON.stringify(state.slice)], () => viewport === null || viewport === void 0 ? void 0 : viewport.invalidate());
            (0, vue_1.watch)(() => state.showAlpha, () => viewport === null || viewport === void 0 ? void 0 : viewport.invalidate());
            const canEdit = (0, vue_1.computed)(() => !!state.texture && !state.readOnly && !state.loading);
            const dirty = (0, vue_1.computed)(() => store.dirty.value);
            const single = (0, vue_1.computed)(() => store.single.value);
            const selectionCount = (0, vue_1.computed)(() => store.selectedRects.value.length);
            // ---- name field
            const nameDraft = (0, vue_1.ref)('');
            (0, vue_1.watch)(() => (single.value ? single.value.id + ':' + single.value.name : ''), () => {
                nameDraft.value = single.value ? single.value.name : '';
            }, { immediate: true });
            const nameError = (0, vue_1.computed)(() => {
                const r = single.value;
                if (!r)
                    return '';
                const name = nameDraft.value;
                if (!name.trim())
                    return 'Tên không được để trống.';
                if (/[\\/:*?"<>|]/.test(name))
                    return 'Tên không được chứa \\ / : * ? " < > |';
                if (state.rects.some((o) => o.id !== r.id && o.name === name))
                    return 'Trùng tên với sprite khác.';
                return '';
            });
            const commitName = () => {
                const r = single.value;
                if (!r || nameDraft.value === r.name)
                    return;
                store.patchRect(r.id, { name: nameDraft.value });
            };
            // ---- rect fields
            const field = (key) => (0, vue_1.computed)({
                get: () => (single.value ? single.value[key] : 0),
                set: (v) => single.value && store.patchRect(single.value.id, { [key]: v }),
            });
            const fx = field('x');
            const fy = field('y');
            const fw = field('w');
            const fh = field('h');
            const bl = field('borderL');
            const bt = field('borderT');
            const br = field('borderR');
            const bb = field('borderB');
            // ---- pivot
            const pivotPreset = (0, vue_1.computed)({
                get: () => {
                    const sel = store.selectedRects.value;
                    if (!sel.length)
                        return 'center';
                    const presets = sel.map((r) => (state.customPivot.includes(r.id) ? 'custom' : (0, types_1.pivotPresetOf)(r.pivotX, r.pivotY)));
                    return presets.every((p) => p === presets[0]) ? presets[0] : '';
                },
                set: (v) => {
                    if (v)
                        store.setPivotPreset(state.selected.slice(), v);
                },
            });
            const pixels = (0, vue_1.computed)(() => state.pivotUnit === 'pixels');
            const pivotX = (0, vue_1.computed)({
                get: () => (single.value ? single.value.pivotX * (pixels.value ? single.value.w : 1) : 0),
                set: (v) => single.value && store.patchRect(single.value.id, { pivotX: pixels.value ? v / single.value.w : v }),
            });
            const pivotY = (0, vue_1.computed)({
                get: () => (single.value ? single.value.pivotY * (pixels.value ? single.value.h : 1) : 0),
                set: (v) => single.value && store.patchRect(single.value.id, { pivotY: pixels.value ? v / single.value.h : v }),
            });
            // ---- slice popup
            const slicePopupStyle = (0, vue_1.ref)({});
            const toggleSlice = () => {
                if (!canEdit.value)
                    return;
                state.sliceOpen = !state.sliceOpen;
                if (state.sliceOpen && sliceBtn.value) {
                    slicePopupStyle.value = { left: `${sliceBtn.value.offsetLeft}px` };
                }
            };
            const countCell = (0, vue_1.computed)(() => (0, slicer_1.cellSizeForCount)(state.width, state.height, state.slice.grid));
            const sliceBlocked = (0, vue_1.computed)(() => state.slice.type === 'cell-count' && (countCell.value.w < 1 || countCell.value.h < 1));
            // ---- zoom slider (log scale)
            const zoomSlider = (0, vue_1.computed)(() => Math.round(((Math.log(state.zoom) - Math.log(MIN_ZOOM)) / (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM))) * 1000));
            const onZoomSlider = (e) => {
                const t = Number(e.target.value) / 1000;
                viewport === null || viewport === void 0 ? void 0 : viewport.setZoom(Math.exp(Math.log(MIN_ZOOM) + t * (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM))));
            };
            const zoomLabel = (0, vue_1.computed)(() => `${Math.round(state.zoom * 100)}%`);
            // ---- keyboard (scoped to this panel)
            const focusRoot = (e) => {
                var _a;
                if (e.target === canvas.value)
                    (_a = root.value) === null || _a === void 0 ? void 0 : _a.focus({ preventScroll: true });
            };
            const onKeyDown = (e) => {
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')
                    return;
                const ctrl = e.ctrlKey || e.metaKey;
                const key = e.key.toLowerCase();
                let handled = true;
                if (e.code === 'Space')
                    viewport === null || viewport === void 0 ? void 0 : viewport.setSpace(true);
                else if (ctrl && key === 'z')
                    runAction(e.shiftKey ? 'redo' : 'undo', true);
                else if (ctrl && key === 'y')
                    runAction('redo', true);
                else if (ctrl && key === 's')
                    runAction('apply', true);
                else if (ctrl && key === 'a')
                    runAction('select-all', true);
                else if (e.key === 'Delete' || e.key === 'Backspace')
                    runAction('delete', true);
                else if (e.key === 'Escape') {
                    if (state.sliceOpen)
                        state.sliceOpen = false;
                    else
                        store.select([]);
                }
                else if (!ctrl && key === 'f')
                    viewport === null || viewport === void 0 ? void 0 : viewport.frameSelection();
                else if (!ctrl && (key === 'home' || key === '0'))
                    viewport === null || viewport === void 0 ? void 0 : viewport.fit();
                else if (e.key.startsWith('Arrow')) {
                    const step = e.shiftKey ? 10 : 1;
                    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                    store.nudge(dx, dy);
                }
                else
                    handled = false;
                if (handled) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };
            const onKeyUp = (e) => {
                if (e.code === 'Space')
                    viewport === null || viewport === void 0 ? void 0 : viewport.setSpace(false);
            };
            const closePopups = () => {
                state.sliceOpen = false;
            };
            return {
                s: state,
                store,
                root,
                canvas,
                sliceBtn,
                noticeVisible,
                canEdit,
                dirty,
                single,
                selectionCount,
                nameDraft,
                nameError,
                commitName,
                fx, fy, fw, fh, bl, bt, br, bb,
                pivotPreset,
                pivotX,
                pivotY,
                pivotOptions: exports.PIVOT_OPTIONS,
                slicePopupStyle,
                toggleSlice,
                countCell,
                sliceBlocked,
                zoomSlider,
                onZoomSlider,
                zoomLabel,
                focusRoot,
                onKeyDown,
                onKeyUp,
                closePopups,
                fit: () => viewport === null || viewport === void 0 ? void 0 : viewport.fit(),
                reveal: () => state.texture && bridge.reveal(state.hasPlist ? state.texture.plistUrl : state.texture.imageUrl),
                openSelected: () => {
                    const uuid = bridge.selectedAsset();
                    if (uuid)
                        store.load(uuid);
                    else
                        store.notify('Hãy chọn một ảnh trong Assets trước.', true);
                },
            };
        },
        template: templates.app,
    });
    const app = (0, vue_1.createApp)(Root);
    app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');
    app.mount(el);
    return {
        store,
        get viewport() {
            return viewport;
        },
        load: (uuid, opts) => store.load(uuid, opts),
        shortcut(action) {
            // Ignore while typing in a field (the shortcut system does not know).
            const active = el.getRootNode() instanceof ShadowRoot ? el.getRootNode().activeElement : document.activeElement;
            const tag = active ? active.tagName : '';
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA')
                return;
            runAction(action, false);
        },
        onSelect(type, uuid) {
            if (type !== 'asset' || !uuid || !state.followSelection || state.loading || state.applying)
                return;
            store.load(uuid, { fromSelection: true });
        },
        onAssetChange(uuid) {
            if (state.texture && uuid === state.texture.imageUuid && !state.applying)
                store.reloadImage();
        },
        confirmClose: () => store.confirmDiscard(),
        destroy() {
            app.unmount();
            store.dispose();
        },
    };
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc291cmNlL3BhbmVscy9kZWZhdWx0L2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUEySUEsMENBdVBDO0FBbFlEOzs7R0FHRztBQUNILDZCQUE2RztBQUU3Ryw4Q0FBcUQ7QUFDckQsNENBQThEO0FBQzlELG1DQUEwRDtBQUMxRCx5Q0FBc0M7QUFxQnpCLFFBQUEsYUFBYSxHQUE0QztJQUNsRSxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRTtJQUNwQyxFQUFFLEtBQUssRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLFVBQVUsRUFBRTtJQUN4QyxFQUFFLEtBQUssRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLEtBQUssRUFBRTtJQUM5QixFQUFFLEtBQUssRUFBRSxXQUFXLEVBQUUsS0FBSyxFQUFFLFdBQVcsRUFBRTtJQUMxQyxFQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRTtJQUNoQyxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRTtJQUNsQyxFQUFFLEtBQUssRUFBRSxhQUFhLEVBQUUsS0FBSyxFQUFFLGFBQWEsRUFBRTtJQUM5QyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRTtJQUNwQyxFQUFFLEtBQUssRUFBRSxjQUFjLEVBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRTtJQUNoRCxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRTtDQUN2QyxDQUFDO0FBRUYsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDO0FBQ3RCLE1BQU0sUUFBUSxHQUFHLEVBQUUsQ0FBQztBQUVwQixTQUFTLFlBQVksQ0FBQyxDQUFTLEVBQUUsTUFBYztJQUMzQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7UUFBRSxPQUFPLEdBQUcsQ0FBQztJQUNwQyxJQUFJLE1BQU0sSUFBSSxDQUFDO1FBQUUsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzlDLE9BQU8sTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLE1BQU0sQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsTUFBTSxDQUFDLENBQUMsQ0FBQztBQUMvRSxDQUFDO0FBRUQsNEZBQTRGO0FBQzVGLE1BQU0sUUFBUSxHQUFHLElBQUEscUJBQWUsRUFBQztJQUM3QixJQUFJLEVBQUUsVUFBVTtJQUNoQixLQUFLLEVBQUU7UUFDSCxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUU7UUFDcEMsVUFBVSxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQyxFQUFFO1FBQ3hDLElBQUksRUFBRSxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsT0FBTyxFQUFFLENBQUMsRUFBRTtRQUNsQyxNQUFNLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxDQUFDLEVBQUU7UUFDcEMsR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsQ0FBQyxRQUFRLEVBQUU7UUFDekMsR0FBRyxFQUFFLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFO1FBQ3hDLFFBQVEsRUFBRSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRTtRQUMzQyxLQUFLLEVBQUUsRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxFQUFFLEVBQUU7S0FDdkM7SUFDRCxLQUFLLEVBQUUsQ0FBQyxtQkFBbUIsQ0FBQztJQUM1QixLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsSUFBSSxFQUFFO1FBQ2pCLE1BQU0sT0FBTyxHQUFHLElBQUEsU0FBRyxFQUFDLEtBQUssQ0FBQyxDQUFDO1FBQzNCLE1BQU0sS0FBSyxHQUFHLElBQUEsU0FBRyxFQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RCLE1BQU0sSUFBSSxHQUFHLElBQUEsY0FBUSxFQUFDLEdBQUcsRUFBRSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsWUFBWSxDQUFDLEtBQUssQ0FBQyxVQUFVLEVBQUUsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUUxRyxNQUFNLFVBQVUsR0FBRyxDQUFDLENBQVMsRUFBRSxFQUFFO1lBQzdCLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFFLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDO1lBQ2xELE1BQU0sQ0FBQyxHQUFHLEtBQUssQ0FBQyxNQUFNLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDcEUsT0FBTyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDdkQsQ0FBQyxDQUFDO1FBQ0YsTUFBTSxNQUFNLEdBQUcsR0FBRyxFQUFFO1lBQ2hCLElBQUksQ0FBQyxPQUFPLENBQUMsS0FBSztnQkFBRSxPQUFPO1lBQzNCLE9BQU8sQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO1lBQ3RCLE1BQU0sQ0FBQyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUMsS0FB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QUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN6RixHQUFHLEVBQUUsQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQzFILENBQUMsQ0FBQztZQUNILE1BQU0sTUFBTSxHQUFHLElBQUEsY0FBUSxFQUFDO2dCQUNwQixHQUFHLEVBQUUsR0FBRyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUN6RixHQUFHLEVBQUUsQ0FBQyxDQUFTLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFDLFNBQVMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBRSxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO2FBQzFILENBQUMsQ0FBQztZQUVILG1CQUFtQjtZ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QU87WUFDdEUsU0FBUyxDQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM3QixDQUFDO1FBQ0QsUUFBUSxDQUFDLElBQUksRUFBRSxJQUFJO1lBQ2YsSUFBSSxJQUFJLEtBQUssT0FBTyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsS0FBSyxDQUFDLGVBQWUsSUFBSSxLQUFLLENBQUMsT0FBTyxJQUFJLEtBQUssQ0FBQyxRQUFRO2dCQUFFLE9BQU87WUFDbkcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLEVBQUUsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUM5QyxDQUFDO1FBQ0QsYUFBYSxDQUFDLElBQUk7WUFDZCxJQUFJLEtBQUssQ0FBQyxPQUFPLElBQUksSUFBSSxLQUFLLEtBQUssQ0FBQyxPQUFPLENBQUMsU0FBUyxJQUFJLENBQUMsS0FBSyxDQUFDLFFBQVE7Z0JBQUUsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDO1FBQ2xHLENBQUM7UUFDRCxZQUFZLEVBQUUsR0FBRyxFQUFFLENBQUMsS0FBSyxDQUFDLGNBQWMsRUFBRTtRQUMxQyxPQUFPO1lBQ0gsR0FBRyxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2QsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ3BCLENBQUM7S0FDSixDQUFDO0FBQ04sQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogVnVlIGFwcGxpY2F0aW9uIG9mIHRoZSBTcHJpdGUgRWRpdG9yIHBhbmVsLiBLZXB0IGZyZWUgb2YgTm9kZSAvIEVkaXRvciBBUElzXG4gKiAodGhvc2UgY29tZSB0aHJvdWdoIHRoZSBTaGVldEJyaWRnZSkgc28gaXQgY2FuIGFsc28gcnVuIGluIGEgcGxhaW4gYnJvd3Nlci5cbiAqL1xuaW1wb3J0IHsgY29tcHV0ZWQsIGNyZWF0ZUFwcCwgZGVmaW5lQ29tcG9uZW50LCBuZXh0VGljaywgb25CZWZvcmVVbm1vdW50LCBvbk1vdW50ZWQsIHJlZiwgd2F0Y2ggfSBmcm9tICd2dWUnO1xuaW1wb3J0IHsgU2hlZXRCcmlkZ2UgfSBmcm9tICcuLi8uLi9jb3JlL2JyaWRnZSc7XG5pbXBvcnQgeyBjZWxsU2l6ZUZvckNvdW50IH0gZnJvbSAnLi4vLi4vY29yZS9zbGljZXInO1xuaW1wb3J0IHsgUGl2b3RQcmVzZXQsIHBpdm90UHJlc2V0T2YgfSBmcm9tICcuLi8uLi9jb3JlL3R5cGVzJztcbmltcG9ydCB7IExvYWRPcHRpb25zLCBTdG9yZSwgY3JlYXRlU3RvcmUgfSBmcm9tICcuL3N0b3JlJztcbmltcG9ydCB7IFZpZXdwb3J0IH0gZnJvbSAnLi92aWV3cG9ydCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgVGVtcGxhdGVzIHtcbiAgICBhcHA6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgU2hvcnRjdXRBY3Rpb24gPSAndW5kbycgfCAncmVkbycgfCAnYXBwbHknIHwgJ2RlbGV0ZScgfCAnc2VsZWN0LWFsbCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3ByaXRlRWRpdG9yQXBwIHtcbiAgICAvKiogRXhwb3NlZCBmb3IgZGVidWdnaW5nIC8gdGVzdHMuICovXG4gICAgcmVhZG9ubHkgc3RvcmU6IFN0b3JlO1xuICAgIHJlYWRvbmx5IHZpZXdwb3J0OiBWaWV3cG9ydCB8IG51bGw7XG4gICAgbG9hZCh1dWlkOiBzdHJpbmcsIG9wdHM/OiBMb2FkT3B0aW9ucyk6IFByb21pc2U8Ym9vbGVhbj47XG4gICAgLyoqIEVkaXRvciBzaG9ydGN1dCAoY29udHJpYnV0aW9ucy5zaG9ydGN1dHMpIHJvdXRlZCB0byB0aGlzIHBhbmVsLiAqL1xuICAgIHNob3J0Y3V0KGFjdGlvbjogU2hvcnRjdXRBY3Rpb24pOiB2b2lkO1xuICAgIG9uU2VsZWN0KHR5cGU6IHN0cmluZywgdXVpZDogc3RyaW5nKTogdm9pZDtcbiAgICBvbkFzc2V0Q2hhbmdlKHV1aWQ6IHN0cmluZyk6IHZvaWQ7XG4gICAgY29uZmlybUNsb3NlKCk6IFByb21pc2U8Ym9vbGVhbj47XG4gICAgZGVzdHJveSgpOiB2b2lkO1xufVxuXG5leHBvcnQgY29uc3QgUElWT1RfT1BUSU9OUzogeyB2YWx1ZTogUGl2b3RQcmVzZXQ7IGxhYmVsOiBzdHJpbmcgfVtdID0gW1xuICAgIHsgdmFsdWU6ICdjZW50ZXInLCBsYWJlbDogJ0NlbnRlcicgfSxcbiAgICB7IHZhbHVlOiAndG9wLWxlZnQnLCBsYWJlbDogJ1RvcCBMZWZ0JyB9LFxuICAgIHsgdmFsdWU6ICd0b3AnLCBsYWJlbDogJ1RvcCcgfSxcbiAgICB7IHZhbHVlOiAndG9wLXJpZ2h0JywgbGFiZWw6ICdUb3AgUmlnaHQnIH0sXG4gICAgeyB2YWx1ZTogJ2xlZnQnLCBsYWJlbDogJ0xlZnQnIH0sXG4gICAgeyB2YWx1ZTogJ3JpZ2h0JywgbGFiZWw6ICdSaWdodCcgfSxcbiAgICB7IHZhbHVlOiAnYm90dG9tLWxlZnQnLCBsYWJlbDogJ0JvdHRvbSBMZWZ0JyB9LFxuICAgIHsgdmFsdWU6ICdib3R0b20nLCBsYWJlbDogJ0JvdHRvbScgfSxcbiAgICB7IHZhbHVlOiAnYm90dG9tLXJpZ2h0JywgbGFiZWw6ICdCb3R0b20gUmlnaHQnIH0sXG4gICAgeyB2YWx1ZTogJ2N1c3RvbScsIGxhYmVsOiAnQ3VzdG9tJyB9LFxuXTtcblxuY29uc3QgTUlOX1pPT00gPSAwLjAzO1xuY29uc3QgTUFYX1pPT00gPSA2NDtcblxuZnVuY3Rpb24gZm9ybWF0TnVtYmVyKHY6IG51bWJlciwgZGlnaXRzOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKHYpKSByZXR1cm4gJzAnO1xuICAgIGlmIChkaWdpdHMgPD0gMCkgcmV0dXJuIFN0cmluZyhNYXRoLnJvdW5kKHYpKTtcbiAgICByZXR1cm4gU3RyaW5nKE1hdGgucm91bmQodiAqIE1hdGgucG93KDEwLCBkaWdpdHMpKSAvIE1hdGgucG93KDEwLCBkaWdpdHMpKTtcbn1cblxuLyoqIFVuaXR5LWxpa2UgbnVtYmVyIGZpZWxkOiBkcmFnIHRoZSBsYWJlbCB0byBzY3J1YiwgdHlwZSB0byBlZGl0LCBFbnRlci9ibHVyIHRvIGNvbW1pdC4gKi9cbmNvbnN0IE51bUZpZWxkID0gZGVmaW5lQ29tcG9uZW50KHtcbiAgICBuYW1lOiAnTnVtRmllbGQnLFxuICAgIHByb3BzOiB7XG4gICAgICAgIGxhYmVsOiB7IHR5cGU6IFN0cmluZywgZGVmYXVsdDogJycgfSxcbiAgICAgICAgbW9kZWxWYWx1ZTogeyB0eXBlOiBOdW1iZXIsIGRlZmF1bHQ6IDAgfSxcbiAgICAgICAgc3RlcDogeyB0eXBlOiBOdW1iZXIsIGRlZmF1bHQ6IDEgfSxcbiAgICAgICAgZGlnaXRzOiB7IHR5cGU6IE51bWJlciwgZGVmYXVsdDogMCB9LFxuICAgICAgICBtaW46IHsgdHlwZTogTnVtYmVyLCBkZWZhdWx0OiAtSW5maW5pdHkgfSxcbiAgICAgICAgbWF4OiB7IHR5cGU6IE51bWJlciwgZGVmYXVsdDogSW5maW5pdHkgfSxcbiAgICAgICAgZGlzYWJsZWQ6IHsgdHlwZTogQm9vbGVhbiwgZGVmYXVsdDogZmFsc2UgfSxcbiAgICAgICAgdGl0bGU6IHsgdHlwZTogU3RyaW5nLCBkZWZhdWx0OiAnJyB9LFxuICAgIH0sXG4gICAgZW1pdHM6IFsndXBkYXRlOm1vZGVsVmFsdWUnXSxcbiAgICBzZXR1cChwcm9wcywgeyBlbWl0IH0pIHtcbiAgICAgICAgY29uc3QgZWRpdGluZyA9IHJlZihmYWxzZSk7XG4gICAgICAgIGNvbnN0IGRyYWZ0ID0gcmVmKCcnKTtcbiAgICAgICAgY29uc3QgdGV4dCA9IGNvbXB1dGVkKCgpID0+IChlZGl0aW5nLnZhbHVlID8gZHJhZnQudmFsdWUgOiBmb3JtYXROdW1iZXIocHJvcHMubW9kZWxWYWx1ZSwgcHJvcHMuZGlnaXRzKSkpO1xuXG4gICAgICAgIGNvbnN0IGNsYW1wVmFsdWUgPSAodjogbnVtYmVyKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBwID0gTWF0aC5wb3coMTAsIE1hdGgubWF4KDAsIHByb3BzLmRpZ2l0cykpO1xuICAgICAgICAgICAgY29uc3QgciA9IHByb3BzLmRpZ2l0cyA8PSAwID8gTWF0aC5yb3VuZCh2KSA6IE1hdGgucm91bmQodiAqIHApIC8gcDtcbiAgICAgICAgICAgIHJldHVybiBNYXRoLm1pbihwcm9wcy5tYXgsIE1hdGgubWF4KHByb3BzLm1pbiwgcikpO1xuICAgICAgICB9O1xuICAgICAgICBjb25zdCBjb21taXQgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAoIWVkaXRpbmcudmFsdWUpIHJldHVybjtcbiAgICAgICAgICAgIGVkaXRpbmcudmFsdWUgPSBmYWxzZTtcbiAgICAgICAgICAgIGNvbnN0IHYgPSBOdW1iZXIoU3RyaW5nKGRyYWZ0LnZhbHVlKS5yZXBsYWNlKCcsJywgJy4nKSk7XG4gICAgICAgICAgICBpZiAoTnVtYmVyLmlzRmluaXRlKHYpKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgYyA9IGNsYW1wVmFsdWUodik7XG4gICAgICAgICAgICAgICAgaWYgKGMgIT09IHByb3BzLm1vZGVsVmFsdWUpIGVtaXQoJ3VwZGF0ZTptb2RlbFZhbHVlJywgYyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IG9uRm9jdXMgPSAoZTogRm9jdXNFdmVudCkgPT4ge1xuICAgICAgICAgICAgZWRpdGluZy52YWx1ZSA9IHRydWU7XG4gICAgICAgICAgICBkcmFmdC52YWx1ZSA9IGZvcm1hdE51bWJlcihwcm9wcy5tb2RlbFZhbHVlLCBwcm9wcy5kaWdpdHMpO1xuICAgICAgICAgICAgbmV4dFRpY2soKCkgPT4gKGUudGFyZ2V0IGFzIEhUTUxJbnB1dEVsZW1lbnQpLnNlbGVjdCgpKTtcbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgb25JbnB1dCA9IChlOiBFdmVudCkgPT4ge1xuICAgICAgICAgICAgZHJhZnQudmFsdWUgPSAoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWU7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IG9uS2V5ID0gKGU6IEtleWJvYXJkRXZlbnQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlucHV0ID0gZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudDtcbiAgICAgICAgICAgIGlmIChlLmtleSA9PT0gJ0VudGVyJykge1xuICAgICAgICAgICAgICAgIGNvbW1pdCgpO1xuICAgICAgICAgICAgICAgIGlucHV0LmJsdXIoKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICAgICAgICAgICAgZWRpdGluZy52YWx1ZSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIGlucHV0LmJsdXIoKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZS5rZXkgPT09ICdBcnJvd1VwJyB8fCBlLmtleSA9PT0gJ0Fycm93RG93bicpIHtcbiAgICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZGVsdGEgPSAoZS5rZXkgPT09ICdBcnJvd1VwJyA/IDEgOiAtMSkgKiBwcm9wcy5zdGVwICogKGUuc2hpZnRLZXkgPyAxMCA6IDEpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGJhc2UgPSBOdW1iZXIoZHJhZnQudmFsdWUpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGMgPSBjbGFtcFZhbHVlKChOdW1iZXIuaXNGaW5pdGUoYmFzZSkgPyBiYXNlIDogcHJvcHMubW9kZWxWYWx1ZSkgKyBkZWx0YSk7XG4gICAgICAgICAgICAgICAgZHJhZnQudmFsdWUgPSBmb3JtYXROdW1iZXIoYywgcHJvcHMuZGlnaXRzKTtcbiAgICAgICAgICAgICAgICBlbWl0KCd1cGRhdGU6bW9kZWxWYWx1ZScsIGMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICBjb25zdCBvblNjcnViID0gKGU6IE1vdXNlRXZlbnQpID0+IHtcbiAgICAgICAgICAgIGlmIChwcm9wcy5kaXNhYmxlZCB8fCBlLmJ1dHRvbiAhPT0gMCkgcmV0dXJuO1xuICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgY29uc3Qgc3RhcnRYID0gZS5jbGllbnRYO1xuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBwcm9wcy5tb2RlbFZhbHVlO1xuICAgICAgICAgICAgY29uc3QgbW92ZSA9IChldjogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHNwZWVkID0gZXYuc2hpZnRLZXkgPyAxMCA6IGV2LmFsdEtleSA/IDAuMSA6IDE7XG4gICAgICAgICAgICAgICAgY29uc3QgYyA9IGNsYW1wVmFsdWUoc3RhcnQgKyBNYXRoLnJvdW5kKChldi5jbGllbnRYIC0gc3RhcnRYKSAvIDIpICogcHJvcHMuc3RlcCAqIHNwZWVkKTtcbiAgICAgICAgICAgICAgICBpZiAoYyAhPT0gcHJvcHMubW9kZWxWYWx1ZSkgZW1pdCgndXBkYXRlOm1vZGVsVmFsdWUnLCBjKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjb25zdCB1cCA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICB3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcignbW91c2Vtb3ZlJywgbW92ZSwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgd2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB1cCwgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgZG9jdW1lbnQuYm9keS5zdHlsZS5jdXJzb3IgPSAnJztcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBkb2N1bWVudC5ib2R5LnN0eWxlLmN1cnNvciA9ICdldy1yZXNpemUnO1xuICAgICAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlbW92ZScsIG1vdmUsIHRydWUpO1xuICAgICAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCB1cCwgdHJ1ZSk7XG4gICAgICAgIH07XG4gICAgICAgIHJldHVybiB7IHRleHQsIGNvbW1pdCwgb25Gb2N1cywgb25JbnB1dCwgb25LZXksIG9uU2NydWIgfTtcbiAgICB9LFxuICAgIHRlbXBsYXRlOiBgXG4gICAgICAgIDxsYWJlbCBjbGFzcz1cIm5mXCIgOmNsYXNzPVwieyBkaXNhYmxlZCB9XCIgOnRpdGxlPVwidGl0bGVcIj5cbiAgICAgICAgICAgIDxzcGFuIHYtaWY9XCJsYWJlbFwiIGNsYXNzPVwibmYtbGFiZWxcIiBAbW91c2Vkb3duPVwib25TY3J1YlwiPnt7IGxhYmVsIH19PC9zcGFuPlxuICAgICAgICAgICAgPGlucHV0IGNsYXNzPVwiZmllbGQgbmYtaW5wdXRcIiB0eXBlPVwidGV4dFwiIHNwZWxsY2hlY2s9XCJmYWxzZVwiIDp2YWx1ZT1cInRleHRcIiA6ZGlzYWJsZWQ9XCJkaXNhYmxlZFwiXG4gICAgICAgICAgICAgICAgQGZvY3VzPVwib25Gb2N1c1wiIEBpbnB1dD1cIm9uSW5wdXRcIiBAYmx1cj1cImNvbW1pdFwiIEBrZXlkb3duPVwib25LZXlcIiAvPlxuICAgICAgICA8L2xhYmVsPmAsXG59KTtcblxuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUVkaXRvckFwcChlbDogSFRNTEVsZW1lbnQsIGJyaWRnZTogU2hlZXRCcmlkZ2UsIHRlbXBsYXRlczogVGVtcGxhdGVzKTogU3ByaXRlRWRpdG9yQXBwIHtcbiAgICBjb25zdCBzdG9yZSA9IGNyZWF0ZVN0b3JlKGJyaWRnZSk7XG4gICAgY29uc3QgeyBzdGF0ZSB9ID0gc3RvcmU7XG4gICAgbGV0IHZpZXdwb3J0OiBWaWV3cG9ydCB8IG51bGwgPSBudWxsO1xuXG4gICAgLy8gVGhlIHNhbWUga2V5IHByZXNzIGNhbiBhcnJpdmUgdHdpY2U6IGZpcnN0IGFzIGEgRE9NIGtleWRvd24gaW4gdGhpcyBwYW5lbCxcbiAgICAvLyB0aGVuIGFzIGFuIEVkaXRvciBzaG9ydGN1dCBtZXNzYWdlLiBUaGUga2V5ZG93biBhbHdheXMgcnVucyAoc28gaG9sZGluZ1xuICAgIC8vIEN0cmwrWiByZXBlYXRzKTsgdGhlIHNob3J0Y3V0IG1lc3NhZ2UgaXMgc2tpcHBlZCBpZiBrZXlkb3duIGp1c3QgaGFuZGxlZCBpdC5cbiAgICBsZXQga2V5QWN0aW9uID0gJyc7XG4gICAgbGV0IGtleVRpbWUgPSAwO1xuICAgIGNvbnN0IHJ1bkFjdGlvbiA9IChhY3Rpb246IFNob3J0Y3V0QWN0aW9uLCBmcm9tS2V5ZG93bjogYm9vbGVhbikgPT4ge1xuICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICBpZiAoZnJvbUtleWRvd24pIHtcbiAgICAgICAgICAgIGtleUFjdGlvbiA9IGFjdGlvbjtcbiAgICAgICAgICAgIGtleVRpbWUgPSBub3c7XG4gICAgICAgIH0gZWxzZSBpZiAoYWN0aW9uID09PSBrZXlBY3Rpb24gJiYgbm93IC0ga2V5VGltZSA8IDI1MCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChhY3Rpb24gPT09ICd1bmRvJykgc3RvcmUudW5kbygpO1xuICAgICAgICBlbHNlIGlmIChhY3Rpb24gPT09ICdyZWRvJykgc3RvcmUucmVkbygpO1xuICAgICAgICBlbHNlIGlmIChhY3Rpb24gPT09ICdhcHBseScpIHN0b3JlLmFwcGx5KCk7XG4gICAgICAgIGVsc2UgaWYgKGFjdGlvbiA9PT0gJ2RlbGV0ZScpIHN0b3JlLmRlbGV0ZVNlbGVjdGVkKCk7XG4gICAgICAgIGVsc2UgaWYgKGFjdGlvbiA9PT0gJ3NlbGVjdC1hbGwnKSBzdG9yZS5zZWxlY3RBbGwoKTtcbiAgICB9O1xuXG4gICAgY29uc3QgUm9vdCA9IGRlZmluZUNvbXBvbmVudCh7XG4gICAgICAgIG5hbWU6ICdTcHJpdGVFZGl0b3InLFxuICAgICAgICBjb21wb25lbnRzOiB7IE51bUZpZWxkIH0sXG4gICAgICAgIHNldHVwKCkge1xuICAgICAgICAgICAgY29uc3Qgcm9vdCA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuICAgICAgICAgICAgY29uc3QgY2FudmFzID0gcmVmPEhUTUxDYW52YXNFbGVtZW50IHwgbnVsbD4obnVsbCk7XG4gICAgICAgICAgICBjb25zdCBzbGljZUJ0biA9IHJlZjxIVE1MRWxlbWVudCB8IG51bGw+KG51bGwpO1xuICAgICAgICAgICAgY29uc3Qgbm90aWNlVmlzaWJsZSA9IHJlZihmYWxzZSk7XG4gICAgICAgICAgICBsZXQgbm90aWNlVGltZXIgPSAwO1xuXG4gICAgICAgICAgICBvbk1vdW50ZWQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHZpZXdwb3J0ID0gbmV3IFZpZXdwb3J0KGNhbnZhcy52YWx1ZSEsIHN0b3JlKTtcbiAgICAgICAgICAgICAgICB2aWV3cG9ydC5pbnZhbGlkYXRlKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIG9uQmVmb3JlVW5tb3VudCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdmlld3BvcnQ/LmRlc3Ryb3koKTtcbiAgICAgICAgICAgICAgICB2aWV3cG9ydCA9IG51bGw7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KG5vdGljZVRpbWVyKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB3YXRjaCgoKSA9PiBzdGF0ZS5ub3RpY2VTZXEsICgpID0+IHtcbiAgICAgICAgICAgICAgICBub3RpY2VWaXNpYmxlLnZhbHVlID0gISFzdGF0ZS5ub3RpY2U7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KG5vdGljZVRpbWVyKTtcbiAgICAgICAgICAgICAgICBub3RpY2VUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IChub3RpY2VWaXNpYmxlLnZhbHVlID0gZmFsc2UpLCBzdGF0ZS5ub3RpY2VFcnJvciA/IDUwMDAgOiAyMjAwKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgLy8gUmVkcmF3IHRoZSBncmlkIHByZXZpZXcgd2hpbGUgU2xpY2Ugc2V0dGluZ3MgY2hhbmdlLlxuICAgICAgICAgICAgd2F0Y2goKCkgPT4gW3N0YXRlLnNsaWNlT3BlbiwgSlNPTi5zdHJpbmdpZnkoc3RhdGUuc2xpY2UpXSwgKCkgPT4gdmlld3BvcnQ/LmludmFsaWRhdGUoKSk7XG4gICAgICAgICAgICB3YXRjaCgoKSA9PiBzdGF0ZS5zaG93QWxwaGEsICgpID0+IHZpZXdwb3J0Py5pbnZhbGlkYXRlKCkpO1xuXG4gICAgICAgICAgICBjb25zdCBjYW5FZGl0ID0gY29tcHV0ZWQoKCkgPT4gISFzdGF0ZS50ZXh0dXJlICYmICFzdGF0ZS5yZWFkT25seSAmJiAhc3RhdGUubG9hZGluZyk7XG4gICAgICAgICAgICBjb25zdCBkaXJ0eSA9IGNvbXB1dGVkKCgpID0+IHN0b3JlLmRpcnR5LnZhbHVlKTtcbiAgICAgICAgICAgIGNvbnN0IHNpbmdsZSA9IGNvbXB1dGVkKCgpID0+IHN0b3JlLnNpbmdsZS52YWx1ZSk7XG4gICAgICAgICAgICBjb25zdCBzZWxlY3Rpb25Db3VudCA9IGNvbXB1dGVkKCgpID0+IHN0b3JlLnNlbGVjdGVkUmVjdHMudmFsdWUubGVuZ3RoKTtcblxuICAgICAgICAgICAgLy8gLS0tLSBuYW1lIGZpZWxkXG4gICAgICAgICAgICBjb25zdCBuYW1lRHJhZnQgPSByZWYoJycpO1xuICAgICAgICAgICAgd2F0Y2goKCkgPT4gKHNpbmdsZS52YWx1ZSA/IHNpbmdsZS52YWx1ZS5pZCArICc6JyArIHNpbmdsZS52YWx1ZS5uYW1lIDogJycpLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgbmFtZURyYWZ0LnZhbHVlID0gc2luZ2xlLnZhbHVlID8gc2luZ2xlLnZhbHVlLm5hbWUgOiAnJztcbiAgICAgICAgICAgIH0sIHsgaW1tZWRpYXRlOiB0cnVlIH0pO1xuICAgICAgICAgICAgY29uc3QgbmFtZUVycm9yID0gY29tcHV0ZWQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHIgPSBzaW5nbGUudmFsdWU7XG4gICAgICAgICAgICAgICAgaWYgKCFyKSByZXR1cm4gJyc7XG4gICAgICAgICAgICAgICAgY29uc3QgbmFtZSA9IG5hbWVEcmFmdC52YWx1ZTtcbiAgICAgICAgICAgICAgICBpZiAoIW5hbWUudHJpbSgpKSByZXR1cm4gJ1TDqm4ga2jDtG5nIMSRxrDhu6NjIMSR4buDIHRy4buRbmcuJztcbiAgICAgICAgICAgICAgICBpZiAoL1tcXFxcLzoqP1wiPD58XS8udGVzdChuYW1lKSkgcmV0dXJuICdUw6puIGtow7RuZyDEkcaw4bujYyBjaOG7qWEgXFxcXCAvIDogKiA/IFwiIDwgPiB8JztcbiAgICAgICAgICAgICAgICBpZiAoc3RhdGUucmVjdHMuc29tZSgobykgPT4gby5pZCAhPT0gci5pZCAmJiBvLm5hbWUgPT09IG5hbWUpKSByZXR1cm4gJ1Ryw7luZyB0w6puIHbhu5tpIHNwcml0ZSBraMOhYy4nO1xuICAgICAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgY29uc3QgY29tbWl0TmFtZSA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCByID0gc2luZ2xlLnZhbHVlO1xuICAgICAgICAgICAgICAgIGlmICghciB8fCBuYW1lRHJhZnQudmFsdWUgPT09IHIubmFtZSkgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHN0b3JlLnBhdGNoUmVjdChyLmlkLCB7IG5hbWU6IG5hbWVEcmFmdC52YWx1ZSB9KTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8vIC0tLS0gcmVjdCBmaWVsZHNcbiAgICAgICAgICAgIGNvbnN0IGZpZWxkID0gKGtleTogJ3gnIHwgJ3knIHwgJ3cnIHwgJ2gnIHwgJ2JvcmRlckwnIHwgJ2JvcmRlclQnIHwgJ2JvcmRlclInIHwgJ2JvcmRlckInKSA9PiBjb21wdXRlZCh7XG4gICAgICAgICAgICAgICAgZ2V0OiAoKSA9PiAoc2luZ2xlLnZhbHVlID8gc2luZ2xlLnZhbHVlW2tleV0gOiAwKSxcbiAgICAgICAgICAgICAgICBzZXQ6ICh2OiBudW1iZXIpID0+IHNpbmdsZS52YWx1ZSAmJiBzdG9yZS5wYXRjaFJlY3Qoc2luZ2xlLnZhbHVlLmlkLCB7IFtrZXldOiB2IH0pLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBmeCA9IGZpZWxkKCd4Jyk7XG4gICAgICAgICAgICBjb25zdCBmeSA9IGZpZWxkKCd5Jyk7XG4gICAgICAgICAgICBjb25zdCBmdyA9IGZpZWxkKCd3Jyk7XG4gICAgICAgICAgICBjb25zdCBmaCA9IGZpZWxkKCdoJyk7XG4gICAgICAgICAgICBjb25zdCBibCA9IGZpZWxkKCdib3JkZXJMJyk7XG4gICAgICAgICAgICBjb25zdCBidCA9IGZpZWxkKCdib3JkZXJUJyk7XG4gICAgICAgICAgICBjb25zdCBiciA9IGZpZWxkKCdib3JkZXJSJyk7XG4gICAgICAgICAgICBjb25zdCBiYiA9IGZpZWxkKCdib3JkZXJCJyk7XG5cbiAgICAgICAgICAgIC8vIC0tLS0gcGl2b3RcbiAgICAgICAgICAgIGNvbnN0IHBpdm90UHJlc2V0ID0gY29tcHV0ZWQ8UGl2b3RQcmVzZXQgfCAnJz4oe1xuICAgICAgICAgICAgICAgIGdldDogKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBzZWwgPSBzdG9yZS5zZWxlY3RlZFJlY3RzLnZhbHVlO1xuICAgICAgICAgICAgICAgICAgICBpZiAoIXNlbC5sZW5ndGgpIHJldHVybiAnY2VudGVyJztcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgcHJlc2V0cyA9IHNlbC5tYXAoKHIpID0+IChzdGF0ZS5jdXN0b21QaXZvdC5pbmNsdWRlcyhyLmlkKSA/ICdjdXN0b20nIDogcGl2b3RQcmVzZXRPZihyLnBpdm90WCwgci5waXZvdFkpKSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBwcmVzZXRzLmV2ZXJ5KChwKSA9PiBwID09PSBwcmVzZXRzWzBdKSA/IHByZXNldHNbMF0gOiAnJztcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHNldDogKHYpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHYpIHN0b3JlLnNldFBpdm90UHJlc2V0KHN0YXRlLnNlbGVjdGVkLnNsaWNlKCksIHYpO1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIGNvbnN0IHBpeGVscyA9IGNvbXB1dGVkKCgpID0+IHN0YXRlLnBpdm90VW5pdCA9PT0gJ3BpeGVscycpO1xuICAgICAgICAgICAgY29uc3QgcGl2b3RYID0gY29tcHV0ZWQoe1xuICAgICAgICAgICAgICAgIGdldDogKCkgPT4gKHNpbmdsZS52YWx1ZSA/IHNpbmdsZS52YWx1ZS5waXZvdFggKiAocGl4ZWxzLnZhbHVlID8gc2luZ2xlLnZhbHVlLncgOiAxKSA6IDApLFxuICAgICAgICAgICAgICAgIHNldDogKHY6IG51bWJlcikgPT4gc2luZ2xlLnZhbHVlICYmIHN0b3JlLnBhdGNoUmVjdChzaW5nbGUudmFsdWUuaWQsIHsgcGl2b3RYOiBwaXhlbHMudmFsdWUgPyB2IC8gc2luZ2xlLnZhbHVlLncgOiB2IH0pLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjb25zdCBwaXZvdFkgPSBjb21wdXRlZCh7XG4gICAgICAgICAgICAgICAgZ2V0OiAoKSA9PiAoc2luZ2xlLnZhbHVlID8gc2luZ2xlLnZhbHVlLnBpdm90WSAqIChwaXhlbHMudmFsdWUgPyBzaW5nbGUudmFsdWUuaCA6IDEpIDogMCksXG4gICAgICAgICAgICAgICAgc2V0OiAodjogbnVtYmVyKSA9PiBzaW5nbGUudmFsdWUgJiYgc3RvcmUucGF0Y2hSZWN0KHNpbmdsZS52YWx1ZS5pZCwgeyBwaXZvdFk6IHBpeGVscy52YWx1ZSA/IHYgLyBzaW5nbGUudmFsdWUuaCA6IHYgfSksXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gLS0tLSBzbGljZSBwb3B1cFxuICAgICAgICAgICAgY29uc3Qgc2xpY2VQb3B1cFN0eWxlID0gcmVmPFJlY29yZDxzdHJpbmcsIHN0cmluZz4+KHt9KTtcbiAgICAgICAgICAgIGNvbnN0IHRvZ2dsZVNsaWNlID0gKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghY2FuRWRpdC52YWx1ZSkgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHN0YXRlLnNsaWNlT3BlbiA9ICFzdGF0ZS5zbGljZU9wZW47XG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlLnNsaWNlT3BlbiAmJiBzbGljZUJ0bi52YWx1ZSkge1xuICAgICAgICAgICAgICAgICAgICBzbGljZVBvcHVwU3R5bGUudmFsdWUgPSB7IGxlZnQ6IGAke3NsaWNlQnRuLnZhbHVlLm9mZnNldExlZnR9cHhgIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IGNvdW50Q2VsbCA9IGNvbXB1dGVkKCgpID0+IGNlbGxTaXplRm9yQ291bnQoc3RhdGUud2lkdGgsIHN0YXRlLmhlaWdodCwgc3RhdGUuc2xpY2UuZ3JpZCkpO1xuICAgICAgICAgICAgY29uc3Qgc2xpY2VCbG9ja2VkID0gY29tcHV0ZWQoKCkgPT4gc3RhdGUuc2xpY2UudHlwZSA9PT0gJ2NlbGwtY291bnQnICYmIChjb3VudENlbGwudmFsdWUudyA8IDEgfHwgY291bnRDZWxsLnZhbHVlLmggPCAxKSk7XG5cbiAgICAgICAgICAgIC8vIC0tLS0gem9vbSBzbGlkZXIgKGxvZyBzY2FsZSlcbiAgICAgICAgICAgIGNvbnN0IHpvb21TbGlkZXIgPSBjb21wdXRlZCgoKSA9PiBNYXRoLnJvdW5kKCgoTWF0aC5sb2coc3RhdGUuem9vbSkgLSBNYXRoLmxvZyhNSU5fWk9PTSkpIC8gKE1hdGgubG9nKE1BWF9aT09NKSAtIE1hdGgubG9nKE1JTl9aT09NKSkpICogMTAwMCkpO1xuICAgICAgICAgICAgY29uc3Qgb25ab29tU2xpZGVyID0gKGU6IEV2ZW50KSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgdCA9IE51bWJlcigoZS50YXJnZXQgYXMgSFRNTElucHV0RWxlbWVudCkudmFsdWUpIC8gMTAwMDtcbiAgICAgICAgICAgICAgICB2aWV3cG9ydD8uc2V0Wm9vbShNYXRoLmV4cChNYXRoLmxvZyhNSU5fWk9PTSkgKyB0ICogKE1hdGgubG9nKE1BWF9aT09NKSAtIE1hdGgubG9nKE1JTl9aT09NKSkpKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBjb25zdCB6b29tTGFiZWwgPSBjb21wdXRlZCgoKSA9PiBgJHtNYXRoLnJvdW5kKHN0YXRlLnpvb20gKiAxMDApfSVgKTtcblxuICAgICAgICAgICAgLy8gLS0tLSBrZXlib2FyZCAoc2NvcGVkIHRvIHRoaXMgcGFuZWwpXG4gICAgICAgICAgICBjb25zdCBmb2N1c1Jvb3QgPSAoZTogTW91c2VFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlLnRhcmdldCA9PT0gY2FudmFzLnZhbHVlKSByb290LnZhbHVlPy5mb2N1cyh7IHByZXZlbnRTY3JvbGw6IHRydWUgfSk7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgY29uc3Qgb25LZXlEb3duID0gKGU6IEtleWJvYXJkRXZlbnQpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCB0YWcgPSAoZS50YXJnZXQgYXMgSFRNTEVsZW1lbnQpLnRhZ05hbWU7XG4gICAgICAgICAgICAgICAgaWYgKHRhZyA9PT0gJ0lOUFVUJyB8fCB0YWcgPT09ICdTRUxFQ1QnIHx8IHRhZyA9PT0gJ1RFWFRBUkVBJykgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGNvbnN0IGN0cmwgPSBlLmN0cmxLZXkgfHwgZS5tZXRhS2V5O1xuICAgICAgICAgICAgICAgIGNvbnN0IGtleSA9IGUua2V5LnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgbGV0IGhhbmRsZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIGlmIChlLmNvZGUgPT09ICdTcGFjZScpIHZpZXdwb3J0Py5zZXRTcGFjZSh0cnVlKTtcbiAgICAgICAgICAgICAgICBlbHNlIGlmIChjdHJsICYmIGtleSA9PT0gJ3onKSBydW5BY3Rpb24oZS5zaGlmdEtleSA/ICdyZWRvJyA6ICd1bmRvJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoY3RybCAmJiBrZXkgPT09ICd5JykgcnVuQWN0aW9uKCdyZWRvJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoY3RybCAmJiBrZXkgPT09ICdzJykgcnVuQWN0aW9uKCdhcHBseScsIHRydWUpO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGN0cmwgJiYga2V5ID09PSAnYScpIHJ1bkFjdGlvbignc2VsZWN0LWFsbCcsIHRydWUpO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGUua2V5ID09PSAnRGVsZXRlJyB8fCBlLmtleSA9PT0gJ0JhY2tzcGFjZScpIHJ1bkFjdGlvbignZGVsZXRlJywgdHJ1ZSk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoZS5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChzdGF0ZS5zbGljZU9wZW4pIHN0YXRlLnNsaWNlT3BlbiA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIHN0b3JlLnNlbGVjdChbXSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICghY3RybCAmJiBrZXkgPT09ICdmJykgdmlld3BvcnQ/LmZyYW1lU2VsZWN0aW9uKCk7XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoIWN0cmwgJiYgKGtleSA9PT0gJ2hvbWUnIHx8IGtleSA9PT0gJzAnKSkgdmlld3BvcnQ/LmZpdCgpO1xuICAgICAgICAgICAgICAgIGVsc2UgaWYgKGUua2V5LnN0YXJ0c1dpdGgoJ0Fycm93JykpIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3Qgc3RlcCA9IGUuc2hpZnRLZXkgPyAxMCA6IDE7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGR4ID0gZS5rZXkgPT09ICdBcnJvd0xlZnQnID8gLXN0ZXAgOiBlLmtleSA9PT0gJ0Fycm93UmlnaHQnID8gc3RlcCA6IDA7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGR5ID0gZS5rZXkgPT09ICdBcnJvd1VwJyA/IC1zdGVwIDogZS5rZXkgPT09ICdBcnJvd0Rvd24nID8gc3RlcCA6IDA7XG4gICAgICAgICAgICAgICAgICAgIHN0b3JlLm51ZGdlKGR4LCBkeSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGhhbmRsZWQgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICBpZiAoaGFuZGxlZCkge1xuICAgICAgICAgICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGNvbnN0IG9uS2V5VXAgPSAoZTogS2V5Ym9hcmRFdmVudCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChlLmNvZGUgPT09ICdTcGFjZScpIHZpZXdwb3J0Py5zZXRTcGFjZShmYWxzZSk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBjb25zdCBjbG9zZVBvcHVwcyA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICBzdGF0ZS5zbGljZU9wZW4gPSBmYWxzZTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICAgICAgczogc3RhdGUsXG4gICAgICAgICAgICAgICAgc3RvcmUsXG4gICAgICAgICAgICAgICAgcm9vdCxcbiAgICAgICAgICAgICAgICBjYW52YXMsXG4gICAgICAgICAgICAgICAgc2xpY2VCdG4sXG4gICAgICAgICAgICAgICAgbm90aWNlVmlzaWJsZSxcbiAgICAgICAgICAgICAgICBjYW5FZGl0LFxuICAgICAgICAgICAgICAgIGRpcnR5LFxuICAgICAgICAgICAgICAgIHNpbmdsZSxcbiAgICAgICAgICAgICAgICBzZWxlY3Rpb25Db3VudCxcbiAgICAgICAgICAgICAgICBuYW1lRHJhZnQsXG4gICAgICAgICAgICAgICAgbmFtZUVycm9yLFxuICAgICAgICAgICAgICAgIGNvbW1pdE5hbWUsXG4gICAgICAgICAgICAgICAgZngsIGZ5LCBmdywgZmgsIGJsLCBidCwgYnIsIGJiLFxuICAgICAgICAgICAgICAgIHBpdm90UHJlc2V0LFxuICAgICAgICAgICAgICAgIHBpdm90WCxcbiAgICAgICAgICAgICAgICBwaXZvdFksXG4gICAgICAgICAgICAgICAgcGl2b3RPcHRpb25zOiBQSVZPVF9PUFRJT05TLFxuICAgICAgICAgICAgICAgIHNsaWNlUG9wdXBTdHlsZSxcbiAgICAgICAgICAgICAgICB0b2dnbGVTbGljZSxcbiAgICAgICAgICAgICAgICBjb3VudENlbGwsXG4gICAgICAgICAgICAgICAgc2xpY2VCbG9ja2VkLFxuICAgICAgICAgICAgICAgIHpvb21TbGlkZXIsXG4gICAgICAgICAgICAgICAgb25ab29tU2xpZGVyLFxuICAgICAgICAgICAgICAgIHpvb21MYWJlbCxcbiAgICAgICAgICAgICAgICBmb2N1c1Jvb3QsXG4gICAgICAgICAgICAgICAgb25LZXlEb3duLFxuICAgICAgICAgICAgICAgIG9uS2V5VXAsXG4gICAgICAgICAgICAgICAgY2xvc2VQb3B1cHMsXG4gICAgICAgICAgICAgICAgZml0OiAoKSA9PiB2aWV3cG9ydD8uZml0KCksXG4gICAgICAgICAgICAgICAgcmV2ZWFsOiAoKSA9PiBzdGF0ZS50ZXh0dXJlICYmIGJyaWRnZS5yZXZlYWwoc3RhdGUuaGFzUGxpc3QgPyBzdGF0ZS50ZXh0dXJlLnBsaXN0VXJsIDogc3RhdGUudGV4dHVyZS5pbWFnZVVybCksXG4gICAgICAgICAgICAgICAgb3BlblNlbGVjdGVkOiAoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHV1aWQgPSBicmlkZ2Uuc2VsZWN0ZWRBc3NldCgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAodXVpZCkgc3RvcmUubG9hZCh1dWlkKTtcbiAgICAgICAgICAgICAgICAgICAgZWxzZSBzdG9yZS5ub3RpZnkoJ0jDo3kgY2jhu41uIG3hu5l0IOG6o25oIHRyb25nIEFzc2V0cyB0csaw4bubYy4nLCB0cnVlKTtcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgfTtcbiAgICAgICAgfSxcbiAgICAgICAgdGVtcGxhdGU6IHRlbXBsYXRlcy5hcHAsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhcHAgPSBjcmVhdGVBcHAoUm9vdCk7XG4gICAgYXBwLmNvbmZpZy5jb21waWxlck9wdGlvbnMuaXNDdXN0b21FbGVtZW50ID0gKHRhZykgPT4gdGFnLnN0YXJ0c1dpdGgoJ3VpLScpO1xuICAgIGFwcC5tb3VudChlbCk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBzdG9yZSxcbiAgICAgICAgZ2V0IHZpZXdwb3J0KCkge1xuICAgICAgICAgICAgcmV0dXJuIHZpZXdwb3J0O1xuICAgICAgICB9LFxuICAgICAgICBsb2FkOiAodXVpZCwgb3B0cykgPT4gc3RvcmUubG9hZCh1dWlkLCBvcHRzKSxcbiAgICAgICAgc2hvcnRjdXQoYWN0aW9uKSB7XG4gICAgICAgICAgICAvLyBJZ25vcmUgd2hpbGUgdHlwaW5nIGluIGEgZmllbGQgKHRoZSBzaG9ydGN1dCBzeXN0ZW0gZG9lcyBub3Qga25vdykuXG4gICAgICAgICAgICBjb25zdCBhY3RpdmUgPSBlbC5nZXRSb290Tm9kZSgpIGluc3RhbmNlb2YgU2hhZG93Um9vdCA/IChlbC5nZXRSb290Tm9kZSgpIGFzIFNoYWRvd1Jvb3QpLmFjdGl2ZUVsZW1lbnQgOiBkb2N1bWVudC5hY3RpdmVFbGVtZW50O1xuICAgICAgICAgICAgY29uc3QgdGFnID0gYWN0aXZlID8gYWN0aXZlLnRhZ05hbWUgOiAnJztcbiAgICAgICAgICAgIGlmICh0YWcgPT09ICdJTlBVVCcgfHwgdGFnID09PSAnU0VMRUNUJyB8fCB0YWcgPT09ICdURVhUQVJFQScpIHJldHVybjtcbiAgICAgICAgICAgIHJ1bkFjdGlvbihhY3Rpb24sIGZhbHNlKTtcbiAgICAgICAgfSxcbiAgICAgICAgb25TZWxlY3QodHlwZSwgdXVpZCkge1xuICAgICAgICAgICAgaWYgKHR5cGUgIT09ICdhc3NldCcgfHwgIXV1aWQgfHwgIXN0YXRlLmZvbGxvd1NlbGVjdGlvbiB8fCBzdGF0ZS5sb2FkaW5nIHx8IHN0YXRlLmFwcGx5aW5nKSByZXR1cm47XG4gICAgICAgICAgICBzdG9yZS5sb2FkKHV1aWQsIHsgZnJvbVNlbGVjdGlvbjogdHJ1ZSB9KTtcbiAgICAgICAgfSxcbiAgICAgICAgb25Bc3NldENoYW5nZSh1dWlkKSB7XG4gICAgICAgICAgICBpZiAoc3RhdGUudGV4dHVyZSAmJiB1dWlkID09PSBzdGF0ZS50ZXh0dXJlLmltYWdlVXVpZCAmJiAhc3RhdGUuYXBwbHlpbmcpIHN0b3JlLnJlbG9hZEltYWdlKCk7XG4gICAgICAgIH0sXG4gICAgICAgIGNvbmZpcm1DbG9zZTogKCkgPT4gc3RvcmUuY29uZmlybURpc2NhcmQoKSxcbiAgICAgICAgZGVzdHJveSgpIHtcbiAgICAgICAgICAgIGFwcC51bm1vdW50KCk7XG4gICAgICAgICAgICBzdG9yZS5kaXNwb3NlKCk7XG4gICAgICAgIH0sXG4gICAgfTtcbn1cbiJdfQ==