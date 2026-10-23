/**
 * dnd-kit 可排序项：li 版（应用条目，网格 / 列表共用）与 div 版（分组行）。
 * listeners 挂整项（PointerSensor distance:6 约束下点击仍正常）。
 */

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import type { CSSProperties, MouseEvent, ReactNode } from "react";

export function SortableLi({
  id,
  style,
  onClick,
  children,
}: {
  id: string;
  style?: CSSProperties;
  onClick?: (e: MouseEvent) => void;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={
        {
          ...style,
          transform: CSS.Transform.toString(transform),
          transition,
        } as CSSProperties
      }
      onClick={onClick}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      data-over={isOver || undefined}
    >
      {children}
    </li>
  );
}

export function SortableDiv({
  id,
  className,
  innerRef,
  children,
}: {
  id: string;
  className?: string;
  innerRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const {
    setNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id });
  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        innerRef?.(el);
      }}
      className={className}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      data-dragging={isDragging || undefined}
      data-over={isOver || undefined}
    >
      {children}
    </div>
  );
}
