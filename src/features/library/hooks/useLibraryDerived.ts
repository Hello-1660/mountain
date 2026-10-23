/**
 * 库窗口的派生数据：当前分组、搜索结果、计数、显示开关等。
 *
 * 全部由数据层 + 界面层计算得出，不额外持有状态，
 * 因此不需要担心「改了 store 忘了同步某个副本」。
 */

import { useCallback, useMemo } from "react";

import { fallbackNameFromPath } from "../../../lib/format";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  RECENT_GROUP_ID,
  aliasOf,
  type ScannedApp,
} from "../../../types";
import type { LibraryData } from "./useLibraryData";
import type { LibraryUi } from "./useLibraryUi";
import type { ScopeId } from "../types";

export interface ScopeOption {
  id: ScopeId;
  name: string;
}

export function useLibraryDerived(data: LibraryData, ui: LibraryUi) {
  const { store, scanned, removedSet, dockAppsList, usage } = data;
  const { groupId, query, searchScope } = ui;

  /* ---------- 显示开关 ---------- */

  const uiRecent = store?.ui?.showRecent ?? true;
  const uiFrequent = store?.ui?.showFrequent ?? true;

  /** 键盘可遍历的分组顺序（「最近使用」只在「全部应用」里出现，故不入列） */
  const navIds = useMemo(
    () => [
      "all",
      DOCK_GROUP_ID,
      ...(uiFrequent ? [FREQUENT_GROUP_ID] : []),
      ...(store?.groups ?? []).map((g) => g.id),
    ],
    [store, uiFrequent],
  );

  const scopeOptions = useMemo<ScopeOption[]>(
    () => [
      { id: "all", name: "全部应用" },
      { id: DOCK_GROUP_ID, name: "便捷启动" },
      ...(uiRecent ? [{ id: RECENT_GROUP_ID, name: "最近使用" }] : []),
      ...(uiFrequent ? [{ id: FREQUENT_GROUP_ID, name: "启动最多" }] : []),
      ...(store?.groups ?? []).map((g) => ({ id: g.id, name: g.name })),
    ],
    [store, uiRecent, uiFrequent],
  );

  const scopeName = useCallback(
    (id: ScopeId) =>
      scopeOptions.find((o) => o.id === id)?.name ?? "全部应用",
    [scopeOptions],
  );

  /* ---------- 列表 ---------- */

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

  /** 按分组 id 取基础列表（搜索域与视图分组共用） */
  const listForScope = useCallback(
    (scopeId: ScopeId): ScannedApp[] => {
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
  }, [query, groupId, searchScope, listForScope, store]);

  /* ---------- 各种判定与计数 ---------- */

  const frequentCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of usage.frequentPaths) {
      m[e.path.toLowerCase()] = e.count;
    }
    return m;
  }, [usage.frequentPaths]);

  /** 当前分组是否是用户自建分组（决定拖拽排序、移出分组等行为） */
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

  /** 当前列表是否为「使用记录」域（最近使用 / 启动最多） */
  const historyScopeId = query.trim() ? searchScope : groupId;
  const isHistoryScope =
    historyScopeId === RECENT_GROUP_ID || historyScopeId === FREQUENT_GROUP_ID;

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

  const isInDock = useCallback(
    (path: string) =>
      store?.dock.some((d) => d.path.toLowerCase() === path.toLowerCase()) ??
      false,
    [store],
  );

  return {
    uiRecent,
    uiFrequent,
    navIds,
    scopeOptions,
    scopeName,
    resolvePathToApp,
    listForScope,
    filtered,
    frequentCount,
    isCustomGroupView,
    isHistoryScope,
    recentApps,
    showRecent,
    isInDock,
  };
}

export type LibraryDerived = ReturnType<typeof useLibraryDerived>;
