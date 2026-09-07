import React, { useState, useRef, useLayoutEffect, useCallback } from "react";
import ReactDOM from "react-dom";
import { cn } from "@/libs/utils/utils";

/**
 * Tooltip — portal-based, measures actual tooltip size before positioning.
 * Never goes off-screen regardless of text length.
 */
const Tooltip = ({
  children,
  text,
  position: forcedPosition,
  className = "",
  triggerClassName = "",
}) => {
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState({});
  const [pos, setPos] = useState("left");
  const [ready, setReady] = useState(false);

  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const MARGIN = 8;

  // After tooltip mounts (invisible), measure it and compute final position
  useLayoutEffect(() => {
    if (!visible || !tooltipRef.current || !triggerRef.current) return;

    const tip = tooltipRef.current.getBoundingClientRect();
    const trigger = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const tw = tip.width;
    const th = tip.height;

    // Determine best position
    let resolvedPos = forcedPosition;
    if (!resolvedPos) {
      const spaceLeft   = trigger.left;
      const spaceRight  = vw - trigger.right;
      const spaceBottom = vh - trigger.bottom;
      const spaceTop    = trigger.top;

      if      (spaceLeft   >= tw + MARGIN) resolvedPos = "left";
      else if (spaceRight  >= tw + MARGIN) resolvedPos = "right";
      else if (spaceBottom >= th + MARGIN) resolvedPos = "bottom";
      else if (spaceTop    >= th + MARGIN) resolvedPos = "top";
      else                                 resolvedPos = "bottom";
    }

    // Compute top/left so tooltip stays fully in viewport
    let top, left;

    if (resolvedPos === "left") {
      top  = trigger.top + trigger.height / 2 - th / 2;
      left = trigger.left - tw - MARGIN;
    } else if (resolvedPos === "right") {
      top  = trigger.top + trigger.height / 2 - th / 2;
      left = trigger.right + MARGIN;
    } else if (resolvedPos === "bottom") {
      top  = trigger.bottom + MARGIN;
      left = trigger.left + trigger.width / 2 - tw / 2;
    } else {
      top  = trigger.top - th - MARGIN;
      left = trigger.left + trigger.width / 2 - tw / 2;
    }

    // Clamp so it never goes outside viewport
    left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
    top  = Math.max(MARGIN, Math.min(top,  vh - th - MARGIN));

    setPos(resolvedPos);
    setStyle({ top, left });
    setReady(true);
  }, [visible, forcedPosition]);

  const handleMouseEnter = useCallback(() => {
    setReady(false);
    setVisible(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
    setReady(false);
  }, []);

  const arrowClass = {
    left:   "left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-primary-card border-[5px]",
    right:  "right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-primary-card border-[5px]",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-primary-card border-[5px]",
    top:    "top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-primary-card border-[5px]",
  };

  return (
    <>
      <span
        ref={triggerRef}
        className={cn("relative inline-flex items-center", triggerClassName)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </span>

      {visible && text && ReactDOM.createPortal(
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: "fixed",
            ...style,
            // invisible until measured so no flicker
            visibility: ready ? "visible" : "hidden",
          }}
          className={cn(
            "z-9999 whitespace-nowrap rounded-xl",
            "px-3 py-2 text-[11px] leading-snug font-medium tracking-wide",
            "text-white/80",
            "bg-primary-card border border-white/20 backdrop-blur-xl",
            "shadow-[0_8px_24px_rgba(6,70,176,0.35)]",
            "pointer-events-none select-none",
            ready && "animate-in fade-in zoom-in-95 duration-150",
            className
          )}
        >
          {text}
          <span className={cn("absolute", arrowClass[pos])} />
        </span>,
        document.body
      )}
    </>
  );
};

export default Tooltip;
