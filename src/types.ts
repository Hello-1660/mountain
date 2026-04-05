export interface DockItem {
  id: string;
  path: string;
  title: string;
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
}

export interface FileDetail {
  path: string;
  name: string;
  sizeBytes: number;
  exists: boolean;
}
