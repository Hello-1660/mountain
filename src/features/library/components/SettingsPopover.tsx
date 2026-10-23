/** 设置浮层：开机自启、最近/启动最多开关、版本与更新 */

import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

import { IconCheck, IconDownload } from "../../../components/icons";
import type { Settings } from "../hooks/useSettings";

interface Props {
  settings: Settings;
  showRecent: boolean;
  showFrequent: boolean;
  onToggleUiSetting: (key: "showRecent" | "showFrequent", v: boolean) => void;
}

export default function SettingsPopover({
  settings,
  showRecent,
  showFrequent,
  onToggleUiSetting,
}: Props) {
  const {
    autostartOn,
    autostartLoading,
    handleAutostartToggle,
    localVersion,
    updateCheck,
    updateBusy,
    handleCheckUpdate,
    updateInstalling,
    setUpdatePrompt,
  } = settings;

  return (
    <div className="lib-popover" role="dialog" aria-label="设置">
      <p className="lib-popover-title">设置</p>

      <div className="lib-setting-row">
        <span className="lib-setting-text">
          <span className="lib-setting-name">开机自动启动</span>
          <span className="lib-setting-hint">
            登录后只显示桌面便捷栏，不会打开本窗口
          </span>
        </span>
        <button
          type="button"
          className="lib-switch"
          role="switch"
          aria-checked={autostartOn}
          aria-label="开机自动启动"
          disabled={autostartLoading || !isTauri()}
          onClick={() => void handleAutostartToggle(!autostartOn)}
        />
      </div>

      <div className="lib-setting-row">
        <span className="lib-setting-text">
          <span className="lib-setting-name">最近使用记录</span>
          <span className="lib-setting-hint">
            关闭仅隐藏入口，启动记录继续保存
          </span>
        </span>
        <button
          type="button"
          className="lib-switch"
          role="switch"
          aria-checked={showRecent}
          aria-label="显示最近使用"
          onClick={() => onToggleUiSetting("showRecent", !showRecent)}
        />
      </div>

      <div className="lib-setting-row">
        <span className="lib-setting-text">
          <span className="lib-setting-name">启动最多记录</span>
          <span className="lib-setting-hint">
            关闭仅隐藏入口，启动次数继续统计
          </span>
        </span>
        <button
          type="button"
          className="lib-switch"
          role="switch"
          aria-checked={showFrequent}
          aria-label="显示启动最多"
          onClick={() => onToggleUiSetting("showFrequent", !showFrequent)}
        />
      </div>

      <div className="lib-setting-row">
        <span className="lib-setting-text">
          <span className="lib-setting-name">全局快捷键</span>
          <span className="lib-setting-hint">随时呼出「全部应用」</span>
        </span>
        <span className="lib-kbd">Alt Shift M</span>
      </div>

      <div className="lib-setting-row">
        <span className="lib-setting-text">
          <span className="lib-setting-name">版本</span>
          <span className="lib-setting-hint">
            {(localVersion ?? updateCheck?.currentVersion)
              ? `当前 v${localVersion ?? updateCheck?.currentVersion}`
              : "本地版本"}
          </span>
        </span>
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!isTauri() || updateBusy}
          onClick={() => void handleCheckUpdate()}
        >
          {updateBusy ? "检查中…" : "检查更新"}
        </button>
      </div>

      {updateCheck && (
        <div style={{ padding: "4px 4px 0" }}>
          {updateCheck.fetchError ? (
            <p className="lib-warn-text">{updateCheck.fetchError}</p>
          ) : updateCheck.hasUpdate ? (
            <button
              type="button"
              className="lib-link-button"
              disabled={updateInstalling}
              onClick={() => {
                const url = updateCheck.downloadUrl;
                if (url) {
                  setUpdatePrompt({
                    version: updateCheck.latestVersion ?? "",
                    url,
                  });
                } else if (updateCheck.releaseUrl) {
                  void openUrl(updateCheck.releaseUrl);
                }
              }}
            >
              <IconDownload size={13} />
              有新版本 {updateCheck.latestVersion} · 点击更新
            </button>
          ) : (
            <p className="lib-setting-hint">
              <IconCheck size={12} strokeWidth={2.4} /> 已是最新版本
            </p>
          )}
        </div>
      )}

      {!isTauri() && (
        <p className="lib-setting-hint" style={{ padding: "4px 4px 0" }}>
          以上开关仅在桌面版生效
        </p>
      )}
    </div>
  );
}
