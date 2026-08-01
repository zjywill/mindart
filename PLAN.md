# MindArt — 思维导图式 AI 图像生成插件 · 技术方案

> 状态：规划阶段（不含实现）
> 目标宿主：Codex（CLI / VS Code / Codex App）与 Claude（Claude Code / Claude Desktop / claude.ai）
> 协议基座：MCP + MCP Apps 官方扩展（`io.modelcontextprotocol/ui`，spec 版本 2026-01-26）

---

## 1. 一句话定义

MindArt 是一个以 **节点画布（思维导图式）** 组织 AI 图像生成的 MCP 插件：用户在画布上把「参考图节点」「提示词节点」连向「生成节点」，点击生成时，插件把上游节点收集为 **图 + 文** 的结构化请求交给宿主模型（Codex / Claude），由模型完成图像生成，结果回填为新的图片节点，可以继续作为下游生成的参考，形成可追溯的创作谱系（DAG）。

**本质**：画布只是「构建 prompt 的可视化方式」。最终发给模型的仍然是 *参考图（1..N）+ 文本提示词*，与截图中"参考图1的体型，图2的配色"的用法一致。画布的价值在于：

1. 参考关系显式化（哪张图贡献了什么，用连线 + 连线标签表达）；
2. 迭代谱系可回溯（每次生成都是图上的一个新节点，天然版本树）；
3. 批量/分支探索（同一组参考可以分叉出多个生成节点，横向对比）。

## 2. 参照产品与差异

| 产品 | 形态 | 与 MindArt 的关系 |
|---|---|---|
| [Cowart](https://github.com/zhongerxin/Cowart) | Codex 原生插件，tldraw 无限画布，AI 图像帧/标注改图/AI Slides | 最接近的工程参照：证明了「Codex 插件 + MCP widget + 项目目录持久化」这条路走得通。但它是**自由画布**（框选、标注），不是**图结构**（节点 + 连线 + 谱系） |
| 截图中的节点式生成（即梦/LiblibAI 类工作流画布） | Web 产品内置节点编辑器 | 产品交互参照：图片节点 → 生成节点，提示词里用「图1/图2」引用参考图。MindArt 把这种交互搬进 Codex/Claude，让宿主模型代替其后端生成服务 |
| ComfyUI | 节点式工作流引擎 | 反面参照：MindArt 不做算子级工作流（不暴露采样器/ControlNet 等），节点粒度停在「图、文、生成」三类，保持思维导图的轻量心智 |

## 3. 协议与平台现状（调研结论）

- **MCP Apps 已是官方扩展**：[SEP-1865](https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp) 于 2026-01-26 定稿为第一个官方 MCP 扩展（[spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)），由 Anthropic、OpenAI 与 MCP-UI 社区共同制定。核心机制：
  - UI 资源用 `ui://` scheme 声明，mimeType `text/html;profile=mcp-app`，必须是完整 HTML5 单文件；
  - 工具通过 `_meta.ui.resourceUri` 关联 UI 资源；`_meta.ui.visibility: ["app"]` 可声明「仅 UI 可调、对模型隐藏」的工具；
  - iframe 与宿主之间走 JSON-RPC：`ui/initialize` 握手 → 宿主推送 `ui/notifications/tool-input` / `tool-result`；UI 可主动调 `tools/call`、`ui/message`（往对话里发消息）、`ui/update-model-context`（更新模型上下文）、`ui/request-display-mode`（inline/fullscreen/pip）、`ui/notifications/size-changed`；
  - 安全：强制 iframe 沙箱 + 双 iframe 代理架构，CSP 域名白名单在资源 `_meta.ui.csp` 里预声明，默认 `default-src 'none'`；
  - 主题：宿主通过 `hostContext.styles.variables` 下发 CSS 变量（`--color-text-primary` 等），UI 需给 fallback。
- **两端支持矩阵**：Claude（web + desktop）、ChatGPT、VS Code Copilot 等均已支持 MCP Apps；Codex 侧 Cowart 已验证 widget 渲染可用。已知风险：Claude Desktop 存在 UI 资源获取后 iframe 未创建的 bug 报告（[ext-apps#671](https://github.com/modelcontextprotocol/ext-apps/issues/671)），需在验证阶段实测。
- **插件封装格式**（详见 §8）：
  - Claude Code：`.claude-plugin/plugin.json` + 根目录 `.mcp.json`（可捆绑 skills/agents/hooks），通过 marketplace（GitHub 仓库 + `.claude-plugin/marketplace.json`）分发；
  - Codex：`.codex-plugin/plugin.json`，`codex plugin marketplace add` + `codex plugin add` 安装（Cowart 同款路径）；MCP server 也可直接写入 `~/.codex/config.toml` 的 `mcp_servers`；
  - Claude Desktop / claude.ai：无插件包概念，直接以 MCP server（本地 stdio 或远程 Streamable HTTP）接入，MCP Apps 自动渲染。

**结论：一份代码（MCP server + UI 资源），三层薄壳封装。** 核心逻辑与协议交互 100% 复用，只有安装清单不同。

## 4. 产品设计

### 4.1 节点类型（刻意保持 3 类）

| 节点 | 内容 | 来源 |
|---|---|---|
| **图片节点** | 一张图 + 可选标题/备注 | 用户拖入/粘贴/从项目文件导入，或由生成节点产出 |
| **文本节点** | 提示词片段（风格、构图、配色约束等），可复用 | 用户输入，或让宿主模型帮写 |
| **生成节点** | 提示词输入框 + 参考图槽位 + 生成状态 + 产出图 | 用户创建；完成后其产出可"固化"为图片节点继续连线 |

连线只有一种语义：**「作为参考输入」**（上游 → 生成节点）。连线可加标签（如"体型"、"配色"），标签会被编译进提示词（"参考图1的体型"）。生成节点产出后自动与产出图之间保留"派生"关系，构成谱系。

### 4.2 核心交互流

```
用户在画布：拖入图A、图B → 新建生成节点 → 连线（图A→生成 [标签:体型]，图B→生成 [标签:配色]）
           → 在生成节点输入"设计一个新角色" → 点【生成】
UI (iframe)：把子图编译为 GenerationRequest（见 §6），通过 tools/call 调用 server 的
             `canvas_request_generation`（把请求落盘并返回请求 id），随后通过
             `ui/message` 向对话发送一条结构化请求（宿主模型可见）
宿主模型   ：读取请求（引用的图以文件路径/附件形式给到模型）→ 用自身的图像生成能力
             （Codex 内置生图 / Claude 侧配置的生图工具或 API）产出图片文件
           → 调用 server 的 `canvas_apply_result(request_id, image_path)` 回填
UI         ：收到 tool-result / 资源变更通知，生成节点显示产出图，谱系更新
```

关键设计决策——**由谁执行生成**，做成双通道：

- **通道 A（默认）：宿主模型执行**。UI 只负责"编译请求 + 交给 agent"。这正是"本质发给模型的还是图和文"：不需要用户配置任何 API key，Codex 用自带生图，Claude 用其环境里可用的生图工具。Cowart 验证了该模式（skill 指挥 agent 生成、写入 assets、widget 展示）。
- **通道 B（可选）：server 直连生图 API**（如配置了 `MINDART_IMAGE_API`），UI 通过 app-only 工具 `generate_image_direct` 调用，不经过对话。适合批量出图、不打断对话流的场景。M2 之后再做。

### 4.3 与宿主模型的"图 + 文"编译规则

生成节点触发时，UI 把上游子图编译为确定性的文本模板（这就是最终喂给模型的内容）：

```
请生成一张图片。
任务：{生成节点提示词}
参考图 1（{连线标签，如"体型"}）：{图A 文件路径}
参考图 2（"配色"）：{图B 文件路径}
上游文本约束：{按拓扑序拼接的文本节点内容}
产出要求：完成后调用 canvas_apply_result(request_id="{id}", image_path=...)
```

- 图片以**项目内文件路径**传递（两端宿主都能读本地文件并作为多模态输入）；
- 编号规则 = 连线创建顺序，UI 上同步显示"图1/图2"角标，保证用户提示词里手写"图1"与实际一致；
- 文本节点按 DAG 拓扑序拼接，位置越近的优先级越高。

### 4.4 画布能力范围（MVP 收敛）

做：无限画布（缩放/平移）、三类节点、连线 + 标签、生成状态（排队/生成中/完成/失败）、谱系高亮（选中一张图，高亮其全部祖先）、图片预览大图（fullscreen display mode）、多页画布。
不做（明确砍掉）：自由绘制/标注（Cowart 已有）、算子级工作流、协同编辑、云端同步。

## 5. 技术架构

```
mindart/
├── packages/
│   ├── server/            # MCP server（Node + TypeScript，@modelcontextprotocol/sdk
│   │   │                  #  + @modelcontextprotocol/ext-apps SDK）
│   │   ├── src/
│   │   │   ├── index.ts         # stdio 入口；能力协商时声明 io.modelcontextprotocol/ui
│   │   │   ├── tools.ts         # 工具定义（见 §7）
│   │   │   ├── store.ts         # 画布持久化（项目目录 canvas 文件 + assets）
│   │   │   └── ui-resource.ts   # 注册 ui://mindart/canvas.html（读打包产物）
│   │   └── package.json
│   └── ui/                # 画布前端（React + React Flow（@xyflow/react）——
│       │                  #  图结构/连线/minimap 开箱即用，比 tldraw 更贴合"节点+边"）
│       ├── src/
│       │   ├── App.tsx          # 画布主体
│       │   ├── bridge.ts        # MCP Apps JSON-RPC 桥（ui/initialize、tools/call、
│       │   │                    #  size-changed、theme 变量映射）
│       │   ├── nodes/           # ImageNode / TextNode / GenerateNode
│       │   └── compile.ts       # 子图 → GenerationRequest 编译器（§4.3）
│       └── vite.config.ts       # vite-plugin-singlefile：产出单文件 HTML（inline JS/CSS）
├── clients/               # 三层薄壳（见 §8）
│   ├── claude-plugin/     # .claude-plugin/plugin.json + .mcp.json + skills/
│   └── codex-plugin/      # .codex-plugin/plugin.json + skills/
├── PLAN.md
└── README.md
```

要点：

- **UI 必须打包为单文件 HTML**（spec 要求资源是完整 HTML5 文档；CSP 默认只允许自托管内容），图片不 inline，通过 server 的 `resources/read` 或 `mindart_read_asset` 工具按需取（base64）——避免大画布把 HTML 撑爆。
- **持久化在用户项目目录**（沿用 Cowart 约定）：`<project>/mindart/<board-id>/board.json` + `assets/`。好处：随项目进 git、模型可直接用文件路径引用图片、卸载插件不丢数据。
- **主题**：全部颜色/字体走宿主下发的 CSS 变量 + fallback，Codex 深色 / Claude 亮暗自动跟随。
- **尺寸**：inline 模式用 `maxHeight` 弹性 + `ui/notifications/size-changed`；编辑复杂图时引导用户切 fullscreen（`ui/request-display-mode`）。

## 6. 数据模型（board.json）

```jsonc
{
  "version": 1,
  "id": "board-7f3a",
  "title": "角色设计",
  "nodes": [
    { "id": "n1", "type": "image", "x": 0,   "y": 0,
      "asset": "assets/guihun-lantern.png", "title": "归魂灯完稿" },
    { "id": "n2", "type": "image", "x": 0,   "y": 420,
      "asset": "assets/duweng.png", "title": "赌翁完稿" },
    { "id": "n3", "type": "text",  "x": 240, "y": 200, "text": "3D 渲染，暗色棚拍背景" },
    { "id": "n4", "type": "generate", "x": 520, "y": 200,
      "prompt": "设计一个新角色，参考图1的体型，图2的配色",
      "status": "done",                      // idle | queued | generating | done | error
      "requestId": "req-01",
      "output": "assets/gen-01.png" }
  ],
  "edges": [
    { "id": "e1", "from": "n1", "to": "n4", "label": "体型", "order": 1 },
    { "id": "e2", "from": "n2", "to": "n4", "label": "配色", "order": 2 },
    { "id": "e3", "from": "n3", "to": "n4", "order": 3 }
  ],
  "requests": {                              // 生成请求台账（谱系与断点续跑）
    "req-01": { "nodeId": "n4", "compiledPrompt": "…", "refs": ["n1","n2"],
                "createdAt": "…", "resolvedAt": "…" }
  }
}
```

约束：边只允许指向 generate 节点；禁止环（提交连线时做 DAG 校验）；generate 节点产出可一键"固化"为新的 image 节点（保留 `derivedFrom: "n4"`）。

## 7. MCP 工具面设计

| 工具 | 可见性 | 用途 |
|---|---|---|
| `mindart_open_canvas(board_id?)` | model | 打开/创建画布。`_meta.ui.resourceUri: "ui://mindart/canvas.html"`，调用后宿主渲染 widget。用户说"打开画布/开个新板子"时由模型调用 |
| `mindart_get_board(board_id)` | model + app | 读取 board.json。模型可用它理解当前画布（例如用户问"帮我看看这个谱系"） |
| `mindart_request_generation(board_id, node_id, request)` | app-only | UI 点击【生成】时调用：落盘请求台账、置节点状态 queued，返回 request_id。随后 UI 用 `ui/message` 把编译好的"图+文"请求发进对话 |
| `mindart_apply_result(request_id, image_path)` | model | **宿主模型生成完图片后调用**，回填产出、置状态 done。这是通道 A 的闭环点 |
| `mindart_report_error(request_id, message)` | model | 生成失败时回填错误 |
| `mindart_update_board(board_id, patch)` | app-only | UI 持久化节点/连线变更（防抖批量写） |
| `mindart_read_asset(path)` | app-only | UI 按需取图（base64），配合缩略图缓存 |
| `mindart_import_image(source_path)` | model + app | 把项目里的图导入 assets 并建节点（用户对模型说"把 logo.png 放进画布"） |
| `generate_image_direct(request)` | app-only（M3） | 通道 B：server 直连生图 API |

配套 **skill**（两端各一份，内容同源）：`mindart-generate` —— 教宿主模型「看到 mindart 生成请求时：读参考图 → 生成图片写入 board assets 目录 → 调 `mindart_apply_result` 回填，不要把图贴在对话里了事」。这是保证通道 A 稳定闭环的关键（Cowart 同款手法）。

## 8. 双端插件封装

### 8.1 Claude Code 插件

```
clients/claude-plugin/
├── .claude-plugin/plugin.json    # { name: "mindart", version, description, author }
├── .mcp.json                     # { "mcpServers": { "mindart": {
│                                 #     "command": "node",
│                                 #     "args": ["${CLAUDE_PLUGIN_ROOT}/../../packages/server/dist/index.js"] } } }
└── skills/mindart-generate/SKILL.md
```

分发：仓库根放 `.claude-plugin/marketplace.json`，用户 `/plugin marketplace add <repo>` → `/plugin install mindart`。

### 8.2 Claude Desktop / claude.ai

同一个 server，用户在 Settings → Connectors 里添加（本地 stdio 或后续提供远程 Streamable HTTP 版）。MCP Apps UI 由 Claude 原生渲染，无需额外封装。**注意实测 [ext-apps#671](https://github.com/modelcontextprotocol/ext-apps/issues/671) 描述的 iframe 不渲染问题。**

### 8.3 Codex 插件

```
clients/codex-plugin/
├── .codex-plugin/plugin.json     # 声明 MCP server 启动命令 + skills（对齐 Cowart 的清单结构）
└── skills/mindart-generate/…
```

安装：`codex plugin marketplace add <path|repo>` → `codex plugin add mindart@<marketplace>`；兜底方案：`~/.codex/config.toml` 手写 `[mcp_servers.mindart]`。

> Codex 插件清单的字段细节以 Cowart 仓库为准（实现前 clone 对照），官方文档若有出入以实测为准。

## 9. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| **M0 协议验证（1~2 天）** | 最小 MCP Apps demo：一个 `ui://` hello-canvas，在 Codex 与 Claude Desktop/Code 三端点亮，验证握手、theme、size-changed、tools/call 往返 | 三端截图 + 已知渲染 bug 清单 |
| **M1 画布 MVP** | React Flow 三类节点 + 连线 + DAG 校验 + board.json 持久化 + `open_canvas`/`get_board`/`update_board` | 手工摆图连线，重开画布状态还原 |
| **M2 生成闭环（通道 A）** | `request_generation` → `ui/message` → skill 驱动宿主生成 → `apply_result` 回填；谱系高亮；固化为图片节点 | 复刻截图场景：两张参考图 + "参考图1体型图2配色" 出图 |
| **M3 体验完善** | fullscreen 模式、缩略图缓存、多板管理、连线标签编译、错误重试；通道 B（直连 API）可选实现 | 20+ 节点画布流畅；断网/失败可恢复 |
| **M4 打包分发** | 两端插件壳 + marketplace 清单 + 安装文档 + demo 视频 | 双端一条命令安装可用 |

## 10. 风险与开放问题

1. **Claude Desktop 渲染 bug**（ext-apps#671 / claude-ai-mcp#165）：M0 首要验证项；若复现，fallback 是 claude.ai web 端 + Claude Code。
2. **Codex 插件清单无公开正式文档**：以 Cowart 为事实标准逆向，注意其版本更新。
3. **`ui/message` 的用户体验**：每次生成会在对话里出现一条请求消息（这是通道 A 的必然形态，Cowart 亦如此）。可用 `ui/update-model-context` 静默补充上下文，但"触发生成"仍需一条可见消息驱动 agent 行动——需实测两端哪种组合最顺。
4. **大图性能**：单文件 HTML + base64 取图，画布超过 ~50 张图时内存压力大；缩略图分级（列表 256px / 预览原图）必须在 M3 做。
5. **两端生图能力差异**：Codex 有内置生图；Claude 环境不一定有生图工具（取决于用户接了什么 MCP/工具）。skill 里要写清探测顺序与"无生图能力时提示用户接入"的兜底话术。
6. **命名**：`mindart` 为工作名，发布前查重（npm / marketplace / 商标）。

## 11. 参考资料

- MCP Apps 官方规范：https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- SEP-1865：https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- MCP 官方博客（Apps 发布）：https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Cowart（Codex 画布插件参照）：https://github.com/zhongerxin/Cowart
- Claude Code 插件参考文档：https://code.claude.com/docs/en/plugins-reference
- Codex MCP 配置：https://developers.openai.com/codex/mcp
- 已知渲染问题：https://github.com/modelcontextprotocol/ext-apps/issues/671
