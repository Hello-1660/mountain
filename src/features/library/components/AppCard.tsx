/** 网格视图里的单个应用卡片（外层排序壳与右键菜单由 AppStage 提供） */

import CachedAppIcon from "../../../components/CachedAppIcon";
import { IconPin, IconTrash } from "../../../components/icons";
import {
  DOCK_GROUP_ID,
  displayName,
  type AppStore,
  type ScannedApp,
} from "../../../types";

interface Props {
  app: ScannedApp;
  store: AppStore;
  groupId: string;
  pinned: boolean;
  onSelect: (path: string) => void;
  onLaunch: (app: ScannedApp) => void;
  onRemoveFromDock: (path: string) => void;
  onTint: (path: string, rgb: string) => void;
}

export default function AppCard({
  app,
  store,
  groupId,
  pinned,
  onSelect,
  onLaunch,
  onRemoveFromDock,
  onTint,
}: Props) {
  return (
    <button
      type="button"
      className="lib-card"
      onClick={() => onSelect(app.path)}
      onDoubleClick={() => onLaunch(app)}
      title={`${app.name}\n${app.path}`}
    >
      {groupId === DOCK_GROUP_ID ? (
        <span
          className="lib-card-drop"
          role="button"
          tabIndex={0}
          aria-label={`将 ${app.name} 移出便捷栏`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveFromDock(app.path);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemoveFromDock(app.path);
            }
          }}
        >
          <IconTrash size={14} />
        </span>
      ) : pinned ? (
        <span className="lib-card-pin" title="已在便捷栏">
          <IconPin size={11} />
        </span>
      ) : null}

      <CachedAppIcon
        iconPath={app.iconPath}
        className="lib-card-icon"
        onTint={(rgb) => onTint(app.path, rgb)}
        fallback={
          <span className="lib-card-icon lib-card-icon-fallback">
            {app.name.slice(0, 1).toUpperCase()}
          </span>
        }
      />
      <span className="lib-card-name">
        {displayName(store, app.path, app.name)}
      </span>
    </button>
  );
}
