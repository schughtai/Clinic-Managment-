<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import StatusPill from '../components/StatusPill.vue';
import { dateOnly, genderLabel, money, phoneText } from '../format';
import { t } from '../i18n';
import { can } from '../session';
import { notify, notifyError } from '../toast';
import type { Invoice, Patient, VisitSummary } from '../types';

const route = useRoute();
const router = useRouter();
const id = String(route.params.id);
const patient = ref<Patient | null>(null);
const visits = ref<VisitSummary[]>([]);
const invoices = ref<Invoice[]>([]);
const editing = ref(false);
const form = reactive({ name: '', phone: '', gender: '', age: '', guardianName: '', address: '', allergies: '', notes: '' });

function fillForm(source: Patient): void {
  form.name = source.name;
  form.phone = source.phone ?? '';
  form.gender = source.gender ?? '';
  form.age = source.age === null ? '' : String(source.age);
  form.guardianName = source.guardianName ?? '';
  form.address = source.address ?? '';
  form.allergies = source.allergies ?? '';
  form.notes = source.notes ?? '';
}

async function load(): Promise<void> {
  try {
    patient.value = await api.get<Patient>(`/patients/${id}`);
    fillForm(patient.value);
    if (can('owner', 'doctor')) visits.value = (await api.get<{ items: VisitSummary[] }>(`/patients/${id}/visits`, { limit: 50 })).items;
    if (can('owner', 'receptionist')) invoices.value = (await api.get<{ items: Invoice[] }>('/invoices', { patientId: id, limit: 20 })).items;
  } catch (error) {
    notifyError(error);
    await router.push('/patients');
  }
}

async function save(): Promise<void> {
  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  try {
    patient.value = await api.patch<Patient>(`/patients/${id}`, {
      name: form.name.trim(),
      phone: text(form.phone),
      gender: form.gender === '' ? null : form.gender,
      age: form.age.trim() === '' ? null : Number(form.age),
      guardianName: text(form.guardianName),
      address: text(form.address),
      allergies: text(form.allergies),
      notes: text(form.notes),
    });
    editing.value = false;
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}

onMounted(load);
</script>

<template>
  <template v-if="patient">
    <div class="page-head">
      <h1>{{ patient.name }}</h1>
      <span class="pill info">#{{ patient.patientNo }}</span>
      <div class="row right">
        <RouterLink class="btn" :to="{ name: 'appointments', query: { patientId: id } }">{{ t('Book appointment') }}</RouterLink>
        <RouterLink v-if="can('owner', 'doctor')" class="btn primary" :to="{ name: 'visit-new', query: { patientId: id } }">{{ t('New visit') }}</RouterLink>
        <RouterLink v-if="can('owner', 'receptionist')" class="btn" :to="{ name: 'billing', query: { patientId: id, new: '1' } }">{{ t('New invoice') }}</RouterLink>
      </div>
    </div>

    <section class="card">
      <div v-if="patient.allergies" class="notice warn" style="margin-bottom: 10px">⚠ {{ t('Allergies') }}: {{ patient.allergies }}</div>
      <div v-if="!editing" class="grid">
        <div><div class="muted small">{{ t('Phone') }}</div>{{ phoneText(patient.phone) || '—' }}</div>
        <div><div class="muted small">{{ t('Age') }}</div>{{ patient.age ?? '—' }}</div>
        <div><div class="muted small">{{ t('Gender') }}</div>{{ t(genderLabel(patient.gender)) || '—' }}</div>
        <div><div class="muted small">{{ t('Guardian') }}</div>{{ patient.guardianName ?? '—' }}</div>
        <div><div class="muted small">{{ t('Address') }}</div>{{ patient.address ?? '—' }}</div>
        <div v-if="patient.notes"><div class="muted small">{{ t('Notes') }}</div>{{ patient.notes }}</div>
      </div>
      <form v-else class="stack" @submit.prevent="save">
        <div class="grid-2">
          <label class="field"><span>{{ t('Name') }}</span><input v-model="form.name" required maxlength="120" /></label>
          <label class="field"><span>{{ t('Phone') }}</span><input v-model="form.phone" type="tel" inputmode="tel" /></label>
          <label class="field"><span>{{ t('Gender') }}</span>
            <select v-model="form.gender"><option value="">—</option><option value="male">{{ t('Male') }}</option><option value="female">{{ t('Female') }}</option><option value="other">{{ t('Other') }}</option></select>
          </label>
          <label class="field"><span>{{ t('Age') }}</span><input v-model="form.age" type="number" min="0" max="130" /></label>
          <label class="field"><span>{{ t('Guardian') }}</span><input v-model="form.guardianName" maxlength="120" /></label>
          <label class="field"><span>{{ t('Address') }}</span><input v-model="form.address" maxlength="300" /></label>
        </div>
        <label class="field"><span>{{ t('Allergies') }}</span><input v-model="form.allergies" maxlength="1000" /></label>
        <label class="field"><span>{{ t('Notes') }}</span><textarea v-model="form.notes" maxlength="2000" /></label>
        <div class="row">
          <button class="btn primary" type="submit">{{ t('Save') }}</button>
          <button class="btn" type="button" @click="editing = false; fillForm(patient)">{{ t('Cancel') }}</button>
        </div>
      </form>
      <div v-if="!editing" class="row" style="margin-top: 12px"><button class="btn sm" type="button" @click="editing = true">{{ t('Edit') }}</button></div>
    </section>

    <section v-if="can('owner', 'doctor')" class="card">
      <h2>{{ t('Visits') }}</h2>
      <div v-if="visits.length === 0" class="empty">—</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ t('Date') }}</th><th>{{ t('Doctor') }}</th><th>{{ t('Complaint') }}</th><th>{{ t('Diagnosis') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="visit in visits" :key="visit.id" class="clickable" @click="router.push(`/visits/${visit.id}`)">
              <td>{{ dateOnly(visit.visitedAt) }}</td>
              <td>{{ visit.doctorName }}</td>
              <td>{{ visit.complaint ?? '' }}</td>
              <td>{{ visit.diagnosis ?? '' }}</td>
              <td>
                <span v-if="visit.hasPrescription" class="pill ok">{{ t('Prescription') }}</span>
                <span v-if="visit.attachmentCount" class="pill info">📷 {{ visit.attachmentCount }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="can('owner', 'receptionist')" class="card">
      <h2>{{ t('Invoices') }}</h2>
      <div v-if="invoices.length === 0" class="empty">—</div>
      <div v-else class="table-wrap">
        <table class="table">
          <thead><tr><th>#</th><th>{{ t('Date') }}</th><th class="num">{{ t('Total') }}</th><th class="num">{{ t('Due') }}</th><th>{{ t('Status') }}</th></tr></thead>
          <tbody>
            <tr v-for="invoice in invoices" :key="invoice.id" class="clickable" @click="router.push(`/billing/${invoice.id}`)">
              <td>{{ invoice.invoiceNo }}</td>
              <td>{{ dateOnly(invoice.createdAt) }}</td>
              <td class="num">{{ money(invoice.total) }}</td>
              <td class="num">{{ money(invoice.due) }}</td>
              <td><StatusPill :status="invoice.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
  <div v-else class="empty">{{ t('Loading') }}…</div>
</template>
