/* Unit tests for the pure core modules: npm test (or node tests/run.js) */
const assert = require('assert');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

// Compile the TypeScript sources under test into tests/.out.
const outDir = path.join(__dirname, '.out');
for (const name of ['slicer', 'plist']) {
    esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'source', 'core', `${name}.ts`)],
        outfile: path.join(outDir, `${name}.js`),
        bundle: true,
        platform: 'node',
        format: 'cjs',
        logLevel: 'warning',
    });
}
const slicer = require('./.out/slicer');
const plist = require('./.out/plist');

let passed = 0;
function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('  ok  ' + name);
    } catch (e) {
        console.error('  FAIL ' + name + '\n' + (e && e.stack ? e.stack : e));
        process.exitCode = 1;
    }
}

function image(w, h, rgba = [0, 0, 0, 0]) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
    return { width: w, height: h, data };
}
function fill(img, x0, y0, x1, y1, rgba) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgba, (y * img.width + x) * 4);
}
const AUTO = { mode: 'auto', alphaThreshold: 1, colorTolerance: 28, keyColor: null, minSize: 2, mergeDistance: 0, separate: 0, extrude: 0 };

console.log('slicer');

test('detects separate islands on a transparent sheet', () => {
    const img = image(220, 80);
    fill(img, 10, 10, 50, 40, [255, 80, 80, 255]);
    fill(img, 80, 12, 130, 36, [80, 200, 120, 255]);
    fill(img, 160, 20, 205, 70, [80, 140, 255, 255]);
    const boxes = slicer.detectSprites(img, AUTO);
    assert.deepStrictEqual(boxes, [
        { x: 10, y: 10, w: 40, h: 30 },
        { x: 80, y: 12, w: 50, h: 24 },
        { x: 160, y: 20, w: 45, h: 50 },
    ]);
});

test('separate breaks a thin bridge between two sprites', () => {
    const img = image(80, 40);
    fill(img, 5, 5, 25, 30, [255, 0, 0, 255]);
    fill(img, 50, 5, 70, 30, [0, 255, 0, 255]);
    fill(img, 25, 16, 51, 18, [255, 255, 0, 255]);
    assert.strictEqual(slicer.detectSprites(img, AUTO).length, 1);
    const two = slicer.detectSprites(img, { ...AUTO, separate: 2 });
    assert.strictEqual(two.length, 2);
    // Islands are re-fitted to the real pixels: the bridge is not included.
    assert.deepStrictEqual(two[0], { x: 5, y: 5, w: 20, h: 25 });
    assert.deepStrictEqual(two[1], { x: 50, y: 5, w: 20, h: 25 });
});

test('diagonal pixels are 8-connected', () => {
    const img = image(10, 10);
    fill(img, 2, 2, 3, 3, [0, 0, 0, 255]);
    fill(img, 3, 3, 4, 4, [0, 0, 0, 255]);
    const boxes = slicer.detectSprites(img, { ...AUTO, minSize: 1 });
    assert.deepStrictEqual(boxes, [{ x: 2, y: 2, w: 2, h: 2 }]);
});

test('opaque sheet uses the corner colour as background', () => {
    const img = image(160, 60, [255, 255, 255, 255]);
    fill(img, 8, 8, 40, 40, [20, 20, 20, 255]);
    fill(img, 90, 10, 140, 50, [180, 40, 40, 255]);
    fill(img, 100, 20, 110, 30, [255, 255, 255, 255]); // enclosed hole stays inside the sprite
    const boxes = slicer.detectSprites(img, AUTO);
    assert.deepStrictEqual(boxes, [{ x: 8, y: 8, w: 32, h: 32 }, { x: 90, y: 10, w: 50, h: 40 }]);
});

test('minSize, mergeDistance and extrude', () => {
    const img = image(100, 50);
    fill(img, 10, 10, 20, 20, [1, 1, 1, 255]);
    fill(img, 23, 10, 30, 20, [1, 1, 1, 255]);
    fill(img, 60, 40, 61, 41, [1, 1, 1, 255]); // 1px noise
    assert.strictEqual(slicer.detectSprites(img, AUTO).length, 2);
    const merged = slicer.detectSprites(img, { ...AUTO, mergeDistance: 4 });
    assert.deepStrictEqual(merged, [{ x: 10, y: 10, w: 20, h: 10 }]);
    const grown = slicer.detectSprites(img, { ...AUTO, mergeDistance: 4, extrude: 15 });
    assert.deepStrictEqual(grown, [{ x: 0, y: 0, w: 45, h: 35 }]);
});

test('alpha threshold ignores faint pixels', () => {
    const img = image(40, 20);
    fill(img, 2, 2, 10, 10, [0, 0, 0, 255]);
    fill(img, 20, 2, 30, 10, [0, 0, 0, 20]);
    assert.strictEqual(slicer.detectSprites(img, AUTO).length, 2);
    assert.strictEqual(slicer.detectSprites(img, { ...AUTO, alphaThreshold: 50 }).length, 1);
});

test('reading order groups rows even with uneven tops', () => {
    const boxes = [
        { x: 50, y: 2, w: 10, h: 20 },
        { x: 0, y: 6, w: 10, h: 12 },
        { x: 25, y: 0, w: 10, h: 25 },
        { x: 5, y: 40, w: 10, h: 10 },
        { x: 0, y: 44, w: 3, h: 3 },
    ];
    const out = slicer.sortReadingOrder(boxes).map((b) => b.x + ',' + b.y);
    assert.deepStrictEqual(out, ['0,6', '25,0', '50,2', '0,44', '5,40']);
});

test('grid by cell size with offset and padding', () => {
    const g = { cellW: 16, cellH: 16, cols: 0, rows: 0, offsetX: 2, offsetY: 2, padX: 2, padY: 2 };
    const boxes = slicer.gridBoxes(56, 38, g, false);
    assert.deepStrictEqual(boxes.map((b) => [b.x, b.y]), [[2, 2], [20, 2], [38, 2], [2, 20], [20, 20], [38, 20]]);
    assert.ok(boxes.every((b) => b.w === 16 && b.h === 16));
});

test('grid by cell count', () => {
    const g = { cellW: 0, cellH: 0, cols: 4, rows: 2, offsetX: 0, offsetY: 0, padX: 0, padY: 0 };
    const boxes = slicer.gridBoxes(128, 64, g, true);
    assert.strictEqual(boxes.length, 8);
    assert.deepStrictEqual(boxes[7], { x: 96, y: 32, w: 32, h: 32 });
    assert.deepStrictEqual(slicer.cellSizeForCount(128, 64, g), { w: 32, h: 32 });
    assert.deepStrictEqual(slicer.gridBoxes(10, 10, { ...g, cols: 20 }, true), []);
});

test('trim and empty checks', () => {
    const img = image(32, 32);
    fill(img, 5, 7, 9, 12, [9, 9, 9, 255]);
    const mask = slicer.buildMask(img, AUTO);
    assert.deepStrictEqual(slicer.trimBox(mask, 32, 32, { x: 0, y: 0, w: 16, h: 16 }), { x: 5, y: 7, w: 4, h: 5 });
    assert.strictEqual(slicer.trimBox(mask, 32, 32, { x: 16, y: 16, w: 16, h: 16 }), null);
    assert.strictEqual(slicer.isBoxEmpty(mask, 32, 32, { x: 16, y: 0, w: 16, h: 16 }), true);
    assert.strictEqual(slicer.isBoxEmpty(mask, 32, 32, { x: 0, y: 0, w: 6, h: 8 }), false);
});

test('erode shrinks by r and treats the outside as empty', () => {
    const w = 7;
    const h = 7;
    const mask = new Uint8Array(w * h).fill(1);
    const e = slicer.erode(mask, w, h, 1);
    let count = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (e[y * w + x]) count++;
    assert.strictEqual(count, 25);
    assert.strictEqual(e[0], 0);
    assert.strictEqual(e[1 * w + 1], 1);
});

test('iou / intersectArea', () => {
    assert.strictEqual(slicer.intersectArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 25);
    assert.strictEqual(slicer.intersectArea({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 0);
    assert.ok(Math.abs(slicer.iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 5 }) - 0.5) < 1e-9);
});

test('performance: 2048×2048 sheet with 1024 sprites', () => {
    const img = image(2048, 2048);
    for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) fill(img, c * 64 + 8, r * 64 + 8, c * 64 + 56, r * 64 + 56, [200, 100, 50, 255]);
    const t = Date.now();
    const boxes = slicer.detectSprites(img, AUTO);
    const ms = Date.now() - t;
    assert.strictEqual(boxes.length, 1024);
    assert.deepStrictEqual(boxes[33], { x: 72, y: 72, w: 48, h: 48 });
    console.log(`       (${ms} ms)`);
    assert.ok(ms < 3000, `too slow: ${ms}ms`);
});

console.log('plist');

test('round trip keeps names and rects', () => {
    const frames = [
        { name: 'hero_0', x: 0, y: 0, w: 32, h: 48 },
        { name: 'hero.idle', x: 32, y: 0, w: 30, h: 40 },
        { name: 'Tom & Jerry <1>', x: 0, y: 48, w: 5, h: 6 },
        { name: 'Nút bấm 关闭', x: 10, y: 60, w: 7, h: 8 },
    ];
    const xml = plist.buildPlist('hero sheet.png', 128, 128, frames);
    const sheet = plist.readSheet(plist.parsePlist(xml));
    assert.strictEqual(sheet.format, 2);
    assert.strictEqual(sheet.ownFile, true);
    assert.strictEqual(sheet.textureFileName, 'hero sheet.png');
    assert.strictEqual(sheet.width, 128);
    assert.deepStrictEqual(sheet.frames.map((f) => [f.name, f.x, f.y, f.w, f.h, f.rotated, f.trimmed]),
        frames.map((f) => [f.name, f.x, f.y, f.w, f.h, false, false]));
    assert.ok(xml.includes('<key>hero.idle.png</key>'));
    assert.ok(xml.includes('Tom &amp; Jerry &lt;1&gt;.png'));
});

test('empty sheet', () => {
    const sheet = plist.readSheet(plist.parsePlist(plist.buildPlist('a.png', 4, 4, [])));
    assert.deepStrictEqual(sheet.frames, []);
});

test('parses a real TexturePacker plist (format 2, rotated frames)', () => {
    const file = 'E:/Workspace/cocos/Mahjong-Sort/assets/trail2d/Res/UI.plist';
    if (!fs.existsSync(file)) {
        console.log('       (skipped: sample not found)');
        return;
    }
    const xml = fs.readFileSync(file, 'utf8');
    const sheet = plist.readSheet(plist.parsePlist(xml));
    // Count the <dict> entries inside <key>frames</key> without the parser.
    const framesXml = xml.slice(xml.indexOf('<key>frames</key>'), xml.indexOf('<key>metadata</key>'));
    const keyCount = (framesXml.match(/<key>frame<\/key>/g) || []).length;
    assert.strictEqual(sheet.frames.length, keyCount);
    assert.strictEqual(sheet.ownFile, false);
    assert.strictEqual(sheet.textureFileName, 'UI.png');
    const f = sheet.frames.find((x) => x.name === 'ica72');
    assert.ok(f && f.rotated === true, 'ica72 should be rotated');
    assert.ok(sheet.frames.some((x) => !x.rotated));
});

test('parses format 3 and format 0 dictionaries', () => {
    const f3 = `<?xml version="1.0"?><plist version="1.0"><dict>
        <key>frames</key><dict>
            <key>a.png</key><dict>
                <key>aliases</key><array/>
                <key>spriteOffset</key><string>{1,-1}</string>
                <key>spriteSize</key><string>{10,12}</string>
                <key>spriteSourceSize</key><string>{12,14}</string>
                <key>textureRect</key><string>{{3,4},{10,12}}</string>
                <key>textureRotated</key><true/>
            </dict>
        </dict>
        <key>metadata</key><dict><key>format</key><integer>3</integer><key>textureFileName</key><string>t.png</string><key>size</key><string>{64,64}</string></dict>
    </dict></plist>`;
    const s3 = plist.readSheet(plist.parsePlist(f3));
    assert.deepStrictEqual(s3.frames, [{ name: 'a', x: 3, y: 4, w: 10, h: 12, rotated: true, trimmed: true }]);
    const f0 = `<plist><dict><key>frames</key><dict><key>b</key><dict>
        <key>x</key><integer>1</integer><key>y</key><integer>2</integer><key>width</key><integer>3</integer><key>height</key><integer>4</integer>
        <key>offsetX</key><real>0</real><key>offsetY</key><real>0</real><key>originalWidth</key><integer>3</integer><key>originalHeight</key><integer>4</integer>
        </dict></dict><key>metadata</key><dict><key>format</key><integer>0</integer></dict></dict></plist>`;
    assert.deepStrictEqual(plist.readSheet(plist.parsePlist(f0)).frames, [{ name: 'b', x: 1, y: 2, w: 3, h: 4, rotated: false, trimmed: false }]);
});

test('frame key -> sub-asset name', () => {
    assert.strictEqual(plist.frameKeyToName('ica72.png'), 'ica72');
    assert.strictEqual(plist.frameKeyToName('hero.idle.png'), 'hero.idle');
    assert.strictEqual(plist.frameKeyToName('noext'), 'noext');
    assert.strictEqual(plist.frameKeyToName('.hidden'), '.hidden');
});

test('name validation', () => {
    assert.strictEqual(plist.validateFrameName('hero_0'), null);
    assert.strictEqual(plist.validateFrameName('Nút 1'), null);
    assert.ok(plist.validateFrameName(''));
    assert.ok(plist.validateFrameName(' a'));
    assert.ok(plist.validateFrameName('a/b'));
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
