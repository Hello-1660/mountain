/**
 * 后端命令的唯一调用入口。
 *
 * 组件与 hooks 不再散落 `invoke("xxx")` 字符串：命令名与出入参类型集中在此，
 * 后端改命令名时只需改这一处。
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  AppCatalogDto,
  AppGroup,
  AppStore,
  DockItem,
  FileDetail,
  UpdateCheckDto,
  UsageSnapshot,
} from "../types";

export function loadStore(): Promise<AppStore> {
  return invoke<AppStore>("load_store");
}

export function saveStore(store: AppStore): Promise<void> {
  return invoke("save_store", { store });
}

export function newDockItem(path: string, title: string | null): Promise<DockItem> {
  return invoke<DockItem>("new_dock_item", { path, title });
}

export function newGroup(name: string): Promise<AppGroup> {
  return invoke<AppGroup>("new_group", { name });
}

export function fileDetail(path: string): Promise<FileDetail> {
  return invoke<FileDetail>("file_detail", { path });
}

export function launchApp(app: {
  path: string;
  shortcut?: string;
  workingDirectory?: string;
}): Promise<void> {
  return invoke("launch_app", {
    path: app.path,
    ...(app.shortcut ? { shortcut: app.shortcut } : {}),
    ...(app.workingDirectory ? { workingDirectory: app.workingDirectory } : {}),
  });
}

export function loadAppCatalog(): Promise<AppCatalogDto> {
  return invoke<AppCatalogDto>("load_app_catalog");
}

export function refreshAppCatalog(): Promise<AppCatalogDto> {
  return invoke<AppCatalogDto>("refresh_app_catalog");
}

export function addManualExecutable(path: string): Promise<AppCatalogDto> {
  return invoke<AppCatalogDto>("add_manual_executable", { path });
}

export function addManualExecutables(paths: string[]): Promise<AppCatalogDto> {
  return invoke<AppCatalogDto>("add_manual_executables", { paths });
}

export function removeApp(path: string): Promise<AppCatalogDto> {
  return invoke<AppCatalogDto>("remove_app", { path });
}

export function readIconDataUrl(path: string): Promise<string | null> {
  return invoke<string | null>("read_icon_data_url", { path });
}

export function pickExecutable(): Promise<string | null> {
  return invoke<string | null>("pick_executable");
}

export function pickExecutables(): Promise<string[]> {
  return invoke<string[]>("pick_executables");
}

export function loadUsageSnapshot(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("load_usage_snapshot");
}

export function removeUsageRecord(path: string): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("remove_usage_record", { path });
}

export function removeUsageRecords(paths: string[]): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("remove_usage_records", { paths });
}

export function clearUsageRecords(): Promise<UsageSnapshot> {
  return invoke<UsageSnapshot>("clear_usage_records");
}

export function checkGithubRelease(): Promise<UpdateCheckDto> {
  return invoke<UpdateCheckDto>("check_github_release");
}

export function downloadUpdate(url: string): Promise<string> {
  return invoke<string>("download_update", { url });
}

export function applyUpdateAndRestart(setupPath: string): Promise<void> {
  return invoke("apply_update_and_restart", { setupPath });
}

export function showLibraryWindow(): Promise<void> {
  return invoke("show_library_window");
}

export function fitDockSize(contentWidth: number): Promise<void> {
  return invoke("fit_dock_size", { contentWidth });
}
