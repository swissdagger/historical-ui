import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

interface MultiSelectProps {
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'Select items',
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(option =>
    option.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelectAll = () => {
    onChange(options);
  };

  const handleDeselectAll = () => {
    onChange([]);
  };

  const handleToggle = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter(v => v !== option));
    } else {
      onChange([...value, option]);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setSearchTerm('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const getDisplayText = () => {
    if (value.length === 0) return placeholder;
    if (value.length === options.length) return 'All timeframes';
    if (value.length === 1) return value[0];
    return `${value.length} of ${options.length} selected`;
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-3 py-1.5 text-xs bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded hover:bg-[#3a3a3a] focus:outline-none focus:border-blue-600 transition-colors min-w-[200px]"
      >
        <span className="truncate">{getDisplayText()}</span>
        <ChevronDown
          className={`w-4 h-4 ml-2 transition-transform flex-shrink-0 ${isOpen ? 'transform rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-[#1a1a1a] border border-[#3a3a3a] rounded shadow-lg">
          <div className="p-2 border-b border-[#3a3a3a]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search timeframes..."
              className="w-full px-2 py-1 text-xs bg-[#2a2a2a] text-white border border-[#3a3a3a] rounded focus:outline-none focus:border-blue-600"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2 p-2 border-b border-[#3a3a3a]">
            <button
              type="button"
              onClick={handleSelectAll}
              className="flex-1 px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-blue-600 transition-colors"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={handleDeselectAll}
              className="flex-1 px-2 py-1 text-xs bg-[#2a2a2a] text-white rounded hover:bg-red-600 transition-colors"
            >
              Deselect All
            </button>
          </div>

          <div className="max-h-[300px] overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[#666] text-center">
                No results found
              </div>
            ) : (
              <div className="py-1">
                {filteredOptions.map((option) => {
                  const isSelected = value.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => handleToggle(option)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : 'text-[#999] hover:bg-[#2a2a2a]'
                      }`}
                    >
                      <div className={`w-4 h-4 border rounded flex-shrink-0 flex items-center justify-center ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-[#3a3a3a]'
                      }`}>
                        {isSelected && (
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className="truncate">{option}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
