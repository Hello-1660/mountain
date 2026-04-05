import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appIconSrc } from "../appIconSrc";
import type {
  AppCatalogDto,
  AppGroup,
  AppStore,
  DockItem,
  FileDetail,
  ScannedApp,
} from "../types";
import "../styles/library.css";

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

function formatScannedAt(ms: number | null): string {
  if (ms == null) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function LibRowIcon({ app }: { app: ScannedApp }) {
  const [broken, setBroken] = useState(false);
  const src = useMemo(() => appIconSrc(app.iconPath), [app.iconPath]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="lib-row-icon"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="lib-row-icon lib-row-icon-fallback" aria-hidden>
      {app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function DetailIcon({ name, iconPath }: { name: string; iconPath?: string }) {
  const [broken, setBroken] = useState(false);
  const src = useMemo(() => appIconSrc(iconPath), [iconPath]);
  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="lib-detail-icon"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="lib-detail-icon lib-detail-icon-fallback" aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function LibraryView() {
  const [store, setStore] = useState<AppStore | null>(null);
  const [scanned, setScanned] = useState<ScannedApp[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [catalogBootstrapping, setCatalogBootstrapping] = useState(true);
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<string | "all">("all");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const debouncedSave = useRef(
    debounce((s: AppStore) => {
      void invoke("save_store", { store: s }).catch((e) =>
        console.error(String(e)),
      );
    }, 280),
  );

  const persist = useCallback((next: AppStore) => {
    setStore(next);
    debouncedSave.current(next);
  }, []);

  useEffect(() => {
    void invoke<AppStore>("load_store").then(setStore);
  }, []);

  const applyCatalog = useCallback((dto: AppCatalogDto) => {
    setScanned(dto.apps);
    setScannedAt(dto.scannedAt);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dto = await invoke<AppCatalogDto>("load_app_catalog");
        if (!alive) return;
        applyCatalog(dto);
        if (dto.apps.length === 0) {
          setScanning(true);
          const fresh = await invoke<AppCatalogDto>("refresh_app_catalog");
          if (!alive) return;
          applyCatalog(fresh);
        }
      } catch (e) {
        console.error(String(e));
      } finally {
        if (alive) {
          setScanning(false);
          setCatalogBootstrapping(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyCatalog]);

  useEffect(() => {
    if (!selectedPath) {
      setDetail(null);
      return;
    }
    void invoke<FileDetail>("file_detail", { path: selectedPath }).then(
      setDetail,
    );
  }, [selectedPath]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = scanned;
    if (groupId !== "all" && store) {
      const g = store.groups.find((x) => x.id === groupId);
      if (g) {
        const set = new Set(g.paths.map((p) => p.toLowerCase()));
        list = scanned.filter((a) => set.has(a.path.toLowerCase()));
      }
    }
    if (!q) return list;
    return list.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q),
    );
  }, [scanned, query, groupId, store]);

  const runScan = () => {
    setScanning(true);
    void invoke<AppCatalogDto>("refresh_app_catalog")
      .then(applyCatalog)
      .catch((e) => console.error(String(e)))
      .finally(() => setScanning(false));
  };

  const pickFile = () => {
    void invoke<string | null>("pick_executable")
      .then((p) => {
        if (!p) return;
        void invoke<DockItem>("new_dock_item", {
          path: p,
          title: null,
        }).then((item) => {
          setStore((prev) => {
            if (!prev) return prev;
            const next = { ...prev, dock: [...prev.dock, item] };
            debouncedSave.current(next);
            return next;
          });
        });
      })
      .catch((e) => console.error(String(e)));
  };

  const pinSelected = () => {
    if (!selectedPath) return;
    const row = scanned.find(
      (a) => a.path.toLowerCase() === selectedPath.toLowerCase(),
    );
    void invoke<DockItem>("new_dock_item", {
      path: selectedPath,
      title: row?.name ?? null,
    }).then((item) => {
      setStore((prev) => {
        if (!prev) return prev;
        const exists = prev.dock.some(
          (d) => d.path.toLowerCase() === item.path.toLowerCase(),
        );
        if (exists) return prev;
        const next = { ...prev, dock: [...prev.dock, item] };
        debouncedSave.current(next);
        return next;
      });
    });
  };

  const addGroup = () => {
    if (!store || !newGroupName.trim()) return;
    void invoke<AppGroup>("new_group", { name: newGroupName.trim() }).then(
      (g) => {
        if (!store) return;
        persist({ ...store, groups: [...store.groups, g] });
        setNewGroupName("");
        setGroupId(g.id);
      },
    );
  };

  const addSelectedToGroup = (gid: string) => {
    if (!selectedPath || !store) return;
    const next = store.groups.map((g) => {
      if (g.id !== gid) return g;
      if (g.paths.some((p) => p.toLowerCase() === selectedPath.toLowerCase()))
        return g;
      return { ...g, paths: [...g.paths, selectedPath] };
    });
    persist({ ...store, groups: next });
  };

  if (!store) {
    return <div className="lib-root lib-loading">加载中…</div>;
  }

  return (
    <div className="lib-root">
      <header className="lib-header">
        <div className="lib-header-titles">
          <h1>全部应用</h1>
          {scannedAt != null && (
            <p className="lib-catalog-meta">
              已缓存 · 上次扫描 {formatScannedAt(scannedAt)}
            </p>
          )}
        </div>
        <div className="lib-actions">
          <button type="button" onClick={runScan} disabled={scanning}>
            {scanning ? "扫描中…" : "重新扫描开始菜单"}
          </button>
          <button type="button" onClick={pickFile}>
            手动添加可执行文件
          </button>
        </div>
      </header>

      <div className="lib-body">
        <aside className="lib-sidebar">
          <div className="lib-side-title">分组</div>
          <button
            type="button"
            className={groupId === "all" ? "lib-group active" : "lib-group"}
            onClick={() => setGroupId("all")}
          >
            全部
          </button>
          {store.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={groupId === g.id ? "lib-group active" : "lib-group"}
              onClick={() => setGroupId(g.id)}
            >
              {g.name}
              <span className="lib-group-count">{g.paths.length}</span>
            </button>
          ))}
          <div className="lib-new-group">
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.currentTarget.value)}
              placeholder="新分组名称"
            />
            <button type="button" onClick={addGroup}>
              新建
            </button>
          </div>
        </aside>

        <main className="lib-main">
          <input
            className="lib-search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="按名称或路径搜索…"
          />
          <ul className="lib-list">
            {filtered.map((a) => (
              <li key={a.path}>
                <button
                  type="button"
                  className={
                    selectedPath?.toLowerCase() === a.path.toLowerCase()
                      ? "lib-row active"
                      : "lib-row"
                  }
                  onClick={() => setSelectedPath(a.path)}
                >
                  <LibRowIcon app={a} />
                  <span className="lib-row-text">
                    <span className="lib-row-name">{a.name}</span>
                    <span className="lib-row-path">{a.path}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="lib-empty">
              {catalogBootstrapping || scanning
                ? "正在准备应用列表…"
                : "没有匹配的应用。可尝试「重新扫描」或缩小筛选范围。"}
            </p>
          )}
        </main>

        <section className="lib-detail">
          <h2>详细信息</h2>
          {!selectedPath && <p className="lib-muted">在左侧选择一个应用。</p>}
          {selectedPath && detail && (
            <>
              <DetailIcon
                name={detail.name}
                iconPath={
                  scanned.find(
                    (x) =>
                      x.path.toLowerCase() === selectedPath.toLowerCase(),
                  )?.iconPath
                }
              />
              <dl className="lib-dl">
                <dt>名称</dt>
                <dd>{detail.name}</dd>
                <dt>路径</dt>
                <dd className="lib-path">{detail.path}</dd>
                <dt>大小</dt>
                <dd>
                  {detail.exists ? formatBytes(detail.sizeBytes) : "—"}{" "}
                  {!detail.exists && (
                    <span className="lib-warn">（文件不存在）</span>
                  )}
                </dd>
              </dl>
              <div className="lib-detail-actions">
                <button
                  type="button"
                  onClick={() => void invoke("launch_app", { path: selectedPath })}
                >
                  启动
                </button>
                <button type="button" onClick={pinSelected}>
                  固定到便捷栏
                </button>
                {store.groups.length > 0 && (
                  <label className="lib-inline">
                    <span>加入分组</span>
                    <select
                      value=""
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (v) addSelectedToGroup(v);
                        e.currentTarget.value = "";
                      }}
                    >
                      <option value="">选择…</option>
                      {store.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
