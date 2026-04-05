use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub exists: bool,
}

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("store.json"))
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
fn new_dock_item(path: String, title: Option<String>) -> DockItem {
    let p = path.trim().to_string();
    let title = title.unwrap_or_else(|| {
        Path::new(&p)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("应用")
            .to_string()
    });
    DockItem {
        id: Uuid::new_v4().to_string(),
        path: p,
        title,
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
    #[cfg(target_os = "windows")]
    {
        Command::new(path)
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        Command::new(path)
            .spawn()
            .map_err(|e| format!("启动失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn scan_start_menu_apps() -> Result<Vec<ScannedApp>, String> {
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
        let apps: Vec<ScannedApp> = serde_json::from_str(&text).or_else(|_| {
            serde_json::from_str::<ScannedApp>(&text).map(|one| vec![one])
        }).map_err(|e| {
            format!("解析扫描结果失败: {e}; 输出: {}", text.chars().take(200).collect::<String>())
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
                out.push(a);
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
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
            scan_start_menu_apps,
            pick_executable,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
