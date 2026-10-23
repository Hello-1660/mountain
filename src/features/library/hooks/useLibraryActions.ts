/**
 * 库窗口的动作层：所有会修改 store / 目录 / 使用记录的操作。
 *
 * 依赖数据层（加载与落盘）与界面层（当前选中），自身不持有数据，
 * 调用方拿到的都是可直接挂到按钮上的回调。
 */

import { useCallback } from "react";

import * as api from "../../../lib/api";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  RECENT_GROUP_ID,
  displayName,
  type ScannedApp,
} from "../../../types";
import type { LibraryData } from "./useLibraryData";
import type { LibraryUi } from "./useLibraryUi";

/** 内置虚拟分组不能删除 / 移出，只能浏览 */
function isBuiltInGroup(id: string): boolean {
  return (
    id === DOCK_GROUP_ID ||
    id === RECENT_GROUP_ID ||
    id === FREQUENT_GROUP_ID
  );
}

type Notify = (text: string, kind?: "success" | "info") => void;

export function useLibraryActions(data: LibraryData, ui: LibraryUi, notify: Notify) {
  const {
    store,
    setStore,
    persist,
    debouncedSave,
    scanned,
    applyCatalog,
    setScanning,
    setUsage,
  } = data;
  const {
    checkedRecords,
    selectedPath,
    setSelectedPath,
    groupId,
    setGroupId,
    setCheckedRecords,
    renamingGroupId,
    setRenamingGroupId,
    setConfirmDeleteId,
    setRowContextMenu,
  } = ui;

  /* ---------------- 界面开关 ---------------- */

  const toggleUiSetting = useCallback(
    (key: "showRecent" | "showFrequent", v: boolean) => {
      setStore((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ui: { ...prev.ui, [key]: v } };
        debouncedSave(next);
        return next;
      });
    },
    [setStore, debouncedSave],
  );

  /* ---------------- 启动 ---------------- */

  const launch = useCallback(
    (app: ScannedApp) => {
      void api.launchApp({
        path: app.path,
        ...(app.shortcut ? { shortcut: app.shortcut } : {}),
        ...(app.workingDirectory ? { workingDirectory: app.workingDirectory } : {}),
      }).catch((e) => console.error(String(e)));
      notify(`已启动 ${displayName(store, app.path, app.name)}`);
    },
    [store, notify],
  );

  /* ---------------- 便捷栏 ---------------- */

  const pinPath = useCallback(
    (path: string) => {
      if (!store) return;
      const row = scanned.find(
        (a) => a.path.toLowerCase() === path.toLowerCase(),
      );
      void api.newDockItem(path, row?.name ?? null).then((item) => {
        setStore((prev) => {
          if (!prev) return prev;
          const exists = prev.dock.some(
            (d) => d.path.toLowerCase() === item.path.toLowerCase(),
          );
          if (exists) return prev;
          const next = { ...prev, dock: [...prev.dock, item] };
          debouncedSave(next);
          return next;
        });
        notify(`已固定 ${item.title} 到便捷栏`);
      });
    },
    [store, scanned, setStore, debouncedSave, notify],
  );

  const pinSelected = useCallback(() => {
    if (!selectedPath) return;
    const row = scanned.find(
      (a) => a.path.toLowerCase() === selectedPath.toLowerCase(),
    );
    void api.newDockItem(selectedPath, row?.name ?? null).then((item) => {
      setStore((prev) => {
        if (!prev) return prev;
        const exists = prev.dock.some(
          (d) => d.path.toLowerCase() === item.path.toLowerCase(),
        );
        if (exists) return prev;
        const next = { ...prev, dock: [...prev.dock, item] };
        debouncedSave(next);
        return next;
      });
      notify(`已固定 ${item.title} 到便捷栏`);
    });
  }, [selectedPath, scanned, setStore, debouncedSave, notify]);

  const removeFromDockByPath = useCallback(
    (path: string) => {
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
    },
    [store, persist, selectedPath, setSelectedPath],
  );

  const unpinSelected = useCallback(() => {
    if (!selectedPath) return;
    removeFromDockByPath(selectedPath);
    notify("已移出便捷栏");
  }, [selectedPath, removeFromDockByPath, notify]);

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
        debouncedSave(next);
        return next;
      });
    },
    [setStore, debouncedSave],
  );

  /* ---------------- 分组 ---------------- */

  const addGroup = useCallback(
    (name: string) => {
      if (!store || !name.trim()) return;
      void api.newGroup(name.trim()).then((g) => {
        persist({ ...store, groups: [...store.groups, g] });
        setGroupId(g.id);
        notify(`已新建分组「${g.name}」`);
      });
    },
    [store, persist, setGroupId, notify],
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

  const addSelectedToGroup = useCallback(
    (gid: string) => {
      if (!selectedPath) return;
      addPathToGroup(selectedPath, gid);
    },
    [selectedPath, addPathToGroup],
  );

  const reorderGroups = useCallback(
    (fromId: string, toId: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const arr = [...prev.groups];
        const fromIdx = arr.findIndex((g) => g.id === fromId);
        const toIdx = arr.findIndex((g) => g.id === toId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
        const [moved] = arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, moved);
        const next = { ...prev, groups: arr };
        debouncedSave(next);
        return next;
      });
    },
    [setStore, debouncedSave],
  );

  const reorderGroupMembers = useCallback(
    (gid: string, fromPath: string, toPath: string) => {
      setStore((prev) => {
        if (!prev) return prev;
        const next = {
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
        debouncedSave(next);
        return next;
      });
    },
    [setStore, debouncedSave],
  );

  const confirmDeleteGroup = useCallback(
    (gid: string) => {
      if (!store) return;
      persist({ ...store, groups: store.groups.filter((g) => g.id !== gid) });
      if (groupId === gid) setGroupId("all");
      if (renamingGroupId === gid) setRenamingGroupId(null);
      setConfirmDeleteId(null);
      notify("分组已删除");
    },
    [
      store,
      persist,
      groupId,
      setGroupId,
      renamingGroupId,
      setRenamingGroupId,
      setConfirmDeleteId,
      notify,
    ],
  );

  const deleteGroup = useCallback(
    (gid: string) => {
      if (isBuiltInGroup(gid)) return;
      setConfirmDeleteId(gid);
    },
    [setConfirmDeleteId],
  );

  const commitRenameGroup = useCallback(
    (name: string) => {
      if (!store || !renamingGroupId || !name.trim()) {
        setRenamingGroupId(null);
        return;
      }
      const value = name.trim();
      persist({
        ...store,
        groups: store.groups.map((g) =>
          g.id === renamingGroupId ? { ...g, name: value } : g,
        ),
      });
      setRenamingGroupId(null);
    },
    [store, persist, renamingGroupId, setRenamingGroupId],
  );

  const removeFromCurrentGroup = useCallback(
    (path: string) => {
      if (!store) return;
      if (groupId === "all" || isBuiltInGroup(groupId)) return;
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
    },
    [store, groupId, persist, setRowContextMenu],
  );

  const removeSelectedFromGroup = useCallback(
    (gid: string) => {
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
      notify("已从分组移出");
    },
    [store, selectedPath, persist, notify],
  );

  /* ---------------- 别名 ---------------- */

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

  /* ---------------- 应用目录 ---------------- */

  const runScan = useCallback(() => {
    setScanning(true);
    void api
      .refreshAppCatalog()
      .then(applyCatalog)
      .then(() => notify("已刷新应用目录"))
      .catch((e) => console.error(String(e)))
      .finally(() => setScanning(false));
  }, [setScanning, applyCatalog, notify]);

  /** 手动添加：多选批量入库，单选额外钉到便捷栏 */
  const pickFile = useCallback(() => {
    void api
      .pickExecutables()
      .then((paths) => {
        const list = (paths ?? []).map((p) => p.trim()).filter(Boolean);
        if (list.length === 0) return;
        // 多选批量：一次入库，不自动钉 dock（避免便捷栏被一次塞满）
        if (list.length > 1) {
          return api.addManualExecutables(list).then((dto) => {
            applyCatalog(dto);
            notify(`已批量添加 ${list.length} 个应用`);
          });
        }
        // 单选：保持原行为（入库 + 钉到便捷栏）
        const p = list[0];
        return api.addManualExecutable(p).then((dto) => {
          applyCatalog(dto);
          notify("已添加到应用目录");
          return api.newDockItem(p, null);
        }).then((item) => {
          if (!item) return;
          setStore((prev) => {
            if (!prev) return prev;
            const next = { ...prev, dock: [...prev.dock, item] };
            debouncedSave(next);
            return next;
          });
        });
      })
      .catch((e) => console.error(String(e)));
  }, [applyCatalog, notify, setStore, debouncedSave]);

  /** 从启动台移除：Rust 侧原子处理目录删除 + 黑名单 + 引用清理 */
  const removeApp = useCallback(
    (path: string) => {
      const hit = scanned.find(
        (a) => a.path.toLowerCase() === path.toLowerCase(),
      );
      void api
        .removeApp(path)
        .then((dto) => {
          applyCatalog(dto);
          if (selectedPath?.toLowerCase() === path.toLowerCase()) {
            setSelectedPath(null);
          }
          notify(hit ? `已移除「${hit.name}」` : "已移除");
        })
        .catch((e) => {
          console.error(String(e));
          notify("移除失败，请重试");
        });
    },
    [scanned, selectedPath, setSelectedPath, applyCatalog, notify],
  );

  /* ---------------- 使用记录 ---------------- */

  const removeUsageRecord = useCallback(
    (path: string) => {
      void api
        .removeUsageRecord(path)
        .then((snap) => {
          setUsage(snap);
          setCheckedRecords((prev) => {
            const next = new Set(prev);
            next.delete(path);
            return next;
          });
          notify("已删除使用记录");
        })
        .catch((e) => {
          console.error(String(e));
          notify("删除失败，请重试");
        });
    },
    [setUsage, setCheckedRecords, notify],
  );

  const removeCheckedRecords = useCallback(() => {
    const paths = [...checkedRecords];
    if (paths.length === 0) return;
    void api
      .removeUsageRecords(paths)
      .then((snap) => {
        setUsage(snap);
        setCheckedRecords(new Set());
        notify(`已删除 ${paths.length} 条使用记录`);
      })
      .catch((e) => {
        console.error(String(e));
        notify("删除失败，请重试");
      });
  }, [checkedRecords, setUsage, setCheckedRecords, notify]);

  const clearUsageRecords = useCallback(() => {
    void api
      .clearUsageRecords()
      .then((snap) => {
        setUsage(snap);
        setCheckedRecords(new Set());
        notify("已清空全部使用记录");
      })
      .catch((e) => {
        console.error(String(e));
        notify("清空失败，请重试");
      });
  }, [setUsage, setCheckedRecords, notify]);

  return {
    toggleUiSetting,
    launch,
    pinPath,
    pinSelected,
    removeFromDockByPath,
    unpinSelected,
    reorderDockByPaths,
    addGroup,
    addPathToGroup,
    addSelectedToGroup,
    reorderGroups,
    reorderGroupMembers,
    confirmDeleteGroup,
    deleteGroup,
    commitRenameGroup,
    removeFromCurrentGroup,
    removeSelectedFromGroup,
    setAlias,
    runScan,
    pickFile,
    removeApp,
    removeUsageRecord,
    removeCheckedRecords,
    clearUsageRecords,
  };
}

export type LibraryActions = ReturnType<typeof useLibraryActions>;
