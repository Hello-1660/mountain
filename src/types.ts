/** 内置「便捷启动」分组 id，不出现在 `groups` 数组中，与 `dock` 同步 */
export const DOCK_GROUP_ID = "mountain-quick-launch";

/** 按最近启动时间排序的虚拟分组 */
export const RECENT_GROUP_ID = "mountain-recent";

/** 按启动次数排序的虚拟分组 */
export const FREQUENT_GROUP_ID = "mountain-frequent";

export interface DockItem {
  id: string;
  path: string;
  title: string;
  iconPath?: string;
}

export interface AppGroup {
  id: string;
  name: string;
  paths: string[];
}

export interface AppStore {
  dock: DockItem[];
  groups: AppGroup[];
}

/** 库界面用：去掉误写入的「便捷启动」伪分组，与 `dock` 一致 */
export function normalizeLibraryStore(s: AppStore): AppStore {
  return {
    ...s,
    groups: (s.groups ?? []).filter((g) => g.id !== DOCK_GROUP_ID),
  };
}

export interface ScannedApp {
  name: string;
  path: string;
  shortcut?: string;
  /** 开始菜单快捷方式「起始位置」，与 Rust/catalog JSON 字段一致 */
  workingDirectory?: string;
  iconPath?: string;
  /** 手动添加进目录，重新扫描时会保留 */
  manual?: boolean;
}

export interface AppCatalogDto {
  apps: ScannedApp[];
  scannedAt: number | null;
}

export interface FileDetail {
  path: string;
  name: string;
  sizeBytes: number;
  exists: boolean;
}

export interface UsageSnapshot {
  recentPaths: string[];
  frequentPaths: string[];
}

export interface UpdateCheckDto {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  releaseUrl: string | null;
  releaseNotes: string | null;
  fetchError: string | null;
}
