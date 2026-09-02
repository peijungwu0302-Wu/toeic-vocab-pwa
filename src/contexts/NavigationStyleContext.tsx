import React, { createContext, useContext, useState } from 'react';

export type BottomNavStyle = 'classic' | 'flush' | 'island';

interface NavigationStyleContextValue {
  navStyle: BottomNavStyle;
  setNavStyle: (style: BottomNavStyle) => void;
}

const NavigationStyleContext = createContext<NavigationStyleContextValue>({
  navStyle: 'classic',
  setNavStyle: () => {}
});

export const NavigationStyleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [navStyle, setNavStyleState] = useState<BottomNavStyle>(() => {
    return (localStorage.getItem('toeic_bottom_nav_style') as BottomNavStyle) || 'classic';
  });

  const setNavStyle = (style: BottomNavStyle) => {
    setNavStyleState(style);
    localStorage.setItem('toeic_bottom_nav_style', style);
  };

  return (
    <NavigationStyleContext.Provider value={{ navStyle, setNavStyle }}>
      {children}
    </NavigationStyleContext.Provider>
  );
};

export const useNavigationStyle = () => useContext(NavigationStyleContext);
