import React from 'react';

const typographyVariants = {
  h1: "text-4xl sm:text-5xl font-bold tracking-tight text-white",
  h2: "text-3xl sm:text-4xl font-semibold tracking-tight text-white",
  h3: "text-2xl sm:text-3xl font-semibold text-white",
  h4: "text-xl sm:text-2xl font-medium text-white",
  h5: "text-lg sm:text-xl font-medium text-white",
  h6: "text-base sm:text-lg font-medium text-white",
  body1: "text-base text-slate-200",
  body2: "text-sm text-slate-300",
  caption: "text-xs font-light text-slate-400 opacity-80",
  overline: "text-xs font-semibold uppercase tracking-wider text-slate-400"
};

const defaultElementMap = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  body1: 'p',
  body2: 'p',
  caption: 'span',
  overline: 'span'
};

const Typography = ({ 
  variant = 'body1', 
  as, 
  className = '', 
  children, 
  ...props 
}) => {
  const Component = as || defaultElementMap[variant] || 'p';
  const baseClasses = typographyVariants[variant] || typographyVariants.body1;

  return (
    <Component className={`${baseClasses} ${className}`} {...props}>
      {children}
    </Component>
  );
};

export default Typography;
