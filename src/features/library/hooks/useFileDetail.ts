import { useEffect, useState } from "react";

import * as api from "../../../lib/api";
import type { FileDetail } from "../../../types";

/** 选中应用的文件详情（大小 / 是否存在） */
export function useFileDetail(selectedPath: string | null): FileDetail | null {
  const [detail, setDetail] = useState<FileDetail | null>(null);

  useEffect(() => {
    if (!selectedPath) {
      setDetail(null);
      return;
    }
    void api.fileDetail(selectedPath).then(setDetail);
  }, [selectedPath]);

  return detail;
}
