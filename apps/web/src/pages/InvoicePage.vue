<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { api } from '../api';
import StatusPill from '../components/StatusPill.vue';
import { dateTime, money } from '../format';
import { t } from '../i18n';
import { can } from '../session';
import { notify, notifyError } from '../toast';
import type { InvoiceDetail, Method } from '../types';

const route = useRoute();
const id = String(route.params.id);
const invoice = ref<InvoiceDetail | null>(null);
const amount = ref(0);
const method = ref<Method>('cash');
const reference = ref('');
const busy = ref(false);
const voidReason = ref('');
const showVoid = ref(false);

// One key per attempt. If the connection drops and the button is pressed again, the server records the payment once.
let attemptKey: string | null = null;

async function load(): Promise<void> {
  try {
    invoice.value = await api.get<InvoiceDetail>(`/invoices/${id}`);
    amount.value = invoice.value.due;
  } catch (error) {
    notifyError(error);
  }
}

async function pay(): Promise<void> {
  if (amount.value <= 0) return;
  busy.value = true;
  attemptKey ??= crypto.randomUUID();
  try {
    await api.post(`/invoices/${id}/payments`, { amount: amount.value, method: method.value, reference: reference.value.trim() === '' ? null : reference.value.trim() }, { 'Idempotency-Key': attemptKey });
    attemptKey = null;
    reference.value = '';
    notify(t('Payment recorded'));
    await load();
  } catch (error) {
    // Keep the key after a failure, so pressing the button again cannot create a second payment.
    notifyError(error);
  } finally {
    busy.value = false;
  }
}

async function voidInvoice(): Promise<void> {
  try {
    invoice.value = await api.post<InvoiceDetail>(`/invoices/${id}/void`, { reason: voidReason.value });
    showVoid.value = false;
    notify(t('Invoice cancelled'));
  } catch (error) {
    notifyError(error);
  }
}

async function remind(): Promise<void> {
  try {
    const message = await api.get<{ whatsappUrl: string }>(`/invoices/${id}/reminder`);
    window.open(message.whatsappUrl, '_blank', 'noopener');
  } catch (error) {
    notifyError(error);
  }
}

onMounted(load);
</script>

<template>
  <template v-if="invoice">
    <div class="page-head">
      <h1>{{ t('Invoice number') }} {{ invoice.invoiceNo }}</h1>
      <StatusPill :status="invoice.status" />
      <RouterLink :to="`/patients/${invoice.patientId}`">{{ invoice.patientName }}</RouterLink>
      <span class="muted small">{{ dateTime(invoice.createdAt) }}</span>
    </div>

    <section class="card">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ t('Description') }}</th><th class="num">{{ t('Quantity') }}</th><th class="num">{{ t('Price') }}</th><th class="num">{{ t('Amount') }}</th></tr></thead>
          <tbody>
            <tr v-for="(line, index) in invoice.items" :key="index"><td>{{ line.description }}</td><td class="num">{{ line.quantity }}</td><td class="num">{{ money(line.unitPrice) }}</td><td class="num">{{ money(line.amount) }}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="stack" style="margin-top: 12px; max-width: 320px; margin-inline-start: auto">
        <div class="row"><span>{{ t('Subtotal') }}</span><span class="right">{{ money(invoice.subtotal) }}</span></div>
        <div v-if="invoice.discount" class="row"><span>{{ t('Discount') }}</span><span class="right">−{{ money(invoice.discount) }}</span></div>
        <div class="row"><strong>{{ t('Total') }}</strong><strong class="right">{{ money(invoice.total) }}</strong></div>
        <div class="row"><span>{{ t('Paid') }}</span><span class="right">{{ money(invoice.paid) }}</span></div>
        <div class="row"><strong>{{ t('Due') }}</strong><strong class="right">{{ money(invoice.due) }}</strong></div>
      </div>
      <div v-if="invoice.status === 'void'" class="notice bad" style="margin-top: 12px">{{ invoice.voidReason }}</div>
    </section>

    <section v-if="invoice.payments.length" class="card">
      <h2>{{ t('Paid') }}</h2>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>{{ t('Date') }}</th><th>{{ t('Method') }}</th><th class="num">{{ t('Amount') }}</th></tr></thead>
          <tbody><tr v-for="payment in invoice.payments" :key="payment.id"><td>{{ dateTime(payment.receivedAt) }}</td><td>{{ t({ cash: 'Cash', bank: 'Bank', jazzcash: 'JazzCash', easypaisa: 'Easypaisa' }[payment.method]) }}</td><td class="num">{{ money(payment.amount) }}</td></tr></tbody>
        </table>
      </div>
    </section>

    <section v-if="invoice.due > 0 && invoice.status !== 'void'" class="card stack">
      <h2>{{ t('Record payment') }}</h2>
      <form class="grid" style="align-items: end" @submit.prevent="pay">
        <label class="field"><span>{{ t('Amount') }}</span><input v-model.number="amount" type="number" min="1" :max="invoice.due" inputmode="numeric" required /></label>
        <label class="field"><span>{{ t('Method') }}</span>
          <select v-model="method"><option value="cash">{{ t('Cash') }}</option><option value="bank">{{ t('Bank') }}</option><option value="jazzcash">{{ t('JazzCash') }}</option><option value="easypaisa">{{ t('Easypaisa') }}</option></select>
        </label>
        <label class="field"><span>{{ t('Reference') }}</span><input v-model="reference" maxlength="100" /></label>
        <button class="btn primary" type="submit" :disabled="busy">{{ t('Record payment') }}</button>
      </form>
      <div class="row">
        <button class="btn sm" type="button" @click="remind">{{ t('Send reminder') }}</button>
        <button v-if="can('owner') && invoice.paid === 0" class="btn sm danger" type="button" @click="showVoid = !showVoid">{{ t('Cancel invoice') }}</button>
      </div>
      <form v-if="showVoid" class="row" @submit.prevent="voidInvoice">
        <input v-model="voidReason" :placeholder="t('Reason')" minlength="3" maxlength="300" required style="max-width: 360px" />
        <button class="btn danger" type="submit">{{ t('Cancel invoice') }}</button>
      </form>
    </section>
  </template>
  <div v-else class="empty">{{ t('Loading') }}…</div>
</template>
