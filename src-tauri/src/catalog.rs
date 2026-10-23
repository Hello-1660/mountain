//! 应用目录（`catalog.json`）：开始菜单扫描、手动添加/移除、黑名单。

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::icons;
use crate::models::{AppCatalogDto, ScannedApp};
use crate::paths;
#[cfg(target_os = "windows")]
use crate::platform::hide_console_for_child;
use crate::store;
use crate::usage;
use crate::util::{now_unix_ms, read_json_file, write_json_file};

pub fn load(app: &tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let p = paths::catalog_path(app)?;
    if !p.exists() {
        return Ok(AppCatalogDto::empty());
    }
    let mut dto: AppCatalogDto = read_json_file(&p)?;
    // 幂等去重（旧缓存自愈）：同 path 只留一条，快捷方式（带 target）优先
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut apps: Vec<ScannedApp> = Vec::new();
    for a in dto.apps.drain(..) {
        let key = a.path.to_lowercase();
        match index.get(&key) {
            None => {
                index.insert(key, apps.len());
                apps.push(a);
            }
            Some(&i) => {
                if apps[i].target.is_none() && a.target.is_some() {
                    apps[i] = a;
                }
            }
        }
    }
    dto.apps = apps;
    Ok(dto)
}

pub fn save(app: &tauri::AppHandle, dto: &AppCatalogDto) -> Result<(), String> {
    let p = paths::catalog_path(app)?;
    write_json_file(&p, dto)
}

#[tauri::command]
pub fn load_app_catalog(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    load(&app)
}

/// 将手动选择的 exe 并入本地目录（供「全部」列表与持久化 catalog 使用）。
fn push_manual_app(
    dto: &mut AppCatalogDto,
    app: &tauri::AppHandle,
    path: &str,
) -> Result<bool, String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("路径为空".into());
    }
    let pb = Path::new(&path);
    // 允许任意类型的可执行体：脚本、快捷方式(.lnk)、符号/硬链接等。
    // 用 exists() 而非 is_file()：部分链接类型下 is_file() 会误判为 false。
    if !pb.exists() {
        return Err("路径不存在".into());
    }
    if dto.apps.iter().any(|a| a.path.eq_ignore_ascii_case(&path)) {
        return Ok(false);
    }
    // 手动添加即明确意图：若此前移除过，从黑名单恢复，否则重新扫描会把它挡掉
    let key = path.trim().to_lowercase();
    dto.removed.retain(|r| r != &key);
    let name = pb
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("应用")
        .to_string();
    let working_dir = pb
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .and_then(|p| p.to_str())
        .map(String::from);
    let icon_path = icons::ensure_icon_for_exe(app, &path).unwrap_or(None);
    dto.apps.push(ScannedApp {
        name,
        path,
        shortcut: None,
        target: None,
        working_dir,
        icon_path,
        manual: true,
    });
    Ok(true)
}

fn sort_by_name(apps: &mut [ScannedApp]) {
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
}

#[tauri::command]
pub fn add_manual_executable(app: tauri::AppHandle, path: String) -> Result<AppCatalogDto, String> {
    let mut dto = load(&app)?;
    push_manual_app(&mut dto, &app, &path)?;
    sort_by_name(&mut dto.apps);
    save(&app, &dto)?;
    Ok(dto)
}

/// 批量手动添加：一次对话框多选 → 一次性并入目录并保存
#[tauri::command]
pub fn add_manual_executables(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<AppCatalogDto, String> {
    let mut dto = load(&app)?;
    for p in &paths {
        // 单条失败（路径不存在等）跳过，不影响其余
        let _ = push_manual_app(&mut dto, &app, p);
    }
    sort_by_name(&mut dto.apps);
    save(&app, &dto)?;
    Ok(dto)
}

/// 从启动台移除应用：目录删除 + 移除黑名单（重新扫描不再拉回）+
/// 同步清理便捷栏 / 分组 / 别名引用，并广播 store 变化给 dock 与库窗口。
/// 后悔药：「手动添加」同一路径即恢复。
#[tauri::command]
pub fn remove_app(app: tauri::AppHandle, path: String) -> Result<AppCatalogDto, String> {
    let key = path.trim().to_lowercase();
    if key.is_empty() {
        return Err("路径为空".into());
    }
    let mut dto = load(&app)?;
    dto.apps.retain(|a| !a.path.eq_ignore_ascii_case(&path));
    if !dto.removed.iter().any(|r| r == &key) {
        dto.removed.push(key.clone());
    }
    save(&app, &dto)?;

    // store 清理：dock 钉选、各分组引用、别名
    let mut state = store::load(&app)?;
    state.dock.retain(|d| !d.path.eq_ignore_ascii_case(&path));
    for g in &mut state.groups {
        g.paths.retain(|p| !p.eq_ignore_ascii_case(&path));
    }
    state.aliases.remove(&key);
    // 走 save_store 而非 store::save：需要广播 store 变化给 dock 与库窗口
    store::save_store(app.clone(), state)?;

    // 启动历史清理：「最近使用 / 启动最多」不再出现已移除应用
    let mut history = usage::load_file(&app)?;
    history.entries.retain(|k, _| !k.eq_ignore_ascii_case(&key));
    usage::save_file(&app, &history)?;
    Ok(dto)
}

/// 扫描桌面与开始菜单的 .lnk，解析出目标 exe
#[cfg(not(target_os = "windows"))]
fn scan_start_menu_collect() -> Result<Vec<ScannedApp>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn scan_start_menu_collect() -> Result<Vec<ScannedApp>, String> {
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$seen = @{}
$results = New-Object System.Collections.ArrayList
$roots = @(
  # 桌面快捷方式优先（用户自建入口，与已有应用重复时保留快捷方式）
  [Environment]::GetFolderPath('Desktop'),
  (Join-Path $env:PUBLIC 'Desktop'),
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
          $item = [ordered]@{
            name = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
            path = $_.FullName
            shortcut = $_.FullName
            target = $t
          }
          $wd = $s.WorkingDirectory
          if ($wd -and ((Test-Path -LiteralPath $wd -PathType Container))) {
            $item['workingDirectory'] = $wd
          }
          [void]$results.Add($item)
        }
      }
    } catch {}
  }
}
if ($results.Count -eq 0) { '[]' } else { ($results | ConvertTo-Json -Depth 4 -Compress) }
"#;
    let mut ps = std::process::Command::new("powershell");
    hide_console_for_child(&mut ps);
    let output = ps
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
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

    // 双重去重：path 唯一（同一快捷方式只留一条）+ 目标 exe 唯一
    // （同一应用的多个快捷方式只留一条，桌面优先先到先得）。
    // 仅按目标去重会让「manual exe 条目 + 快捷方式条目」因 key 不同
    // 同时保留（同一路径出现两条），故 path 也必须唯一。
    let mut seen_key: HashSet<String> = HashSet::new();
    let mut seen_path: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for mut a in apps {
        let key = a
            .target
            .as_deref()
            .unwrap_or(a.path.as_str())
            .to_lowercase();
        let path_key = a.path.to_lowercase();
        if !seen_path.insert(path_key) || !seen_key.insert(key) {
            continue;
        }
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
    sort_by_name(&mut out);
    Ok(out)
}

/// 同一应用的去重标识：快捷方式用目标 exe，否则用自身路径
fn key_of(a: &ScannedApp) -> String {
    a.target
        .as_deref()
        .unwrap_or(a.path.as_str())
        .to_lowercase()
}

fn refresh_catalog_blocking(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let prev = load(&app).unwrap_or_else(|_| AppCatalogDto::empty());
    // 移除黑名单：用户手动移除过的应用，重新扫描不再拉回
    let removed: HashSet<String> = prev.removed.iter().cloned().collect();
    let mut apps = scan_start_menu_collect()?;
    // key = 目标 exe：快捷方式条目与旧 exe 条目/manual 条目同目标视为同一应用
    apps.retain(|a| !removed.contains(&key_of(a)));
    let mut paths: HashSet<String> = apps.iter().map(key_of).collect();
    let mut path_set: HashSet<String> = apps.iter().map(|a| a.path.to_lowercase()).collect();
    for a in &prev.apps {
        let k = key_of(a);
        let p = a.path.to_lowercase();
        // 同目标 exe 或同路径都视为重复：快捷方式条目胜出，manual 不追加
        if a.manual && !paths.contains(&k) && !path_set.contains(&p) && !removed.contains(&k) {
            paths.insert(k);
            path_set.insert(p);
            let mut m = a.clone();
            m.icon_path = icons::ensure_icon_for_exe(&app, &m.path).unwrap_or(None);
            apps.push(m);
        }
    }
    for a in &mut apps {
        a.icon_path = icons::ensure_icon_for_exe(&app, &a.path).unwrap_or(None);
    }
    sort_by_name(&mut apps);
    let dto = AppCatalogDto {
        scanned_at: Some(now_unix_ms()),
        apps,
        removed: prev.removed,
    };
    save(&app, &dto)?;
    Ok(dto)
}

#[tauri::command]
pub async fn refresh_app_catalog(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || refresh_catalog_blocking(handle))
        .await
        .map_err(|e| format!("刷新任务失败: {e}"))?
}
