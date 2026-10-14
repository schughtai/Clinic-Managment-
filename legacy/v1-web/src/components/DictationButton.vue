<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { t } from '../i18n';
import { notifyError } from '../toast';

/**
 * Speech to text with the browser's own recognition. No audio goes to our server.
 * In Chrome the browser sends audio to Google to turn it into text, so it needs internet and is not private.
 * Whatever is heard is added to the text box for the doctor to check.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
type RecognitionConstructor = new () => Recognition;

const props = defineProps<{ lang: string }>();
const emit = defineEmits<{ text: [value: string] }>();

const globalScope = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
const Engine = globalScope.SpeechRecognition ?? globalScope.webkitSpeechRecognition;
const supported = computed(() => Engine !== undefined);
const listening = ref(false);
let recognition: Recognition | undefined;

function explain(code: string): string {
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

function toggle(): void {
  if (Engine === undefined) return;
  if (listening.value) {
    recognition?.stop();
    return;
  }
  recognition = new Engine();
  recognition.lang = props.lang;
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    let heard = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result?.isFinal) heard += result[0].transcript;
    }
    if (heard.trim() !== '') emit('text', heard.trim());
  };
  recognition.onerror = (event) => {
    if (event.error !== 'aborted') notifyError(new Error(explain(event.error)));
  };
  recognition.onend = () => {
    listening.value = false;
  };
  try {
    recognition.start();
    listening.value = true;
  } catch {
    listening.value = false;
  }
}

onBeforeUnmount(() => recognition?.stop());
</script>

<template>
  <button
    v-if="supported"
    type="button"
    class="btn sm mic"
    :class="{ listening }"
    :aria-pressed="listening"
    @click="toggle"
  >
    {{ listening ? `⏹ ${t('Stop')}` : `🎤 ${t('Speak')}` }}
  </button>
  <span v-else class="muted small" :title="t('Voice typing works in Chrome and Edge.')">🎤 —</span>
</template>
