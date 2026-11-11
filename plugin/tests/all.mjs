// `node --test plugin/tests/` 时 Node 把目录当成模块解析到这里（见 package.json 的 main），再加载每个测试文件。
// 也可以直接跑：node --test plugin/tests/*.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of fs.readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()) await import(pathToFileURL(path.join(here, f)).href);
