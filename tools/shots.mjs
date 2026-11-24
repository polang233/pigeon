// 给 README 截演示页的图：用无界面的 Microsoft Edge 打开演示（python3 tools/serve.py），按步骤点几下，存成 PNG。
// 用法（在仓库根目录）：node tools/shots.mjs [演示地址，默认 http://localhost:5189/] [输出目录，默认 docs/images/demo] [只截哪几张，逗号分隔]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const url = process.argv[2] || 'http://localhost:5189/', out = process.argv[3] || 'docs/images/demo';
mkdirSync(out, { recursive: true });
const PORT = 9333, W = 1280, H = 820;
const prof = join(process.env.TMPDIR || '/tmp', 'pigeon-shots-profile');
const edge = spawn('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run',
  '--hide-scrollbars', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0; const wait = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const cdp = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error(expr + ': ' + JSON.stringify(r.result.exceptionDetails.exception?.description)); return r.result?.result?.value; };
const click = sel => js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('没找到 ' + ${JSON.stringify(sel)}); e.click(); })()`);

await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
const fresh = async () => { await cdp('Page.navigate', { url }); await sleep(800); await js('localStorage.clear(); sessionStorage.clear()'); await cdp('Page.navigate', { url }); await sleep(2500); };
const shot = async (name, clip) => {
  const r = await cdp('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
  const f = join(out, name + '.png'); writeFileSync(f, Buffer.from(r.result.data, 'base64'));
  if (!clip) execFileSync('sips', ['-Z', '1600', f], { stdio: 'ignore' }); // 整页截图缩到 1600 宽，省点体积
  console.log('存了', name);
};

const steps = [
  ['stage-lead', async () => {}],
  ['stage-expanded', async () => { await click('[data-action=open-dev][data-dev=win]'); await sleep(1800); }],
  ['stage-remote', async () => { await click('[data-action=go-dev][data-dev=win]'); await sleep(2200); }],
  ['channels', async () => { await click('[data-action=nav][data-v=tasks]'); await sleep(1500); }],
  ['route', async () => { await click('[data-action=nav][data-v=route]'); await sleep(1500); }],
  ['conn', async () => { await click('[data-action=nav][data-v=conn]'); await sleep(1500); }],
  ['notch-confirm', async () => { await click('#ear-r .need'); await sleep(1200); }, { x: 340, y: 0, width: 600, height: 470 }],
  ['notch-compose', async () => { await click('#settings'); await sleep(400); await click('[data-action=hud-demo][data-state=compose]'); await sleep(300); await click('#settings'); await sleep(1200); }, { x: 340, y: 0, width: 600, height: 470 }],
];
const only = process.argv[4]?.split(',');
for (const [name, run, clip] of steps) {
  if (only && !only.includes(name)) continue;
  await fresh();
  try { await run(); await shot(name, clip); } catch (e) { console.log('失败', name, e.message); }
}
ws.close(); edge.kill();
