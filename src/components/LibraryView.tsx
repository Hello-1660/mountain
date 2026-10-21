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
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import CachedAppIcon from "./CachedAppIcon";
import Toaster, { useToasts } from "./Toaster";
import { AmbientBackground, MarkLogo } from "./BrandMark";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconCheck,
  IconChevronDown,
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

/* ================= dnd-kit 可排序项 =================
 * li 版（应用条目，网格/列表共用）与 div 版（分组行）。
 * listeners 挂整项（PointerSensor distance:6 约束下点击仍正常）。 */

function SortableLi({
  id,
  style,
  onClick,
  children,
}: {
  id: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={
        {
          ...style,
          transform: CSS.Transform.toString(transform),
          transition,
        } as React.CSSProperties
      }
      onClick={onClick}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      data-over={isOver || undefined}
    >
      {children}
    </li>
  );
}

function SortableDiv({
  id,
  className,
  innerRef,
  children,
}: {
  id: string;
  className?: string;
  innerRef?: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const {
    setNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        innerRef?.(el);
      }}
      className={className}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      data-over={isOver || undefined}
    >
      {children}
    </div>
  );
}

export default function LibraryView() {
  const [store, setStore] = useState<AppStore | null>(null);
  const [scanned, setScanned] = useState<ScannedApp[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  /** 「从启动台移除」黑名单：历史视图（最近/启动最多）据此过滤 */
  const [removedSet, setRemovedSet] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [catalogBootstrapping, setCatalogBootstrapping] = useState(true);
  const [query, setQuery] = useState("");
  /* 搜索域：手动切换搜索范围（默认跟随当前分组；Tab 循环切换）。
   * 仅在有搜索词时生效——无输入时列表仍浏览当前分组。 */
  const [searchScope, setSearchScope] = useState<string | "all">("all");
  const [scopeOpen, setScopeOpen] = useState(false);

  /* ---------- 统一选中模型 ----------
   * 全界面只有一个「当前选中」变量 sel，可区分分组/应用：
   *   { kind: "group", id } | { kind: "app", path } | null
   * 点击、键盘切换都只改这一个变量；分组项与应用项渲染时判断
   * “sel === 自身”绑定唯一聚焦样式 .is-focused。
   * 全局 keydown 按 sel.kind 分发：group 走分组快捷键、app 走列表快捷键。
   * （搜索框独立：自身 focus 样式不变，键盘走 input 的 onKeyDown。） */
  type Sel = { kind: "group"; id: string } | { kind: "app"; path: string } | null;
  const [sel, setSel] = useState<Sel>(null);

  /* 「最近使用 / 启动最多」显示开关：关闭只隐藏 UI，记录继续保存 */
  const uiRecent = store?.ui?.showRecent ?? true;
  const uiFrequent = store?.ui?.showFrequent ?? true;

  const toggleUiSetting = useCallback(
    (key: "showRecent" | "showFrequent", v: boolean) => {
      setStore((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ui: { ...prev.ui, [key]: v } };
        debouncedSave.current(next);
        return next;
      });
    },
    [],
  );

  const navIds = useMemo(
    () => [
      "all",
      DOCK_GROUP_ID,
      ...(uiFrequent ? [FREQUENT_GROUP_ID] : []),
      ...(store?.groups ?? []).map((g) => g.id),
    ],
    [store, uiFrequent],
  );

  const selectGroup = useCallback((id: string) => {
    setSel({ kind: "group", id });
    setGroupId(id);
  }, []);

  const selectApp = useCallback(
    (path: string) => {
      setSel({ kind: "app", path });
      setSelectedPath(path);
    },
    [],
  );

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
  /* ---------- 彩蛋：搜索框输入图片名 + Enter 弹图 ---------- */
  const EASTER_NAMES = [
    "夜雨声烦",
    "峰不语",
    "拂云秋影中",
    "札克",
    "梦道",
    "猫眼石",
    "脱氧",
    "诩",
    "雨伞",
  ] as const;
  const [easterImg, setEasterImg] = useState<string | null>(null);

  /** 本地版本号（设置面板常显，无需先点检查更新） */
  const [localVersion, setLocalVersion] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckDto | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  /* 覆盖更新流程：弹窗确认 → 下载安装包 → 静默安装并重启 */
  const [updatePrompt, setUpdatePrompt] = useState<{
    version: string;
    url: string;
  } | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);
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

  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setLocalVersion)
      .catch(() => setLocalVersion(null));
  }, []);

  /* ---------- 使用记录删除（单条 / 勾选批量 / 清空全部）---------- */
  const [checkedRecords, setCheckedRecords] = useState<Set<string>>(new Set());
  /** 当前列表是否为「使用记录」域（最近使用 / 启动最多） */
  const historyScopeId = query.trim() ? searchScope : groupId;
  const isHistoryScope =
    historyScopeId === RECENT_GROUP_ID || historyScopeId === FREQUENT_GROUP_ID;

  const toggleRecordCheck = useCallback((path: string, on: boolean) => {
    setCheckedRecords((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  const removeUsageRecord = useCallback(
    (path: string) => {
      void invoke<UsageSnapshot>("remove_usage_record", { path })
        .then((snap) => {
          setUsage(snap);
          setCheckedRecords((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
          push("已删除使用记录");
        })
        .catch((e) => {
          console.error(String(e));
          push("删除失败，请重试");
        });
    },
    [push],
  );

  const removeCheckedRecords = useCallback(() => {
    const paths = [...checkedRecords];
    if (paths.length === 0) return;
    void invoke<UsageSnapshot>("remove_usage_records", { paths })
      .then((snap) => {
        setUsage(snap);
        setCheckedRecords(new Set());
        push(`已删除 ${paths.length} 条使用记录`);
      })
      .catch((e) => {
        console.error(String(e));
        push("删除失败，请重试");
      });
  }, [checkedRecords, push]);

  const clearUsageRecords = useCallback(() => {
    void invoke<UsageSnapshot>("clear_usage_records")
      .then((snap) => {
        setUsage(snap);
        setCheckedRecords(new Set());
        push("已清空全部使用记录");
      })
      .catch((e) => {
        console.error(String(e));
        push("清空失败，请重试");
      });
  }, [push]);


  /* 覆盖更新：下载安装包 → 静默安装并重启（弹窗确认后调用） */
  const startUpdate = useCallback(async () => {
    if (!updatePrompt) return;
    setUpdateInstalling(true);
    try {
      push("正在下载更新包…");
      const setupPath = await invoke<string>("download_update", {
        url: updatePrompt.url,
      });
      push("下载完成，正在重启并安装…");
      await invoke("apply_update_and_restart", { setupPath });
      // 正常到不了这里：应用已退出，安装器接管覆盖安装
    } catch (e) {
      console.error(String(e));
      push("更新失败，请重试或到发布页手动下载");
      setUpdateInstalling(false);
    }
  }, [updatePrompt, push]);

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

  /* 屏蔽 WebView 原生右键菜单：启动台的右键交互走自定义菜单
   *（启动/固定到便捷栏/从启动台移除）。文本输入框豁免——
   * 原生的复制/粘贴/全选是有用功能，禁用它是缺陷。 */
  useEffect(() => {
    const stop = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable='true']")) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", stop);
    return () => document.removeEventListener("contextmenu", stop);
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
    setRemovedSet(new Set((dto.removed ?? []).map((r) => r.toLowerCase())));
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

  /** 按分组 id 取基础列表（搜索域与视图分组共用） */
  const listForScope = useCallback(
    (scopeId: string): ScannedApp[] => {
      if (scopeId === RECENT_GROUP_ID) {
        return usage.recentPaths
          .filter((p) => !removedSet.has(p.toLowerCase()))
          .map((p) => resolvePathToApp(p));
      }
      if (scopeId === FREQUENT_GROUP_ID) {
        return usage.frequentPaths
          .filter((e) => !removedSet.has(e.path.toLowerCase()))
          .map((e) => resolvePathToApp(e.path));
      }
      if (scopeId === DOCK_GROUP_ID && store) {
        return dockAppsList;
      }
      if (scopeId !== "all" && store) {
        const g = store.groups.find((x) => x.id === scopeId);
        if (g) {
          // 按用户拖拽排序（g.paths 顺序）渲染，而不是扫描序
          const idx = new Map(g.paths.map((p, i) => [p.toLowerCase(), i]));
          return scanned
            .filter((a) => idx.has(a.path.toLowerCase()))
            .sort(
              (a, b) =>
                (idx.get(a.path.toLowerCase()) ?? 0) -
                (idx.get(b.path.toLowerCase()) ?? 0),
            );
        }
        return scanned;
      }
      return scanned;
    },
    [usage, store, dockAppsList, scanned, resolvePathToApp, removedSet],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // 有搜索词 → 按搜索域过滤；无输入 → 浏览当前分组
    const list = listForScope(q ? searchScope : groupId);
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
    query,
    groupId,
    searchScope,
    listForScope,
    store,
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
        ...(app.shortcut ? { shortcut: app.shortcut } : {}),
        ...(app.workingDirectory
          ? { workingDirectory: app.workingDirectory }
          : {}),
      }).catch((e) => console.error(String(e)));
      push(`已启动 ${displayName(store, app.path, app.name)}`);
    },
    [push, store],
  );

  const pickFile = () => {
    void invoke<string[]>("pick_executables")
      .then((paths) => {
        const list = (paths ?? []).map((p) => p.trim()).filter(Boolean);
        if (list.length === 0) return;
        // 多选批量：一次入库，不自动钉 dock（避免便捷栏被一次塞满）
        if (list.length > 1) {
          return invoke<AppCatalogDto>("add_manual_executables", {
            paths: list,
          }).then((dto) => {
            applyCatalog(dto);
            push(`已批量添加 ${list.length} 个应用`);
          });
        }
        // 单选：保持原行为（入库 + 钉到便捷栏）
        const p = list[0];
        return invoke<AppCatalogDto>("add_manual_executable", { path: p })
          .then((dto) => {
            applyCatalog(dto);
            push("已添加到应用目录");
            return invoke<DockItem>("new_dock_item", { path: p, title: null });
          })
          .then((item) => {
            if (!item) return;
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

  /** 便捷启动视图内拖拽 = 调整 dock 顺序（与便捷栏磁贴同步） */
  const reorderDockByPaths = useCallback(
    (fromPath: string, toPath: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const arr = [...prev.dock];
        const fi = arr.findIndex(
          (d) => d.path.toLowerCase() === fromPath.toLowerCase(),
        );
        const ti = arr.findIndex(
          (d) => d.path.toLowerCase() === toPath.toLowerCase(),
        );
        if (fi < 0 || ti < 0 || fi === ti) return prev;
        const [moved] = arr.splice(fi, 1);
        arr.splice(ti, 0, moved);
        const next = { ...prev, dock: arr };
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

  /* 拖拽排序（dnd-kit）：分组栏重排、应用列表组内重排、应用拖入分组 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const split = (v: string | number) => {
        const t = String(v);
        const i = t.indexOf(":");
        return [t.slice(0, i), t.slice(i + 1)] as const;
      };
      const [ak, av] = split(active.id);
      const [ok, ov] = split(over.id);
      if (ak === "group" && ok === "group") {
        reorderGroups(av, ov);
        return;
      }
      if (ak === "app" && ok === "app") {
        if (isCustomGroupView) reorderGroupMembers(groupId, av, ov);
        else if (groupId === DOCK_GROUP_ID) reorderDockByPaths(av, ov);
        return;
      }
      if (ak === "app" && ok === "group") {
        addPathToGroup(av, ov);
        const g = store?.groups.find((x) => x.id === ov);
        if (g) push(`已加入分组「${g.name}」`);
      }
    },
    [
      isCustomGroupView,
      groupId,
      reorderGroupMembers,
      reorderDockByPaths,
      addPathToGroup,
      reorderGroups,
      store,
      push,
    ],
  );

  useEffect(() => {
    setRowContextMenu(null);
  }, [groupId]);

  // 菜单关闭（任意方式）时重置「从启动台移除」的两步确认态
  useEffect(() => {
    if (!rowContextMenu) setConfirmRemovePath(null);
  }, [rowContextMenu]);

  // 搜索域下拉：点外部 / Esc 关闭
  useEffect(() => {
    if (!scopeOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".lib-scope-wrap")) return;
      setScopeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setScopeOpen(false);
    };
    const timer = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown, true);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [scopeOpen]);

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
        downloadUrl: null,
      });
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
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
        if (scopeOpen) {
          setScopeOpen(false);
          return;
        }
        if (isField) {
          setQuery("");
          target?.blur();
        }
        return;
      }
      // 输入框豁免：非搜索框的输入框（别名/新分组等）不接管。
      // 搜索框内仅接管 ↑↓（进列表）与 Enter（启动）；←→/Home/End/
      // Backspace 等一律放行，保持原生光标移动与编辑行为。
      const isSearch = target === searchRef.current;
      if (isField && !isSearch) return;
      if (isSearch && !["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        return;
      }
      if (!isField && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      /* ---- 统一选中模型：按 sel.kind 分发快捷键 ---- */
      const groupIds = navIds;
      const groupIndexOf = (id: string) => groupIds.indexOf(id);
      // 分组逻辑
      if (sel?.kind === "group") {
        const i = groupIndexOf(sel.id);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          selectGroup(groupIds[(i + 1) % groupIds.length]);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          selectGroup(groupIds[(i - 1 + groupIds.length) % groupIds.length]);
          return;
        }
        if (e.key === "ArrowRight" || e.key === "Enter") {
          e.preventDefault();
          const first = filtered[0];
          if (first) {
            selectApp(first.path);
            if (isSearch) searchRef.current?.blur();
          }
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          selectGroup(groupIds[(i + (e.shiftKey ? -1 : 1) + groupIds.length) % groupIds.length]);
          return;
        }
        return;
      }
      // 应用逻辑
      if (sel?.kind === "app") {
        const i = filtered.findIndex((a) => a.path === sel.path);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = filtered[Math.min(i + 1, filtered.length - 1)];
          if (next) {
            selectApp(next.path);
            if (isSearch) searchRef.current?.blur();
          }
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          if (i <= 0) {
            // 到头回搜索框（选中清空，保持“一处聚焦”在搜索框）
            setSel(null);
            searchRef.current?.focus();
          } else {
            selectApp(filtered[i - 1].path);
          }
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          selectGroup(groupId);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const hit = EASTER_NAMES.find((n) => n === query.trim());
          if (hit) {
            setEasterImg(`${import.meta.env.BASE_URL}easter/${hit}.jpg`);
            return;
          }
          const a = filtered[i];
          if (a) launch(a);
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          const gi = groupIndexOf(groupId);
          selectGroup(
            groupIds[(gi + (e.shiftKey ? -1 : 1) + groupIds.length) % groupIds.length],
          );
          return;
        }
        return;
      }
      // 无选中时 Enter：命中彩蛋则弹图
      if (e.key === "Enter") {
        const hit = EASTER_NAMES.find((n) => n === query.trim());
        if (hit) {
          e.preventDefault();
          setEasterImg(`${import.meta.env.BASE_URL}easter/${hit}.jpg`);
          return;
        }
      }
      // 无选中：↑↓ 直接进入应用列表（首项/末项）
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const pick =
          e.key === "ArrowDown" ? filtered[0] : filtered[filtered.length - 1];
        if (pick) {
          selectApp(pick.path);
          if (isSearch) searchRef.current?.blur();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    sel,
    filtered,
    navIds,
    groupId,
    query,
    selectGroup,
    selectApp,
    launch,
    settingsOpen,
    rowContextMenu,
    scopeOpen,
  ]);

  /* 窗口拿到焦点时把光标交给搜索框；但键盘导航中（焦点已落在
   * 分组栏/应用列表）不抢焦点，否则 ↑↓/Tab 流会被打断。 */
  useEffect(() => {
    const focusSearch = () => {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement) return;
      searchRef.current?.focus();
    };
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
    if (isHistoryScope) {
      items.push({
        key: "remove-usage",
        label: "删除使用记录",
        danger: true,
        run: () => {
          setRowContextMenu(null);
          removeUsageRecord(path);
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
    isHistoryScope,
    removeUsageRecord,
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

  /* ---------- 搜索域（scope）---------- */
  const scopeName = useCallback(
    (id: string) => {
      if (id === "all") return "全部应用";
      if (id === DOCK_GROUP_ID) return "便捷启动";
      if (id === RECENT_GROUP_ID) return "最近使用";
      if (id === FREQUENT_GROUP_ID) return "启动最多";
      return store?.groups.find((g) => g.id === id)?.name ?? "全部应用";
    },
    [store],
  );

  const scopeOptions = useMemo(
    () => [
      { id: "all", name: "全部应用" },
      { id: DOCK_GROUP_ID, name: "便捷启动" },
      ...(uiRecent ? [{ id: RECENT_GROUP_ID, name: "最近使用" }] : []),
      ...(uiFrequent ? [{ id: FREQUENT_GROUP_ID, name: "启动最多" }] : []),
      ...(store?.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
    ],
    [store, uiRecent, uiFrequent],
  );

  /** Tab 循环切换搜索域（Shift+Tab 反向）；顺序与下拉一致 */
  const cycleScope = useCallback(
    (dir: 1 | -1) => {
      setSearchScope((cur) => {
        const ids = scopeOptions.map((o) => o.id);
        const i = ids.indexOf(cur);
        return ids[(i + dir + ids.length) % ids.length];
      });
    },
    [scopeOptions],
  );

  // 显示开关关闭后，若搜索域正停在被隐藏的域 → 回退「全部应用」
  useEffect(() => {
    setSearchScope((cur) =>
      scopeOptions.some((o) => o.id === cur) ? cur : "all",
    );
  }, [scopeOptions]);

  // 侧栏切分组时搜索域回到「默认 = 当前分组」
  useEffect(() => {
    setSearchScope(groupId);
  }, [groupId]);

  const recentApps = useMemo(
    () =>
      usage.recentPaths
        .filter((p) => !removedSet.has(p.toLowerCase()))
        .slice(0, 9)
        .map((p) => resolvePathToApp(p)),
    [usage.recentPaths, resolvePathToApp, removedSet],
  );

  const showRecent =
    uiRecent &&
    groupId === "all" &&
    !query.trim() &&
    recentApps.length > 0;

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
            ? "还没有启动记录"
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
            ? "用 Mountain 启动应用后，这里会按启动次数排序"
            : query.trim()
              ? "换个关键词，或清空搜索看看全部应用"
              : "试试顶部的「重新扫描」或「手动添加」";

  /** 网格 / 列表共用的外壳属性 */
  const shell = (app: ScannedApp) => {
    const focused = sel?.kind === "app" && sel.path === app.path;
    const cls =
      "lib-row-wrap " +
      view +
      (focused ? " is-focused" : "") +
      (checkedRecords.has(app.path) ? " is-checked" : "");
    return {
      cls,
      tint: tints[app.path],
      onMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        setRowContextMenu({ path: app.path, x: e.clientX, y: e.clientY });
      },
    };
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
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
                <div className="lib-scope-wrap">
                  <button
                    type="button"
                    className="lib-scope"
                    title="搜索范围（Tab / Shift+Tab 切换）"
                    onClick={() => setScopeOpen((v) => !v)}
                  >
                    <span className="lib-scope-name">{scopeName(searchScope)}</span>
                    <IconChevronDown size={11} />
                  </button>
                  {scopeOpen && (
                    <div className="lib-scope-pop" role="listbox">
                      {scopeOptions.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          role="option"
                          aria-selected={o.id === searchScope}
                          className={
                            "lib-scope-item" +
                            (o.id === searchScope ? " active" : "")
                          }
                          onClick={() => {
                            setSearchScope(o.id);
                            setScopeOpen(false);
                            searchRef.current?.focus();
                          }}
                        >
                          {o.name}
                          {o.id === searchScope && <IconCheck size={12} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  ref={searchRef}
                  className="lib-search-input"
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    // 仅 Tab（搜索域切换）在输入框内处理；↑↓/Enter 由
                    // 全局 keydown 按统一选中变量分发（移动/启动）。
                    if (e.key === "Tab") {
                      e.preventDefault();
                      cycleScope(e.shiftKey ? -1 : 1);
                      setScopeOpen(false);
                    }
                  }}
                  placeholder="Tab 切换搜索范围"
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
                        <span className="lib-setting-name">最近使用记录</span>
                        <span className="lib-setting-hint">
                          关闭仅隐藏入口，启动记录继续保存
                        </span>
                      </span>
                      <button
                        type="button"
                        className="lib-switch"
                        role="switch"
                        aria-checked={uiRecent}
                        aria-label="显示最近使用"
                        onClick={() => toggleUiSetting("showRecent", !uiRecent)}
                      />
                    </div>
                    <div className="lib-setting-row">
                      <span className="lib-setting-text">
                        <span className="lib-setting-name">启动最多记录</span>
                        <span className="lib-setting-hint">
                          关闭仅隐藏入口，启动次数继续统计
                        </span>
                      </span>
                      <button
                        type="button"
                        className="lib-switch"
                        role="switch"
                        aria-checked={uiFrequent}
                        aria-label="显示启动最多"
                        onClick={() =>
                          toggleUiSetting("showFrequent", !uiFrequent)
                        }
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
                          {(localVersion ?? updateCheck?.currentVersion)
                            ? `当前 v${localVersion ?? updateCheck?.currentVersion}`
                            : "本地版本"}
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
                        ) : updateCheck.hasUpdate ? (
                          <button
                            type="button"
                            className="lib-link-button"
                            disabled={updateInstalling}
                            onClick={() => {
                              const url = updateCheck.downloadUrl;
                              if (url) {
                                setUpdatePrompt({
                                  version: updateCheck.latestVersion ?? "",
                                  url,
                                });
                              } else if (updateCheck.releaseUrl) {
                                void openUrl(updateCheck.releaseUrl);
                              }
                            }}
                          >
                            <IconDownload size={13} />
                            有新版本 {updateCheck.latestVersion} · 点击更新
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
                className={
                  "lib-nav-item" +
                  (sel?.kind === "group" && sel.id === "all" ? " is-focused" : "")
                }
                onClick={() => selectGroup("all")}
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
                  "lib-nav-item" +
                  (sel?.kind === "group" && sel.id === DOCK_GROUP_ID ? " is-focused"
                    : "")
                }
                onClick={() => selectGroup(DOCK_GROUP_ID)}
                title="与桌面便捷栏同步"
              >
                <IconPin size={15} />
                <span className="lib-nav-label">便捷启动</span>
                <span className="lib-nav-count">{store.dock.length}</span>
              </button>

              {uiFrequent && (
              <button
                type="button"
                ref={(el) => {
                  if (el) navRefs.current.set(FREQUENT_GROUP_ID, el);
                  else navRefs.current.delete(FREQUENT_GROUP_ID);
                }}
                className={
                  "lib-nav-item" +
                  (sel?.kind === "group" && sel.id === FREQUENT_GROUP_ID ? " is-focused"
                    : "")
                }
                onClick={() => selectGroup(FREQUENT_GROUP_ID)}
                title="按累计启动次数排序"
              >
                <IconFlame size={15} />
                <span className="lib-nav-label">启动最多</span>
                <span className="lib-nav-count">
                  {usage.frequentPaths.length}
                </span>
              </button>
              )}

              <SortableContext
                items={store.groups.map((g) => "group:" + g.id)}
                strategy={verticalListSortingStrategy}
              >
              {store.groups.map((g) => {
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
                  <SortableDiv
                    key={g.id}
                    id={"group:" + g.id}
                    innerRef={(el) => {
                      if (el) navRefs.current.set(g.id, el);
                      else navRefs.current.delete(g.id);
                    }}
                    className={
                      "lib-group-row" +
                      (sel?.kind === "group" && sel.id === g.id ? " is-focused"
                        : "")
                    }
                  >
                    <button
                      type="button"
                      className="lib-group-main"
                      onClick={() => selectGroup(g.id)}
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
                  </SortableDiv>
                );
              })}
              </SortableContext>
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
                  {query.trim()
                    ? `${scopeName(searchScope)}`
                    : currentGroupName}
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

              {isHistoryScope && (
                <div className="lib-usage-bar">
                  <span className="lib-usage-bar-hint">
                    Ctrl+点击多选 · 右键单条删除
                  </span>
                  <div className="lib-usage-bar-actions">
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={checkedRecords.size === 0}
                      onClick={removeCheckedRecords}
                    >
                      删除选中 ({checkedRecords.size})
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={clearUsageRecords}
                    >
                      清空全部记录
                    </button>
                  </div>
                </div>
              )}

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
                    <SortableContext
                      items={filtered.map((a) => "app:" + a.path)}
                      strategy={rectSortingStrategy}
                    >
                    {filtered.map((a, i) => {
                      const s = shell(a);
                      return (
                        <SortableLi
                          key={a.path}
                          id={"app:" + a.path}
                          style={
                            { "--i": Math.min(i, 48) } as React.CSSProperties
                          }
                          onClick={(e: React.MouseEvent) => {
                            if (e.ctrlKey || e.metaKey) {
                              if (isHistoryScope) {
                                e.preventDefault();
                                toggleRecordCheck(
                                  a.path,
                                  !checkedRecords.has(a.path),
                                );
                                return;
                              }
                            }
                            selectApp(a.path);
                          }}
                        >
                          <div
                            className={s.cls}
                            style={{ "--tint": s.tint } as React.CSSProperties}
                            onContextMenu={s.onMenu}
                          >
                            <button
                              type="button"
                              className="lib-card"
                              onClick={() => {
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
                                  <IconTrash size={14} />
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
                        </SortableLi>
                      );
                    })}
                    </SortableContext>
                  </ul>
                ) : (
                  <ul className="lib-list" key="list">
                    <SortableContext
                      items={filtered.map((a) => "app:" + a.path)}
                      strategy={verticalListSortingStrategy}
                    >
                    {filtered.map((a, i) => {
                      const s = shell(a);
                      const freq = frequentCount[a.path.toLowerCase()];
                      return (
                        <SortableLi
                          key={a.path}
                          id={"app:" + a.path}
                          style={
                            { "--i": Math.min(i, 48) } as React.CSSProperties
                          }
                          onClick={(e: React.MouseEvent) => {
                            if (e.ctrlKey || e.metaKey) {
                              if (isHistoryScope) {
                                e.preventDefault();
                                toggleRecordCheck(
                                  a.path,
                                  !checkedRecords.has(a.path),
                                );
                                return;
                              }
                            }
                            selectApp(a.path);
                          }}
                        >
                          <div
                            className={s.cls}
                            style={{ "--tint": s.tint } as React.CSSProperties}
                            onContextMenu={s.onMenu}
                          >
                            <button
                              type="button"
                              className="lib-row"
                              onClick={() => {
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
                                <IconTrash size={14} />
                              </button>
                            )}
                          </div>
                        </SortableLi>
                      );
                    })}
                    </SortableContext>
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

      {updatePrompt && (
        <div
          className="lib-modal-mask"
          onClick={() => {
            if (!updateInstalling) setUpdatePrompt(null);
          }}
        >
          <div
            className="lib-modal"
            role="dialog"
            aria-modal="true"
            aria-label="更新提示"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="lib-modal-title">发现新版本</h3>
            <p className="lib-modal-body">
              当前 v{updateCheck?.currentVersion} → 新版本
              v{updatePrompt.version}
              <br />
              点击「立即更新」将下载安装包，随后自动重启并完成覆盖安装。
            </p>
            <div className="lib-modal-actions">
              <button
                type="button"
                className="btn btn--secondary"
                disabled={updateInstalling}
                onClick={() => setUpdatePrompt(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary"
                disabled={updateInstalling}
                onClick={() => void startUpdate()}
              >
                {updateInstalling ? "下载安装中…" : "立即更新"}
              </button>
            </div>
          </div>
        </div>
      )}

      {easterImg && (
        <div
          className="lib-modal-mask"
          onClick={() => setEasterImg(null)}
          role="dialog"
          aria-label="彩蛋图片"
        >
          <img
            className="lib-easter-img"
            src={easterImg}
            alt="彩蛋"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      <Toaster items={toasts} />
      </DndContext>
    </>
  );
}
