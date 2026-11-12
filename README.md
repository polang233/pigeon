# Pigeon（信鸽）

Pigeon 是一个 Mac 小应用，加一个 Claude Code 插件。它让你的 agent（能自己干活的 AI 程序，比如 Claude Code、Codex）互相传话：一个 agent 写一张纸条，送给另一个 agent，等对方做完，再把回信取回来。纸条可以送给本机的 Codex 对话，也可以经过 Codex 已连接的远程设备，送到另一台电脑上。每张纸条送到了哪里、现在什么状态，都能在应用里看到。

应用的画面是黄昏屋顶上的像素鸽舍：每台电脑是一座鸽舍，每个 agent 是一只鸽子，纸条是飞来飞去的信鸽。远处屋顶上的小鸽舍是别的电脑。你不盯着画面也行：屏幕上沿（或刘海下沿）有一条很小的提醒条，叫栖木（Perch），会显示"几张纸条在飞、几件事在等你"。

## 能做什么

- **送纸条**：从 Claude Code 给已有的 Codex 对话发一条消息，或新开一个对话；等它做完，读回信。
- **跨电脑**：Codex 已经连接的远程设备，也能收到纸条（需要先设置中继站，见下文）。
- **看飞行记录**：每张纸条有编号（脚环，形如 `b-3f9a02c1d7`），应用里列出从谁到谁、状态、用时和预览。
- **提醒**：纸条归巢、被拒收或迷路时发系统通知；菜单栏的数字是正在飞的纸条数。
- **派活**：用 `pigeon run` 把生图、审查、写代码这类一次性的活交给 Codex，过程会实时显示在画面里。
- **看派活过程**：Claude Code 派出的子代理、交给 Codex 的活，在本机鸽舍里用短途飞行表现；也能统计各 agent 今天和近 7 天的 token 用量（只读本机的对话记录）。

## 纸条的六种状态

| 状态 | 画面上的叫法 | 含义 |
|---|---|---|
| `queued` | 待飞 | 已经排进队列，对方还没接 |
| `flying` | 飞行中 | 正在送：对方已接手，或中继站正在转发 |
| `delivered` | 已送达 | 对方开始处理 |
| `home` | 已归巢 | 对方这一轮结束，回信已取回 |
| `refused` | 被拒收 | 发送被拒：你在确认框里拦下、对方不存在，或超过往返上限 |
| `lost` | 迷路 | 超时没有结果。Pigeon 不会自动重发，由你决定 |

## 运行

需要 Xcode 命令行工具（Swift 6）和 Node.js（插件的命令是 Node 脚本）。

在仓库目录下构建应用，产物是 `build/Pigeon.app`：

```bash
mac/scripts/build-app.sh
```

```bash
open build/Pigeon.app
```

只想看画面：直接用浏览器打开 `web/index.html`，会自动进入模拟演示，其中包含一次跨鸽舍的送信往返。

开发时也可以不打包，直接跑：

```bash
cd mac && swift run
```

应用启动后会在本机 `127.0.0.1:47321` 开一个只给本机用的小服务。要换端口，用环境变量 `PIGEON_PORT`（没设时也读旧的 `MEERKAT_PORT`）。

## 接入 Claude Code

**推荐：装插件。** 插件会自动接好 hook（Claude Code 在工具调用等时刻执行的脚本），并带上两个 skill：`pigeon-post`（教 Claude 什么时候送纸条、怎么写纸条）和 `codex-delegation`（把活交给 Codex）。装一次，所有项目都生效。marketplace 和插件都叫 `pigeon`。在 Claude Code 里（路径换成你自己的仓库目录）：

```
/plugin marketplace add <仓库目录>
```

```
/plugin install pigeon@pigeon
```

装好后新开一个会话。

**只想在某个项目里看画面**：把 `hooks/settings.example.json` 里的 `hooks` 一段加到那个项目的 `.claude/settings.local.json` 里（这个文件只对你自己生效，不会提交），并把里面的 `<仓库目录>` 换成本仓库的实际路径。装了插件就不要再这样配，否则每个事件会收到两次。

转发脚本 `plugin/scripts/forward.sh` 在后台发送，最多等 1 秒；Pigeon 没开时静默失败，不影响 Claude Code。

## 送纸条

命令入口是 `plugin/scripts/pigeon.mjs`。下面用 `pigeon` 代指它，实际输入时写成 `<仓库目录>/plugin/scripts/pigeon.mjs`，也可以把它链接到 `PATH` 里。装了插件后，Claude 会自己调用这些命令，你一般不用手敲。

列出能到达的鸽舍和上面的对话：

```bash
pigeon lofts
```

给已有对话送一张纸条。`--to` 可以写对话 id，或对话标题（标题唯一时）；远程对话写成 `<对话>@<鸽舍名或id>`：

```bash
pigeon send --to "构建助手" "构建 main 分支，把报错带回来"
```

在某座鸽舍里新开一个对话。本机的 `new` 用 `codex exec` 新建对话；远程的 `new` 经过中继站，必须指定项目（那台电脑只保存了一个项目时可以省略 `--project`）：

```bash
pigeon new --loft <鸽舍> --project <项目> --title "标题" "要说的话"
```

新对话可以指定模型和推理档位，不写就用对方的默认设置（本机是 Pigeon 设置里的模型，远程是那台电脑 Codex 应用的默认模型）。能选哪些由对方主机决定，不支持的组合在建对话时会被拒。已有对话换不了模型，所以 `send` 不接受这两个参数，要换就新开一条：

```bash
pigeon new --loft <鸽舍> --project <项目> --title "标题" --model gpt-6-luna --effort high "要说的话"
```

注意：`codex exec` 建的对话审批策略是 `never`，拿不到跨设备的工具，所以不能把它当中继站。

`send` 和 `new` 会立刻返回脚环，同时在后台启动一个独立的看护进程，一直跟到结果出来：更新记录、通知应用、超时就标成"迷路"。加 `--wait` 则会一直等到结果并直接打印回信。`send` 还支持 `--reply-to <脚环>`（沿用同一条链回信）和 `--file <纸条文件>`（从文件读纸条正文）。纸条末尾会自动加一行说明（脚环和来源），对方的记录里据此认出这一轮，也方便你自己追查。

等一张纸条归巢（或迷路），`--timeout` 的单位是分钟：

```bash
pigeon wait <脚环> --timeout 10
```

读回信：

```bash
pigeon read <脚环>
```

远程纸条送到了、但对方做得久，中继站在等待时限内没等到回信，纸条会标成"迷路"。等对方做完，可以补取回信：中继站再等一次、再读一次对方最新一轮。这一步只读，不给对方发任何东西，所以不弹"放飞"确认；`--wait-min` 改这次最多等几分钟：

```bash
pigeon fetch <脚环> --wait-min 10
```

看最近的飞行记录（加 `--json` 输出机器可读的格式）：

```bash
pigeon log -n 20
```

`pigeon lofts` 也支持 `-n <条数>`，限制每座鸽舍显示几条对话。

几个规则：

- **纸条要自成一体。** 对方看不到你这边的对话，纸条里要把背景、要做的事和希望带回什么写清楚。
- **防循环。** 每张纸条属于一条"链"，并记着这是链上的第几次传递。回信时用 `--reply-to <脚环>` 沿用同一条链；传递次数超过设置里的往返上限（`post.maxHops`，默认 10）就拒发，状态是"被拒收"。
- **不盲目重发。** 任何拿不准的情况都标成"迷路"，由你决定要不要再送一次。
- **哪些情况会记一张纸条。** 对方不存在、超过往返上限、对话已归档、排队失败，会记一张"被拒收"。环境问题（Codex 应用没开、中继站没设置或审批策略是 `never`、找不到 `codex` 命令）只给出提示，命令以退出码 3 结束，不记飞行记录。本机发送时 Codex 应用没开不会拒发：纸条排着队，等到超时标成"迷路"。
- **日志不存正文。** 飞行记录里只有编号、双方、状态和最多 80 字的预览。
- **发件人。** 在 Claude Code 里运行时发件人记为 `claude`，否则是 `you`。

## 跨电脑：设置中继站

### 它是怎么工作的

远程电脑上的 Codex 对话，只能通过 Codex 桌面应用内部的工具去操作。命令行没法直接碰，也不要尝试去连桌面应用的工具 socket（会被立刻断开）。所以跨电脑要借一个"中继站"（Waystation）：它是本机 Codex 桌面应用里的一条对话。Pigeon 往它排一条指令，请它替我们去发消息、等结果、读回复，再把结果按固定格式写在最后的回复里。Pigeon 从这条对话的记录里解析出结果。

### 前提

- 本机装了 Codex 桌面应用（ChatGPT 应用里的 Codex），并且**开着**。
- 远程电脑已经在 Codex 里连接好（能在 Codex 里看到它）。
- 要在远程新开对话，需要那台电脑上已经在 Codex 里保存了对应的项目。

### 设置步骤

1. 在 Codex 桌面应用里，**手动**新建一条本地对话，随便起个名字，比如"中继站"。必须是你在应用里自己建的，不能用命令行建。命令行（`codex exec`）建的对话审批策略是 `never`，拿不到 Codex 应用的工具，会直接拒绝发送和新建。
2. 把这条对话设为中继站。可以用对话 id，也可以写 `latest`（取最新的一条）：

```bash
pigeon relay use latest
```

3. 检查是否设置好：

```bash
pigeon relay check
```

4. 读取远程鸽舍和上面的对话（会让中继站跑一轮模型）：

```bash
pigeon lofts --refresh
```

设置也可以在应用的设置页"送信"一组里填（中继站对话 id、往返上限、等待超时）。

### 要知道的代价

- **每次经中继站转发都会跑一轮模型，有 token 成本。** `pigeon lofts --refresh`、给远程对话 `send` 和 `new` 都算。本机对话之间的纸条不经过模型，没有这笔开销。
- **往别的电脑发之前，Pigeon 会弹框问你。** 给远程对话 `send`、在远程 `new` 之前，屏幕上会弹出确认框，写着谁要发、发给谁、发什么。点"放飞"才发；点"拦下"、90 秒没人点、或框弹不出来，都不发，纸条记成"被拒收"。实测中继站对话收到指令后会直接照办，Codex 自己不弹审批，所以这一步由 Pigeon 来做。可以在设置的"送信"里关掉（`post.confirmRemote`），关掉后 agent 可以不经你同意往另一台电脑发消息。
- 这个确认框是护栏，不是安全边界：有 shell 权限的 agent 仍然能改设置文件或脚本绕过它。插件的钩子会拦下明显的绕法（直接 `codex queue`、换掉确认程序）。
- Codex 桌面应用没开、没设置中继站，或中继站的审批策略是 `never` 时，命令会给出一句提示告诉你怎么处理。
- 经中继站发送时，看护进程的截止时间是设置里的等待超时再加 3 分钟（中继站自己也要排队、跑模型）。

## 栖木

栖木是一个不抢键盘焦点的小面板：有刘海的屏幕贴在刘海下沿，没有刘海的贴在菜单栏下沿居中。收起时是一条胶囊，显示"N 在飞 · N 等你"，空闲时几乎透明；鼠标移上去或点击会展开，列出飞行中的纸条和等你处理的事。开关在设置页、菜单栏菜单和"显示"菜单里。超过 2 小时没有任何消息的纸条，应用会当作过期，不再计入数字。

## 派活：`pigeon run`

用 `pigeon run` 把一次性的活交给 Codex，行为和旧版的 `meerkat-codex run` 一样。它会用 ChatGPT 应用自带的 Codex 命令行，关闭 stdin（避免卡死）、按设置计时和限制并发，把每一步实时报给应用，生图结果复制到项目的 `assets/generated/`，最后只输出精简结果和 `codex://threads/<id>` 链接。

先检查环境：

```bash
pigeon doctor
```

交一件生图的活：

```bash
pigeon run --kind image --title "登录页插图" --cwd <项目目录> --brief-file brief.md
```

- 并发中的任务在 `~/.pigeon/running` 里各占一个槽位文件。
- 单次任务可以加 `--temp`（临时任务，不在 Codex 应用里留对话）或 `--keep`；默认按设置里的"对话记录"。
- 设置里开着"统一走包装层"时，Claude 直接跑 `codex exec`、`codex queue` 或调用 Codex 的 MCP 派活工具会被插件拦下，提示它改用 `pigeon run` 或 `pigeon send`（关掉这个设置就不拦），这样所有派给 Codex 的活都能看到进度、按设置执行。
- 旧入口 `plugin/scripts/meerkat-codex.mjs` 保留，只是转发到 `pigeon.mjs`，已有的调用不用改。

## 接收 Codex 自己的事件

设置 → Codex →"接收 Codex 自己的事件"打开后，应用会往 `~/.codex/hooks.json` 加几条转发 hook（转发脚本在 `~/.pigeon/codex-hook.sh`；你自己的 hook 原样保留，关掉就原样删掉）。下次打开 Codex 时它会弹出 hook 审查，选"全部信任"一次就行。之后你直接在 Codex 应用里聊天干活，Pigeon 也会演出来，Codex 等你批准时也会提醒。

hook 配置在会话打开时读取，所以改完后要**在那个项目里新开一个 Claude Code 会话**。

## 限制和没做的事

- **Claude Code 只能当发件方。** 往 Claude Code 的会话里投递消息，没有验证过可行，这一版不做。
- **确认框是系统对话框，还不在栖木上。** Codex 里需要审批的事，也仍然要回到 Codex 里点。
- **跨电脑要经过中继站**，所以要手动建中继站对话、每次要你在确认框里点放飞、有 token 成本，并且依赖 Codex 桌面应用开着。
- 纸条超时只会标成"迷路"，不会自动重发。
- 看不到 Codex 内部做了什么，只能从它的对话记录里读到每一轮的结果。
- Cursor 和 DeepSeek 目前只检测在不在线，不能收发纸条。
- 画面上远处的鸽舍最多画 4 个，同时恢复的纸条最多 10 张；超出的在飞行记录里仍能看到。
- 官网（`site/`）这一版没有更新，内容还是旧版的。

## 从旧版（Meerkat）升级

这个项目原名 Meerkat（狐獴）。如果你装过旧版：

1. 在 Claude Code 里重新添加 marketplace 并安装 `pigeon` 插件（命令见上文"接入 Claude Code"）。旧的 `meerkat` 插件可以卸载。
2. 设置文件会自动迁移：Pigeon 第一次启动时，如果 `~/Library/Application Support/Pigeon/settings.json` 还不存在，而旧的 `~/Library/Application Support/Meerkat/settings.json` 存在，就复制一份过去（不删旧的）。
3. 旧的 `~/.meerkat/`（派活记录等）**不会迁移**，也不会被删除。新的数据放在 `~/.pigeon/`。
4. 兼容旧名字：端口环境变量 `MEERKAT_PORT`、事件名 `MeerkatCodex`、任务 id 字段 `meerkat_task_id` 和环境变量 `MEERKAT_TASK_ID` 仍然能被识别。
5. 如果你开过"接收 Codex 自己的事件"：旧版的转发脚本 `~/.meerkat/codex-hook.sh` 仍然算已安装、还能用。想换成新脚本，在设置里把这个开关关掉再打开一次；之后要在 Codex 里重新信任一次 hook。

## 目录

| 路径 | 内容 |
|---|---|
| `mac/` | Mac 应用：窗口、内置接收服务（`127.0.0.1:47321`）、栖木、菜单栏、连接检测 |
| `web/` | 画面：鸽舍主题（`loft`，默认）和旧版像素工作室（`pixel-studio`）、飞行记录（分"纸条"和"派活"两页）、事件整理、模拟演示、用量面板、设置页 |
| `plugin/` | Claude Code 插件：hook、`pigeon-post` 和 `codex-delegation` 两个 skill、命令入口 `pigeon.mjs`、转发脚本 |
| `hooks/` | 不装插件时手动接 hook 用的示例配置 |
| `site/` | 官网（这一版没有更新） |
| `assets/` | logo、场景美术原图等素材 |
| `docs/PRD.md` | 需求 |
| `docs/CONTRACT.md` | 应用和画面、插件之间的接口 |
| `docs/IMPLEMENTATION.md` | 实际做了什么、验证了什么 |
| `docs/PIGEON-PLAN.md` | 这次改版的总方案 |
| `docs/CODEX-FEASIBILITY.md` | Codex 接入实验和设置说明 |
