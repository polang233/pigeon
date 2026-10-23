# Codex 接入可行性实验（2026-10-23）

目标：做一个 Claude Code 插件，规范“什么活交给 Codex、怎么交”，并在 Meerkat 里提供设置。这一轮只针对 Codex。

## 结论

| 问题 | 结论 | 依据 |
|---|---|---|
| 需要另装 Codex 命令行吗 | **不需要** | ChatGPT 应用自带 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`，版本和应用一致（0.163.0-alpha.11.1），共用 `~/.codex` 的会话、登录和配置。另装的版本可能和应用对不上 |
| Claude 发起的对话能显示在 Codex 应用里吗 | **能** | 普通 `codex exec` 会保存会话记录，应用里能看到（用户确认过 `01a1679f…` 那次）；再用 `open codex://threads/<会话id>` 可以直接跳到那段对话 |
| 能不显示吗 | **能** | 加 `--ephemeral` 不保存任何会话记录（实验：保留那次多了 1 条记录，不保留那次没有） |
| 命令行能生图吗 | **能** | `exec` 里 Codex 会用内置 `image_gen` 工具，原图存在 `~/.codex/generated_images/<会话id>/`，1254×1254 PNG |
| 生图能选模型和档位吗 | **部分能** | 内置 `image_gen`（不需要 API key）只能通过提示词控制尺寸比例、透明背景、风格；图片模型（`gpt-image-2`）和质量档位只在“API 模式”可调，需要 `OPENAI_API_KEY` |
| Meerkat 能看到 Codex 内部在做什么吗 | **能** | `exec --json` 实时输出每一步（`thread.started`、`command_execution`、`agent_message`、`turn.completed` 和用量），包装层直接转给 Meerkat 即可，不需要 Codex hook |
| 能给 Codex 装 hook 吗 | **能，但要用户在 Codex 里信任一次** | Codex 的 hook 格式和 Claude Code 几乎一样，但新 hook 要有 `config.toml` 里的 `trusted_hash` 才会执行；没信任的会被静默跳过。这属于安全确认，不应由程序替用户写入 |

## 实测到的 Codex 老毛病（包装层要处理）

1. **stdin 没关会卡死**：`exec` 发现 stdin 是管道时会等“更多输入”，一直不结束。包装层必须 `< /dev/null`。
2. **固定开销大**：一句话的任务也要约 2.9 万输入 token（加载 AGENTS.md、技能、插件、MCP 服务）；生一张图约 15 万。可以考虑给委派任务用精简配置（还没测）。
3. **输出里混着无关报错**：配置里 2 项无效设置的警告、一个没登录的 MCP 服务（consensus）报错，每次都会出现。用 `--json` 解析事件，只取需要的部分。
4. **生成的图片不在项目里**：要从 `~/.codex/generated_images/<会话id>/` 复制到项目，并把路径告诉 Claude。
5. **没有超时**：macOS 没有 `timeout` 命令，包装层要自己计时并结束进程。
6. **新 hook 静默不生效**：没信任时不报错，容易以为装好了。

## Meerkat 里的 Codex 设置（草案）

| 设置 | 选项 | 作用 |
|---|---|---|
| 优先用 Codex 生图 | 开 / 关 | 开：Claude 遇到生图需求时交给 Codex |
| 生图方式 | 内置（默认，不需要 key）/ API | API 方式才能选下面两项 |
| 图片模型 | `gpt-image-2` 等 | 仅 API 方式 |
| 图片质量 | 低 / 中 / 高 | 仅 API 方式 |
| 图片尺寸和比例 | 方形 / 横版 / 竖版，可选透明背景 | 两种方式都能用（内置方式写进提示词） |
| 图片保存位置 | 默认项目里的 `assets/generated/` | 包装层负责复制 |
| 在 Codex 里显示对话 | 开 / 关 | 开：保留会话；关：`--ephemeral` |
| 完成后自动打开对话 | 开 / 关 | 开：用 `codex://threads/<id>` 跳到 Codex 应用 |
| 模型 | 从 `~/.codex/models_cache.json` 读取（如 `gpt-6.1-sol`） | `-m` |
| 推理档位 | low / medium / high / xhigh / max | `model_reasoning_effort` |
| 沙箱 | 只读 / 可写工作区 | `-s`；默认按任务类型选 |
| 超时 | 默认 10 分钟 | 包装层计时 |
| 同时最多几个任务 | 默认 2 | 超出就排队 |
| 结果摘要长度 | 默认 300 字 | 完整日志存文件，只把摘要交给 Claude |

## Codex hook 能不能“同意一次全局都能用”

- Codex 按**每一条 hook 记录**单独记信任：`config.toml` 里的 `[hooks.state."<文件>:<事件>:<序号>:<序号>"]` 存一个 `trusted_hash`。所以一次加了 5 条（实验里的 PreToolUse、PostToolUse、SessionStart、UserPromptSubmit、Stop），就会出现 5 个审查请求。那 5 条已经删掉，请求是过期的，直接选“不信任”或忽略即可，不要信任它们。
- 审查弹窗本身有“全部信任并继续”，一次可以把当前待审的都信任掉。
- 指纹算的是 hook 的定义（命令那一行），不是脚本内容。所以以后如果要装 Codex hook，只装**一条**、命令路径固定不变，用户信任一次就一直有效，后续升级只改脚本内容。
- Codex 还有一个 `bypass_hook_trust` 开关，可以跳过所有 hook 的信任检查。这等于关掉安全确认，任何人往 `hooks.json` 里加的命令都会直接执行，不建议打开，我们也不会替用户打开。
- 现在的方案根本不需要 Codex hook：包装层用 `exec --json` 拿到每一步，所以不会再产生审查请求。

## 下一步（已完成，见下方）

1. 写包装层 `meerkat-codex`：读 Meerkat 设置 → 拼 `codex exec` 参数 → 关 stdin、计时 → 解析 `--json` 事件并转发给 Meerkat → 处理生图产物 → 返回精简结果。
2. 写 Claude Code 插件：自动装 hook、`codex-delegation` skill（什么活交给 Codex、任务说明模板、怎么调用包装层）。
3. Meerkat 加设置页和 `/api/settings`，以及“在 Codex 里打开”按钮。

## 实现情况（2026-10-23）

- **包装层** `plugin/scripts/meerkat-codex.mjs`：`run` / `settings` / `doctor` / `open`。读设置 → 拼 `codex exec --json` 参数 → 关 stdin、计时、排队 → 把 `start`、`thread`、`activity`、`end` 报给 Meerkat → 生图产物复制进项目 → 输出精简结果。完整记录在 `~/.meerkat/runs/`。
- **插件** `plugin/`：`.claude-plugin/plugin.json`、`hooks/hooks.json`（用 `${CLAUDE_PLUGIN_ROOT}`）、`skills/codex-delegation/SKILL.md`；仓库根目录的 `.claude-plugin/marketplace.json` 让它能用 `/plugin marketplace add` 安装。
- **应用**：`GET/PUT /api/settings`、`GET /api/codex/models`（过滤掉 `visibility: hide` 的模型），设置保存在 `~/Library/Application Support/Meerkat/settings.json`。
- **页面**：顶栏“设置”打开设置面板（Codex 一栏，Claude Code、Cursor 以后加）；Codex 任务显示真实动作（来自包装层），任务列表里有产出文件和“在 Codex 里打开”。

**验证过**
- 设置面板改动 → 保存到应用 → 包装层 `settings` 读到新值；API 方式时才显示模型和质量；模型的推理档位随模型变化。
- 真实审查任务：1 分 4 秒完成，结果精简返回，会话保留在 Codex。
- 真实生图任务：设置为横版时出图 1536×1024，自动存进项目的 `assets/generated/`；Meerkat 画面实时显示 Codex 在“生图”“读文件”，结束标成完成，带文件和 Codex 链接。
- 测试时改过的设置已恢复成默认值。

**没验证**
- API 生图方式：没有 `OPENAI_API_KEY`，没测。
- 应用窗口里点“在 Codex 里打开”能否跳转：在内置浏览器里只确认了链接正确。

## 插件安装和 skill 触发（2026-10-24）

- **安装**：桌面应用的对话框里执行 `/plugin` 不会真正安装。用桌面应用自带的 Claude Code 命令行（`~/Library/Application Support/Claude/claude-code/<版本>/.../claude`）执行 `plugin marketplace add` 和 `plugin install meerkat@meerkat` 后才装上，用户级，直接读 `meerkat/plugin` 源码。`plugin validate` 通过；发布到官方目录前还缺许可证（必须）和图标（建议）。
- **skill 没被选中的原因**：装的技能太多，技能列表的说明有长度上限，`meerkat:codex-delegation` 排在后面只剩名字，Claude 看不到触发条件，前三次测试都选了“游戏素材”技能、自己写脚本画像素图。
- **修法**：加 `UserPromptSubmit` hook（`scripts/prompt-hint.mjs`），消息涉及生图或 Codex、且设置为生图优先时补一句提醒，其他消息不加内容，耗时约 24 毫秒。
- **第四次测试通过**：同样的需求，不提 Codex。新会话自己调用了 `meerkat:codex-delegation` → 读设置 → 写任务说明 → `meerkat-codex run --kind image`；Meerkat 收到 Codex 的每一步（读技能、找文件、复制图片、检查尺寸）；出图 1254×1254 存进 `assets/generated/`，会话检查后提交。
