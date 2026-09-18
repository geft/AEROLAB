import React, { createContext, useContext, useState, useEffect } from 'react';

export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';

export const FONT_SIZES: FontSize[] = ['small', 'medium', 'large', 'xlarge'];

export const FONT_PERCENTAGES: Record<FontSize, number> = {
  small: 75,
  medium: 100,
  large: 125,
  xlarge: 150
};

interface FontSizeContextType {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
}

const FontSizeContext = createContext<FontSizeContextType>({
  fontSize: 'medium',
  setFontSize: () => {},
  increaseFontSize: () => {},
  decreaseFontSize: () => {}
});

export const FontSizeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontSize, setFontSizeState] = useState<FontSize>(() => {
    try {
      const stored = localStorage.getItem('aerolab_font_size');
      if (stored === 'small' || stored === 'medium' || stored === 'large' || stored === 'xlarge') {
        return stored as FontSize;
      }
      if (stored === 'xxlarge' || stored === 'max') {
        return 'xlarge';
      }
    } catch {}
    return 'medium';
  });

  const setFontSize = (size: FontSize) => {
    // Cap strictly at available sizes
    const validSize = FONT_SIZES.includes(size) ? size : 'xlarge';
    setFontSizeState(validSize);
    try {
      localStorage.setItem('aerolab_font_size', validSize);
    } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-font-size', validSize);
    }
  };

  const increaseFontSize = () => {
    const currentIndex = FONT_SIZES.indexOf(fontSize);
    if (currentIndex < FONT_SIZES.length - 1) {
      setFontSize(FONT_SIZES[currentIndex + 1]);
    }
  };

  const decreaseFontSize = () => {
    const currentIndex = FONT_SIZES.indexOf(fontSize);
    if (currentIndex > 0) {
      setFontSize(FONT_SIZES[currentIndex - 1]);
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-font-size', fontSize);
    }
  }, [fontSize]);

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize, increaseFontSize, decreaseFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
};

export const useFontSize = (): FontSizeContextType => {
  return useContext(FontSizeContext);
};
