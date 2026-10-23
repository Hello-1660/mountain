import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { ScopeId } from "../types";
import type { ScopeOption } from "./useLibraryDerived";

/**
 * 搜索域与分组的联动：
 * - 显示开关关闭后若搜索域停在被隐藏的域，回退「全部应用」
 * - 侧栏切分组时搜索域回到「默认 = 当前分组」
 */
export function useScopeSync(
  groupId: ScopeId,
  scopeOptions: ScopeOption[],
  setSearchScope: Dispatch<SetStateAction<ScopeId>>,
): void {
  useEffect(() => {
    setSearchScope((cur) =>
      scopeOptions.some((o) => o.id === cur) ? cur : "all",
    );
  }, [scopeOptions, setSearchScope]);

  useEffect(() => {
    setSearchScope(groupId);
  }, [groupId, setSearchScope]);
}
