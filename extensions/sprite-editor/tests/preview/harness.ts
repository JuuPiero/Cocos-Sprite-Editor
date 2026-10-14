/**
 * Runs the real panel UI in a plain browser with a stub bridge, for visual
 * checks: `npm run preview`, then open tests/preview/out/preview.html#<state>.
 * States: empty | selected | slice | multi | zoom | readonly
 */
import { LoadedSheet, SheetBridge, TextureInfo } from '../../source/core/bridge';
import { createEditorApp } from '../../source/panels/default/app';

function drawSheet(): string {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d')!;
    // Row 1: four slime frames with a different squash each.
    for (let i = 0; i < 4; i++) {
        const cx = 32 + i * 64;
        const squash = [0, 4, 8, 4][i];
        g.fillStyle = '#4fbf5a';
        g.beginPath();
        g.ellipse(cx, 40 + squash / 2, 22 + squash / 2, 20 - squash / 2, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#2f8a3a';
        g.fillRect(cx - 22 - squash / 2, 52, 44 + squash, 6);
        g.fillStyle = '#ffffff';
        g.fillRect(cx - 9, 32 + squash, 6, 7);
        g.fillRect(cx + 4, 32 + squash, 6, 7);
        g.fillStyle = '#1b1b1b';
        g.fillRect(cx - 7, 35 + squash, 3, 4);
        g.fillRect(cx + 6, 35 + squash, 3, 4);
    }
    // Row 2: coin, heart, sword, 9-slice panel.
    g.fillStyle = '#f2c230';
    g.beginPath();
    g.arc(32, 96, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#c99712';
    g.fillRect(29, 84, 6, 24);
    g.fillStyle = '#e04848';
    g.beginPath();
    g.moveTo(96, 112);
    g.bezierCurveTo(70, 94, 76, 74, 96, 86);
    g.bezierCurveTo(116, 74, 122, 94, 96, 112);
    g.fill();
    g.fillStyle = '#c8ccd4';
    g.fillRect(158, 74, 6, 34);
    g.fillStyle = '#7a5130';
    g.fillRect(150, 106, 22, 5);
    g.fillRect(158, 111, 6, 10);
    g.fillStyle = '#3b6fc4';
    g.beginPath();
    (g as any).roundRect ? (g as any).roundRect(196, 74, 52, 46, 8) : g.rect(196, 74, 52, 46);
    g.fill();
    g.fillStyle = '#5f90e0';
    g.fillRect(202, 80, 40, 34);
    return c.toDataURL('image/png');
}

const info: TextureInfo = {
    imageUuid: 'img-1',
    imageUrl: 'db://assets/2DSprite/hero.png',
    imagePath: 'E:/Workspace/cocos/Spritesheet/assets/2DSprite/hero.png',
    fileName: 'hero.png',
    baseName: 'hero',
    plistUrl: 'db://assets/2DSprite/hero.plist',
    plistPath: 'E:/Workspace/cocos/Spritesheet/assets/2DSprite/hero.plist',
};

const state = location.hash.slice(1) || 'selected';

const bridge: SheetBridge = {
    async resolve(uuid) {
        return uuid === 'img-1' ? { info, focusFrame: null } : null;
    },
    async loadImage() {
        return { url: drawSheet(), revoke() {} };
    },
    async readSheet(): Promise<LoadedSheet> {
        if (state === 'readonly') {
            return {
                rects: [{ name: 'packed_0', x: 8, y: 8, w: 48, h: 48, pivotX: 0.5, pivotY: 0.5, borderL: 0, borderT: 0, borderR: 0, borderB: 0 }],
                hasPlist: true,
                readOnlyReason: 'Atlas có frame bị xoay (rotated), thường do TexturePacker đóng gói. Sprite Editor chỉ cho xem. Hãy tắt "Allow rotation" rồi xuất lại nếu muốn sửa.',
                warning: null,
            };
        }
        return { rects: [], hasPlist: false, readOnlyReason: null, warning: null };
    },
    async writeSheet(_info, rects, width, height) {
        (window as any).lastWrite = { rects, width, height };
        return { warnings: [] };
    },
    async ask() {
        return 0;
    },
    selectedAsset() {
        return null;
    },
    async reveal() {},
};

const app = createEditorApp(document.getElementById('app')!, bridge, { app: (window as any).__TEMPLATE__ });
(window as any).spriteEditor = app;

/** Scripted mouse/keyboard session; results are written to <pre id="result">. */
async function interact() {
    const out: string[] = [];
    const check = (name: string, cond: boolean, detail: unknown = '') => {
        out.push(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
    };
    const tick = () => new Promise((r) => setTimeout(r, 20));

    await app.load('img-1');
    await tick();
    const store = app.store;
    const vp = app.viewport!;
    const canvas = document.querySelector('canvas.view') as HTMLCanvasElement;
    const root = document.querySelector('.se') as HTMLElement;
    const at = (ix: number, iy: number) => {
        const b = canvas.getBoundingClientRect();
        return { clientX: b.left + vp.panX + ix * vp.zoom, clientY: b.top + vp.panY + iy * vp.zoom };
    };
    const down = (ix: number, iy: number, extra: MouseEventInit = {}) =>
        canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(ix, iy), ...extra }));
    const move = (ix: number, iy: number) => window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...at(ix, iy) }));
    const up = (ix: number, iy: number) => window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, ...at(ix, iy) }));
    const drag = async (x0: number, y0: number, x1: number, y1: number) => {
        down(x0, y0);
        move((x0 + x1) / 2, (y0 + y1) / 2);
        move(x1, y1);
        up(x1, y1);
        await tick();
    };
    const key = (k: string, extra: KeyboardEventInit = {}) =>
        root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
    const r0 = () => store.state.rects[0];
    const pick = (o: any) => ({ x: o.x, y: o.y, w: o.w, h: o.h });

    check('zoom fitted', vp.zoom >= 1, vp.zoom);

    await drag(10, 10, 60, 50);
    check('drag on empty space creates a rect', store.state.rects.length === 1 && JSON.stringify(pick(r0())) === JSON.stringify({ x: 10, y: 10, w: 50, h: 40 }), store.state.rects);
    check('new rect is named <texture>_0 and selected', r0().name === 'hero_0' && store.state.selected[0] === r0().id, r0());
    check('rect counts as unapplied change', store.dirty.value === true);

    await drag(30, 30, 50, 40);
    check('drag inside moves', r0().x === 30 && r0().y === 20, pick(r0()));

    await drag(80, 60, 90, 70);
    check('corner handle resizes', r0().w === 60 && r0().h === 50, pick(r0()));

    await drag(60, 45, 30, 70);
    check('pivot drag (bottom-left)', r0().pivotX === 0 && r0().pivotY === 0, { px: r0().pivotX, py: r0().pivotY });

    await drag(30.2, 35, 40, 35);
    check('inner edge band drags the border', r0().borderL === 10, { l: r0().borderL });

    key('z', { ctrlKey: true });
    check('Ctrl+Z undoes the border', r0().borderL === 0, { l: r0().borderL });
    key('y', { ctrlKey: true });
    check('Ctrl+Y redoes it', r0().borderL === 10, { l: r0().borderL });

    store.patchRect(r0().id, { borderT: 3 });
    store.patchRect(r0().id, { borderB: 4 });
    key('z', { ctrlKey: true });
    app.shortcut('undo'); // same press delivered again by the Editor shortcut system
    check('keydown + shortcut message undo only once', r0().borderB === 0 && r0().borderT === 3, { t: r0().borderT, b: r0().borderB });
    key('z', { ctrlKey: true });
    check('held Ctrl+Z keeps undoing', r0().borderT === 0, { t: r0().borderT });
    key('y', { ctrlKey: true });
    key('y', { ctrlKey: true });
    check('redo twice', r0().borderT === 3 && r0().borderB === 4, { t: r0().borderT, b: r0().borderB });
    await new Promise((r) => setTimeout(r, 300));
    app.shortcut('undo');
    check('shortcut message alone works when no keydown came first', r0().borderB === 0, { b: r0().borderB });
    await new Promise((r) => setTimeout(r, 300));
    app.shortcut('redo');
    check('shortcut redo', r0().borderB === 4, { b: r0().borderB });

    key('ArrowRight', { shiftKey: true });
    check('Shift+Arrow nudges 10px', r0().x === 40, pick(r0()));

    down(250, 3);
    up(250, 3);
    await tick();
    check('click on empty space deselects without creating', store.state.selected.length === 0 && store.state.rects.length === 1, store.state);

    down(50, 40);
    up(50, 40);
    key('Delete');
    check('Delete removes the selected rect', store.state.rects.length === 0);
    key('z', { ctrlKey: true });
    check('undo restores it', store.state.rects.length === 1);

    // Inspector number field
    down(50, 40);
    up(50, 40);
    await tick();
    const xInput = document.querySelector('.inspector .nf-input') as HTMLInputElement;
    xInput.dispatchEvent(new FocusEvent('focus'));
    xInput.value = '12';
    xInput.dispatchEvent(new Event('input'));
    xInput.dispatchEvent(new FocusEvent('blur'));
    await tick();
    check('inspector X field edits the rect', r0().x === 12, pick(r0()));

    // Slicing
    store.state.slice.type = 'auto';
    store.state.slice.method = 'delete';
    store.doSlice();
    const names = store.state.rects.map((r) => r.name);
    check('automatic slice finds 8 sprites in reading order', names.join(',') === 'hero_0,hero_1,hero_2,hero_3,hero_4,hero_5,hero_6,hero_7', names);
    const heart = store.state.rects[5];
    check('heart box', heart.x > 64 && heart.x < 128 && heart.y > 64, pick(heart));

    store.patchRect(store.state.rects[2].id, { name: 'slime_c', x: 140, w: 30 });
    store.state.slice.method = 'smart';
    store.doSlice();
    const slime = store.state.rects.find((r) => r.name === 'slime_c');
    check('Smart keeps the renamed sprite and refits it', store.state.rects.length === 8 && !!slime && slime.w > 30, store.state.rects.map((r) => r.name + ':' + r.x + ',' + r.w));

    store.addRect({ x: 0, y: 0, w: 4, h: 4 });
    store.state.slice.method = 'safe';
    store.doSlice();
    check('Safe adds nothing that overlaps', store.state.rects.length === 9, store.state.rects.length);

    store.state.slice.type = 'cell-count';
    store.state.slice.grid = { cellW: 0, cellH: 0, cols: 4, rows: 2, offsetX: 0, offsetY: 0, padX: 0, padY: 0 };
    store.state.slice.method = 'delete';
    store.state.slice.pivot = 'bottom';
    store.doSlice();
    check('grid by cell count 4×2', store.state.rects.length === 8 && store.state.rects.every((r) => r.w === 64 && r.h === 64 && r.pivotY === 0), store.state.rects.length);

    // Apply
    store.patchRect(store.state.rects[1].id, { name: 'hero_0' });
    const ok1 = await store.apply();
    check('Apply refuses duplicate names', ok1 === false && store.state.noticeError);
    store.patchRect(store.state.rects[1].id, { name: 'hero_1' });
    const ok2 = await store.apply();
    const w = (window as any).lastWrite;
    check('Apply writes all rects', ok2 === true && w && w.rects.length === 8 && w.width === 256 && w.rects[0].pivotY === 0, w);
    check('Apply clears dirty', store.dirty.value === false);
    store.patchRect(store.state.rects[0].id, { x: 3 });
    check('edit after Apply is dirty', store.dirty.value === true);
    key('z', { ctrlKey: true });
    check('undo back to the applied state is clean', store.dirty.value === false && store.state.rects[0].x === 0, pick(store.state.rects[0]));
    store.patchRect(store.state.rects[0].id, { y: 7 });
    store.deleteSelected();
    store.select([store.state.rects[4].id]);
    store.deleteSelected();
    store.revert();
    check('Revert returns to the applied state', store.dirty.value === false && store.state.rects.length === 8);

    const pre = document.createElement('pre');
    pre.id = 'result';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
}

(async () => {
    if (state === 'empty') return;
    if (state === 'interact') {
        try {
            await interact();
        } catch (e) {
            const pre = document.createElement('pre');
            pre.id = 'result';
            pre.textContent = 'FAIL exception ' + ((e as Error).stack || e);
            document.body.appendChild(pre);
        }
        return;
    }
    await app.load('img-1');
    const store = app.store;
    if (state === 'readonly') {
        store.select([store.state.rects[0].id]);
        return;
    }
    store.state.slice.auto.minSize = 4;
    store.doSlice();
    const rects = store.state.rects;
    if (state === 'selected' || state === 'zoom') {
        const panel = rects[rects.length - 1];
        store.select([panel.id]);
        store.patchRect(panel.id, { borderL: 10, borderR: 10, borderT: 10, borderB: 10 });
        store.setPivotPreset([panel.id], 'bottom');
        if (state === 'zoom') {
            await new Promise((r) => setTimeout(r, 50));
            const vp = document.querySelector('canvas')!;
            vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
            (document.querySelector('.se') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
        }
    } else if (state === 'multi') {
        store.select(rects.slice(0, 4).map((r) => r.id));
    } else if (state === 'slice') {
        store.state.slice.type = 'cell-size';
        store.state.slice.grid.cellW = 64;
        store.state.slice.grid.cellH = 64;
        (document.querySelector('.tb-drop') as HTMLElement).click();
    }
})();
