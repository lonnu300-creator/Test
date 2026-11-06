import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const webDir = path.join(root, 'www');
for (const font of ['vazirmatn-variable.ttf', 'lalezar-regular.ttf', 'abar-regular.ttf', 'anjoman-black.ttf']) {
  if (!fs.existsSync(path.join(webDir, 'fonts', font))) {
    throw new Error(`Required font missing: www/fonts/${font}`);
  }
}
fs.rmSync(path.join(webDir, 'chunks'), { recursive: true, force: true });
fs.rmSync(path.join(webDir, 'app.bundle.js'), { force: true });
await build({
  entryPoints: [path.join(webDir, 'app.js')],
  outdir: webDir,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2020',
  entryNames: 'app.bundle',
  chunkNames: 'chunks/[name]-[hash]',
  minify: true,
  logLevel: 'info'
});
