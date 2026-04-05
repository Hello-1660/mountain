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
