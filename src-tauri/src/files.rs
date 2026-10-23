//! 文件系统元数据查询（详情面板用）。

use std::fs;
use std::path::Path;

use crate::models::FileDetail;

#[tauri::command]
pub fn file_detail(path: String) -> Result<FileDetail, String> {
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
