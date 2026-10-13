<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { api } from '../api';
import { phoneText, timeOnly, todayLocal } from '../format';
import { t } from '../i18n';
import { notifyError } from '../toast';
import type { ReminderEntry } from '../types';

const date = ref(todayLocal(1));
const entries = ref<ReminderEntry[]>([]);
const loading = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  try {
    entries.value = await api.get<ReminderEntry[]>('/reminders', { date: date.value });
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

async function markSent(entry: ReminderEntry): Promise<void> {
  try {
    const updated = await api.post<ReminderEntry>(`/reminders/${entry.appointmentId}/mark-sent`);
    entries.value = entries.value.map((current) => (current.appointmentId === entry.appointmentId ? updated : current));
  } catch (error) {
    notifyError(error);
  }
}

/** Opens WhatsApp with the message ready. A person still presses send, then marks it as sent here. */
function open(entry: ReminderEntry): void {
  if (entry.whatsappUrl !== null) window.open(entry.whatsappUrl, '_blank', 'noopener');
}

watch(date, () => void load());
onMounted(load);
</script>

<template>
  <div class="page-head">
    <h1>{{ t('Reminders') }}</h1>
    <input v-model="date" type="date" style="width: auto" :aria-label="t('Date')" />
  </div>
  <section class="card">
    <div v-if="!loading && entries.length === 0" class="empty">{{ t('No reminders for this day.') }}</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>{{ t('Time') }}</th><th>{{ t('Patients') }}</th><th>{{ t('Doctor') }}</th><th></th></tr></thead>
        <tbody>
          <tr v-for="entry in entries" :key="entry.appointmentId">
            <td>{{ timeOnly(entry.startsAt) }}</td>
            <td>{{ entry.patientName }}<div class="muted small">{{ phoneText(entry.phone) || t('No phone number') }}</div></td>
            <td>{{ entry.doctorName }}</td>
            <td class="row">
              <span v-if="entry.sent" class="pill ok">{{ t('Sent') }}</span>
              <template v-else-if="entry.phone !== null">
                <button class="btn sm primary" type="button" @click="open(entry)">{{ t('Open WhatsApp') }}</button>
                <button class="btn sm" type="button" @click="markSent(entry)">{{ t('Mark as sent') }}</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
