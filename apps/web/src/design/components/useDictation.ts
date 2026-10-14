import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech to text with the browser's own recognition. No audio reaches our server. In Chrome the
 * browser sends audio to its vendor, so it needs internet and is not private; the organization is
 * told this before staff use it. Recognised text is handed to the caller to put into the field for
 * review. Nothing is ever saved automatically.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
export type RecognitionConstructor = new () => Recognition;

export function recognitionEngine(): RecognitionConstructor | undefined {
  const scope = globalThis as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export type DictationLanguage = 'en-PK' | 'ur-PK';

export function explainDictationError(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access was blocked. Allow the microphone for this site and try again.';
    case 'no-speech':
      return 'Nothing was heard. Speak closer to the microphone.';
    case 'network':
      return 'Speech to text needs an internet connection.';
    case 'language-not-supported':
      return 'This language is not available for speech in this browser.';
    default:
      return 'Speech to text stopped. Please try again.';
  }
}

export interface Dictation {
  supported: boolean;
  listening: boolean;
  /** Words heard so far that the browser may still change. */
  interim: string;
  error: string | null;
  start: (language: DictationLanguage) => void;
  stop: () => void;
}

/** `onFinal` receives each finished phrase. */
export function useDictation(onFinal: (text: string) => void): Dictation {
  const Engine = recognitionEngine();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const callback = useRef(onFinal);
  useEffect(() => {
    callback.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => recognition.current?.stop(), []);

  const start = useCallback(
    (language: DictationLanguage) => {
      if (Engine === undefined || recognition.current !== null) return;
      const engine = new Engine();
      engine.lang = language;
      engine.continuous = true;
      engine.interimResults = true;
      engine.onresult = (event) => {
        let finished = '';
        let pending = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result === undefined) continue;
          if (result.isFinal) finished += result[0].transcript;
          else pending += result[0].transcript;
        }
        setInterim(pending);
        if (finished.trim() !== '') callback.current(finished.trim());
      };
      engine.onerror = (event) => {
        if (event.error !== 'aborted') setError(explainDictationError(event.error));
      };
      engine.onend = () => {
        recognition.current = null;
        setListening(false);
        setInterim('');
      };
      setError(null);
      try {
        engine.start();
        recognition.current = engine;
        setListening(true);
      } catch {
        setListening(false);
      }
    },
    [Engine],
  );

  useEffect(() => () => recognition.current?.stop(), []);

  return { supported: Engine !== undefined, listening, interim, error, start, stop };
}
