import { createApp } from 'vue';
import App from './App.vue';
import { setUnauthorizedHandler } from './api';
import { router } from './router';
import { session } from './session';
import './style.css';

// When the server ends the session, go back to the sign-in page and remember where the person was.
setUnauthorizedHandler(() => {
  session.profile = null;
  const current = router.currentRoute.value;
  if (current.name !== 'login') void router.push({ name: 'login', query: { next: current.fullPath } });
});

createApp(App).use(router).mount('#app');
