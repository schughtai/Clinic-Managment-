<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { dateTime, phoneText } from '../format';
import { setLocale, t } from '../i18n';
import { can, loadProfile, session } from '../session';
import { notify, notifyError } from '../toast';
import type { AuditEntry, ClinicSettings, Doctor, ImportResult, Role, ScheduleSession, StaffUser } from '../types';

type Tab = 'account' | 'clinic' | 'staff' | 'doctors' | 'data' | 'audit';
const tab = ref<Tab>('account');
const tabs = computed(() => [
  { id: 'account' as Tab, label: 'Account', show: true },
  { id: 'clinic' as Tab, label: 'Clinic', show: can('owner') },
  { id: 'staff' as Tab, label: 'Staff', show: can('owner') },
  { id: 'doctors' as Tab, label: 'Doctors', show: can('owner') },
  { id: 'data' as Tab, label: 'Data', show: can('owner', 'receptionist') },
  { id: 'audit' as Tab, label: 'Activity log', show: can('owner') },
]);

// Account
const passwords = reactive({ current: '', next: '' });
async function changePassword(): Promise<void> {
  try {
    await api.post('/auth/change-password', { currentPassword: passwords.current, newPassword: passwords.next });
    passwords.current = '';
    passwords.next = '';
    notify(t('Password changed'));
  } catch (error) {
    notifyError(error);
  }
}

// Clinic
const clinic = ref<ClinicSettings | null>(null);
const clinicForm = reactive({ name: '', phone: '', address: '', city: '', locale: 'en' as 'en' | 'ur', aiEnabled: false });
async function loadClinic(): Promise<void> {
  clinic.value = await api.get<ClinicSettings>('/clinic');
  Object.assign(clinicForm, { name: clinic.value.name, phone: clinic.value.phone ?? '', address: clinic.value.address ?? '', city: clinic.value.city ?? '', locale: clinic.value.locale, aiEnabled: clinic.value.aiEnabled });
}
async function saveClinic(): Promise<void> {
  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  try {
    await api.patch('/clinic', { name: clinicForm.name.trim(), phone: text(clinicForm.phone), address: text(clinicForm.address), city: text(clinicForm.city), locale: clinicForm.locale, aiEnabled: clinicForm.aiEnabled });
    await loadClinic();
    await loadProfile();
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}

// Staff
const staff = ref<StaffUser[]>([]);
const newStaff = reactive({ name: '', phone: '', password: '', role: 'receptionist' as Role });
async function loadStaff(): Promise<void> {
  staff.value = await api.get<StaffUser[]>('/users');
}
async function addStaff(): Promise<void> {
  try {
    await api.post('/users', { name: newStaff.name.trim(), phone: newStaff.phone, password: newStaff.password, role: newStaff.role });
    Object.assign(newStaff, { name: '', phone: '', password: '', role: 'receptionist' });
    await loadStaff();
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}
async function patchStaff(user: StaffUser, patch: Partial<Pick<StaffUser, 'role' | 'active'>>): Promise<void> {
  try {
    await api.patch(`/users/${user.id}`, patch);
    await loadStaff();
  } catch (error) {
    notifyError(error);
    await loadStaff();
  }
}
async function resetPassword(user: StaffUser): Promise<void> {
  const value = window.prompt(t('New password'));
  if (value === null || value === '') return;
  try {
    await api.post(`/users/${user.id}/reset-password`, { newPassword: value });
    notify(t('Password changed'));
  } catch (error) {
    notifyError(error);
  }
}

// Doctors
const doctors = ref<Doctor[]>([]);
const newDoctor = reactive({ name: '', specialty: '', defaultFee: 0, slotMinutes: 15 });
const editingSchedule = ref<string | null>(null);
const sessions = ref<ScheduleSession[]>([]);
const leaveDate = ref('');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
async function loadDoctors(): Promise<void> {
  doctors.value = await api.get<Doctor[]>('/doctors', { includeInactive: 'true' });
}
async function addDoctor(): Promise<void> {
  try {
    await api.post('/doctors', { name: newDoctor.name.trim(), specialty: newDoctor.specialty.trim() === '' ? null : newDoctor.specialty.trim(), defaultFee: newDoctor.defaultFee, slotMinutes: newDoctor.slotMinutes });
    Object.assign(newDoctor, { name: '', specialty: '', defaultFee: 0, slotMinutes: 15 });
    await loadDoctors();
  } catch (error) {
    notifyError(error);
  }
}
async function patchDoctor(doctor: Doctor, patch: Record<string, unknown>): Promise<void> {
  try {
    await api.patch(`/doctors/${doctor.id}`, patch);
    await loadDoctors();
  } catch (error) {
    notifyError(error);
  }
}
function editSchedule(doctor: Doctor): void {
  editingSchedule.value = editingSchedule.value === doctor.id ? null : doctor.id;
  sessions.value = doctor.schedule.map((entry) => ({ ...entry }));
}
async function saveSchedule(doctor: Doctor): Promise<void> {
  try {
    await api.put(`/doctors/${doctor.id}/schedule`, { sessions: sessions.value });
    editingSchedule.value = null;
    await loadDoctors();
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}
async function addLeave(doctor: Doctor): Promise<void> {
  if (leaveDate.value === '') return;
  try {
    await api.post(`/doctors/${doctor.id}/leaves`, { date: leaveDate.value });
    leaveDate.value = '';
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}

// Data
const importFile = ref<File | null>(null);
const importResult = ref<ImportResult | null>(null);
async function runImport(dryRun: boolean): Promise<void> {
  if (importFile.value === null) return;
  const form = new FormData();
  form.append('file', importFile.value);
  form.append('dryRun', String(dryRun));
  try {
    importResult.value = await api.upload<ImportResult>('/patients/import', form);
    if (!dryRun && importResult.value.created > 0) notify(`${importResult.value.created} ${t('Patients')}`);
  } catch (error) {
    notifyError(error);
  }
}

// Activity log
const audit = ref<AuditEntry[]>([]);
async function loadAudit(): Promise<void> {
  audit.value = (await api.get<{ items: AuditEntry[] }>('/audit', { limit: 50 })).items;
}

async function show(next: Tab): Promise<void> {
  tab.value = next;
  try {
    if (next === 'clinic') await loadClinic();
    if (next === 'staff') await loadStaff();
    if (next === 'doctors') await loadDoctors();
    if (next === 'audit') await loadAudit();
  } catch (error) {
    notifyError(error);
  }
}

onMounted(() => void show('account'));
</script>

<template>
  <div class="page-head"><h1>{{ t('Settings') }}</h1></div>
  <div class="tabs" role="tablist">
    <button v-for="entry in tabs.filter((item) => item.show)" :key="entry.id" type="button" role="tab" :class="{ active: tab === entry.id }" @click="show(entry.id)">{{ t(entry.label) }}</button>
  </div>

  <section v-if="tab === 'account'" class="card stack" style="max-width: 460px">
    <h2>{{ t('Change password') }}</h2>
    <p class="muted small">{{ session.profile?.user.name }} · {{ phoneText(session.profile?.user.phone ?? null) }}</p>
    <form class="stack" @submit.prevent="changePassword">
      <label class="field"><span>{{ t('Current password') }}</span><input v-model="passwords.current" type="password" autocomplete="current-password" required /></label>
      <label class="field"><span>{{ t('New password') }}</span><input v-model="passwords.next" type="password" autocomplete="new-password" minlength="8" maxlength="72" required /></label>
      <button class="btn primary" type="submit">{{ t('Change password') }}</button>
    </form>
  </section>

  <section v-if="tab === 'clinic' && clinic" class="card stack" style="max-width: 640px">
    <form class="stack" @submit.prevent="saveClinic">
      <label class="field"><span>{{ t('Name') }}</span><input v-model="clinicForm.name" required maxlength="120" /></label>
      <div class="grid-2">
        <label class="field"><span>{{ t('Phone') }}</span><input v-model="clinicForm.phone" type="tel" /></label>
        <label class="field"><span>{{ t('City') }}</span><input v-model="clinicForm.city" maxlength="80" /></label>
      </div>
      <label class="field"><span>{{ t('Address') }}</span><input v-model="clinicForm.address" maxlength="300" /></label>
      <label class="field"><span>{{ t('Language') }}</span>
        <select v-model="clinicForm.locale" @change="setLocale(clinicForm.locale)"><option value="en">English</option><option value="ur">اردو</option></select>
      </label>
      <div class="card" style="margin: 0">
        <label class="row"><input v-model="clinicForm.aiEnabled" type="checkbox" :disabled="!clinic.aiAvailable" /> <span>{{ t('Use AI to read handwriting and tidy notes') }}</span></label>
        <p v-if="!clinic.aiAvailable" class="notice warn small">{{ t('AI is not set up on this server yet. Ask whoever installed the system to add an API key.') }}</p>
        <p class="muted small">{{ t('When AI is on, photos of handwritten notes and the text of dictated notes are sent to an AI company for processing. This is patient information. Only turn it on if your patients are told. Voice typing in Chrome also sends audio to Google.') }}</p>
      </div>
      <button class="btn primary" type="submit">{{ t('Save') }}</button>
    </form>
  </section>

  <template v-if="tab === 'staff'">
    <section class="card">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ t('Name') }}</th><th>{{ t('Phone') }}</th><th>{{ t('Role') }}</th><th>{{ t('Active') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="user in staff" :key="user.id">
              <td>{{ user.name }}</td>
              <td>{{ phoneText(user.phone) }}</td>
              <td>
                <select :value="user.role" :disabled="user.id === session.profile?.user.id" @change="patchStaff(user, { role: ($event.target as HTMLSelectElement).value as Role })">
                  <option value="owner">{{ t('Owner') }}</option><option value="doctor">{{ t('Doctor') }}</option><option value="receptionist">{{ t('Receptionist') }}</option>
                </select>
              </td>
              <td><input type="checkbox" :checked="user.active" :disabled="user.id === session.profile?.user.id" :aria-label="t('Active')" @change="patchStaff(user, { active: ($event.target as HTMLInputElement).checked })" /></td>
              <td><button class="btn sm" type="button" @click="resetPassword(user)">{{ t('Change password') }}</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="card stack">
      <h2>{{ t('Add staff member') }}</h2>
      <form class="grid" style="align-items: end" @submit.prevent="addStaff">
        <label class="field"><span>{{ t('Name') }}</span><input v-model="newStaff.name" required maxlength="120" /></label>
        <label class="field"><span>{{ t('Phone') }}</span><input v-model="newStaff.phone" type="tel" required /></label>
        <label class="field"><span>{{ t('Password') }}</span><input v-model="newStaff.password" type="password" minlength="8" maxlength="72" required autocomplete="new-password" /></label>
        <label class="field"><span>{{ t('Role') }}</span>
          <select v-model="newStaff.role"><option value="receptionist">{{ t('Receptionist') }}</option><option value="doctor">{{ t('Doctor') }}</option><option value="owner">{{ t('Owner') }}</option></select>
        </label>
        <button class="btn primary" type="submit">{{ t('Add') }}</button>
      </form>
    </section>
  </template>

  <template v-if="tab === 'doctors'">
    <section v-for="doctor in doctors" :key="doctor.id" class="card stack">
      <div class="row">
        <h2 style="margin: 0">{{ doctor.name }}</h2>
        <span v-if="!doctor.active" class="pill bad">{{ t('Inactive') }}</span>
        <button class="btn sm right" type="button" @click="patchDoctor(doctor, { active: !doctor.active })">{{ doctor.active ? t('Deactivate') : t('Activate') }}</button>
      </div>
      <div class="grid">
        <label class="field"><span>{{ t('Fee') }} (Rs)</span><input :value="doctor.defaultFee" type="number" min="0" @change="patchDoctor(doctor, { defaultFee: Number(($event.target as HTMLInputElement).value) })" /></label>
        <label class="field"><span>{{ t('Slot minutes') }}</span><input :value="doctor.slotMinutes" type="number" min="5" max="120" @change="patchDoctor(doctor, { slotMinutes: Number(($event.target as HTMLInputElement).value) })" /></label>
        <div class="field"><span>{{ t('Leave day') }}</span><div class="row"><input v-model="leaveDate" type="date" /><button class="btn sm" type="button" @click="addLeave(doctor)">{{ t('Add') }}</button></div></div>
      </div>
      <div class="row">
        <button class="btn sm" type="button" @click="editSchedule(doctor)">{{ t('Working hours') }}</button>
        <span class="muted small">{{ doctor.schedule.length }} {{ t('sessions a week') }}</span>
      </div>
      <div v-if="editingSchedule === doctor.id" class="stack">
        <div v-for="(entry, index) in sessions" :key="index" class="row">
          <select v-model.number="entry.weekday" style="width: auto"><option v-for="(day, number) in DAYS" :key="day" :value="number">{{ day }}</option></select>
          <input v-model="entry.start" type="time" style="width: auto" /><input v-model="entry.end" type="time" style="width: auto" />
          <button class="btn sm" type="button" @click="sessions.splice(index, 1)">{{ t('Remove') }}</button>
        </div>
        <div class="row">
          <button class="btn sm" type="button" @click="sessions.push({ weekday: 1, start: '09:00', end: '13:00' })">+ {{ t('Add') }}</button>
          <button class="btn sm primary" type="button" @click="saveSchedule(doctor)">{{ t('Save') }}</button>
        </div>
      </div>
    </section>
    <section class="card stack">
      <h2>{{ t('Add') }} {{ t('Doctor') }}</h2>
      <form class="grid" style="align-items: end" @submit.prevent="addDoctor">
        <label class="field"><span>{{ t('Name') }}</span><input v-model="newDoctor.name" required maxlength="120" /></label>
        <label class="field"><span>{{ t('Specialty') }}</span><input v-model="newDoctor.specialty" maxlength="80" /></label>
        <label class="field"><span>{{ t('Fee') }} (Rs)</span><input v-model.number="newDoctor.defaultFee" type="number" min="0" /></label>
        <label class="field"><span>{{ t('Slot minutes') }}</span><input v-model.number="newDoctor.slotMinutes" type="number" min="5" max="120" /></label>
        <button class="btn primary" type="submit">{{ t('Add') }}</button>
      </form>
      <p class="muted small">{{ t('A staff member with the doctor role gets a doctor profile automatically.') }}</p>
    </section>
  </template>

  <template v-if="tab === 'data'">
    <section class="card stack">
      <h2>{{ t('Import patients') }}</h2>
      <p class="muted small">{{ t('Save your spreadsheet as CSV. The first row must have column names such as Name, Phone, Gender, Age, Address. Patients without a phone number cannot be checked for duplicates.') }}</p>
      <input type="file" accept=".csv,text/csv" :aria-label="t('Import patients')" @change="importFile = ($event.target as HTMLInputElement).files?.[0] ?? null; importResult = null" />
      <div class="row">
        <button class="btn" type="button" :disabled="importFile === null" @click="runImport(true)">{{ t('Check file') }}</button>
        <button class="btn primary" type="button" :disabled="importFile === null || importResult === null || importResult.errors.length > 0 || importResult.valid === 0" @click="runImport(false)">{{ t('Import now') }}</button>
      </div>
      <div v-if="importResult" class="notice" :class="{ bad: importResult.errors.length > 0 }">
        {{ importResult.rows }} rows · {{ importResult.valid }} {{ t('ready') }} · {{ importResult.skippedDuplicates }} {{ t('already in the system') }}<span v-if="importResult.created"> · {{ importResult.created }} {{ t('imported') }}</span>
        <ul v-if="importResult.errors.length"><li v-for="problem in importResult.errors.slice(0, 20)" :key="problem.row">{{ t('Row') }} {{ problem.row }}: {{ problem.message }}</li></ul>
      </div>
    </section>
    <section v-if="can('owner')" class="card stack">
      <h2>{{ t('Download all data') }}</h2>
      <p class="muted small">{{ t('Everything your clinic has entered, in one file. Photos are listed but not included.') }}</p>
      <div class="row"><a class="btn" href="/api/export" download>{{ t('Download all data') }}</a></div>
    </section>
  </template>

  <section v-if="tab === 'audit'" class="card">
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>{{ t('Time') }}</th><th>{{ t('Name') }}</th><th>{{ t('Action') }}</th></tr></thead>
        <tbody><tr v-for="entry in audit" :key="entry.id"><td>{{ dateTime(entry.createdAt) }}</td><td>{{ entry.userName ?? '—' }}</td><td>{{ entry.action }}</td></tr></tbody>
      </table>
    </div>
  </section>
</template>
