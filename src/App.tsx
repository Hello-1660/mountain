import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import DockBar from "./features/dock/DockBar";
import LibraryView from "./features/library/LibraryView";

/** 按窗口 label 分发：dock 跑便捷栏，library 跑「全部应用」 */
export default function App() {
  const label = getCurrentWebviewWindow().label;
  if (label === "library") return <LibraryView />;
  return <DockBar />;
}
