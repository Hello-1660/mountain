/**
 * 库窗口的数据层：store / 应用目录 / 使用记录 / 文件详情。
 *
 * 只负责「加载 + 订阅后端事件 + 落盘」，不含任何界面状态；
 * 会改数据的动作在 `useLibraryActions` 里。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import * as api from "../../../lib/api";
import { useDebouncedSave } from "../../../hooks/useDebouncedSave";
import {
  normalizeLibraryStore,
  type AppCatalogDto,
  type AppStore,
  type ScannedApp,
  type UsageSnapshot,
} from "../../../types";

const EMPTY_USAGE: UsageSnapshot = { recentPaths: [], frequentPaths: [] };

export function useLibraryData() {
  const [store, setStore] = useState<AppStore | null>(null);
  const [scanned, setScanned] = useState<ScannedApp[]>([]);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  /** 「从启动台移除」黑名单：历史视图（最近/启动最多）据此过滤 */
  const [removedSet, setRemovedSet] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [catalogBootstrapping, setCatalogBootstrapping] = useState(true);
  const [usage, setUsage] = useState<UsageSnapshot>(EMPTY_USAGE);

  const debouncedSave = useDebouncedSave();

  const persist = useCallback(
    (next: AppStore) => {
      setStore(next);
      debouncedSave(next);
    },
    [debouncedSave],
  );

  /* ---------------- store ---------------- */

  useEffect(() => {
    void api.loadStore().then((s) => setStore(normalizeLibraryStore(s)));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<AppStore>("store-updated", (e) => {
      setStore(normalizeLibraryStore(e.payload));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  /* ---------------- 应用目录 ---------------- */

  const applyCatalog = useCallback((dto: AppCatalogDto) => {
    setScanned(dto.apps);
    setScannedAt(dto.scannedAt);
    setRemovedSet(new Set((dto.removed ?? []).map((r) => r.toLowerCase())));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dto = await api.loadAppCatalog();
        if (!alive) return;
        applyCatalog(dto);
        if (dto.apps.length === 0) {
          setScanning(true);
          const fresh = await api.refreshAppCatalog();
          if (!alive) return;
          applyCatalog(fresh);
        }
      } catch (e) {
        console.error(String(e));
      } finally {
        if (alive) {
          setScanning(false);
          setCatalogBootstrapping(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyCatalog]);

  /* ---------------- 使用记录 ---------------- */

  const reloadUsage = useCallback(() => {
    if (!isTauri()) return;
    void api.loadUsageSnapshot().then(setUsage).catch((e) => {
      console.error(String(e));
    });
  }, []);

  useEffect(() => {
    reloadUsage();
  }, [reloadUsage]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("usage-updated", () => {
      reloadUsage();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [reloadUsage]);

  /** 便捷栏里的应用（可能与目录条目不同源，各自带图标） */
  const dockAppsList = useMemo((): ScannedApp[] => {
    if (!store) return [];
    return store.dock.map((d) => {
      const hit = scanned.find(
        (a) => a.path.toLowerCase() === d.path.toLowerCase(),
      );
      if (hit) return hit;
      return { name: d.title, path: d.path, iconPath: d.iconPath };
    });
  }, [store, scanned]);

  return {
    store,
    setStore,
    persist,
    debouncedSave,
    scanned,
    scannedAt,
    removedSet,
    scanning,
    setScanning,
    catalogBootstrapping,
    applyCatalog,
    usage,
    setUsage,
    reloadUsage,
    dockAppsList,
  };
}

export type LibraryData = ReturnType<typeof useLibraryData>;
