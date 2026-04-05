import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { AppStore, DockItem } from "../types";
import "../styles/dock.css";

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

async function openLibrary() {
  const w = await WebviewWindow.getByLabel("library");
  if (!w) return;
  await w.show();
  await w.setFocus();
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

  const onDragStart = (id: string) => {
    dragId.current = id;
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
      <div className="dock-strip drag" data-tauri-drag-region>
        <div className="dock-items no-drag">
          {store.dock.map((item) => (
            <button
              key={item.id}
              type="button"
              className="dock-tile"
              draggable
              onDragStart={() => onDragStart(item.id)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(item.id)}
              onDragEnd={onDragEnd}
              onClick={() => onLaunch(item.path)}
              title={`${item.title}\n${item.path}`}
            >
              <span className="dock-tile-initial">
                {item.title.slice(0, 1).toUpperCase()}
              </span>
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
            </button>
          ))}
          <button
            type="button"
            className="dock-tile dock-tile-more"
            onClick={() => void openLibrary()}
            title="全部应用"
          >
            ⋯
          </button>
        </div>
      </div>
    </div>
  );
}
