import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { saveWindowState } from "@tauri-apps/plugin-window-state";
import CachedAppIcon from "./CachedAppIcon";
import type { AppStore, DockItem } from "../types";
import "../styles/dock.css";

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
      fallback={
        <span className="dock-tile-initial">
          {title.slice(0, 1).toUpperCase()}
        </span>
      }
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
  const dragId = useRef<string | null>(null);
  const dockItemsRef = useRef<HTMLDivElement>(null);

  const debouncedSave = useRef(
    debounce((s: AppStore) => {
      void invoke("save_store", { store: s }).catch((e) =>
        console.error(String(e)),
      );
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
            void saveWindowState().catch((e) =>
              console.error(String(e)),
            );
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

  const onLaunch = (path: string) => {
    void invoke("launch_app", { path }).catch((e) =>
      console.error(String(e)),
    );
  };

  const onRemove = (id: string) => {
    if (!store) return;
    save({ ...store, dock: store.dock.filter((d) => d.id !== id) });
  };

  const onDragStart = (e: React.DragEvent, id: string) => {
    e.stopPropagation();
    dragId.current = id;
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null;
    if (!from || !store || from === targetId) return;
    const items: DockItem[] = [...store.dock];
    const fi = items.findIndex((d) => d.id === from);
    const ti = items.findIndex((d) => d.id === targetId);
    if (fi < 0 || ti < 0) return;
    const [moved] = items.splice(fi, 1);
    items.splice(ti, 0, moved);
    save({ ...store, dock: items });
  };

  const onDragEnd = () => {
    dragId.current = null;
  };

  if (!store) {
    return (
      <div className="dock-shell dock-loading" data-tauri-drag-region>
        …
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
        <div ref={dockItemsRef} className="dock-items">
          {store.dock.map((item) => (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              className="dock-tile"
              draggable
              onDragStart={(e) => onDragStart(e, item.id)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(item.id)}
              onDragEnd={onDragEnd}
              onClick={() => onLaunch(item.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onLaunch(item.path);
                }
              }}
              title={`${item.title}\n${item.path}`}
            >
              <DockTileFace title={item.title} iconPath={item.iconPath} />
              <span
                className="dock-tile-remove"
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
                aria-label="移除"
              >
                ×
              </span>
            </div>
          ))}
          <button
            type="button"
            className="dock-tile dock-tile-more"
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
          >
            ⋯
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
