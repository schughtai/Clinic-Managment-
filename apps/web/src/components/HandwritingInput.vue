<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { prepareImage } from '../image';
import { t } from '../i18n';
import { notify, notifyError } from '../toast';
import type { UploadResult } from '../types';

const props = defineProps<{ visitId: string }>();
const emit = defineEmits<{ uploaded: [result: UploadResult] }>();

const busy = ref(false);
const mode = ref<'photo' | 'draw'>('photo');
const canvas = ref<HTMLCanvasElement | null>(null);
let drawing = false;
let hasInk = false;

async function send(blob: Blob): Promise<void> {
  busy.value = true;
  try {
    const form = new FormData();
    form.append('image', await prepareImage(blob), 'note.jpg');
    const result = await api.upload<UploadResult>(`/visits/${props.visitId}/handwriting`, form);
    emit('uploaded', result);
    notify(t('Photo saved'));
  } catch (error) {
    notifyError(error);
  } finally {
    busy.value = false;
  }
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file !== undefined) await send(file);
}

function reset(): void {
  const element = canvas.value;
  const context = element?.getContext('2d');
  if (element === null || element === undefined || context === null || context === undefined) return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, element.width, element.height);
  context.strokeStyle = '#111827';
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  hasInk = false;
}

onMounted(reset);

function position(event: PointerEvent): { x: number; y: number } {
  const element = canvas.value;
  if (element === null) return { x: 0, y: 0 };
  const box = element.getBoundingClientRect();
  return { x: ((event.clientX - box.left) / box.width) * element.width, y: ((event.clientY - box.top) / box.height) * element.height };
}

function down(event: PointerEvent): void {
  const context = canvas.value?.getContext('2d');
  if (context === null || context === undefined) return;
  drawing = true;
  canvas.value?.setPointerCapture(event.pointerId);
  const { x, y } = position(event);
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + 0.1, y + 0.1);
  context.stroke();
  hasInk = true;
}

function move(event: PointerEvent): void {
  if (!drawing) return;
  const context = canvas.value?.getContext('2d');
  if (context === null || context === undefined) return;
  const { x, y } = position(event);
  context.lineTo(x, y);
  context.stroke();
}

function up(): void {
  drawing = false;
}

async function useDrawing(): Promise<void> {
  const element = canvas.value;
  if (element === null || !hasInk) {
    notifyError(new Error(t('Write something first.')));
    return;
  }
  const blob = await new Promise<Blob | null>((resolve) => element.toBlob(resolve, 'image/png'));
  if (blob === null) return;
  await send(blob);
  reset();
}
</script>

<template>
  <div class="stack">
    <div class="tabs">
      <button type="button" :class="{ active: mode === 'photo' }" @click="mode = 'photo'">{{ t('Take or choose a photo') }}</button>
      <button type="button" :class="{ active: mode === 'draw' }" @click="mode = 'draw'">{{ t('Write on screen') }}</button>
    </div>
    <label v-show="mode === 'photo'" class="btn">
      📷 {{ t('Take or choose a photo') }}
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden :disabled="busy" @change="onFile" />
    </label>
    <div v-show="mode === 'draw'" class="stack">
      <canvas
        ref="canvas"
        width="900"
        height="420"
        style="width: 100%; touch-action: none; border: 1px solid var(--line); border-radius: 8px; background: #fff"
        @pointerdown.prevent="down"
        @pointermove.prevent="move"
        @pointerup="up"
        @pointercancel="up"
      />
      <div class="row">
        <button type="button" class="btn" @click="reset">{{ t('Clear') }}</button>
        <button type="button" class="btn primary" :disabled="busy" @click="useDrawing">{{ t('Use this drawing') }}</button>
      </div>
    </div>
    <div v-if="busy" class="muted small">{{ t('Reading the note') }}…</div>
  </div>
</template>
