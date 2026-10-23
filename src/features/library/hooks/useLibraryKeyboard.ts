/**
 * 库窗口的全局键盘导航。
 *
 * 按统一选中模型 `sel.kind` 分发：group 走分组快捷键、app 走列表快捷键，
 * 搜索框内的 ↑↓ / Enter 也在这里接管（其余按键放给输入框原生行为）。
 */

import { useEffect, type RefObject } from "react";

import { EASTER_NAMES } from "../constants";
import type { ContextMenuState, ScopeId, Sel } from "../types";
import type { ScannedApp } from "../../../types";

interface KeyboardArgs {
  sel: Sel;
  filtered: ScannedApp[];
  navIds: ScopeId[];
  groupId: ScopeId;
  query: string;
  selectGroup: (id: ScopeId) => void;
  selectApp: (path: string) => void;
  launch: (app: ScannedApp) => void;
  setSel: (sel: Sel) => void;
  setQuery: (q: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  settingsOpen: boolean;
  scopeOpen: boolean;
  rowContextMenu: ContextMenuState | null;
  setSettingsOpen: (v: boolean) => void;
  setScopeOpen: (v: boolean) => void;
  setRowContextMenu: (v: ContextMenuState | null) => void;
  setEasterImg: (src: string | null) => void;
}

export function useLibraryKeyboard(args: KeyboardArgs): void {
  const {
    sel,
    filtered,
    navIds,
    groupId,
    query,
    selectGroup,
    selectApp,
    launch,
    setSel,
    setQuery,
    searchRef,
    settingsOpen,
    scopeOpen,
    rowContextMenu,
    setSettingsOpen,
    setScopeOpen,
    setRowContextMenu,
    setEasterImg,
  } = args;

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
      const groupIndexOf = (id: string) => navIds.indexOf(id);

      // 分组逻辑
      if (sel?.kind === "group") {
        const i = groupIndexOf(sel.id);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          selectGroup(navIds[(i + 1) % navIds.length]);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          selectGroup(navIds[(i - 1 + navIds.length) % navIds.length]);
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
          selectGroup(
            navIds[(i + (e.shiftKey ? -1 : 1) + navIds.length) % navIds.length],
          );
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
            navIds[(gi + (e.shiftKey ? -1 : 1) + navIds.length) % navIds.length],
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
    setSel,
    setQuery,
    searchRef,
    settingsOpen,
    rowContextMenu,
    scopeOpen,
    setSettingsOpen,
    setScopeOpen,
    setRowContextMenu,
    setEasterImg,
  ]);
}
