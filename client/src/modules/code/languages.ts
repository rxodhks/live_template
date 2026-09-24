import type { LanguageSupport } from '@codemirror/language';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { getLanguage } from '@shared/schema';

const cache = new Map<string, Promise<LanguageSupport | null>>();

/** 언어 지원은 필요할 때만 불러온다 (코드 분할) */
export function loadLanguage(id: string): Promise<Extension> {
  const lang = getLanguage(id);
  if (!lang.cm) return Promise.resolve([]);
  let p = cache.get(lang.id);
  if (!p) {
    const desc = LanguageDescription.matchLanguageName(languages, lang.cm, false);
    p = desc ? desc.load().catch(() => null) : Promise.resolve(null);
    cache.set(lang.id, p);
  }
  return p.then((support) => support ?? []);
}
