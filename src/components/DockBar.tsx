import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { saveWindowState } from "@tauri-apps/plugin-window-state";
import CachedAppIcon from "./CachedAppIcon";
import { IconGrid } from "./icons";
import { useDragSort, dropAttr, type DragPayload, type DropTarget } from "./useDragSort";
import { displayName, type AppStore, type DockItem } from "../types";
import "../styles/dock.css";

/** 磁贴最大放大倍率（与 dock.css 中的 .dock-tile 尺寸无关，纯 CSS 变换） */
const MAX_GAIN = 0.28;
/** 指针影响半径（px），越大则同时放大的邻居越多 */
const FIELD = 76;

function DockTileFace({
  title,
  iconPath,
}: {
  title: string;
  iconPath?: string;
}) {
  return (
    <CachedAppIcon
      iconPath={iconPath}
      className="dock-tile-img"
      draggable={false}
      fallback={<span className="dock-tile-initial">{title.slice(0, 1).toUpperCase()}</span>}
    />
  );
}

function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const libraryOpenLock = { current: false };

async function openLibrary() {
  if (!isTauri()) {
    console.warn("请在 Tauri 桌面窗口中运行（npm run tauri dev），浏览器里无法打开子窗口。");
    return;
  }
  if (libraryOpenLock.current) return;
  libraryOpenLock.current = true;
  try {
    await invoke("show_library_window");
  } catch (e) {
    console.error("打开全部应用窗口失败:", e);
  } finally {
    window.setTimeout(() => {
      libraryOpenLock.current = false;
    }, 400);
  }
}

export default function DockBar() {
  const [store, setStore] = useState<AppStore | null>(null);
  const [launchedId, setLaunchedId] = useState<string | null>(null);
  const [scales, setScales] = useState<Record<string, number>>({});
  const dockItemsRef = useRef<HTMLDivElement>(null);
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const rafRef = useRef(0);
  const draggingRef = useRef(false);
  const launchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const debouncedSave = useRef(
    debounce((s: AppStore) => {
      void invoke("save_store", { store: s }).catch((e) => console.error(String(e)));
    }, 280),
  );

  const save = useCallback((next: AppStore) => {
    setStore(next);
    debouncedSave.current(next);
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    const prevHtml = html.style.background;
    const prevBody = body.style.background;
    const prevRoot = root?.style.background ?? "";
    html.style.background = "transparent";
    body.style.background = "transparent";
    if (root) root.style.background = "transparent";
    return () => {
      html.style.background = prevHtml;
      body.style.background = prevBody;
      if (root) root.style.background = prevRoot;
    };
  }, []);

  /* 禁用右键菜单：dock 是纯启动条，屏蔽 WebView 默认右键菜单的干扰 */
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", stop);
    return () => document.removeEventListener("contextmenu", stop);
  }, []);

  /** 拖动便捷栏后写入磁盘；仅靠进程退出保存时，强退或崩溃会丢位置 */
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let moveDebounce: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const win = getCurrentWebviewWindow();
        unlisten = await win.onMoved(() => {
          if (moveDebounce) clearTimeout(moveDebounce);
          moveDebounce = setTimeout(() => {
            void saveWindowState().catch((e) => console.error(String(e)));
          }, 450);
        });
      } catch (e) {
        console.error(String(e));
      }
      if (cancelled) unlisten?.();
    })();

    return () => {
      cancelled = true;
      if (moveDebounce) clearTimeout(moveDebounce);
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    void invoke<AppStore>("load_store").then(setStore);
  }, []);

  /* ---------------- 窗口宽度自适应 ----------------
   * 宽度不设固定值：按条体内容宽度设置窗口（高度固定 132）。
   * offsetWidth 是布局宽度，不含 hover 放大的视觉外扩，测量稳定。
   * 触发时机：store 加载/更新、内容尺寸变化（增删磁贴、图标加载完成）。 */

  const fitDock = useCallback(() => {
    if (!isTauri()) return;
    const items = dockItemsRef.current;
    if (!items) return;
    // scrollWidth 是内容溢出宽度，恒等于真实内容宽；
    // 不能用 strip.offsetWidth——窗口不够宽时 strip 被 max-width 压缩，
    // offsetWidth 会坍缩到窗口宽，导致永远撑不大的死锁
    const contentW = items.scrollWidth;
    if (contentW <= 0) return;
    void invoke("fit_dock_size", { contentWidth: contentW }).catch((e) =>
      console.error(String(e)),
    );
  }, []);

  const fitDockDebounced = useRef(debounce(fitDock, 120));

  // store 变化（增删便捷项）后适配
  useEffect(() => {
    fitDockDebounced.current();
  }, [store, fitDock]);

  // 布局尺寸变化兜底：图标异步加载完成、字体渲染引起的宽度变化。
  // 依赖 store：store 为 null 时 DockBar 早退，items 尚未渲染，
  // 必须等 store 到位后重新建立观察。
  useEffect(() => {
    const items = dockItemsRef.current;
    if (!items || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitDockDebounced.current());
    ro.observe(items);
    return () => ro.disconnect();
  }, [store]);

  /** 图标区横向溢出时，用竖向滚轮也能左右滑动（避免隐藏滚动条后无法操作） */
  useEffect(() => {
    const el = dockItemsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      const dx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (Math.abs(dx) < 0.5) return;
      el.scrollLeft += dx;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store?.dock.length]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AppStore>("store-updated", (e) => {
      setStore(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (launchTimer.current) clearTimeout(launchTimer.current);
    },
    [],
  );

  /* ---------------- 交互：指针邻近放大 ---------------- */

  const clearMagnify = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setScales({});
  }, []);

  const onItemsPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || draggingRef.current) return;
    const cx = e.clientX;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const next: Record<string, number> = {};
      tileRefs.current.forEach((el, id) => {
        // 缩放以中心为原点，故 centerX 不受缩放影响，读取稳定
        const r = el.getBoundingClientRect();
        const d = cx - (r.left + r.width / 2);
        const gain = MAX_GAIN * Math.exp(-(d * d) / (2 * FIELD * FIELD));
        const s = 1 + gain;
        if (s > 1.005) next[id] = Math.round(s * 1000) / 1000;
      });
      setScales(next);
    });
  };

  /* ---------------- 交互：启动 / 增删 ---------------- */

  const onLaunch = useCallback((item: DockItem) => {
    void invoke("launch_app", { path: item.path }).catch((e) =>
      console.error(String(e)),
    );
    setLaunchedId(item.id);
    if (launchTimer.current) clearTimeout(launchTimer.current);
    launchTimer.current = setTimeout(() => setLaunchedId(null), 540);
  }, []);

  const onRemove = (id: string) => {
    if (!store) return;
    save({ ...store, dock: store.dock.filter((d) => d.id !== id) });
  };

  /* ---------------- 交互：拖拽排序（指针实现，桌面端同样可用） ---------------- */

  const moveDockItem = useCallback(
    (fromId: string, toId: string) => {
      if (!store || fromId === toId) return;
      const items: DockItem[] = [...store.dock];
      const fi = items.findIndex((d) => d.id === fromId);
      const ti = items.findIndex((d) => d.id === toId);
      if (fi < 0 || ti < 0) return;
      const [moved] = items.splice(fi, 1);
      items.splice(ti, 0, moved);
      save({ ...store, dock: items });
    },
    [store, save],
  );

  const commitDockDrag = useCallback(
    (d: DragPayload, t: DropTarget) => {
      if (d.kind === "dock" && t.kind === "dock") moveDockItem(d.id, t.id);
    },
    [moveDockItem],
  );

  const dragSort = useDragSort(commitDockDrag);

  const onTilePointerDown = (e: React.PointerEvent, id: string) => {
    dragSort.begin(e, { kind: "dock", id });
  };

  if (!store) {
    return (
      <div className="dock-shell">
        <span className="boot-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
    );
  }

  return (
    <div className="dock-shell">
      <div className="dock-strip">
        <div
          className="dock-drag-gutter dock-drag-gutter--start"
          data-tauri-drag-region
          aria-hidden
        />
        <div
          ref={dockItemsRef}
          className="dock-items"
          data-tauri-drag-region
          onPointerMove={onItemsPointerMove}
          onPointerLeave={clearMagnify}
        >
          {store.dock.map((item) => {
            const s = scales[item.id] ?? 1;
            const lift = Math.min(1, (s - 1) / MAX_GAIN);
            const tilePayload: DragPayload = { kind: "dock", id: item.id };
            const name = displayName(store, item.path, item.title);
            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) tileRefs.current.set(item.id, el);
                  else tileRefs.current.delete(item.id);
                }}
                role="button"
                tabIndex={0}
                className={
                  "dock-tile" +
                  (dragSort.isDragging(tilePayload) ? " dragging" : "") +
                  (dragSort.isTarget(tilePayload) ? " drag-over" : "") +
                  (launchedId === item.id ? " launching" : "")
                }
                style={
                  {
                    "--s": s,
                    "--lift": lift,
                    /* 放得越大越靠前，否则放大后的磁贴会被后面的兄弟节点盖住一角 */
                    zIndex: 1 + Math.round(lift * 20),
                  } as React.CSSProperties
                }
                {...dropAttr(tilePayload)}
                onPointerDown={(e) => onTilePointerDown(e, item.id)}
                onMouseDown={(e) => {
                  // 阻断 mousedown 冒泡到 document：磁贴上按下只走点击/排序，
                  // 不触发 Tauri 的窗口拖动（栏体空白处才是拖动把手）
                  e.stopPropagation();
                }}
                onClick={() => {
                  if (dragSort.consumeClickSuppression()) return;
                  onLaunch(item);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onLaunch(item);
                  }
                }}
                title={`${name}\n${item.path}`}
                aria-label={name}
              >
                <DockTileFace title={item.title} iconPath={item.iconPath} />
                <span
                  className="dock-tile-remove"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onRemove(item.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onRemove(item.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`将 ${item.title} 移出便捷栏`}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden>
                    <path
                      d="M6 6l12 12M18 6 6 18"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </div>
            );
          })}
          <div className="dock-divider" aria-hidden />
          <button
            type="button"
            className="dock-tile dock-tile-more"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDownCapture={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              void openLibrary();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openLibrary();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                void openLibrary();
              }
            }}
            title="全部应用"
            aria-label="打开全部应用"
          >
            <IconGrid size={24} strokeWidth={1.8} />
          </button>
        </div>
        <div
          className="dock-drag-gutter dock-drag-gutter--end"
          data-tauri-drag-region
          aria-hidden
        />
      </div>
    </div>
  );
}
