# MindArt — 思维导图式 AI 图像生成插件 · 技术方案

> 状态：规划阶段（不含实现）
> 目标宿主：Codex（CLI / VS Code / Codex App）与 Claude（Claude Code / Claude Desktop / claude.ai）
> 协议基座：MCP + MCP Apps 官方扩展（`io.modelcontextprotocol/ui`，spec 版本 2026-01-26）

---

## 1. 一句话定义

MindArt 是一个 **XMind 式思维导图组织 AI 图像生成** 的 MCP 插件，特殊之处在于**每个节点都是一张图**（图卡）：在任意图卡下新建子卡、写提示词、最多再关联 4 张跨分支参考图（合计 ≤5 张参考），插件把它们编译为 **图 + 文** 的结构化请求交给宿主模型（Codex / Claude）出图，结果原位回填成新图卡，继续向下迭代——整棵树就是一张可回溯的创作族谱。

**本质**：画布只是「构建 prompt 的可视化方式」。最终发给模型的仍然是 *参考图（1..N）+ 文本提示词*，与截图中"参考图1的体型，图2的配色"的用法一致。画布的价值在于：

1. 参考关系显式化（哪张图贡献了什么，用连线 + 取用说明表达）；
2. 迭代谱系可回溯（每次生成都是图上的一个新节点，天然版本树）；
3. 批量/分支探索（同一张父图下可以分叉出多张目标卡，横向对比不同结合方式）。

## 2. 参照产品与差异

| 产品 | 形态 | 与 MindArt 的关系 |
|---|---|---|
| [Cowart](https://github.com/zhongerxin/Cowart) | Codex 原生插件，tldraw 无限画布，AI 图像帧/标注改图/AI Slides | 最接近的工程参照：证明了「Codex 插件 + MCP widget + 项目目录持久化」这条路走得通。但它是**自由画布**（框选、标注），不是**图结构**（节点 + 连线 + 谱系）。另一个教训（用户实测 + 源码确认）：它注册 3 个 skills，但其中 image-gen/image-edit 是画布工作流**自动触发**的内部技能，用户本来就只该用 open——问题在于宿主的 skill 列表把内部技能与用户入口平铺展示、描述又未标明"自动触发无需手动调用"，用户看到 3 个条目只懂 1 个，误以为自己不会用。MindArt 因此确立单一入口原则（§4.5） |
| 截图中的节点式生成（即梦/LiblibAI 类工作流画布） | Web 产品内置节点编辑器 | 产品交互参照与 UI 基准（§4.2）：多图汇聚到生成卡，提示词里用「图1/图2」引用参考图。MindArt 把这种交互搬进 Codex/Claude，让宿主模型代替其后端生成服务 |
| ComfyUI | 节点式工作流引擎 | 反面参照：MindArt 不做算子级工作流（不暴露采样器/ControlNet 等），节点粒度停在「图卡」一层，保持思维导图的轻量心智 |

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

> **交互范式定调：XMind 式结构化思维导图，不做自由画布。** 用户不在画布上随意摆放——所有节点都挂在树上，自动布局；键盘驱动（Tab 加子节点、Enter 加兄弟节点、拖拽只用于调整挂载位置）；跨分支的参考关系用 XMind 的「关联线」表达。这样心智负担最小，操作有成熟范式可抄，而且**迭代谱系天然就是分支深度**（一张图反复改，就是一条不断加深的分支）。

### 4.0 结构模型：树 + 关联线

- **主结构是一棵树**（单根，根节点 = 画板主题，如"角色设计"）。分支用于组织：素材区、方向 A、方向 B……
- **迭代 = 纵向生长**：在图卡下 Tab 出新的空图卡，写提示词出图 → 再在其下继续 Tab 迭代。父链就是完整的创作谱系，无需额外画线。
- **跨分支参考 = 关联线**：新图卡默认以父卡为图1；需要引用其它分支的图（如另一个角色的配色）时，从那张图拉一条关联线过来（写上取用说明），成为图2、图3。这正是 XMind 关联线的用法。

### 4.1 节点模型：只有一种节点——「图卡」

**这是 MindArt 与普通思维导图最本质的差异：每个节点都是一张图。** 不存在文字节点，导图就是一张图的族谱。因此不需要"图片/文本/生成"三分法，节点统一为**图卡（image card）**，一张卡走完整个生命周期：

```
图卡 = { 图（缩略图/原图）, 提示词（这张图怎么来的）, 备注（可选文字约束）, 状态 }

状态机：  draft（空卡，刚 Tab 出来，正在写提示词）
        → queued / generating（已提交，等宿主模型出图）
        → ready（图已就位；素材导入的卡直接进入 ready，提示词为空）
        → error（可重试）
```

- **素材图**：粘贴/导入 → 直接生成一张 ready 图卡；
- **生成图**：在任意图卡下 Tab → 得到一张 draft 空卡 → 写提示词 → 提交 → 卡片原位从占位符变成图。父卡自动是图1，跨分支关联线提供图2、图3；
- **文字约束不占节点**：风格、构图这类文字放在图卡的「备注」字段里（编译时并入提示词），或写进画板级「风格设定」（对全板生效）——保持"满屏皆图"的视觉纯度。

参考来源两类：**父链**（父卡即图1，隐式、免操作）+ **关联线**（跨分支显式引用，成为图2 起的编号）。

**每条参考都带一段「取用说明」（usage）**——这是上下文构建的核心：图A 写"要它的背景"，图B 写"要它的脑袋"，图C 写"要它的身子"；父卡这条隐式参考同样可以写取用说明。目标卡自己的提示词则写**结合方式**（"把脑袋接到身子上，放进这个背景里，整体风格统一"）。生成时，每张参考图 + 它的取用说明 + 目标卡的结合指令，全部编译进给模型的上下文（模板见 §4.3）。UI 上取用说明显示在关联线旁（短句截断）与卡片的参考列表里（完整编辑）。

**硬性上限：单次生成最多 5 张参考图**（父卡 1 张 + 关联线最多 4 条）。多模态上下文里塞更多图，宿主模型的注意力和 token 预算都扛不住，效果反而劣化。UI 在拉第 5 条关联线时直接拒绝并提示；编译器同样做校验（双保险）。根节点下直接建卡（无父图）时，关联线上限为 5。只引用参考图本身，**不沿父链递归收集祖先图**——祖先只提供谱系，不进上下文。

### 4.1.1 "满屏皆图"带来的渲染约束（选型时必须一起验证）

普通导图节点是一行文字，MindArt 节点是图卡——这对导图库是非典型负载：

- **统一卡片尺寸**（如 168×168 缩略图 + 底部一行标题），布局引擎按固定尺寸计算，避免图片尺寸参差导致布局抖动；
- **缩略图分级**：节点内永远只渲染缩略图（≤256px，server 生成并缓存），原图只在 fullscreen 预览时取；
- **懒加载 + 折叠**：视口外/折叠分支不取图；大画板（50+ 图）靠折叠分支控制同屏图量；
- 这四项（固定尺寸卡、缩略图、懒加载、大分支折叠性能）并入 §5.1 的选型验证清单。

### 4.2 UI 基准（对齐用户提供的参考截图）

界面还原以用户提供的节点式生成截图为基准（即梦类画布：两张完稿图卡通过汇聚曲线连向"图片生成"卡）。落地要素：

- **图卡**：大尺寸圆角卡片，左上角悬浮标题标签（"归魂灯完稿"/"赌翁完稿"式）；
- **连线**：平滑贝塞尔曲线向目标卡**汇聚**，线中段有 `+` 锚点（点击可在此插入/管理该条参考的取用说明）。树布局下父链与关联线都渲染成这种汇聚曲线，视觉上与截图一致；
- **生成卡（draft 态）**：与图卡同尺寸的虚线框占位卡，中央图片图标 + "输入提示词生成图片"灰字；
- **卡底提示词栏**：参考图缩略图 chips（即图1/图2，可点开写取用说明）+ `+` 添加参考按钮 + 快捷能力 chips（如"风格转绘""调色盘"，本质是预置提示词模板，M3 做）+ 提示词输入框；
- **节点生成历史**：卡片右上角入口，展开该卡的历次生成记录（对应 §6 的 requests 台账，可回滚选用历史产出）。

### 4.2.1 核心交互流

```
用户在导图：图A（归魂灯）卡下 Tab 新建空图卡 → 图A 自动成为图1
           → 从另一分支的图B（赌翁）拉关联线到该卡，取用说明写"要它的配色" → 图B 成为图2
           → 在卡上输入"设计一个新角色，参考图1的体型，图2的配色" → 提交
UI (iframe)：校验参考数 ≤5 → 编译为 GenerationRequest（见 §6），通过 tools/call 调用
             server 的 `mindart_request_generation`（落盘请求台账、卡片置 queued，
             返回请求 id），随后通过 `ui/message` 向对话发送结构化请求（宿主模型可见）
宿主模型   ：读取请求（≤5 张参考图以文件路径/附件形式给到模型）→ 用自身的图像生成能力
             （Codex 内置生图 / Claude 侧配置的生图工具或 API）产出图片文件
           → 调用 server 的 `mindart_apply_result(request_id, image_path)` 回填
UI         ：收到 tool-result / 资源变更通知，该图卡原位显示产出图（ready），族谱更新
```

关键设计决策——**由谁执行生成**，做成双通道：

- **通道 A（默认）：宿主模型执行**。UI 只负责"编译请求 + 交给 agent"。这正是"本质发给模型的还是图和文"：不需要用户配置任何 API key，Codex 用自带生图，Claude 用其环境里可用的生图工具。Cowart 验证了该模式（skill 指挥 agent 生成、写入 assets、widget 展示）。
- **通道 B（可选）：server 直连生图 API**（如配置了 `MINDART_IMAGE_API`），UI 通过 app-only 工具 `generate_image_direct` 调用，不经过对话。适合批量出图、不打断对话流的场景。M2 之后再做。

### 4.3 与宿主模型的"图 + 文"编译规则

图卡提交生成时，UI 把「参考图 + 各自的取用说明 + 目标卡的结合指令」编译为确定性的文本模板（这就是最终喂给模型的全部上下文）：

```
请生成一张图片。
结合指令（目标卡提示词）：{prompt，如"把图2的脑袋接到图1的身子上，整体配色跟图2"}
参考图 1：{图A 文件路径}
  取用说明：{refs[0].usage，如"要它的体型和身子"}
参考图 2：{图B 文件路径}
  取用说明：{refs[1].usage，如"要它的脑袋和绿色配色"}
…（合计不超过 5 张，每张都必须有路径，取用说明可为空）
风格设定（画板级）：{board.styleNote，若有}
本卡备注：{node.note，若有}
产出要求：完成后调用 mindart_apply_result(request_id="{id}", image_path=...)
```

- 图片以**项目内文件路径**传递（两端宿主都能读本地文件并作为多模态输入）；
- 编号规则：图1 = 父卡，图2 起 = 关联线按创建顺序；卡片上实时显示"图1/图2"角标，保证用户提示词里手写"图1"与实际一致；
- **参考图硬上限 5 张**（§4.1），编译器超限即拒绝；只取直接引用，不递归祖先；
- 文字约束只有两处：画板级「风格设定」+ 卡片「备注」，均为纯文本并入模板。

### 4.4 能力范围（MVP 收敛）

做：XMind 式树形导图（自动布局、Tab/Enter/Delete、拖拽调整挂载、折叠展开）、统一图卡（状态机 draft→queued→generating→ready/error）、关联线 + 标签（≤4 条/卡）、族谱高亮（选中卡高亮父链与参考来源）、大图预览（fullscreen display mode）、画板级风格设定、多画板。
不做（明确砍掉）：文字节点、自由摆放/自由绘制/标注（Cowart 已有）、算子级工作流、协同编辑、云端同步。

### 4.5 入口与用户心智：单一入口原则

来自 Cowart 的实测教训：它的 image-gen/image-edit 本是画布自动触发的内部技能，但宿主 skill 列表把它们与用户入口平铺展示，造成"三个条目只懂一个"的困惑——内部机制一旦出现在用户可见列表里，就是心智负担。MindArt 的硬性规则：

- **用户只需要记一件事：打开画板**（`/mindart`，或对模型说"打开画板"）。这是唯一的用户可见 skill / 命令，永远不加第二个；
- **其余一切都是画布内交互**：导入素材、写提示词、拉参考、生成、看历史、重试——全部在 UI 里点/拖/输完成，不存在"要记住去调某个命令"的路径；
- **生成闭环不依赖第二个 skill**：Cowart 用独立 skill 教 agent 处理画布请求，代价是这些内部技能出现在用户列表里；MindArt 改为把行动指令**内联在编译请求里**（§4.3 模板的"产出要求"），配合工具 description 驱动宿主模型——同样的效果，零额外列表条目。唯一 skill 里只额外写"环境差异兜底"（如何探测生图能力、找不到时怎么提示用户）；
- **模型可见的工具面同样克制**（§7）：对模型只暴露 4 个工具（open/get_board/apply_result/report_error + import），其余全部 app-only，模型的工具列表不被撑爆，用户在权限确认里看到的条目也少。

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
│   └── ui/                # 导图前端（基于 mind-elixir，见 §5.1 选型）
│       ├── src/
│       │   ├── App.ts           # 导图实例、主题映射、快捷键
│       │   ├── bridge.ts        # MCP Apps JSON-RPC 桥（ui/initialize、tools/call、
│       │   │                    #  size-changed、theme 变量映射）
│       │   ├── nodes/           # 三类节点的自定义内容渲染（图片/文本/生成）
│       │   └── compile.ts       # 祖先链+关联线 → GenerationRequest 编译器（§4.3）
│       └── vite.config.ts       # vite-plugin-singlefile：产出单文件 HTML（inline JS/CSS）
├── clients/               # 三层薄壳（见 §8）
│   ├── claude-plugin/     # .claude-plugin/plugin.json + .mcp.json + skills/
│   └── codex-plugin/      # .codex-plugin/plugin.json + skills/
├── PLAN.md
└── README.md
```

### 5.1 导图库选型（XMind 式操作是硬约束）

| 候选 | 结论 | 理由 |
|---|---|---|
| **[mind-elixir](https://github.com/ssshooter/mind-elixir-core)** | **首选** | **节点为 DOM 渲染，且节点数据支持 `dangerouslySetInnerHTML` 注入自定义内容**——图卡的提示词框/参考 chips/状态角标全靠它，这是与我们需求匹配度最高的一点；XMind 式快捷键（Tab/Enter）、拖拽调整结构、自动布局、折叠；节点原生支持 `image`；节点间连线（arrow，可作关联线用）；轻量、框架无关（vanilla/React/Vue3 皆可）、MIT、插件生态（`@mind-elixir/node-menu`、`@mind-elixir/export-xmind` 等）、维护活跃 |
| [simple-mind-map（思绪）](https://github.com/wanglin2/mind-map) | 备选 | 功能面更大（多种结构图、主题、概要、富文本），关联线能力更强，中文文档；但 SVG 渲染管线塞可交互 DOM 更绕、包体更大 |
| React Flow + elkjs 自动布局 | 兜底 | 仅当上述两者的自定义节点内容装不下图卡交互时才考虑；需要自己实现全部 XMind 键盘语义，成本最高 |

选型验证放在 M1 第一周：用 mind-elixir 跑通「统一图卡（`dangerouslySetInnerHTML`，含可交互提示词框与参考 chips）+ 固定尺寸卡自动布局 + 跨分支 arrow 连线（含取用说明入口）+ 缩略图懒加载与单文件打包体积」四项，任一不过关即降级到备选。其中 arrow 的标签与语义定制能力是重点验证项（若其连线仅是视觉标注、拿不到稳定的 from/to 数据，则关联线层由我们在 board.json 里自管、渲染上叠加 SVG 层）。

要点：

- **UI 必须打包为单文件 HTML**（spec 要求资源是完整 HTML5 文档；CSP 默认只允许自托管内容），图片不 inline，通过 server 的 `resources/read` 或 `mindart_read_asset` 工具按需取（base64）——避免大画布把 HTML 撑爆。
- **持久化在用户项目目录**（沿用 Cowart 约定）：`<project>/mindart/<board-id>/board.json` + `assets/`。好处：随项目进 git、模型可直接用文件路径引用图片、卸载插件不丢数据。
- **主题**：全部颜色/字体走宿主下发的 CSS 变量 + fallback，Codex 深色 / Claude 亮暗自动跟随。
- **尺寸**：inline 模式用 `maxHeight` 弹性 + `ui/notifications/size-changed`；编辑复杂图时引导用户切 fullscreen（`ui/request-display-mode`）。

## 6. 数据模型（board.json）

树形结构（递归 `{ …, children }`，可直接映射为 mind-elixir 的 nodeData；每个节点就是一张图卡）：

```jsonc
{
  "version": 1,
  "id": "board-7f3a",
  "title": "角色设计",
  "styleNote": "3D 渲染，暗色棚拍背景，第五人格风",   // 画板级风格设定，编译时全板生效
  "root": {
    "id": "n0", "title": "角色设计",                 // 根节点可无图（画板封面）
    "children": [
      { "id": "n1", "title": "归魂灯完稿", "status": "ready",
        "asset": "assets/guihun-lantern.png",
        "children": [
          { "id": "n4", "title": "新角色 v1", "status": "ready",
            "prompt": "设计一个新角色，把图2的脑袋接到图1的身子上，整体配色跟图2",
            "note": "斗篷保留破损感",                  // 卡片备注（可选文字约束）
            "refs": [                                  // ≤5；order=1 恒为父卡
              { "order": 1, "source": "parent",          "usage": "要它的体型和身子" },
              { "order": 2, "source": "n2", "refLineId": "r1", "usage": "要它的脑袋和绿色配色" }
            ],
            "requestId": "req-01",
            "asset": "assets/gen-01.png",
            "children": [] }                           // ← 继续 Tab 即可迭代 v2
        ] },
      { "id": "n2", "title": "赌翁完稿", "status": "ready",
        "asset": "assets/duweng.png", "children": [] }
    ]
  },
  "refLines": [                              // 跨分支参考的渲染层（汇聚曲线）
    { "id": "r1", "from": "n2", "to": "n4" }
  ],
  "requests": {                              // 生成请求台账（历史/回滚/断点续跑）
    "req-01": { "nodeId": "n4", "compiledPrompt": "…",
                "refs": [{ "node": "n1", "usage": "…" }, { "node": "n2", "usage": "…" }],
                "asset": "assets/gen-01.png", "createdAt": "…", "resolvedAt": "…" }
  }
}
```

约束与说明：

- 图卡状态机 `draft | queued | generating | ready | error`（§4.1）；素材导入的卡 `prompt` 为空、直接 ready；
- `refs` 是**参考槽位表**：`order=1` 恒为父卡（隐式，不需要 refLine），其余来自关联线，每条都带 `usage` 取用说明；上限 5，超限拒绝；
- `refLines` 只是跨分支引用的渲染数据，语义真源在 `refs`（单向派生，避免双写不一致）；
- 一张卡可多次生成：每次生成追加一条 request，卡面 `asset` 指向当前选用的产出，历史在"节点生成历史"里切换；
- 谱系 = 树路径 + refs 回溯，无需 DAG 校验（关联线不构成结构边）。

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

配套 **skill 只有一个**（两端同源，遵守 §4.5 单一入口原则）：`mindart` —— 触发词是"打开画板/mindart"，内容包含：① 调 `mindart_open_canvas`；② 附带生成请求的处理规范（读参考图 → 生成写入 assets → 调 `mindart_apply_result` 回填，不要把图贴在对话里）与生图能力探测兜底。生成时的逐步指令主要由编译模板内联携带（§4.3），skill 只兜环境差异，因此即使 skill 未被触发，闭环仍然成立。

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
| **M1 导图 MVP** | mind-elixir 选型验证（§5.1 四项）→ 统一图卡渲染（含状态机与参考 chips）+ XMind 快捷键 + 关联线与取用说明 + board.json 持久化 + `open_canvas`/`get_board`/`update_board` | Tab/Enter 建树、拉关联线写取用说明，重开画板状态还原 |
| **M2 生成闭环（通道 A）** | `request_generation` → `ui/message` → skill 驱动宿主生成 → `apply_result` 回填；谱系高亮；固化为图片节点 | 复刻截图场景：两张参考图 + "参考图1体型图2配色" 出图 |
| **M3 体验完善** | fullscreen 模式、缩略图缓存、多板管理、连线标签编译、错误重试；通道 B（直连 API）可选实现 | 20+ 节点画布流畅；断网/失败可恢复 |
| **M4 打包分发** | 两端插件壳 + marketplace 清单 + 安装文档 + demo 视频 | 双端一条命令安装可用 |

## 10. 风险与开放问题

1. **Claude Desktop 渲染 bug**（ext-apps#671 / claude-ai-mcp#165）：M0 首要验证项；若复现，fallback 是 claude.ai web 端 + Claude Code。
2. **Codex 插件清单无公开正式文档**：以 Cowart 为事实标准逆向，注意其版本更新。
3. **`ui/message` 的用户体验**：每次生成会在对话里出现一条请求消息（这是通道 A 的必然形态，Cowart 亦如此）。可用 `ui/update-model-context` 静默补充上下文，但"触发生成"仍需一条可见消息驱动 agent 行动——需实测两端哪种组合最顺。
4. **大图性能**：单文件 HTML + base64 取图，画布超过 ~50 张图时内存压力大；缩略图分级（列表 256px / 预览原图）必须在 M3 做。
5. **导图库承载图卡的上限**：mind-elixir 的 `dangerouslySetInnerHTML` 节点若装不下图卡的完整交互（输入框焦点管理、chips 点击与导图快捷键/拖拽的冲突），降级路径是 simple-mind-map，或"卡上只展示图与状态、编辑放侧边抽屉"的交互折衷；满屏图卡的布局与滚动性能同测。M1 第一周出结论。
6. **两端生图能力差异**：Codex 有内置生图；Claude 环境不一定有生图工具（取决于用户接了什么 MCP/工具）。skill 里要写清探测顺序与"无生图能力时提示用户接入"的兜底话术。
7. **命名**：`mindart` 为工作名，发布前查重（npm / marketplace / 商标）。

## 11. 参考资料

- MCP Apps 官方规范：https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- SEP-1865：https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- MCP 官方博客（Apps 发布）：https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/
- Cowart（Codex 画布插件参照）：https://github.com/zhongerxin/Cowart
- Claude Code 插件参考文档：https://code.claude.com/docs/en/plugins-reference
- Codex MCP 配置：https://developers.openai.com/codex/mcp
- 已知渲染问题：https://github.com/modelcontextprotocol/ext-apps/issues/671

---

## 12. 实施交接说明（给执行本方案的 agent）

> 本节是可执行起点。按 M0 → M4 顺序推进，每个里程碑以 §9 的验收标准收口。

### 12.1 环境与工程约定

- Node ≥ 20，包管理用 pnpm（workspace：`packages/server`、`packages/ui`、`clients/*`）；TypeScript strict。
- 实现顺序严格按里程碑走，**不要跳过 M0**：M0 的产出（三端渲染结论 + 桥接代码）决定后面所有 UI 工作是否要调整。
- §7 的工具名表是唯一命名真源；§6 的 board.json 是唯一数据真源。文档与实现冲突时，先改文档再改代码。

### 12.2 M0 的具体步骤

1. `git clone https://github.com/modelcontextprotocol/ext-apps` —— 官方仓库自带 **examples（示例 server）与 basic-host（本地宿主）**，以其中最小示例为骨架起步，不要从零手写握手；
2. server：`@modelcontextprotocol/sdk`（TypeScript）+ ext-apps 的 apps SDK（**包名以 ext-apps 仓库 README 为准**，规划期未锁定——见 §12.4），注册一个 `ui://mindart/hello.html` 资源 + 一个带 `_meta.ui.resourceUri` 的 `mindart_open_canvas` 工具；
3. hello.html 里验证四件事：`ui/initialize` 握手拿到 hostContext、CSS 变量读取、`ui/notifications/size-changed` 生效、`tools/call` round-trip（调一个 echo 工具）；
4. 本地调试链：先用 ext-apps 自带 basic-host / MCPJam inspector 跑通，再依次接入三端实测：Claude Code（`claude mcp add`）→ Claude Desktop（Connectors）→ Codex（`codex mcp add` 或 config.toml）；
5. 产出物：`docs/m0-report.md`，记录三端渲染矩阵（成功/失败/截图）、ext-apps#671 是否复现、`ui/message` 与 `ui/update-model-context` 在两端的实际行为差异。

### 12.3 项目目录解析规则（board 落盘位置）

按以下优先级确定 `MINDART_ROOT`（server 启动时解析一次并打日志）：

1. 环境变量 `MINDART_PROJECT_DIR`（插件壳/用户显式指定）；
2. server 进程 cwd 存在 `.git` 或已有 `mindart/` 目录 → 使用 cwd（Claude Code / Codex CLI 场景，宿主以项目目录启动 stdio server）；
3. 兜底 `~/Documents/MindArt/`（Claude Desktop 场景，无项目概念）。

board 路径：`$MINDART_ROOT/mindart/<board-id>/board.json` + `assets/`；缩略图缓存 `assets/.thumbs/`（gitignore）。

### 12.4 实施时必须核验的事实（规划期无法锁定）

| 事项 | 核验方式 | 有出入时 |
|---|---|---|
| ext-apps SDK 的确切 npm 包名与 API | 看 ext-apps 仓库 README/examples 的 import | 以仓库为准，回填本文档 |
| Codex `.codex-plugin/plugin.json` 字段 | clone Cowart 对照其清单 | 以 Cowart 实测为准 |
| `ui/message` 两端支持度与 UX | M0 第 5 步实测 | 若某端不可用，该端生成触发降级为：UI 置 queued + 提示用户在对话里说"继续生成"，skill 里教模型主动 `mindart_get_board` 拉取 pending 请求 |
| mind-elixir arrow 的 from/to 数据可靠性 | M1 选型验证（§5.1） | 关联线自管：refs 为真源 + 自绘 SVG 叠加层 |
| mind-elixir `dangerouslySetInnerHTML` 内的输入框焦点/快捷键冲突 | M1 选型验证 | 编辑交互移到侧边抽屉，卡上只读 |
| Claude Desktop iframe 渲染 bug（ext-apps#671） | M0 实测 | 该端标记"暂不支持"，主打 Claude Code + claude.ai + Codex |

### 12.5 skill 草稿（唯一 skill：`mindart`，两端同源）

> 硬性规则（§4.5）：全插件只有这一个用户可见 skill，不要拆分出 generate/edit 等第二入口。

```markdown
---
name: mindart
description: 打开 MindArt 图像画板（思维导图式 AI 出图）。用户说"打开画板 / mindart /
  继续画图"时使用；对话中出现「MindArt 生成请求 req-…」时按下方规范处理。
---
## 打开画板
调用 mindart_open_canvas(board_id?)。用户没指定画板时用默认画板。

## 处理生成请求（画板会通过消息把请求发进对话）
请求自带结合指令、参考图路径（≤5 张，各带取用说明）和产出要求，严格照做：
1. 用多模态能力读取全部参考图。
2. 生成图片。优先顺序：宿主内置图像生成 → 环境中可用的生图 MCP 工具 → 均不可用时，
   调 mindart_report_error(request_id, "no image generation capability") 并告知用户接入方式。
3. 将产出写入该画板目录 assets/（文件名 gen-<request_id>.png）。
4. 调用 mindart_apply_result(request_id, image_path) 回填。失败调 mindart_report_error。
5. 回复用户一句话结论即可，不要把图片贴在对话里（画板会直接展示）。
```

### 12.6 明确不要做的事（防实施跑偏）

- 不要引入 React/Vue 重框架包住 mind-elixir（单文件体积敏感，vanilla TS + mind-elixir 足够）；
- 不要在 M2 前碰通道 B（直连生图 API）；
- 不要新增第二个用户可见 skill / 命令（单一入口原则，§4.5）；
- 不要自研树布局/快捷键系统（那等于放弃选型结论）；
- 不要把图片 base64 内联进 board.json 或 HTML（走 assets 文件 + 按需读取）。
