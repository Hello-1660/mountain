/**
 * 设置面板相关状态：开机自启、本地版本、更新检查与覆盖更新流程。
 */

import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

import * as api from "../../../lib/api";
import type { UpdateCheckDto } from "../../../types";

type Notify = (text: string, kind?: "success" | "info") => void;

export interface UpdatePrompt {
  version: string;
  url: string;
}

export function useSettings(notify: Notify) {
  /* ---------- 开机自启 ---------- */
  const [autostartOn, setAutostartOn] = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(true);

  useEffect(() => {
    if (!isTauri()) {
      setAutostartLoading(false);
      return;
    }
    let alive = true;
    void isEnabled()
      .then((on) => {
        if (alive) setAutostartOn(on);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setAutostartLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleAutostartToggle = useCallback(
    async (checked: boolean) => {
      try {
        if (checked) await enable();
        else await disable();
        setAutostartOn(await isEnabled());
        notify(checked ? "已开启开机自启动" : "已关闭开机自启动");
      } catch (e) {
        console.error(String(e));
      }
    },
    [notify],
  );

  /* ---------- 版本与更新 ---------- */
  /** 本地版本号（设置面板常显，无需先点检查更新） */
  const [localVersion, setLocalVersion] = useState<string | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckDto | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  /* 覆盖更新流程：弹窗确认 → 下载安装包 → 静默安装并重启 */
  const [updatePrompt, setUpdatePrompt] = useState<UpdatePrompt | null>(null);
  const [updateInstalling, setUpdateInstalling] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    getVersion()
      .then(setLocalVersion)
      .catch(() => setLocalVersion(null));
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    if (!isTauri()) return;
    setUpdateBusy(true);
    setUpdateCheck(null);
    try {
      setUpdateCheck(await api.checkGithubRelease());
    } catch (e) {
      setUpdateCheck({
        currentVersion: "",
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: null,
        releaseNotes: null,
        fetchError: String(e),
        downloadUrl: null,
      });
    } finally {
      setUpdateBusy(false);
    }
  }, []);

  const startUpdate = useCallback(async () => {
    if (!updatePrompt) return;
    setUpdateInstalling(true);
    try {
      notify("正在下载更新包…");
      const setupPath = await api.downloadUpdate(updatePrompt.url);
      notify("下载完成，正在重启并安装…");
      await api.applyUpdateAndRestart(setupPath);
      // 正常到不了这里：应用已退出，安装器接管覆盖安装
    } catch (e) {
      console.error(String(e));
      notify("更新失败，请重试或到发布页手动下载");
      setUpdateInstalling(false);
    }
  }, [updatePrompt, notify]);

  return {
    autostartOn,
    autostartLoading,
    handleAutostartToggle,
    localVersion,
    updateCheck,
    updateBusy,
    handleCheckUpdate,
    updatePrompt,
    setUpdatePrompt,
    updateInstalling,
    startUpdate,
  };
}

export type Settings = ReturnType<typeof useSettings>;
