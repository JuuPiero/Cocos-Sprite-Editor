/**
 * Assets panel context menu: "Sprite Editor" on images, their texture /
 * sprite-frame sub-assets and .plist atlases.
 */
const EDITABLE = new Set(['image', 'texture', 'sprite-frame', 'sprite-atlas']);

export function onAssetMenu(assetInfo: { uuid: string; importer: string; isDirectory?: boolean }) {
    if (!assetInfo || assetInfo.isDirectory || !EDITABLE.has(assetInfo.importer)) return [];
    return [
        {
            label: 'Sprite Editor',
            click() {
                Editor.Message.send('sprite-editor', 'edit-asset', assetInfo.uuid);
            },
        },
    ];
}
