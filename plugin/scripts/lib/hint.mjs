// 分派规则的关键词命中：用户这句话里出现了某条规则的关键词，就在这一轮的提示里点名“这条像是哪类活、交给谁、怎么交”。
// 规则来自设置里的 dispatch.rules（线上的样子：to 是 agent@设备，agent 用线上的名字 codex / deepseek / antigravity）。
// mode 是 must（照做）时口气是“请交给”，否则是“建议交给，由你判断”。纯函数，不读文件。

const NAME = { codex: 'Codex', deepseek: 'DeepSeek Harness', antigravity: 'Antigravity', claude: 'Claude Code', cursor: 'Cursor' };

// 关键词按空格、顿号、逗号分开，任意一个出现在这句话里就算命中，不分大小写（和应用里的 Dispatch.suggest 一样）
export const kwList = kw => String(kw || '').split(/[\s,，、]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
export const hitsRule = (rule, text) => {
  const t = String(text || '').toLowerCase();
  return kwList(rule.kw).some(k => t.includes(k));
};

// 命中的规则（开着的、有关键词的、交给的那家还在的），按规则的先后。
// self 是当前指挥（agent@设备）：交给它自己的规则是“自己做”，不用点名交给谁，不算命中
export function ruleHits(rules, text, { alive = null, self = '' } = {}) {
  return (Array.isArray(rules) ? rules : []).map((r, i) => ({ r, i }))
    .filter(({ r }) => r && r.on !== false && r.to && r.to !== self && kwList(r.kw).length && hitsRule(r, text) && (!alive || alive.includes(r.to)));
}
// 设置里的 lead 换成 agent@设备：没写就是本机的 Claude Code，用户自己当指挥是空串
export const leadKeyOf = lead => (lead && lead.kind === 'you' ? '' : `${(lead && lead.agent) || 'claude'}@${(lead && lead.loft) || 'local'}`);

const split = key => { const k = String(key || ''), at = k.lastIndexOf('@'); return at > 0 ? [k.slice(0, at), k.slice(at + 1)] : [k, 'local']; };
export function targetName(key, names = {}) {
  const [a, d] = split(key);
  const where = d === 'local' ? '本机' : (names[d] || d);
  return `${where}的 ${NAME[a] || a}`;
}

// 交给它具体怎么做
// agyCli：装了 Antigravity 命令行 agy、也没在设置里改成走应用
export function howTo(key, { image = false, agyCli = false } = {}) {
  const [a, d] = split(key);
  if (a === 'codex' && d !== 'local') return '用 pigeon:pigeon-post skill 发到那台电脑（Pigeon 会先问用户放行）。';
  if (a === 'codex') return '一次性的活（生图、审查、写代码）先调用 pigeon:codex-delegation skill；要接着某个已有对话说，用 pigeon:pigeon-post skill。'
    + (image ? '不要自己写脚本逐像素画，也不要用 SVG 凑；用户明确要矢量图、SVG 或 CSS 图形时除外。' : '');
  if (a === 'deepseek') return '先调用 pigeon:pigeon-post skill，用 pigeon new --agent dsh 新开对话（只看不改的复审加 --sandbox read-only），或用 pigeon send 接着它已有的对话。';
  if (a === 'antigravity') return agyCli
    ? '先调用 pigeon:pigeon-post skill，用 pigeon new --agent antigravity --cwd <要处理的文件所在的目录> 新开对话（经它的命令行 agy 在那个目录里后台跑，不用开 Antigravity 应用；目录外的文件它读不到）。'
    : '先调用 pigeon:pigeon-post skill，用 pigeon new --agent antigravity 新开对话；要它处理的文件写完整路径。Antigravity 要开着，读它工作区外的文件时它会停下来等用户批准。';
  return '用 pigeon:pigeon-post skill 交过去。';
}

const IMAGE = /(画|生成|做|出|设计|绘制).{0,12}(图|插画|插图|配图|头图|海报|图标|头像|背景|贴图|素材|logo|壁纸|封面)|(插画|插图|配图|头图|像素图|像素画|贴图|抠图|去背景|透明背景)|\b(image|illustration|icon|sprite|logo|wallpaper|banner)s?\b/i;
export const wantsImage = text => IMAGE.test(String(text || ''));

// 一条命中写成一句提醒
export function hitLine({ r, i }, { names = {}, text = '', agyCli = false } = {}) {
  const must = r.mode === 'must', who = targetName(r.to, names), label = r.when || r.kw;
  return `Pigeon 提醒：这条消息像是「${label}」（分派规则第 ${i + 1} 条）。${must ? `请交给${who}，除非用户在这句话里明确说了不要` : `建议交给${who}，由你判断要不要交`}。`
    + howTo(r.to, { image: r.id === 'seed-image' || wantsImage(text), agyCli });
}
