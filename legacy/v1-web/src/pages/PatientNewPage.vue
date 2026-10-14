<script setup lang="ts">
import { reactive, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { ApiError, api } from '../api';
import { phoneText } from '../format';
import { t } from '../i18n';
import { notify, notifyError } from '../toast';
import type { Patient, PatientListItem } from '../types';

const router = useRouter();
const form = reactive({ name: '', phone: '', gender: '', age: '', guardianName: '', address: '', allergies: '', notes: '' });
const busy = ref(false);
const duplicates = ref<PatientListItem[]>([]);

function payload(confirm: boolean): Record<string, unknown> {
  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  return {
    name: form.name.trim(),
    phone: text(form.phone),
    gender: form.gender === '' ? null : form.gender,
    age: form.age.trim() === '' ? null : Number(form.age),
    guardianName: text(form.guardianName),
    address: text(form.address),
    allergies: text(form.allergies),
    notes: text(form.notes),
    ...(confirm ? { confirmDuplicate: true } : {}),
  };
}

async function save(confirm = false): Promise<void> {
  busy.value = true;
  try {
    const created = await api.post<Patient>('/patients', payload(confirm));
    notify(t('Saved'));
    await router.push(`/patients/${created.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'possible_duplicate') {
      duplicates.value = (error.details as { candidates: PatientListItem[] }).candidates;
    } else {
      notifyError(error);
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="page-head"><h1>{{ t('New patient') }}</h1></div>
  <form class="card stack" @submit.prevent="save(false)">
    <div v-if="duplicates.length" class="notice warn" role="alert">
      <strong>{{ t('Possible duplicate') }}</strong>
      <div v-for="match in duplicates" :key="match.id">
        <RouterLink :to="`/patients/${match.id}`">#{{ match.patientNo }} {{ match.name }}</RouterLink> {{ phoneText(match.phone) }}
      </div>
      <button class="btn sm" type="button" :disabled="busy" @click="save(true)">{{ t('Create anyway') }}</button>
    </div>
    <div class="grid-2">
      <label class="field"><span>{{ t('Name') }}</span><input v-model="form.name" required maxlength="120" autofocus /></label>
      <label class="field"><span>{{ t('Phone') }}</span><input v-model="form.phone" type="tel" inputmode="tel" placeholder="0300 1234567" /></label>
      <label class="field"><span>{{ t('Gender') }}</span>
        <select v-model="form.gender"><option value="">—</option><option value="male">{{ t('Male') }}</option><option value="female">{{ t('Female') }}</option><option value="other">{{ t('Other') }}</option></select>
      </label>
      <label class="field"><span>{{ t('Age') }}</span><input v-model="form.age" type="number" min="0" max="130" inputmode="numeric" /></label>
      <label class="field"><span>{{ t('Guardian') }}</span><input v-model="form.guardianName" maxlength="120" /></label>
      <label class="field"><span>{{ t('Address') }}</span><input v-model="form.address" maxlength="300" /></label>
    </div>
    <label class="field"><span>{{ t('Allergies') }}</span><input v-model="form.allergies" maxlength="1000" /></label>
    <label class="field"><span>{{ t('Notes') }}</span><textarea v-model="form.notes" maxlength="2000" /></label>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="busy">{{ t('Save') }}</button>
      <RouterLink class="btn" to="/patients">{{ t('Cancel') }}</RouterLink>
    </div>
  </form>
</template>
