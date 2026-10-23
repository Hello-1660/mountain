/** 左：分组导航 —— 内置分组、用户分组（重命名 / 删除 / 拖拽排序）、新建分组 */

import {
  useLayoutEffect,
  useState,
  type MutableRefObject,
} from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import {
  IconCheck,
  IconClose,
  IconFolderAdd,
  IconFlame,
  IconLayers,
  IconPencil,
  IconPin,
  IconPlus,
  IconTrash,
} from "../../../components/icons";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  type AppGroup,
  type AppStore,
} from "../../../types";
import { SortableDiv } from "./Sortable";
import type { Sel } from "../types";

interface Props {
  store: AppStore;
  sel: Sel;
  groupId: string;
  scannedCount: number;
  frequentCount: number;
  showFrequent: boolean;
  navRefs: MutableRefObject<Map<string, HTMLElement>>;
  renamingGroupId: string | null;
  renameDraft: string;
  confirmDeleteId: string | null;
  onSelectGroup: (id: string) => void;
  onRenameDraftChange: (v: string) => void;
  onStartRename: (g: AppGroup) => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onRequestDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  onCreateGroup: (name: string) => void;
}

export default function GroupRail(props: Props) {
  const {
    store,
    sel,
    groupId,
    scannedCount,
    frequentCount,
    showFrequent,
    navRefs,
    renamingGroupId,
    renameDraft,
    confirmDeleteId,
    onSelectGroup,
    onRenameDraftChange,
    onStartRename,
    onCommitRename,
    onCancelRename,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
    onCreateGroup,
  } = props;

  const [newGroupName, setNewGroupName] = useState("");
  /** 侧栏选中指示器：跟随激活项滑动 */
  const [indicator, setIndicator] = useState({ y: 0, h: 20, show: false });

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
  }, [groupId, store.groups.length, navRefs]);

  const createGroup = () => {
    if (!newGroupName.trim()) return;
    onCreateGroup(newGroupName.trim());
    setNewGroupName("");
  };

  return (
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
          onClick={() => onSelectGroup("all")}
        >
          <IconLayers size={15} />
          <span className="lib-nav-label">全部应用</span>
          <span className="lib-nav-count">{scannedCount}</span>
        </button>

        <button
          type="button"
          ref={(el) => {
            if (el) navRefs.current.set(DOCK_GROUP_ID, el);
            else navRefs.current.delete(DOCK_GROUP_ID);
          }}
          className={
            "lib-nav-item" +
            (sel?.kind === "group" && sel.id === DOCK_GROUP_ID
              ? " is-focused"
              : "")
          }
          onClick={() => onSelectGroup(DOCK_GROUP_ID)}
          title="与桌面便捷栏同步"
        >
          <IconPin size={15} />
          <span className="lib-nav-label">便捷启动</span>
          <span className="lib-nav-count">{store.dock.length}</span>
        </button>

        {showFrequent && (
          <button
            type="button"
            ref={(el) => {
              if (el) navRefs.current.set(FREQUENT_GROUP_ID, el);
              else navRefs.current.delete(FREQUENT_GROUP_ID);
            }}
            className={
              "lib-nav-item" +
              (sel?.kind === "group" && sel.id === FREQUENT_GROUP_ID
                ? " is-focused"
                : "")
            }
            onClick={() => onSelectGroup(FREQUENT_GROUP_ID)}
            title="按累计启动次数排序"
          >
            <IconFlame size={15} />
            <span className="lib-nav-label">启动最多</span>
            <span className="lib-nav-count">{frequentCount}</span>
          </button>
        )}

        <SortableContext
          items={store.groups.map((g) => "group:" + g.id)}
          strategy={verticalListSortingStrategy}
        >
          {store.groups.map((g) =>
            renamingGroupId === g.id ? (
              <div key={g.id} className="lib-group-rename">
                <input
                  className="lib-group-rename-input"
                  value={renameDraft}
                  onChange={(e) => onRenameDraftChange(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onCommitRename(renameDraft);
                    if (e.key === "Escape") onCancelRename();
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
                  (sel?.kind === "group" && sel.id === g.id
                    ? " is-focused"
                    : "")
                }
              >
                <button
                  type="button"
                  className="lib-group-main"
                  onClick={() => onSelectGroup(g.id)}
                  onDoubleClick={() => onStartRename(g)}
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
                        onConfirmDelete(g.id);
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
                        onCancelDelete();
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
                        onStartRename(g);
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
                        onRequestDelete(g.id);
                      }}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                )}
              </SortableDiv>
            ),
          )}
        </SortableContext>
      </nav>

      <div className="lib-rail-foot">
        <div className="lib-new-group">
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.currentTarget.value)}
            placeholder="新建分组…"
            onKeyDown={(e) => {
              if (e.key === "Enter") createGroup();
            }}
            aria-label="新建分组名称"
          />
          <button type="button" onClick={createGroup} aria-label="新建分组">
            <IconPlus size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
