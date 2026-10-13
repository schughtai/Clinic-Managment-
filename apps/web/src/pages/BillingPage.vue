<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import PatientPicker from '../components/PatientPicker.vue';
import StatusPill from '../components/StatusPill.vue';
import { dateOnly, money } from '../format';
import { t } from '../i18n';
import { notify, notifyError } from '../toast';
import type { Invoice, InvoiceDetail, PatientListItem } from '../types';

interface Line {
  description: string;
  quantity: number;
  unitPrice: number;
}

const route = useRoute();
const router = useRouter();
const filter = ref<'open' | 'all' | 'paid' | 'void'>('open');
const items = ref<Invoice[]>([]);
const total = ref(0);
const loading = ref(false);
const creating = ref(route.query.new === '1');
const patient = ref<PatientListItem | null>(null);
const lines = reactive<Line[]>([{ description: 'Consultation', quantity: 1, unitPrice: 0 }]);
const discountKind = ref<'none' | 'amount' | 'percent'>('none');
const discountValue = ref(0);
const busy = ref(false);

// The same rule as the server: percentages are rounded half up to whole rupees.
const subtotal = computed(() => lines.reduce((sum, line) => sum + Math.max(0, line.quantity) * Math.max(0, line.unitPrice), 0));
const discount = computed(() => {
  if (discountKind.value === 'amount') return Math.min(Math.max(0, discountValue.value), subtotal.value);
  if (discountKind.value === 'percent') return Math.floor((subtotal.value * Math.round(Math.min(100, Math.max(0, discountValue.value)) * 100) + 5000) / 10000);
  return 0;
});
const grand = computed(() => subtotal.value - discount.value);

async function load(): Promise<void> {
  loading.value = true;
  try {
    const status = filter.value === 'all' ? undefined : filter.value;
    const response = await api.get<{ items: Invoice[]; total: number }>('/invoices', { status, limit: 50 });
    items.value = response.items;
    total.value = response.total;
  } catch (error) {
    notifyError(error);
  } finally {
    loading.value = false;
  }
}

async function create(): Promise<void> {
  if (patient.value === null) {
    notifyError(new Error(t('Choose a patient')));
    return;
  }
  busy.value = true;
  try {
    const body: Record<string, unknown> = {
      patientId: patient.value.id,
      lines: lines.filter((line) => line.description.trim() !== '').map((line) => ({ description: line.description.trim(), quantity: line.quantity, unitPrice: line.unitPrice })),
    };
    if (discountKind.value !== 'none' && discountValue.value > 0) body.discount = { kind: discountKind.value, value: discountValue.value };
    const created = await api.post<InvoiceDetail>('/invoices', body);
    notify(`${t('Invoice number')} ${created.invoiceNo}`);
    await router.push(`/billing/${created.id}`);
  } catch (error) {
    notifyError(error);
  } finally {
    busy.value = false;
  }
}

watch(filter, () => void load());
onMounted(async () => {
  if (typeof route.query.patientId === 'string') {
    try {
      patient.value = await api.get<PatientListItem>(`/patients/${route.query.patientId}`);
    } catch (error) {
      notifyError(error);
    }
  }
  await load();
});
</script>

<template>
  <div class="page-head">
    <h1>{{ t('Billing') }}</h1>
    <button class="btn primary right" type="button" @click="creating = !creating">{{ t('New invoice') }}</button>
  </div>

  <form v-if="creating" class="card stack" @submit.prevent="create">
    <PatientPicker v-model="patient" />
    <div v-for="(line, index) in lines" :key="index" class="grid" style="align-items: end">
      <label class="field"><span>{{ t('Description') }}</span><input v-model="line.description" maxlength="200" required /></label>
      <label class="field"><span>{{ t('Quantity') }}</span><input v-model.number="line.quantity" type="number" min="1" inputmode="numeric" /></label>
      <label class="field"><span>{{ t('Price') }}</span><input v-model.number="line.unitPrice" type="number" min="0" inputmode="numeric" /></label>
      <button v-if="lines.length > 1" class="btn sm" type="button" @click="lines.splice(index, 1)">{{ t('Remove') }}</button>
    </div>
    <div class="row"><button class="btn sm" type="button" @click="lines.push({ description: '', quantity: 1, unitPrice: 0 })">+ {{ t('Add') }}</button></div>
    <div class="grid">
      <label class="field"><span>{{ t('Discount') }}</span>
        <select v-model="discountKind"><option value="none">—</option><option value="amount">Rs</option><option value="percent">%</option></select>
      </label>
      <label v-if="discountKind !== 'none'" class="field"><span>{{ t('Discount') }}</span><input v-model.number="discountValue" type="number" min="0" /></label>
    </div>
    <div class="row">
      <span>{{ t('Subtotal') }}: <strong>{{ money(subtotal) }}</strong></span>
      <span v-if="discount > 0">{{ t('Discount') }}: <strong>−{{ money(discount) }}</strong></span>
      <span>{{ t('Total') }}: <strong>{{ money(grand) }}</strong></span>
    </div>
    <div class="row">
      <button class="btn primary" type="submit" :disabled="busy">{{ t('Save') }}</button>
      <button class="btn" type="button" @click="creating = false">{{ t('Cancel') }}</button>
    </div>
  </form>

  <section class="card">
    <div class="tabs">
      <button type="button" :class="{ active: filter === 'open' }" @click="filter = 'open'">{{ t('Open') }}</button>
      <button type="button" :class="{ active: filter === 'all' }" @click="filter = 'all'">{{ t('All') }}</button>
      <button type="button" :class="{ active: filter === 'paid' }" @click="filter = 'paid'">{{ t('Paid') }}</button>
      <button type="button" :class="{ active: filter === 'void' }" @click="filter = 'void'">{{ t('Void') }}</button>
    </div>
    <div v-if="!loading && items.length === 0" class="empty">—</div>
    <div v-else class="table-wrap">
      <table class="table">
        <thead><tr><th>#</th><th>{{ t('Date') }}</th><th>{{ t('Patients') }}</th><th class="num">{{ t('Total') }}</th><th class="num">{{ t('Due') }}</th><th>{{ t('Status') }}</th></tr></thead>
        <tbody>
          <tr v-for="invoice in items" :key="invoice.id" class="clickable" @click="router.push(`/billing/${invoice.id}`)">
            <td>{{ invoice.invoiceNo }}</td>
            <td>{{ dateOnly(invoice.createdAt) }}</td>
            <td>{{ invoice.patientName }}</td>
            <td class="num">{{ money(invoice.total) }}</td>
            <td class="num">{{ money(invoice.due) }}</td>
            <td><StatusPill :status="invoice.status" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
