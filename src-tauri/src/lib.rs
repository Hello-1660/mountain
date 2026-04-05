use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub dock: Vec<DockItem>,
    pub groups: Vec<AppGroup>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalogDto {
    #[serde(default)]
    pub apps: Vec<ScannedApp>,
    pub scanned_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub exists: bool,
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("store.json"))
}

fn catalog_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("catalog.json"))
}

fn icons_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("icons"))
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn exe_icon_cache_name(exe_path: &str) -> String {
    let digest = Sha256::digest(exe_path.to_lowercase().as_bytes());
    format!("{digest:x}.png")
}

#[cfg(target_os = "windows")]
fn extract_exe_icon_png(exe: &Path, out: &Path) -> Result<(), String> {
    let exe_s = exe.to_string_lossy();
    let out_s = out.to_string_lossy();
    let exe_b64 = STANDARD.encode(exe_s.as_bytes());
    let out_b64 = STANDARD.encode(out_s.as_bytes());
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
  $exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{exe_b64}'))
  $out = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{out_b64}'))
  if (-not (Test-Path -LiteralPath $exe)) {{ exit 2 }}
  $dir = Split-Path -Parent $out
  if (-not (Test-Path -LiteralPath $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}
  Add-Type -AssemblyName System.Drawing
  $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exe)
  if ($null -eq $icon) {{ exit 1 }}
  $bmp = $null
  try {{
    $bmp = $icon.ToBitmap()
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  }} finally {{
    if ($null -ne $bmp) {{ $bmp.Dispose() }}
    $icon.Dispose()
  }}
}} catch {{ exit 3 }}
"#
    );
    // 不要用 -NonInteractive：在部分环境下会妨碍 System.Drawing / GDI+ 初始化，导致永远提不出图标
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &script,
        ])
        .output()
        .map_err(|e| format!("图标提取启动失败: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "图标提取失败 (code {:?})",
            output.status.code()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_exe_icon_png(_exe: &Path, _out: &Path) -> Result<(), String> {
    Err("仅 Windows 支持图标缓存".into())
}

/// 返回绝对路径字符串，供前端 `convertFileSrc` 使用；失败则 `Ok(None)`。
fn ensure_icon_for_exe(app: &tauri::AppHandle, exe_path: &str) -> Result<Option<String>, String> {
    let p = Path::new(exe_path.trim());
    if !p.is_file() {
        return Ok(None);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return Ok(None);
    }
    #[cfg(target_os = "windows")]
    {
        let dir = icons_dir(app)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let fname = exe_icon_cache_name(exe_path);
        let out = dir.join(fname);
        let need_extract = !out.exists()
            || out
                .metadata()
                .map(|m| m.len() == 0)
                .unwrap_or(true);
        if need_extract {
            let _ = extract_exe_icon_png(p, &out);
        }
        if out.exists() && out.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let abs = out
                .canonicalize()
                .unwrap_or_else(|_| out.clone());
            Ok(Some(abs.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }
}

/// 供前端在 `convertFileSrc`（asset 协议）加载失败时回退，避免列表无图。
#[tauri::command]
fn read_icon_data_url(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }
    let p = Path::new(path);
    let icons_root = icons_dir(&app)?;
    let icons_canon = fs::canonicalize(&icons_root).map_err(|e| e.to_string())?;
    let target = p
        .canonicalize()
        .map_err(|_| "无法读取图标文件".to_string())?;
    let t = target.to_string_lossy().to_lowercase();
    let root = icons_canon.to_string_lossy().to_lowercase();
    if !t.starts_with(root.as_str()) {
        return Err("路径不在图标缓存目录内".into());
    }
    let bytes = fs::read(&target).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Ok(None);
    }
    let b64 = STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}

fn save_catalog(app: &tauri::AppHandle, dto: &AppCatalogDto) -> Result<(), String> {
    let p = catalog_path(app)?;
    let raw = serde_json::to_string_pretty(dto).map_err(|e| e.to_string())?;
    fs::write(p, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn load_app_catalog(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let p = catalog_path(&app)?;
    if !p.exists() {
        return Ok(AppCatalogDto {
            apps: vec![],
            scanned_at: None,
        });
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn scan_start_menu_collect() -> Result<Vec<ScannedApp>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Ok(Vec::new());
    }
    #[cfg(target_os = "windows")]
    {
        let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$seen = @{}
$results = New-Object System.Collections.ArrayList
$roots = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
)
foreach ($root in $roots) {
  if (-not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      $w = New-Object -ComObject WScript.Shell
      $s = $w.CreateShortcut($_.FullName)
      $t = $s.TargetPath
      if (-not $t) { }
      elseif ($t -notmatch '\.(exe|EXE)$') { }
      elseif (-not (Test-Path -LiteralPath $t -PathType Leaf)) { }
      else {
        $key = $t.ToLowerInvariant()
        if (-not $seen.ContainsKey($key)) {
          $seen[$key] = $true
          [void]$results.Add([ordered]@{
            name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
            path = $t
            shortcut = $_.FullName
          })
        }
      }
    } catch {}
  }
}
if ($results.Count -eq 0) { '[]' } else { ($results | ConvertTo-Json -Depth 4 -Compress) }
"#;
        let output = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output()
            .map_err(|e| format!("扫描失败: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() || text == "null" {
            return Ok(Vec::new());
        }
        let apps: Vec<ScannedApp> = serde_json::from_str(&text)
            .or_else(|_| serde_json::from_str::<ScannedApp>(&text).map(|one| vec![one]))
            .map_err(|e| {
                format!(
                    "解析扫描结果失败: {e}; 输出: {}",
                    text.chars().take(200).collect::<String>()
                )
            })?;

        let mut seen: HashSet<String> = HashSet::new();
        let mut out = Vec::new();
        for mut a in apps {
            let key = a.path.to_lowercase();
            if seen.insert(key) {
                if a.name.trim().is_empty() {
                    a.name = Path::new(&a.path)
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("应用")
                        .to_string();
                }
                a.icon_path = None;
                out.push(a);
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
}

fn refresh_catalog_blocking(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let mut apps = scan_start_menu_collect()?;
    for a in &mut apps {
        a.icon_path = ensure_icon_for_exe(&app, &a.path).unwrap_or(None);
    }
    let dto = AppCatalogDto {
        scanned_at: Some(now_unix_ms()),
        apps,
    };
    save_catalog(&app, &dto)?;
    Ok(dto)
}

#[tauri::command]
async fn refresh_app_catalog(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_catalog_blocking(handle))
        .await
        .map_err(|e| format!("刷新任务失败: {e}"))?
}

#[tauri::command]
fn load_store(app: tauri::AppHandle) -> Result<AppStore, String> {
    let p = store_path(&app)?;
    if !p.exists() {
        return Ok(AppStore::default());
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_store(app: tauri::AppHandle, store: AppStore) -> Result<(), String> {
    let p = store_path(&app)?;
    let raw = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(p, raw).map_err(|e| e.to_string())
}

#[tauri::command]
fn new_dock_item(app: tauri::AppHandle, path: String, title: Option<String>) -> DockItem {
    let p = path.trim().to_string();
    let title = title.unwrap_or_else(|| {
        Path::new(&p)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("应用")
            .to_string()
    });
    let icon_path = ensure_icon_for_exe(&app, &p).unwrap_or(None);
    DockItem {
        id: Uuid::new_v4().to_string(),
        path: p,
        title,
        icon_path,
    }
}

#[tauri::command]
fn new_group(name: String) -> AppGroup {
    AppGroup {
        id: Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        paths: Vec::new(),
    }
}

#[tauri::command]
fn file_detail(path: String) -> Result<FileDetail, String> {
    let path = path.trim().to_string();
    let p = Path::new(&path);
    let name = p
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path)
        .to_string();
    if !p.exists() {
        return Ok(FileDetail {
            path,
            name,
            size_bytes: 0,
            exists: false,
        });
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(FileDetail {
        path,
        name,
        size_bytes: meta.len(),
        exists: true,
    })
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("路径为空".into());
    }
    Command::new(path)
        .spawn()
        .map_err(|e| format!("启动失败: {e}"))?;
    Ok(())
}

/// 异步打开库窗口：避免在 Windows/WebView2 上通过同步 command 操作窗口时卡住或无效；
/// 若启动时未注册到管理器，则按配置即时创建。
#[tauri::command]
async fn show_library_window(app: tauri::AppHandle) -> Result<(), String> {
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

#[tauri::command]
async fn pick_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("可执行文件", &["exe", "msi", "bat", "cmd"])
        .blocking_pick_file();
    Ok(file.map(|f| f.to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename("window-state.json")
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_store,
            new_dock_item,
            new_group,
            file_detail,
            launch_app,
            load_app_catalog,
            refresh_app_catalog,
            read_icon_data_url,
            pick_executable,
            show_library_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
