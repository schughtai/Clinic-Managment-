<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import { dateOnly, genderLabel, phoneText } from '../format';
import { locale, setLocale, t } from '../i18n';
import { notifyError } from '../toast';
import type { PrescriptionPrint } from '../types';

const route = useRoute();
const data = ref<PrescriptionPrint | null>(null);
const place = computed(() => [data.value?.clinic.address, data.value?.clinic.city].filter((part) => part).join(', '));

function printPage(): void {
  window.print();
}

onMounted(async () => {
  try {
    data.value = await api.get<PrescriptionPrint>(`/visits/${String(route.params.visitId)}/prescription/print`);
    // The sheet uses the clinic's language unless the person picked another one.
    if (localStorage.getItem('clinic.locale') === null) setLocale(data.value.clinic.locale, false);
  } catch (error) {
    notifyError(error);
  }
});
</script>

<template>
  <div v-if="data">
    <div class="row no-print" style="margin-bottom: 12px">
      <button class="btn primary" type="button" @click="printPage">{{ t('Print') }}</button>
      <button class="btn" type="button" @click="setLocale(locale === 'en' ? 'ur' : 'en')">{{ locale === 'en' ? 'اردو' : 'English' }}</button>
    </div>
    <article class="sheet">
      <header>
        <h1>{{ data.clinic.name }}</h1>
        <div class="muted small">{{ place }}<span v-if="data.clinic.phone"> · {{ phoneText(data.clinic.phone) }}</span></div>
      </header>
      <hr />
      <div class="row" style="justify-content: space-between">
        <div><strong>{{ data.patient.name }}</strong> <span class="muted">#{{ data.patient.patientNo }}</span>
          <div class="small muted"><span v-if="data.patient.age !== null">{{ t('Age') }} {{ data.patient.age }}</span> <span v-if="data.patient.gender">· {{ t(genderLabel(data.patient.gender)) }}</span></div></div>
        <div class="small" style="text-align: end"><div>{{ dateOnly(data.visitedAt) }}</div><div>{{ data.doctor.name }}<span v-if="data.doctor.specialty"> · {{ data.doctor.specialty }}</span></div></div>
      </div>
      <p v-if="data.diagnosis"><strong>{{ t('Diagnosis') }}:</strong> {{ data.diagnosis }}</p>
      <table>
        <thead><tr><th>#</th><th>{{ t('Medicine') }}</th><th>{{ t('Dose') }}</th><th>{{ t('Frequency') }}</th><th>{{ t('Duration') }}</th></tr></thead>
        <tbody>
          <tr v-for="(item, index) in data.items" :key="index">
            <td>{{ index + 1 }}</td>
            <td><strong>{{ item.medicine }}</strong><div v-if="item.instructions" class="small muted">{{ item.instructions }}</div></td>
            <td>{{ item.dose }}</td><td>{{ item.frequency }}</td><td>{{ item.duration }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="data.advice"><strong>{{ t('Advice') }}:</strong> {{ data.advice }}</p>
      <p v-if="data.followUpOn"><strong>{{ t('Follow-up date') }}:</strong> {{ data.followUpOn }}</p>
    </article>
  </div>
  <div v-else class="empty">{{ t('Loading') }}…</div>
</template>
