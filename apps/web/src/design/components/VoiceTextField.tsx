import { useId, useState } from 'react';
import { useLocale, useT } from '../../i18n';
import { Icon } from './Icon';
import { type DictationLanguage, useDictation } from './useDictation';

/**
 * A text field (single line or multi-line) with a microphone button. Spoken words are added to the
 * text for the person to check and edit; saving is always their own action.
 */
export function VoiceTextField({
  label,
  value,
  onChange,
  multiline,
  hint,
  error,
  required,
  maxLength,
  name,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  maxLength?: number;
  name?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const id = useId();
  const [language, setLanguage] = useState<DictationLanguage>(locale === 'ur' ? 'ur-PK' : 'en-PK');
  const dictation = useDictation((heard) => {
    const joined = value.trim() === '' ? heard : `${value.replace(/\s+$/, '')} ${heard}`;
    onChange(maxLength === undefined ? joined : joined.slice(0, maxLength));
  });

  const describedBy = [hint !== undefined ? `${id}-hint` : null, error !== undefined ? `${id}-error` : null, `${id}-voice`]
    .filter(Boolean)
    .join(' ');
  const common = {
    id,
    name,
    value,
    maxLength,
    required,
    'aria-describedby': describedBy,
    'aria-invalid': error !== undefined ? true : undefined,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  };

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required === true ? (
          <span className="required" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {multiline === true ? <textarea className="textarea" {...common} /> : <input className="input" {...common} />}
      <div className="row" id={`${id}-voice`}>
        {dictation.supported ? (
          <>
            {dictation.listening ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={dictation.stop} aria-pressed="true">
                <Icon name="stop" size={14} />
                {t('Stop')}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => dictation.start(language)} aria-pressed="false">
                <Icon name="mic" size={14} />
                {t('Speak')}
                <span className="visually-hidden">: {label}</span>
              </button>
            )}
            <select
              className="select"
              style={{ inlineSize: 'auto', minBlockSize: 32, paddingBlock: 2 }}
              value={language}
              onChange={(event) => setLanguage(event.target.value as DictationLanguage)}
              aria-label={t('Language')}
              disabled={dictation.listening}
            >
              <option value="en-PK">{t('English')}</option>
              <option value="ur-PK">{t('Urdu')}</option>
            </select>
            {dictation.listening ? (
              <span className="small muted" aria-live="polite">
                {dictation.interim !== '' ? dictation.interim : t('Listening…')}
              </span>
            ) : null}
          </>
        ) : (
          <span className="small muted">{t('Voice typing works in Chrome and Edge.')}</span>
        )}
      </div>
      {dictation.error !== null ? (
        <span className="error" role="alert">
          {t(dictation.error)}
        </span>
      ) : null}
      {hint !== undefined ? (
        <span id={`${id}-hint`} className="hint">
          {hint}
        </span>
      ) : null}
      {error !== undefined ? (
        <span id={`${id}-error`} className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
