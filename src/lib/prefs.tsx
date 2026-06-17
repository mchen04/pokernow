import { createContext, useContext, useState, type ReactNode } from "react";

// Per-client display preferences (not part of authoritative game state).
interface Prefs {
  fourColor: boolean; // 4-color deck (colorblind-friendly) vs classic 2-color
  setFourColor: (v: boolean) => void;
}

const PrefsContext = createContext<Prefs>({
  fourColor: true,
  setFourColor: () => {},
});

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [fourColor, setFour] = useState(() => localStorage.getItem("pn.fourColor") !== "0");
  const setFourColor = (v: boolean) => {
    setFour(v);
    localStorage.setItem("pn.fourColor", v ? "1" : "0");
  };
  return <PrefsContext.Provider value={{ fourColor, setFourColor }}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  return useContext(PrefsContext);
}
