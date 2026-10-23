//! 窗口相关的命令：便捷栏尺寸自适应、库窗口显示。

use tauri::Manager;

/// dock 窗口固定高度（px）。几何精算值：
/// 磁贴 74 + hover 放大 1.28×（94.72）+ 上移 5 + items 底留 8 = 111.72
/// （紧凑布局：磁贴间距 13px，放大边缘与相邻图标留 ~2.6px）
/// → items 113；strip padding 10 → 123；shell 底留 8 → 131，取 132 留 1px 抗锯齿余量。
const DOCK_WINDOW_HEIGHT: f64 = 136.0;

/// dock 内容与窗口边缘的水平余量合计（px）：
/// 两侧把手 28×2 + strip padding 5×2 + shell padding 10×2 = 86
const DOCK_CHROME_PADDING_X: f64 = 86.0;

/// 便捷栏宽度自适应：按前端测量的**内容真实宽度**（items.scrollWidth，
/// 不受窗口压缩影响，避免"窗口压内容→测不到真实宽→永远撑不大"的死锁）
/// 设置窗口尺寸；高度恒为 DOCK_WINDOW_HEIGHT。
/// 位置保持：宽度未变则完全不动窗口；宽度变化时以原窗口中心对称伸缩，
/// 不强制回屏幕中心——用户拖动过的位置不会因增删应用被重置。
#[tauri::command]
pub async fn fit_dock_size(app: tauri::AppHandle, content_width: f64) -> Result<(), String> {
    let w = app
        .get_webview_window("dock")
        .ok_or_else(|| "dock 窗口不存在".to_string())?;
    let monitor = w.current_monitor().map_err(|e| e.to_string())?;
    let (mw, _mh) = monitor
        .map(|m| {
            let s = m.size();
            (s.width as f64, s.height as f64)
        })
        .unwrap_or((1920.0, 1080.0));
    let width = (content_width + DOCK_CHROME_PADDING_X)
        .round()
        .max(320.0)
        .min(mw - 80.0);

    // 统一到物理像素：outer_size/outer_position 与 set_size/set_position 都在物理空间
    let scale = w.scale_factor().unwrap_or(1.0).max(0.5);
    let new_w_phys = (width * scale).round() as i32;
    let new_h_phys = (DOCK_WINDOW_HEIGHT * scale).round() as i32;
    let screen_w_phys = (mw * scale).round() as i32;

    let old_w_phys = w.outer_size().ok().map(|s| s.width as i32);
    let old_pos = w.outer_position().ok();

    w.set_size(tauri::PhysicalSize::new(new_w_phys, new_h_phys))
        .map_err(|e| e.to_string())?;

    if let (Some(ow), Some(op)) = (old_w_phys, old_pos) {
        let dw = new_w_phys - ow;
        if dw != 0 {
            // 以原窗口中心为基准对称伸缩：栏体视觉位置不跳
            let nx = (op.x as i32 - dw / 2)
                .max(0)
                .min((screen_w_phys - new_w_phys).max(0));
            let _ = w.set_position(tauri::PhysicalPosition::new(nx, op.y as i32));
        }
    }
    Ok(())
}

/// 异步打开库窗口：避免在 Windows/WebView2 上通过同步 command 操作窗口时卡住或无效；
/// 若启动时未注册到管理器，则按配置即时创建。
/// 托盘菜单与全局快捷键直接调用本函数，无需再走 IPC。
#[tauri::command]
pub async fn show_library_window(app: tauri::AppHandle) -> Result<(), String> {
    let w = if let Some(w) = app.get_webview_window("library") {
        w
    } else {
        let conf = app
            .config()
            .app
            .windows
            .iter()
            .find(|c| c.label.as_str() == "library")
            .ok_or_else(|| "配置中缺少 label 为 library 的窗口".to_string())?;
        tauri::WebviewWindowBuilder::from_config(&app, conf)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?
    };

    w.show().map_err(|e| e.to_string())?;
    let _ = w.unminimize();
    w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}
