//! 启动使用记录（`usage.json`）：最近使用 / 启动最多的数据源。

use std::collections::HashSet;
use std::path::Path;

use crate::models::{FrequentEntry, UsageEntry, UsageFile, UsageSnapshotDto};
use crate::paths;
use crate::util::{now_unix_ms, read_json_file, write_json_file};
use tauri::Emitter;

pub fn load_file(app: &tauri::AppHandle) -> Result<UsageFile, String> {
    let p = paths::usage_path(app)?;
    if !p.exists() {
        return Ok(UsageFile::default());
    }
    read_json_file(&p)
}

pub fn save_file(app: &tauri::AppHandle, data: &UsageFile) -> Result<(), String> {
    let p = paths::usage_path(app)?;
    write_json_file(&p, data)
}

/// 记一次启动：计数 +1、刷新时间戳，并广播 `usage-updated`
pub fn record_launch(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(());
    }
    let key = path.to_lowercase();
    let mut file = load_file(app)?;
    let now = now_unix_ms();
    let entry = file.entries.entry(key).or_insert(UsageEntry {
        path: path.to_string(),
        launch_count: 0,
        last_used_ms: 0,
    });
    entry.path = path.to_string();
    entry.launch_count = entry.launch_count.saturating_add(1);
    entry.last_used_ms = now;
    save_file(app, &file)?;
    let _ = app.emit("usage-updated", ());
    Ok(())
}

#[tauri::command]
pub fn load_usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshotDto, String> {
    let file = load_file(&app)?;
    // 清理死记录：目标文件已删除/卸载的历史不再展示（图标会是占位符的那些）
    let values: Vec<UsageEntry> = file
        .entries
        .into_values()
        .filter(|e| Path::new(e.path.trim()).is_file())
        .collect();

    let mut by_recent = values.clone();
    by_recent.sort_by_key(|e| std::cmp::Reverse(e.last_used_ms));
    let recent_paths: Vec<String> = by_recent
        .into_iter()
        .take(40)
        .map(|e| e.path)
        .collect();

    let mut by_freq = values;
    by_freq.sort_by(|a, b| {
        b.launch_count
            .cmp(&a.launch_count)
            .then_with(|| b.last_used_ms.cmp(&a.last_used_ms))
    });
    let frequent_paths: Vec<FrequentEntry> = by_freq
        .into_iter()
        .take(40)
        .map(|e| FrequentEntry {
            path: e.path,
            count: e.launch_count,
        })
        .collect();

    Ok(UsageSnapshotDto {
        recent_paths,
        frequent_paths,
    })
}

/// 删除单条使用记录（最近使用 / 启动最多）
#[tauri::command]
pub fn remove_usage_record(
    app: tauri::AppHandle,
    path: String,
) -> Result<UsageSnapshotDto, String> {
    let key = path.trim().to_lowercase();
    let mut usage = load_file(&app)?;
    usage.entries.retain(|k, _| !k.eq_ignore_ascii_case(&key));
    save_file(&app, &usage)?;
    load_usage_snapshot(app)
}

/// 批量删除使用记录
#[tauri::command]
pub fn remove_usage_records(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<UsageSnapshotDto, String> {
    let set: HashSet<String> = paths.iter().map(|p| p.trim().to_lowercase()).collect();
    let mut usage = load_file(&app)?;
    usage.entries.retain(|k, _| !set.contains(&k.to_lowercase()));
    save_file(&app, &usage)?;
    load_usage_snapshot(app)
}

/// 清空全部使用记录
#[tauri::command]
pub fn clear_usage_records(app: tauri::AppHandle) -> Result<UsageSnapshotDto, String> {
    let mut usage = load_file(&app)?;
    usage.entries.clear();
    save_file(&app, &usage)?;
    load_usage_snapshot(app)
}
