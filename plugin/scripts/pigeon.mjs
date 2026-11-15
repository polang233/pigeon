#!/usr/bin/env node
// Pigeon（信鸽）：让 agent 互相发消息，跨工具，也跨电脑。这是唯一的命令入口。
// 送信的实现在 lib/post.mjs，Codex 派活（run）在 lib/run.mjs。
import { execFileSync } from 'node:child_process';
import { parseArgs } from './lib/common.mjs';
import { run, settingsCmd, doctor } from './lib/run.mjs';
import { sendCmd, newCmd, waitCmd, readCmd, logCmd, loftsCmd, relayCmd, watch } from './lib/post.mjs';

const HELP = `Pigeon（信鸽）：让 agent 互相发消息，跨工具，也跨电脑。

送信：
  pigeon lofts [--refresh] [-n 15]        列出能到达的设备和上面的对话（--refresh 经中继站重读远程，有 token 成本）
  pigeon send --to <对话> "<话>"          给已有对话发一条消息；远程对话写成 <对话>@<设备名或id>
       [--reply-to <编号>] [--wait] [--file <消息文件> | --stdin]
       [--reason "<为什么交给它>"] [--retry-of <编号>] [--ctx-files a,b] [--ctx-tokens 1200] [--json]
  pigeon new --loft <设备> [--project <项目>] --title "<标题>" "<话>"   新开一个对话
       [--model <模型>] [--effort <思考强度>] 以及 send 的 --reason --retry-of --ctx-* --stdin --json
  pigeon wait <编号> [--timeout 分钟]     等到回信到了或没回音，打印回信
  pigeon read <编号>                      读回信
  pigeon log [-n 20] [--json]             最近的任务记录
  pigeon relay [use <对话id|latest> | check]   查看、设置或检查中继站

把活交给 Codex：
  pigeon run --kind image|code|review|general --title "标题" [--cwd 目录] --brief-file 任务说明.md [--temp|--keep] [--reason "<为什么交给它>"]
  pigeon run --kind review -- 直接写任务说明
  pigeon settings   看当前设置
  pigeon doctor     检查 Codex 能不能用
  pigeon open <对话id>   在 Codex 应用里打开对话`;

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  switch (cmd) {
    case 'run': return run(args);
    case 'settings': return settingsCmd();
    case 'doctor': return doctor();
    case 'open':
      if (!args._[0]) { console.error('用法：pigeon open <对话id>'); return 64; }
      execFileSync('open', [`codex://threads/${args._[0]}`]);
      return 0;
    case 'lofts': return loftsCmd(args);
    case 'send': return sendCmd(args);
    case 'new': return newCmd(args);
    case 'wait': return waitCmd(args);
    case 'read': return readCmd(args);
    case 'log': return logCmd(args);
    case 'relay': return relayCmd(args);
    case '_watch': return watch(args._[0]);
    case undefined: case 'help': case '--help': case '-h':
      console.log(HELP); return 0;
    default:
      console.log(HELP); return 64;
  }
}

process.exit(await main(process.argv.slice(2)));
