import { Languages } from 'lucide-react';
import { LANGS, lang, setLanguage, t } from '../i18n';

/** 화면 언어 바꾸기 — 다른 언어 이름을 보여 주고, 누르면 그 언어로 새로고침한다 (한국어 ↔ English) */
export function LanguageSwitch({ className = 'lang-switch' }: { className?: string }) {
  const other = LANGS.find((l) => l.id !== lang)!;
  return (
    <button type="button" className={className} lang={other.id} onClick={() => setLanguage(other.id)} aria-label={t('화면 언어 바꾸기 · {name}', { name: other.label })}>
      <Languages size={13} aria-hidden /> {other.label}
    </button>
  );
}
