# Pigeon 产品路线图

本文梳理 **Pigeon（信鸽）** 的核心产品定位、阶段演进与各阶段验收标准。细节接口约定见 [CONTRACT.md](CONTRACT.md)，日常细节清单见 [TODO.md](TODO.md)，版本变化记录见 [../CHANGELOG.md](../CHANGELOG.md)。

---

## 核心定位

**Pigeon 不是另一个重型独立 AI 对话 IDE，而是多 Agent 协作伴侣与可视化中枢。**

它的核心价值在于：
1. **无感接入你已经在用的 agent**：装上并接好 Claude Code、Codex、DeepSeek Harness、Antigravity、Cursor 后，在任一常用入口继续正常对话即可。
2. **自然分工、真正传话**：主对话按分派规则与任务类型，自然把合适的子任务转交给最擅长的 agent（甚至跨电脑发往远程设备），拿回结果继续推进。
3. **全链路可视化与人为兜底**：谁在给谁派活、为何交给它、进行到哪一步、花了多少 token，在指挥台、频道和刘海面板一目了然；跨设备发送默认先过你手放行，不会失控乱发。

---

## 阶段规划与进度

### ✅ P0：新装可用与核心闭环（已完成）

聚焦**让全新安装的 Mac 用户开箱即用**，打通“装上 → 检查环境 → 看见对话 → 真实派活 → 7 天滚动留存”的闭环：

- **内置完整插件市场**：`mac/scripts/build-app.sh` 自动将完整 `plugin/` 与 `.claude-plugin/marketplace.json` 打入 `Pigeon.app/Contents/Resources/`，不依赖保留源码仓库。
- **开箱检查清单**：新增 `GET /api/setup`，接入页顶部自动展示 Node.js 版本（含 `>= v22.15` zstd 检查）、Claude Code 插件连通状态（含一键复制安装命令）、Codex hook、本机对话扫描数与刷新入口。
- **环境发现兼容**：支持 `nvm` / `fnm` / `mise` / `asdf` / `nodenv` 常见 Node 路径与 `~/Applications/` 目录，修复 `Usage` 30 秒定时保存被覆盖的问题，应用侧自动维护 `~/.pigeon/dispatch.json`。
- **频道页实装与原型收敛**：频道输入框支持在应用模式下真实 `@` 派活（经 `POST /api/send` 携带项目 `cwd`），并隐藏尚未接后端的 0.3a 占位交互，避免误导。
- **磁盘滚动清理**：7 天自动清理 `~/.pigeon/bodies/`、`answers/`、`runs/`，避免长期运行膨胀。

### ✅ P1：轻量桌面伴侣体验（已完成）

聚焦**随时可呼出、随时能接回、重启不丢状态**：

- **登录自启**：基于 `SMAppService.mainApp` 接入菜单栏与设置面板「登录时自动启动」。
- **全局快捷键**：新增 `⌥ 空格` 全局快捷键随时呼出 / 收起刘海快速派活面板（支持笔记本刘海屏与无刘海屏幕菜单栏居中胶囊两种形态）。
- **刘海选项目目录**：刘海快速派活在本机新开对话时直接提供项目目录选择器（汇总本地项目与最近 `cwd`）。
- **`pigeon run` 持久化与恢复**：任务元信息实时落盘至 `~/.pigeon/runs/*.meta.json`，应用重启后经 `GET /api/runs` 恢复历史状态，并根据 `~/.pigeon/running/` 校验进程存活，把意外中断的孤儿任务标记为失败。

### ✅ P2：统一 MCP 与多 Agent 双向互联（已完成）

聚焦**打破“只能由 Claude Code 发起”的单向局限**，让多个主力工具平等互连：

- **零依赖统一 MCP 服务（`pigeon mcp`）**：暴露 8 个标准 MCP 工具（`pigeon_rules`、`pigeon_lofts`、`pigeon_send`、`pigeon_new`、`pigeon_wait`、`pigeon_read`、`pigeon_log`、`pigeon_models`）及 2 个资源（`pigeon://rules`、`pigeon://lofts`），并在握手 `instructions` 自动注入当前分派规则与在线对象。
- **精确发件身份与可视化**：引入 `PIGEON_FROM_AGENT` / `PIGEON_FROM_CWD`，从 Codex / Antigravity / Cursor / DSH 发出的任务均按真实发件人归类进指挥台、频道和任务记录。
- **一键安全配置写入**：新增 `MCPInstall` 与 `GET / POST /api/mcp`，自动维护稳定的 `~/.pigeon/pigeon-mcp` 入口脚本，只增删 pigeon 这一项（Codex 的 TOML 注释和顺序不动，JSON 整份重写；写前备份成 `.pigeon-bak`），一键接入/移除 Codex（`~/.codex/config.toml`）、Antigravity（`~/.gemini/config/mcp_config.json`）与 Cursor（`~/.cursor/mcp.json`）。
- **接入清单打磨**：区分待激活（琥珀黄 `#f0b44a`）与缺失报错状态灯，新增「多 Agent MCP 互联」快捷操作。

### ✅ P3：正式分发与首装引导（已完成核心项）

面向对外公开发布与非源码用户安装体验：

- **安装包构建脚本**：新增 `mac/scripts/build-dmg.sh`（自动生成含 `Applications` 快捷拖入布局的 `build/Pigeon-<版本>.dmg` 并输出 SHA-256 校验与验证）。
- **自定义全局快捷键录制**：支持设置 `perch.hotkey` 与 `perch.hotkeySpec`（默认 `opt+space`），可在「设置 → 桌面与快捷方式」直接按下组合键录制或恢复默认，同步更新菜单栏与 `Carbon` 全局热键。
- **首装默认指挥引导**：在「接入 → 连接检查清单」内嵌「默认指挥」选择行，新装用户可直接在清单里切换主指挥 agent 或「你自己」。

> 后续可补充的可选项：开发者账号正式签名与公证、更多屏幕尺寸/多屏实体真机下的刘海交互与动画微调。

### 📋 P4：进阶协同与生态拓展（中期规划）

- **多跳协同安全阀**：`relay`（接活 agent 往下转派前问我）已接上：经 MCP 来、又不是指挥的 agent 派活先进等你处理的一队；`split`（一次拆多件前问我）还没有来源。
- **更多 Agent 双向接收**：调研并补全 Claude Code 空闲投递与 Cursor 回合结束投递接收能力，以及真机 Codex / 跨设备链路端到端实测验证。
- **magpie 与远程扩展**：把 `quota` 轮询迁入原生端，逐步推进 `via magpie` 与 SSH 远程设备接入方案。

---

## 工程验证基准

每次发版或关键改动前需全部通过：

1. `node --test web/test`（网页状态适配、路由规则、频道逻辑）
2. `node --test plugin/tests`（命令行参数、rollout/relay 解析、hook、统一 MCP 握手与子进程端到端）
3. `cd mac && swift test && cd Notch && swift test`（Mac 本机服务接口、MCP 配置编辑器、刘海交互规则）
4. `cd mac && swift build && cd .. && node --test tests/e2e`（真实 Hub + CLI 联调）
5. `mac/scripts/build-app.sh` + 独立端口快照与实机应用启停验证
