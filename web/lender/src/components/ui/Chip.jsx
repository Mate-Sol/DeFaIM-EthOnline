import React from 'react';

const Chip = ({ 
  children, 
  variant = 'low', // 'low', 'medium', 'high', 'success', 'warning', 'error'
  className = '',
  color = 'low',
  dot = true,
  ...props 
}) => {
  const variantStyles = {
    low: {
      dot: '',
      glow: ''
    },
    success: {
      dot: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]',
      glow: 'bg-emerald-400/30'
    },
    medium: {
      dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
      glow: 'bg-amber-400/30'
    },
    warning: {
      dot: 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)]',
      glow: 'bg-amber-400/30'
    },
    high: {
      dot: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]',
      glow: 'bg-rose-500/30'
    },
    error: {
      dot: 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]',
      glow: 'bg-rose-500/30'
    }
  };

  const colorVariantStyle = {
    low: '',
    medium: 'bg-amber-400/50!',
    high: 'bg-rose-500/50!',
    success: 'bg-emerald-400/50!',
    warning: 'bg-amber-400/50!',
    error: 'bg-rose-500/50!'
  }

  const style = variantStyles[variant] || variantStyles.low;
  const colorVariant = colorVariantStyle[color] || colorVariantStyle.low;

  return (
    <div 
      className={`
        inline-flex items-center gap-3 px-6 py-2.5 rounded-full
        bg-white/8 backdrop-blur-2xl
        border border-white/20 border-b-white/10
        shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_8px_32px_0_rgba(0,0,0,0.2)]
        relative overflow-hidden group
        ${className}
        ${colorVariant}
      `}
      {...props}
    >
      {/* Background Glows */}
      <div className={`absolute right-1 top-4/4 -translate-y-1/2 w-10 h-10 blur-sm rounded-full transition-opacity opacity-50 group-hover:opacity-70 ${style.glow} pointer-events-none`} />
      <div className={`absolute -right-3 -bottom-5 w-12 h-12 blur-sm rounded-full transition-opacity opacity-50 group-hover:opacity-80 ${style.glow} pointer-events-none`} />
      
      <span className="text-white text-base font-medium tracking-tight relative z-10 antialiased">
        {children}
      </span>

      {dot && (
        <div className="relative flex items-center justify-center z-10 ml-1">
          {/* Pulsating outer glow */}
          <div className={`w-2.5 h-2.5 rounded-full animate-ping absolute ${style.glow} opacity-75`} />
          {/* Main status dot */}
          <div className={`w-2 h-2 rounded-full relative z-10 ${style.dot}`} />
        </div>
      )}
    </div>
  );
};

export default Chip;
