<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api';
import { dateOnly, genderLabel, phoneText } from '../format';
import { t } from '../i18n';
import { notifyError } from '../toast';
import type { PatientListItem } from '../types';

const PAGE = 25;
const router = useRouter();
const query = ref('');
const items = ref<PatientListItem[]>([]);
const total = ref(0);
const loading = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let latest = 0;

async function load(reset: boolean): Promise<void> {
  const mine = ++latest;
  loading.value = true;
  try {
    const offset = reset ? 0 : items.value.length;
    const response = await api.get<{ items: PatientListItem[]; total: number }>('/patients', { q: query.value.trim(), limit: PAGE, offset });
    if (mine !== latest) return;
    items.value = reset ? response.items : [...items.value, ...response.items];
    total.value = response.total;
  } catch (error) {
    notifyError(error);
  } finally {
    if (mine === latest) loading.value = false;
  }
}

watch(query, () => {
  clearTimeout(timer);
  timer = setTimeout(() => void load(true), 250);
});
onMounted(() => void load(true));
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="page-head">
    <h1>{{ t('Patients') }}</h1>
    <RouterLink class="btn primary right" to="/patients/new">{{ t('New patient') }}</RouterLink>
  </div>
  <div class="card">
    <input v-model="query" type="search" :placeholder="t('Search by name, phone or number')" :aria-label="t('Search')" autofocus />
    <p class="muted small">{{ total }} {{ t('Patients') }}</p>
    <div v-if="!loading && items.length === 0" class="empty">{{ t('No patients found.') }}</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>{{ t('Name') }}</th><th>{{ t('Phone') }}</th><th>{{ t('Age') }}</th><th>{{ t('Gender') }}</th><th>{{ t('Last visit') }}</th></tr></thead>
        <tbody>
          <tr v-for="patient in items" :key="patient.id" class="clickable" @click="router.push(`/patients/${patient.id}`)">
            <td>{{ patient.patientNo }}</td>
            <td><RouterLink :to="`/patients/${patient.id}`" @click.stop>{{ patient.name }}</RouterLink></td>
            <td>{{ phoneText(patient.phone) }}</td>
            <td>{{ patient.age ?? '' }}</td>
            <td>{{ t(genderLabel(patient.gender)) }}</td>
            <td>{{ patient.lastVisitAt ? dateOnly(patient.lastVisitAt) : '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="row" style="margin-top: 12px">
      <button v-if="items.length < total" class="btn" type="button" :disabled="loading" @click="load(false)">{{ t('Show more') }}</button>
    </div>
  </div>
</template>
