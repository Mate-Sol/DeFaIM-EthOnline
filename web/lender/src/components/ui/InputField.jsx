import React from 'react';

const InputField = React.forwardRef(function InputField({
  type = 'text',
  placeholder = '',
  leftIcon,
  rightIcon,
  rightIconClickable = false,
  className = '',
  wrapperClassName = '',
  ...props
}, ref) {
  return (
    <div className={`relative flex items-center w-full ${wrapperClassName}`}>
      {leftIcon && (
        <div className="absolute left-4 text-white/70 pointer-events-none z-10">
          {leftIcon}
        </div>
      )}
      
      <input
        ref={ref}
        type={type}
        className={`
          w-full bg-white/5 backdrop-blur-md border border-white/10 text-white placeholder-white/50 rounded-full 
          py-3 px-5 transition-all duration-200 outline-none
          focus:ring-2 focus:ring-white/30 focus:bg-white/10
          ${leftIcon ? 'pl-11' : ''}
          ${rightIcon ? 'pr-11' : ''}
          ${className}
        `}
        placeholder={placeholder}
        {...props}
      />

      {rightIcon && (
        <div className={`absolute right-4 text-slate-300 ${rightIconClickable ? '' : 'pointer-events-none'}`}>
          {rightIcon}
        </div>
      )}
    </div>
  );
});

export default InputField;
