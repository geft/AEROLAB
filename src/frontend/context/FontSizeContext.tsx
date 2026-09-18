import React, { createContext, useContext, useState, useEffect } from 'react';

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge' | 'xxlarge' | 'max';

interface FontSizeContextType {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const FontSizeContext = createContext<FontSizeContextType>({
  fontSize: 'medium',
  setFontSize: () => {}
});

export const FontSizeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    try {
      const stored = localStorage.getItem('aerolab_font_size');
      if (
        stored === 'small' ||
        stored === 'medium' ||
        stored === 'large' ||
        stored === 'xlarge' ||
        stored === 'xxlarge' ||
        stored === 'max'
      ) {
        return stored as FontSize;
      }
    } catch {}
    return 'medium';
  });

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size);
    try {
      localStorage.setItem('aerolab_font_size', size);
    } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-font-size', size);
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-font-size', fontSize);
    }
  }, [fontSize]);

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
};

export const useFontSize = (): FontSizeContextType => {
  return useContext(FontSizeContext);
};
