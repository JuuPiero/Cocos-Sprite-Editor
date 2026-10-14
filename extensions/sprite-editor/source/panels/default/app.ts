/**
 * Vue application of the Sprite Editor panel. Kept free of Node / Editor APIs
 * (those come through the SheetBridge) so it can also run in a plain browser.
 */
import { computed, createApp, defineComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { SheetBridge } from '../../core/bridge';
import { cellSizeForCount } from '../../core/slicer';
import { PivotPreset, pivotPresetOf } from '../../core/types';
import { LoadOptions, Store, createStore } from './store';
import { Viewport } from './viewport';

export interface Templates {
    app: string;
}

export type ShortcutAction = 'undo' | 'redo' | 'apply' | 'delete' | 'select-all';

export interface SpriteEditorApp {
    /** Exposed for debugging / tests. */
    readonly store: Store;
    readonly viewport: Viewport | null;
    load(uuid: string, opts?: LoadOptions): Promise<boolean>;
    /** Editor shortcut (contributions.shortcuts) routed to this panel. */
    shortcut(action: ShortcutAction): void;
    onSelect(type: string, uuid: string): void;
    onAssetChange(uuid: string): void;
    confirmClose(): Promise<boolean>;
    destroy(): void;
}

export const PIVOT_OPTIONS: { value: PivotPreset; label: string }[] = [
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

function formatNumber(v: number, digits: number): string {
    if (!Number.isFinite(v)) return '0';
    if (digits <= 0) return String(Math.round(v));
    return String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits));
}

/** Unity-like number field: drag the label to scrub, type to edit, Enter/blur to commit. */
const NumField = defineComponent({
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
        const editing = ref(false);
        const draft = ref('');
        const text = computed(() => (editing.value ? draft.value : formatNumber(props.modelValue, props.digits)));

        const clampValue = (v: number) => {
            const p = Math.pow(10, Math.max(0, props.digits));
            const r = props.digits <= 0 ? Math.round(v) : Math.round(v * p) / p;
            return Math.min(props.max, Math.max(props.min, r));
        };
        const commit = () => {
            if (!editing.value) return;
            editing.value = false;
            const v = Number(String(draft.value).replace(',', '.'));
            if (Number.isFinite(v)) {
                const c = clampValue(v);
                if (c !== props.modelValue) emit('update:modelValue', c);
            }
        };
        const onFocus = (e: FocusEvent) => {
            editing.value = true;
            draft.value = formatNumber(props.modelValue, props.digits);
            nextTick(() => (e.target as HTMLInputElement).select());
        };
        const onInput = (e: Event) => {
            draft.value = (e.target as HTMLInputElement).value;
        };
        const onKey = (e: KeyboardEvent) => {
            const input = e.target as HTMLInputElement;
            if (e.key === 'Enter') {
                commit();
                input.blur();
            } else if (e.key === 'Escape') {
                editing.value = false;
                input.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const delta = (e.key === 'ArrowUp' ? 1 : -1) * props.step * (e.shiftKey ? 10 : 1);
                const base = Number(draft.value);
                const c = clampValue((Number.isFinite(base) ? base : props.modelValue) + delta);
                draft.value = formatNumber(c, props.digits);
                emit('update:modelValue', c);
            }
        };
        const onScrub = (e: MouseEvent) => {
            if (props.disabled || e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const start = props.modelValue;
            const move = (ev: MouseEvent) => {
                const speed = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
                const c = clampValue(start + Math.round((ev.clientX - startX) / 2) * props.step * speed);
                if (c !== props.modelValue) emit('update:modelValue', c);
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

export function createEditorApp(el: HTMLElement, bridge: SheetBridge, templates: Templates): SpriteEditorApp {
    const store = createStore(bridge);
    const { state } = store;
    let viewport: Viewport | null = null;

    // The same key press can arrive twice: first as a DOM keydown in this panel,
    // then as an Editor shortcut message. The keydown always runs (so holding
    // Ctrl+Z repeats); the shortcut message is skipped if keydown just handled it.
    let keyAction = '';
    let keyTime = 0;
    const runAction = (action: ShortcutAction, fromKeydown: boolean) => {
        const now = Date.now();
        if (fromKeydown) {
            keyAction = action;
            keyTime = now;
        } else if (action === keyAction && now - keyTime < 250) {
            return;
        }
        if (action === 'undo') store.undo();
        else if (action === 'redo') store.redo();
        else if (action === 'apply') store.apply();
        else if (action === 'delete') store.deleteSelected();
        else if (action === 'select-all') store.selectAll();
    };

    const Root = defineComponent({
        name: 'SpriteEditor',
        components: { NumField },
        setup() {
            const root = ref<HTMLElement | null>(null);
            const canvas = ref<HTMLCanvasElement | null>(null);
            const sliceBtn = ref<HTMLElement | null>(null);
            const noticeVisible = ref(false);
            let noticeTimer = 0;

            onMounted(() => {
                viewport = new Viewport(canvas.value!, store);
                viewport.invalidate();
            });
            onBeforeUnmount(() => {
                viewport?.destroy();
                viewport = null;
                clearTimeout(noticeTimer);
            });

            watch(() => state.noticeSeq, () => {
                noticeVisible.value = !!state.notice;
                clearTimeout(noticeTimer);
                noticeTimer = window.setTimeout(() => (noticeVisible.value = false), state.noticeError ? 5000 : 2200);
            });
            // Redraw the grid preview while Slice settings change.
            watch(() => [state.sliceOpen, JSON.stringify(state.slice)], () => viewport?.invalidate());
            watch(() => state.showAlpha, () => viewport?.invalidate());

            const canEdit = computed(() => !!state.texture && !state.readOnly && !state.loading);
            const dirty = computed(() => store.dirty.value);
            const single = computed(() => store.single.value);
            const selectionCount = computed(() => store.selectedRects.value.length);

            // ---- name field
            const nameDraft = ref('');
            watch(() => (single.value ? single.value.id + ':' + single.value.name : ''), () => {
                nameDraft.value = single.value ? single.value.name : '';
            }, { immediate: true });
            const nameError = computed(() => {
                const r = single.value;
                if (!r) return '';
                const name = nameDraft.value;
                if (!name.trim()) return 'Tên không được để trống.';
                if (/[\\/:*?"<>|]/.test(name)) return 'Tên không được chứa \\ / : * ? " < > |';
                if (state.rects.some((o) => o.id !== r.id && o.name === name)) return 'Trùng tên với sprite khác.';
                return '';
            });
            const commitName = () => {
                const r = single.value;
                if (!r || nameDraft.value === r.name) return;
                store.patchRect(r.id, { name: nameDraft.value });
            };

            // ---- rect fields
            const field = (key: 'x' | 'y' | 'w' | 'h' | 'borderL' | 'borderT' | 'borderR' | 'borderB') => computed({
                get: () => (single.value ? single.value[key] : 0),
                set: (v: number) => single.value && store.patchRect(single.value.id, { [key]: v }),
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
            const pivotPreset = computed<PivotPreset | ''>({
                get: () => {
                    const sel = store.selectedRects.value;
                    if (!sel.length) return 'center';
                    const presets = sel.map((r) => (state.customPivot.includes(r.id) ? 'custom' : pivotPresetOf(r.pivotX, r.pivotY)));
                    return presets.every((p) => p === presets[0]) ? presets[0] : '';
                },
                set: (v) => {
                    if (v) store.setPivotPreset(state.selected.slice(), v);
                },
            });
            const pixels = computed(() => state.pivotUnit === 'pixels');
            const pivotX = computed({
                get: () => (single.value ? single.value.pivotX * (pixels.value ? single.value.w : 1) : 0),
                set: (v: number) => single.value && store.patchRect(single.value.id, { pivotX: pixels.value ? v / single.value.w : v }),
            });
            const pivotY = computed({
                get: () => (single.value ? single.value.pivotY * (pixels.value ? single.value.h : 1) : 0),
                set: (v: number) => single.value && store.patchRect(single.value.id, { pivotY: pixels.value ? v / single.value.h : v }),
            });

            // ---- slice popup
            const slicePopupStyle = ref<Record<string, string>>({});
            const toggleSlice = () => {
                if (!canEdit.value) return;
                state.sliceOpen = !state.sliceOpen;
                if (state.sliceOpen && sliceBtn.value) {
                    slicePopupStyle.value = { left: `${sliceBtn.value.offsetLeft}px` };
                }
            };
            const countCell = computed(() => cellSizeForCount(state.width, state.height, state.slice.grid));
            const sliceBlocked = computed(() => state.slice.type === 'cell-count' && (countCell.value.w < 1 || countCell.value.h < 1));

            // ---- zoom slider (log scale)
            const zoomSlider = computed(() => Math.round(((Math.log(state.zoom) - Math.log(MIN_ZOOM)) / (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM))) * 1000));
            const onZoomSlider = (e: Event) => {
                const t = Number((e.target as HTMLInputElement).value) / 1000;
                viewport?.setZoom(Math.exp(Math.log(MIN_ZOOM) + t * (Math.log(MAX_ZOOM) - Math.log(MIN_ZOOM))));
            };
            const zoomLabel = computed(() => `${Math.round(state.zoom * 100)}%`);

            // ---- keyboard (scoped to this panel)
            const focusRoot = (e: MouseEvent) => {
                if (e.target === canvas.value) root.value?.focus({ preventScroll: true });
            };
            const onKeyDown = (e: KeyboardEvent) => {
                const tag = (e.target as HTMLElement).tagName;
                if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
                const ctrl = e.ctrlKey || e.metaKey;
                const key = e.key.toLowerCase();
                let handled = true;
                if (e.code === 'Space') viewport?.setSpace(true);
                else if (ctrl && key === 'z') runAction(e.shiftKey ? 'redo' : 'undo', true);
                else if (ctrl && key === 'y') runAction('redo', true);
                else if (ctrl && key === 's') runAction('apply', true);
                else if (ctrl && key === 'a') runAction('select-all', true);
                else if (e.key === 'Delete' || e.key === 'Backspace') runAction('delete', true);
                else if (e.key === 'Escape') {
                    if (state.sliceOpen) state.sliceOpen = false;
                    else store.select([]);
                } else if (!ctrl && key === 'f') viewport?.frameSelection();
                else if (!ctrl && (key === 'home' || key === '0')) viewport?.fit();
                else if (e.key.startsWith('Arrow')) {
                    const step = e.shiftKey ? 10 : 1;
                    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
                    store.nudge(dx, dy);
                } else handled = false;
                if (handled) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            };
            const onKeyUp = (e: KeyboardEvent) => {
                if (e.code === 'Space') viewport?.setSpace(false);
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
                pivotOptions: PIVOT_OPTIONS,
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
                fit: () => viewport?.fit(),
                reveal: () => state.texture && bridge.reveal(state.hasPlist ? state.texture.plistUrl : state.texture.imageUrl),
                openSelected: () => {
                    const uuid = bridge.selectedAsset();
                    if (uuid) store.load(uuid);
                    else store.notify('Hãy chọn một ảnh trong Assets trước.', true);
                },
            };
        },
        template: templates.app,
    });

    const app = createApp(Root);
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
            const active = el.getRootNode() instanceof ShadowRoot ? (el.getRootNode() as ShadowRoot).activeElement : document.activeElement;
            const tag = active ? active.tagName : '';
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            runAction(action, false);
        },
        onSelect(type, uuid) {
            if (type !== 'asset' || !uuid || !state.followSelection || state.loading || state.applying) return;
            store.load(uuid, { fromSelection: true });
        },
        onAssetChange(uuid) {
            if (state.texture && uuid === state.texture.imageUuid && !state.applying) store.reloadImage();
        },
        confirmClose: () => store.confirmDiscard(),
        destroy() {
            app.unmount();
            store.dispose();
        },
    };
}
