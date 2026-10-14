<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../api';
import PatientPicker from '../components/PatientPicker.vue';
import StatusPill from '../components/StatusPill.vue';
import { phoneText, timeOnly, todayLocal } from '../format';
import { t } from '../i18n';
import { can } from '../session';
import { notify, notifyError } from '../toast';
import type { Appointment, AppointmentStatus, Doctor, PatientListItem, SlotsResult } from '../types';

const route = useRoute();
const date = ref(todayLocal());
const filterDoctor = ref('');
const doctors = ref<Doctor[]>([]);
const list = ref<Appointment[]>([]);
const loading = ref(false);

const bookPatient = ref<PatientListItem | null>(null);
const bookDoctor = ref('');
const bookDate = ref(todayLocal());
const slots = ref<SlotsResult | null>(null);
const slotsLoading = ref(false);
const reason = ref('');

const clinical = computed(() => can('owner', 'doctor'));

async function loadList(): Promise<void> {
  loading.value = true;
  try {
    list.value = await api.get<Appointment[]>('/appointments', { date: date.value, doctorId: filterDoctor.value });
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

async function loadSlots(): Promise<void> {
  slots.value = null;
  if (bookDoctor.value === '') return;
  slotsLoading.value = true;
  try {
    slots.value = await api.get<SlotsResult>(`/doctors/${bookDoctor.value}/slots`, { date: bookDate.value });
  } catch (error) {
    notifyError(error);
  } finally {
    slotsLoading.value = false;
  }
}

async function book(startsAt: string): Promise<void> {
  if (bookPatient.value === null) {
    notifyError(new Error(t('Choose a patient')));
    return;
  }
  try {
    await api.post('/appointments', { patientId: bookPatient.value.id, doctorId: bookDoctor.value, startsAt, reason: reason.value.trim() === '' ? null : reason.value.trim() });
    notify(t('Booked'));
    reason.value = '';
    await Promise.all([loadSlots(), loadList()]);
  } catch (error) {
    notifyError(error);
    await loadSlots();
  }
}

async function walkin(): Promise<void> {
  if (bookPatient.value === null || bookDoctor.value === '') {
    notifyError(new Error(t('Choose a patient and a doctor.')));
    return;
  }
  try {
    const created = await api.post<Appointment>('/appointments/walkin', { patientId: bookPatient.value.id, doctorId: bookDoctor.value, reason: reason.value.trim() === '' ? null : reason.value.trim() });
    notify(`${t('Token')} ${created.tokenNo ?? ''}`);
    date.value = todayLocal();
    await loadList();
  } catch (error) {
    notifyError(error);
  }
}

async function setStatus(entry: Appointment, status: AppointmentStatus): Promise<void> {
  try {
    await api.patch(`/appointments/${entry.id}/status`, { status });
    await Promise.all([loadList(), loadSlots()]);
  } catch (error) {
    notifyError(error);
  }
}

watch([date, filterDoctor], () => void loadList());
watch([bookDoctor, bookDate], () => void loadSlots());

onMounted(async () => {
  try {
    doctors.value = await api.get<Doctor[]>('/doctors');
    if (doctors.value.length === 1) bookDoctor.value = doctors.value[0]?.id ?? '';
    if (typeof route.query.patientId === 'string') {
      const patient = await api.get<PatientListItem>(`/patients/${route.query.patientId}`);
      bookPatient.value = patient;
    }
  } catch (error) {
    notifyError(error);
  }
  await loadList();
});
</script>

<template>
  <div class="page-head"><h1>{{ t('Appointments') }}</h1></div>

  <div class="grid-2">
    <section class="card stack">
      <h2>{{ t('Book appointment') }}</h2>
      <PatientPicker v-model="bookPatient" />
      <div class="grid">
        <label class="field"><span>{{ t('Doctor') }}</span>
          <select v-model="bookDoctor"><option value="" disabled>—</option><option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">{{ doctor.name }}</option></select>
        </label>
        <label class="field"><span>{{ t('Date') }}</span><input v-model="bookDate" type="date" /></label>
      </div>
      <label class="field"><span>{{ t('Reason') }}</span><input v-model="reason" maxlength="300" /></label>
      <div v-if="slotsLoading" class="muted">{{ t('Loading') }}…</div>
      <div v-else-if="slots?.onLeave" class="notice warn">{{ t('On leave') }}</div>
      <div v-else-if="slots && slots.slots.length === 0" class="empty">{{ t('No free times on this day.') }}</div>
      <div v-else-if="slots" class="slot-grid" role="group" :aria-label="t('Choose a time')">
        <button v-for="slot in slots.slots" :key="slot.startsAt" class="btn" :class="{ taken: !slot.available }" type="button" :disabled="!slot.available" @click="book(slot.startsAt)">{{ timeOnly(slot.startsAt) }}</button>
      </div>
      <div class="row"><button class="btn" type="button" @click="walkin">{{ t('Add walk-in') }}</button></div>
    </section>

    <section class="card stack">
      <div class="row">
        <h2 style="margin: 0">{{ t('Appointments') }}</h2>
        <input v-model="date" type="date" style="width: auto" :aria-label="t('Date')" />
        <select v-model="filterDoctor" style="width: auto" :aria-label="t('Doctor')"><option value="">{{ t('All') }}</option><option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">{{ doctor.name }}</option></select>
      </div>
      <div v-if="!loading && list.length === 0" class="empty">—</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ t('Time') }}</th><th>{{ t('Patients') }}</th><th>{{ t('Doctor') }}</th><th>{{ t('Status') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="entry in list" :key="entry.id">
              <td><span v-if="entry.tokenNo !== null" class="pill info">{{ t('Token') }} {{ entry.tokenNo }}</span><span v-else>{{ timeOnly(entry.startsAt) }}</span></td>
              <td><RouterLink :to="`/patients/${entry.patientId}`">{{ entry.patientName }}</RouterLink><div class="muted small">{{ phoneText(entry.patientPhone) }}</div></td>
              <td>{{ entry.doctorName }}</td>
              <td><StatusPill :status="entry.status" /></td>
              <td class="row">
                <button v-if="entry.status === 'booked'" class="btn sm" type="button" @click="setStatus(entry, 'arrived')">{{ t('Arrived') }}</button>
                <button v-if="entry.status === 'booked' || entry.status === 'arrived'" class="btn sm" type="button" @click="setStatus(entry, 'cancelled')">{{ t('Cancel') }}</button>
                <button v-if="entry.status === 'booked'" class="btn sm" type="button" @click="setStatus(entry, 'no_show')">{{ t('No show') }}</button>
                <button v-if="entry.status === 'arrived' && clinical" class="btn sm primary" type="button" @click="setStatus(entry, 'in_consult')">{{ t('Start consultation') }}</button>
                <button v-if="entry.status === 'in_consult' && clinical" class="btn sm" type="button" @click="setStatus(entry, 'done')">{{ t('Mark done') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
