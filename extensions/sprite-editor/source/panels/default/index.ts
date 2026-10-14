import { readFileSync } from 'fs';
import { join } from 'path';
import { editorBridge } from '../../core/editor-bridge';
import { SpriteEditorApp, createEditorApp } from './app';

const PACKAGE = 'sprite-editor';
const STATIC = join(__dirname, '../../../static');

const apps = new WeakMap<object, SpriteEditorApp>();
/** Asset requested before the Vue app finished mounting. */
const early = new WeakMap<object, string>();

module.exports = Editor.Panel.define({
    template: readFileSync(join(STATIC, 'template/default/index.html'), 'utf-8'),
    style: readFileSync(join(STATIC, 'style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {
        /** Message "panel-load-asset": open a texture/atlas in this panel. */
        loadAsset(uuid: string) {
            const app = apps.get(this);
            if (app) app.load(uuid);
            else early.set(this, uuid);
        },
        /** Broadcast "selection:select": follow the Assets selection like Unity. */
        onSelectionSelect(type: string, uuid: string) {
            apps.get(this)?.onSelect(type, uuid);
        },
        /** Broadcast "asset-db:asset-change": refresh pixels when the image changes. */
        onAssetChange(uuid: string) {
            apps.get(this)?.onAssetChange(uuid);
        },
        // Panel-scoped shortcuts (package.json contributions.shortcuts). They take
        // precedence over global ones such as Ctrl+S = save scene.
        shortcutUndo() {
            apps.get(this)?.shortcut('undo');
        },
        shortcutRedo() {
            apps.get(this)?.shortcut('redo');
        },
        shortcutApply() {
            apps.get(this)?.shortcut('apply');
        },
        shortcutDelete() {
            apps.get(this)?.shortcut('delete');
        },
        shortcutSelectAll() {
            apps.get(this)?.shortcut('select-all');
        },
    },
    async ready() {
        const el = (this as any).$.app as HTMLElement;
        const app = createEditorApp(el, editorBridge, {
            app: readFileSync(join(STATIC, 'template/vue/app.html'), 'utf-8'),
        });
        apps.set(this, app);

        // Always drain the main-process slot so a stale request is not reused later.
        let pending: string | null = null;
        try {
            pending = await (Editor.Message.request as any)(PACKAGE, 'take-pending');
        } catch {
            pending = null;
        }
        const target = early.get(this) || pending;
        early.delete(this);
        if (target) {
            app.load(target);
        } else {
            const selected = editorBridge.selectedAsset();
            if (selected) app.load(selected, { fromSelection: true });
        }
    },
    async beforeClose() {
        const app = apps.get(this);
        return app ? app.confirmClose() : true;
    },
    close() {
        apps.get(this)?.destroy();
        apps.delete(this);
    },
});
