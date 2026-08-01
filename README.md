# MindArt

思维导图式 AI 图像生成插件：在节点画布上用「参考图 + 提示词 → 生成节点」的方式组织出图，
本质上把画布编译成「图 + 文」交给宿主模型（Codex / Claude）生成，结果回填为可继续引用的节点，
形成可追溯的创作谱系。

- 协议：MCP + MCP Apps 官方扩展（`ui://` 交互式界面）
- 宿主：Codex（CLI / VS Code / App）、Claude（Code / Desktop / claude.ai）
- 状态：MVP 已实现；完整方案见 [PLAN.md](PLAN.md)，协议验证记录见 [docs/m0-report.md](docs/m0-report.md)

## 本地开发

要求 Node.js 20 或更高版本，并启用 Corepack：

```bash
corepack pnpm install
corepack pnpm quality
```

开发构建完成后，MCP stdio 服务入口为：

```bash
node packages/server/dist/index.js
```

默认数据保存在当前项目的 `mindart/<board-id>/`。可通过 `MINDART_PROJECT_DIR`
或 `mindart_open_canvas(project_dir=...)` 显式指定项目目录。

## 插件目录

- Codex：`clients/codex-plugin`
- Codex marketplace：`.agents/plugins/marketplace.json`
- Claude Code：`clients/claude-plugin`
- Claude marketplace：`.claude-plugin/marketplace.json`

## Codex 安装

```bash
codex plugin marketplace add zjywill/mindart --ref main
codex plugin add mindart@mindart
```

安装或更新后，请新建 Codex 任务以加载 MindArt skill 与 MCP 服务。
