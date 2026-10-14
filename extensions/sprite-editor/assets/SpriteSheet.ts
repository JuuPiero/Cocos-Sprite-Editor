import { AssetManager, SpriteAtlas, SpriteFrame, resources } from 'cc';

/**
 * Helpers for sprite sheets sliced with the Sprite Editor extension.
 *
 * Each sliced sheet is a native SpriteAtlas (`<image>.plist`), so the usual API
 * works too: `atlas.getSpriteFrame('hero_0')`.
 */
export class SpriteSheet {
    /**
     * Natural order comparison: "hero_2" < "hero_10".
     * (Implemented by hand: Intl.Collator is not available on every native JS engine.)
     */
    static compareNames(a: string, b: string): number {
        const ca = a.match(/\d+|\D+/g) || [];
        const cb = b.match(/\d+|\D+/g) || [];
        const n = Math.min(ca.length, cb.length);
        for (let i = 0; i < n; i++) {
            const x = ca[i];
            const y = cb[i];
            if (x === y) continue;
            const dx = x.charCodeAt(0) >= 48 && x.charCodeAt(0) <= 57;
            const dy = y.charCodeAt(0) >= 48 && y.charCodeAt(0) <= 57;
            if (dx && dy) {
                const d = Number(x) - Number(y);
                if (d !== 0) return d;
                if (x.length !== y.length) return x.length - y.length;
                continue;
            }
            return x < y ? -1 : 1;
        }
        return ca.length - cb.length;
    }

    /** Every frame of the atlas, sorted by name in natural order. */
    static frames(atlas: SpriteAtlas): SpriteFrame[] {
        return atlas.getSpriteFrames()
            .filter((f): f is SpriteFrame => !!f)
            .sort((a, b) => SpriteSheet.compareNames(a.name, b.name));
    }

    /**
     * Frames named `<prefix><number>`, optionally with "_", "-", "." or a space
     * before the number, in natural order.
     * Example: getFrames(atlas, 'hero_run') -> hero_run_0, hero_run_1, ... hero_run_10
     */
    static getFrames(atlas: SpriteAtlas, prefix: string): SpriteFrame[] {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^${escaped}[_\\-. ]?\\d+$`);
        return SpriteSheet.frames(atlas).filter((f) => re.test(f.name));
    }

    /** One frame by name, or null. */
    static getFrame(atlas: SpriteAtlas, name: string): SpriteFrame | null {
        return atlas.getSpriteFrame(name);
    }

    /**
     * Load a sheet at runtime. `path` is the .plist path inside the bundle
     * without extension, e.g. "sheets/hero" for resources/sheets/hero.plist.
     */
    static load(path: string, bundle: AssetManager.Bundle = resources): Promise<SpriteAtlas> {
        return new Promise((resolve, reject) => {
            bundle.load(path, SpriteAtlas, (err, atlas) => (err ? reject(err) : resolve(atlas)));
        });
    }

    /** Load a sheet and return one frame of it. */
    static async loadFrame(path: string, name: string, bundle: AssetManager.Bundle = resources): Promise<SpriteFrame | null> {
        const atlas = await SpriteSheet.load(path, bundle);
        return atlas.getSpriteFrame(name);
    }
}
