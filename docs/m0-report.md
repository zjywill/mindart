# M0 协议验证记录

验证日期：2026-08-01

## 自动化与本地验证

| 项目 | 结果 | 说明 |
|---|---|---|
| MCP Apps SDK | 通过 | 使用 `@modelcontextprotocol/ext-apps` 1.7.5 |
| MCP SDK | 通过 | 使用 `@modelcontextprotocol/sdk` 1.30.0 |
| UI 资源 | 通过 | `ui://mindart/canvas.html`，单文件 HTML |
| UI 到工具调用 | 通过 | `callServerTool` 覆盖读取、保存、导入与生成请求 |
| 生成消息 | 通过 | `sendMessage` 提交服务端确定性编译结果 |
| 主题与字体 | 通过 | 读取宿主 theme、CSS 变量与字体 |
| 尺寸通知 | 通过 | MCP Apps 默认自动尺寸通知 |
| 全屏请求 | 通过 | `requestDisplayMode` 切换 inline/fullscreen |
| app-only 工具 | 通过 | 生成请求、保存、资源读取对模型隐藏 |
| 单文件构建 | 通过 | Vite + vite-plugin-singlefile |

## 宿主手工矩阵

| 宿主 | 状态 | 备注 |
|---|---|---|
| Codex App | 待手工验收 | 需要安装插件后新建任务验证实际 widget |
| Codex CLI / VS Code | 待手工验收 | 需要验证当前宿主是否展示 MCP App |
| Claude Code | 待手工验收 | 需要通过 Claude marketplace 安装 |
| Claude Desktop | 待手工验收 | 重点复测 iframe 渲染兼容性 |
| claude.ai | 待手工验收 | 需要可连接的远程 MCP 服务 |

本文件不会把未执行的真实宿主测试标记为通过。自动化测试覆盖协议注册、
资源 MIME 类型、工具闭环和持久化；外部宿主渲染仍需在对应应用中确认。

## 本地界面验收

2026-08-01 使用内置浏览器和 `?demo=1` 演示画板完成以下检查：

| 视口 | 结果 | 检查内容 |
|---|---|---|
| 1440×900 | 通过 | 深色点阵画布、完稿图卡、生成图卡、参考缩略图、`+` 汇聚线与悬浮工具栏 |
| 1280×720 | 通过 | 页面无横向或纵向文档溢出；画布内容保持可平移，工具栏不遮挡生成卡 |
| 390×844 | 通过 | 页面无文档溢出；工具栏收敛为导入与详情动作；画布使用可平移的放大初始视图 |

界面仍需在真实 Codex App 与 Claude Desktop 的 MCP App 容器中复核宿主字体、
安全区和实际主题变量。该项继续保留在上方手工矩阵中。

## 最终自动化结果

- 服务端：6 个测试文件，16 项测试通过。
- 界面逻辑：1 个测试文件，3 项测试通过。
- 服务端行覆盖率：91.35%。
- 单文件 UI 构建：约 649.56 KB，gzip 约 245.25 KB。
- Codex 插件清单校验：通过。
- Codex 与 Claude 的 `mindart` skill 校验：通过。
