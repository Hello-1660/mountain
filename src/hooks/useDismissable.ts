import { useEffect, type RefObject } from "react";

/**
 * 浮层/菜单的通用关闭行为：点击容器外部或按 Esc 关闭。
 *
 * `containerRef` 内的点击（含触发按钮本身）不算「外部」，避免「点一次关闭、
 * 紧随的 click 又打开」的抖动。
 */
export function useDismissable(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // 延后一帧再挂监听：避免「打开它的那次点击」立刻把自己关掉
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, containerRef, onDismiss]);
}
