// 界面上的固定说法：agent 名字、状态、思考强度、任务状态和原因。不是示例数据，正式版也是这些。
// 纯数据，不碰 DOM。颜色只写 CSS 变量的名字，色值只在 app.css 里有一份。

// 能接进来的 agent，按这个顺序排（刘海的光带也是这个顺序）
export const AGENTS = ['claude', 'codex', 'cursor', 'dsh'];
// 名字和身份色。you 是你自己：指挥可以是你，你在 Pigeon 里派的活发件人也是你
export const AG = {
  claude: { name: 'Claude Code', c: 'var(--claude)' },
  codex: { name: 'Codex', c: 'var(--codex)' },
  cursor: { name: 'Cursor', c: 'var(--cursor)' },
  dsh: { name: 'DeepSeek Harness', c: 'var(--dsh)' },
  you: { name: '你', c: 'var(--accent)' },
};
// 应用的名字（跳回对话时说“在 X 里打开”）和刘海里放得下的短名
export const APP = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', dsh: 'DeepSeek Harness' };
export const SHORT = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor', dsh: 'DSH', you: '你' };

// 思考强度：名字和几格
export const TH = { low: ['低', 1], medium: ['中', 2], high: ['高', 3], xhigh: ['极高', 4], max: ['最高', 5], ultra: ['超高', 6] };
// 对话的状态（契约里的 state）：名字和颜色变量
export const ST = { run: ['在干活', 'var(--run)'], wait: ['等你', 'var(--wait)'], error: ['出错', 'var(--wait)'], idle: ['空闲', 'var(--idle)'], done: ['刚完成', 'var(--ok)'] };
// 对话在做什么（契约里的 activity），形象按它挑动作
export const ACT = { thinking: '在想', reading: '在读', typing: '在改', building: '在构建', testing: '在测试', delegating: '在派活', waiting: '在等你' };

// 任务的状态（契约里纸条的 state）
export const TS = {
  asking: ['等你确认', 'var(--wait)'], queued: ['排队', 'var(--run)'], flying: ['进行中', 'var(--run)'], delivered: ['已送达', 'var(--run)'],
  home: ['已回信', 'var(--ok)'], refused: ['没发出', 'var(--idle)'], lost: ['没回音', 'var(--wait)'],
  failed: ['出错了', 'var(--wait)'], // 经 pigeon run 交给 Codex 的活跑失败了（契约里纸条没有这个状态，只有派活记录有）
};
// 还在路上的（连线上有鸽子在走）
export const LIVE = ['queued', 'flying', 'delivered'];
// 没发出的原因（契约里的 reason）
export const REASON = { blocked: '你拦下了', timeout: '没人理，没发出', no_target: '对方不在了', max_hops: '来回超过上限', offline: '连不上，没发出' };
// 刘海里等你的三类事
export const QK = { cross: '跨设备', relay: '转派', split: '拆活' };

// 接入页：一个 agent 能不能发、能不能收。对用户说能力，不说研发进度。图标颜色：yes 绿、part 黄、nope 灰
export const CAP = {
  out: { yes: '能发出', part: '部分能发出', nope: '只能回信' },
  in: { yes: '能接收', part: '部分能接收', nope: '不能接收' },
  legend: { yes: '能', part: '部分能', nope: '不能' },
};

// 设置面板里的配色：[值, 名字, 四个色块的变量]。色块读的是那套配色自己的变量，见 app.css 的 .pal-*
export const PALETTES = [['classic', '经典'], ['pigeon', '信鸽']];
// 指挥台的场景样式。第一版只做简洁，其余三种是实验
export const SKINS = [['plain', '简洁'], ['manor', '洋馆'], ['office', '办公室'], ['loft', '屋顶']];
// crossTimeoutSec：跨设备发送等几秒没人点就不发（契约里的 post.crossTimeoutSec）
export const SETTINGS0 = { theme: 'system', palette: 'classic', scene: 'on', lines: 'pixel', notch: 'on', quota: 'hover', secrets: 'warn', skin: 'plain', crossTimeoutSec: 90 };
// 纯外观的设置：只记在浏览器里，不进应用的设置文件（契约“第一版重构补充的接口”）
export const LOOKS = ['theme', 'palette', 'scene', 'lines', 'skin'];
