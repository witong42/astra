import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  type InterfaceLanguage,
  messages,
  readLanguage,
  writeLanguage,
} from "./locale";

export const LocaleContext = createContext({
  language: "fr" as InterfaceLanguage,
  t: messages.fr,
  setLanguage: (_language: InterfaceLanguage): void => {
    throw new Error("The language control requires LocaleProvider.");
  },
});

export function LocaleProvider({
  children,
  initialLanguage,
}: {
  children: ReactNode;
  initialLanguage?: InterfaceLanguage;
}) {
  const [language, setCurrent] = useState<InterfaceLanguage>(
    () => initialLanguage ?? readLanguage(),
  );
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <LocaleContext.Provider
      value={{
        language,
        t: messages[language],
        setLanguage: (next) => {
          writeLanguage(next);
          setCurrent(next);
        },
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export const useLocale = () => useContext(LocaleContext);
