<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import { money, todayLocal } from '../format';
import { t } from '../i18n';
import { can } from '../session';
import { notify, notifyError } from '../toast';
import type { Closing, DailyReport, DoctorReportRow } from '../types';

const date = ref(todayLocal());
const report = ref<DailyReport | null>(null);
const closings = ref<Closing[]>([]);
const counted = ref(0);
const note = ref('');
const from = ref(todayLocal(-6));
const to = ref(todayLocal());
const doctorRows = ref<DoctorReportRow[]>([]);

async function load(): Promise<void> {
  try {
    report.value = await api.get<DailyReport>('/reports/daily', { date: date.value });
    counted.value = report.value.collected.byMethod.cash;
    closings.value = await api.get<Closing[]>('/closings', { limit: 14 });
  } catch (error) {
    notifyError(error);
  }
}

async function close(): Promise<void> {
  try {
    await api.post('/closings', { date: date.value, countedCash: counted.value, note: note.value.trim() === '' ? null : note.value.trim() });
    notify(t('Day closed'));
    note.value = '';
    await load();
  } catch (error) {
    notifyError(error);
  }
}

async function loadDoctors(): Promise<void> {
  if (!can('owner')) return;
  try {
    doctorRows.value = await api.get<DoctorReportRow[]>('/reports/doctors', { from: from.value, to: to.value });
  } catch (error) {
    notifyError(error);
  }
}

watch(date, () => void load());
watch([from, to], () => void loadDoctors());
onMounted(() => {
  void load();
  void loadDoctors();
});
</script>

<template>
  <div class="page-head">
    <h1>{{ t('Reports') }}</h1>
    <input v-model="date" type="date" style="width: auto" :aria-label="t('Date')" />
  </div>

  <template v-if="report">
    <div class="grid" style="margin-bottom: 16px">
      <div class="kpi"><div class="value">{{ money(report.collected.total) }}</div><div class="label">{{ t('Collected today') }}</div></div>
      <div class="kpi"><div class="value">{{ money(report.invoices.billed) }}</div><div class="label">{{ t('Billed today') }} ({{ report.invoices.count }})</div></div>
      <div class="kpi"><div class="value">{{ money(report.outstanding.amount) }}</div><div class="label">{{ t('Still owed') }} ({{ report.outstanding.count }})</div></div>
      <div class="kpi"><div class="value">{{ report.visits }}</div><div class="label">{{ t('Visits') }}</div></div>
    </div>

    <section class="card">
      <h2>{{ t('Collected today') }}</h2>
      <div class="grid">
        <div><div class="muted small">{{ t('Cash') }}</div><strong>{{ money(report.collected.byMethod.cash) }}</strong></div>
        <div><div class="muted small">{{ t('Bank') }}</div><strong>{{ money(report.collected.byMethod.bank) }}</strong></div>
        <div><div class="muted small">{{ t('JazzCash') }}</div><strong>{{ money(report.collected.byMethod.jazzcash) }}</strong></div>
        <div><div class="muted small">{{ t('Easypaisa') }}</div><strong>{{ money(report.collected.byMethod.easypaisa) }}</strong></div>
      </div>
    </section>

    <section class="card stack">
      <h2>{{ t('Close the day') }}</h2>
      <template v-if="report.closing">
        <div class="notice">{{ t('Day closed') }} · {{ t('Expected cash') }} {{ money(report.closing.expectedCash) }} · {{ t('Cash counted') }} {{ money(report.closing.countedCash) }} ·
          {{ t('Difference') }} <strong>{{ report.closing.difference === 0 ? '0' : money(report.closing.difference) }}</strong></div>
      </template>
      <form v-else class="grid" style="align-items: end" @submit.prevent="close">
        <label class="field"><span>{{ t('Expected cash') }}</span><input :value="report.collected.byMethod.cash" disabled /></label>
        <label class="field"><span>{{ t('Cash counted') }}</span><input v-model.number="counted" type="number" min="0" inputmode="numeric" required /></label>
        <label class="field"><span>{{ t('Notes') }}</span><input v-model="note" maxlength="500" /></label>
        <button class="btn primary" type="submit">{{ t('Close the day') }}</button>
      </form>
    </section>
  </template>

  <section v-if="closings.length" class="card">
    <h2>{{ t('Day closed') }}</h2>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>{{ t('Date') }}</th><th class="num">{{ t('Expected cash') }}</th><th class="num">{{ t('Cash counted') }}</th><th class="num">{{ t('Difference') }}</th></tr></thead>
        <tbody><tr v-for="entry in closings" :key="entry.id"><td>{{ entry.date }}</td><td class="num">{{ money(entry.expectedCash) }}</td><td class="num">{{ money(entry.countedCash) }}</td><td class="num">{{ entry.difference }}</td></tr></tbody>
      </table>
    </div>
  </section>

  <section v-if="can('owner')" class="card stack">
    <h2>{{ t('Doctors') }}</h2>
    <div class="row"><input v-model="from" type="date" style="width: auto" :aria-label="t('From')" /><input v-model="to" type="date" style="width: auto" :aria-label="t('To')" /></div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>{{ t('Doctor') }}</th><th class="num">{{ t('Visits') }}</th><th class="num">{{ t('Billed') }}</th><th class="num">{{ t('Collected') }}</th></tr></thead>
        <tbody><tr v-for="row in doctorRows" :key="row.doctorId"><td>{{ row.doctorName }}</td><td class="num">{{ row.visits }}</td><td class="num">{{ money(row.billed) }}</td><td class="num">{{ money(row.collected) }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>
