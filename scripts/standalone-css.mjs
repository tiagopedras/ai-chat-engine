/* dist/chat.standalone.css: Tenon's tokens, Tenon's component styles and the
   chat window's own, in that order, in one file. For a page that does not load
   Tenon itself and cannot be asked to: a host this package is dropped into
   without a say in what it loads. A page that already loads Tenon takes
   chat.css alone, so the tokens are not defined twice.

   Also drops the second copy of chat.css the component build leaves beside
   its script; the one that is exported is the bundle build's. */
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tenon = join(root, 'node_modules/@tiagopedras/tenon/dist');
const parts = [join(tenon, 'tenon.css'), join(tenon, 'tenon-react.css'), join(root, 'dist/chat.css')];
for (const p of parts) if (!existsSync(p)) throw new Error(`Missing ${p}. Run the other build steps first.`);
writeFileSync(join(root, 'dist/chat.standalone.css'), parts.map((p) => readFileSync(p, 'utf8')).join('\n'));
rmSync(join(root, 'dist/react/chat.css'), { force: true });
console.log('dist/chat.standalone.css written');
