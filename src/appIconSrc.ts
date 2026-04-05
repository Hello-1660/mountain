import { convertFileSrc } from "@tauri-apps/api/core";

/** 将后端返回的绝对路径转为 WebView 可加载的 asset URL */
export function appIconSrc(absolutePath: string | null | undefined): string | undefined {
  if (!absolutePath?.trim()) return undefined;
  try {
    return convertFileSrc(absolutePath.trim());
  } catch {
    return undefined;
  }
}
