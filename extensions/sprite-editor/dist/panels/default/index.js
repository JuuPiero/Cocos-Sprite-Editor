"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const editor_bridge_1 = require("../../core/editor-bridge");
const app_1 = require("./app");
const PACKAGE = 'sprite-editor';
const STATIC = (0, path_1.join)(__dirname, '../../../static');
const apps = new WeakMap();
/** Asset requested before the Vue app finished mounting. */
const early = new WeakMap();
module.exports = Editor.Panel.define({
    template: (0, fs_1.readFileSync)((0, path_1.join)(STATIC, 'template/default/index.html'), 'utf-8'),
    style: (0, fs_1.readFileSync)((0, path_1.join)(STATIC, 'style/default/index.css'), 'utf-8'),
    $: {
        app: '#app',
    },
    methods: {
        /** Message "panel-load-asset": open a texture/atlas in this panel. */
        loadAsset(uuid) {
            const app = apps.get(this);
            if (app)
                app.load(uuid);
            else
                early.set(this, uuid);
        },
        /** Broadcast "selection:select": follow the Assets selection like Unity. */
        onSelectionSelect(type, uuid) {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.onSelect(type, uuid);
        },
        /** Broadcast "asset-db:asset-change": refresh pixels when the image changes. */
        onAssetChange(uuid) {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.onAssetChange(uuid);
        },
        // Panel-scoped shortcuts (package.json contributions.shortcuts). They take
        // precedence over global ones such as Ctrl+S = save scene.
        shortcutUndo() {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.shortcut('undo');
        },
        shortcutRedo() {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.shortcut('redo');
        },
        shortcutApply() {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.shortcut('apply');
        },
        shortcutDelete() {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.shortcut('delete');
        },
        shortcutSelectAll() {
            var _a;
            (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.shortcut('select-all');
        },
    },
    async ready() {
        const el = this.$.app;
        const app = (0, app_1.createEditorApp)(el, editor_bridge_1.editorBridge, {
            app: (0, fs_1.readFileSync)((0, path_1.join)(STATIC, 'template/vue/app.html'), 'utf-8'),
        });
        apps.set(this, app);
        // Always drain the main-process slot so a stale request is not reused later.
        let pending = null;
        try {
            pending = await Editor.Message.request(PACKAGE, 'take-pending');
        }
        catch (_a) {
            pending = null;
        }
        const target = early.get(this) || pending;
        early.delete(this);
        if (target) {
            app.load(target);
        }
        else {
            const selected = editor_bridge_1.editorBridge.selectedAsset();
            if (selected)
                app.load(selected, { fromSelection: true });
        }
    },
    async beforeClose() {
        const app = apps.get(this);
        return app ? app.confirmClose() : true;
    },
    close() {
        var _a;
        (_a = apps.get(this)) === null || _a === void 0 ? void 0 : _a.destroy();
        apps.delete(this);
    },
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zb3VyY2UvcGFuZWxzL2RlZmF1bHQvaW5kZXgudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTRCO0FBQzVCLDREQUF3RDtBQUN4RCwrQkFBeUQ7QUFFekQsTUFBTSxPQUFPLEdBQUcsZUFBZSxDQUFDO0FBQ2hDLE1BQU0sTUFBTSxHQUFHLElBQUEsV0FBSSxFQUFDLFNBQVMsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0FBRWxELE1BQU0sSUFBSSxHQUFHLElBQUksT0FBTyxFQUEyQixDQUFDO0FBQ3BELDREQUE0RDtBQUM1RCxNQUFNLEtBQUssR0FBRyxJQUFJLE9BQU8sRUFBa0IsQ0FBQztBQUU1QyxNQUFNLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ2pDLFFBQVEsRUFBRSxJQUFBLGlCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsTUFBTSxFQUFFLDZCQUE2QixDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQzVFLEtBQUssRUFBRSxJQUFBLGlCQUFZLEVBQUMsSUFBQSxXQUFJLEVBQUMsTUFBTSxFQUFFLHlCQUF5QixDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQ3JFLENBQUMsRUFBRTtRQUNDLEdBQUcsRUFBRSxNQUFNO0tBQ2Q7SUFDRCxPQUFPLEVBQUU7UUFDTCxzRUFBc0U7UUFDdEUsU0FBUyxDQUFDLElBQVk7WUFDbEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUMzQixJQUFJLEdBQUc7Z0JBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQzs7Z0JBQ25CLEtBQUssQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBQy9CLENBQUM7UUFDRCw0RUFBNEU7UUFDNUUsaUJBQWlCLENBQUMsSUFBWSxFQUFFLElB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LENBQUMsQ0FBQztJQUN0QixDQUFDO0NBQ0osQ0FBQyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgcmVhZEZpbGVTeW5jIH0gZnJvbSAnZnMnO1xuaW1wb3J0IHsgam9pbiB9IGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgZWRpdG9yQnJpZGdlIH0gZnJvbSAnLi4vLi4vY29yZS9lZGl0b3ItYnJpZGdlJztcbmltcG9ydCB7IFNwcml0ZUVkaXRvckFwcCwgY3JlYXRlRWRpdG9yQXBwIH0gZnJvbSAnLi9hcHAnO1xuXG5jb25zdCBQQUNLQUdFID0gJ3Nwcml0ZS1lZGl0b3InO1xuY29uc3QgU1RBVElDID0gam9pbihfX2Rpcm5hbWUsICcuLi8uLi8uLi9zdGF0aWMnKTtcblxuY29uc3QgYXBwcyA9IG5ldyBXZWFrTWFwPG9iamVjdCwgU3ByaXRlRWRpdG9yQXBwPigpO1xuLyoqIEFzc2V0IHJlcXVlc3RlZCBiZWZvcmUgdGhlIFZ1ZSBhcHAgZmluaXNoZWQgbW91bnRpbmcuICovXG5jb25zdCBlYXJseSA9IG5ldyBXZWFrTWFwPG9iamVjdCwgc3RyaW5nPigpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVkaXRvci5QYW5lbC5kZWZpbmUoe1xuICAgIHRlbXBsYXRlOiByZWFkRmlsZVN5bmMoam9pbihTVEFUSUMsICd0ZW1wbGF0ZS9kZWZhdWx0L2luZGV4Lmh0bWwnKSwgJ3V0Zi04JyksXG4gICAgc3R5bGU6IHJlYWRGaWxlU3luYyhqb2luKFNUQVRJQywgJ3N0eWxlL2RlZmF1bHQvaW5kZXguY3NzJyksICd1dGYtOCcpLFxuICAgICQ6IHtcbiAgICAgICAgYXBwOiAnI2FwcCcsXG4gICAgfSxcbiAgICBtZXRob2RzOiB7XG4gICAgICAgIC8qKiBNZXNzYWdlIFwicGFuZWwtbG9hZC1hc3NldFwiOiBvcGVuIGEgdGV4dHVyZS9hdGxhcyBpbiB0aGlzIHBhbmVsLiAqL1xuICAgICAgICBsb2FkQXNzZXQodXVpZDogc3RyaW5nKSB7XG4gICAgICAgICAgICBjb25zdCBhcHAgPSBhcHBzLmdldCh0aGlzKTtcbiAgICAgICAgICAgIGlmIChhcHApIGFwcC5sb2FkKHV1aWQpO1xuICAgICAgICAgICAgZWxzZSBlYXJseS5zZXQodGhpcywgdXVpZCk7XG4gICAgICAgIH0sXG4gICAgICAgIC8qKiBCcm9hZGNhc3QgXCJzZWxlY3Rpb246c2VsZWN0XCI6IGZvbGxvdyB0aGUgQXNzZXRzIHNlbGVjdGlvbiBsaWtlIFVuaXR5LiAqL1xuICAgICAgICBvblNlbGVjdGlvblNlbGVjdCh0eXBlOiBzdHJpbmcsIHV1aWQ6IHN0cmluZykge1xuICAgICAgICAgICAgYXBwcy5nZXQodGhpcyk/Lm9uU2VsZWN0KHR5cGUsIHV1aWQpO1xuICAgICAgICB9LFxuICAgICAgICAvKiogQnJvYWRjYXN0IFwiYXNzZXQtZGI6YXNzZXQtY2hhbmdlXCI6IHJlZnJlc2ggcGl4ZWxzIHdoZW4gdGhlIGltYWdlIGNoYW5nZXMuICovXG4gICAgICAgIG9uQXNzZXRDaGFuZ2UodXVpZDogc3RyaW5nKSB7XG4gICAgICAgICAgICBhcHBzLmdldCh0aGlzKT8ub25Bc3NldENoYW5nZSh1dWlkKTtcbiAgICAgICAgfSxcbiAgICAgICAgLy8gUGFuZWwtc2NvcGVkIHNob3J0Y3V0cyAocGFja2FnZS5qc29uIGNvbnRyaWJ1dGlvbnMuc2hvcnRjdXRzKS4gVGhleSB0YWtlXG4gICAgICAgIC8vIHByZWNlZGVuY2Ugb3ZlciBnbG9iYWwgb25lcyBzdWNoIGFzIEN0cmwrUyA9IHNhdmUgc2NlbmUuXG4gICAgICAgIHNob3J0Y3V0VW5kbygpIHtcbiAgICAgICAgICAgIGFwcHMuZ2V0KHRoaXMpPy5zaG9ydGN1dCgndW5kbycpO1xuICAgICAgICB9LFxuICAgICAgICBzaG9ydGN1dFJlZG8oKSB7XG4gICAgICAgICAgICBhcHBzLmdldCh0aGlzKT8uc2hvcnRjdXQoJ3JlZG8nKTtcbiAgICAgICAgfSxcbiAgICAgICAgc2hvcnRjdXRBcHBseSgpIHtcbiAgICAgICAgICAgIGFwcHMuZ2V0KHRoaXMpPy5zaG9ydGN1dCgnYXBwbHknKTtcbiAgICAgICAgfSxcbiAgICAgICAgc2hvcnRjdXREZWxldGUoKSB7XG4gICAgICAgICAgICBhcHBzLmdldCh0aGlzKT8uc2hvcnRjdXQoJ2RlbGV0ZScpO1xuICAgICAgICB9LFxuICAgICAgICBzaG9ydGN1dFNlbGVjdEFsbCgpIHtcbiAgICAgICAgICAgIGFwcHMuZ2V0KHRoaXMpPy5zaG9ydGN1dCgnc2VsZWN0LWFsbCcpO1xuICAgICAgICB9LFxuICAgIH0sXG4gICAgYXN5bmMgcmVhZHkoKSB7XG4gICAgICAgIGNvbnN0IGVsID0gKHRoaXMgYXMgYW55KS4kLmFwcCBhcyBIVE1MRWxlbWVudDtcbiAgICAgICAgY29uc3QgYXBwID0gY3JlYXRlRWRpdG9yQXBwKGVsLCBlZGl0b3JCcmlkZ2UsIHtcbiAgICAgICAgICAgIGFwcDogcmVhZEZpbGVTeW5jKGpvaW4oU1RBVElDLCAndGVtcGxhdGUvdnVlL2FwcC5odG1sJyksICd1dGYtOCcpLFxuICAgICAgICB9KTtcbiAgICAgICAgYXBwcy5zZXQodGhpcywgYXBwKTtcblxuICAgICAgICAvLyBBbHdheXMgZHJhaW4gdGhlIG1haW4tcHJvY2VzcyBzbG90IHNvIGEgc3RhbGUgcmVxdWVzdCBpcyBub3QgcmV1c2VkIGxhdGVyLlxuICAgICAgICBsZXQgcGVuZGluZzogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBwZW5kaW5nID0gYXdhaXQgKEVkaXRvci5NZXNzYWdlLnJlcXVlc3QgYXMgYW55KShQQUNLQUdFLCAndGFrZS1wZW5kaW5nJyk7XG4gICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgcGVuZGluZyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gZWFybHkuZ2V0KHRoaXMpIHx8IHBlbmRpbmc7XG4gICAgICAgIGVhcmx5LmRlbGV0ZSh0aGlzKTtcbiAgICAgICAgaWYgKHRhcmdldCkge1xuICAgICAgICAgICAgYXBwLmxvYWQodGFyZ2V0KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnN0IHNlbGVjdGVkID0gZWRpdG9yQnJpZGdlLnNlbGVjdGVkQXNzZXQoKTtcbiAgICAgICAgICAgIGlmIChzZWxlY3RlZCkgYXBwLmxvYWQoc2VsZWN0ZWQsIHsgZnJvbVNlbGVjdGlvbjogdHJ1ZSB9KTtcbiAgICAgICAgfVxuICAgIH0sXG4gICAgYXN5bmMgYmVmb3JlQ2xvc2UoKSB7XG4gICAgICAgIGNvbnN0IGFwcCA9IGFwcHMuZ2V0KHRoaXMpO1xuICAgICAgICByZXR1cm4gYXBwID8gYXBwLmNvbmZpcm1DbG9zZSgpIDogdHJ1ZTtcbiAgICB9LFxuICAgIGNsb3NlKCkge1xuICAgICAgICBhcHBzLmdldCh0aGlzKT8uZGVzdHJveSgpO1xuICAgICAgICBhcHBzLmRlbGV0ZSh0aGlzKTtcbiAgICB9LFxufSk7XG4iXX0=