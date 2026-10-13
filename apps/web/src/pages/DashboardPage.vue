<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { api } from '../api';
import StatusPill from '../components/StatusPill.vue';
import { money, timeOnly } from '../format';
import { t } from '../i18n';
import { can, session } from '../session';
import { notifyError } from '../toast';
import type { Appointment, AppointmentStatus, DailyReport } from '../types';

const router = useRouter();
const queue = ref<Appointment[]>([]);
const report = ref<DailyReport | null>(null);
const loading = ref(true);
let timer: ReturnType<typeof setInterval> | undefined;

async function load(): Promise<void> {
  try {
    queue.value = await api.get<Appointment[]>('/appointments/queue');
    if (can('owner', 'receptionist')) report.value = await api.get<DailyReport>('/reports/daily');
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

async function setStatus(entry: Appointment, status: AppointmentStatus): Promise<void> {
  try {
    await api.patch(`/appointments/${entry.id}/status`, { status });
    await load();
  } catch (error) {
    notifyError(error);
  }
}

async function startConsultation(entry: Appointment): Promise<void> {
  await setStatus(entry, 'in_consult');
  await router.push({ name: 'visit-new', query: { patientId: entry.patientId, doctorId: entry.doctorId, appointmentId: entry.id } });
}

onMounted(() => {
  void load();
  // The queue changes through the day, so refresh it quietly.
  timer = setInterval(() => void load(), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="page-head">
    <h1>{{ t('Dashboard') }}</h1>
    <span class="muted">{{ session.profile?.clinic.name }}</span>
    <RouterLink class="btn primary right" to="/patients/new">{{ t('New patient') }}</RouterLink>
  </div>

  <div v-if="report" class="grid" style="margin-bottom: 16px">
    <div class="kpi"><div class="value">{{ money(report.collected.total) }}</div><div class="label">{{ t('Collected today') }}</div></div>
    <div class="kpi"><div class="value">{{ money(report.invoices.billed) }}</div><div class="label">{{ t('Billed today') }}</div></div>
    <div class="kpi"><div class="value">{{ money(report.outstanding.amount) }}</div><div class="label">{{ t('Still owed') }}</div></div>
    <div class="kpi"><div class="value">{{ report.newPatients }}</div><div class="label">{{ t('New patients today') }}</div></div>
  </div>

  <section class="card">
    <h2>{{ t("Today's queue") }}</h2>
    <div v-if="loading" class="empty">{{ t('Loading') }}…</div>
    <div v-else-if="queue.length === 0" class="empty">{{ t('Nobody is waiting.') }}</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>{{ t('Time') }}</th><th>{{ t('Patients') }}</th><th>{{ t('Doctor') }}</th><th>{{ t('Status') }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="entry in queue" :key="entry.id">
            <td>
              <span v-if="entry.tokenNo !== null" class="pill info">{{ t('Token') }} {{ entry.tokenNo }}</span>
              <span v-else>{{ timeOnly(entry.startsAt) }}</span>
            </td>
            <td><RouterLink :to="`/patients/${entry.patientId}`">{{ entry.patientName }}</RouterLink></td>
            <td>{{ entry.doctorName }}</td>
            <td><StatusPill :status="entry.status" /></td>
            <td class="row">
              <button v-if="entry.status === 'booked'" class="btn sm" type="button" @click="setStatus(entry, 'arrived')">{{ t('Arrived') }}</button>
              <button v-if="entry.status === 'arrived' && can('owner', 'doctor')" class="btn sm primary" type="button" @click="startConsultation(entry)">{{ t('Start consultation') }}</button>
              <template v-if="entry.status === 'in_consult' && can('owner', 'doctor')">
                <RouterLink class="btn sm" :to="{ name: 'visit-new', query: { patientId: entry.patientId, doctorId: entry.doctorId, appointmentId: entry.id } }">{{ t('New visit') }}</RouterLink>
                <button class="btn sm" type="button" @click="setStatus(entry, 'done')">{{ t('Mark done') }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
