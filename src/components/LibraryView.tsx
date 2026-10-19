import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { openUrl } from "@tauri-apps/plugin-opener";
import CachedAppIcon from "./CachedAppIcon";
import Toaster, { useToasts } from "./Toaster";
import { AmbientBackground, MarkLogo } from "./BrandMark";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconCopy,
  IconDownload,
  IconFlame,
  IconFolderAdd,
  IconGrid,
  IconLayers,
  IconList,
  IconPencil,
  IconPin,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconTrash,
} from "./icons";
import {
  useDragSort,
  dropAttr,
  type DragPayload,
  type DropTarget,
} from "./useDragSort";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  RECENT_GROUP_ID,
  aliasOf,
  displayName,
  normalizeLibraryStore,
  type AppCatalogDto,
  type AppGroup,
  type AppStore,
  type DockItem,
  type FileDetail,
  type ScannedApp,
  type UpdateCheckDto,
  type UsageSnapshot,
} from "../types";
import "../styles/library.css";

type ViewMode = "grid" | "list";
const VIEW_STORAGE_KEY = "mountain.library.view";

/** 与 tokens.css 的 --ui-scale 同步：启动台整体 UI 放大系数 */
const UI_SCALE = 1.15;

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "grid" || v === "list") return v;
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
  return "grid";
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

function formatScannedAt(ms: number | null): string {
  if (ms == null) return "";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return "";
  }
}

function fallbackNameFromPath(p: string): string {
  const s = p.replace(/\\/g, "/");
  const base = s.split("/").pop() ?? p;
  return base.replace(/\.(exe|lnk|bat|cmd)$/i, "") || p;
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
  /* 打开「全部应用」时默认落在「便捷启动」 */
  const [groupId, setGroupId] = useState<string | "all">(DOCK_GROUP_ID);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** 右键「从启动台移除」两步确认：防误触导致的分组/别名/钉选连带丢失 */
  const [confirmRemovePath, setConfirmRemovePath] = useState<string | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);
  const [usage, setUsage] = useState<UsageSnapshot>({
    recentPaths: [],
    frequentPaths: [],
  });
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckDto | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [rowContextMenu, setRowContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const [view, setView] = useState<ViewMode>(readViewMode);
  /** 应用图标主色 → 卡片环境色投影 */
  const [tints, setTints] = useState<Record<string, string>>({});

  const rowContextMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const navRefs = useRef(new Map<string, HTMLElement>());
  const [indicator, setIndicator] = useState({ y: 0, h: 20, show: false });
  const { toasts, push } = useToasts();

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

  const rememberTint = useCallback((path: string, rgb: string) => {
    setTints((prev) => (prev[path] ? prev : { ...prev, [path]: rgb }));
  }, []);

  useEffect(() => {
    void invoke<AppStore>("load_store").then((s) => {
      setStore(normalizeLibraryStore(s));
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AppStore>("store-updated", (e) => {
      setStore(normalizeLibraryStore(e.payload));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  /* 启动台整体 UI 放大：根元素 zoom（字体/图标/按钮/间距同比缩放）。
   * 采用浏览器缩放模型——窗口尺寸同比放大（tauri.conf library 1058×736），
   * 有效布局视口 = 窗口 ÷ 1.15 = 920×640，height:100% 链不溢出。
   * 仅 library 窗口生效（dock 窗口跑 DockBar，不加载本组件）。 */
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.zoom;
    html.style.zoom = "var(--ui-scale)";
    return () => {
      html.style.zoom = prev;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* 忽略 */
    }
  }, [view]);

  useEffect(() => {
    if (!isTauri()) {
      setAutostartLoading(false);
      return;
    }
    let alive = true;
    void isEnabled()
      .then((on) => {
        if (alive) setAutostartOn(on);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setAutostartLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleAutostartToggle = useCallback(
    async (checked: boolean) => {
      try {
        if (checked) await enable();
        else await disable();
        setAutostartOn(await isEnabled());
        push(checked ? "已开启开机自启动" : "已关闭开机自启动");
      } catch (e) {
        console.error(String(e));
      }
    },
    [push],
  );

  const reloadUsage = useCallback(() => {
    if (!isTauri()) return;
    void invoke<UsageSnapshot>("load_usage_snapshot")
      .then(setUsage)
      .catch((e) => {
        console.error(String(e));
      });
  }, []);

  useEffect(() => {
    reloadUsage();
  }, [reloadUsage]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("usage-updated", () => {
      reloadUsage();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [reloadUsage]);

  const resolvePathToApp = useCallback(
    (path: string): ScannedApp => {
      const hit = scanned.find(
        (a) => a.path.toLowerCase() === path.toLowerCase(),
      );
      if (hit) return hit;
      const dockItem = store?.dock.find(
        (d) => d.path.toLowerCase() === path.toLowerCase(),
      );
      if (dockItem) {
        return {
          name: dockItem.title,
          path: dockItem.path,
          iconPath: dockItem.iconPath,
        };
      }
      return { name: fallbackNameFromPath(path), path };
    },
    [scanned, store],
  );

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

  const dockAppsList = useMemo((): ScannedApp[] => {
    if (!store) return [];
    return store.dock.map((d) => {
      const hit = scanned.find(
        (a) => a.path.toLowerCase() === d.path.toLowerCase(),
      );
      if (hit) return hit;
      return { name: d.title, path: d.path, iconPath: d.iconPath };
    });
  }, [store, scanned]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: ScannedApp[];
    if (groupId === RECENT_GROUP_ID) {
      list = usage.recentPaths.map((p) => resolvePathToApp(p));
    } else if (groupId === FREQUENT_GROUP_ID) {
      list = usage.frequentPaths.map((e) => resolvePathToApp(e.path));
    } else if (groupId === DOCK_GROUP_ID && store) {
      list = dockAppsList;
    } else if (groupId !== "all" && store) {
      const g = store.groups.find((x) => x.id === groupId);
      if (g) {
        const set = new Set(g.paths.map((p) => p.toLowerCase()));
        list = scanned.filter((a) => set.has(a.path.toLowerCase()));
      } else {
        list = scanned;
      }
    } else {
      list = scanned;
    }
    if (!q) return list;
    return list.filter((a) => {
      const alias = aliasOf(store, a.path) ?? "";
      return (
        a.name.toLowerCase().includes(q) ||
        alias.toLowerCase().includes(q) ||
        a.path.toLowerCase().includes(q)
      );
    });
  }, [
    scanned,
    query,
    groupId,
    store,
    dockAppsList,
    usage.recentPaths,
    usage.frequentPaths,
    resolvePathToApp,
  ]);

  const frequentCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of usage.frequentPaths) {
      m[e.path.toLowerCase()] = e.count;
    }
    return m;
  }, [usage.frequentPaths]);

  const runScan = () => {
    setScanning(true);
    void invoke<AppCatalogDto>("refresh_app_catalog")
      .then(applyCatalog)
      .then(() => push("已刷新应用目录"))
      .catch((e) => console.error(String(e)))
      .finally(() => setScanning(false));
  };

  const launch = useCallback(
    (app: ScannedApp) => {
      void invoke("launch_app", {
        path: app.path,
        ...(app.workingDirectory
          ? { workingDirectory: app.workingDirectory }
          : {}),
      }).catch((e) => console.error(String(e)));
      push(`已启动 ${displayName(store, app.path, app.name)}`);
    },
    [push, store],
  );

  const pickFile = () => {
    void invoke<string | null>("pick_executable")
      .then((p) => {
        if (!p) return;
        void invoke<AppCatalogDto>("add_manual_executable", { path: p })
          .then((dto) => {
            applyCatalog(dto);
            push("已添加到应用目录");
            return invoke<DockItem>("new_dock_item", { path: p, title: null });
          })
          .then((item) => {
            setStore((prev) => {
              if (!prev) return prev;
              const next = { ...prev, dock: [...prev.dock, item] };
              debouncedSave.current(next);
              return next;
            });
          })
          .catch((e) => console.error(String(e)));
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
      push(`已固定 ${item.title} 到便捷栏`);
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
        push(`已新建分组「${g.name}」`);
      },
    );
  };

  const pinPath = useCallback(
    (path: string) => {
      if (!store) return;
      const row = scanned.find(
        (a) => a.path.toLowerCase() === path.toLowerCase(),
      );
      void invoke<DockItem>("new_dock_item", {
        path,
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
        push(`已固定 ${item.title} 到便捷栏`);
      });
    },
    [store, scanned, push],
  );

  const addPathToGroup = useCallback(
    (path: string, gid: string) => {
      if (!store) return;
      if (gid === DOCK_GROUP_ID) {
        pinPath(path);
        return;
      }
      const next = store.groups.map((g) => {
        if (g.id !== gid) return g;
        if (g.paths.some((p) => p.toLowerCase() === path.toLowerCase()))
          return g;
        return { ...g, paths: [...g.paths, path] };
      });
      persist({ ...store, groups: next });
    },
    [store, persist, pinPath],
  );

  const addSelectedToGroup = (gid: string) => {
    if (!selectedPath) return;
    addPathToGroup(selectedPath, gid);
  };

  const reorderGroups = useCallback((fromId: string, toId: string) => {
    setStore((prev) => {
      if (!prev) return prev;
      const arr = [...prev.groups];
      const fromIdx = arr.findIndex((g) => g.id === fromId);
      const toIdx = arr.findIndex((g) => g.id === toId);
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      const next = { ...prev, groups: arr };
      debouncedSave.current(next);
      return next;
    });
  }, []);

  const reorderGroupMembers = useCallback(
    (gid: string, fromPath: string, toPath: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const next: AppStore = {
          ...prev,
          groups: prev.groups.map((g) => {
            if (g.id !== gid) return g;
            const arr = [...g.paths];
            const fromIdx = arr.findIndex(
              (p) => p.toLowerCase() === fromPath.toLowerCase(),
            );
            const toIdx = arr.findIndex(
              (p) => p.toLowerCase() === toPath.toLowerCase(),
            );
            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return g;
            const [moved] = arr.splice(fromIdx, 1);
            arr.splice(toIdx, 0, moved);
            return { ...g, paths: arr };
          }),
        };
        debouncedSave.current(next);
        return next;
      });
    },
    [],
  );

  const confirmDeleteGroup = (gid: string) => {
    if (!store) return;
    persist({ ...store, groups: store.groups.filter((g) => g.id !== gid) });
    if (groupId === gid) setGroupId("all");
    if (renamingGroupId === gid) setRenamingGroupId(null);
    setConfirmDeleteId(null);
  };

  const removeFromDockByPath = (path: string) => {
    if (!store) return;
    persist({
      ...store,
      dock: store.dock.filter(
        (d) => d.path.toLowerCase() !== path.toLowerCase(),
      ),
    });
    if (selectedPath?.toLowerCase() === path.toLowerCase()) {
      setSelectedPath(null);
    }
  };

  const unpinSelected = () => {
    if (!selectedPath) return;
    removeFromDockByPath(selectedPath);
    push("已移出便捷栏");
  };

  /** 从启动台移除应用：Rust 侧原子处理目录删除 + 移除黑名单 + 清理
   * 便捷栏/分组/别名引用并广播 store 变化；手动添加同一路径即恢复。 */
  const removeApp = useCallback(
    (path: string) => {
      const hit = scanned.find(
        (a) => a.path.toLowerCase() === path.toLowerCase(),
      );
      void invoke<AppCatalogDto>("remove_app", { path })
        .then((dto) => {
          applyCatalog(dto);
          if (selectedPath?.toLowerCase() === path.toLowerCase()) {
            setSelectedPath(null);
            setDetail(null);
          }
          push(hit ? `已移除「${hit.name}」` : "已移除");
        })
        .catch((e) => {
          console.error(String(e));
          push("移除失败，请重试");
        });
    },
    [scanned, selectedPath, applyCatalog, push],
  );

  const isCustomGroupView = useMemo(() => {
    if (
      groupId === "all" ||
      groupId === DOCK_GROUP_ID ||
      groupId === RECENT_GROUP_ID ||
      groupId === FREQUENT_GROUP_ID
    ) {
      return false;
    }
    return store?.groups.some((g) => g.id === groupId) ?? false;
  }, [groupId, store]);

  /* 拖拽排序 / 拖入分组：指针实现，桌面端与浏览器行为一致 */
  const commitDrag = useCallback(
    (d: DragPayload, t: DropTarget) => {
      if (d.kind === "app" && t.kind === "app") {
        if (isCustomGroupView) reorderGroupMembers(groupId, d.path, t.path);
        return;
      }
      if (d.kind === "app" && t.kind === "group") {
        addPathToGroup(d.path, t.id);
        const g = store?.groups.find((x) => x.id === t.id);
        if (g) push(`已加入分组「${g.name}」`);
        return;
      }
      if (d.kind === "group" && t.kind === "group") reorderGroups(d.id, t.id);
    },
    [
      isCustomGroupView,
      groupId,
      reorderGroupMembers,
      addPathToGroup,
      reorderGroups,
      store,
      push,
    ],
  );

  const dragSort = useDragSort(commitDrag);

  useEffect(() => {
    setRowContextMenu(null);
  }, [groupId]);

  // 菜单关闭（任意方式）时重置「从启动台移除」的两步确认态
  useEffect(() => {
    if (!rowContextMenu) setConfirmRemovePath(null);
  }, [rowContextMenu]);

  useEffect(() => {
    if (!rowContextMenu) return;
    const onDown = (e: MouseEvent) => {
      if (rowContextMenuRef.current?.contains(e.target as Node)) return;
      setRowContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRowContextMenu(null);
    };
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [rowContextMenu]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (settingsWrapRef.current?.contains(e.target as Node)) return;
      setSettingsOpen(false);
    };
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  const removeFromCurrentGroup = (path: string) => {
    if (!store) return;
    if (
      groupId === "all" ||
      groupId === DOCK_GROUP_ID ||
      groupId === RECENT_GROUP_ID ||
      groupId === FREQUENT_GROUP_ID
    ) {
      return;
    }
    const gid = groupId;
    persist({
      ...store,
      groups: store.groups.map((g) =>
        g.id !== gid
          ? g
          : {
              ...g,
              paths: g.paths.filter(
                (p) => p.toLowerCase() !== path.toLowerCase(),
              ),
            },
      ),
    });
    setRowContextMenu(null);
  };

  const deleteGroup = (gid: string) => {
    if (
      !store ||
      gid === DOCK_GROUP_ID ||
      gid === RECENT_GROUP_ID ||
      gid === FREQUENT_GROUP_ID
    )
      return;
    setConfirmDeleteId(gid);
  };

  const commitRenameGroup = () => {
    if (!store || !renamingGroupId || !renameDraft.trim()) {
      setRenamingGroupId(null);
      return;
    }
    const name = renameDraft.trim();
    persist({
      ...store,
      groups: store.groups.map((g) =>
        g.id === renamingGroupId ? { ...g, name } : g,
      ),
    });
    setRenamingGroupId(null);
  };

  const isInDock = (path: string) =>
    store?.dock.some((d) => d.path.toLowerCase() === path.toLowerCase()) ??
    false;

  /** 设置 / 清空别名（空字符串即删除） */
  const setAlias = useCallback(
    (path: string, alias: string) => {
      if (!store) return;
      const key = path.trim().toLowerCase();
      const next: Record<string, string> = { ...(store.aliases ?? {}) };
      const v = alias.trim();
      if (v) next[key] = v;
      else delete next[key];
      persist({ ...store, aliases: next });
    },
    [store, persist],
  );

  /** 已加入的分组 */
  const joinedGroups = useMemo(() => {
    if (!store || !selectedPath) return [];
    const p = selectedPath.toLowerCase();
    return store.groups.filter((g) =>
      g.paths.some((x) => x.toLowerCase() === p),
    );
  }, [store, selectedPath]);

  const removeSelectedFromGroup = (gid: string) => {
    if (!store || !selectedPath) return;
    const p = selectedPath.toLowerCase();
    persist({
      ...store,
      groups: store.groups.map((g) =>
        g.id !== gid
          ? g
          : {
              ...g,
              paths: g.paths.filter((x) => x.toLowerCase() !== p),
            },
      ),
    });
    push("已从分组移出");
  };

  const handleCheckUpdate = useCallback(async () => {
    if (!isTauri()) return;
    setUpdateBusy(true);
    setUpdateCheck(null);
    try {
      setUpdateCheck(await invoke<UpdateCheckDto>("check_github_release"));
    } catch (e) {
      setUpdateCheck({
        currentVersion: "",
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseNotes: null,
        fetchError: String(e),
      });
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  const moveSelection = useCallback(
    (delta: number) => {
      if (filtered.length === 0) return;
      const idx = filtered.findIndex(
        (a) => a.path.toLowerCase() === selectedPath?.toLowerCase(),
      );
      const next =
        idx < 0
          ? delta > 0
            ? 0
            : filtered.length - 1
          : Math.min(filtered.length - 1, Math.max(0, idx + delta));
      setSelectedPath(filtered[next].path);
    },
    [filtered, selectedPath],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inSearch = target === searchRef.current;
      const isField =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA");

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (rowContextMenu) {
          setRowContextMenu(null);
          return;
        }
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        if (isField) {
          setQuery("");
          target?.blur();
        }
        return;
      }
      if (!inSearch) {
        if (!isField && e.key === "/") {
          e.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        moveSelection(e.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if (e.key === "Enter" && selectedPath) {
        e.preventDefault();
        launch(resolvePathToApp(selectedPath));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    moveSelection,
    launch,
    resolvePathToApp,
    settingsOpen,
    rowContextMenu,
    selectedPath,
  ]);

  /* 窗口每次拿到焦点（含从 dock 打开「全部应用」）都把光标交给搜索框 */
  useEffect(() => {
    const focusSearch = () => searchRef.current?.focus();
    focusSearch();
    const t = window.setTimeout(focusSearch, 120);
    window.addEventListener("focus", focusSearch);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("focus", focusSearch);
    };
  }, []);

  /* 侧栏选中指示器：跟随激活项滑动 */
  useLayoutEffect(() => {
    const el = navRefs.current.get(groupId);
    if (!el) {
      setIndicator((s) => ({ ...s, show: false }));
      return;
    }
    setIndicator({
      y: el.offsetTop + (el.offsetHeight - 20) / 2,
      h: 20,
      show: true,
    });
  }, [groupId, store?.groups.length]);

  const contextMenuItems = useMemo(() => {
    if (!rowContextMenu) return [];
    const path = rowContextMenu.path;
    const items: {
      key: string;
      label: string;
      danger?: boolean;
      run: () => void;
    }[] = [
      {
        key: "launch",
        label: "启动",
        run: () => {
          setRowContextMenu(null);
          launch(resolvePathToApp(path));
        },
      },
    ];
    items.push(
      isInDock(path)
        ? {
            key: "unpin",
            label: "从便捷栏移除",
            danger: true,
            run: () => {
              setRowContextMenu(null);
              removeFromDockByPath(path);
            },
          }
        : {
            key: "pin",
            label: "固定到便捷栏",
            run: () => {
              setRowContextMenu(null);
              pinPath(path);
            },
          },
    );
    if (isCustomGroupView) {
      items.push({
        key: "remove-group",
        label: "移出当前分组",
        danger: true,
        run: () => {
          setRowContextMenu(null);
          removeFromCurrentGroup(path);
        },
      });
    }
    items.push({
      key: "remove-app",
      label:
        confirmRemovePath === path ? "再点一次确认移除" : "从启动台移除",
      danger: true,
      run: () => {
        if (confirmRemovePath === path) {
          removeApp(path);
          setRowContextMenu(null);
          setConfirmRemovePath(null);
        } else {
          setConfirmRemovePath(path);
        }
      },
    });
    return items;
  }, [
    rowContextMenu,
    launch,
    resolvePathToApp,
    isInDock,
    isCustomGroupView,
    pinPath,
    confirmRemovePath,
    removeApp,
  ]);

  const contextMenuPos = useMemo(() => {
    if (!rowContextMenu) return null;
    // 根元素有 --ui-scale 缩放：clientX/Y 是视口坐标，菜单 left/top 在缩放
    // 坐标系内解释，需除以 UI_SCALE；尺寸常量同理换算。
    const pad = 6;
    const mw = 178;
    const mh = 10 + contextMenuItems.length * 34;
    const x = rowContextMenu.x / UI_SCALE;
    const y = rowContextMenu.y / UI_SCALE;
    const vw = window.innerWidth / UI_SCALE;
    const vh = window.innerHeight / UI_SCALE;
    return {
      left: Math.max(pad, Math.min(x, vw - mw - pad)),
      top: Math.max(pad, Math.min(y, vh - mh - pad)),
    };
  }, [rowContextMenu, contextMenuItems.length]);

  const currentGroupName = useMemo(() => {
    if (groupId === "all") return "全部应用";
    if (groupId === DOCK_GROUP_ID) return "便捷启动";
    if (groupId === RECENT_GROUP_ID) return "最近使用";
    if (groupId === FREQUENT_GROUP_ID) return "启动最多";
    return store?.groups.find((g) => g.id === groupId)?.name ?? "全部应用";
  }, [groupId, store]);

  const recentApps = useMemo(
    () => usage.recentPaths.slice(0, 9).map((p) => resolvePathToApp(p)),
    [usage.recentPaths, resolvePathToApp],
  );

  const showRecent =
    groupId === "all" && !query.trim() && recentApps.length > 0;

  if (!store) {
    return (
      <>
        <AmbientBackground />
        <div
          className="lib-root"
          style={{ display: "grid", placeItems: "center" }}
        >
          <span className="boot-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </>
    );
  }

  const emptyText =
    catalogBootstrapping || scanning
      ? "正在准备应用列表…"
      : groupId === DOCK_GROUP_ID
        ? "便捷栏还是空的"
        : groupId === RECENT_GROUP_ID
          ? "还没有启动记录"
          : groupId === FREQUENT_GROUP_ID
            ? "还没有常用应用"
            : query.trim()
              ? "没有匹配的应用"
              : "这里还没有应用";

  const emptyHint =
    catalogBootstrapping || scanning
      ? "首次使用需要扫描开始菜单，稍等一下"
      : groupId === DOCK_GROUP_ID
        ? "在「全部应用」里双击应用，或右键选择「固定到便捷栏」"
        : groupId === RECENT_GROUP_ID
          ? "用 Mountain 打开任意应用后，这里会留下记录"
          : groupId === FREQUENT_GROUP_ID
            ? "多次启动同一个应用后会出现在这里"
            : query.trim()
              ? "换个关键词，或清空搜索看看全部应用"
              : "试试顶部的「重新扫描」或「手动添加」";

  /** 网格 / 列表共用的外壳属性 */
  const shell = (app: ScannedApp) => {
    const payload: DragPayload = { kind: "app", path: app.path };
    const active = selectedPath?.toLowerCase() === app.path.toLowerCase();
    const cls =
      "lib-row-wrap " +
      view +
      (active ? " active" : "") +
      (dragSort.isDragging(payload) ? " dragging" : "") +
      (dragSort.isTarget(payload) ? " drop-target" : "");
    return {
      cls,
      payload,
      tint: tints[app.path],
      onMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setRowContextMenu({ path: app.path, x: e.clientX, y: e.clientY });
      },
    };
  };

  return (
    <>
      <AmbientBackground logoSize={420} />
      <div className="lib-root">
        <div className="lib-shell">
          {/* ================= 顶栏 ================= */}
          <header className="lib-top">
            <div className="lib-brand">
              <span className="lib-brand-mark">
                <MarkLogo size={22} />
              </span>
              <span className="lib-brand-text">
                <h1 className="lib-brand-name">Mountain</h1>
                <p className="lib-brand-sub">
                  {scannedAt != null
                    ? `目录已缓存 · ${formatScannedAt(scannedAt)}`
                    : `已收录 ${scanned.length} 个应用`}
                </p>
              </span>
            </div>

            <div className="lib-search">
              <div className="lib-search-field">
                <IconSearch size={15} />
                <input
                  ref={searchRef}
                  className="lib-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  placeholder="搜索应用名称或路径…"
                  aria-label="搜索应用"
                  spellCheck={false}
                />
                {query ? (
                  <button
                    type="button"
                    className="lib-search-clear"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label="清除搜索"
                  >
                    <IconClose size={12} strokeWidth={2.2} />
                  </button>
                ) : (
                  <span className="lib-kbd">Ctrl K</span>
                )}
              </div>
            </div>

            <div className="lib-actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={runScan}
                disabled={scanning}
              >
                <IconRefresh
                  size={14}
                  className={scanning ? "spin" : undefined}
                />
                {scanning ? "扫描中" : "重新扫描"}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={pickFile}
              >
                <IconPlus size={14} />
                手动添加
              </button>
              <div className="lib-settings-wrap" ref={settingsWrapRef}>
                <button
                  type="button"
                  className={"btn btn--icon" + (settingsOpen ? " is-on" : "")}
                  onClick={() => setSettingsOpen((o) => !o)}
                  aria-expanded={settingsOpen}
                  aria-label="设置"
                  title="设置"
                >
                  <IconSettings size={17} />
                </button>

                {settingsOpen && (
                  <div className="lib-popover" role="dialog" aria-label="设置">
                    <p className="lib-popover-title">设置</p>
                    <div className="lib-setting-row">
                      <span className="lib-setting-text">
                        <span className="lib-setting-name">开机自动启动</span>
                        <span className="lib-setting-hint">
                          登录后只显示桌面便捷栏，不会打开本窗口
                        </span>
                      </span>
                      <button
                        type="button"
                        className="lib-switch"
                        role="switch"
                        aria-checked={autostartOn}
                        aria-label="开机自动启动"
                        disabled={autostartLoading || !isTauri()}
                        onClick={() => void handleAutostartToggle(!autostartOn)}
                      />
                    </div>
                    <div className="lib-setting-row">
                      <span className="lib-setting-text">
                        <span className="lib-setting-name">全局快捷键</span>
                        <span className="lib-setting-hint">
                          随时呼出「全部应用」
                        </span>
                      </span>
                      <span className="lib-kbd">Alt Shift M</span>
                    </div>
                    <div className="lib-setting-row">
                      <span className="lib-setting-text">
                        <span className="lib-setting-name">版本</span>
                        <span className="lib-setting-hint">
                          {updateCheck?.currentVersion
                            ? `当前 v${updateCheck.currentVersion}`
                            : "检查 GitHub 上的新版本"}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={!isTauri() || updateBusy}
                        onClick={() => void handleCheckUpdate()}
                      >
                        {updateBusy ? "检查中…" : "检查更新"}
                      </button>
                    </div>
                    {updateCheck && (
                      <div style={{ padding: "4px 4px 0" }}>
                        {updateCheck.fetchError ? (
                          <p className="lib-warn-text">
                            {updateCheck.fetchError}
                          </p>
                        ) : updateCheck.hasUpdate && updateCheck.releaseUrl ? (
                          <button
                            type="button"
                            className="lib-link-button"
                            onClick={() => void openUrl(updateCheck.releaseUrl!)}
                          >
                            <IconDownload size={13} />
                            有新版本 {updateCheck.latestVersion}
                          </button>
                        ) : (
                          <p className="lib-setting-hint">
                            <IconCheck size={12} strokeWidth={2.4} /> 已是最新版本
                          </p>
                        )}
                      </div>
                    )}
                    {!isTauri() && (
                      <p
                        className="lib-setting-hint"
                        style={{ padding: "4px 4px 0" }}
                      >
                        以上开关仅在桌面版生效
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* ================= 左：分组导航 ================= */}
          <aside className="lib-rail">
            <div className="lib-rail-title">分组</div>
            <nav className="lib-nav">
              <div
                className="lib-nav-indicator"
                style={{
                  transform: `translateY(${indicator.y}px)`,
                  height: indicator.h,
                  opacity: indicator.show ? 1 : 0,
                }}
              />

              <button
                type="button"
                ref={(el) => {
                  if (el) navRefs.current.set("all", el);
                  else navRefs.current.delete("all");
                }}
                className={"lib-nav-item" + (groupId === "all" ? " active" : "")}
                onClick={() => setGroupId("all")}
              >
                <IconLayers size={15} />
                <span className="lib-nav-label">全部应用</span>
                <span className="lib-nav-count">{scanned.length}</span>
              </button>

              <button
                type="button"
                ref={(el) => {
                  if (el) navRefs.current.set(DOCK_GROUP_ID, el);
                  else navRefs.current.delete(DOCK_GROUP_ID);
                }}
                className={
                  "lib-nav-item" + (groupId === DOCK_GROUP_ID ? " active" : "")
                }
                onClick={() => setGroupId(DOCK_GROUP_ID)}
                title="与桌面便捷栏同步"
              >
                <IconPin size={15} />
                <span className="lib-nav-label">便捷启动</span>
                <span className="lib-nav-count">{store.dock.length}</span>
              </button>

              <button
                type="button"
                ref={(el) => {
                  if (el) navRefs.current.set(RECENT_GROUP_ID, el);
                  else navRefs.current.delete(RECENT_GROUP_ID);
                }}
                className={
                  "lib-nav-item" +
                  (groupId === RECENT_GROUP_ID ? " active" : "")
                }
                onClick={() => setGroupId(RECENT_GROUP_ID)}
                title="按最后一次从这里启动的时间排序"
              >
                <IconClock size={15} />
                <span className="lib-nav-label">最近使用</span>
                <span className="lib-nav-count">{usage.recentPaths.length}</span>
              </button>

              {store.groups.map((g) => {
                const groupPayload: DragPayload = { kind: "group", id: g.id };
                return renamingGroupId === g.id ? (
                  <div key={g.id} className="lib-group-rename">
                    <input
                      className="lib-group-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenameGroup();
                        if (e.key === "Escape") setRenamingGroupId(null);
                      }}
                      autoFocus
                      aria-label="重命名分组"
                    />
                  </div>
                ) : (
                  <div
                    key={g.id}
                    ref={(el) => {
                      if (el) navRefs.current.set(g.id, el);
                      else navRefs.current.delete(g.id);
                    }}
                    className={
                      "lib-group-row" +
                      (groupId === g.id ? " active" : "") +
                      (dragSort.isDragging(groupPayload) ? " dragging" : "") +
                      (dragSort.isTarget(groupPayload) ? " drop-target" : "")
                    }
                    {...dropAttr(groupPayload)}
                    onPointerDown={(e) => dragSort.begin(e, groupPayload)}
                  >
                    <button
                      type="button"
                      className="lib-group-main"
                      onClick={() => setGroupId(g.id)}
                      onDoubleClick={() => {
                        setRenamingGroupId(g.id);
                        setRenameDraft(g.name);
                      }}
                      title="单击查看；双击重命名；拖拽调整顺序；把应用拖到这里即可加入"
                    >
                      <IconFolderAdd size={15} />
                      <span className="lib-nav-label">{g.name}</span>
                      <span className="lib-nav-count">{g.paths.length}</span>
                    </button>

                    {confirmDeleteId === g.id ? (
                      <div className="lib-group-tools">
                        <button
                          type="button"
                          className="lib-tool-btn danger"
                          title="确认删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDeleteGroup(g.id);
                            push("分组已删除");
                          }}
                        >
                          <IconCheck size={12} strokeWidth={2.4} />
                        </button>
                        <button
                          type="button"
                          className="lib-tool-btn"
                          aria-label="取消删除"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                        >
                          <IconClose size={12} strokeWidth={2.2} />
                        </button>
                      </div>
                    ) : (
                      <div className="lib-group-tools">
                        <button
                          type="button"
                          className="lib-tool-btn"
                          title="重命名"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingGroupId(g.id);
                            setRenameDraft(g.name);
                          }}
                        >
                          <IconPencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="lib-tool-btn danger"
                          title="删除分组"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteGroup(g.id);
                          }}
                        >
                          <IconTrash size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                type="button"
                ref={(el) => {
                  if (el) navRefs.current.set(FREQUENT_GROUP_ID, el);
                  else navRefs.current.delete(FREQUENT_GROUP_ID);
                }}
                className={
                  "lib-nav-item" +
                  (groupId === FREQUENT_GROUP_ID ? " active" : "")
                }
                onClick={() => setGroupId(FREQUENT_GROUP_ID)}
                title="按累计启动次数排序"
              >
                <IconFlame size={15} />
                <span className="lib-nav-label">启动最多</span>
                <span className="lib-nav-count">
                  {usage.frequentPaths.length}
                </span>
              </button>
            </nav>

            <div className="lib-rail-foot">
              <div className="lib-new-group">
                <input
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.currentTarget.value)}
                  placeholder="新建分组…"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addGroup();
                  }}
                  aria-label="新建分组名称"
                />
                <button type="button" onClick={addGroup} aria-label="新建分组">
                  <IconPlus size={15} />
                </button>
              </div>
            </div>
          </aside>

          {/* ================= 中：主舞台 ================= */}
          <main className="lib-stage">
            {showRecent && (
              <section className="lib-recent">
                <div className="lib-recent-head">
                  <span className="lib-recent-title">最近使用</span>
                  <span className="lib-recent-sub">双击可直接启动</span>
                </div>
                {recentApps.map((a) => (
                  <button
                    key={a.path}
                    type="button"
                    className="lib-recent-item"
                    style={{ "--tint": tints[a.path] } as React.CSSProperties}
                    onClick={() => setSelectedPath(a.path)}
                    onDoubleClick={() => launch(a)}
                    title={a.name}
                  >
                    <CachedAppIcon
                      iconPath={a.iconPath}
                      className="lib-recent-icon"
                      onTint={(rgb) => rememberTint(a.path, rgb)}
                      fallback={
                        <span className="lib-recent-icon lib-recent-icon-fallback">
                          {a.name.slice(0, 1).toUpperCase()}
                        </span>
                      }
                    />
                    <span className="lib-recent-name">
                      {displayName(store, a.path, a.name)}
                    </span>
                  </button>
                ))}
              </section>
            )}

            <section className="lib-canvas">
              <div className="lib-canvas-head">
                <h2 className="lib-canvas-title">
                  {currentGroupName}
                  <span className="lib-canvas-count">{filtered.length} 个</span>
                </h2>
                <span className="lib-spacer" />
                <div className="lib-segment" role="group" aria-label="视图切换">
                  <button
                    type="button"
                    className={view === "grid" ? "active" : ""}
                    onClick={() => setView("grid")}
                    aria-pressed={view === "grid"}
                    title="网格视图"
                  >
                    <IconGrid size={14} />
                  </button>
                  <button
                    type="button"
                    className={view === "list" ? "active" : ""}
                    onClick={() => setView("list")}
                    aria-pressed={view === "list"}
                    title="列表视图"
                  >
                    <IconList size={15} />
                  </button>
                </div>
              </div>

              <div className="lib-canvas-scroll">
                {filtered.length === 0 ? (
                  <div className="lib-empty">
                    <span className="lib-empty-icon">
                      <IconSearch size={20} />
                    </span>
                    <p className="lib-empty-title">{emptyText}</p>
                    <p className="lib-empty-hint">{emptyHint}</p>
                  </div>
                ) : view === "grid" ? (
                  <ul className="lib-grid" key="grid">
                    {filtered.map((a, i) => {
                      const s = shell(a);
                      return (
                        <li
                          key={a.path}
                          style={
                            { "--i": Math.min(i, 48) } as React.CSSProperties
                          }
                        >
                          <div
                            className={s.cls}
                            style={{ "--tint": s.tint } as React.CSSProperties}
                            {...dropAttr(s.payload)}
                            onPointerDown={(e) => dragSort.begin(e, s.payload)}
                            onContextMenu={s.onMenu}
                          >
                            <button
                              type="button"
                              className="lib-card"
                              onClick={() => {
                                if (dragSort.consumeClickSuppression()) return;
                                setSelectedPath(a.path);
                              }}
                              onDoubleClick={() => launch(a)}
                              title={`${a.name}\n${a.path}`}
                            >
                              {groupId === DOCK_GROUP_ID ? (
                                <span
                                  className="lib-card-drop"
                                  role="button"
                                  tabIndex={0}
                                  aria-label={`将 ${a.name} 移出便捷栏`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeFromDockByPath(a.path);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      removeFromDockByPath(a.path);
                                    }
                                  }}
                                >
                                  <IconTrash size={11} />
                                </span>
                              ) : isInDock(a.path) ? (
                                <span
                                  className="lib-card-pin"
                                  title="已在便捷栏"
                                >
                                  <IconPin size={11} />
                                </span>
                              ) : null}

                              <CachedAppIcon
                                iconPath={a.iconPath}
                                className="lib-card-icon"
                                onTint={(rgb) => rememberTint(a.path, rgb)}
                                fallback={
                                  <span className="lib-card-icon lib-card-icon-fallback">
                                    {a.name.slice(0, 1).toUpperCase()}
                                  </span>
                                }
                              />
                              <span className="lib-card-name">
                                {displayName(store, a.path, a.name)}
                              </span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <ul className="lib-list" key="list">
                    {filtered.map((a, i) => {
                      const s = shell(a);
                      const freq = frequentCount[a.path.toLowerCase()];
                      return (
                        <li
                          key={a.path}
                          style={
                            { "--i": Math.min(i, 48) } as React.CSSProperties
                          }
                        >
                          <div
                            className={s.cls}
                            style={{ "--tint": s.tint } as React.CSSProperties}
                            {...dropAttr(s.payload)}
                            onPointerDown={(e) => dragSort.begin(e, s.payload)}
                            onContextMenu={s.onMenu}
                          >
                            <button
                              type="button"
                              className="lib-row"
                              onClick={() => {
                                if (dragSort.consumeClickSuppression()) return;
                                setSelectedPath(a.path);
                              }}
                              onDoubleClick={() => launch(a)}
                            >
                              <CachedAppIcon
                                iconPath={a.iconPath}
                                className="lib-row-icon"
                                onTint={(rgb) => rememberTint(a.path, rgb)}
                                fallback={
                                  <span className="lib-row-icon lib-row-icon-fallback">
                                    {a.name.slice(0, 1).toUpperCase()}
                                  </span>
                                }
                              />
                              <span className="lib-row-text">
                                <span className="lib-row-name">
                                  {displayName(store, a.path, a.name)}
                                </span>
                                <span className="lib-row-path">{a.path}</span>
                              </span>
                            </button>
                            {groupId === FREQUENT_GROUP_ID && freq != null && (
                              <span
                                className="lib-freq-count"
                                title="累计启动次数"
                              >
                                {freq} 次
                              </span>
                            )}
                            {groupId === DOCK_GROUP_ID && (
                              <button
                                type="button"
                                className="lib-card-drop"
                                style={{ position: "static", opacity: 1 }}
                                title="从便捷栏移除"
                                aria-label={`将 ${a.name} 移出便捷栏`}
                                onClick={() => removeFromDockByPath(a.path)}
                              >
                                <IconTrash size={13} />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </main>

          {/* ================= 右：详情 ================= */}
          <aside className="lib-inspector">
            {!selectedPath && (
              <div className="lib-inspector-empty">
                <MarkLogo size={40} />
                <span className="lib-muted">选中一个应用查看详情</span>
                <span className="lib-muted" style={{ opacity: 0.65 }}>
                  双击可直接启动
                </span>
              </div>
            )}
            {selectedPath && detail && (
              <>
                <div
                  className="lib-hero"
                  style={
                    { "--tint": tints[selectedPath] } as React.CSSProperties
                  }
                >
                  <CachedAppIcon
                    iconPath={resolvePathToApp(selectedPath).iconPath}
                    className="lib-hero-icon"
                    onTint={(rgb) => rememberTint(selectedPath, rgb)}
                    fallback={
                      <span className="lib-hero-icon lib-hero-icon-fallback">
                        {detail.name.slice(0, 1).toUpperCase()}
                      </span>
                    }
                  />
                  <h2 className="lib-hero-name">
                    {displayName(store, selectedPath, detail.name)}
                  </h2>
                  <p className="lib-hero-sub">
                    {frequentCount[selectedPath.toLowerCase()] != null
                      ? `已启动 ${frequentCount[selectedPath.toLowerCase()]} 次`
                      : isInDock(selectedPath)
                        ? "已在便捷栏"
                        : "尚未启动过"}
                  </p>
                </div>

                <div className="lib-inspector-actions">
                  <button
                    type="button"
                    className="btn btn--primary btn--lg btn--block"
                    onClick={() => launch(resolvePathToApp(selectedPath))}
                  >
                    <IconPlay size={14} />
                    启动
                  </button>
                  {isInDock(selectedPath) ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--block"
                      onClick={unpinSelected}
                    >
                      <IconTrash size={13} />
                      从便捷栏移除
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--ghost btn--block"
                      onClick={pinSelected}
                    >
                      <IconPin size={13} />
                      固定到便捷栏
                    </button>
                  )}

                  <div className="lib-field">
                    <span className="lib-field-label">别名</span>
                    <input
                      className="lib-input"
                      value={aliasOf(store, selectedPath) ?? ""}
                      placeholder={detail.name}
                      onChange={(e) =>
                        setAlias(selectedPath, e.currentTarget.value)
                      }
                      aria-label="应用别名"
                      spellCheck={false}
                    />
                  </div>

                  <div className="lib-field">
                    <span className="lib-field-label">加入分组</span>
                    <select
                      className="lib-select"
                      value=""
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        if (v) addSelectedToGroup(v);
                        e.currentTarget.value = "";
                      }}
                      aria-label="加入分组"
                    >
                      <option value="">选择分组…</option>
                      <option value={DOCK_GROUP_ID}>
                        {`便捷启动${isInDock(selectedPath) ? " ✓ 已加入" : ""}`}
                      </option>
                      {store.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {`${g.name}${
                            joinedGroups.some((x) => x.id === g.id)
                              ? " ✓ 已加入"
                              : ""
                          }`}
                        </option>
                      ))}
                    </select>

                    {joinedGroups.length > 0 && (
                      <div className="lib-chips">
                        {joinedGroups.map((g) => (
                          <span key={g.id} className="lib-chip">
                            <span className="lib-chip-text">{g.name}</span>
                            <button
                              type="button"
                              className="lib-chip-x"
                              aria-label={`从「${g.name}」移出`}
                              title={`从「${g.name}」移出`}
                              onClick={() => removeSelectedFromGroup(g.id)}
                            >
                              <IconClose size={10} strokeWidth={2.4} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="lib-meta">
                  <div
                    className="lib-meta-row copyable"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(detail.path)
                        .then(() => push("路径已复制"))
                        .catch(() => push("复制失败", "info"));
                    }}
                    title="点击复制路径"
                  >
                    <span className="lib-meta-k">
                      <IconCopy size={12} />
                    </span>
                    <span className="lib-meta-v mono">{detail.path}</span>
                  </div>
                  <div className="lib-meta-row">
                    <span className="lib-meta-k">大小</span>
                    <span className="lib-meta-v">
                      {detail.exists ? formatBytes(detail.sizeBytes) : "—"}
                      {!detail.exists && (
                        <span className="lib-warn">（文件不存在）</span>
                      )}
                    </span>
                  </div>
                  <div className="lib-meta-row">
                    <span className="lib-meta-k">便捷栏</span>
                    <span className="lib-meta-v">
                      {isInDock(selectedPath) ? "已固定" : "未固定"}
                    </span>
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>

      {rowContextMenu &&
        contextMenuPos &&
        createPortal(
          <div
            ref={rowContextMenuRef}
            className="lib-menu"
            style={{
              position: "fixed",
              left: contextMenuPos.left,
              top: contextMenuPos.top,
              zIndex: 100000,
            }}
            role="menu"
          >
            {contextMenuItems.map((it) => (
              <button
                key={it.key}
                type="button"
                className={"lib-menu-item" + (it.danger ? " danger" : "")}
                role="menuitem"
                onClick={() => {
                  // 关菜单的时机由各 run 自己决定：「从启动台移除」第一步
                  // 要留在菜单里完成两步确认
                  it.run();
                }}
              >
                {it.key === "launch" && <IconPlay size={13} />}
                {it.key === "pin" && <IconPin size={13} />}
                {it.key === "unpin" && <IconTrash size={13} />}
                {it.key === "remove-group" && <IconFolderAdd size={13} />}
                <span>{it.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      <Toaster items={toasts} />
    </>
  );
}
