# Pigeon 的网页界面

Mac 应用的窗口里显示的就是这里的页面：应用经自己的本机服务（`127.0.0.1:47321`）放 `web/`，窗口里的 WKWebView 打开它，数据经 HTTP 和 SSE（`/events`）来回。接口见 [`docs/CONTRACT.md`](../docs/CONTRACT.md)，方案和进度见 [`docs/DESIGN.md`](../docs/DESIGN.md)。

## 两种模式，一套代码

页面启动时读一次 `GET /api/lofts`：

- **应用模式**：读得到（回的是 `{ lofts: [...] }`）。数据全是真的，后端是 `src/backend/live.js`。没有假的菜单栏、刘海和窗口按钮，页面铺满应用的窗口（刘海是原生的，见 `mac/Notch/`）。
- **演示模式**：读不到。示例数据（`src/data/mock.js`），后端是 `src/backend/demo.js`，网页里画一个假的菜单栏和刘海演示交互，侧栏底下写明“演示”。

### 怎么看

演示（在仓库根目录）：

```bash
python3 tools/serve.py 5190      # 打开 http://127.0.0.1:5190
```

`tools/serve.py` 放 `web/`，把本机 magpie 的额度经和应用一样的地址（`/api/magpie/hello`、`/api/magpie/quotas`）转给页面，转之前把账号邮箱换成占位符；别的 `/api/*` 回 404，所以页面进演示。不要 magpie 的话用普通静态服务也行（`python3 -m http.server 5190 --directory web`），额度全是示例。

不开 Mac 应用看应用模式：

```bash
node tools/fake-hub.mjs 47421    # 打开 http://127.0.0.1:47421
```

`tools/fake-hub.mjs` 是一个假的应用服务（不依赖别的包），在内存里实现契约里网页要用的接口和 SSE，数据是编的（一台远程设备、几种状态的任务、一件带倒计时和密钥的等你确认……）。它还有几个调试地址：`/__fake/fail?path=/api/pause` 让下一次请求回错（看错误提示），`/__fake/magpie?on=0` 让 magpie 回 502，`/__fake/drop` 断开 SSE（看重连），`/__fake/usage?on=0` 让用量回空（看接入页用量的空状态），`/__fake/setup?plugin=none` 让检查清单里的 Claude Code 插件显示没装（刷新后看），`/__fake/ask` 来一件跨设备的事，`/__fake/run` 来一件 pigeon run，`/__fake/state` 看存下的设置和最近一次 `PUT /api/dispatch`。不要用 47321 端口，那是真应用的。

页面用的是 ES 模块，要经 HTTP 打开，双击 `index.html`（file://）打不开。

### 测试

```bash
node --test web/test
```

纯逻辑的测试：接入页用量的占比和数字写法、规则匹配和共用用例（`tests/fixtures/` 里分派、查密钥两份，应用和插件跑同样的）、额度改派、排布、形象动作、额度卡映射、转义；store 里的等你的一队、暂停、重发、派活、换指挥、移除设备；应用模式的适配（接口的数据 → 界面的状态）、规则命中次数、设置的读改写（不认识的字段原样留着）。打包进应用时不带 `test/`。

## 文件

| 文件 | 内容 |
|---|---|
| `index.html` | 页面骨架：假的菜单栏和刘海（应用模式下拿掉）、窗口、侧栏。先加载 `art/` 下的三个普通脚本，最后 `<script type="module" src="src/main.js">` |
| `app.css` | 全部样式。颜色只留给 agent 身份和状态，明暗两套 |
| `src/main.js` | 启动：看是谁打开的页面、读浏览器里存的外观设置、建 store（带对应的后端）、注册各页、挂事件、第一次绘制；切页。还挂了 `window.PigeonApp.open(page)`：原生刘海面板的“在窗口里看”调它让页面翻到某一页，`page` 是 `stage`（指挥台）、`tasks`（任务）、`rules`（分派规则）、`devices`（接入）、`settings`（设置面板） |
| `src/store.js` | 唯一的状态对象和改它的方法，`on()` 订阅、`set()` 改界面状态。话题列表写在文件开头。只管界面状态，“真的去做”的方法来自后端 |
| `src/backend/demo.js` | 演示后端：在内存里模拟派活、放行、超时、暂停、改名…… 方法马上返回结果 |
| `src/backend/live.js` | 应用后端：经 HTTP 读写、经 SSE 收更新，方法返回 Promise；接口回错就交给页面提示，不假装成功。也管 `PUT /api/dispatch` |
| `src/backend/adapt.js` | 应用接口的数据 → 界面的状态（`mapLive`），消息和 pigeon run 的合并，规则在设置里的样子，规则命中次数。纯函数 |
| `src/backend/settings.js` | 写应用的设置：每次先 GET 完整设置、改、再 PUT，排队写 |
| `src/actions.js` | 动作注册表：`register('名字', 处理函数)`，document 上一个委托的 click / dblclick / input / change / keydown 监听按 `data-action` 分发；全局按键用 `onKey` |
| `src/html.js` | `` html`` `` 标签模板：插值默认转义（包括属性），`raw()` 放可信的标记，`bool()` 写 `"true"`/`"false"` |
| `src/dom.js` | `$`、`$$`，`patch()` 局部重画并把焦点还回去，`part()` 换掉一块 `data-part` |
| `src/icons.js` | 线条小图标 `IC`、`svg()`、`icon()`，各家像素标志 `brand()` |
| `src/data/mock.js` | 演示模式的全部示例数据，`createMock()` 每次返回一份新的。只有这里有假数据 |
| `src/data/magpie.js` | 经 `/api/magpie/quotas` 读本机额度，每分钟读一次；演示模式读不到退回示例，应用模式读不到就写读不到 |
| `src/core/` | 纯函数，不碰 DOM：`labels.js` 固定说法，`names.js` 查找和起名，`route.js` 分派规则怎么判（含契约里 `suggest` 的样子）和写进提示的原文（没有一条开着、能交出去的规则时原文是空串，应用不往指挥的提示里写；指挥是你自己时没有提示可写），`pages.js` 指挥台一页有哪些节点，`layout.js` 排布和连线形状，`quota.js` 额度卡对上 agent，`usage.js` 接入页用量的占比，`time.js` 时间说法，`secrets.js` 查密钥和打码 |
| `src/views/` | 各块界面：`stage.js` 指挥台，`faces.js` 头像，`tasks.js` 任务（列表自己滚，表头粘在顶上；展开的那件的详情一直留在列表下面看得到），`route.js` 分派规则，`conn.js` 接入（指挥、每个 agent 的接入方式和设置、设备、添加设备、用量），`hud.js` 网页画的刘海（只在演示模式），`settings.js` 设置面板，`shared.js` 几页共用的动作和倒计时，`nav.js` 侧栏，`tooltip.js`、`toast.js`（含 `after()`）、`rename.js`、`parts.js` |
| `src/skins/` | 指挥台的三种实验样式：`manor.js` 洋馆、`office.js` 办公室、`loft.js` 屋顶，`common.js` 它们共用的。选了才按需加载 |
| `test/` | `node --test` 的测试，`helpers.mjs` 是测试用的状态；`index.js` 只是让 `node --test web/test` 能找到它们 |
| `art/brand.js` | 各家 agent 真实标志的像素版和送信的鸽子：`pigeon(颜色, 样子)` 返回一张自己会动的 SVG |
| `art/loft-art.js` | “屋顶”样式的屋顶和鸽子（上一版界面留下的画法） |
| `art/manor/`、`art/manor.js` | 洋馆样式用的图（Codex 画的，原图在仓库的 `assets/manor/`），和图片缺失时用的像素画 |
| `art/crew/` | DeepSeek 的像素鲸鱼，由 `tools/crew_svg.py` 生成，不要手改；重新生成后把 `src/views/faces.js` 里的 `CREW_V` 加一 |
| `art/clawd-tank/` | Claude Code 的 SVG 动画，取自 clawd-tank（MIT），许可证和改动见目录里的 README；改过后把 `CLAWD_V` 加一 |
| `art/local/` | 不提交（在 .gitignore 里），也不该打包。放 Codex 应用自带的宠物图 `codex-pet.webp`，版权归 OpenAI；没有这个文件时 Codex 退回像素标志 |
| `assets/` | 图标 |

仓库根目录的 `tools/`：`serve.py`（演示服务）、`fake-hub.mjs`（假的应用服务）、`crew_svg.py`（生成 `web/art/crew/`）、`slice_sheet.py`（把 3×3 动作表切成九张：`python3 tools/slice_sheet.py <动作表.png> <输出目录>`）。

## 约定

- **本机 id。** 本机是哪台一律读 `store.state.home`（core 里的函数读 `st.home`），不写死。示例数据里本机叫 `mac`，应用里叫 `local`；`IC.mac`、`os: 'mac'` 是系统图标，跟设备 id 无关。
- **叫法。** 接口里的 `loft`（设备）在界面里叫 `dev`，`deepseek` 叫 `dsh`，只在 `src/backend/adapt.js` 里换（`fromWire`、`toWire`、`keyFromWire`、`keyToWire`）。界面上的字用设备、消息、任务、对话、编号；队列和任务页里的按钮叫“放行”“拦下”“打码后放行”“原样放行”（不叫“放飞”）；状态叫等你确认、排队、进行中、已送达、已回信、没发出、没回音。
- **转义。** 拼页面一律用 `` html`` ``，数据里来的字符串（标题、回信、设备名、用户输入、规则文字）直接插，包括写在 `data-tip`、`value` 这些属性里的，都会转义。图标、嵌套的 `` html`` `` 结果原样放；别的可信标记用 `raw()` 包。不要把数据拼进字符串再交给 `innerHTML`。
- **动作注册。** 能点、能输入的元素写 `data-action="名字"`，参数放在别的 `data-*` 上；处理函数在各页的 `init*()` 里用 `registerAll` 注册，调 store 的方法改数据，不直接改 state。后端的方法可能马上返回、也可能返回 Promise，一律用 `toast.js` 的 `after(结果, 拿到以后做什么)`，失败时它把错误说出来。
- **两种模式。** 只在演示里有的按钮（演示断开、来一件转派、一键接入……）由页面按 `state.mode` 决定画不画；应用模式下没有后端的功能置灰并写一句原因，或者不显示，不假装成功。界面上不写“原型”“示例”。
- **颜色只有一份。** 色值只写在 `app.css` 的变量里，JS 要实色时读 CSS 变量；刘海永远是黑底。
- **局部重画。** 每页分几块（`data-part`），各自订阅关心的话题，只重画受影响的那块。应用推来的新数据整份换过，只发真的变了的话题；正在改名、在本机 Codex 的设置或设置面板里打字时，先不重画，离开输入框再画。

## 应用模式用到的接口

都在 `src/backend/live.js`，字段照 `docs/CONTRACT.md`：

- 读：`GET /api/lofts`、`/api/detect`、`/api/settings`、`/api/notes`、`/api/queue`、`/api/usage`、`/api/codex/models`、`/api/codex/hooks`、`/api/magpie/models`、`/api/magpie/quotas`、`/api/magpie/hello`；`GET /events` 收 `detect`、`lofts`、`queue`、`usage`、`settings`、`hook`（`PigeonNote`、`PigeonRun`）。
- 写：`PATCH /api/settings`（先 GET 完整设置，在上面改，算出改了哪几处，只把这几处交给应用去合并）、`POST /api/pause`、`POST /api/queue/<id>`、`POST /api/send`（只用来重发）、`POST /api/open`、`POST /api/notch`、`POST /api/lofts/refresh`、`POST /api/codex/hooks`、`PUT /api/dispatch`。

## 存在浏览器里的东西

应用模式：外观（明暗、配色、场景、连线、场景样式）存在 `localStorage` 的 `pigeon-settings`，哪些远程设备在指挥台上展开着存在 `pigeon-open`；别的都以应用的设置文件为准。

演示模式：`pigeon-demo-settings`、`pigeon-demo-names`、`pigeon-demo-open`、`pigeon-demo-lead`。想回到默认，把这几项删掉。
