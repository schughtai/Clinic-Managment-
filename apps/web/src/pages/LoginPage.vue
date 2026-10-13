<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api';
import { locale, setLocale, t } from '../i18n';
import { signIn } from '../session';

const route = useRoute();
const router = useRouter();
const phone = ref('');
const password = ref('');
const busy = ref(false);
const problem = ref('');

async function submit(): Promise<void> {
  busy.value = true;
  problem.value = '';
  try {
    await signIn(phone.value, password.value);
    const next = typeof route.query.next === 'string' && route.query.next.startsWith('/') ? route.query.next : '/';
    await router.push(next);
  } catch (error) {
    problem.value = error instanceof ApiError ? t(error.message) : t('Something went wrong. Please try again.');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login card">
    <h1>{{ t('Sign in to your clinic') }}</h1>
    <form class="stack" @submit.prevent="submit">
      <label class="field">
        <span>{{ t('Phone number') }}</span>
        <input v-model="phone" type="tel" inputmode="tel" autocomplete="username" placeholder="0300 1234567" required />
      </label>
      <label class="field">
        <span>{{ t('Password') }}</span>
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <div v-if="problem" class="notice bad" role="alert">{{ problem }}</div>
      <button class="btn primary" type="submit" :disabled="busy">{{ t('Sign in') }}</button>
      <button class="btn sm" type="button" @click="setLocale(locale === 'en' ? 'ur' : 'en')">{{ locale === 'en' ? 'اردو' : 'English' }}</button>
    </form>
  </div>
</template>
