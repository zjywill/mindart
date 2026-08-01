import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type StructuredResult = Record<string, unknown>;
type HostContext = NonNullable<ReturnType<App["getHostContext"]>>;

function resultMessage(result: CallToolResult): string {
  return (
    result.content
      ?.filter(
        (content): content is Extract<typeof content, { type: "text" }> =>
          content.type === "text",
      )
      .map((content) => content.text)
      .join("\n") || "MindArt 工具调用失败"
  );
}

export class MindArtBridge {
  readonly app = new App({ name: "MindArt Canvas", version: "0.1.0" });
  onResult: (payload: StructuredResult) => void = () => undefined;
  onToolInput: (input: Record<string, unknown>) => void = () => undefined;
  onError: (error: unknown) => void = console.error;

  constructor() {
    this.app.ontoolinput = (params) => {
      this.onToolInput((params.arguments ?? {}) as Record<string, unknown>);
    };
    this.app.ontoolresult = (result) => {
      if (result.structuredContent) {
        this.onResult(result.structuredContent);
      }
    };
    this.app.onhostcontextchanged = (context) => {
      this.applyHostContext(context);
    };
  }

  async connect(): Promise<void> {
    await this.app.connect();
    const context = this.app.getHostContext();
    if (context) this.applyHostContext(context);
  }

  async callTool<T extends object>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.app.callServerTool({ name, arguments: args });
    if (result.isError) throw new Error(resultMessage(result));
    return (result.structuredContent ?? {}) as T;
  }

  async sendGenerationRequest(compiledPrompt: string): Promise<void> {
    const result = await this.app.sendMessage({
      role: "user",
      content: [{ type: "text", text: compiledPrompt }],
    });
    if (result.isError) {
      throw new Error("宿主未接受生成请求");
    }
  }

  async setModelContext(payload: StructuredResult): Promise<void> {
    if (!this.app.getHostCapabilities()?.updateModelContext) return;
    await this.app.updateModelContext({ structuredContent: payload });
  }

  async toggleFullscreen(): Promise<"inline" | "fullscreen" | "pip"> {
    const current = this.app.getHostContext()?.displayMode ?? "inline";
    const target = current === "fullscreen" ? "inline" : "fullscreen";
    const result = await this.app.requestDisplayMode({ mode: target });
    return result.mode;
  }

  private applyHostContext(context: HostContext): void {
    if (context.theme) applyDocumentTheme(context.theme);
    if (context.styles?.variables) {
      applyHostStyleVariables(context.styles.variables);
    }
    if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
    document.documentElement.dataset.displayMode = context.displayMode ?? "inline";

    const root = document.documentElement;
    if (context.safeAreaInsets) {
      root.style.setProperty(
        "--safe-top",
        `${context.safeAreaInsets.top}px`,
      );
      root.style.setProperty(
        "--safe-right",
        `${context.safeAreaInsets.right}px`,
      );
      root.style.setProperty(
        "--safe-bottom",
        `${context.safeAreaInsets.bottom}px`,
      );
      root.style.setProperty(
        "--safe-left",
        `${context.safeAreaInsets.left}px`,
      );
    }
  }
}
