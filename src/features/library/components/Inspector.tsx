/** 右：详情面板 —— hero、启动/固定、别名、分组、文件元信息 */

import { useMemo, type CSSProperties } from "react";

import CachedAppIcon from "../../../components/CachedAppIcon";
import { MarkLogo } from "../../../components/BrandMark";
import { IconClose, IconCopy, IconPin, IconPlay, IconTrash } from "../../../components/icons";
import { formatBytes } from "../../../lib/format";
import {
  DOCK_GROUP_ID,
  aliasOf,
  displayName,
  type AppStore,
  type FileDetail,
  type ScannedApp,
} from "../../../types";

interface Props {
  store: AppStore;
  selectedPath: string | null;
  detail: FileDetail | null;
  tints: Record<string, string>;
  frequentCount: Record<string, number>;
  resolveApp: (path: string) => ScannedApp;
  isInDock: (path: string) => boolean;
  onTint: (path: string, rgb: string) => void;
  onLaunch: (app: ScannedApp) => void;
  onPin: () => void;
  onUnpin: () => void;
  onSetAlias: (path: string, alias: string) => void;
  onAddToGroup: (groupId: string) => void;
  onRemoveFromGroup: (groupId: string) => void;
  notify: (text: string, kind?: "success" | "info") => void;
}

export default function Inspector({
  store,
  selectedPath,
  detail,
  tints,
  frequentCount,
  resolveApp,
  isInDock,
  onTint,
  onLaunch,
  onPin,
  onUnpin,
  onSetAlias,
  onAddToGroup,
  onRemoveFromGroup,
  notify,
}: Props) {
  /** 已加入的分组 */
  const joinedGroups = useMemo(() => {
    if (!selectedPath) return [];
    const p = selectedPath.toLowerCase();
    return store.groups.filter((g) =>
      g.paths.some((x) => x.toLowerCase() === p),
    );
  }, [store, selectedPath]);

  if (!selectedPath) {
    return (
      <aside className="lib-inspector">
        <div className="lib-inspector-empty">
          <MarkLogo size={40} />
          <span className="lib-muted">选中一个应用查看详情</span>
          <span className="lib-muted" style={{ opacity: 0.65 }}>
            双击可直接启动
          </span>
        </div>
      </aside>
    );
  }

  return (
    <aside className="lib-inspector">
      {detail && (
        <>
          <div
            className="lib-hero"
            style={{ "--tint": tints[selectedPath] } as CSSProperties}
          >
            <CachedAppIcon
              iconPath={resolveApp(selectedPath).iconPath}
              className="lib-hero-icon"
              onTint={(rgb) => onTint(selectedPath, rgb)}
              fallback={
                <span className="lib-hero-icon lib-hero-icon-fallback">
                  {detail.name.slice(0, 1).toUpperCase()}
                </span>
              }
            />
            <h2 className="lib-hero-name">
              {displayName(store, selectedPath, detail.name)}
            </h2>
            <p className="lib-hero-sub">
              {frequentCount[selectedPath.toLowerCase()] != null
                ? `已启动 ${frequentCount[selectedPath.toLowerCase()]} 次`
                : isInDock(selectedPath)
                  ? "已在便捷栏"
                  : "尚未启动过"}
            </p>
          </div>

          <div className="lib-inspector-actions">
            <button
              type="button"
              className="btn btn--primary btn--lg btn--block"
              onClick={() => onLaunch(resolveApp(selectedPath))}
            >
              <IconPlay size={14} />
              启动
            </button>
            {isInDock(selectedPath) ? (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={onUnpin}
              >
                <IconTrash size={13} />
                从便捷栏移除
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={onPin}
              >
                <IconPin size={13} />
                固定到便捷栏
              </button>
            )}

            <div className="lib-field">
              <span className="lib-field-label">别名</span>
              <input
                className="lib-input"
                value={aliasOf(store, selectedPath) ?? ""}
                placeholder={detail.name}
                onChange={(e) => onSetAlias(selectedPath, e.currentTarget.value)}
                aria-label="应用别名"
                spellCheck={false}
              />
            </div>

            <div className="lib-field">
              <span className="lib-field-label">加入分组</span>
              <select
                className="lib-select"
                value=""
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  if (v) onAddToGroup(v);
                  e.currentTarget.value = "";
                }}
                aria-label="加入分组"
              >
                <option value="">选择分组…</option>
                <option value={DOCK_GROUP_ID}>
                  {`便捷启动${isInDock(selectedPath) ? " ✓ 已加入" : ""}`}
                </option>
                {store.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {`${g.name}${
                      joinedGroups.some((x) => x.id === g.id) ? " ✓ 已加入" : ""
                    }`}
                  </option>
                ))}
              </select>

              {joinedGroups.length > 0 && (
                <div className="lib-chips">
                  {joinedGroups.map((g) => (
                    <span key={g.id} className="lib-chip">
                      <span className="lib-chip-text">{g.name}</span>
                      <button
                        type="button"
                        className="lib-chip-x"
                        aria-label={`从「${g.name}」移出`}
                        title={`从「${g.name}」移出`}
                        onClick={() => onRemoveFromGroup(g.id)}
                      >
                        <IconClose size={10} strokeWidth={2.4} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="lib-meta">
            <div
              className="lib-meta-row copyable"
              onClick={() => {
                navigator.clipboard
                  ?.writeText(detail.path)
                  .then(() => notify("路径已复制"))
                  .catch(() => notify("复制失败", "info"));
              }}
              title="点击复制路径"
            >
              <span className="lib-meta-k">
                <IconCopy size={12} />
              </span>
              <span className="lib-meta-v mono">{detail.path}</span>
            </div>
            <div className="lib-meta-row">
              <span className="lib-meta-k">大小</span>
              <span className="lib-meta-v">
                {detail.exists ? formatBytes(detail.sizeBytes) : "—"}
                {!detail.exists && (
                  <span className="lib-warn">（文件不存在）</span>
                )}
              </span>
            </div>
            <div className="lib-meta-row">
              <span className="lib-meta-k">便捷栏</span>
              <span className="lib-meta-v">
                {isInDock(selectedPath) ? "已固定" : "未固定"}
              </span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
