import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import fr from '../lang/fr';
import en from '../lang/en';
import api from '../services/api';

export type Lang = 'fr' | 'en';

const CATALOGS: Record<Lang, Record<string, unknown>> = { fr, en };
const STORAGE_KEY = 'ob_lang';
export const AVAILABLE_LANGS: { code: Lang; label: string }[] = [
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
];

function get(obj: unknown, key: string): string {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return key;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : key;
}

interface LangContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextType | undefined>(undefined);

export const LangProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored && stored in CATALOGS) return stored;
    return 'fr';
  });

  useEffect(() => {
    api.get('/features')
      .then(res => {
        const serverDefault = (res.data as any).defaultLang as string;
        if (!localStorage.getItem(STORAGE_KEY) && serverDefault in CATALOGS) {
          setLangState(serverDefault as Lang);
        }
      })
      .catch(() => {});
  }, []);

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem(STORAGE_KEY, l);
    setLangState(l);
  }, []);

  const t = useCallback((key: string) => get(CATALOGS[lang], key), [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
};

export const useLang = (): LangContextType => {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used within a LangProvider');
  return ctx;
};
