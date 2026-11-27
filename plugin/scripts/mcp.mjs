#!/usr/bin/env node
// Pigeon 统一 MCP 服务（零外部依赖，stdio JSON-RPC 2.0）。
// 让 Codex、Antigravity、Cursor、DeepSeek Harness 或任何支持 MCP 的 agent 都能读分派规则、查设备/对话、派活、等回信、读回信。
// 约定：stdout 只能写单行 JSON-RPC 响应，任何日志都写到 stderr，子命令一律捕获 stdout。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  pigeonDir, codexHome, loftsFile, isBand, parseArgs, loadSettings, readJson, normalizeAgentName, HOME,
} from './lib/common.mjs';
import { recent, STATE_ZH } from './lib/journal.mjs';
import { relayIds } from './lib/relays.mjs';
import { saveLofts, readLofts } from './lib/lofts.mjs';
import { agyModelsCached, agyCliBin } from './lib/agents.mjs';
import { ruleHits, hitLine } from './lib/hint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIGEON_SCRIPT = path.join(HERE, 'pigeon.mjs');
const PROTOCOL_VERSIONS = new Set(['2025-06-18', '2025-03-26', '2024-11-05']);

function inferClientFromName(name) {
  const s = String(name || '').toLowerCase();
  if (!s) return '';
  if (s.includes('codex')) return 'codex';
  if (s.includes('cursor')) return 'cursor';
  if (s.includes('antigravity') || s.includes('agy') || s.includes('gemini')) return 'antigravity';
  if (s.includes('deepseek') || s.includes('dsh')) return 'deepseek';
  if (s.includes('claude')) return 'claude';
  return normalizeAgentName(s);
}

function readDispatchFile() {
  const d = readJson(path.join(pigeonDir(), 'dispatch.json'), {});
  return d && typeof d === 'object' ? d : {};
}

function codexModelsCached() {
  const raw = readJson(path.join(codexHome(), 'models_cache.json'), null);
  const list = Array.isArray(raw?.models) ? raw.models : [];
  return list
    .filter(m => m && m.slug)
    .map(m => ({
      slug: String(m.slug),
      name: String(m.display_name || m.slug),
      efforts: (Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [])
        .map(x => (typeof x === 'string' ? x : x?.effort))
        .filter(Boolean),
    }));
}

function lastJsonLine(text) {
  const lines = String(text || '').trim().split('\n').map(s => s.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch {}
  }
  return null;
}

function runPigeonCli(args, { stdinText = null, client = '', cwd = '', timeoutMs = 60000 } = {}) {
  return new Promise(resolve => {
    const env = { ...process.env };
    if (client) {
      env.PIGEON_FROM_AGENT = client;
      if (client !== 'claude') delete env.CLAUDE_CODE_SESSION_ID;
    }
    if (cwd) env.PIGEON_FROM_CWD = cwd;
    const child = execFile(process.execPath, [PIGEON_SCRIPT, ...args], {
      env,
      cwd: cwd && fs.existsSync(cwd) ? cwd : process.cwd(),
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        timedOut: !!(err && err.killed),
      });
    });
    if (stdinText != null) child.stdin.end(String(stdinText));
    else child.stdin.end();
  });
}

function buildInstructions(client) {
  const dfile = readDispatchFile();
  const base = [
    `你已接入 Pigeon（信鸽，多 agent 协作工具${client ? `，当前身份：${client}` : ''}）。`,
    '常用工具：pigeon_lofts 查看可用设备/对话、pigeon_rules 查看协作分派规则、pigeon_send 给已有对话发消息、pigeon_new 新开对话、pigeon_wait / pigeon_read 等待并读取回信、pigeon_models 查看可用模型。',
    '规则：发送消息前请写清上下文、目标与期望带回的结果；跨设备消息会自动弹出本机 Pigeon 确认面板等用户放行。',
  ];
  if (typeof dfile.text === 'string' && dfile.text.trim()) {
    base.push('', dfile.text.trim());
  }
  if (Array.isArray(dfile.alive) && dfile.alive.length) {
    base.push('', `当前在线可派活对象：${dfile.alive.join(', ')}`);
  }
  return base.join('\n');
}

export const TOOLS = [
  {
    name: 'pigeon_rules',
    description: '读取 Pigeon 当前的协作分派规则、在线对象与触发建议；传入 prompt 时可检测命中的规则与派活方式。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '可选：用户当前消息文本，用于匹配分派规则关键词' },
      },
    },
  },
  {
    name: 'pigeon_lofts',
    description: '列出当前可达的设备（本机与已连接的远程电脑）、项目目录与最近对话。refresh=true 会经中继站重读远程（有 token 成本）。',
    inputSchema: {
      type: 'object',
      properties: {
        refresh: { type: 'boolean', description: '是否经中继站重读远程设备（默认 false）' },
        limit: { type: 'integer', description: '每台设备最多返回多少条对话（默认 15）' },
      },
    },
  },
  {
    name: 'pigeon_send',
    description: '给已有的本机或远程对话发一条消息（如 Codex、DeepSeek Harness、Antigravity；远程写成 <对话>@<设备>）。',
    inputSchema: {
      type: 'object',
      required: ['to', 'message'],
      properties: {
        to: { type: 'string', description: '收件对话 id 或标题；远程写成 <对话>@<设备名或id>' },
        message: { type: 'string', description: '要发送的完整消息正文（自成一体，包含必要背景）' },
        reason: { type: 'string', description: '一句话说明为什么交给这个对象' },
        wait: { type: 'boolean', description: '是否等到回信（或超时）后再返回（默认 false）' },
        timeout_min: { type: 'number', description: 'wait=true 时最多等几分钟' },
        reply_to: { type: 'string', description: '可选：沿用的纸条编号（b-…）' },
        cwd: { type: 'string', description: '可选：当前工作目录' },
      },
    },
  },
  {
    name: 'pigeon_new',
    description: '在本机或远程设备上新开一个对话并发送任务（支持 codex / dsh / antigravity）。',
    inputSchema: {
      type: 'object',
      required: ['title', 'message'],
      properties: {
        agent: { type: 'string', enum: ['codex', 'dsh', 'antigravity'], description: '目标 agent（默认 codex）' },
        loft: { type: 'string', description: '目标设备 id 或名字（默认 local）' },
        title: { type: 'string', description: '新对话标题' },
        message: { type: 'string', description: '任务正文' },
        cwd: { type: 'string', description: '本机新开对话的工作目录' },
        project: { type: 'string', description: '远程设备新开对话的项目 id / 名字 / 路径' },
        model: { type: 'string', description: '可选：模型 id 或 slug' },
        effort: { type: 'string', description: '可选：思考强度（low/medium/high/xhigh/max/ultra）' },
        sandbox: { type: 'string', enum: ['read-only', 'workspace-write'], description: '仅 DSH：权限模式' },
        reason: { type: 'string', description: '一句话说明为什么交给它' },
        wait: { type: 'boolean', description: '是否等到回信后再返回（默认 false）' },
        timeout_min: { type: 'number', description: 'wait=true 时最多等几分钟' },
        reply_to: { type: 'string', description: '可选：沿用的纸条编号' },
      },
    },
  },
  {
    name: 'pigeon_wait',
    description: '等待一条 Pigeon 纸条（b-…）收到回信或超时，并返回完整回信正文与状态。',
    inputSchema: {
      type: 'object',
      required: ['band'],
      properties: {
        band: { type: 'string', description: '纸条编号（形如 b-3f9a02c1d7）' },
        timeout_min: { type: 'number', description: '最多等待几分钟（可选）' },
      },
    },
  },
  {
    name: 'pigeon_read',
    description: '读取一条 Pigeon 纸条（b-…）的当前状态、发出正文和完整回信。',
    inputSchema: {
      type: 'object',
      required: ['band'],
      properties: {
        band: { type: 'string', description: '纸条编号（形如 b-3f9a02c1d7）' },
      },
    },
  },
  {
    name: 'pigeon_log',
    description: '查看最近的 Pigeon 任务往来记录。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: '返回条数（默认 20）' },
      },
    },
  },
  {
    name: 'pigeon_models',
    description: '读取本机 Codex 和 Antigravity 当前可用的模型与思考强度档位。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function toolText(obj, isError = false) {
  return {
    content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function createMcpHandler({ client = '', cliRunner = runPigeonCli } = {}) {
  let activeClient = normalizeAgentName(client) || normalizeAgentName(process.env.PIGEON_FROM_AGENT) || '';

  async function rulesData(prompt = '') {
    const { raw } = await loadSettings();
    const dfile = readDispatchFile();
    const dset = raw.dispatch && typeof raw.dispatch === 'object' ? raw.dispatch : {};
    const alive = Array.isArray(dfile.alive) ? dfile.alive : null;
    const names = (raw.devices && raw.devices.names) || {};
    const agyVia = raw.agents?.antigravity?.via || 'auto';
    const agyCli = agyVia !== 'app' && !!agyCliBin();
    let hits = [];
    if (prompt && dset.seeded) {
      const seen = new Set();
      hits = ruleHits(dset.rules, prompt, { alive })
        .filter(h => !seen.has(h.r.to) && seen.add(h.r.to))
        .slice(0, 2)
        .map(h => ({
          id: h.r.id,
          when: h.r.when,
          to: h.r.to,
          mode: h.r.mode || 'suggest',
          hint: hitLine(h, { names, text: prompt, agyCli }),
        }));
    }
    return {
      lead: dfile.lead || raw.lead || { kind: 'agent', agent: 'claude', loft: 'local' },
      alive: alive || [],
      promptText: typeof dfile.text === 'string' ? dfile.text : '',
      rules: Array.isArray(dset.rules) ? dset.rules : [],
      hits,
    };
  }

  async function loftsData({ refresh = false, limit = 15 } = {}) {
    const cap = Math.max(1, Math.min(100, Number(limit) || 15));
    let data = null;
    let error = '';
    if (refresh) {
      const r = await cliRunner(['lofts', '--refresh', '--json', `--n=${cap}`], { client: activeClient, timeoutMs: 320000 });
      const parsed = lastJsonLine(r.stdout);
      if (r.code !== 0 || !parsed || !Array.isArray(parsed.lofts)) {
        return { ok: false, error: parsed?.error || r.stdout.trim() || r.stderr.trim() || '刷新远程设备失败' };
      }
      data = parsed;
    } else {
      const { post } = await loadSettings();
      const saved = saveLofts({ relays: relayIds(post) });
      data = saved.lofts;
      error = saved.error || '';
    }
    return {
      ok: true,
      updated: data.updated || 0,
      remoteUpdated: data.remoteUpdated || 0,
      ...(error ? { error } : {}),
      lofts: (data.lofts || []).map(l => ({
        id: l.id,
        name: l.name,
        online: l.online !== false,
        projects: l.projects || [],
        totalSessions: (l.sessions || []).length,
        sessions: (l.sessions || []).slice(0, cap),
      })),
    };
  }

  async function callTool(name, args = {}) {
    switch (name) {
      case 'pigeon_rules':
        return toolText(await rulesData(typeof args.prompt === 'string' ? args.prompt : ''));

      case 'pigeon_lofts': {
        const res = await loftsData({ refresh: !!args.refresh, limit: args.limit });
        return toolText(res, !res.ok);
      }

      case 'pigeon_send': {
        const to = String(args.to || '').trim();
        const message = typeof args.message === 'string' ? args.message : '';
        if (!to || !message.trim()) return toolText({ ok: false, error: 'to 和 message 不能为空' }, true);
        const cliArgs = ['send', `--to=${to}`, '--stdin', '--json'];
        if (typeof args.reason === 'string' && args.reason.trim()) cliArgs.push(`--reason=${args.reason.trim()}`);
        if (typeof args.reply_to === 'string' && args.reply_to.trim()) cliArgs.push(`--reply-to=${args.reply_to.trim()}`);
        const timeoutMs = args.wait ? Math.max(60000, ((Number(args.timeout_min) || 10) + 4) * 60000) : 180000;
        const r = await cliRunner(cliArgs, { stdinText: message, client: activeClient, cwd: typeof args.cwd === 'string' ? args.cwd : '', timeoutMs });
        const res = lastJsonLine(r.stdout) || { ok: false, error: r.stderr.trim() || r.stdout.trim() || `发送失败（退出码 ${r.code}）` };
        if (res.ok && args.wait && res.band && !res.paused) {
          const wArgs = ['wait', res.band];
          if (Number(args.timeout_min) > 0) wArgs.push(`--timeout=${Number(args.timeout_min)}`);
          await cliRunner(wArgs, { client: activeClient, timeoutMs });
          const rr = await cliRunner(['read', res.band, '--json'], { client: activeClient, timeoutMs: 30000 });
          const readRes = lastJsonLine(rr.stdout);
          if (readRes) return toolText({ ...res, ...readRes });
        }
        return toolText(res, !res.ok);
      }

      case 'pigeon_new': {
        const title = String(args.title || '').trim();
        const message = typeof args.message === 'string' ? args.message : '';
        if (!title || !message.trim()) return toolText({ ok: false, error: 'title 和 message 不能为空' }, true);
        const cliArgs = ['new', `--title=${title}`, '--stdin', '--json'];
        if (typeof args.agent === 'string' && args.agent.trim()) cliArgs.push(`--agent=${args.agent.trim()}`);
        if (typeof args.loft === 'string' && args.loft.trim()) cliArgs.push(`--loft=${args.loft.trim()}`);
        if (typeof args.cwd === 'string' && args.cwd.trim()) cliArgs.push(`--cwd=${args.cwd.trim()}`);
        if (typeof args.project === 'string' && args.project.trim()) cliArgs.push(`--project=${args.project.trim()}`);
        if (typeof args.model === 'string' && args.model.trim()) cliArgs.push(`--model=${args.model.trim()}`);
        if (typeof args.effort === 'string' && args.effort.trim()) cliArgs.push(`--effort=${args.effort.trim()}`);
        if (typeof args.sandbox === 'string' && args.sandbox.trim()) cliArgs.push(`--sandbox=${args.sandbox.trim()}`);
        if (typeof args.reason === 'string' && args.reason.trim()) cliArgs.push(`--reason=${args.reason.trim()}`);
        if (typeof args.reply_to === 'string' && args.reply_to.trim()) cliArgs.push(`--reply-to=${args.reply_to.trim()}`);
        const timeoutMs = args.wait ? Math.max(60000, ((Number(args.timeout_min) || 10) + 4) * 60000) : 180000;
        const r = await cliRunner(cliArgs, { stdinText: message, client: activeClient, cwd: typeof args.cwd === 'string' ? args.cwd : '', timeoutMs });
        const res = lastJsonLine(r.stdout) || { ok: false, error: r.stderr.trim() || r.stdout.trim() || `新开对话失败（退出码 ${r.code}）` };
        if (res.ok && args.wait && res.band && !res.paused) {
          const wArgs = ['wait', res.band];
          if (Number(args.timeout_min) > 0) wArgs.push(`--timeout=${Number(args.timeout_min)}`);
          await cliRunner(wArgs, { client: activeClient, timeoutMs });
          const rr = await cliRunner(['read', res.band, '--json'], { client: activeClient, timeoutMs: 30000 });
          const readRes = lastJsonLine(rr.stdout);
          if (readRes) return toolText({ ...res, ...readRes });
        }
        return toolText(res, !res.ok);
      }

      case 'pigeon_wait': {
        const band = String(args.band || '').trim();
        if (!isBand(band)) return toolText({ ok: false, error: 'band 格式不对（形如 b-3f9a02c1d7）' }, true);
        const wArgs = ['wait', band];
        if (Number(args.timeout_min) > 0) wArgs.push(`--timeout=${Number(args.timeout_min)}`);
        const timeoutMs = Math.max(60000, ((Number(args.timeout_min) || 10) + 4) * 60000);
        await cliRunner(wArgs, { client: activeClient, timeoutMs });
        const rr = await cliRunner(['read', band, '--json'], { client: activeClient, timeoutMs: 30000 });
        const res = lastJsonLine(rr.stdout) || { ok: false, band, error: rr.stderr.trim() || rr.stdout.trim() || '读取失败' };
        return toolText(res, !res.ok);
      }

      case 'pigeon_read': {
        const band = String(args.band || '').trim();
        if (!isBand(band)) return toolText({ ok: false, error: 'band 格式不对（形如 b-3f9a02c1d7）' }, true);
        const rr = await cliRunner(['read', band, '--json'], { client: activeClient, timeoutMs: 30000 });
        const res = lastJsonLine(rr.stdout) || { ok: false, band, error: rr.stderr.trim() || rr.stdout.trim() || '读取失败' };
        return toolText(res, !res.ok);
      }

      case 'pigeon_log': {
        const n = Math.max(1, Math.min(100, Number(args.limit) || 20));
        const notes = recent(n).map(x => ({
          band: x.band,
          state: x.state,
          stateLabel: STATE_ZH[x.state] || x.state,
          kind: x.kind,
          via: x.via,
          from: x.from,
          to: x.to,
          created: x.created,
          updated: x.updated,
          ...(x.error ? { error: x.error } : {}),
          ...(x.model ? { model: x.model, effort: x.effort || '' } : {}),
        }));
        return toolText({ notes });
      }

      case 'pigeon_models': {
        return toolText({
          codex: codexModelsCached(),
          antigravity: agyModelsCached({ refresh: false }),
        });
      }

      default:
        return toolText({ ok: false, error: `未知工具：${name}` }, true);
    }
  }

  return async function handle(req) {
    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      if (req && req.id !== undefined) {
        return { jsonrpc: '2.0', id: req.id, error: { code: -32600, message: 'Invalid Request' } };
      }
      return null;
    }
    const id = req.id;
    const isNotification = id === undefined || id === null;
    const reply = result => (isNotification ? null : { jsonrpc: '2.0', id, result });
    const fail = (code, message) => (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });

    switch (req.method) {
      case 'initialize': {
        const params = req.params && typeof req.params === 'object' ? req.params : {};
        if (!activeClient) activeClient = inferClientFromName(params.clientInfo?.name);
        const requested = String(params.protocolVersion || '');
        const protocolVersion = PROTOCOL_VERSIONS.has(requested) ? requested : '2025-03-26';
        return reply({
          protocolVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'pigeon', version: '0.3.0' },
          instructions: buildInstructions(activeClient),
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const params = req.params && typeof req.params === 'object' ? req.params : {};
        if (!params.name) return fail(-32602, 'Missing tool name');
        try {
          return reply(await callTool(String(params.name), params.arguments || {}));
        } catch (e) {
          return reply(toolText({ ok: false, error: e?.message || String(e) }, true));
        }
      }
      case 'resources/list':
        return reply({
          resources: [
            { uri: 'pigeon://rules', name: 'Pigeon 协作分派规则', mimeType: 'application/json' },
            { uri: 'pigeon://lofts', name: 'Pigeon 设备与对话列表', mimeType: 'application/json' },
          ],
        });
      case 'resources/read': {
        const uri = req.params?.uri;
        if (uri === 'pigeon://rules') {
          return reply({
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await rulesData(''), null, 2) }],
          });
        }
        if (uri === 'pigeon://lofts') {
          return reply({
            contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await loftsData({ refresh: false, limit: 20 }), null, 2) }],
          });
        }
        return fail(-32602, `Unknown resource: ${uri || ''}`);
      }
      default:
        return fail(-32601, `Method not found: ${req.method}`);
    }
  };
}

export async function startStdioServer(argv = []) {
  const args = parseArgs(argv);
  const client = typeof args.client === 'string' ? args.client : '';
  const handle = createMcpHandler({ client });
  let buf = '';
  let chain = Promise.resolve();

  const writeLine = obj => {
    if (!obj) return;
    process.stdout.write(JSON.stringify(obj) + '\n');
  };

  const processLine = line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    chain = chain.then(async () => {
      let req;
      try {
        req = JSON.parse(trimmed);
      } catch {
        writeLine({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const res = await handle(req);
      writeLine(res);
    }).catch(e => {
      process.stderr.write(`pigeon mcp error: ${e?.stack || e}\n`);
    });
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      processLine(line);
    }
  });

  await new Promise(resolve => {
    process.stdin.on('end', async () => {
      if (buf.trim()) processLine(buf);
      await chain;
      resolve();
    });
    process.stdin.resume();
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer(process.argv.slice(2)).then(code => process.exit(code));
}
