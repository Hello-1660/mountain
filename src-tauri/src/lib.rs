use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// 避免从 GUI 主进程拉起 PowerShell 时短暂弹出黑色控制台窗口。
#[cfg(target_os = "windows")]
fn hide_console_for_child(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LibUiSettings {
    /// 显示「最近使用」（横带 + 搜索域）；关闭仅隐藏 UI，记录继续保存
    pub show_recent: bool,
    /// 显示「启动最多」（侧栏 + 搜索域）；关闭仅隐藏 UI，记录继续保存
    pub show_frequent: bool,
}

impl Default for LibUiSettings {
    fn default() -> Self {
        Self {
            show_recent: true,
            show_frequent: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppStore {
    pub dock: Vec<DockItem>,
    pub groups: Vec<AppGroup>,
    /// 应用路径（小写）→ 用户自定义别名；为空表示用扫描到的名称
    #[serde(default)]
    pub aliases: HashMap<String, String>,
    /// 界面显示开关（关闭只隐藏 UI，不影响记录）
    #[serde(default)]
    pub ui: LibUiSettings,
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
    /// 快捷方式指向的目标 exe（去重用：同一目标只保留快捷方式条目）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    /// 开始菜单 .lnk 的「起始位置」，部分程序依赖此目录才能启动
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_path: Option<String>,
    /// 用户「手动添加」写入目录；重新扫描开始菜单时会保留此类条目
    #[serde(default)]
    pub manual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCatalogDto {
    #[serde(default)]
    pub apps: Vec<ScannedApp>,
    pub scanned_at: Option<i64>,
    /// 用户移除过的应用路径（小写）；重新扫描时不再出现，防止"移除后又回来"。
    /// 若用户「手动添加」同一路径，则视为恢复，从黑名单移除。
    #[serde(default)]
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub exists: bool,
}

const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/Hello-1660/mountain/releases/latest";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
    pub path: String,
    pub launch_count: u32,
    pub last_used_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageFile {
    pub entries: HashMap<String, UsageEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrequentEntry {
    pub path: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshotDto {
    pub recent_paths: Vec<String>,
    pub frequent_paths: Vec<FrequentEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckDto {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub has_update: bool,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
    pub fetch_error: Option<String>,
    /// 安装包直链（release assets 里的 x64 setup.exe），供应用内下载
    pub download_url: Option<String>,
}

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

fn usage_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("usage.json"))
}

fn load_usage_file(app: &tauri::AppHandle) -> Result<UsageFile, String> {
    let p = usage_path(app)?;
    if !p.exists() {
        return Ok(UsageFile::default());
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn save_usage_file(app: &tauri::AppHandle, data: &UsageFile) -> Result<(), String> {
    let p = usage_path(app)?;
    let raw = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(p, raw).map_err(|e| e.to_string())
}

fn record_launch(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(());
    }
    let key = path.to_lowercase();
    let mut file = load_usage_file(app)?;
    let now = now_unix_ms();
    let entry = file.entries.entry(key).or_insert(UsageEntry {
        path: path.to_string(),
        launch_count: 0,
        last_used_ms: 0,
    });
    entry.path = path.to_string();
    entry.launch_count = entry.launch_count.saturating_add(1);
    entry.last_used_ms = now;
    save_usage_file(app, &file)?;
    let _ = app.emit("usage-updated", ());
    Ok(())
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

/// 缓存文件名带算法版本：升级提取算法（v1 的 32×32 太糊）后旧缓存自动失效重新提取
fn exe_icon_cache_name(exe_path: &str) -> String {
    let digest = Sha256::digest(exe_path.to_lowercase().as_bytes());
    format!("{digest:x}.v2.png")
}

/// 读 PNG 的 IHDR 拿宽高；解析失败或尺寸低于 `min` 视为需要重提。
/// 用于把早期回退路径产出的 32×32 缓存自动升级（避免全量缓存失效）。
fn png_dimensions_at_least(path: &std::path::Path, min: u32) -> bool {
    use std::io::Read;
    let Ok(mut f) = std::fs::File::open(path) else {
        return false;
    };
    let mut head = [0u8; 24];
    if f.read_exact(&mut head).is_err() {
        return false;
    }
    // PNG 签名 8 字节 + "IHDR" 4 字节 + 宽高各 4 字节（大端）
    if &head[..8] != b"\x89PNG\r\n\x1a\n" || &head[12..16] != b"IHDR" {
        return false;
    }
    let w = u32::from_be_bytes([head[16], head[17], head[18], head[19]]);
    let h = u32::from_be_bytes([head[20], head[21], head[22], head[23]]);
    w >= min && h >= min
}

/// 高分辨率图标提取用的 C# 片段：
/// `System.Drawing.Icon.ExtractAssociatedIcon` 只给 32×32，放大后会糊；
/// `PrivateExtractIcons` 能拿到 exe 内嵌的最大帧（常见 256×256）。
#[cfg(target_os = "windows")]
const ICON_EXTRACTOR_CS: &str = r#"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class MtIconExtractor
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int PrivateExtractIcons(
        string file, int index, int cx, int cy, IntPtr[] phicon, IntPtr[] piconid, int nIcons, int flags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    // ---- IShellItemImageFactory：Explorer 显示文件图标用的同一来源 ----
    // 对 PE 资源里没有图标组的 exe（Node/Electron 封装壳、资源被剥离的工具），
    // PrivateExtractIcons 全尺寸失败，用这个拿 Shell 缓存的最佳图标。
    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int cx; public int cy; }

    [Flags]
    private enum SIIGBF : uint { SIIGBF_BIGGERSIZEOK = 0x00000001 }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        // 注意：SIZE 必须按值传递。PowerShell 内联编译的 C#（CodeDom）对
        // `ref struct` 的 COM marshaling 有缺陷，会抛 ArgumentException；
        // [in] 结构体传值与 ref [in] 在 COM 层等价。
        void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        [In] ref Guid riid,
        [Out, MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAP
    {
        public int bmType; public int bmWidth; public int bmHeight;
        public int bmWidthBytes; public ushort bmPlanes; public ushort bmBitsPixel;
        public IntPtr bmBits;
    }

    [DllImport("gdi32.dll", SetLastError = true)]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern int GetObject(IntPtr h, int c, ref BITMAP bmp);

    /// 从 HBITMAP 构造保 alpha 的位图：Shell 返回的是 32bpp PARGB（预乘），
    /// Bitmap.FromHbitmap 会丢 alpha，这里手动反预乘。
    private static Bitmap FromHbitmapWithAlpha(IntPtr hbm)
    {
        BITMAP bm = new BITMAP();
        GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref bm);
        using (Bitmap src = new Bitmap(bm.bmWidth, bm.bmHeight, bm.bmWidthBytes,
                   PixelFormat.Format32bppPArgb, bm.bmBits))
        {
            Bitmap dst = new Bitmap(bm.bmWidth, bm.bmHeight, PixelFormat.Format32bppArgb);
            for (int y = 0; y < bm.bmHeight; y++)
            {
                for (int x = 0; x < bm.bmWidth; x++)
                {
                    Color p = src.GetPixel(x, y);
                    if (p.A == 0) { dst.SetPixel(x, y, Color.Transparent); continue; }
                    int a = p.A;
                    dst.SetPixel(x, y, Color.FromArgb(a,
                        Math.Min(255, p.R * 255 / a),
                        Math.Min(255, p.G * 255 / a),
                        Math.Min(255, p.B * 255 / a)));
                }
            }
            return dst;
        }
    }

    /// 成功返回 1，失败返回 0
    public static int SaveShell(string file, string outPath, int size)
    {
        Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
        IShellItemImageFactory factory;
        int hr = SHCreateItemFromParsingName(file, IntPtr.Zero, ref iid, out factory);
        if (hr != 0) return -10;
        try
        {
            SIZE sz;
            sz.cx = size; sz.cy = size;
            IntPtr hbm;
            factory.GetImage(sz, SIIGBF.SIIGBF_BIGGERSIZEOK, out hbm);
            if (hbm == IntPtr.Zero) return -11;
            try
            {
                using (Bitmap bmp = FromHbitmapWithAlpha(hbm))
                {
                    bmp.Save(outPath, ImageFormat.Png);
                }
                return 1;
            }
            finally { DeleteObject(hbm); }
        }
        catch { return -12; }
        finally { try { Marshal.ReleaseComObject(factory); } catch { } }
    }

    /// 成功返回 1，失败返回 0；< 0 表示具体失败原因，便于排查
    public static int Save(string file, string outPath, int size)
    {
        IntPtr[] hIcon = new IntPtr[1];
        IntPtr[] iconId = new IntPtr[1];
        int n = 0;
        try { n = PrivateExtractIcons(file, 0, size, size, hIcon, iconId, 1, 0); }
        catch { return -1; }
        if (n <= 0 || hIcon[0] == IntPtr.Zero) return -2;
        try
        {
            // FromHandle 得到的 Icon 在 DestroyIcon 后失效，先 Clone
            using (Icon ic = (Icon)Icon.FromHandle(hIcon[0]).Clone())
            {
                // 小帧（应用图标组本身只有 32×32 的，如 appverif/nvm/ollama）
                // 前置用高质量 Bicubic 放大到 128：浏览器/hover 缩放就不再二次插值，
                // 边缘比"32 纹理被拉伸"干净得多
                int outSize = ic.Width >= 128 ? ic.Width : 128;
                using (Bitmap bmp = new Bitmap(outSize, outSize, PixelFormat.Format32bppArgb))
                {
                    using (Graphics g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.Transparent);
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.DrawIcon(ic, new Rectangle(0, 0, outSize, outSize));
                    }
                    bmp.Save(outPath, ImageFormat.Png);
                }
            }
            return 1;
        }
        catch { return -3; }
        finally { DestroyIcon(hIcon[0]); }
    }

    /// 逐级回退取最大可用帧：不少 exe 图标组没有 256 帧（只有 48/32），
    /// 固定请求 256 会失败并回退到 32×32 的系统关联图标，显示即模糊。
    /// 全部尺寸失败再用 Shell 图标工厂兜底（PE 无图标组的封装壳程序）。
    /// 返回 1 表示成功写出；0 表示所有来源都失败。
    public static int SaveBest(string file, string outPath)
    {
        int[] sizes = { 256, 128, 64, 48 };
        foreach (int sz in sizes)
        {
            if (Save(file, outPath, sz) == 1) return 1;
        }
        return SaveShell(file, outPath, 256);
    }
}
"#;

#[cfg(target_os = "windows")]
fn extract_exe_icon_png(exe: &Path, out: &Path) -> Result<(), String> {
    let exe_s = exe.to_string_lossy();
    let out_s = out.to_string_lossy();
    let exe_b64 = STANDARD.encode(exe_s.as_bytes());
    let out_b64 = STANDARD.encode(out_s.as_bytes());
    let cs_b64 = STANDARD.encode(ICON_EXTRACTOR_CS.as_bytes());
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
try {{
  $exe = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{exe_b64}'))
  $out = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{out_b64}'))
  $cs  = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{cs_b64}'))
  if (-not (Test-Path -LiteralPath $exe)) {{ exit 2 }}
  $dir = Split-Path -Parent $out
  if (-not (Test-Path -LiteralPath $dir)) {{ New-Item -ItemType Directory -Path $dir -Force | Out-Null }}
  Add-Type -AssemblyName System.Drawing

  # 快捷方式本身没有高分辨率图标，先解析到真实目标
  if ($exe.ToLower().EndsWith('.lnk')) {{
    try {{
      $ws = New-Object -ComObject WScript.Shell
      $target = $ws.CreateShortcut($exe).TargetPath
      if ($target -and (Test-Path -LiteralPath $target)) {{ $exe = $target }}
    }} catch {{ }}
  }}

  # 优先高分辨率（256×256）；C# 编译结果缓存成 DLL，避免每个应用都编译一次
  # DLL 名带提取器版本：改过 C# 后旧 DLL 自动失效重新编译
  $saved = $false
  $dll = Join-Path $env:TEMP 'mountain-icon-extractor.v3.dll'
  $loaded = $false
  if (-not (Test-Path -LiteralPath $dll)) {{
    try {{ Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing -OutputAssembly $dll -ErrorAction Stop }} catch {{ }}
  }}
  if (Test-Path -LiteralPath $dll) {{
    try {{ Add-Type -Path $dll -ErrorAction Stop; $loaded = $true }} catch {{ }}
  }}
  if (-not $loaded) {{
    try {{ Add-Type -TypeDefinition $cs -ReferencedAssemblies System.Drawing -ErrorAction Stop; $loaded = $true }} catch {{ }}
  }}
  if ($loaded) {{
    try {{ $saved = ([MtIconExtractor]::SaveBest($exe, $out) -eq 1) }} catch {{ $saved = $false }}
  }}

  # 回退：系统关联图标（仅 32×32，但保证有图）
  if (-not $saved) {{
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
  }}
}} catch {{ exit 3 }}
"#
    );
    // 不要用 -NonInteractive：在部分环境下会妨碍 System.Drawing / GDI+ 初始化，导致永远提不出图标
    let mut ps = Command::new("powershell");
    hide_console_for_child(&mut ps);
    let output = ps
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
                .unwrap_or(true)
            // 早期回退路径产出的小尺寸缓存（32×32）也重提：算法已支持逐级回退
            || (out.exists() && !png_dimensions_at_least(&out, 64));
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
            removed: vec![],
        });
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let mut dto: AppCatalogDto = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    // 幂等去重（旧缓存自愈）：同 path 只留一条，快捷方式（带 target）优先
    let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
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
    if dto
        .apps
        .iter()
        .any(|a| a.path.eq_ignore_ascii_case(&path))
    {
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
    let icon_path = ensure_icon_for_exe(app, &path).unwrap_or(None);
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

#[tauri::command]
fn add_manual_executable(app: tauri::AppHandle, path: String) -> Result<AppCatalogDto, String> {
    let mut dto = load_app_catalog(app.clone())?;
    push_manual_app(&mut dto, &app, &path)?;
    dto
        .apps
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    save_catalog(&app, &dto)?;
    Ok(dto)
}

/// 批量手动添加：一次对话框多选 → 一次性并入目录并保存
#[tauri::command]
fn add_manual_executables(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<AppCatalogDto, String> {
    let mut dto = load_app_catalog(app.clone())?;
    for p in &paths {
        // 单条失败（路径不存在等）跳过，不影响其余
        let _ = push_manual_app(&mut dto, &app, p);
    }
    dto
        .apps
        .sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    save_catalog(&app, &dto)?;
    Ok(dto)
}

/// 从启动台移除应用：目录删除 + 移除黑名单（重新扫描不再拉回）+
/// 同步清理便捷栏 / 分组 / 别名引用，并广播 store 变化给 dock 与库窗口。
/// 后悔药：「手动添加」同一路径即恢复。
#[tauri::command]
fn remove_app(app: tauri::AppHandle, path: String) -> Result<AppCatalogDto, String> {
    let key = path.trim().to_lowercase();
    if key.is_empty() {
        return Err("路径为空".into());
    }
    let mut dto = load_app_catalog(app.clone())?;
    dto.apps.retain(|a| !a.path.eq_ignore_ascii_case(&path));
    if !dto.removed.iter().any(|r| r == &key) {
        dto.removed.push(key.clone());
    }
    save_catalog(&app, &dto)?;

    // store 清理：dock 钉选、各分组引用、别名
    let mut store = load_store(app.clone())?;
    store.dock.retain(|d| !d.path.eq_ignore_ascii_case(&path));
    for g in &mut store.groups {
        g.paths.retain(|p| !p.eq_ignore_ascii_case(&path));
    }
    store.aliases.remove(&key);
    save_store(app.clone(), store)?;

    // 启动历史清理：「最近使用 / 启动最多」不再出现已移除应用
    let mut usage = load_usage_file(&app)?;
    usage.entries.retain(|k, _| !k.eq_ignore_ascii_case(&key));
    save_usage_file(&app, &usage)?;
    Ok(dto)
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
        let mut ps = Command::new("powershell");
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
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
}

fn refresh_catalog_blocking(app: tauri::AppHandle) -> Result<AppCatalogDto, String> {
    let prev = load_app_catalog(app.clone()).unwrap_or(AppCatalogDto {
        apps: vec![],
        scanned_at: None,
        removed: vec![],
    });
    // 移除黑名单：用户手动移除过的应用，重新扫描不再拉回
    let removed: HashSet<String> = prev.removed.iter().cloned().collect();
    let mut apps = scan_start_menu_collect()?;
    // key = 目标 exe：快捷方式条目与旧 exe 条目/manual 条目同目标视为同一应用
    let key_of = |a: &ScannedApp| {
        a.target
            .as_deref()
            .unwrap_or(a.path.as_str())
            .to_lowercase()
    };
    apps.retain(|a| !removed.contains(&key_of(a)));
    let mut paths: HashSet<String> = apps.iter().map(|a| key_of(a)).collect();
    let mut path_set: HashSet<String> =
        apps.iter().map(|a| a.path.to_lowercase()).collect();
    for a in &prev.apps {
        let k = key_of(a);
        let p = a.path.to_lowercase();
        // 同目标 exe 或同路径都视为重复：快捷方式条目胜出，manual 不追加
        if a.manual && !paths.contains(&k) && !path_set.contains(&p) && !removed.contains(&k)
        {
            paths.insert(k);
            path_set.insert(p);
            let mut m = a.clone();
            m.icon_path = ensure_icon_for_exe(&app, &m.path).unwrap_or(None);
            apps.push(m);
        }
    }
    for a in &mut apps {
        a.icon_path = ensure_icon_for_exe(&app, &a.path).unwrap_or(None);
    }
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    let dto = AppCatalogDto {
        scanned_at: Some(now_unix_ms()),
        apps,
        removed: prev.removed,
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
    fs::write(p, raw).map_err(|e| e.to_string())?;
    let _ = app.emit("store-updated", store);
    Ok(())
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
fn launch_app(
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

    if let Err(e) = record_launch(&app, path) {
        eprintln!("record_launch: {e}");
    }
    Ok(())
}

#[tauri::command]
fn load_usage_snapshot(app: tauri::AppHandle) -> Result<UsageSnapshotDto, String> {
    let file = load_usage_file(&app)?;
    // 清理死记录：目标文件已删除/卸载的历史不再展示（图标会是占位符的那些）
    let values: Vec<UsageEntry> = file
        .entries
        .into_values()
        .filter(|e| Path::new(e.path.trim()).is_file())
        .collect();

    let mut by_recent = values.clone();
    by_recent.sort_by_key(|e| std::cmp::Reverse(e.last_used_ms));
    let recent_paths: Vec<String> = by_recent
        .into_iter()
        .take(40)
        .map(|e| e.path)
        .collect();

    let mut by_freq = values;
    by_freq.sort_by(|a, b| {
        b.launch_count
            .cmp(&a.launch_count)
            .then_with(|| b.last_used_ms.cmp(&a.last_used_ms))
    });
    let frequent_paths: Vec<FrequentEntry> = by_freq
        .into_iter()
        .take(40)
        .map(|e| FrequentEntry {
            path: e.path,
            count: e.launch_count,
        })
        .collect();

    Ok(UsageSnapshotDto {
        recent_paths,
        frequent_paths,
    })
}

/// 删除单条使用记录（最近使用 / 启动最多）
#[tauri::command]
fn remove_usage_record(
    app: tauri::AppHandle,
    path: String,
) -> Result<UsageSnapshotDto, String> {
    let key = path.trim().to_lowercase();
    let mut usage = load_usage_file(&app)?;
    usage.entries.retain(|k, _| !k.eq_ignore_ascii_case(&key));
    save_usage_file(&app, &usage)?;
    load_usage_snapshot(app)
}

/// 批量删除使用记录
#[tauri::command]
fn remove_usage_records(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<UsageSnapshotDto, String> {
    let set: HashSet<String> = paths.iter().map(|p| p.trim().to_lowercase()).collect();
    let mut usage = load_usage_file(&app)?;
    usage.entries.retain(|k, _| !set.contains(&k.to_lowercase()));
    save_usage_file(&app, &usage)?;
    load_usage_snapshot(app)
}

/// 清空全部使用记录
#[tauri::command]
fn clear_usage_records(app: tauri::AppHandle) -> Result<UsageSnapshotDto, String> {
    let mut usage = load_usage_file(&app)?;
    usage.entries.clear();
    save_usage_file(&app, &usage)?;
    load_usage_snapshot(app)
}

#[tauri::command]
fn check_github_release() -> Result<UpdateCheckDto, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let mut out = UpdateCheckDto {
        current_version: current.clone(),
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
async fn download_update(url: String) -> Result<String, String> {
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
async fn apply_update_and_restart(app: tauri::AppHandle, setup_path: String) -> Result<(), String> {
    use std::process::Command;
    let mut cmd = Command::new(&setup_path);
    cmd.arg("/S");
    hide_console_for_child(&mut cmd);
    cmd.spawn().map_err(|e| format!("启动安装程序失败: {e}"))?;
    // 等安装器进程就绪后再退出，避免文件被自身占用
    std::thread::sleep(std::time::Duration::from_millis(500));
    app.exit(0);
    Ok(())
}

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
async fn fit_dock_size(app: tauri::AppHandle, content_width: f64) -> Result<(), String> {
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

/// 手动添加：允许任意类型的可执行文件 / 脚本 / 链接文件（.lnk、硬链接、符号链接等），
/// 也允许「所有文件」以便选择没有常见扩展名的可执行体。
const PICKABLE_EXTENSIONS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "ps1", "vbs", "js", "wsf", "lnk", "url", "py", "pyw",
    "jar", "appref-ms", "ahk", "sh",
];
#[tauri::command]
async fn pick_executable(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
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
async fn pick_executables(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
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

/// 登录/计划任务自启时传入；仅显示便捷栏，不打开「全部应用」窗口。
const AUTOSTART_ARG: &str = "--mountain-autostart";

/// 自启后仅在短时间内与 window-state 抢「隐藏 library」；超时后不再拦截，否则用户打开窗口会在下一帧被误关。
const AUTOSTART_SUPPRESS_LIBRARY_VISIBLE_SECS: u64 = 8;

/// 首次进入主循环时再 hide 一次 library，避免 window-state 在 Ready 之后把「全部应用」恢复成可见
static LIB_HIDE_AFTER_RESTORE: AtomicBool = AtomicBool::new(true);

static PROCESS_START: OnceLock<Instant> = OnceLock::new();

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
        .plugin({
            let kb = match tauri_plugin_global_shortcut::Builder::new().with_shortcut("Alt+Shift+M") {
                Ok(b) => b.with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let h = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = show_library_window(h).await;
                    });
                }),
                Err(e) => {
                    eprintln!("Mountain: 全局快捷键 Alt+Shift+M 未注册：{e}");
                    tauri_plugin_global_shortcut::Builder::new()
                }
            };
            kb.build()
        })
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                // 让「便捷启动」坞常驻屏幕最底层、不抢占焦点、不遮挡其他窗口：
                // 给窗口加 WS_EX_NOACTIVATE，点击它不会使其成为前台窗口（不会跳到最前），
                // 配合配置里的 alwaysOnBottom(HWND_BOTTOM)，始终位于其他窗口之下。
                #[cfg(target_os = "windows")]
                {
                    if let Some(win) = app.get_webview_window("dock") {
                        use windows::Win32::UI::WindowsAndMessaging::{
                            GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
                            WS_EX_NOACTIVATE,
                        };
                        if let Ok(hwnd) = win.hwnd() {
                            unsafe {
                                let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                                let _ = SetWindowLongPtrW(
                                    hwnd,
                                    GWL_EXSTYLE,
                                    ex | WS_EX_NOACTIVATE.0 as isize,
                                );
                            }
                        }
                    }
                }

                let menu = MenuBuilder::new(app)
                    .text("library", "打开全部应用")
                    .separator()
                    .text("toggle_dock", "显示/隐藏 dock 栏")
                    .separator()
                    .text("quit", "退出 Mountain")
                    .build()
                    .expect("tray menu");

                let Some(icon) = app.default_window_icon().cloned() else {
                    eprintln!("Mountain: 无内嵌窗口图标，跳过系统托盘");
                    return Ok(());
                };

                let _tray = TrayIconBuilder::with_id("main")
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
                    .expect("tray icon");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_store,
            save_store,
            new_dock_item,
            new_group,
            file_detail,
            launch_app,
            load_app_catalog,
            add_manual_executable,
            add_manual_executables,
            remove_app,
            refresh_app_catalog,
            read_icon_data_url,
            pick_executable,
            pick_executables,
            show_library_window,
            load_usage_snapshot,
            remove_usage_record,
            remove_usage_records,
            clear_usage_records,
            check_github_release,
            download_update,
            apply_update_and_restart,
            fit_dock_size,
        ])
        .build(context)
        .expect("error while building tauri application");

    app.run(|app, event| {
        match event {
            RunEvent::Ready => {
                PROCESS_START.get_or_init(Instant::now);
                if let Some(lib) = app.get_webview_window("library") {
                    let _ = lib.hide();
                }
            }
            RunEvent::MainEventsCleared => {
                if LIB_HIDE_AFTER_RESTORE.swap(false, Ordering::SeqCst) {
                    if let Some(lib) = app.get_webview_window("library") {
                        let _ = lib.hide();
                    }
                }
                if std::env::args().any(|a| a == AUTOSTART_ARG) {
                    let start = PROCESS_START.get_or_init(Instant::now);
                    if start.elapsed() < Duration::from_secs(AUTOSTART_SUPPRESS_LIBRARY_VISIBLE_SECS) {
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
