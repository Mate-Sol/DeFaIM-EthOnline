import React from 'react';

const Box = ({ children, className = '', as: Component = 'div', ...props }) => {
  return (
    <Component className={`${className}`} {...props}>
      {children}
    </Component>
  );
};

export default Box;
