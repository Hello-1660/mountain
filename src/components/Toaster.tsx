import { useCallback, useEffect, useRef, useState } from "react";
import { IconCheck } from "./icons";

export interface ToastItem {
  id: number;
  text: string;
  kind?: "success" | "info";
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const push = useCallback((text: string, kind: ToastItem["kind"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }]);
    const t = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 2200);
    timers.current.push(t);
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    },
    [],
  );

  return { toasts, push };
}

export default function Toaster({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="lib-toast-wrap" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="lib-toast">
          {t.kind === "success" && <IconCheck size={14} strokeWidth={2.2} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
