#!/usr/bin/env node
// 测试用的假确认框：不弹任何窗口。FAKE_CONFIRM：ok（默认）发出 / deny 拦下 / timeout 没人点 / broken 弹不出来
// 每次调用都把收到的文字追加到 $FAKE_CONFIRM_LOG。
import fs from 'node:fs';
const [text, wait] = process.argv.slice(2);
if (process.env.FAKE_CONFIRM_LOG) fs.appendFileSync(process.env.FAKE_CONFIRM_LOG, JSON.stringify({ text, wait }) + '\n');
const mode = process.env.FAKE_CONFIRM || 'ok';
if (mode === 'deny') process.exit(1);
if (mode === 'broken') { console.error('no display'); process.exit(2); }
console.log(mode === 'timeout' ? 'timeout' : 'ok');
