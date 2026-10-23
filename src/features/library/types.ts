/** 库窗口的视图模式（持久化在 localStorage） */
export type ViewMode = "grid" | "list";

/** 搜索域 id：`all` 或某个分组 id（含内置虚拟分组） */
export type ScopeId = string;

/**
 * 统一选中模型：全界面只有一个「当前选中」，可区分分组 / 应用。
 * 点击与键盘切换都只改这一个值，聚焦样式与快捷键分发都由它派生。
 */
export type Sel =
  | { kind: "group"; id: string }
  | { kind: "app"; path: string }
  | null;

/** 右键菜单的位置与关联应用 */
export interface ContextMenuState {
  path: string;
  x: number;
  y: number;
}

/** 右键菜单条目 */
export interface MenuItem {
  key: string;
  label: string;
  danger?: boolean;
  run: () => void;
}
