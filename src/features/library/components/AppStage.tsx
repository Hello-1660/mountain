/** 中：主舞台 —— 画布头部、使用记录工具条、网格 / 列表、空状态 */

import type { CSSProperties, MouseEvent } from "react";
import { SortableContext, rectSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { IconGrid, IconList, IconSearch } from "../../../components/icons";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  RECENT_GROUP_ID,
  type AppStore,
  type ScannedApp,
} from "../../../types";
import { SortableLi } from "./Sortable";
import AppCard from "./AppCard";
import AppRow from "./AppRow";
import type { Sel, ViewMode } from "../types";

interface Props {
  title: string;
  count: number;
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  store: AppStore;
  apps: ScannedApp[];
  groupId: string;
  sel: Sel;
  tints: Record<string, string>;
  checkedRecords: Set<string>;
  frequentCount: Record<string, number>;
  isHistoryScope: boolean;
  isInDock: (path: string) => boolean;
  scanning: boolean;
  bootstrapping: boolean;
  query: string;
  onTint: (path: string, rgb: string) => void;
  onSelectApp: (path: string) => void;
  onLaunch: (app: ScannedApp) => void;
  onRemoveFromDock: (path: string) => void;
  onToggleCheck: (path: string, on: boolean) => void;
  onContextMenu: (path: string, e: MouseEvent) => void;
  onRemoveChecked: () => void;
  onClearUsage: () => void;
}

function emptyText(
  busy: boolean,
  groupId: string,
  query: string,
): string {
  if (busy) return "正在准备应用列表…";
  if (groupId === DOCK_GROUP_ID) return "便捷栏还是空的";
  if (groupId === RECENT_GROUP_ID) return "还没有启动记录";
  if (groupId === FREQUENT_GROUP_ID) return "还没有启动记录";
  if (query.trim()) return "没有匹配的应用";
  return "这里还没有应用";
}

function emptyHint(busy: boolean, groupId: string, query: string): string {
  if (busy) return "首次使用需要扫描开始菜单，稍等一下";
  if (groupId === DOCK_GROUP_ID)
    return "在「全部应用」里双击应用，或右键选择「固定到便捷栏」";
  if (groupId === RECENT_GROUP_ID)
    return "用 Mountain 打开任意应用后，这里会留下记录";
  if (groupId === FREQUENT_GROUP_ID)
    return "用 Mountain 启动应用后，这里会按启动次数排序";
  if (query.trim()) return "换个关键词，或清空搜索看看全部应用";
  return "试试顶部的「重新扫描」或「手动添加」";
}

export default function AppStage(props: Props) {
  const {
    title,
    count,
    view,
    onViewChange,
    store,
    apps,
    groupId,
    sel,
    tints,
    checkedRecords,
    frequentCount,
    isHistoryScope,
    isInDock,
    scanning,
    bootstrapping,
    query,
    onTint,
    onSelectApp,
    onLaunch,
    onRemoveFromDock,
    onToggleCheck,
    onContextMenu,
    onRemoveChecked,
    onClearUsage,
  } = props;

  /** 网格 / 列表共用的外壳属性 */
  const shell = (app: ScannedApp) => {
    const focused = sel?.kind === "app" && sel.path === app.path;
    const cls =
      "lib-row-wrap " +
      view +
      (focused ? " is-focused" : "") +
      (checkedRecords.has(app.path) ? " is-checked" : "");
    return { cls, tint: tints[app.path] };
  };

  const onItemClick = (e: MouseEvent, app: ScannedApp) => {
    if ((e.ctrlKey || e.metaKey) && isHistoryScope) {
      e.preventDefault();
      onToggleCheck(app.path, !checkedRecords.has(app.path));
      return;
    }
    onSelectApp(app.path);
  };

  const busy = bootstrapping || scanning;

  return (
    <section className="lib-canvas">
      <div className="lib-canvas-head">
        <h2 className="lib-canvas-title">
          {title}
          <span className="lib-canvas-count">{count} 个</span>
        </h2>
        <span className="lib-spacer" />
        <div className="lib-segment" role="group" aria-label="视图切换">
          <button
            type="button"
            className={view === "grid" ? "active" : ""}
            onClick={() => onViewChange("grid")}
            aria-pressed={view === "grid"}
            title="网格视图"
          >
            <IconGrid size={14} />
          </button>
          <button
            type="button"
            className={view === "list" ? "active" : ""}
            onClick={() => onViewChange("list")}
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
              onClick={onRemoveChecked}
            >
              删除选中 ({checkedRecords.size})
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={onClearUsage}
            >
              清空全部记录
            </button>
          </div>
        </div>
      )}

      <div className="lib-canvas-scroll">
        {apps.length === 0 ? (
          <div className="lib-empty">
            <span className="lib-empty-icon">
              <IconSearch size={20} />
            </span>
            <p className="lib-empty-title">{emptyText(busy, groupId, query)}</p>
            <p className="lib-empty-hint">{emptyHint(busy, groupId, query)}</p>
          </div>
        ) : view === "grid" ? (
          <ul className="lib-grid" key="grid">
            <SortableContext
              items={apps.map((a) => "app:" + a.path)}
              strategy={rectSortingStrategy}
            >
              {apps.map((a, i) => {
                const s = shell(a);
                return (
                  <SortableLi
                    key={a.path}
                    id={"app:" + a.path}
                    style={{ "--i": Math.min(i, 48) } as CSSProperties}
                    onClick={(e) => onItemClick(e, a)}
                  >
                    <div
                      className={s.cls}
                      style={{ "--tint": s.tint } as CSSProperties}
                      onContextMenu={(e) => onContextMenu(a.path, e)}
                    >
                      <AppCard
                        app={a}
                        store={store}
                        groupId={groupId}
                        pinned={isInDock(a.path)}
                        onSelect={onSelectApp}
                        onLaunch={onLaunch}
                        onRemoveFromDock={onRemoveFromDock}
                        onTint={onTint}
                      />
                    </div>
                  </SortableLi>
                );
              })}
            </SortableContext>
          </ul>
        ) : (
          <ul className="lib-list" key="list">
            <SortableContext
              items={apps.map((a) => "app:" + a.path)}
              strategy={verticalListSortingStrategy}
            >
              {apps.map((a, i) => {
                const s = shell(a);
                return (
                  <SortableLi
                    key={a.path}
                    id={"app:" + a.path}
                    style={{ "--i": Math.min(i, 48) } as CSSProperties}
                    onClick={(e) => onItemClick(e, a)}
                  >
                    <div
                      className={s.cls}
                      style={{ "--tint": s.tint } as CSSProperties}
                      onContextMenu={(e) => onContextMenu(a.path, e)}
                    >
                      <AppRow
                        app={a}
                        store={store}
                        groupId={groupId}
                        freq={frequentCount[a.path.toLowerCase()]}
                        onSelect={onSelectApp}
                        onLaunch={onLaunch}
                        onRemoveFromDock={onRemoveFromDock}
                        onTint={onTint}
                      />
                    </div>
                  </SortableLi>
                );
              })}
            </SortableContext>
          </ul>
        )}
      </div>
    </section>
  );
}
