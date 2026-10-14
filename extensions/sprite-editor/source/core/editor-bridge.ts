/**
 * SheetBridge backed by the Cocos Creator asset database.
 *
 * Output format: a TexturePacker-style "<image>.plist" next to the image. Cocos
 * imports it natively as a SpriteAtlas whose SpriteFrames (one per slice) can be
 * dragged into Sprite components, used in animation clips and loaded at runtime.
 * Pivot and 9-slice border live in the SpriteFrame sub-metas of that plist.
 */
import { existsSync, promises as fsp } from 'fs';
import { basename, dirname, extname, join } from 'path';
import { LoadedSheet, RectData, ResolvedTarget, SheetBridge, TextureInfo, WriteResult } from './bridge';
import { buildPlist, parsePlist, readSheet } from './plist';

const MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

async function queryInfo(uuidOrUrl: string): Promise<any | null> {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', uuidOrUrl);
    } catch {
        return null;
    }
}

async function queryMeta(uuid: string): Promise<any | null> {
    try {
        return await Editor.Message.request('asset-db', 'query-asset-meta', uuid);
    } catch {
        return null;
    }
}

function urlDir(url: string): string {
    return url.slice(0, url.lastIndexOf('/'));
}

function makeInfo(image: any, plist?: { url: string; file: string }): TextureInfo {
    const file: string = image.file;
    const fileName = basename(file);
    const ext = extname(fileName);
    const baseName = fileName.slice(0, fileName.length - ext.length);
    const imageUrl: string = image.url;
    return {
        imageUuid: image.uuid,
        imageUrl,
        imagePath: file,
        fileName,
        baseName,
        plistUrl: plist ? plist.url : `${urlDir(imageUrl)}/${baseName}.plist`,
        plistPath: plist ? plist.file : join(dirname(file), `${baseName}.plist`),
    };
}

/**
 * Apply pivot/border from the rects to the plist's SpriteFrame sub-metas.
 * Returns the frame names whose values could not be confirmed.
 */
async function patchSubMetas(plistUuid: string, rects: RectData[]): Promise<string[]> {
    const byName = new Map(rects.map((r) => [r.name, r]));
    let missing: string[] = rects.map((r) => r.name);
    let saves = 0;
    // The asset may still be re-importing right after save; retry until the
    // sub-metas exist and our values stick.
    for (let attempt = 0; attempt < 30; attempt++) {
        const meta = await queryMeta(plistUuid);
        const subs: any[] = meta ? Object.values(meta.subMetas || {}) : [];
        const seen = new Set(subs.map((s) => s.name));
        missing = rects.filter((r) => !seen.has(r.name)).map((r) => r.name);
        if (!meta || missing.length) {
            await sleep(200);
            continue;
        }
        const changedNames: string[] = [];
        for (const sub of subs) {
            const r = byName.get(sub.name);
            if (!r) continue;
            const ud = sub.userData || (sub.userData = {});
            const want: Record<string, number> = {
                pivotX: r.pivotX,
                pivotY: r.pivotY,
                borderLeft: r.borderL,
                borderTop: r.borderT,
                borderRight: r.borderR,
                borderBottom: r.borderB,
            };
            let changed = false;
            for (const k of Object.keys(want)) {
                if (ud[k] !== want[k]) {
                    ud[k] = want[k];
                    changed = true;
                }
            }
            if (changed) changedNames.push(sub.name);
        }
        missing = changedNames;
        if (!changedNames.length || saves >= 3) break;
        saves++;
        await Editor.Message.request('asset-db', 'save-asset-meta', plistUuid, JSON.stringify(meta, null, 2));
        await sleep(150);
    }
    return missing;
}

export const editorBridge: SheetBridge = {
    async resolve(uuid: string): Promise<ResolvedTarget | null> {
        if (!uuid) return null;
        const mainUuid = uuid.split('@')[0];
        const main = await queryInfo(mainUuid);
        if (!main || main.isDirectory) return null;

        if (main.importer === 'image') {
            return { info: makeInfo(main), focusFrame: null };
        }
        if (main.importer !== 'sprite-atlas' || extname(main.file).toLowerCase() !== '.plist') return null;

        let focusFrame: string | null = null;
        if (uuid !== mainUuid) {
            const sub = await queryInfo(uuid);
            focusFrame = sub ? (sub.name || sub.displayName || null) : null;
        }
        const sheet = readSheet(parsePlist(await fsp.readFile(main.file, 'utf8')));
        if (!sheet.textureFileName) return null;
        const image = await queryInfo(`${urlDir(main.url)}/${sheet.textureFileName}`);
        if (!image || image.importer !== 'image') return null;
        return { info: makeInfo(image, { url: main.url, file: main.file }), focusFrame };
    },

    async loadImage(info: TextureInfo) {
        const bytes = await fsp.readFile(info.imagePath);
        const type = MIME[extname(info.imagePath).toLowerCase()] || 'application/octet-stream';
        const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
        return { url, revoke: () => URL.revokeObjectURL(url) };
    },

    async readSheet(info: TextureInfo): Promise<LoadedSheet> {
        if (!existsSync(info.plistPath)) {
            return { rects: [], hasPlist: false, readOnlyReason: null, warning: null };
        }
        const sheet = readSheet(parsePlist(await fsp.readFile(info.plistPath, 'utf8')));
        const plistInfo = await queryInfo(info.plistUrl);
        const meta = plistInfo ? await queryMeta(plistInfo.uuid) : null;
        const userData = new Map<string, any>();
        for (const sub of Object.values<any>(meta?.subMetas || {})) userData.set(sub.name, sub.userData || {});

        const rects: RectData[] = sheet.frames.map((f) => {
            const ud = userData.get(f.name) || {};
            return {
                name: f.name,
                x: f.x,
                y: f.y,
                // A rotated frame occupies h×w pixels in the texture.
                w: f.rotated ? f.h : f.w,
                h: f.rotated ? f.w : f.h,
                pivotX: num(ud.pivotX, 0.5),
                pivotY: num(ud.pivotY, 0.5),
                borderL: num(ud.borderLeft, 0),
                borderT: num(ud.borderTop, 0),
                borderR: num(ud.borderRight, 0),
                borderB: num(ud.borderBottom, 0),
            };
        });

        const notes: string[] = [];
        if (!sheet.ownFile) {
            notes.push(`${basename(info.plistPath)} không do Sprite Editor tạo (có thể từ TexturePacker). Apply sẽ ghi lại file theo định dạng của Sprite Editor.`);
            if (sheet.frames.some((f) => f.trimmed)) notes.push('Các frame đã bị trim sẽ mất offset gốc khi Apply.');
        }
        if (sheet.textureFileName && sheet.textureFileName !== info.fileName) {
            notes.push(`Plist trỏ tới "${sheet.textureFileName}", không phải "${info.fileName}".`);
        }
        return {
            rects,
            hasPlist: true,
            readOnlyReason: sheet.frames.some((f) => f.rotated)
                ? 'Atlas có frame bị xoay (rotated), thường do TexturePacker đóng gói. Sprite Editor chỉ cho xem. Hãy tắt "Allow rotation" rồi xuất lại nếu muốn sửa.'
                : null,
            warning: notes.length ? notes.join(' ') : null,
        };
    },

    async writeSheet(info: TextureInfo, rects: RectData[], width: number, height: number): Promise<WriteResult> {
        const xml = buildPlist(info.fileName, width, height, rects);
        let plistInfo = await queryInfo(info.plistUrl);
        if (plistInfo) {
            // save-asset keeps the uuid, so existing references to the atlas stay valid.
            try {
                await Editor.Message.request('asset-db', 'save-asset', plistInfo.uuid, xml);
            } catch {
                await fsp.writeFile(info.plistPath, xml, 'utf8');
                await Editor.Message.request('asset-db', 'refresh-asset', info.plistUrl);
            }
        } else {
            plistInfo = await Editor.Message.request('asset-db', 'create-asset', info.plistUrl, xml);
            if (!plistInfo) throw new Error(`Không tạo được ${info.plistUrl}`);
        }
        const missing = await patchSubMetas(plistInfo.uuid, rects);
        const warnings: string[] = [];
        if (missing.length) {
            warnings.push(`Chưa ghi được pivot/border cho: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. Hãy bấm Apply lại.`);
        }
        return { warnings };
    },

    async ask(message, detail, buttons, defaultId, cancelId) {
        const res = await Editor.Dialog.warn(message, {
            title: 'Sprite Editor',
            detail,
            buttons,
            default: defaultId,
            cancel: cancelId,
        });
        return res.response;
    },

    selectedAsset() {
        if (Editor.Selection.getLastSelectedType() !== 'asset') return null;
        return Editor.Selection.getLastSelected('asset') || null;
    },

    async reveal(uuidOrUrl: string) {
        const info = await queryInfo(uuidOrUrl);
        if (!info) return;
        Editor.Selection.clear('asset');
        Editor.Selection.select('asset', info.uuid);
    },
};
