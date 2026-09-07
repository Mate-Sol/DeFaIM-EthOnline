import React, { useRef } from "react";
import Typography from "@/components/ui/Typography";

const OtpBox = ({
  label = "Enter Access Code",
  showLabel = true,
  length = 6,
  value = [],
  onChange,
  className = "",
  onKeyDownForSubmit,
}) => {
  const inputsRef = useRef([]);

  const handleChange = (e, index) => {
    const val = e.target.value.replace(/\D/g, "").slice(-1);
    const newVal = [...value];
    newVal[index] = val;
    onChange?.(newVal);
    if (val && index < length - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (e, index) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    } else if (e.key === "Enter") {
      onKeyDownForSubmit();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, length);
    const newVal = Array.from({ length }, (_, i) => pasted[i] || "");
    onChange?.(newVal);
    const nextEmpty = newVal.findIndex((v) => !v);
    inputsRef.current[nextEmpty === -1 ? length - 1 : nextEmpty]?.focus();
  };

  return (
    <div className={`flex flex-col gap-4 sm:gap-5 ${className}`}>
      {showLabel && (
        <Typography
          variant="body1"
          className="text-white font-semibold mb-3 sm:mb-5 text-base sm:text-lg"
        >
          {label}
        </Typography>
      )}

      {/* OTP inputs */}
      <div className="flex gap-4.5 sm:gap-3.5">
        {Array.from({ length }).map((_, i) => (
          <input
            key={i}
            ref={(el) => (inputsRef.current[i] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={value[i] || ""}
            onChange={(e) => handleChange(e, i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            onPaste={handlePaste}
            className="w-9 h-9 sm:w-11 sm:h-11 md:w-12 md:h-12 text-center text-base sm:text-lg font-semibold text-white bg-blue-900/10 backdrop-blur-md border border-white/20 rounded-xl outline-none transition-all duration-200 focus:ring-2 focus:ring-white/30 focus:bg-white/20 caret-white -mr-2"
          />
        ))}
      </div>
    </div>
  );
};

export default OtpBox;
