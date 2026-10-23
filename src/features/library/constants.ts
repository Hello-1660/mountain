/** 视图模式持久化的 key */
export const VIEW_STORAGE_KEY = "mountain.library.view";

/** 与 tokens.css 的 --ui-scale 同步：启动台整体 UI 放大系数 */
export const UI_SCALE = 1.15;

/** 彩蛋：搜索框输入这些名字 + Enter 弹图 */
export const EASTER_NAMES = [
  "夜雨声烦",
  "峰不语",
  "拂云秋影中",
  "札克",
  "梦道",
  "猫眼石",
  "脱氧",
  "诩",
  "雨伞",
] as const;

/** 上下文菜单尺寸换算常量（与 overlays.css 中的 .lib-menu 保持一致） */
export const CONTEXT_MENU = {
  pad: 6,
  width: 178,
  itemHeight: 34,
  paddingY: 10,
} as const;
