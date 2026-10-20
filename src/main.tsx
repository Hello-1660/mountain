import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/* 页面不可见（窗口隐藏/最小化）时暂停所有 CSS 动画：
 * AmbientBackground 的 blur(70px) 无限动画在隐藏窗口里仍渲染，
 * 会让 GPU 进程单核满载（风扇常转）。见 tokens.css 的 .win-hidden 门控。 */
const syncAnimGate = () => {
  const hidden = document.visibilityState === "hidden";
  document.documentElement.classList.toggle("win-hidden", hidden);
};
document.addEventListener("visibilitychange", syncAnimGate);
syncAnimGate();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
