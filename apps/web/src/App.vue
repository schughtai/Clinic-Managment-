<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, RouterView, useRouter } from 'vue-router';
import { locale, setLocale, t } from './i18n';
import { can, session, signOut } from './session';
import { toasts } from './toast';

const router = useRouter();

const links = computed(() => [
  { to: '/', label: 'Dashboard', show: true },
  { to: '/patients', label: 'Patients', show: true },
  { to: '/appointments', label: 'Appointments', show: true },
  { to: '/billing', label: 'Billing', show: can('owner', 'receptionist') },
  { to: '/reminders', label: 'Reminders', show: can('owner', 'receptionist') },
  { to: '/reports', label: 'Reports', show: can('owner', 'receptionist') },
  { to: '/settings', label: 'Settings', show: true },
]);

async function leave(): Promise<void> {
  await signOut();
  await router.push({ name: 'login' });
}
</script>

<template>
  <header v-if="session.profile" class="shell-header no-print">
    <div class="shell-bar">
      <span class="brand">{{ session.profile.clinic.name }}</span>
      <nav class="nav" :aria-label="t('Dashboard')">
        <RouterLink v-for="link in links.filter((entry) => entry.show)" :key="link.to" :to="link.to">{{ t(link.label) }}</RouterLink>
      </nav>
      <span class="who">{{ session.profile.user.name }}</span>
      <button class="btn sm" type="button" :aria-label="t('Language')" @click="setLocale(locale === 'en' ? 'ur' : 'en')">
        {{ locale === 'en' ? 'اردو' : 'English' }}
      </button>
      <button class="btn sm" type="button" @click="leave">{{ t('Sign out') }}</button>
    </div>
  </header>
  <main><RouterView /></main>
  <div class="toasts no-print" role="status" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="{ error: toast.kind === 'error' }">{{ toast.text }}</div>
  </div>
</template>
