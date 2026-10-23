//! 启动外部程序。Windows 下先尝试 CreateProcess，失败再退回 ShellExecute("open")。

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::platform::hide_console_for_child;
use crate::usage;

/// 确定子进程工作目录：优先快捷方式记录的「起始位置」，否则用 exe 所在目录
fn launch_cwd_for_exe(exe: &Path, working_dir: Option<&str>) -> Option<PathBuf> {
    let from_shortcut = working_dir
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    if from_shortcut.is_some() {
        return from_shortcut;
    }
    exe.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(PathBuf::from)
}

/// Windows：通过 `cmd /c start` 调用 ShellExecute("open") 启动程序。
/// 与「双击」等价，会按 exe 的清单自动请求 UAC 提权，适合需要管理员权限的程序。
#[cfg(target_os = "windows")]
fn shell_open(path: &str, working_dir: Option<&Path>) -> Result<(), String> {
    let mut cmd = Command::new("cmd");
    // `start "" <path>` 经由 ShellExecute("open") 启动；先给一个空标题占位，
    // 避免路径被误判为窗口标题。带空格的路径由 Rust 自动加引号。
    cmd.args(["/c", "start", "", path]);
    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }
    hide_console_for_child(&mut cmd);
    let out = cmd.output().map_err(|e| format!("启动失败: {e}"))?;
    if !out.status.success() {
        return Err(format!("启动失败 (code {:?})", out.status.code()));
    }
    Ok(())
}

#[tauri::command]
pub fn launch_app(
    app: tauri::AppHandle,
    path: String,
    working_directory: Option<String>,
    shortcut: Option<String>,
) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("路径为空".into());
    }
    // 优先快捷方式启动：保留 .lnk 内的参数/工作目录/兼容性设置
    let preferred = shortcut
        .as_deref()
        .map(str::trim)
        .filter(|s| s.to_lowercase().ends_with(".lnk") && Path::new(s).is_file())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string());
    let exe = Path::new(path);
    let wd = launch_cwd_for_exe(
        exe,
        working_directory
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    );

    #[cfg(target_os = "windows")]
    {
        // 先尝试 CreateProcess：文件不存在等错误能直接返回。
        // 若失败（如 .lnk 需 ShellExecute 解析、Geek Uninstaller 的 exe 带
        // requireAdministrator 清单会返回 ERROR_ELEVATION_REQUIRED=740），
        // 退回 ShellExecute("open")，与「双击」一致：按清单自动弹 UAC 提权启动。
        let mut cmd = Command::new(&preferred);
        if let Some(ref dir) = wd {
            cmd.current_dir(dir);
        }
        match cmd.spawn() {
            Ok(_) => {}
            Err(e) => match shell_open(&preferred, wd.as_deref()) {
                Ok(_) => {}
                Err(_) => return Err(format!("启动失败: {e}")),
            },
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut cmd = Command::new(path);
        if let Some(ref dir) = wd {
            cmd.current_dir(dir);
        }
        cmd.spawn().map_err(|e| format!("启动失败: {e}"))?;
    }

    if let Err(e) = usage::record_launch(&app, path) {
        eprintln!("record_launch: {e}");
    }
    Ok(())
}
