/**
 * 库窗口的界面状态：选中模型、视图模式、搜索、各类浮层开合、图标主色缓存。
 *
 * 这里只存「界面上正在发生什么」，不含任何数据加载与业务动作。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useDismissable } from "../../../hooks/useDismissable";
import { DOCK_GROUP_ID } from "../../../types";
import { VIEW_STORAGE_KEY } from "../constants";
import type { ContextMenuState, ScopeId, Sel, ViewMode } from "../types";

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY);
    if (v === "grid" || v === "list") return v;
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
  return "grid";
}

export function useLibraryUi() {
  /* ---------- 统一选中模型 ---------- */
  const [sel, setSel] = useState<Sel>(null);
  const [groupId, setGroupId] = useState<ScopeId>(DOCK_GROUP_ID);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const selectGroup = useCallback((id: ScopeId) => {
    setSel({ kind: "group", id });
    setGroupId(id);
  }, []);

  const selectApp = useCallback((path: string) => {
    setSel({ kind: "app", path });
    setSelectedPath(path);
  }, []);

  /* ---------- 视图与搜索 ---------- */
  const [view, setView] = useState<ViewMode>(readViewMode);
  const [query, setQuery] = useState("");
  /** 搜索域：仅在有搜索词时生效——无输入时列表仍浏览当前分组 */
  const [searchScope, setSearchScope] = useState<ScopeId>("all");
  const [scopeOpen, setScopeOpen] = useState(false);

  /* ---------- 浮层 ---------- */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rowContextMenu, setRowContextMenu] = useState<ContextMenuState | null>(
    null,
  );
  /** 右键「从启动台移除」两步确认：防误触导致的分组/别名/钉选连带丢失 */
  const [confirmRemovePath, setConfirmRemovePath] = useState<string | null>(
    null,
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  /* ---------- 使用记录勾选 / 图标主色 / 彩蛋 ---------- */
  const [checkedRecords, setCheckedRecords] = useState<Set<string>>(new Set());
  const [tints, setTints] = useState<Record<string, string>>({});
  const [easterImg, setEasterImg] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const settingsWrapRef = useRef<HTMLDivElement>(null);
  const rowContextMenuRef = useRef<HTMLDivElement>(null);
  const navRefs = useRef(new Map<string, HTMLElement>());

  /* ---------- 副作用 ---------- */

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* 忽略 */
    }
  }, [view]);

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

  useEffect(() => {
    setRowContextMenu(null);
  }, [groupId]);

  // 菜单关闭（任意方式）时重置「从启动台移除」的两步确认态
  useEffect(() => {
    if (!rowContextMenu) setConfirmRemovePath(null);
  }, [rowContextMenu]);

  useDismissable(settingsOpen, settingsWrapRef, () => setSettingsOpen(false));
  useDismissable(!!rowContextMenu, rowContextMenuRef, () =>
    setRowContextMenu(null),
  );

  const rememberTint = useCallback((path: string, rgb: string) => {
    setTints((prev) => (prev[path] ? prev : { ...prev, [path]: rgb }));
  }, []);

  const toggleRecordCheck = useCallback((path: string, on: boolean) => {
    setCheckedRecords((prev) => {
      const next = new Set(prev);
      if (on) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);

  return {
    sel,
    setSel,
    groupId,
    setGroupId,
    selectedPath,
    setSelectedPath,
    selectGroup,
    selectApp,
    view,
    setView,
    query,
    setQuery,
    searchScope,
    setSearchScope,
    scopeOpen,
    setScopeOpen,
    settingsOpen,
    setSettingsOpen,
    rowContextMenu,
    setRowContextMenu,
    confirmRemovePath,
    setConfirmRemovePath,
    confirmDeleteId,
    setConfirmDeleteId,
    renamingGroupId,
    setRenamingGroupId,
    renameDraft,
    setRenameDraft,
    checkedRecords,
    setCheckedRecords,
    tints,
    rememberTint,
    toggleRecordCheck,
    easterImg,
    setEasterImg,
    searchRef,
    settingsWrapRef,
    rowContextMenuRef,
    navRefs,
  };
}

export type LibraryUi = ReturnType<typeof useLibraryUi>;
