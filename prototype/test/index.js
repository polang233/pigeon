// 让 `node --test prototype/test` 能跑：Node 22 起 --test 后面的参数按文件名匹配，给一个目录时会把目录当成一个文件来跑，
// 解析到的就是这个 index.js，它把同目录下的 *.test.mjs 都载进来。
// 不带参数跑 `node --test`、按默认规则自己找到这个文件时（argv 是这个文件本身）什么都不做，免得每个测试跑两遍。
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
if (!process.argv[1]?.endsWith('index.js')) {
  for (const f of readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()) await import(new URL(f, import.meta.url));
}
