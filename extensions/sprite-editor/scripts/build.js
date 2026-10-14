/**
 * Bundles the extension into dist/ with esbuild. Vue is bundled in, so the
 * extension runs without node_modules (commit dist/ and it works after a clone).
 *
 *   node scripts/build.js           one build
 *   node scripts/build.js --watch   rebuild on change
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const options = {
    absWorkingDir: root,
    entryPoints: {
        'main': 'source/main.ts',
        'assets-menu': 'source/assets-menu.ts',
        'panels/default/index': 'source/panels/default/index.ts',
    },
    outdir: dist,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node14',
    sourcemap: 'inline',
    // Vue's CommonJS build includes the template compiler (templates are
    // compiled at runtime from static/template).
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
};

fs.rmSync(dist, { recursive: true, force: true });

if (watch) {
    esbuild.context(options).then((ctx) => ctx.watch());
} else {
    esbuild.buildSync(options);
}
