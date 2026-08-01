# MindArt

思维导图式 AI 图像生成插件：在节点画布上用「参考图 + 提示词 → 生成节点」的方式组织出图，
本质上把画布编译成「图 + 文」交给宿主模型（Codex / Claude）生成，结果回填为可继续引用的节点，
形成可追溯的创作谱系。

- 协议：MCP + MCP Apps 官方扩展（`ui://` 交互式界面）
- 宿主：Codex（CLI / VS Code / App）、Claude（Code / Desktop / claude.ai）
- 状态：规划阶段 — 完整方案见 [PLAN.md](PLAN.md)
