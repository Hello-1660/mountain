/**
 * 「全部应用」窗口。
 *
 * 本文件只负责**装配**：把数据层、动作层、界面层的 hooks 组合起来，
 * 再把各区块交给 `components/` 下的展示组件渲染。
 */

import { useCallback, useMemo, type MouseEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { AmbientBackground } from "../../components/BrandMark";
import Toaster, { useToasts } from "../../components/Toaster";
import {
  DOCK_GROUP_ID,
  FREQUENT_GROUP_ID,
  RECENT_GROUP_ID,
  type AppGroup,
} from "../../types";
import AppStage from "./components/AppStage";
import GroupRail from "./components/GroupRail";
import Inspector from "./components/Inspector";
import LibraryHeader from "./components/LibraryHeader";
import { EasterModal, UpdatePromptModal } from "./components/LibraryModals";
import RecentStrip from "./components/RecentStrip";
import RowContextMenu from "./components/RowContextMenu";
import { useFileDetail } from "./hooks/useFileDetail";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { useLibraryData } from "./hooks/useLibraryData";
import { useLibraryDerived } from "./hooks/useLibraryDerived";
import { useLibraryKeyboard } from "./hooks/useLibraryKeyboard";
import { useLibraryUi } from "./hooks/useLibraryUi";
import { useScopeSync } from "./hooks/useScopeSync";
import { useSettings } from "./hooks/useSettings";
import "./styles/library.css";

export default function LibraryView() {
  const { toasts, push } = useToasts();
  const ui = useLibraryUi();
  const data = useLibraryData();
  const detail = useFileDetail(ui.selectedPath);
  const actions = useLibraryActions(data, ui, push);
  const derived = useLibraryDerived(data, ui);
  const settings = useSettings(push);

  useScopeSync(ui.groupId, derived.scopeOptions, ui.setSearchScope);

  /* 拖拽排序（dnd-kit）：分组栏重排、应用列表组内重排、应用拖入分组 */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const split = (v: string | number) => {
        const t = String(v);
        const i = t.indexOf(":");
        return [t.slice(0, i), t.slice(i + 1)] as const;
      };
      const [ak, av] = split(active.id);
      const [ok, ov] = split(over.id);
      if (ak === "group" && ok === "group") {
        actions.reorderGroups(av, ov);
        return;
      }
      if (ak === "app" && ok === "app") {
        if (derived.isCustomGroupView) actions.reorderGroupMembers(ui.groupId, av, ov);
        else if (ui.groupId === DOCK_GROUP_ID) actions.reorderDockByPaths(av, ov);
        return;
      }
      if (ak === "app" && ok === "group") {
        actions.addPathToGroup(av, ov);
        const g = data.store?.groups.find((x) => x.id === ov);
        if (g) push(`已加入分组「${g.name}」`);
      }
    },
    [
      actions,
      derived.isCustomGroupView,
      ui.groupId,
      data.store,
      push,
    ],
  );

  const onContextMenu = useCallback(
    (path: string, e: MouseEvent) => {
      e.preventDefault();
      ui.setRowContextMenu({ path, x: e.clientX, y: e.clientY });
    },
    [ui.setRowContextMenu],
  );

  /** Tab 循环切换搜索域（Shift+Tab 反向）；顺序与下拉一致 */
  const cycleScope = useCallback(
    (dir: 1 | -1) => {
      ui.setSearchScope((cur) => {
        const ids = derived.scopeOptions.map((o) => o.id);
        const i = ids.indexOf(cur);
        return ids[(i + dir + ids.length) % ids.length];
      });
    },
    [ui.setSearchScope, derived.scopeOptions],
  );

  const startRename = useCallback(
    (g: AppGroup) => {
      ui.setRenamingGroupId(g.id);
      ui.setRenameDraft(g.name);
    },
    [ui.setRenamingGroupId, ui.setRenameDraft],
  );

  const currentGroupName = useMemo(() => {
    const id = ui.groupId;
    if (id === "all") return "全部应用";
    if (id === DOCK_GROUP_ID) return "便捷启动";
    if (id === RECENT_GROUP_ID) return "最近使用";
    if (id === FREQUENT_GROUP_ID) return "启动最多";
    return data.store?.groups.find((g) => g.id === id)?.name ?? "全部应用";
  }, [ui.groupId, data.store]);

  useLibraryKeyboard({
    sel: ui.sel,
    filtered: derived.filtered,
    navIds: derived.navIds,
    groupId: ui.groupId,
    query: ui.query,
    selectGroup: ui.selectGroup,
    selectApp: ui.selectApp,
    launch: actions.launch,
    setSel: ui.setSel,
    setQuery: ui.setQuery,
    searchRef: ui.searchRef,
    settingsOpen: ui.settingsOpen,
    scopeOpen: ui.scopeOpen,
    rowContextMenu: ui.rowContextMenu,
    setSettingsOpen: ui.setSettingsOpen,
    setScopeOpen: ui.setScopeOpen,
    setRowContextMenu: ui.setRowContextMenu,
    setEasterImg: ui.setEasterImg,
  });

  if (!data.store) {
    return (
      <>
        <AmbientBackground />
        <div
          className="lib-root"
          style={{ display: "grid", placeItems: "center" }}
        >
          <span className="boot-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <AmbientBackground logoSize={420} />
        <div className="lib-root">
          <div className="lib-shell">
            <LibraryHeader
              scannedCount={data.scanned.length}
              scannedAt={data.scannedAt}
              query={ui.query}
              onQueryChange={ui.setQuery}
              searchRef={ui.searchRef}
              scopeId={ui.searchScope}
              scopeOptions={derived.scopeOptions}
              scopeOpen={ui.scopeOpen}
              onScopeOpenChange={ui.setScopeOpen}
              onScopeChange={ui.setSearchScope}
              onCycleScope={cycleScope}
              scanning={data.scanning}
              onRescan={actions.runScan}
              onPickFile={actions.pickFile}
              settingsOpen={ui.settingsOpen}
              onSettingsOpenChange={ui.setSettingsOpen}
              settingsWrapRef={ui.settingsWrapRef}
              settings={settings}
              showRecent={derived.uiRecent}
              showFrequent={derived.uiFrequent}
              onToggleUiSetting={actions.toggleUiSetting}
            />

            <GroupRail
              store={data.store}
              sel={ui.sel}
              groupId={ui.groupId}
              scannedCount={data.scanned.length}
              frequentCount={data.usage.frequentPaths.length}
              showFrequent={derived.uiFrequent}
              navRefs={ui.navRefs}
              renamingGroupId={ui.renamingGroupId}
              renameDraft={ui.renameDraft}
              confirmDeleteId={ui.confirmDeleteId}
              onSelectGroup={ui.selectGroup}
              onRenameDraftChange={ui.setRenameDraft}
              onStartRename={startRename}
              onCommitRename={actions.commitRenameGroup}
              onCancelRename={() => ui.setRenamingGroupId(null)}
              onRequestDelete={actions.deleteGroup}
              onConfirmDelete={actions.confirmDeleteGroup}
              onCancelDelete={() => ui.setConfirmDeleteId(null)}
              onCreateGroup={actions.addGroup}
            />

            <main className="lib-stage">
              {derived.showRecent && (
                <RecentStrip
                  apps={derived.recentApps}
                  store={data.store}
                  tints={ui.tints}
                  onTint={ui.rememberTint}
                  onSelect={ui.setSelectedPath}
                  onLaunch={actions.launch}
                />
              )}

              <AppStage
                title={
                  ui.query.trim()
                    ? derived.scopeName(ui.searchScope)
                    : currentGroupName
                }
                count={derived.filtered.length}
                view={ui.view}
                onViewChange={ui.setView}
                store={data.store}
                apps={derived.filtered}
                groupId={ui.groupId}
                sel={ui.sel}
                tints={ui.tints}
                checkedRecords={ui.checkedRecords}
                frequentCount={derived.frequentCount}
                isHistoryScope={derived.isHistoryScope}
                isInDock={derived.isInDock}
                scanning={data.scanning}
                bootstrapping={data.catalogBootstrapping}
                query={ui.query}
                onTint={ui.rememberTint}
                onSelectApp={ui.selectApp}
                onLaunch={actions.launch}
                onRemoveFromDock={actions.removeFromDockByPath}
                onToggleCheck={ui.toggleRecordCheck}
                onContextMenu={onContextMenu}
                onRemoveChecked={actions.removeCheckedRecords}
                onClearUsage={actions.clearUsageRecords}
              />
            </main>

            <Inspector
              store={data.store}
              selectedPath={ui.selectedPath}
              detail={detail}
              tints={ui.tints}
              frequentCount={derived.frequentCount}
              resolveApp={derived.resolvePathToApp}
              isInDock={derived.isInDock}
              onTint={ui.rememberTint}
              onLaunch={actions.launch}
              onPin={actions.pinSelected}
              onUnpin={actions.unpinSelected}
              onSetAlias={actions.setAlias}
              onAddToGroup={actions.addSelectedToGroup}
              onRemoveFromGroup={actions.removeSelectedFromGroup}
              notify={push}
            />
          </div>
        </div>

        <RowContextMenu
          state={ui.rowContextMenu}
          menuRef={ui.rowContextMenuRef}
          confirmRemovePath={ui.confirmRemovePath}
          isInDock={derived.isInDock}
          isCustomGroupView={derived.isCustomGroupView}
          isHistoryScope={derived.isHistoryScope}
          resolveApp={derived.resolvePathToApp}
          onLaunch={actions.launch}
          onPin={actions.pinPath}
          onRemoveFromDock={actions.removeFromDockByPath}
          onRemoveFromCurrentGroup={actions.removeFromCurrentGroup}
          onRemoveUsageRecord={actions.removeUsageRecord}
          onRemoveApp={actions.removeApp}
          onConfirmRemove={ui.setConfirmRemovePath}
          onClose={() => ui.setRowContextMenu(null)}
        />

        {settings.updatePrompt && (
          <UpdatePromptModal
            currentVersion={settings.updateCheck?.currentVersion ?? undefined}
            version={settings.updatePrompt.version}
            installing={settings.updateInstalling}
            onCancel={() => settings.setUpdatePrompt(null)}
            onConfirm={() => void settings.startUpdate()}
          />
        )}

        {ui.easterImg && (
          <EasterModal src={ui.easterImg} onClose={() => ui.setEasterImg(null)} />
        )}

        <Toaster items={toasts} />
      </DndContext>
    </>
  );
}
