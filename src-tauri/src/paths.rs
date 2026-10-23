//! 数据目录与各持久化文件的路径解析。
//!
//! 所有落盘位置都在 `app_data_dir()` 下，集中在一处便于升级/迁移时调整。

use std::fs;
use std::path::PathBuf;

use tauri::Manager;

/// 应用数据目录（不存在则创建）
pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("store.json"))
}

pub fn catalog_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("catalog.json"))
}

pub fn usage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("usage.json"))
}

pub fn icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("icons"))
}
