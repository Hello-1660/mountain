/** 列表视图里的单个应用行（外层排序壳与右键菜单由 AppStage 提供） */

import CachedAppIcon from "../../../components/CachedAppIcon";
import { IconTrash } from "../../../components/icons";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  displayName,
  type AppStore,
  type ScannedApp,
} from "../../../types";

interface Props {
  app: ScannedApp;
  store: AppStore;
  groupId: string;
  /** 累计启动次数（仅「启动最多」视图有） */
  freq?: number;
  onSelect: (path: string) => void;
  onLaunch: (app: ScannedApp) => void;
  onRemoveFromDock: (path: string) => void;
  onTint: (path: string, rgb: string) => void;
}

export default function AppRow({
  app,
  store,
  groupId,
  freq,
  onSelect,
  onLaunch,
  onRemoveFromDock,
  onTint,
}: Props) {
  return (
    <>
      <button
        type="button"
        className="lib-row"
        onClick={() => onSelect(app.path)}
        onDoubleClick={() => onLaunch(app)}
      >
        <CachedAppIcon
          iconPath={app.iconPath}
          className="lib-row-icon"
          onTint={(rgb) => onTint(app.path, rgb)}
          fallback={
            <span className="lib-row-icon lib-row-icon-fallback">
              {app.name.slice(0, 1).toUpperCase()}
            </span>
          }
        />
        <span className="lib-row-text">
          <span className="lib-row-name">
            {displayName(store, app.path, app.name)}
          </span>
          <span className="lib-row-path">{app.path}</span>
        </span>
      </button>
      {groupId === FREQUENT_GROUP_ID && freq != null && (
        <span className="lib-freq-count" title="累计启动次数">
          {freq} 次
        </span>
      )}
      {groupId === DOCK_GROUP_ID && (
        <button
          type="button"
          className="lib-card-drop"
          style={{ position: "static", opacity: 1 }}
          title="从便捷栏移除"
          aria-label={`将 ${app.name} 移出便捷栏`}
          onClick={() => onRemoveFromDock(app.path)}
        >
          <IconTrash size={14} />
        </button>
      )}
    </>
  );
}
