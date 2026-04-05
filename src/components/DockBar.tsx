import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
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
    void invoke<AppStore>("load_store").then(setStore);
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
        <div className="dock-items">
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
