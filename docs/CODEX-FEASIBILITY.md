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

## 下一步

1. 写包装层 `meerkat-codex`：读 Meerkat 设置 → 拼 `codex exec` 参数 → 关 stdin、计时 → 解析 `--json` 事件并转发给 Meerkat → 处理生图产物 → 返回精简结果。
2. 写 Claude Code 插件：自动装 hook、`codex-delegation` skill（什么活交给 Codex、任务说明模板、怎么调用包装层）。
3. Meerkat 加设置页和 `/api/settings`，以及“在 Codex 里打开”按钮。
