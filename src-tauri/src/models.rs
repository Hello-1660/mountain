//! 前后端共享的数据模型（Serde DTO）。
//!
//! 所有跨 IPC 边界传输的结构都集中在这里，方便与前端 `src/types.ts` 对照维护。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 界面显示开关（关闭只隐藏 UI，不影响记录）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibUiSettings {
    /// 显示「最近使用」（横带 + 搜索域）；关闭仅隐藏 UI，记录继续保存
    pub show_recent: bool,
    /// 显示「启动最多」（侧栏 + 搜索域）；关闭仅隐藏 UI，记录继续保存
    pub show_frequent: bool,
}

impl Default for LibUiSettings {
    fn default() -> Self {
        Self {
            show_recent: true,
            show_frequent: true,
        }
    }
}

/// 持久化到 `store.json` 的用户数据
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub dock: Vec<DockItem>,
    pub groups: Vec<AppGroup>,
    /// 应用路径（小写）→ 用户自定义别名；为空表示用扫描到的名称
    #[serde(default)]
    pub aliases: HashMap<String, String>,
    /// 界面显示开关（关闭只隐藏 UI，不影响记录）
    #[serde(default)]
    pub ui: LibUiSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockItem {
    pub id: String,
    pub path: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppGroup {
    pub id: String,
    pub name: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedApp {
    pub name: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
    /// 快捷方式指向的目标 exe（去重用：同一目标只保留快捷方式条目）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// 开始菜单 .lnk 的「起始位置」，部分程序依赖此目录才能启动
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    /// 用户「手动添加」写入目录；重新扫描开始菜单时会保留此类条目
    #[serde(default)]
    pub manual: bool,
}

/// 持久化到 `catalog.json` 的应用目录
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalogDto {
    #[serde(default)]
    pub apps: Vec<ScannedApp>,
    pub scanned_at: Option<i64>,
    /// 用户移除过的应用路径（小写）；重新扫描时不再出现，防止"移除后又回来"。
    /// 若用户「手动添加」同一路径，则视为恢复，从黑名单移除。
    #[serde(default)]
    pub removed: Vec<String>,
}

impl AppCatalogDto {
    pub fn empty() -> Self {
        Self {
            apps: vec![],
            scanned_at: None,
            removed: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub exists: bool,
}

/// `usage.json` 中的单条使用记录
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    pub path: String,
    pub launch_count: u32,
    pub last_used_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageFile {
    pub entries: HashMap<String, UsageEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequentEntry {
    pub path: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshotDto {
    pub recent_paths: Vec<String>,
    pub frequent_paths: Vec<FrequentEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckDto {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub fetch_error: Option<String>,
    /// 安装包直链（release assets 里的 x64 setup.exe），供应用内下载
    pub download_url: Option<String>,
}
