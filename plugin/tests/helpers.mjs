// 测试环境：临时的 ~/.pigeon、假的 CODEX_HOME（带一个假的 state_5.sqlite）、假的 codex 命令、
// 一个记录 POST /ev 的本地 HTTP 服务。全程不碰真实的 Codex 和用户数据。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIX = path.join(HERE, 'fixtures');
export const SCRIPTS = path.join(HERE, '..', 'scripts');
export const PIGEON = path.join(SCRIPTS, 'pigeon.mjs');
export const fixture = name => fs.readFileSync(path.join(FIX, name), 'utf8');

export const T = {
  relay: '0199bbbb-2222-7000-8000-000000000002',
  local: '0199cccc-3333-7000-8000-000000000003',
  never: '0199cccc-9999-7000-8000-000000000009',
  archived: '0199cccc-8888-7000-8000-000000000008',
  remote: '0199aaaa-1111-7000-8000-000000000001',
  host: 'remote-control:env_e_0000test0000aaaa',
};

const q = s => "'" + String(s).replace(/'/g, "''") + "'";

export function makeEnv({ mode = 'reply', settings = {}, threads, confirm = 'ok' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-test-'));
  const codexHome = path.join(root, 'codex');
  const day = path.join(codexHome, 'sessions', '2026', '11', '11');
  fs.mkdirSync(day, { recursive: true });
  const rows = threads || [
    { id: T.relay, title: '中转用', source: 'vscode', approval: 'on-request' },
    { id: T.local, title: '跑测试', source: 'vscode', approval: 'on-request' },
    { id: T.never, title: '一次性任务', source: 'exec', approval: 'never' },
    { id: T.archived, title: '旧对话', source: 'vscode', approval: 'on-request', archived: 1 },
  ];
  const sql = [
    `CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, source TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, approval_mode TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER, name TEXT, project_id TEXT);`,
    `CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, metadata TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL, created_at_ms INTEGER NOT NULL DEFAULT 0, updated_at_ms INTEGER NOT NULL DEFAULT 0);`,
    `CREATE TABLE project_roots (project_id TEXT NOT NULL, position INTEGER NOT NULL, path TEXT NOT NULL, PRIMARY KEY (project_id, position));`,
    `INSERT INTO projects VALUES ('p-local-1', '测试项目', '{}', 0, 0, 0);`,
    `INSERT INTO project_roots VALUES ('p-local-1', 0, ${q(root)});`,
  ];
  rows.forEach((r, i) => {
    const file = path.join(day, `rollout-2026-11-11T00-00-0${i}-${r.id}.jsonl`);
    fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: r.id } }) + '\n');
    sql.push(`INSERT INTO threads (id, rollout_path, updated_at, updated_at_ms, source, cwd, title, approval_mode, archived) VALUES (${q(r.id)}, ${q(file)}, ${1794370000 - i}, ${(1794370000 - i) * 1000}, ${q(r.source)}, ${q(root)}, ${q(r.title)}, ${q(r.approval)}, ${r.archived || 0});`);
  });
  execFileSync('sqlite3', [path.join(codexHome, 'state_5.sqlite'), sql.join('\n')]);
  const settingsFile = path.join(root, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ version: 1, keepMe: { x: 1 }, ...settings }));
  const log = path.join(root, 'codex-calls.jsonl');
  const confirmLog = path.join(root, 'confirm-calls.jsonl');
  const env = {
    ...process.env,
    PIGEON_HOME: path.join(root, 'pigeon'),
    CODEX_HOME: codexHome,
    PIGEON_CODEX_BIN: path.join(FIX, 'fake-codex.mjs'),
    PIGEON_NO_WAKE: '1',
    // 不碰真的 DeepSeek Harness 和 Antigravity
    DSH_HOME: path.join(root, 'dsh-home'),
    PIGEON_AGY_HOME: path.join(root, 'agy-home'),
    PIGEON_AGY_CLI_HOME: path.join(root, 'agy-cli-home'),
    PIGEON_AGY_BIN: '',
    PIGEON_CONFIRM_BIN: path.join(FIX, 'fake-confirm.mjs'),
    FAKE_CONFIRM: confirm,
    FAKE_CONFIRM_LOG: confirmLog,
    PIGEON_SETTINGS_FILE: settingsFile,
    PIGEON_APP_RUNNING: '1',
    PIGEON_POLL_MS: '100',
    FAKE_CODEX_MODE: mode,
    FAKE_CODEX_LOG: log,
    CLAUDE_CODE_SESSION_ID: 'claude-session-test',
  };
  return { root, codexHome, day, env, settingsFile, log, pigeonHome: env.PIGEON_HOME,
    rollout: id => fs.readdirSync(day).map(f => path.join(day, f)).find(f => f.endsWith(`-${id}.jsonl`)),
    journal: () => JSON.parse(fs.readFileSync(path.join(env.PIGEON_HOME, 'journal.json'), 'utf8')),
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []),
    confirms: () => (fs.existsSync(confirmLog) ? fs.readFileSync(confirmLog, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

// 记录事件的假应用。settings 为 null 时 /api/settings 回 404（当作应用没开设置接口）
// ask：POST /api/ask 怎么回——'release' | 'release_masked' | 'block' | 'timeout'，'drop' 是直接掐断连接，'garbage' 是回看不懂的东西，
//      不给就回 404（老的假应用没有这个接口）；也可以是 (body) => 动作。delayMs 是回之前挂多久。
// suggest：POST /api/dispatch/suggest 的回复（对象），不给就回 404
export function fakeApp({ settings = null, ask = null, askDelayMs = 0, suggest = null } = {}) {
  const events = [], asks = [], suggests = [];
  let current = settings;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST' && req.url === '/ev') { try { events.push(JSON.parse(body)); } catch {} res.writeHead(204); return res.end(); }
      if (req.method === 'POST' && req.url === '/api/ask' && ask) {
        const b = JSON.parse(body);
        // 记下收到这个请求时，事件里已经有哪些状态（用来确认“等你确认”先发出去了）
        asks.push({ ...b, seen: events.filter(x => x.band === b.band).map(x => x.state) });
        if (askDelayMs) await new Promise(r => setTimeout(r, askDelayMs));
        const a = typeof ask === 'function' ? ask(b) : ask;
        if (a === 'drop') return req.socket.destroy();
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(a === 'garbage' ? { nope: 1 } : { action: a }));
      }
      if (req.method === 'POST' && req.url === '/api/dispatch/suggest' && suggest) {
        suggests.push(JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(suggest));
      }
      if (req.url === '/api/settings' && current) {
        if (req.method === 'PUT') current = JSON.parse(body);
        if (req.method === 'PATCH') {
          const merge = (base, patch) => {
            for (const [k, v] of Object.entries(patch || {})) {
              if (v === null) delete base[k];
              else if (v && typeof v === 'object' && !Array.isArray(v)) {
                if (!base[k] || typeof base[k] !== 'object' || Array.isArray(base[k])) base[k] = {};
                merge(base[k], v);
              } else base[k] = v;
            }
          };
          merge(current, JSON.parse(body));
        }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(current));
      }
      res.writeHead(404); res.end();
    });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({
    port: server.address().port, events, asks, suggests, settings: () => current,
    close: () => new Promise(x => server.close(x)),
  })));
}

// 一个肯定没人监听的端口（开一个服务拿到端口再关掉）
export async function deadPort() {
  const s = http.createServer();
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  await new Promise(r => s.close(r));
  return p;
}

export function pigeon(args, env, script = PIGEON) {
  return new Promise(resolve => {
    execFile(process.execPath, [script, ...args], { env, timeout: 60000, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

// 带标准输入的版本（--stdin 用）
export function pigeonIn(args, env, input) {
  return new Promise(resolve => {
    const child = execFile(process.execPath, [PIGEON, ...args], { env, timeout: 60000, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function until(fn, ms = 10000, step = 50) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('等待超时');
    await new Promise(r => setTimeout(r, step));
  }
}
