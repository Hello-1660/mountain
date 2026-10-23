//! 系统托盘图标与右键菜单。

use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

use crate::windows::show_library_window;

/// 建立托盘图标；无内嵌窗口图标时跳过（不影响主窗口）
pub fn setup_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let menu = MenuBuilder::new(app)
        .text("library", "打开全部应用")
        .separator()
        .text("toggle_dock", "显示/隐藏 dock 栏")
        .separator()
        .text("quit", "退出 Mountain")
        .build()
        .map_err(|e| format!("构建托盘菜单失败: {e}"))?;

    let Some(icon) = app.default_window_icon().cloned() else {
        eprintln!("Mountain: 无内嵌窗口图标，跳过系统托盘");
        return Ok(());
    };

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("Mountain 启动器 — 右键菜单可退出")
        .menu(&menu)
        .on_menu_event(|app, event| {
            if event.id == "library" {
                let h = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_library_window(h).await;
                });
            } else if event.id == "toggle_dock" {
                if let Some(w) = app.get_webview_window("dock") {
                    if w.is_visible().unwrap_or(true) {
                        let _ = w.hide();
                    } else {
                        let _ = w.show();
                    }
                }
            } else if event.id == "quit" {
                app.exit(0);
            }
        })
        .build(app)
        .map_err(|e| format!("构建托盘图标失败: {e}"))?;

    Ok(())
}
