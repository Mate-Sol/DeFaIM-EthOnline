import React from 'react';

// A versatile base Card component with glassmorphism
const Card = ({ children, className = '', variant = 'glass', ...props }) => {
  const variantClasses = {
    glass: 'bg-primary backdrop-blur-md border-white/60 rounded-[42px] shadow-[0_5px_25px_0_rgba(31,38,135,0.07),inset_0_1px_1px_rgba(255,255,255,0.3)]',
    simple: 'bg-primary-card/40 border-white/20 rounded-2xl shadow-lg'
  };

  return (
    <div
      className={`${variantClasses[variant] || variantClasses.glass}  p-6 sm:p-8 text-white border w-full ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default Card;
