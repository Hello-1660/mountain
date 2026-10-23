//! Mountain 启动器 —— 桌面便捷栏 + 全部应用库。
//!
//! 本文件只负责**装配**：插件、托盘、命令注册与主循环。
//! 具体业务能力分散在各职责模块中：
//!
//! | 模块 | 职责 |
//! | --- | --- |
//! | [`models`] | 前后端共享的数据模型（Serde DTO） |
//! | [`paths`] | 数据目录与持久化文件路径 |
//! | [`util`] | 时间戳、JSON 文件读写 |
//! | [`platform`] | Windows 平台细节（子进程窗口、dock 焦点行为） |
//! | [`store`] | `store.json`：便捷栏 / 分组 / 别名 / UI 开关 |
//! | [`catalog`] | `catalog.json`：开始菜单扫描、手动增删、移除黑名单 |
//! | [`usage`] | `usage.json`：最近使用 / 启动最多 |
//! | [`icons`] | 应用图标提取与缓存 |
//! | [`launcher`] | 启动外部程序 |
//! | [`files`] | 文件元数据查询 |
//! | [`picker`] | 文件选择对话框 |
//! | [`updater`] | GitHub Release 检查 / 下载 / 静默安装 |
//! | [`windows`] | 窗口控制（便捷栏自适应、库窗口显示） |
//! | [`tray`] | 系统托盘图标与菜单 |

mod catalog;
mod files;
mod icons;
mod launcher;
mod models;
mod paths;
mod picker;
mod platform;
mod store;
mod tray;
mod updater;
mod usage;
mod util;
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::Manager;

/// 登录/计划任务自启时传入；仅显示便捷栏，不打开「全部应用」窗口。
const AUTOSTART_ARG: &str = "--mountain-autostart";

/// 自启后仅在短时间内与 window-state 抢「隐藏 library」；超时后不再拦截，否则用户打开窗口会在下一帧被误关。
const AUTOSTART_SUPPRESS_LIBRARY_VISIBLE_SECS: u64 = 8;

/// 首次进入主循环时再 hide 一次 library，避免 window-state 在 Ready 之后把「全部应用」恢复成可见
static LIB_HIDE_AFTER_RESTORE: AtomicBool = AtomicBool::new(true);

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

/// 全局快捷键：随时呼出「全部应用」
const LIBRARY_SHORTCUT: &str = "Alt+Shift+M";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename("window-state.json")
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg(AUTOSTART_ARG)
                .app_name("Mountain 启动器")
                .build(),
        )
        .plugin(global_shortcut_plugin())
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                // 让「便捷启动」坞常驻屏幕最底层、不抢占焦点、不遮挡其他窗口
                platform::disable_dock_activation(app.handle());
                tray::setup_tray(app.handle())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store::load_store,
            store::save_store,
            store::new_dock_item,
            store::new_group,
            files::file_detail,
            launcher::launch_app,
            catalog::load_app_catalog,
            catalog::add_manual_executable,
            catalog::add_manual_executables,
            catalog::remove_app,
            catalog::refresh_app_catalog,
            icons::read_icon_data_url,
            picker::pick_executable,
            picker::pick_executables,
            windows::show_library_window,
            usage::load_usage_snapshot,
            usage::remove_usage_record,
            usage::remove_usage_records,
            usage::clear_usage_records,
            updater::check_github_release,
            updater::download_update,
            updater::apply_update_and_restart,
            windows::fit_dock_size,
        ])
        .build(context)
        .expect("error while building tauri application");

    app.run(|app, event| {
        match event {
            tauri::RunEvent::Ready => {
                PROCESS_START.get_or_init(Instant::now);
                if let Some(lib) = app.get_webview_window("library") {
                    let _ = lib.hide();
                }
            }
            tauri::RunEvent::MainEventsCleared => {
                if LIB_HIDE_AFTER_RESTORE.swap(false, Ordering::SeqCst) {
                    if let Some(lib) = app.get_webview_window("library") {
                        let _ = lib.hide();
                    }
                }
                if std::env::args().any(|a| a == AUTOSTART_ARG) {
                    let start = PROCESS_START.get_or_init(Instant::now);
                    if start.elapsed()
                        < Duration::from_secs(AUTOSTART_SUPPRESS_LIBRARY_VISIBLE_SECS)
                    {
                        if let Some(lib) = app.get_webview_window("library") {
                            if lib.is_visible().unwrap_or(false) {
                                let _ = lib.hide();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    });
}

/// 注册 Alt+Shift+M：注册失败时降级为无快捷键插件，不影响启动
fn global_shortcut_plugin() -> impl tauri::plugin::Plugin<tauri::Wry> {
    let kb = match tauri_plugin_global_shortcut::Builder::new().with_shortcut(LIBRARY_SHORTCUT) {
        Ok(b) => b.with_handler(|app, _shortcut, event| {
            use tauri_plugin_global_shortcut::ShortcutState;
            if event.state != ShortcutState::Pressed {
                return;
            }
            let h = app.clone();
            tauri::async_runtime::spawn(async move {
                let _ = windows::show_library_window(h).await;
            });
        }),
        Err(e) => {
            eprintln!("Mountain: 全局快捷键 {LIBRARY_SHORTCUT} 未注册：{e}");
            tauri_plugin_global_shortcut::Builder::new()
        }
    };
    kb.build()
}
