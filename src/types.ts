/** 内置「便捷启动」分组 id，不出现在 `groups` 数组中，与 `dock` 同步 */
export const DOCK_GROUP_ID = "mountain-quick-launch";

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
  iconPath?: string;
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
