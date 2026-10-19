import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 基于 Pointer Events 的拖拽排序。
 *
 * 为什么不直接用 HTML5 Drag & Drop：WebView2（Tauri 桌面端）下 draggable 元素
 * 内部含 <button> 时拖拽经常不触发，浏览器预览能拖、打包后拖不动就是这个问题。
 * 这里改为自己接管 pointerdown/move/up，并用 `data-drop` 做命中测试，
 * 浏览器与桌面端行为一致。
 *
 * 用法：
 *   给可拖拽项加 `data-drop="app|<path>"` 或 `data-drop="group|<id>"`
 *   并在 onPointerDown 里调用 `begin(e, { kind: "app", path })`。
 */

export type DragPayload =
  | { kind: "app"; path: string }
  | { kind: "group"; id: string }
  | { kind: "dock"; id: string };

export type DropTarget = DragPayload;

const SEP = "|";

export function encodeDrop(t: DragPayload): string {
  const head = t.kind === "app" ? "app" : t.kind === "group" ? "group" : "dock";
  const key = t.kind === "group" || t.kind === "dock" ? t.id : t.path;
  return head + SEP + key;
}

function decodeDrop(raw: string | undefined): DropTarget | null {
  if (!raw) return null;
  const i = raw.indexOf(SEP);
  if (i < 0) return null;
  const head = raw.slice(0, i);
  const key = raw.slice(i + 1);
  if (!key) return null;
  if (head === "app") return { kind: "app", path: key };
  if (head === "group") return { kind: "group", id: key };
  if (head === "dock") return { kind: "dock", id: key };
  return null;
}

function sameTarget(a: DragPayload, b: DropTarget): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "app" && b.kind === "app")
    return a.path.toLowerCase() === b.path.toLowerCase();
  if (a.kind === "group" && b.kind === "group") return a.id === b.id;
  if (a.kind === "dock" && b.kind === "dock") return a.id === b.id;
  return false;
}

type Start = {
  x: number;
  y: number;
  payload: DragPayload;
  active: boolean;
};

const THRESHOLD = 5;

export function useDragSort(
  onCommit: (drag: DragPayload, target: DropTarget) => void,
) {
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const startRef = useRef<Start | null>(null);
  const suppressClickRef = useRef(false);

  const begin = useCallback((e: React.PointerEvent, payload: DragPayload) => {
    if (e.button !== 0) return;
    // 落在按钮 / 输入框 / 链接上的按下交给控件本身，不启动拖拽
    if ((e.target as HTMLElement | null)?.closest("button,input,select,a,textarea"))
      return;
    startRef.current = { x: e.clientX, y: e.clientY, payload, active: false };
  }, []);

  /** click 处理里先问一次：这次 click 是否应该被拖拽抑制掉 */
  const consumeClickSuppression = useCallback(() => {
    if (!suppressClickRef.current) return false;
    suppressClickRef.current = false;
    return true;
  }, []);

  useEffect(() => {
    const hitTest = (x: number, y: number): DropTarget | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const holder = el?.closest<HTMLElement>("[data-drop]");
      return decodeDrop(holder?.dataset.drop);
    };

    const onMove = (e: PointerEvent) => {
      const st = startRef.current;
      if (!st) return;
      if (!st.active) {
        if (Math.hypot(e.clientX - st.x, e.clientY - st.y) < THRESHOLD) return;
        st.active = true;
        suppressClickRef.current = true;
        document.body.classList.add("is-dragging-sort");
        setDrag(st.payload);
      }
      const t = hitTest(e.clientX, e.clientY);
      setTarget(t && !sameTarget(st.payload, t) ? t : null);
    };

    const finish = (e: PointerEvent) => {
      const st = startRef.current;
      startRef.current = null;
      if (!st?.active) return;
      document.body.classList.remove("is-dragging-sort");
      const t = hitTest(e.clientX, e.clientY);
      if (t && !sameTarget(st.payload, t)) onCommit(st.payload, t);
      setDrag(null);
      setTarget(null);
      // 让紧随其后的 click 能读到抑制标记，再自然失效
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    const onCancel = () => {
      if (!startRef.current) return;
      startRef.current = null;
      document.body.classList.remove("is-dragging-sort");
      suppressClickRef.current = false;
      setDrag(null);
      setTarget(null);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("is-dragging-sort");
    };
  }, [onCommit]);

  const isDragging = useCallback(
    (p: DragPayload) =>
      !!drag &&
      drag.kind === p.kind &&
      sameTarget(drag, p as DropTarget),
    [drag],
  );

  const isTarget = useCallback(
    (p: DragPayload) => !!target && sameTarget(p, target),
    [target],
  );

  return { begin, isDragging, isTarget, dragging: drag, consumeClickSuppression };
}

export function dropAttr(t: DragPayload): { "data-drop": string } {
  return { "data-drop": encodeDrop(t) };
}
