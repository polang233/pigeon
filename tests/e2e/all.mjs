// `node --test tests/e2e` 时 Node 把目录当成模块解析到这里，再加载每个测试文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()) await import(pathToFileURL(path.join(here, f)).href);
