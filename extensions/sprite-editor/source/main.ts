// @ts-ignore
import packageJSON from '../package.json';

/** Asset the panel should open once it is ready (set by the Assets context menu). */
let pending: string | null = null;

/**
 * @en Registration method for the main process of Extension
 * @zh 为扩展的主进程的注册方法
 */
export const methods: { [key: string]: (...any: any) => any } = {
    openPanel() {
        Editor.Panel.open(packageJSON.name);
    },

    /** Open the Sprite Editor on an image / atlas asset (uuid). */
    async editAsset(uuid: string) {
        if (!uuid) return;
        pending = uuid;
        await Editor.Panel.open(packageJSON.name);
        // Already-open panel: deliver directly. A freshly opened panel picks it up
        // through take-pending in ready().
        Editor.Message.send(packageJSON.name, 'panel-load-asset', uuid);
    },

    takePending() {
        const uuid = pending;
        pending = null;
        return uuid;
    },
};

/**
 * @en Method Triggered on Extension Startup
 * @zh 扩展启动时触发的方法
 */
export function load() { }

/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
export function unload() { }
