import React, { useState, useRef, useEffect } from 'react';
import { DROPDOWN_PANEL_CLASS, DROPDOWN_ITEM_CLASS } from './PlusDropdown';

const DropdownItem = ({ children, onClick, active = false, icon: Icon, className = '' }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        ${DROPDOWN_ITEM_CLASS} px-4 py-2.5 font-medium
        flex items-center gap-3
        ${active ? 'bg-white/15' : ''}
        ${className}
      `}
    >
      {Icon && (
        <span className="text-white/70 shrink-0">
          {typeof Icon === 'function' ? <Icon /> : Icon}
        </span>
      )}
      <span>{children}</span>
    </button>
  );
};

const Select = ({
  options = [],
  value,
  onChange,
  placeholder = "Select option",
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const selectedOption =
    options.find((opt) => opt.value === value) ||
    options.find((opt) => opt.label === value);
  const displayLabel = selectedOption
    ? selectedOption.label || selectedOption.value
    : placeholder;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div
      className={`relative inline-block w-full min-w-[200px] ${className}`}
      ref={dropdownRef}
    >
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          flex items-center justify-between w-full px-5 py-3
          bg-white/8 backdrop-blur-md border border-white/20
          rounded-full text-white text-sm font-medium transition-all
          hover:bg-white/12 focus:outline-none
          shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]
          ${isOpen ? 'ring-1 ring-white/25 border-white/30' : ''}
        `}
      >
        <div className="flex items-center gap-3">
          {selectedOption?.icon && (
            <span className="text-white/70">
              {typeof selectedOption.icon === 'function'
                ? <selectedOption.icon />
                : selectedOption.icon}
            </span>
          )}
          <span>{displayLabel}</span>
        </div>
        <svg
          className={`w-4 h-4 transition-transform duration-200 text-white/60 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Menu */}
      {isOpen && (
        <div className={`${DROPDOWN_PANEL_CLASS} mt-2 w-full py-1`}>
          {options.map((option, idx) => (
            <DropdownItem
              key={idx}
              active={value === option.value}
              icon={option.icon}
              onClick={() => {
                onChange?.(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </DropdownItem>
          ))}
        </div>
      )}
    </div>
  );
};

export { Select, DropdownItem };
