"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAssetMenu = onAssetMenu;
/**
 * Assets panel context menu: "Sprite Editor" on images, their texture /
 * sprite-frame sub-assets and .plist atlases.
 */
const EDITABLE = new Set(['image', 'texture', 'sprite-frame', 'sprite-atlas']);
function onAssetMenu(assetInfo) {
    if (!assetInfo || assetInfo.isDirectory || !EDITABLE.has(assetInfo.importer))
        return [];
    return [
        {
            label: 'Sprite Editor',
            click() {
                Editor.Message.send('sprite-editor', 'edit-asset', assetInfo.uuid);
            },
        },
    ];
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXNzZXRzLW1lbnUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zb3VyY2UvYXNzZXRzLW1lbnUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFNQSxrQ0FVQztBQWhCRDs7O0dBR0c7QUFDSCxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsQ0FBQyxDQUFDLE9BQU8sRUFBRSxTQUFTLEVBQUUsY0FBYyxFQUFFLGNBQWMsQ0FBQyxDQUFDLENBQUM7QUFFL0UsU0FBZ0IsV0FBVyxDQUFDLFNBQW9FO0lBQzVGLElBQUksQ0FBQyxTQUFTLElBQUksU0FBUyxDQUFDLFdBQVcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQztRQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3hGLE9BQU87UUFDSDtZQUNJLEtBQUssRUFBRSxlQUFlO1lBQ3RCLEtBQUs7Z0JBQ0QsTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsZUFBZSxFQUFFLFlBQVksRUFBRSxTQUFTLENBQUMsSUFBSSxDQUFDLENBQUM7WUFDdkUsQ0FBQztTQUNKO0tBQ0osQ0FBQztBQUNOLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKipcbiAqIEFzc2V0cyBwYW5lbCBjb250ZXh0IG1lbnU6IFwiU3ByaXRlIEVkaXRvclwiIG9uIGltYWdlcywgdGhlaXIgdGV4dHVyZSAvXG4gKiBzcHJpdGUtZnJhbWUgc3ViLWFzc2V0cyBhbmQgLnBsaXN0IGF0bGFzZXMuXG4gKi9cbmNvbnN0IEVESVRBQkxFID0gbmV3IFNldChbJ2ltYWdlJywgJ3RleHR1cmUnLCAnc3ByaXRlLWZyYW1lJywgJ3Nwcml0ZS1hdGxhcyddKTtcblxuZXhwb3J0IGZ1bmN0aW9uIG9uQXNzZXRNZW51KGFzc2V0SW5mbzogeyB1dWlkOiBzdHJpbmc7IGltcG9ydGVyOiBzdHJpbmc7IGlzRGlyZWN0b3J5PzogYm9vbGVhbiB9KSB7XG4gICAgaWYgKCFhc3NldEluZm8gfHwgYXNzZXRJbmZvLmlzRGlyZWN0b3J5IHx8ICFFRElUQUJMRS5oYXMoYXNzZXRJbmZvLmltcG9ydGVyKSkgcmV0dXJuIFtdO1xuICAgIHJldHVybiBbXG4gICAgICAgIHtcbiAgICAgICAgICAgIGxhYmVsOiAnU3ByaXRlIEVkaXRvcicsXG4gICAgICAgICAgICBjbGljaygpIHtcbiAgICAgICAgICAgICAgICBFZGl0b3IuTWVzc2FnZS5zZW5kKCdzcHJpdGUtZWRpdG9yJywgJ2VkaXQtYXNzZXQnLCBhc3NldEluZm8udXVpZCk7XG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgIF07XG59XG4iXX0=