import { useMemo } from "react";

import { debounce } from "../lib/format";
import { saveStore } from "../lib/api";
import type { AppStore } from "../types";

/** store 的防抖落盘：拖拽排序等高频改动不会每条都写一次磁盘 */
export function useDebouncedSave(delay = 280): (store: AppStore) => void {
  return useMemo(
    () =>
      debounce((s: AppStore) => {
        void saveStore(s).catch((e) => console.error(String(e)));
      }, delay),
    [delay],
  );
}
