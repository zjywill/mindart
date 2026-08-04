import MindElixir from "mind-elixir";
import "mind-elixir/style.css";
import demoBodyUrl from "./assets/demo-body.jpg";
import demoPaletteUrl from "./assets/demo-palette.jpg";
import { bindComposedInput } from "./composed-input.js";
import {
  AlertCircle,
  Check,
  Clock3,
  History,
  ImagePlus,
  Import,
  Link2,
  LoaderCircle,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Scan,
  Sparkles,
  Trash2,
  X,
  createElement,
  type IconNode,
} from "lucide";
import { MindArtBridge, type StructuredResult } from "./bridge.js";
import { buildGenerationInput } from "./compile.js";
import {
  directBranchPath,
  directSubBranchPath,
  referenceArrowHandles,
  TREE_NODE_GAP_X,
} from "./connections.js";
import {
  cloneBoard,
  findNode,
  flattenBoard,
  normalizeClientBoard,
  referencesForNode,
  type Board,
  type BoardNode,
  type GenerationRecord,
} from "./model.js";
import "./styles.css";

type MindElixirInstance = InstanceType<typeof MindElixir>;
type MindElixirData = ReturnType<MindElixirInstance["getData"]>;
type MindNodeObj = MindElixirData["nodeData"];
type MindArrow = NonNullable<MindElixirData["arrows"]>[number];
type MindOperation = {
  name: string;
  obj: {
    id?: string;
    from?: string;
    to?: string;
    label?: string;
  };
};
const DOWN_DIRECTION = 3 as const;
const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
]);
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);
const MINDART_THEME = {
  name: "MindArt",
  type: "dark" as const,
  generateMainBranch: directBranchPath,
  generateSubBranch: directSubBranchPath,
  palette: Array.from({ length: 10 }, () => "var(--mindart-muted)"),
  cssVar: {
    "--node-gap-x": `${TREE_NODE_GAP_X}px`,
    "--node-gap-y": "10px",
    "--main-gap-x": "76px",
    "--main-gap-y": "28px",
    "--main-color": "var(--mindart-muted)",
    "--main-bgcolor": "transparent",
    "--main-bgcolor-transparent": "transparent",
    "--main-border": "0",
    "--color": "var(--mindart-muted)",
    "--bgcolor": "transparent",
    "--selected": "var(--mindart-focus)",
    "--accent-color": "var(--mindart-link)",
    "--root-color": "var(--mindart-text)",
    "--root-bgcolor": "transparent",
    "--root-border-color": "transparent",
    "--root-radius": "8px",
    "--main-radius": "8px",
    "--topic-padding": "0",
    "--panel-color": "var(--mindart-text)",
    "--panel-bgcolor": "var(--mindart-surface)",
    "--panel-border-color": "var(--mindart-border)",
    "--map-padding": "72px 96px",
  },
};

const appRoot = document.querySelector<HTMLDivElement>("#app")!;
if (!appRoot) throw new Error("MindArt root element is missing");

const iconNodes = {
  alert: AlertCircle,
  check: Check,
  clock: Clock3,
  history: History,
  imagePlus: ImagePlus,
  import: Import,
  link: Link2,
  loading: LoaderCircle,
  maximize: Maximize2,
  panelClose: PanelRightClose,
  panelOpen: PanelRightOpen,
  plus: Plus,
  refresh: RefreshCw,
  scan: Scan,
  sparkles: Sparkles,
  trash: Trash2,
  x: X,
} satisfies Record<string, IconNode>;

type IconName = keyof typeof iconNodes;

function icon(name: IconName, className = "icon"): string {
  return createElement(iconNodes[name], {
    class: className,
    width: 18,
    height: 18,
    "stroke-width": 1.75,
    "aria-hidden": "true",
  }).outerHTML;
}

appRoot.innerHTML = `
  <a class="skip-link" href="#mindart-canvas">跳到画板</a>
  <div class="app-shell">
    <header class="toolbar" aria-label="画板工具栏">
      <div class="toolbar-panel brand-group">
        <div class="brand-mark" aria-hidden="true">${icon("sparkles")}</div>
        <div class="board-heading">
          <h1>MindArt</h1>
          <input id="board-title" class="board-title" aria-label="画板标题" maxlength="200" />
        </div>
        <span id="save-state" class="save-state" role="status" aria-live="polite"></span>
      </div>
      <div class="toolbar-panel toolbar-actions">
        <button class="icon-button" id="fit-button" type="button" aria-label="适应画板" title="适应画板">${icon("scan")}</button>
        <button class="icon-button" id="fullscreen-button" type="button" aria-label="切换全屏" title="切换全屏">${icon("maximize")}</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <button class="icon-button" id="panel-button" type="button" aria-label="打开详情面板" title="打开详情面板">${icon("panelOpen")}</button>
      </div>
    </header>

    <main class="workspace">
      <section id="mindart-canvas" class="canvas-region" aria-label="MindArt 图像谱系画板">
        <div id="mind-map" class="mind-map"></div>
        <div class="canvas-shade" aria-hidden="true"></div>
        <div id="canvas-empty" class="canvas-empty" hidden>
          ${icon("imagePlus", "empty-icon")}
          <strong>暂无图卡</strong>
        </div>
      </section>
      <input
        id="image-file-input"
        class="sr-only"
        type="file"
        accept=".apng,.avif,.gif,.jpeg,.jpg,.png,.svg,.webp,image/*"
        multiple
        hidden
      />
      <div id="image-drop-overlay" class="image-drop-overlay" role="status" hidden>
        <div class="image-drop-message">
          ${icon("imagePlus", "drop-icon")}
          <strong>松开以导入图片</strong>
        </div>
      </div>

      <button id="inspector-scrim" class="inspector-scrim" type="button" aria-label="关闭详情面板" hidden></button>
      <aside id="inspector" class="inspector" aria-labelledby="inspector-title" hidden>
        <div class="inspector-header">
          <div class="inspector-heading">
            <p class="eyebrow">图卡详情</p>
            <h2 id="inspector-title">画板设置</h2>
          </div>
          <button class="icon-button inspector-close" id="inspector-close" type="button" aria-label="关闭详情面板" title="关闭详情面板">${icon("x")}</button>
        </div>
        <div id="inspector-content" class="inspector-content"></div>
      </aside>

      <div id="node-context-menu" class="node-context-menu" role="menu" aria-label="图卡操作" hidden>
        <button type="button" role="menuitem" data-menu-action="add-child">
          <span>${icon("sparkles")}添加子级图卡</span>
          <kbd>Tab</kbd>
        </button>
        <button type="button" role="menuitem" data-menu-action="add-parent">
          <span>${icon("imagePlus")}插入父级图卡</span>
          <kbd>Ctrl + Enter</kbd>
        </button>
        <button type="button" role="menuitem" data-menu-action="add-image-child">
          <span>${icon("import")}添加图片子卡</span>
        </button>
        <div class="menu-separator" role="separator"></div>
        <button type="button" role="menuitem" data-menu-action="reveal-finder">
          <span>${icon("import")}在访达中显示</span>
        </button>
        <button type="button" role="menuitem" data-menu-action="reveal-browser">
          <span>${icon("scan")}在浏览器中打开</span>
        </button>
        <div class="menu-separator" role="separator"></div>
        <button type="button" role="menuitem" data-menu-action="add-reference">
          <span>${icon("link")}添加参考图</span>
        </button>
        <button type="button" role="menuitem" data-menu-action="focus">
          <span>${icon("scan")}专注此分支</span>
        </button>
        <button type="button" role="menuitem" data-menu-action="cancel-focus">
          <span>${icon("scan")}退出专注</span>
        </button>
        <button type="button" class="danger-menu-item" role="menuitem" data-menu-action="delete">
          <span>${icon("trash")}删除图卡</span>
        </button>
      </div>
    </main>
  </div>

  <div id="toast-region" class="toast-region" role="status" aria-live="polite" aria-atomic="true"></div>
`;

const bridge = new MindArtBridge();
const mapElement = document.querySelector<HTMLDivElement>("#mind-map")!;
const inspector = document.querySelector<HTMLElement>("#inspector")!;
const inspectorTitle = document.querySelector<HTMLElement>("#inspector-title")!;
const inspectorContent =
  document.querySelector<HTMLDivElement>("#inspector-content")!;
const boardTitleInput =
  document.querySelector<HTMLInputElement>("#board-title")!;
const saveState = document.querySelector<HTMLSpanElement>("#save-state")!;
const toastRegion = document.querySelector<HTMLDivElement>("#toast-region")!;
const imageFileInput =
  document.querySelector<HTMLInputElement>("#image-file-input")!;
const imageDropOverlay =
  document.querySelector<HTMLDivElement>("#image-drop-overlay")!;
const nodeContextMenu =
  document.querySelector<HTMLDivElement>("#node-context-menu")!;
const panelButton = document.querySelector<HTMLButtonElement>("#panel-button")!;
const inspectorClose =
  document.querySelector<HTMLButtonElement>("#inspector-close")!;
const inspectorScrim =
  document.querySelector<HTMLButtonElement>("#inspector-scrim")!;

let board: Board | null = null;
let selectedNodeId: string | null = null;
let referenceTargetId: string | null = null;
let mind: MindElixirInstance | null = null;
let saveTimer: number | undefined;
let saveInFlight: Promise<void> | null = null;
let saveRequested = false;
let saveRevision = 0;
let persistedRevision = 0;
let refreshAfterSave = false;
let inspectorRenderPending = false;
let inspectorHistoryOpen = false;
let knownProjectRoot: string | null = null;
let boardBinding: Promise<void> | null = null;
let pollTimer: number | undefined;
let panelOpen = false;
let importInFlight = false;
let fileDragDepth = 0;
let contextMenuNodeId: string | null = null;
let contextMenuReturnFocus: HTMLElement | null = null;
let pendingImportParentNodeId: string | null = null;
const assetCache = new Map<string, string>();
let assetObserver: IntersectionObserver | null = null;

function showToast(message: string, error = false): void {
  toastRegion.textContent = message;
  toastRegion.classList.toggle("is-error", error);
  window.setTimeout(() => {
    if (toastRegion.textContent === message) toastRegion.textContent = "";
  }, error ? 8_000 : 3_000);
}

function setSaveState(message: string, iconName?: IconName): void {
  saveState.innerHTML = `${iconName ? icon(iconName, "state-icon") : ""}${escapeHtml(message)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusLabel(node: BoardNode): { label: string; icon: IconName } {
  switch (node.status) {
    case "queued":
      return { label: "排队中", icon: "clock" };
    case "generating":
      return { label: "生成中", icon: "loading" };
    case "ready":
      return { label: "已就绪", icon: "check" };
    case "error":
      return { label: "生成失败", icon: "alert" };
    default:
      return { label: "草稿", icon: "imagePlus" };
  }
}

function renderCard(node: BoardNode, isRoot: boolean): string {
  if (isRoot) {
    return `
      <article class="root-card" data-node-id="${escapeHtml(node.id)}" tabindex="0" aria-haspopup="menu" aria-controls="node-context-menu">
        <div class="root-icon">${icon("sparkles")}</div>
        <span class="root-title">${escapeHtml(node.title)}</span>
      </article>
    `;
  }

  const state = statusLabel(node);
  const references = board ? referencesForNode(board, node) : [];
  const referenceThumbs = references
    .map(({ sourceNode, reference }) => {
      const thumbnail = sourceNode.asset
        ? `<img data-asset="${escapeHtml(sourceNode.asset)}" alt="" loading="lazy" />`
        : icon("imagePlus", "reference-placeholder-icon");
      return `
        <button type="button" class="reference-thumb" data-action="reference-detail" title="${escapeHtml(reference.usage || sourceNode.title)}" aria-label="图${reference.order}：${escapeHtml(sourceNode.title)}">
          ${thumbnail}
          <span>图${reference.order}</span>
        </button>
      `;
    })
    .join("");
  const media = node.asset
    ? `<img class="card-image" data-asset="${escapeHtml(node.asset)}" alt="${escapeHtml(node.title)}" loading="lazy" />`
    : `<div class="image-placeholder">${icon(node.status === "error" ? "alert" : "imagePlus", "placeholder-icon")}<strong>${node.status === "error" ? "生成失败" : node.status === "generating" ? "正在生成图片" : node.status === "queued" ? "等待开始生成" : "输入提示词生成图片"}</strong>${node.error ? `<span>${escapeHtml(node.error)}</span>` : ""}</div>`;
  const historyCount = board
    ? Object.values(board.requests).filter((request) => request.nodeId === node.id)
        .length
    : 0;
  const isReady = Boolean(node.asset) && node.status === "ready";

  if (isReady) {
    return `
      <article class="image-card ready-card status-ready" data-node-id="${escapeHtml(node.id)}" tabindex="0" aria-label="${escapeHtml(node.title || "未命名图卡")}，${state.label}" aria-haspopup="menu" aria-controls="node-context-menu">
        <header class="card-header">
          <input class="card-title-input" data-action="title" value="${escapeHtml(node.title)}" maxlength="200" aria-label="图卡标题" />
          <div class="card-actions">
            ${historyCount ? `<button type="button" class="card-icon-button" data-action="history" aria-label="查看 ${historyCount} 条生成记录" title="生成历史">${icon("history")}<span>${historyCount}</span></button>` : ""}
            <button type="button" class="card-icon-button" data-action="add-reference" aria-label="将其他图片添加为参考" title="添加参考">${icon("link")}</button>
          </div>
        </header>
        <div class="card-media">${media}</div>
      </article>
    `;
  }

  return `
    <article class="image-card generation-card status-${node.status ?? "draft"}" data-node-id="${escapeHtml(node.id)}" tabindex="0" aria-label="${escapeHtml(node.title || "未命名图卡")}，${state.label}" aria-haspopup="menu" aria-controls="node-context-menu">
      <header class="card-header">
        <div class="generation-heading">${icon("imagePlus", "generation-type-icon")}<input class="card-title-input" data-action="title" value="${escapeHtml(node.title)}" maxlength="200" aria-label="图卡标题" /></div>
        ${node.status && node.status !== "draft" ? `<span class="status-pill">${icon(state.icon, state.icon === "loading" ? "status-icon spin" : "status-icon")}${state.label}</span>` : ""}
      </header>
      <div class="generator-surface">
        <div class="card-media">${media}</div>
        <div class="generator-composer">
          <div class="reference-row" aria-label="参考图">
            ${referenceThumbs}
            <button type="button" class="reference-add" data-action="add-reference" aria-label="添加参考图" title="添加参考图">${icon("plus", "chip-icon")}</button>
          </div>
          <label class="sr-only" for="prompt-${escapeHtml(node.id)}">生成提示词</label>
          <textarea id="prompt-${escapeHtml(node.id)}" class="card-prompt" data-action="prompt" rows="3" placeholder="描述你想生成的画面…">${escapeHtml(node.prompt ?? "")}</textarea>
          <footer class="card-footer">
            <button type="button" class="history-button" data-action="history" aria-label="查看生成历史">${icon("history")}<span>生成历史${historyCount ? ` · ${historyCount}` : ""}</span></button>
            <button type="button" class="generate-button" data-action="generate">${icon(node.status === "error" ? "refresh" : "sparkles")}<span>${node.status === "error" ? "重试" : node.status === "queued" || node.status === "generating" ? "再次生成" : "生成"}</span></button>
          </footer>
        </div>
      </div>
    </article>
  `;
}

function nodeToMindData(node: BoardNode, isRoot = false): MindNodeObj {
  return {
    id: node.id,
    topic: node.title,
    expanded: node.expanded ?? true,
    dangerouslySetInnerHTML: renderCard(node, isRoot),
    metadata: { mindart: true },
    children: node.children.map((child) => nodeToMindData(child)),
  };
}

function boardToMindData(current: Board): MindElixirData {
  const nodeOrder = new Map(
    Array.from(flattenBoard(current.root).keys()).map((id, index) => [id, index]),
  );

  return {
    nodeData: nodeToMindData(current.root, true),
    direction: DOWN_DIRECTION,
    arrows: current.refLines.map((line) => {
      const handles = referenceArrowHandles(
        nodeOrder.get(line.from) ?? 0,
        nodeOrder.get(line.to) ?? 0,
      );

      return {
        id: line.id,
        from: line.from,
        to: line.to,
        label: "",
        bidirectional: false,
        ...handles,
        style: {
          stroke: "var(--mindart-link)",
          labelColor: "var(--mindart-text)",
          strokeWidth: 2,
          strokeDasharray: "0",
          strokeLinecap: "round",
        },
      };
    }),
  };
}

function renderBoard(nextBoard: Board): void {
  board = normalizeClientBoard(cloneBoard(nextBoard));
  boardTitleInput.value = board.title;
  const data = boardToMindData(board);

  if (!mind) {
    mind = new MindElixir({
      el: mapElement,
      direction: DOWN_DIRECTION,
      toolBar: false,
      keypress: {
        Tab: () => {
          void addNamedChild(mind?.currentNode ?? undefined);
        },
        Enter: (event: KeyboardEvent) => {
          if (event.ctrlKey || event.metaKey) {
            void insertNamedParent(mind?.currentNode ?? undefined);
          } else if (event.shiftKey) {
            void mind?.insertSibling("before");
          } else {
            void mind?.insertSibling("after");
          }
        },
      },
      draggable: true,
      editable: true,
      overflowHidden: false,
      contextMenu: false,
      theme: MINDART_THEME,
      newTopicName: "新图卡",
    });
    mind.init(data);
    bindMindEvents(mind);
    window.setTimeout(frameInitialView, 50);
  } else {
    mind.refresh(data);
  }

  bindCardControlKeys();
  renderInspector(inspectorHistoryOpen, true);
  hydrateAssets();
  schedulePolling();
  void bridge.setModelContext({
    mindart: {
      boardId: board.id,
      title: board.title,
      selectedNodeId,
      pendingRequests: Object.entries(board.requests)
        .filter(([, request]) =>
          ["queued", "generating"].includes(request.status),
        )
        .map(([requestId]) => requestId),
    },
  });
}

function frameInitialView(): void {
  if (!mind) return;
  if (window.innerWidth < 760) {
    mind.scale(0.58);
    mind.toCenter();
    return;
  }
  const preferredScale = Math.min(0.82, Math.max(0.64, window.innerHeight / 1100));
  mind.scale(preferredScale);
  mind.toCenter();
  mind.move(-132, 34);
}

function bindMindEvents(instance: MindElixirInstance): void {
  instance.bus.addListener("selectNodes", (nodes: MindNodeObj[]) => {
    const first = nodes[0];
    if (!first) return;
    handleNodeSelection(first.id);
  });
  instance.bus.addListener("operation", (operation: unknown) => {
    void handleMindOperation(operation);
  });
}

async function handleMindOperation(rawOperation: unknown): Promise<void> {
  if (!board || !mind) return;
  const operation = rawOperation as MindOperation;
  if (operation.name === "createArrow") {
    const arrow = operation.obj as MindArrow;
    addReference(String(arrow.to), String(arrow.from), "");
    return;
  }
  if (operation.name === "removeArrow") {
    const line = board.refLines.find((item) => item.id === operation.obj.id);
    if (line) removeReference(line.to, line.from);
    return;
  }
  if (operation.name === "finishEditArrowLabel") {
    const arrow = operation.obj as MindArrow;
    updateReferenceUsage(
      String(arrow.to),
      String(arrow.from),
      arrow.label === "+" ? "" : arrow.label,
    );
    return;
  }
  if (operation.name === "reshapeArrow") return;

  queueMicrotask(() => {
    syncTreeFromMind();
    queueSave(false, true);
  });
}

function syncTreeFromMind(): void {
  if (!board || !mind) return;
  const existing = flattenBoard(board.root);
  const data = mind.getData().nodeData;

  const rebuild = (
    nodeData: MindNodeObj,
    parent: BoardNode | null,
  ): BoardNode => {
    const previous = existing.get(nodeData.id)?.node;
    const next: BoardNode = previous
      ? { ...structuredClone(previous), children: [] }
      : {
          id: nodeData.id,
          title: nodeData.topic || "新图卡",
          status: "draft",
          expanded: true,
          children: [],
        };
    next.expanded = nodeData.expanded ?? true;
    if (!previous && parent?.asset) {
      next.refs = [{ order: 1, source: "parent", usage: "" }];
    }
    next.children = (nodeData.children ?? []).map((child: MindNodeObj) =>
      rebuild(child, next),
    );
    return next;
  };

  board.root = rebuild(data, null);
  normalizeClientBoard(board);
  renderBoard(board);
}

function handleNodeSelection(nodeId: string): void {
  if (!board) return;
  if (referenceTargetId && referenceTargetId !== nodeId) {
    const source = findNode(board, nodeId)?.node;
    if (!source?.asset) {
      showToast("只能引用已就绪的图片卡", true);
      return;
    }
    addReference(referenceTargetId, nodeId, "");
    referenceTargetId = null;
    mapElement.classList.remove("reference-mode");
    setSaveState("已添加参考", "link");
    return;
  }

  selectedNodeId = nodeId;
  renderInspector();
}

function addReference(targetId: string, sourceId: string, usage: string): void {
  if (!board) return;
  const target = findNode(board, targetId);
  const source = findNode(board, sourceId)?.node;
  if (!target || !source?.asset || targetId === sourceId) {
    showToast("无法添加这条参考关系", true);
    renderBoard(board);
    return;
  }
  const refs = target.node.refs ?? [];
  const parentId = target.parent?.id;
  if (
    refs.some(
      (reference) =>
        reference.source === sourceId ||
        (reference.source === "parent" && parentId === sourceId),
    )
  ) {
    showToast("这张图已经在参考列表中");
    renderBoard(board);
    return;
  }
  if (refs.length >= 5) {
    showToast("单次生成最多使用 5 张参考图", true);
    renderBoard(board);
    return;
  }
  refs.push({
    order: refs.length + 1,
    source: sourceId,
    usage,
    refLineId: `ref-${sourceId}-${targetId}`,
  });
  target.node.refs = refs;
  normalizeClientBoard(board);
  selectedNodeId = targetId;
  renderBoard(board);
  queueSave();
}

function removeReference(targetId: string, sourceId: string): void {
  if (!board) return;
  const target = findNode(board, targetId)?.node;
  if (!target) return;
  target.refs = (target.refs ?? []).filter(
    (reference) => reference.source !== sourceId,
  );
  normalizeClientBoard(board);
  renderBoard(board);
  queueSave();
}

function updateReferenceUsage(
  targetId: string,
  sourceId: string,
  usage: string,
  refresh = true,
): void {
  if (!board) return;
  const target = findNode(board, targetId);
  const reference = target?.node.refs?.find(
    (item) =>
      item.source === sourceId ||
      (item.source === "parent" && target.parent?.id === sourceId),
  );
  if (!reference) return;
  reference.usage = usage;
  if (refresh) renderBoard(board);
  queueSave();
}

function inspectorHoldsFocus(): boolean {
  const active = document.activeElement;
  return (
    active !== null &&
    active !== inspectorContent &&
    inspectorContent.contains(active)
  );
}

function flushPendingInspectorRender(): void {
  if (!inspectorRenderPending || inspectorHoldsFocus()) return;
  renderInspector(inspectorHistoryOpen);
}

function renderInspector(historyOpen = false, preserveFocus = false): void {
  // Rendering replaces every field node. Doing that under a focused field
  // drops the caret and aborts an in-flight IME composition, so a background
  // refresh waits until the user has left the panel. Caller-initiated renders
  // pass preserveFocus=false and always run.
  if (preserveFocus && inspectorHoldsFocus()) {
    inspectorRenderPending = true;
    return;
  }
  inspectorRenderPending = false;
  inspectorHistoryOpen = historyOpen;

  if (!board) {
    inspectorContent.innerHTML = `<div class="loading-panel">${icon("loading", "spin")}<span>正在加载</span></div>`;
    return;
  }
  const location = selectedNodeId
    ? findNode(board, selectedNodeId)
    : undefined;
  if (!location || !location.parent) {
    inspectorTitle.textContent = "画板设置";
    inspectorContent.innerHTML = `
      <div class="field-group">
        <label for="style-note">全局风格设定</label>
        <textarea id="style-note" rows="6" placeholder="画板级风格约束">${escapeHtml(board.styleNote)}</textarea>
      </div>
      <div class="board-meta">
        <span>${board.id}</span>
        <span>${flattenBoard(board.root).size - 1} 张图卡</span>
      </div>
    `;
    const styleNote =
      inspectorContent.querySelector<HTMLTextAreaElement>("#style-note")!;
    styleNote.addEventListener("input", () => {
      if (!board) return;
      board.styleNote = styleNote.value;
      queueSave();
    });
    return;
  }

  const node = location.node;
  const refs = referencesForNode(board, node);
  const history = Object.entries(board.requests)
    .filter(([, request]) => request.nodeId === node.id)
    .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt));

  inspectorTitle.textContent = node.title || "未命名图卡";
  inspectorContent.innerHTML = `
    <div class="field-group">
      <label for="node-title">标题</label>
      <input id="node-title" value="${escapeHtml(node.title)}" maxlength="200" />
    </div>
    <div class="field-group">
      <label for="node-prompt">生成提示词</label>
      <textarea id="node-prompt" rows="5">${escapeHtml(node.prompt ?? "")}</textarea>
    </div>
    <div class="field-group">
      <label for="node-note">本卡备注</label>
      <textarea id="node-note" rows="3">${escapeHtml(node.note ?? "")}</textarea>
    </div>
    <section class="reference-section" aria-labelledby="reference-title">
      <div class="section-heading">
        <h3 id="reference-title">参考图</h3>
        <span>${refs.length}/5</span>
      </div>
      <div class="reference-list">
        ${
          refs.length
            ? refs
                .map(
                  ({ sourceNode, reference }) => `
                    <div class="reference-item">
                      <div class="reference-preview">
                        ${sourceNode.asset ? `<img data-asset="${escapeHtml(sourceNode.asset)}" alt="" loading="lazy" />` : icon("imagePlus")}
                      </div>
                      <div class="reference-name">
                        <span class="reference-index">图${reference.order}</span>
                        <strong>${escapeHtml(sourceNode.title)}</strong>
                      </div>
                      <label class="sr-only" for="usage-${escapeHtml(sourceNode.id)}">图${reference.order}取用说明</label>
                      <input id="usage-${escapeHtml(sourceNode.id)}" data-reference-source="${escapeHtml(sourceNode.id)}" value="${escapeHtml(reference.usage)}" placeholder="取用说明" />
                      ${
                        reference.source === "parent"
                          ? ""
                          : `<button type="button" class="icon-button danger-button" data-remove-reference="${escapeHtml(sourceNode.id)}" aria-label="移除图${reference.order}" title="移除参考">${icon("trash")}</button>`
                      }
                    </div>
                  `,
                )
                .join("")
            : `<p class="empty-copy">没有参考图</p>`
        }
      </div>
      <button type="button" class="secondary-button full-button" id="pick-reference">${icon("link")}添加参考图</button>
    </section>
    <section class="history-section" aria-labelledby="history-title">
      <button type="button" class="disclosure-button" id="history-toggle" aria-expanded="${historyOpen}">
        <span>${icon("history")}<strong id="history-title">生成历史</strong></span>
        <span>${history.length}</span>
      </button>
      <div class="history-list" ${historyOpen ? "" : "hidden"}>
        ${
          history.length
            ? history.map(([id, request]) => renderHistory(id, request)).join("")
            : `<p class="empty-copy">暂无生成记录</p>`
        }
      </div>
    </section>
    <button type="button" class="primary-button full-button" id="generate-selected">${icon(node.status === "error" ? "refresh" : "sparkles")}${node.status === "error" ? "重试生成" : "生成图片"}</button>
    ${node.error ? `<p class="inline-error" role="alert">${icon("alert")}${escapeHtml(node.error)}</p>` : ""}
  `;

  bindInspectorFields(node, historyOpen);
}

function renderHistory(id: string, request: GenerationRecord): string {
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(request.createdAt));
  return `
    <article class="history-item">
      <div><strong>${escapeHtml(id)}</strong><span>${date}</span></div>
      <span class="history-status status-${request.status}">${escapeHtml(request.status)}</span>
    </article>
  `;
}

function bindInspectorFields(node: BoardNode, historyOpen: boolean): void {
  const title = inspectorContent.querySelector<HTMLInputElement>("#node-title")!;
  const prompt =
    inspectorContent.querySelector<HTMLTextAreaElement>("#node-prompt")!;
  const note =
    inspectorContent.querySelector<HTMLTextAreaElement>("#node-note")!;
  bindComposedInput(title, () => {
    node.title = title.value;
    queueSave(true);
  });
  bindComposedInput(prompt, () => {
    node.prompt = prompt.value;
    queueSave(true);
  });
  bindComposedInput(note, () => {
    node.note = note.value;
    queueSave();
  });
  inspectorContent
    .querySelectorAll<HTMLInputElement>("[data-reference-source]")
    .forEach((input) => {
      bindComposedInput(input, () => {
        updateReferenceUsage(
          node.id,
          input.dataset.referenceSource!,
          input.value,
          false,
        );
      });
    });
  inspectorContent
    .querySelectorAll<HTMLButtonElement>("[data-remove-reference]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        removeReference(node.id, button.dataset.removeReference!);
      });
    });
  inspectorContent
    .querySelector<HTMLButtonElement>("#pick-reference")
    ?.addEventListener("click", () => beginReferencePick(node.id));
  inspectorContent
    .querySelector<HTMLButtonElement>("#history-toggle")
    ?.addEventListener("click", () => renderInspector(!historyOpen));
  inspectorContent
    .querySelector<HTMLButtonElement>("#generate-selected")
    ?.addEventListener("click", () => void generateNode(node.id));
}

function beginReferencePick(targetId: string): void {
  referenceTargetId = targetId;
  mapElement.classList.add("reference-mode");
  setSaveState("选择参考来源", "link");
  setPanelOpen(false);
  const target = mapElement.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(targetId)}"]`,
  );
  target?.focus();
}

function queueSave(refreshCards = false, immediate = false): void {
  if (!board) return;
  saveRevision += 1;
  refreshAfterSave ||= refreshCards;
  window.clearTimeout(saveTimer);
  setSaveState("未保存");
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void flushSave().catch(() => undefined);
  }, immediate ? 0 : 500);
}

function hasPendingSave(): boolean {
  return saveRevision > persistedRevision || saveInFlight !== null;
}

async function flushSave(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!board || saveRevision <= persistedRevision) return;

  if (saveInFlight) {
    saveRequested = true;
    await saveInFlight;
    if (saveRevision > persistedRevision) await flushSave();
    return;
  }

  const revision = saveRevision;
  const boardId = board.id;
  const shouldRefresh = refreshAfterSave;
  const patch = structuredClone({
    title: board.title,
    styleNote: board.styleNote,
    root: board.root,
  });
  refreshAfterSave = false;

  const task = (async () => {
    try {
      // Writing before the server is rebound would persist this board into the
      // fallback project root instead of the one it came from.
      await ensureBoardBinding();
      const result = await bridge.callTool<{ board: Board }>(
        "mindart_update_board",
        {
          board_id: boardId,
          patch,
        },
      );
      persistedRevision = Math.max(persistedRevision, revision);
      if (board?.id === boardId && saveRevision === revision) {
        board = normalizeClientBoard(result.board);
        if (shouldRefresh) renderBoard(board);
      } else if (shouldRefresh) {
        refreshAfterSave = true;
      }
      setSaveState(
        saveRevision === persistedRevision ? "已保存" : "未保存",
        saveRevision === persistedRevision ? "check" : undefined,
      );
    } catch (error) {
      refreshAfterSave ||= shouldRefresh;
      setSaveState("保存失败", "alert");
      showToast(errorMessage(error), true);
      throw error;
    }
  })();

  saveInFlight = task;
  try {
    await task;
  } finally {
    saveInFlight = null;
  }

  if (saveRequested || saveRevision > persistedRevision) {
    saveRequested = false;
    await flushSave();
  }
}

async function generateNode(nodeId: string): Promise<void> {
  if (!board) return;
  try {
    await flushSave();
    if (!board) return;
    setSaveState("正在提交", "loading");
    const request = buildGenerationInput(board, nodeId);
    const result = await bridge.callTool<{
      board: Board;
      requestId: string;
      compiledPrompt: string;
    }>("mindart_request_generation", {
      board_id: board.id,
      node_id: nodeId,
      request,
    });
    renderBoard(result.board);
    await bridge.sendGenerationRequest(result.compiledPrompt);
    setSaveState("已交给宿主生成", "check");
    showToast(`已提交 ${result.requestId}`);
  } catch (error) {
    setSaveState("提交失败", "alert");
    showToast(errorMessage(error), true);
  }
}

function hydrateAssets(): void {
  if (!board) return;
  assetObserver?.disconnect();
  assetObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        assetObserver?.unobserve(entry.target);
        void loadImage(entry.target as HTMLImageElement);
      });
    },
    { root: null, rootMargin: "240px" },
  );
  appRoot.querySelectorAll<HTMLImageElement>("img[data-asset]").forEach((image) => {
    const asset = image.dataset.asset!;
    const cached = assetCache.get(`${board!.id}\0${asset}`);
    if (cached) image.src = cached;
    else assetObserver?.observe(image);
  });
}

/**
 * The server keeps its project root in memory and only ever sets it from
 * `mindart_open_canvas`. A resumed session restores the canvas from a replayed
 * tool result without calling anything, so a freshly spawned server is still
 * rooted at whatever `process.cwd()` implied — usually the ~/Documents
 * fallback. Every board-scoped call would then read, and write, the wrong
 * directory. Re-open the board once per connection to rebind it.
 */
async function ensureBoardBinding(): Promise<void> {
  if (!boardBinding) {
    const boardId = board?.id;
    const projectRoot = knownProjectRoot;
    if (!boardId || !projectRoot) return;
    boardBinding = bridge
      .callTool<{ board?: Board }>("mindart_open_canvas", {
        board_id: boardId,
        project_dir: projectRoot,
      })
      .then((result) => {
        // The replayed result froze when its tool ran, so anything added after
        // that — imports, generated cards — is missing from what the canvas
        // just rendered. This call answers with the board as it stands now.
        // Local edits still on their way to disk outrank it.
        if (result.board && !hasPendingSave() && board?.id === boardId) {
          renderBoard(result.board);
        }
      })
      .catch((error) => {
        boardBinding = null;
        throw error;
      });
  }
  await boardBinding;
}

const ASSET_RETRY_DELAYS_MS = [400, 1200, 3000];

async function loadImage(image: HTMLImageElement, attempt = 0): Promise<void> {
  if (!board) return;
  const boardId = board.id;
  const asset = image.dataset.asset;
  if (!asset) return;
  try {
    await ensureBoardBinding();
    const result = await bridge.callTool<{
      path: string;
      mimeType: string;
      data: string;
    }>("mindart_read_asset", { board_id: boardId, path: asset });
    // callTool answers {} when a result carries no structured content, and
    // interpolating that yields "data:undefined;base64,undefined" — a src the
    // browser rejects silently, with no error to retry on or report.
    if (!result.mimeType || !result.data) {
      throw new Error(
        `Asset response for ${asset} carried no image data (mimeType=${String(result.mimeType)}, bytes=${result.data?.length ?? 0}).`,
      );
    }
    const dataUrl = `data:${result.mimeType};base64,${result.data}`;
    assetCache.set(`${boardId}\0${asset}`, dataUrl);
    if (board?.id !== boardId) return;
    image.closest(".image-card")?.classList.remove("asset-error");
    appRoot
      .querySelectorAll<HTMLImageElement>(
        `img[data-asset="${CSS.escape(asset)}"]`,
      )
      .forEach((target) => {
        target.src = dataUrl;
      });
  } catch (error) {
    // The observer unobserved this image before calling us, so without a retry
    // one failure leaves the card broken for the rest of the session.
    const delay = ASSET_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined && board?.id === boardId && image.isConnected) {
      window.setTimeout(() => {
        void loadImage(image, attempt + 1);
      }, delay);
      return;
    }
    const card = image.closest(".image-card");
    card?.classList.add("asset-error");
    // Swallowing this entirely is why "图片加载失败" was undiagnosable.
    card?.setAttribute("title", errorMessage(error));
    console.error(`mindart: failed to load ${asset}`, error);
  }
}

function schedulePolling(): void {
  window.clearTimeout(pollTimer);
  if (!board) return;
  const pending = Object.values(board.requests).some((request) =>
    ["queued", "generating"].includes(request.status),
  );
  if (!pending) return;
  pollTimer = window.setTimeout(async () => {
    if (!board) return;
    if (hasPendingSave()) {
      schedulePolling();
      return;
    }
    try {
      await ensureBoardBinding();
      const result = await bridge.callTool<{ board: Board }>(
        "mindart_get_board",
        { board_id: board.id },
      );
      renderBoard(result.board);
    } catch {
      schedulePolling();
    }
  }, 3_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return fileName.includes(".") ? extension : "";
}

function isSupportedImage(file: File): boolean {
  return (
    SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase()) ||
    SUPPORTED_IMAGE_EXTENSIONS.has(fileExtension(file.name))
  );
}

function titleFromFileName(fileName: string): string {
  const extension = fileExtension(fileName);
  return extension ? fileName.slice(0, -(extension.length + 1)) : fileName;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("无法读取图片"));
        return;
      }
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new Error("无法读取图片"));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

function setImportBusy(busy: boolean): void {
  importInFlight = busy;
  imageFileInput.disabled = busy;
  const menuItem = nodeContextMenu.querySelector<HTMLButtonElement>(
    '[data-menu-action="add-image-child"]',
  );
  if (menuItem) menuItem.disabled = busy;
}

async function importImageFiles(fileList: FileList | File[]): Promise<void> {
  if (importInFlight) {
    showToast("图片正在导入");
    return;
  }
  if (!board) {
    showToast("画板尚未加载", true);
    return;
  }

  const files = Array.from(fileList);
  const supported = files.filter(isSupportedImage);
  const oversized = supported.filter(
    (file) => file.size > MAX_IMPORT_FILE_BYTES,
  );
  const importable = supported.filter(
    (file) => file.size <= MAX_IMPORT_FILE_BYTES,
  );

  if (!importable.length) {
    const message = oversized.length
      ? "图片需小于 20 MB"
      : "请选择 PNG、JPG、WebP、GIF、AVIF 或 SVG 图片";
    showToast(message, true);
    return;
  }

  const parentNodeId =
    pendingImportParentNodeId ?? selectedNodeId ?? board.root.id;
  pendingImportParentNodeId = null;
  const failures: string[] = [];
  let imported = 0;
  let latestBoard = board;
  let latestNodeId = selectedNodeId;

  setImportBusy(true);
  showToast(
    importable.length === 1
      ? `正在导入 ${importable[0]!.name}`
      : `正在导入 ${importable.length} 张图片`,
  );

  try {
    await flushSave();
    for (const file of importable) {
      try {
        const result = await bridge.callTool<{ board: Board; nodeId: string }>(
          "mindart_import_image",
          {
            board_id: latestBoard.id,
            image_data: await readFileAsBase64(file),
            file_name: file.name,
            ...(file.type ? { mime_type: file.type } : {}),
            ...(parentNodeId ? { parent_node_id: parentNodeId } : {}),
            title: titleFromFileName(file.name) || "素材图",
          },
        );
        latestBoard = result.board;
        latestNodeId = result.nodeId;
        imported += 1;
      } catch (error) {
        failures.push(`${file.name}：${errorMessage(error)}`);
      }
    }

    if (imported) {
      selectedNodeId = latestNodeId;
      renderBoard(latestBoard);
    }

    const skipped = files.length - importable.length;
    if (failures.length || skipped) {
      const detail = failures[0] ?? `${skipped} 个文件格式不受支持或超过 20 MB`;
      showToast(
        imported ? `已导入 ${imported} 张；${detail}` : detail,
        true,
      );
    } else {
      showToast(
        imported === 1 ? `已导入 ${importable[0]!.name}` : `已导入 ${imported} 张图片`,
      );
    }
  } finally {
    setImportBusy(false);
  }
}

function dragContainsFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.items ?? []).some(
    (item) => item.kind === "file",
  );
}

function demoBoard(): Board {
  return {
    version: 1,
    id: "board-demo",
    title: "夜行角色概念",
    styleNote: "东方志怪角色，电影级柔光，克制配色，材质细节清晰",
    root: {
      id: "root",
      title: "夜行角色概念",
      expanded: true,
      children: [
        {
          id: "body",
          title: "引魂灯完稿",
          status: "ready",
          asset: "assets/demo-body.png",
          expanded: true,
          children: [
            {
              id: "result",
              title: "图片生成",
              status: "draft",
              prompt: "设计一个新的夜行角色，参考图1的体型，图2的青绿色配色",
              note: "斗篷边缘保留磨损，背景保持干净",
              refs: [
                { order: 1, source: "parent", usage: "体型与轮廓" },
                {
                  order: 2,
                  source: "palette",
                  usage: "青绿色配色",
                  refLineId: "ref-palette-result",
                },
              ],
              children: [],
            },
          ],
        },
        {
          id: "palette",
          title: "赌翁完稿",
          status: "ready",
          asset: "assets/demo-palette.png",
          expanded: true,
          children: [],
        },
      ],
    },
    refLines: [
      { id: "ref-palette-result", from: "palette", to: "result" },
    ],
    requests: {},
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:01:00.000Z",
  };
}

function setContextMenuItemVisible(action: string, visible: boolean): void {
  const item = nodeContextMenu.querySelector<HTMLButtonElement>(
    `[data-menu-action="${action}"]`,
  );
  if (item) item.hidden = !visible;
}

function stopMindShortcutPropagation(event: KeyboardEvent): void {
  event.stopPropagation();
}

function bindCardControlKeys(): void {
  mapElement
    .querySelectorAll<HTMLElement>("input, textarea, button, select")
    .forEach((control) => {
      control.addEventListener("keydown", stopMindShortcutPropagation);
    });
}

function createNamedMindNode(title: string): MindNodeObj | undefined {
  if (!mind) return undefined;
  return {
    ...mind.generateNewObj(),
    topic: title,
  } as MindNodeObj;
}

async function addNamedChild(
  topic = mind?.currentNode ?? undefined,
): Promise<void> {
  if (!mind || !topic) return;
  const node = createNamedMindNode("新子级图卡");
  if (node) await mind.addChild(topic, node);
}

async function insertNamedParent(
  topic = mind?.currentNode ?? undefined,
): Promise<void> {
  if (!mind || !topic || topic.nodeObj.id === board?.root.id) return;
  const node = createNamedMindNode("新父级图卡");
  if (node) await mind.insertParent(topic, node);
}

function closeNodeContextMenu(restoreFocus = false): void {
  if (nodeContextMenu.hidden) return;
  nodeContextMenu.hidden = true;
  contextMenuNodeId = null;
  if (restoreFocus) contextMenuReturnFocus?.focus();
  contextMenuReturnFocus = null;
}

function openNodeContextMenu(event: MouseEvent, nodeId: string): void {
  if (!board || !mind) return;
  const card = mapElement.querySelector<HTMLElement>(
    `[data-node-id="${CSS.escape(nodeId)}"]`,
  );
  if (!card) return;

  event.preventDefault();
  event.stopPropagation();
  closeNodeContextMenu();

  const topic = mind.findEle(nodeId);
  mind.selectNode(topic);
  handleNodeSelection(nodeId);
  contextMenuNodeId = nodeId;
  contextMenuReturnFocus = card;

  const isRoot = nodeId === board.root.id;
  const hasAsset = Boolean(findNode(board, nodeId)?.node.asset);
  setContextMenuItemVisible("add-parent", !isRoot);
  setContextMenuItemVisible("reveal-finder", hasAsset);
  setContextMenuItemVisible("reveal-browser", hasAsset);
  setContextMenuItemVisible("add-reference", !isRoot);
  setContextMenuItemVisible("focus", !isRoot && !mind.isFocusMode);
  setContextMenuItemVisible("cancel-focus", mind.isFocusMode);
  setContextMenuItemVisible("delete", !isRoot);

  nodeContextMenu.hidden = false;
  const menuRect = nodeContextMenu.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const requestedX = event.clientX || cardRect.left + 20;
  const requestedY = event.clientY || cardRect.top + 20;
  const gutter = 8;
  nodeContextMenu.style.left = `${Math.max(gutter, Math.min(requestedX, window.innerWidth - menuRect.width - gutter))}px`;
  nodeContextMenu.style.top = `${Math.max(gutter, Math.min(requestedY, window.innerHeight - menuRect.height - gutter))}px`;
  nodeContextMenu
    .querySelector<HTMLButtonElement>("button:not([hidden]):not(:disabled)")
    ?.focus();
}

function openImagePickerForNode(nodeId: string): void {
  if (importInFlight) {
    showToast("图片正在导入");
    return;
  }
  pendingImportParentNodeId = nodeId;
  selectedNodeId = nodeId;
  imageFileInput.value = "";
  imageFileInput.click();
}

async function revealNodeAsset(
  nodeId: string,
  mode: "finder" | "browser",
): Promise<void> {
  if (!board) return;
  const asset = findNode(board, nodeId)?.node.asset;
  if (!asset) {
    showToast("这张图卡还没有图片");
    return;
  }
  await ensureBoardBinding();
  await bridge.callTool("mindart_reveal_asset", {
    board_id: board.id,
    path: asset,
    mode,
  });
}

async function runContextMenuAction(action: string): Promise<void> {
  if (!mind || !contextMenuNodeId) return;
  const nodeId = contextMenuNodeId;
  const topic = mind.findEle(nodeId);
  closeNodeContextMenu();

  if (action === "add-child") {
    await addNamedChild(topic);
    return;
  }
  if (action === "add-parent") {
    await insertNamedParent(topic);
    return;
  }
  if (action === "add-image-child") {
    openImagePickerForNode(nodeId);
    return;
  }
  if (action === "reveal-finder" || action === "reveal-browser") {
    await revealNodeAsset(
      nodeId,
      action === "reveal-finder" ? "finder" : "browser",
    );
    return;
  }
  if (action === "add-reference") {
    beginReferencePick(nodeId);
    return;
  }
  if (action === "focus") {
    mind.focusNode(topic);
    return;
  }
  if (action === "cancel-focus") {
    mind.cancelFocus();
    return;
  }
  if (action === "delete") {
    await mind.removeNodes([topic]);
  }
}

mapElement.addEventListener("contextmenu", (event) => {
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>("[data-node-id]");
  if (!card) return;
  openNodeContextMenu(event, card.dataset.nodeId!);
});

nodeContextMenu.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-menu-action]",
  );
  if (!button || button.disabled) return;
  void runContextMenuAction(button.dataset.menuAction!).catch((error) => {
    showToast(errorMessage(error), true);
  });
});

nodeContextMenu.addEventListener("keydown", (event) => {
  const items = Array.from(
    nodeContextMenu.querySelectorAll<HTMLButtonElement>(
      "button:not([hidden]):not(:disabled)",
    ),
  );
  const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
  let nextIndex: number | undefined;

  if (event.key === "ArrowDown") {
    nextIndex = (currentIndex + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeNodeContextMenu(true);
    return;
  } else if (event.key === "Tab") {
    closeNodeContextMenu();
    return;
  }

  if (nextIndex !== undefined) {
    event.preventDefault();
    items[nextIndex]?.focus();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (
    !nodeContextMenu.hidden &&
    !nodeContextMenu.contains(event.target as Node)
  ) {
    closeNodeContextMenu();
  }
});

mapElement.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const card = target.closest<HTMLElement>("[data-node-id]");
  if (!card) return;
  const nodeId = card.dataset.nodeId!;
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!action) {
    handleNodeSelection(nodeId);
    return;
  }
  if (action === "add-reference") beginReferencePick(nodeId);
  if (action === "generate") void generateNode(nodeId);
  if (action === "reference-detail") {
    selectedNodeId = nodeId;
    renderInspector();
    setPanelOpen(true);
  }
  if (action === "history") {
    selectedNodeId = nodeId;
    renderInspector(true);
    setPanelOpen(true);
  }
});

mapElement.addEventListener("input", (event) => {
  if (!board) return;
  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  const card = target.closest<HTMLElement>("[data-node-id]");
  const node = card ? findNode(board, card.dataset.nodeId!)?.node : undefined;
  if (!node) return;
  if (target.dataset.action === "title") node.title = target.value;
  if (target.dataset.action === "prompt") node.prompt = target.value;
  selectedNodeId = node.id;
  queueSave();
});

mapElement.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement;
  if (target.matches("input, textarea, button, select")) {
    event.stopPropagation();
  }
  if (event.key === "Escape" && referenceTargetId) {
    referenceTargetId = null;
    mapElement.classList.remove("reference-mode");
    setSaveState("");
  }
});

mapElement.addEventListener("focusout", (event) => {
  if ((event.target as HTMLElement).matches("input, textarea")) {
    void flushSave().catch(() => undefined);
  }
});

boardTitleInput.addEventListener("input", () => {
  if (!board) return;
  board.title = boardTitleInput.value || "未命名画板";
  board.root.title = board.title;
  queueSave(true);
});
boardTitleInput.addEventListener("blur", () => {
  void flushSave().catch(() => undefined);
});
inspectorContent.addEventListener("focusout", (event) => {
  if ((event.target as HTMLElement).matches("input, textarea")) {
    void flushSave().catch(() => undefined);
  }
  // focusout runs before the next element takes focus, so settle first and
  // only then apply a render that was deferred while a field was focused.
  window.setTimeout(flushPendingInspectorRender, 0);
});

document.querySelector("#fit-button")?.addEventListener("click", () => {
  mind?.scaleFit();
});
document.querySelector("#fullscreen-button")?.addEventListener("click", () => {
  void bridge.toggleFullscreen().catch((error) => showToast(errorMessage(error), true));
});
imageFileInput.addEventListener("change", () => {
  if (imageFileInput.files?.length) {
    void importImageFiles(imageFileInput.files);
  } else {
    pendingImportParentNodeId = null;
  }
});

window.addEventListener("dragenter", (event) => {
  if (!dragContainsFiles(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  imageDropOverlay.hidden = false;
});
window.addEventListener("dragover", (event) => {
  if (!dragContainsFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  if (!fileDragDepth) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) imageDropOverlay.hidden = true;
});
window.addEventListener("drop", (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  event.preventDefault();
  fileDragDepth = 0;
  imageDropOverlay.hidden = true;
  pendingImportParentNodeId = null;
  void importImageFiles(files);
});
window.addEventListener("paste", (event) => {
  const files = Array.from(event.clipboardData?.files ?? []).filter(
    isSupportedImage,
  );
  if (!files.length) return;
  event.preventDefault();
  pendingImportParentNodeId = null;
  void importImageFiles(files);
});
window.addEventListener("pagehide", () => {
  void flushSave().catch(() => undefined);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void flushSave().catch(() => undefined);
  }
});

function setPanelOpen(open: boolean): void {
  panelOpen = open;
  inspector.hidden = !open;
  inspectorScrim.hidden = !open;
  panelButton.innerHTML = icon(panelOpen ? "panelClose" : "panelOpen");
  panelButton.ariaLabel = panelOpen ? "关闭详情面板" : "打开详情面板";
  panelButton.title = panelButton.ariaLabel;
}

panelButton.addEventListener("click", () => {
  setPanelOpen(!panelOpen);
});
inspectorClose.addEventListener("click", () => setPanelOpen(false));
inspectorScrim.addEventListener("click", () => setPanelOpen(false));

bridge.onResult = (payload: StructuredResult) => {
  // mindart_open_canvas reports the root it resolved. On resume this replayed
  // value is the only record of where the board lives, so keep it.
  if (typeof payload.projectRoot === "string" && payload.projectRoot) {
    if (payload.projectRoot !== knownProjectRoot) boardBinding = null;
    knownProjectRoot = payload.projectRoot;
  }
  const nextBoard = payload.board;
  if (nextBoard && typeof nextBoard === "object") {
    if (hasPendingSave()) {
      schedulePolling();
      return;
    }
    renderBoard(nextBoard as Board);
    // A stale snapshot can be a bare root with no images at all, in which case
    // nothing would lazily trigger the rebinding. Ask for the live board now.
    void ensureBoardBinding().catch((error) => {
      showToast(errorMessage(error), true);
    });
  }
};
bridge.onError = (error) => showToast(errorMessage(error), true);

renderInspector();
if (new URLSearchParams(window.location.search).get("demo") === "1") {
  assetCache.set(
    "board-demo\0assets/demo-body.png",
    demoBodyUrl,
  );
  assetCache.set(
    "board-demo\0assets/demo-palette.png",
    demoPaletteUrl,
  );
  renderBoard(demoBoard());
} else {
  bridge.connect().catch((error) => {
    showToast(errorMessage(error), true);
    setSaveState("连接失败", "alert");
  });
}
