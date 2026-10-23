import { convertFileSrc } from "@tauri-apps/api/core";

/** 将后端返回的绝对路径转为 WebView 可加载的 asset URL（统一为正斜杠，减少 Windows 下编码问题） */
export function appIconSrc(absolutePath: string | null | undefined): string | undefined {
  if (!absolutePath?.trim()) return undefined;
  const normalized = absolutePath.trim().replace(/\\/g, "/");
  try {
    return convertFileSrc(normalized);
  } catch {
    return undefined;
  }
}
