//! 应用图标提取与缓存。
//!
//! 提取走 PowerShell + 内联 C#（见 [`ICON_EXTRACTOR_CS`]），结果按
//! exe 路径的哈希缓存为 PNG，供前端 `convertFileSrc` 直接加载。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

use crate::paths;
use crate::platform::hide_console_for_child;

/// 缓存文件名带算法版本：升级提取算法（v1 的 32×32 太糊）后旧缓存自动失效重新提取
fn exe_icon_cache_name(exe_path: &str) -> String {
    let digest = Sha256::digest(exe_path.to_lowercase().as_bytes());
    format!("{digest:x}.v2.png")
}

/// 读 PNG 的 IHDR 拿宽高；解析失败或尺寸低于 `min` 视为需要重提。
/// 用于把早期回退路径产出的 32×32 缓存自动升级（避免全量缓存失效）。
fn png_dimensions_at_least(path: &Path, min: u32) -> bool {
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
     InterfaceType(ComInterfaceType.InterfaceIsUnknown)]
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
    let mut ps = std::process::Command::new("powershell");
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
        return Err(format!("图标提取失败 (code {:?})", output.status.code()));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_exe_icon_png(_exe: &Path, _out: &Path) -> Result<(), String> {
    Err("仅 Windows 支持图标缓存".into())
}

/// 返回绝对路径字符串，供前端 `convertFileSrc` 使用；失败则 `Ok(None)`。
pub fn ensure_icon_for_exe(app: &tauri::AppHandle, exe_path: &str) -> Result<Option<String>, String> {
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
        let dir = paths::icons_dir(app)?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let fname = exe_icon_cache_name(exe_path);
        let out = dir.join(fname);
        let need_extract = !out.exists()
            || out.metadata().map(|m| m.len() == 0).unwrap_or(true)
            // 早期回退路径产出的小尺寸缓存（32×32）也重提：算法已支持逐级回退
            || (out.exists() && !png_dimensions_at_least(&out, 64));
        if need_extract {
            let _ = extract_exe_icon_png(p, &out);
        }
        if out.exists() && out.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            let abs = out.canonicalize().unwrap_or_else(|_| out.clone());
            Ok(Some(abs.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }
}

/// 供前端在 `convertFileSrc`（asset 协议）加载失败时回退，避免列表无图。
#[tauri::command]
pub fn read_icon_data_url(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }
    let p = Path::new(path);
    let icons_root = paths::icons_dir(&app)?;
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
