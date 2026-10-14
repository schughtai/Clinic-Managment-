<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../api';
import { phoneText } from '../format';
import { t } from '../i18n';
import { notifyError } from '../toast';
import type { PatientListItem } from '../types';

const props = defineProps<{ modelValue: PatientListItem | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: PatientListItem | null] }>();

const query = ref('');
const results = ref<PatientListItem[]>([]);
const searching = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

watch(query, (value) => {
  clearTimeout(timer);
  if (value.trim() === '') {
    results.value = [];
    return;
  }
  // Wait for a short pause in typing, and ignore answers that arrive late and out of order.
  timer = setTimeout(async () => {
    const mine = ++latest;
    searching.value = true;
    try {
      const response = await api.get<{ items: PatientListItem[] }>('/patients', { q: value.trim(), limit: 8 });
      if (mine === latest) results.value = response.items;
    } catch (error) {
      notifyError(error);
    } finally {
      if (mine === latest) searching.value = false;
    }
  }, 250);
});

onBeforeUnmount(() => clearTimeout(timer));

function choose(patient: PatientListItem): void {
  emit('update:modelValue', patient);
  query.value = '';
  results.value = [];
}
</script>

<template>
  <div class="stack">
    <div v-if="props.modelValue" class="row">
      <span class="pill info">#{{ props.modelValue.patientNo }} · {{ props.modelValue.name }}</span>
      <button class="btn sm" type="button" @click="emit('update:modelValue', null)">{{ t('Remove') }}</button>
    </div>
    <template v-else>
      <input v-model="query" type="search" :placeholder="t('Search by name, phone or number')" :aria-label="t('Choose a patient')" autocomplete="off" />
      <div v-if="searching" class="muted small">{{ t('Loading') }}…</div>
      <div v-for="patient in results" :key="patient.id" class="row">
        <button class="btn sm" type="button" @click="choose(patient)">
          #{{ patient.patientNo }} · {{ patient.name }} <span class="muted">{{ phoneText(patient.phone) }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
