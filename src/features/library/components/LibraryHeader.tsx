/** 顶栏：品牌、搜索、重新扫描 / 手动添加 / 设置 */

import type { RefObject } from "react";

import { IconPlus, IconRefresh, IconSettings } from "../../../components/icons";
import { MarkLogo } from "../../../components/BrandMark";
import { formatScannedAt } from "../../../lib/format";
import SearchField from "./SearchField";
import SettingsPopover from "./SettingsPopover";
import type { ScopeOption } from "../hooks/useLibraryDerived";
import type { Settings } from "../hooks/useSettings";

interface Props {
  scannedCount: number;
  scannedAt: number | null;
  query: string;
  onQueryChange: (v: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  scopeId: string;
  scopeOptions: ScopeOption[];
  scopeOpen: boolean;
  onScopeOpenChange: (v: boolean) => void;
  onScopeChange: (id: string) => void;
  onCycleScope: (dir: 1 | -1) => void;
  scanning: boolean;
  onRescan: () => void;
  onPickFile: () => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (v: boolean) => void;
  settingsWrapRef: RefObject<HTMLDivElement | null>;
  settings: Settings;
  showRecent: boolean;
  showFrequent: boolean;
  onToggleUiSetting: (key: "showRecent" | "showFrequent", v: boolean) => void;
}

export default function LibraryHeader({
  scannedCount,
  scannedAt,
  query,
  onQueryChange,
  searchRef,
  scopeId,
  scopeOptions,
  scopeOpen,
  onScopeOpenChange,
  onScopeChange,
  onCycleScope,
  scanning,
  onRescan,
  onPickFile,
  settingsOpen,
  onSettingsOpenChange,
  settingsWrapRef,
  settings,
  showRecent,
  showFrequent,
  onToggleUiSetting,
}: Props) {
  return (
    <header className="lib-top">
      <div className="lib-brand">
        <span className="lib-brand-mark">
          <MarkLogo size={22} />
        </span>
        <span className="lib-brand-text">
          <h1 className="lib-brand-name">Mountain</h1>
          <p className="lib-brand-sub">
            {scannedAt != null
              ? `目录已缓存 · ${formatScannedAt(scannedAt)}`
              : `已收录 ${scannedCount} 个应用`}
          </p>
        </span>
      </div>

      <SearchField
        query={query}
        onQueryChange={onQueryChange}
        searchRef={searchRef}
        scopeId={scopeId}
        scopeOptions={scopeOptions}
        scopeOpen={scopeOpen}
        onScopeOpenChange={onScopeOpenChange}
        onScopeChange={onScopeChange}
        onCycleScope={onCycleScope}
      />

      <div className="lib-actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onRescan}
          disabled={scanning}
        >
          <IconRefresh size={14} className={scanning ? "spin" : undefined} />
          {scanning ? "扫描中" : "重新扫描"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onPickFile}>
          <IconPlus size={14} />
          手动添加
        </button>
        <div className="lib-settings-wrap" ref={settingsWrapRef}>
          <button
            type="button"
            className={"btn btn--icon" + (settingsOpen ? " is-on" : "")}
            onClick={() => onSettingsOpenChange(!settingsOpen)}
            aria-expanded={settingsOpen}
            aria-label="设置"
            title="设置"
          >
            <IconSettings size={17} />
          </button>

          {settingsOpen && (
            <SettingsPopover
              settings={settings}
              showRecent={showRecent}
              showFrequent={showFrequent}
              onToggleUiSetting={onToggleUiSetting}
            />
          )}
        </div>
      </div>
    </header>
  );
}
