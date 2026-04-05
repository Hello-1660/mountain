import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appIconSrc } from "../appIconSrc";

type Props = {
  iconPath?: string;
  className?: string;
  fallback: ReactNode;
  draggable?: boolean;
};

/**
 * 先用 convertFileSrc（asset）；若 <img> 加载失败（协议/CSP/路径），再经 IPC 读成 data URL。
 */
export default function CachedAppIcon({
  iconPath,
  className,
  fallback,
  draggable,
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
      void invoke<string | null>("read_icon_data_url", { path: p }).then((u) => {
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
    />
  );
}
