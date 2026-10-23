//! 应用内更新：GitHub Release 检查 → 下载安装包 → 静默覆盖安装并重启。

use serde::Deserialize;

use crate::models::UpdateCheckDto;
use crate::platform::hide_console_for_child;

const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/Hello-1660/mountain/releases/latest";

#[derive(Deserialize)]
struct GithubAssetJson {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GithubReleaseJson {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    assets: Vec<GithubAssetJson>,
}

#[tauri::command]
pub fn check_github_release() -> Result<UpdateCheckDto, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let mut out = UpdateCheckDto {
        current_version: current,
        latest_version: None,
        has_update: false,
        release_url: None,
        release_notes: None,
        fetch_error: None,
        download_url: None,
    };

    let mut resp = match ureq::get(GITHUB_LATEST_RELEASE)
        .header("User-Agent", "MountainLauncher")
        .header("Accept", "application/vnd.github+json")
        .call()
    {
        Ok(r) => r,
        Err(e) => {
            out.fetch_error = Some(e.to_string());
            return Ok(out);
        }
    };

    if !resp.status().is_success() {
        out.fetch_error = Some(format!("GitHub 返回 HTTP {}", resp.status()));
        return Ok(out);
    }

    let body = match resp.body_mut().read_to_string() {
        Ok(b) => b,
        Err(e) => {
            out.fetch_error = Some(e.to_string());
            return Ok(out);
        }
    };

    let release: GithubReleaseJson = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            out.fetch_error = Some(format!("解析 releases JSON 失败: {e}"));
            return Ok(out);
        }
    };

    let tag = release.tag_name.trim().trim_start_matches('v').to_string();
    out.latest_version = Some(tag.clone());
    out.release_url = Some(release.html_url);
    out.release_notes = release.body;
    // 安装包直链：优先 x64 setup.exe
    out.download_url = release
        .assets
        .iter()
        .find(|a| {
            let n = a.name.to_lowercase();
            n.ends_with(".exe") && (n.contains("x64") || n.contains("setup"))
        })
        .or_else(|| release.assets.iter().find(|a| a.name.to_lowercase().ends_with(".exe")))
        .map(|a| a.browser_download_url.clone());

    out.has_update = match (
        semver::Version::parse(&tag),
        semver::Version::parse(env!("CARGO_PKG_VERSION")),
    ) {
        (Ok(latest), Ok(cur)) => latest > cur,
        _ => false,
    };

    Ok(out)
}

/// 下载更新安装包到临时目录（流式写盘，内存恒定），返回安装包路径。
#[tauri::command]
pub async fn download_update(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dest = std::env::temp_dir().join("mountain-update-setup.exe");
        let mut resp = ureq::get(&url)
            .header("User-Agent", "MountainLauncher")
            .call()
            .map_err(|e| format!("下载失败: {e}"))?;
        let mut reader = resp.body_mut().as_reader();
        let mut file = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
        std::io::copy(&mut reader, &mut file).map_err(|e| format!("写入失败: {e}"))?;
        let len = file.metadata().map_err(|e| e.to_string())?.len();
        if len < 100_000 {
            let _ = std::fs::remove_file(&dest);
            return Err("下载内容异常（文件过小），可能不是安装包".into());
        }
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("下载任务失败: {e}"))?
}

/// 静默覆盖安装并重启：spawn NSIS 安装器（/S 静默）→ 退出自身，
/// 安装器随后覆盖替换程序文件。
#[tauri::command]
pub async fn apply_update_and_restart(app: tauri::AppHandle, setup_path: String) -> Result<(), String> {
    let mut cmd = std::process::Command::new(&setup_path);
    cmd.arg("/S");
    hide_console_for_child(&mut cmd);
    cmd.spawn().map_err(|e| format!("启动安装程序失败: {e}"))?;
    // 等安装器进程就绪后再退出，避免文件被自身占用
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.exit(0);
    Ok(())
}
