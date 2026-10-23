import { useEffect, useState, type ReactNode } from "react";

import { readIconDataUrl } from "../lib/api";
import { appIconSrc } from "../lib/appIconSrc";

type Props = {
  iconPath?: string;
  className?: string;
  fallback: ReactNode;
  draggable?: boolean;
  /**
   * 从图标主色提取出的 "r,g,b"，供外层做环境色投影使用。
   * canvas 被跨域污染时不会回调，外层按默认强调色降级。
   */
  onTint?: (rgb: string) => void;
};

/** 取图标平均色并提亮到可用区间，保持色相 */
function sampleTint(img: HTMLImageElement): string | null {
  try {
    const S = 16;
    const canvas = document.createElement("canvas");
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, S, S);
    const data = ctx.getImageData(0, 0, S, S).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 140) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    if (!n) return null;
    r /= n;
    g /= n;
    b /= n;
    const peak = Math.max(r, g, b);
    const k = Math.min(2.4, 158 / Math.max(38, peak));
    const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
    return `${clamp(r)},${clamp(g)},${clamp(b)}`;
  } catch {
    return null;
  }
}

/**
 * 先用 convertFileSrc（asset）；若 <img> 加载失败（协议/CSP/路径），再经 IPC 读成 data URL。
 */
export default function CachedAppIcon({
  iconPath,
  className,
  fallback,
  draggable,
  onTint,
}: Props) {
  const asset = iconPath?.trim() ? appIconSrc(iconPath) : undefined;
  const [src, setSrc] = useState<string | undefined>(asset);
  const [triedFallback, setTriedFallback] = useState(false);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    const next = iconPath?.trim() ? appIconSrc(iconPath) : undefined;
    setSrc(next);
    setTriedFallback(false);
    setDead(false);
  }, [iconPath]);

  const onError = () => {
    if (dead) return;
    const p = iconPath?.trim();
    if (!triedFallback && p) {
      setTriedFallback(true);
      void readIconDataUrl(p).then((u) => {
        if (u) setSrc(u);
        else setDead(true);
      });
    } else {
      setDead(true);
    }
  };

  if (dead || !src) return <>{fallback}</>;

  return (
    <img
      src={src}
      className={className}
      alt=""
      draggable={draggable}
      onError={onError}
      onLoad={(e) => {
        if (!onTint) return;
        const rgb = sampleTint(e.currentTarget);
        if (rgb) onTint(rgb);
      }}
    />
  );
}
