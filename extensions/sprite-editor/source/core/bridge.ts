/**
 * Everything the editor UI needs from the outside world. The panel uses the
 * Cocos implementation (editor-bridge.ts); a stub can drive the same UI in a
 * plain browser for testing.
 */
import { SpriteRect } from './types';

export interface TextureInfo {
    imageUuid: string;
    /** db://assets/.../hero.png */
    imageUrl: string;
    /** Absolute path of the image file. */
    imagePath: string;
    /** hero.png */
    fileName: string;
    /** hero */
    baseName: string;
    /** db://assets/.../hero.plist */
    plistUrl: string;
    plistPath: string;
}

export interface ResolvedTarget {
    info: TextureInfo;
    /** Name of an atlas frame the user selected, so the editor can select it. */
    focusFrame: string | null;
}

export type RectData = Omit<SpriteRect, 'id'>;

export interface LoadedSheet {
    rects: RectData[];
    hasPlist: boolean;
    /** Set when the sheet cannot be edited safely (e.g. rotated frames). */
    readOnlyReason: string | null;
    /** Non-blocking notice shown in the editor. */
    warning: string | null;
}

export interface WriteResult {
    warnings: string[];
}

export interface SheetBridge {
    /** Resolve an asset uuid (image, texture, sprite-frame, atlas or atlas frame) to its source image. */
    resolve(uuid: string): Promise<ResolvedTarget | null>;
    /** Object URL for the image file; call revoke() when done. */
    loadImage(info: TextureInfo): Promise<{ url: string; revoke(): void }>;
    readSheet(info: TextureInfo): Promise<LoadedSheet>;
    writeSheet(info: TextureInfo, rects: RectData[], width: number, height: number): Promise<WriteResult>;
    /** Modal question, resolves to the index of the clicked button. */
    ask(message: string, detail: string, buttons: string[], defaultId: number, cancelId: number): Promise<number>;
    /** Currently selected asset uuid in the Assets panel, if any. */
    selectedAsset(): string | null;
    /** Select (ping) an asset in the Assets panel. */
    reveal(uuidOrUrl: string): Promise<void>;
}
