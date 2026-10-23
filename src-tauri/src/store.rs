//! 用户偏好存储（`store.json`）：便捷栏、分组、别名、界面开关。
//!
//! store 的任何变更都会通过 `store-updated` 事件广播，dock 与库窗口据此同步。

use std::path::Path;

use crate::icons;
use crate::models::{AppGroup, AppStore, DockItem};
use crate::paths;
use crate::util::{read_json_file, write_json_file};
use tauri::Emitter;
use uuid::Uuid;

pub fn load(app: &tauri::AppHandle) -> Result<AppStore, String> {
    let p = paths::store_path(app)?;
    if !p.exists() {
        return Ok(AppStore::default());
    }
    read_json_file(&p)
}

pub fn save(app: &tauri::AppHandle, store: &AppStore) -> Result<(), String> {
    let p = paths::store_path(app)?;
    write_json_file(&p, store)
}

#[tauri::command]
pub fn load_store(app: tauri::AppHandle) -> Result<AppStore, String> {
    load(&app)
}

/// 落盘并广播 `store-updated`，让 dock 与库窗口同步
#[tauri::command]
pub fn save_store(app: tauri::AppHandle, store: AppStore) -> Result<(), String> {
    save(&app, &store)?;
    let _ = app.emit("store-updated", store);
    Ok(())
}

#[tauri::command]
pub fn new_dock_item(app: tauri::AppHandle, path: String, title: Option<String>) -> DockItem {
    let p = path.trim().to_string();
    let title = title.unwrap_or_else(|| {
        Path::new(&p)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("应用")
            .to_string()
    });
    let icon_path = icons::ensure_icon_for_exe(&app, &p).unwrap_or(None);
    DockItem {
        id: Uuid::new_v4().to_string(),
        path: p,
        title,
        icon_path,
    }
}

#[tauri::command]
pub fn new_group(name: String) -> AppGroup {
    AppGroup {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        paths: Vec::new(),
    }
}
