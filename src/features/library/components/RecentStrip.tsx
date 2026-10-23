/** 「全部应用」顶部的「最近使用」横带 */

import type { CSSProperties } from "react";

import CachedAppIcon from "../../../components/CachedAppIcon";
import { displayName, type AppStore, type ScannedApp } from "../../../types";

interface Props {
  apps: ScannedApp[];
  store: AppStore;
  tints: Record<string, string>;
  onTint: (path: string, rgb: string) => void;
  onSelect: (path: string) => void;
  onLaunch: (app: ScannedApp) => void;
}

export default function RecentStrip({
  apps,
  store,
  tints,
  onTint,
  onSelect,
  onLaunch,
}: Props) {
  if (apps.length === 0) return null;
  return (
    <section className="lib-recent">
      <div className="lib-recent-head">
        <span className="lib-recent-title">最近使用</span>
        <span className="lib-recent-sub">双击可直接启动</span>
      </div>
      {apps.map((a) => (
        <button
          key={a.path}
          type="button"
          className="lib-recent-item"
          style={{ "--tint": tints[a.path] } as CSSProperties}
          onClick={() => onSelect(a.path)}
          onDoubleClick={() => onLaunch(a)}
          title={a.name}
        >
          <CachedAppIcon
            iconPath={a.iconPath}
            className="lib-recent-icon"
            onTint={(rgb) => onTint(a.path, rgb)}
            fallback={
              <span className="lib-recent-icon lib-recent-icon-fallback">
                {a.name.slice(0, 1).toUpperCase()}
              </span>
            }
          />
          <span className="lib-recent-name">
            {displayName(store, a.path, a.name)}
          </span>
        </button>
      ))}
    </section>
  );
}
