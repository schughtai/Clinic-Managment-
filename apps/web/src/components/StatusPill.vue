<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';

const props = defineProps<{ status: string }>();

const LABELS: Record<string, string> = {
  booked: 'Booked',
  arrived: 'Arrived',
  in_consult: 'In consultation',
  done: 'Done',
  cancelled: 'Cancelled',
  no_show: 'No show',
  unpaid: 'Unpaid',
  partial: 'Partial',
  paid: 'Paid',
  void: 'Void',
};

const kind = computed(() => {
  switch (props.status) {
    case 'done':
    case 'paid':
      return 'ok';
    case 'arrived':
    case 'partial':
      return 'warn';
    case 'cancelled':
    case 'no_show':
    case 'void':
    case 'unpaid':
      return 'bad';
    default:
      return 'info';
  }
});
</script>

<template>
  <span class="pill" :class="kind">{{ t(LABELS[status] ?? status) }}</span>
</template>
