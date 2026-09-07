import React from "react";

const Button = ({
  children,
  variant = "solid", // 'solid', 'gradient', 'icon'
  color = "default", // 'default', 'primary', 'secondary', 'gray', 'alert'
  className = "",
  disabled,
  ...props
}) => {
  const baseStyles =
    "inline-flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 backdrop-blur-md border border-white/20 text-white font-medium";

  const colorMap = {
    solid: {
      default:
        "bg-white/10 hover:bg-white/20 rounded-full px-12 py-3 shadow-[0_4px_12px_rgba(0,0,0,0.1)]",
      primary:
        "bg-primary hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      secondary:
        "bg-secondary hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      gray: "bg-gray hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      alert: "bg-alert hover:brightness-125 rounded-full px-12 py-3 shadow-md",
    },
    gradient: {
      default:
        "bg-gradient-to-r from-white/20 to-white/5 hover:from-white/30 hover:to-white/10 rounded-full px-12 py-3 shadow-md",
      primary:
        "bg-gradient-to-r from-primary to-primary-light hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      secondary:
        "bg-gradient-to-r from-secondary to-primary/50 hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      gray: "bg-gradient-to-r from-gray to-white/5 hover:brightness-125 rounded-full px-12 py-3 shadow-md",
      alert:
        "bg-gradient-to-r from-alert to-white/5 hover:brightness-125 rounded-full px-12 py-3 shadow-md",
    },
    icon: {
      default: "bg-white/10 hover:bg-white/20 rounded-full p-3 shadow-md",
      primary: "bg-primary hover:brightness-125 rounded-full p-3 shadow-md",
      secondary: "bg-secondary hover:brightness-125 rounded-full p-3 shadow-md",
      gray: "bg-gray hover:brightness-125 rounded-full p-3 shadow-md",
      alert: "bg-alert hover:brightness-125 rounded-full p-3 shadow-md",
    },
  };

  const variantStyles = colorMap[variant]?.[color] || colorMap.solid.default;

  return (
    <button
      className={`${baseStyles} ${variantStyles} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
