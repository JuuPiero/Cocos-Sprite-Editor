"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.methods = void 0;
exports.load = load;
exports.unload = unload;
// @ts-ignore
const package_json_1 = __importDefault(require("../package.json"));
/** Asset the panel should open once it is ready (set by the Assets context menu). */
let pending = null;
/**
 * @en Registration method for the main process of Extension
 * @zh 为扩展的主进程的注册方法
 */
exports.methods = {
    openPanel() {
        Editor.Panel.open(package_json_1.default.name);
    },
    /** Open the Sprite Editor on an image / atlas asset (uuid). */
    async editAsset(uuid) {
        if (!uuid)
            return;
        pending = uuid;
        await Editor.Panel.open(package_json_1.default.name);
        // Already-open panel: deliver directly. A freshly opened panel picks it up
        // through take-pending in ready().
        Editor.Message.send(package_json_1.default.name, 'panel-load-asset', uuid);
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
function load() { }
/**
 * @en Method triggered when uninstalling the extension
 * @zh 卸载扩展时触发的方法
 */
function unload() { }
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL3NvdXJjZS9tYWluLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQW9DQSxvQkFBMEI7QUFNMUIsd0JBQTRCO0FBMUM1QixhQUFhO0FBQ2IsbUVBQTBDO0FBRTFDLHFGQUFxRjtBQUNyRixJQUFJLE9BQU8sR0FBa0IsSUFBSSxDQUFDO0FBRWxDOzs7R0FHRztBQUNVLFFBQUEsT0FBTyxHQUE0QztJQUM1RCxTQUFTO1FBQ0wsTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsc0JBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN4QyxDQUFDO0lBRUQsK0RBQStEO0lBQy9ELEtBQUssQ0FBQyxTQUFTLENBQUMsSUFBWTtRQUN4QixJQUFJLENBQUMsSUFBSTtZQUFFLE9BQU87UUFDbEIsT0FBTyxHQUFHLElBQUksQ0FBQztRQUNmLE1BQU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsc0JBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxQywyRUFBMkU7UUFDM0UsbUNBQW1DO1FBQ25DLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLHNCQUFXLENBQUMsSUFBSSxFQUFFLGtCQUFrQixFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ3BFLENBQUM7SUFFRCxXQUFXO1FBQ1AsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDO1FBQ3JCLE9BQU8sR0FBRyxJQUFJLENBQUM7UUFDZixPQUFPLElBQUksQ0FBQztJQUNoQixDQUFDO0NBQ0osQ0FBQztBQUVGOzs7R0FHRztBQUNILFNBQWdCLElBQUksS0FBSyxDQUFDO0FBRTFCOzs7R0FHRztBQUNILFNBQWdCLE1BQU0sS0FBSyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWlnbm9yZVxuaW1wb3J0IHBhY2thZ2VKU09OIGZyb20gJy4uL3BhY2thZ2UuanNvbic7XG5cbi8qKiBBc3NldCB0aGUgcGFuZWwgc2hvdWxkIG9wZW4gb25jZSBpdCBpcyByZWFkeSAoc2V0IGJ5IHRoZSBBc3NldHMgY29udGV4dCBtZW51KS4gKi9cbmxldCBwZW5kaW5nOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcblxuLyoqXG4gKiBAZW4gUmVnaXN0cmF0aW9uIG1ldGhvZCBmb3IgdGhlIG1haW4gcHJvY2VzcyBvZiBFeHRlbnNpb25cbiAqIEB6aCDkuLrmianlsZXnmoTkuLvov5vnqIvnmoTms6jlhozmlrnms5VcbiAqL1xuZXhwb3J0IGNvbnN0IG1ldGhvZHM6IHsgW2tleTogc3RyaW5nXTogKC4uLmFueTogYW55KSA9PiBhbnkgfSA9IHtcbiAgICBvcGVuUGFuZWwoKSB7XG4gICAgICAgIEVkaXRvci5QYW5lbC5vcGVuKHBhY2thZ2VKU09OLm5hbWUpO1xuICAgIH0sXG5cbiAgICAvKiogT3BlbiB0aGUgU3ByaXRlIEVkaXRvciBvbiBhbiBpbWFnZSAvIGF0bGFzIGFzc2V0ICh1dWlkKS4gKi9cbiAgICBhc3luYyBlZGl0QXNzZXQodXVpZDogc3RyaW5nKSB7XG4gICAgICAgIGlmICghdXVpZCkgcmV0dXJuO1xuICAgICAgICBwZW5kaW5nID0gdXVpZDtcbiAgICAgICAgYXdhaXQgRWRpdG9yLlBhbmVsLm9wZW4ocGFja2FnZUpTT04ubmFtZSk7XG4gICAgICAgIC8vIEFscmVhZHktb3BlbiBwYW5lbDogZGVsaXZlciBkaXJlY3RseS4gQSBmcmVzaGx5IG9wZW5lZCBwYW5lbCBwaWNrcyBpdCB1cFxuICAgICAgICAvLyB0aHJvdWdoIHRha2UtcGVuZGluZyBpbiByZWFkeSgpLlxuICAgICAgICBFZGl0b3IuTWVzc2FnZS5zZW5kKHBhY2thZ2VKU09OLm5hbWUsICdwYW5lbC1sb2FkLWFzc2V0JywgdXVpZCk7XG4gICAgfSxcblxuICAgIHRha2VQZW5kaW5nKCkge1xuICAgICAgICBjb25zdCB1dWlkID0gcGVuZGluZztcbiAgICAgICAgcGVuZGluZyA9IG51bGw7XG4gICAgICAgIHJldHVybiB1dWlkO1xuICAgIH0sXG59O1xuXG4vKipcbiAqIEBlbiBNZXRob2QgVHJpZ2dlcmVkIG9uIEV4dGVuc2lvbiBTdGFydHVwXG4gKiBAemgg5omp5bGV5ZCv5Yqo5pe26Kem5Y+R55qE5pa55rOVXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsb2FkKCkgeyB9XG5cbi8qKlxuICogQGVuIE1ldGhvZCB0cmlnZ2VyZWQgd2hlbiB1bmluc3RhbGxpbmcgdGhlIGV4dGVuc2lvblxuICogQHpoIOWNuOi9veaJqeWxleaXtuinpuWPkeeahOaWueazlVxuICovXG5leHBvcnQgZnVuY3Rpb24gdW5sb2FkKCkgeyB9XG4iXX0=