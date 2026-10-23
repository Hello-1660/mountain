//! 文件选择对话框：手动添加应用到目录。

use tauri_plugin_dialog::DialogExt;

/// 手动添加：允许任意类型的可执行文件 / 脚本 / 链接文件（.lnk、硬链接、符号链接等），
/// 也允许「所有文件」以便选择没有常见扩展名的可执行体。
const PICKABLE_EXTENSIONS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "wsf", "lnk", "url", "py", "pyw",
    "jar", "appref-ms", "ahk", "sh",
];

#[tauri::command]
pub async fn pick_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter("可执行文件 / 脚本 / 链接", PICKABLE_EXTENSIONS)
        .add_filter("所有文件", &["*"])
        .blocking_pick_file();
    Ok(file.map(|f| f.to_string()))
}

/// 批量手动添加：一次多选多个文件
#[tauri::command]
pub async fn pick_executables(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let files = app
        .dialog()
        .file()
        .add_filter("可执行文件 / 脚本 / 链接", PICKABLE_EXTENSIONS)
        .add_filter("所有文件", &["*"])
        .blocking_pick_files();
    Ok(files
        .unwrap_or_default()
        .into_iter()
        .map(|f| f.to_string())
        .collect())
}
