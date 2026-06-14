import type { ReactNode } from "react";
import { X } from "./Icon";

export interface SheetItem {
  icon: ReactNode;
  label: string;
  sub?: string;
  onClick: () => void;
  active?: boolean;
  keepOpen?: boolean; // toggles stay open so the state change is visible
}

// Thumb-reachable bottom sheet for the overflow controls banked off the top bar
// (M2). Large list rows, slides up from the bottom, inset above the safe area.
export function MoreSheet({
  title = "Menu",
  items,
  onClose,
}: {
  title?: string;
  items: SheetItem[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="sheet-up dock-safe-b safe-x relative max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#23211f] pt-2 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="flex items-center justify-between px-4 pb-1">
          <h3 className="text-base font-bold text-white">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>
        <div className="px-2 pb-2">
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => {
                it.onClick();
                if (!it.keepOpen) onClose();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-white/5"
            >
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  it.active ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/80"
                }`}
              >
                {it.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-[15px] font-semibold ${it.active ? "text-emerald-300" : "text-white"}`}>
                  {it.label}
                </span>
                {it.sub && <span className="block text-xs text-white/50">{it.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
