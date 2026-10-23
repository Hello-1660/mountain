/** 顶栏搜索框：输入 + 搜索域选择（Tab / Shift+Tab 切换） */

import { useRef, type RefObject } from "react";

import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconSearch,
} from "../../../components/icons";
import { useDismissable } from "../../../hooks/useDismissable";
import type { ScopeOption } from "../hooks/useLibraryDerived";

interface Props {
  query: string;
  onQueryChange: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  scopeId: string;
  scopeOptions: ScopeOption[];
  scopeOpen: boolean;
  onScopeOpenChange: (v: boolean) => void;
  onScopeChange: (id: string) => void;
  onCycleScope: (dir: 1 | -1) => void;
}

export default function SearchField(props: Props) {
  const {
    query,
    onQueryChange,
    searchRef,
    scopeId,
    scopeOptions,
    scopeOpen,
    onScopeOpenChange,
    onScopeChange,
    onCycleScope,
  } = props;

  const scopeWrapRef = useRef<HTMLDivElement>(null);
  useDismissable(scopeOpen, scopeWrapRef, () => onScopeOpenChange(false));

  const scopeName =
    scopeOptions.find((o) => o.id === scopeId)?.name ?? "全部应用";

  return (
    <div className="lib-search">
      <div className="lib-search-field">
        <IconSearch size={15} />
        <div className="lib-scope-wrap" ref={scopeWrapRef}>
          <button
            type="button"
            className="lib-scope"
            title="搜索范围（Tab / Shift+Tab 切换）"
            onClick={() => onScopeOpenChange(!scopeOpen)}
          >
            <span className="lib-scope-name">{scopeName}</span>
            <IconChevronDown size={11} />
          </button>
          {scopeOpen && (
            <div className="lib-scope-pop" role="listbox">
              {scopeOptions.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === scopeId}
                  className={
                    "lib-scope-item" + (o.id === scopeId ? " active" : "")
                  }
                  onClick={() => {
                    onScopeChange(o.id);
                    onScopeOpenChange(false);
                    searchRef.current?.focus();
                  }}
                >
                  {o.name}
                  {o.id === scopeId && <IconCheck size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={searchRef}
          className="lib-search-input"
          value={query}
          onChange={(e) => onQueryChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            // 仅 Tab（搜索域切换）在输入框内处理；↑↓/Enter 由
            // 全局 keydown 按统一选中变量分发（移动/启动）。
            if (e.key === "Tab") {
              e.preventDefault();
              onCycleScope(e.shiftKey ? -1 : 1);
              onScopeOpenChange(false);
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
              onQueryChange("");
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
  );
}
