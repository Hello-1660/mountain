import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import DockBar from "./components/DockBar";
import LibraryView from "./components/LibraryView";

export default function App() {
  const label = getCurrentWebviewWindow().label;
  if (label === "library") return <LibraryView />;
  return <DockBar />;
}
