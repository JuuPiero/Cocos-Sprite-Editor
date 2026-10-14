/**
 * Minimal XML property-list reader/writer for TexturePacker-style atlases, which
 * Cocos Creator imports natively as a SpriteAtlas with one SpriteFrame per frame.
 */
import { PlistFrame, PlistSheet } from './types';

export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

export const GENERATOR = 'cocos-sprite-editor';

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
        if (e[0] === '#') {
            const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : m;
        }
        return ENTITY[e] ?? m;
    });
}

export function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface Token {
    close: boolean;
    selfClose: boolean;
    tag: string;
    text?: string;
}

function tokenize(xml: string): Token[] {
    const src = xml
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '');
    const re = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>|([^<]+)/g;
    const out: Token[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        if (m[4] !== undefined) {
            out.push({ close: false, selfClose: false, tag: '#text', text: m[4] });
        } else {
            out.push({ close: m[1] === '/', selfClose: m[3] === '/', tag: m[2] });
        }
    }
    return out;
}

export function parsePlist(xml: string): PlistValue {
    const tokens = tokenize(xml);
    let i = 0;

    const skipSpace = () => {
        while (i < tokens.length && tokens[i].tag === '#text' && !tokens[i].text!.trim()) i++;
    };
    const readText = (tag: string): string => {
        let s = '';
        while (i < tokens.length && !(tokens[i].close && tokens[i].tag === tag)) {
            if (tokens[i].tag === '#text') s += tokens[i].text;
            i++;
        }
        i++; // closing tag
        return unescapeXml(s);
    };
    const parseValue = (): PlistValue => {
        skipSpace();
        const t = tokens[i++];
        if (!t || t.close) throw new Error('Plist: unexpected end of value');
        switch (t.tag) {
            case 'dict': {
                const obj: { [key: string]: PlistValue } = {};
                if (t.selfClose) return obj;
                for (;;) {
                    skipSpace();
                    const k = tokens[i];
                    if (!k) throw new Error('Plist: unterminated <dict>');
                    if (k.close && k.tag === 'dict') {
                        i++;
                        return obj;
                    }
                    if (k.tag !== 'key') throw new Error(`Plist: expected <key>, got <${k.tag}>`);
                    i++;
                    const key = k.selfClose ? '' : readText('key');
                    obj[key] = parseValue();
                }
            }
            case 'array': {
                const arr: PlistValue[] = [];
                if (t.selfClose) return arr;
                for (;;) {
                    skipSpace();
                    const k = tokens[i];
                    if (!k) throw new Error('Plist: unterminated <array>');
                    if (k.close && k.tag === 'array') {
                        i++;
                        return arr;
                    }
                    arr.push(parseValue());
                }
            }
            case 'string':
            case 'date':
            case 'data':
                return t.selfClose ? '' : readText(t.tag);
            case 'integer':
                return t.selfClose ? 0 : parseInt(readText('integer').trim(), 10);
            case 'real':
                return t.selfClose ? 0 : parseFloat(readText('real').trim());
            case 'true':
                if (!t.selfClose) readText('true');
                return true;
            case 'false':
                if (!t.selfClose) readText('false');
                return false;
            case 'plist': {
                const v = parseValue();
                skipSpace();
                return v;
            }
            default:
                throw new Error(`Plist: unsupported tag <${t.tag}>`);
        }
    };
    return parseValue();
}

function nums(v: PlistValue | undefined): number[] {
    if (typeof v !== 'string') return [];
    return (v.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}

/** Frame key -> sub-asset name, the same way Cocos strips the extension ("a.png" -> "a"). */
export function frameKeyToName(key: string): string {
    const dot = key.lastIndexOf('.');
    const slash = Math.max(key.lastIndexOf('/'), key.lastIndexOf('\\'));
    return dot > slash + 1 ? key.slice(0, dot) : key;
}

export function readSheet(value: PlistValue): PlistSheet {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Plist: root is not a dict');
    const root = value as { [k: string]: PlistValue };
    const meta = (root.metadata || {}) as { [k: string]: PlistValue };
    const framesDict = (root.frames || {}) as { [k: string]: PlistValue };
    const format = typeof meta.format === 'number' ? meta.format : 2;
    const size = nums(meta.size);
    const frames: PlistFrame[] = [];

    for (const key of Object.keys(framesDict)) {
        const f = framesDict[key] as { [k: string]: PlistValue };
        let rect: number[];
        let offset: number[];
        let source: number[];
        let rotated = false;
        if (format === 0) {
            rect = [f.x, f.y, f.width, f.height].map(Number);
            offset = [Number(f.offsetX) || 0, Number(f.offsetY) || 0];
            source = [Number(f.originalWidth) || rect[2], Number(f.originalHeight) || rect[3]];
        } else if (format === 3) {
            rect = nums(f.textureRect);
            offset = nums(f.spriteOffset);
            source = nums(f.spriteSourceSize);
            rotated = !!f.textureRotated;
        } else {
            rect = nums(f.frame);
            offset = nums(f.offset);
            source = nums(f.sourceSize);
            rotated = !!f.rotated;
        }
        if (rect.length < 4) continue;
        const [x, y, w, h] = rect;
        const trimmed = (offset.length >= 2 && (offset[0] !== 0 || offset[1] !== 0))
            || (source.length >= 2 && (source[0] !== w || source[1] !== h));
        frames.push({ name: frameKeyToName(key), x, y, w, h, rotated, trimmed });
    }

    return {
        textureFileName: String(meta.realTextureFileName || meta.textureFileName || ''),
        width: size[0] || 0,
        height: size[1] || 0,
        format,
        ownFile: meta.generator === GENERATOR,
        frames,
    };
}

export interface BuildFrame {
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Writes format 2 (the TexturePacker "cocos2d" layout Cocos Creator reads). */
export function buildPlist(textureFileName: string, width: number, height: number, frames: BuildFrame[]): string {
    const L: string[] = [];
    const tex = escapeXml(textureFileName);
    L.push('<?xml version="1.0" encoding="UTF-8"?>');
    L.push('<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
    L.push('<plist version="1.0">');
    L.push('    <dict>');
    L.push('        <key>frames</key>');
    L.push('        <dict>');
    for (const f of frames) {
        const x = Math.round(f.x);
        const y = Math.round(f.y);
        const w = Math.round(f.w);
        const h = Math.round(f.h);
        // Always append .png: Cocos strips the last extension to get the sub-asset
        // name, so "hero.idle" must be written as "hero.idle.png".
        L.push(`            <key>${escapeXml(f.name)}.png</key>`);
        L.push('            <dict>');
        L.push('                <key>frame</key>');
        L.push(`                <string>{{${x},${y}},{${w},${h}}}</string>`);
        L.push('                <key>offset</key>');
        L.push('                <string>{0,0}</string>');
        L.push('                <key>rotated</key>');
        L.push('                <false/>');
        L.push('                <key>sourceColorRect</key>');
        L.push(`                <string>{{0,0},{${w},${h}}}</string>`);
        L.push('                <key>sourceSize</key>');
        L.push(`                <string>{${w},${h}}</string>`);
        L.push('            </dict>');
    }
    L.push('        </dict>');
    L.push('        <key>metadata</key>');
    L.push('        <dict>');
    L.push('            <key>format</key>');
    L.push('            <integer>2</integer>');
    L.push('            <key>generator</key>');
    L.push(`            <string>${GENERATOR}</string>`);
    L.push('            <key>realTextureFileName</key>');
    L.push(`            <string>${tex}</string>`);
    L.push('            <key>size</key>');
    L.push(`            <string>{${width},${height}}</string>`);
    L.push('            <key>textureFileName</key>');
    L.push(`            <string>${tex}</string>`);
    L.push('        </dict>');
    L.push('    </dict>');
    L.push('</plist>');
    L.push('');
    return L.join('\n');
}

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

/** Returns an error message, or null when the name is a valid frame name. */
export function validateFrameName(name: string): string | null {
    if (!name.trim()) return 'Tên không được để trống.';
    if (name !== name.trim()) return 'Tên không được có khoảng trắng ở đầu/cuối.';
    if (BAD_NAME.test(name)) return 'Tên không được chứa \\ / : * ? " < > |';
    return null;
}
