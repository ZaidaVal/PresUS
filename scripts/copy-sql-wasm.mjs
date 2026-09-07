import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm');
const toDir = resolve(root, 'public/assets');
mkdirSync(toDir, { recursive: true });
copyFileSync(from, resolve(toDir, 'sql-wasm.wasm'));
console.log('Copied sql-wasm.wasm to public/assets');
