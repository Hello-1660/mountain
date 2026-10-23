//! 平台（Windows）相关的底层细节：子进程窗口抑制、dock 窗口的焦点行为。
//!
//! 非 Windows 平台提供等价的空实现，保证跨平台可编译。

use std::process::Command;

use tauri::Manager;

/// 避免从 GUI 主进程拉起 PowerShell 时短暂弹出黑色控制台窗口。
#[cfg(target_os = "windows")]
pub fn hide_console_for_child(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn hide_console_for_child(_cmd: &mut Command) {}

/// 让「便捷启动」坞常驻屏幕最底层、不抢占焦点、不遮挡其他窗口：
/// 给 dock 窗口加 `WS_EX_NOACTIVATE`，点击它不会使其成为前台窗口（不会跳到最前），
/// 配合配置里的 alwaysOnBottom(HWND_BOTTOM)，始终位于其他窗口之下。
#[cfg(target_os = "windows")]
pub fn disable_dock_activation(app: &tauri::AppHandle) {
    let Some(win) = app.get_webview_window("dock") else {
        return;
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
    };
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_NOACTIVATE.0 as isize);
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn disable_dock_activation(_app: &tauri::AppHandle) {}
