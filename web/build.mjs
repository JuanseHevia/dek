// Build the Dek web layer: the deck runtime is bundled first and inlined as
// text into the shell bundle (it is injected into every deck document).
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const minify = !watch;
const here = path.dirname(new URL(import.meta.url).pathname);
process.chdir(here);

async function buildRuntime() {
  const r = await esbuild.build({
    entryPoints: ['src/runtime/dek-runtime.js'],
    bundle: true,
    minify,
    format: 'iife',
    target: ['safari16'],
    write: false,
    legalComments: 'none',
  });
  fs.mkdirSync('dist', { recursive: true });
  let js = r.outputFiles[0].text;
  if (/<\/script/i.test(js)) throw new Error('runtime must not contain a closing script tag');
  fs.writeFileSync('dist/runtime.txt', js);
  return js.length;
}

const app = {
  entryPoints: ['src/main.js'],
  bundle: true,
  minify,
  format: 'iife',
  target: ['safari16'],
  outfile: 'dist/app.js',
  loader: { '.txt': 'text', '.css': 'text', '.html': 'text', '.md': 'text' },
  legalComments: 'none',
  logLevel: 'info',
};

function buildPresenterPage() {
  const index = fs.readFileSync('index.html', 'utf8');
  const marker = '<script src="dist/app.js"></script>';
  if (!index.includes(marker)) throw new Error('index.html: app.js script tag not found');
  const page = index
    .replace('<title>Dek</title>', '<title>Dek Presenter</title>')
    .replace(marker, '<script>window.DEK_PRESENTER = true;</script>\n  ' + marker);
  fs.writeFileSync('presenter.html', '<!-- generated from index.html by build.mjs; do not edit -->\n' + page);
}
buildPresenterPage();

const n = await buildRuntime();
console.log(`· runtime ${(n / 1024).toFixed(1)} KB`);

if (watch) {
  const ctx = await esbuild.context(app);
  await ctx.watch();
  fs.watch('index.html', () => { try { buildPresenterPage(); } catch (e) { console.error(e.message); } });
  fs.watch('src/runtime', { recursive: true }, async () => {
    try { await buildRuntime(); await ctx.rebuild(); console.log('· runtime rebuilt'); } catch (e) { console.error(e.message); }
  });
  console.log('· watching');
} else {
  await esbuild.build(app);
}
