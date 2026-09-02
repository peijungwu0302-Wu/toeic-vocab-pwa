import React, { createContext, useContext, useState } from 'react';

export type BottomNavStyle = 'classic' | 'flush' | 'island';

interface NavigationStyleContextValue {
  navStyle: BottomNavStyle;
  setNavStyle: (style: BottomNavStyle) => void;
  navOffset: number;
  setNavOffset: (offset: number) => void;
  islandBottomOffset: number;
  setIslandBottomOffset: (offset: number) => void;
}

const NavigationStyleContext = createContext<NavigationStyleContextValue>({
  navStyle: 'classic',
  setNavStyle: () => {},
  navOffset: 0,
  setNavOffset: () => {},
  islandBottomOffset: 0,
  setIslandBottomOffset: () => {}
});

export const NavigationStyleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [navStyle, setNavStyleState] = useState<BottomNavStyle>(() => {
    return (localStorage.getItem('toeic_bottom_nav_style') as BottomNavStyle) || 'classic';
  });

  const [navOffset, setNavOffsetState] = useState<number>(() => {
    const saved = localStorage.getItem('toeic_bottom_nav_offset');
    return saved !== null ? parseInt(saved, 10) : 0;
  });

  const setNavStyle = (style: BottomNavStyle) => {
    setNavStyleState(style);
    localStorage.setItem('toeic_bottom_nav_style', style);
  };

  const setNavOffset = (offset: number) => {
    setNavOffsetState(offset);
    localStorage.setItem('toeic_bottom_nav_offset', offset.toString());
  };

  return (
    <NavigationStyleContext.Provider
      value={{
        navStyle,
        setNavStyle,
        navOffset,
        setNavOffset,
        islandBottomOffset: navOffset,
        setIslandBottomOffset: setNavOffset
      }}
    >
      {children}
    </NavigationStyleContext.Provider>
  );
};

export const useNavigationStyle = () => useContext(NavigationStyleContext);
