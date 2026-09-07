import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Shared glossy dropdown panel class — use this everywhere for consistency
export const DROPDOWN_PANEL_CLASS =
  "absolute z-50 rounded-xl overflow-hidden " +
  "bg-white/5 backdrop-blur-2xl " +
  "border border-white/20 " +
  "shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12)] " +
  "ring-1 ring-white/10";

// Shared item hover class
export const DROPDOWN_ITEM_CLASS =
  "w-full text-left text-sm text-white transition-colors duration-150 " +
  "hover:bg-white/10 active:bg-white/15";

const PlusDropdown = ({
  options = [],
  selectedKeys = [],
  onSelect,
  onDeselect,
  buttonClassName = "",
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-9 h-9 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-md transition-colors ${buttonClassName}`}
      >
        <Plus size={18} />
      </button>

      {open && (
        <div className={`${DROPDOWN_PANEL_CLASS} right-0 top-11 min-w-[200px]`}>
          {options.map((opt) => {
            const isChecked = selectedKeys.includes(opt.key);
            return (
              <label
                key={opt.key}
                className={`${DROPDOWN_ITEM_CLASS} flex items-center gap-3 px-4 py-2.5 cursor-pointer ${isChecked ? "bg-white/10" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {
                    if (isChecked) onDeselect?.(opt);
                    else onSelect?.(opt);
                  }}
                  className="w-4 h-4 rounded accent-accent cursor-pointer shrink-0"
                />
                <span className="text-sm text-white">{opt.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlusDropdown;
