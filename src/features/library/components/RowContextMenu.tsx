/** 应用条目的右键菜单（portal 到 body，避免被面板裁剪） */

import { useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";

import {
  IconFolderAdd,
  IconPin,
  IconPlay,
  IconTrash,
} from "../../../components/icons";
import { CONTEXT_MENU, UI_SCALE } from "../constants";
import type { ContextMenuState, MenuItem } from "../types";
import type { ScannedApp } from "../../../types";

interface Props {
  state: ContextMenuState | null;
  menuRef: RefObject<HTMLDivElement | null>;
  confirmRemovePath: string | null;
  isInDock: (path: string) => boolean;
  isCustomGroupView: boolean;
  isHistoryScope: boolean;
  resolveApp: (path: string) => ScannedApp;
  onLaunch: (app: ScannedApp) => void;
  onPin: (path: string) => void;
  onRemoveFromDock: (path: string) => void;
  onRemoveFromCurrentGroup: (path: string) => void;
  onRemoveUsageRecord: (path: string) => void;
  onRemoveApp: (path: string) => void;
  onConfirmRemove: (path: string | null) => void;
  onClose: () => void;
}

export default function RowContextMenu({
  state,
  menuRef,
  confirmRemovePath,
  isInDock,
  isCustomGroupView,
  isHistoryScope,
  resolveApp,
  onLaunch,
  onPin,
  onRemoveFromDock,
  onRemoveFromCurrentGroup,
  onRemoveUsageRecord,
  onRemoveApp,
  onConfirmRemove,
  onClose,
}: Props) {
  const items = useMemo<MenuItem[]>(() => {
    if (!state) return [];
    const path = state.path;
    const list: MenuItem[] = [
      {
        key: "launch",
        label: "启动",
        run: () => {
          onClose();
          onLaunch(resolveApp(path));
        },
      },
    ];
    list.push(
      isInDock(path)
        ? {
            key: "unpin",
            label: "从便捷栏移除",
            danger: true,
            run: () => {
              onClose();
              onRemoveFromDock(path);
            },
          }
        : {
            key: "pin",
            label: "固定到便捷栏",
            run: () => {
              onClose();
              onPin(path);
            },
          },
    );
    if (isCustomGroupView) {
      list.push({
        key: "remove-group",
        label: "移出当前分组",
        danger: true,
        run: () => {
          onClose();
          onRemoveFromCurrentGroup(path);
        },
      });
    }
    if (isHistoryScope) {
      list.push({
        key: "remove-usage",
        label: "删除使用记录",
        danger: true,
        run: () => {
          onClose();
          onRemoveUsageRecord(path);
        },
      });
    }
    list.push({
      key: "remove-app",
      label:
        confirmRemovePath === path ? "再点一次确认移除" : "从启动台移除",
      danger: true,
      run: () => {
        if (confirmRemovePath === path) {
          onRemoveApp(path);
          onClose();
          onConfirmRemove(null);
        } else {
          onConfirmRemove(path);
        }
      },
    });
    return list;
  }, [
    state,
    confirmRemovePath,
    isInDock,
    isCustomGroupView,
    isHistoryScope,
    resolveApp,
    onLaunch,
    onPin,
    onRemoveFromDock,
    onRemoveFromCurrentGroup,
    onRemoveUsageRecord,
    onRemoveApp,
    onConfirmRemove,
    onClose,
  ]);

  /** 根元素有 --ui-scale 缩放：clientX/Y 需除以 UI_SCALE 换算回布局坐标 */
  const pos = useMemo(() => {
    if (!state) return null;
    const { pad, width, itemHeight, paddingY } = CONTEXT_MENU;
    const mh = paddingY + items.length * itemHeight;
    const x = state.x / UI_SCALE;
    const y = state.y / UI_SCALE;
    const vw = window.innerWidth / UI_SCALE;
    const vh = window.innerHeight / UI_SCALE;
    return {
      left: Math.max(pad, Math.min(x, vw - width - pad)),
      top: Math.max(pad, Math.min(y, vh - mh - pad)),
    };
  }, [state, items.length]);

  if (!state || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="lib-menu"
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 100000 }}
      role="menu"
    >
      {items.map((it) => (
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
  );
}
