# Pigeon 新界面原型

用来确认新界面的结构和交互。除了本机的订阅额度可以读 magpie 的真数据，其余全是示例数据，按钮大多只改页面上的状态。方案和进度见 [`docs/REDESIGN.md`](../docs/REDESIGN.md)。

原型现在就是新界面前端的骨架：正式重构时把 `src/data/mock.js` 换成读应用接口的适配层，再搬进应用。

## 怎么看

在仓库根目录起服务，然后打开 <http://127.0.0.1:5189>：

```bash
python3 prototype/tools/serve.py
```

它放 `prototype/` 里的文件，顺带把本机 magpie 的订阅额度转给页面（magpie 的网关不许网页直接读）。只转两个只读接口：`/magpie/hello` 和 `/magpie/quotas`（magpie 上次读到的额度，不去问厂商），转之前去掉账号邮箱，不带钥匙，不改 magpie 的任何东西。magpie 的端口从它的 `~/.config/magpie/settings.json` 读，读不到就用 3425；也可以用 `MAGPIE_PORT` 指定。

本机没开 magpie 时，接入页页头写"magpie 没开"，额度用示例数字，开了以后一分钟内自己连上。不需要 magpie 时，用普通静态服务也能看，额度全是示例：

```bash
python3 -m http.server 5189 --bind 127.0.0.1 --directory prototype
```

页面用的是 ES 模块，要经 HTTP 打开，双击 `index.html`（file://）打不开。

纯逻辑的测试（规则匹配、额度改派、排布、形象动作、额度卡映射、转义，store 里的等你的一队、暂停、重发、派活、换指挥、移除设备）：

```bash
node --test prototype/test
```

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 页面骨架：假的菜单栏和刘海、窗口、侧栏。先加载 `art/` 下的三个普通脚本，最后 `<script type="module" src="src/main.js">` |
| `app.css` | 全部样式。颜色只留给 agent 身份和状态，明暗两套 |
| `src/main.js` | 启动：读浏览器里存的设置、建 store、注册各页、挂事件、第一次绘制；切页 |
| `src/store.js` | 唯一的状态对象和改它的方法，`on()` 订阅、`set()` 改界面状态。话题列表写在文件开头 |
| `src/actions.js` | 动作注册表：`register('名字', 处理函数)`，document 上一个委托的 click / dblclick / input / change / keydown 监听按 `data-action` 分发；全局按键用 `onKey` |
| `src/html.js` | `` html`` `` 标签模板：插值默认转义（包括属性），`raw()` 放可信的标记，`bool()` 写 `"true"`/`"false"` |
| `src/dom.js` | `$`、`$$`，`patch()` 局部重画并把焦点还回去，`part()` 换掉一块 `data-part` |
| `src/icons.js` | 线条小图标 `IC`、`svg()`、`icon()`，各家像素标志 `brand()` |
| `src/data/mock.js` | 全部示例数据，`createMock()` 每次返回一份新的。只有这里有假数据 |
| `src/data/magpie.js` | 经 `/magpie/quotas` 读本机额度，读不到退回示例；每分钟读一次 |
| `src/core/` | 纯函数，不碰 DOM：`labels.js` 固定说法（agent 名、状态、能力说法、设置默认值），`names.js` 查找和起名，`route.js` 分派规则怎么判和写进提示的原文，`pages.js` 指挥台一页有哪些节点、连线上在发生什么、头像动作，`layout.js` 排布和连线形状，`quota.js` 额度卡对上 agent、额度的说法，`time.js` 时间说法，`secrets.js` 查密钥 |
| `src/views/` | 各块界面：`stage.js` 指挥台，`faces.js` 简洁样式的头像，`tasks.js` 任务，`route.js` 分派规则，`conn.js` 接入和添加设备，`hud.js` 刘海面板、等你的一队、菜单栏图标和刘海上的信鸽，`settings.js` 设置面板，`nav.js` 侧栏，`tooltip.js` 悬停的小说明，`toast.js` 底部提示，`rename.js` 设备就地改名，`parts.js` 几页共用的小块 |
| `src/skins/` | 指挥台的三种实验样式：`manor.js` 洋馆、`office.js` 办公室、`loft.js` 鸽舍，`common.js` 它们共用的。选了才按需加载，简洁样式不依赖这里 |
| `test/` | `node --test` 的测试，`helpers.mjs` 是测试用的状态；`index.js` 只是让 `node --test prototype/test` 能找到它们 |
| `art/brand.js` | 各家 agent 真实标志的像素版（小图标、办公室角色和工位），以及送信的鸽子：`pigeon(颜色, 样子)` 返回一张自己会动的 SVG，样子有沿线飞、半路扑腾、停着、远处飞过四种 |
| `art/manor/` | 洋馆样式用的图：四个角色各九个状态的 Q 版立绘（`<agent>/<状态>.png`）、白天和夜晚的大厅。都是 Codex 画的，原图在仓库的 `assets/generated/` |
| `art/manor.js` | 洋馆样式的像素画备用版：图片缺失时用 |
| `art/local/` | 不提交（在 .gitignore 里）。放 Codex 应用自带的宠物图 `codex-pet.webp`，从本机 Codex 应用里取的，版权归 OpenAI，只在原型里用；没有这个文件时 Codex 退回像素标志 |
| `art/crew/` | DeepSeek 的像素鲸鱼：照 clawd-tank 的十个动作换了身子，`dsh-<动作>.svg`。由 `tools/crew_svg.py` 生成，不要手改；重新生成后把 `src/views/faces.js` 里的 `CREW_V` 加一。系统设了“减少动态效果”时动画停下 |
| `art/clawd-tank/` | Claude Code 的 SVG 动画，取自 clawd-tank（MIT）。只改过一处：每个文件的样式末尾加了“减少动态效果时停下动画”的一段（有注释“Pigeon 加的”）。改过后把 `src/views/faces.js` 里的 `CLAWD_V` 加一。许可证和用途见目录里的 README |
| `art/loft-art.js` | 指向 `web/js/loft-art.js` 的软链接，鸽舍样式的屋顶和鸽子用它画 |
| `tools/serve.py` | 原型的本机服务，见上面"怎么看" |
| `tools/crew_svg.py` | 生成 `art/crew/`：`python3 prototype/tools/crew_svg.py` |
| `tools/slice_sheet.py` | 把 Codex 画的 3×3 九宫格动作表切成九张、去白底、按脚底对齐：`python3 prototype/tools/slice_sheet.py <动作表.png> <输出目录>` |

## 约定

- **本机 id。** 本机是哪台一律读 `store.state.home`（core 里的函数读 `st.home`），不写死。示例数据里本机叫 `mac`；`IC.mac`、`os: 'mac'` 是系统图标，跟设备 id 无关。
- **转义。** 拼页面一律用 `` html`` ``，数据里来的字符串（标题、回信、note、设备名、用户输入、规则文字）直接插，包括写在 `data-tip`、`value` 这些属性里的，都会转义。图标、嵌套的 `` html`` `` 结果原样放；别的可信标记用 `raw()` 包。不要把数据拼进字符串再交给 `innerHTML`。
- **动作注册。** 能点、能输入的元素写 `data-action="名字"`，参数放在别的 `data-*` 上；处理函数在各页的 `init*()` 里用 `registerAll` 注册，调 store 的方法改数据，不直接改 state。点到没注册的动作会提示"原型里这个按钮还没接功能"。
- **颜色只有一份。** 色值只写在 `app.css` 的变量里（身份色、徽标色、场景里的鸽子和像素画），JS 要实色时读 CSS 变量；刘海永远是黑底，`.hud` 里把同名的身份色换成深色配色那份。
- **局部重画。** 每页分几块（`data-part`），各自订阅关心的话题，只重画受影响的那块；指挥台的舞台只在设备、对话、任务、展开收起、外观类设置变了时重建。重画后焦点还给有同一个 `data-focus`（或 id、或同样动作和参数）的元素。打字的输入框不跟着重画（`ruleText`、`sheetText`、`draft` 这几个话题只更新别处）。

## 示例数据怎么改

都在 `src/data/mock.js`，字段名照 `docs/CONTRACT.md` 的“新界面要的数据”。契约里的 `loft`（设备）在原型里叫 `dev`。

- `home` 是本机的设备 id。`lead` 是指挥：`{ kind: 'agent', agent, dev }`（这个 agent 在那台上最近一次派活的对话画在指挥台中心），或 `{ kind: 'you' }`（你自己在 Pigeon 里派活，中心画“你”，回信只进任务页和刘海）。只有接入页里能发出（`out` 不是 `nope`）的 agent 能当指挥。
- `S` 是对话。`state` 取 `run`、`wait`、`idle`、`done`、`error`（带一句 `error`，界面上给“重试”）；`activity` 是在做什么（`thinking`、`reading`、`typing`、`building`、`testing`、`delegating`、`waiting`），形象按它挑动作，不看标题。`via: 'codex'` 表示这个对话要经那台设备上的 Codex 带起；`parent` 是它从哪个对话拆出来的。
- `T` 是任务（契约里的纸条），从新到旧。`state` 取 `asking` 等你确认、`queued` 排队、`flying` 进行中、`delivered` 已送达、`home` 已回信、`refused` 没发出、`lost` 没回音；`refused` 带 `reason`（`blocked` 你拦下、`timeout` 没人理、`no_target` 对方不在了、`max_hops` 来回超过上限、`offline` 那台连不上）；重发的带 `retry_of`；暂停中的带 `paused: true`。`from`、`to` 是对话 id，你派的活 `from` 是 `'you'`。每件的 `why`（`kind`：`rule`、`quota`、`override`、`lead`，加 `rule`、`suggested`、`reason`）、`ctx`（`tokens`、`window`、`files`）、`body`（跨设备要发的原文）写在 `MORE` 里；回信没有 `why`。
- `DEV` 是设备，`name` 是显示的名字（用户可以改），`host` 是电脑本来的名字，`os` 决定图标，`link` 写它怎么连（`local`、`codex`、`ssh`、`magpie`），`online` 连不连得上。`CONN` 是每台设备接了哪些 agent、怎么接的（`how`）、是不是入口（`role`）、能不能发能不能收（`out`、`inn`：`yes` 能、`part` 部分能、`nope` 不能）、默认模型（`model`、`think`）。
- `SUB` 是订阅剩余，按 `agent@设备` 记；写在这里的是示例，`data/magpie.js` 读到本机 magpie 的额度后把本机四家换掉（`core/quota.js` 的 `fromCards` 按 agent 用的那家订阅对上）。额度从哪来记在 store 的 `MPQ`。
- `MODELS` 是派活时每个 agent 能选的模型，和每个模型分哪几档思考强度（`low`、`medium`、`high`、`xhigh`，空的表示不分）。`DEF_MODEL` 是新加的 agent 默认用什么。
- `RULES` 是分派规则：`when` 一句话、`kw` 关键词、`to` 交给谁、`fb` 额度不够时改派给谁、`ask` 发之前问不问、`n` 本周命中几次、`over` 指挥没照做几次。`LOW` 是改派的额度阈值。
- `RULES2` 是协作的规矩。`cross`、`relay`、`split` 三个开关对应契约设置里的 `post.confirmRemote`、`post.askRelay`、`post.askSplit`：关掉哪条，那类事就不进等你的一队、直接做，写进指挥提示的原文也跟着变。`relay` 那条也会被刘海里的“以后直接转”关掉。
- `Q` 是等你处理的一队（契约里的 `GET /api/queue`），从旧到新。每件有 `kind`（`cross`、`relay`、`split`）、`from`、`to`（`{ dev, agent, session }`）、`preview`、`created`；`cross` 的 `band` 指向任务、`deadline` 是到点就不发的时间（默认创建后 90 秒，设置里的 `crossTimeoutSec`）、`secrets` 是查到的疑似密钥；`split` 带 `parts`。放行时正好暂停着（全部或那台），那件留在队里标 `paused: true`，继续后再送出。
- `FOUND` 是同一个 Codex 账号下找到的电脑，`MP_FOUND` 是本机 magpie 里加过的远程 magpie，`MAGPIE` 是示例的路由组，`PLAN` 是一键接入本机时会改的文件。
- `DEMO` 是演示用的几件：任务页先展开哪件、刘海“回信到了”演示哪件、刘海派活默认发给谁、新任务记的时间，以及设置里“来一件转派 / 来一件拆活”用的两件事。

## 等你处理的一队怎么用

照 `docs/REDESIGN.md` 的“重构前定下的事”：

- 键盘只在面板展开、并且鼠标在面板上或焦点在面板里时算数：上下选，回车放行选中的那条（焦点停在某个按钮上时回车就是按那个按钮），⌫ 拦下。Esc 或右上角的 × 收起。
- 跨设备那类显示还剩几秒，到点不发，任务记成“没人理，没发出”；你点拦下记成“你拦下了”，任务页里分开显示。没回音、没人理、连不上的能重发。
- 设置里刘海那一节有几个演示：刘海的五种样子、来一件转派或拆活（看规矩开着时进队、关了直接做）、让那台远程设备断开（接入页写“连不上”，指挥台那页顶上一条提示，往那台派活记成“连不上，没发出”）。

## 存在浏览器里的东西

设置存在 `localStorage` 的 `pigeon-proto-settings`（包括指挥台的场景样式，默认简洁），哪些远程设备是展开的存在 `pigeon-proto-open`，改过的设备名存在 `pigeon-proto-names`，指挥是谁存在 `pigeon-proto-lead`（读进来时那个 agent 已经不能发出了，就用示例数据里的默认）。想回到默认，把这几项删掉。上一版的 `pigeon-proto-skin`、`pigeon-proto-pos` 已经不用了。
