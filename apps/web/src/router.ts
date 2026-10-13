import { createRouter, createWebHistory } from 'vue-router';
import { loadProfile, session } from './session';
import type { Role } from './types';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    roles?: Role[];
  }
}

const FRONT_DESK: Role[] = ['owner', 'receptionist'];
const CLINICAL: Role[] = ['owner', 'doctor'];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
    { path: '/', name: 'dashboard', component: () => import('./pages/DashboardPage.vue') },
    { path: '/patients', name: 'patients', component: () => import('./pages/PatientsPage.vue') },
    { path: '/patients/new', name: 'patient-new', component: () => import('./pages/PatientNewPage.vue') },
    { path: '/patients/:id', name: 'patient', component: () => import('./pages/PatientPage.vue') },
    { path: '/visits/new', name: 'visit-new', component: () => import('./pages/VisitPage.vue'), meta: { roles: CLINICAL } },
    { path: '/visits/:id', name: 'visit', component: () => import('./pages/VisitPage.vue'), meta: { roles: CLINICAL } },
    { path: '/appointments', name: 'appointments', component: () => import('./pages/AppointmentsPage.vue') },
    { path: '/billing', name: 'billing', component: () => import('./pages/BillingPage.vue'), meta: { roles: FRONT_DESK } },
    { path: '/billing/:id', name: 'invoice', component: () => import('./pages/InvoicePage.vue'), meta: { roles: FRONT_DESK } },
    { path: '/reports', name: 'reports', component: () => import('./pages/ReportsPage.vue'), meta: { roles: FRONT_DESK } },
    { path: '/reminders', name: 'reminders', component: () => import('./pages/RemindersPage.vue'), meta: { roles: FRONT_DESK } },
    { path: '/settings', name: 'settings', component: () => import('./pages/SettingsPage.vue') },
    { path: '/print/prescription/:visitId', name: 'print-prescription', component: () => import('./pages/PrintPrescriptionPage.vue') },
    { path: '/:rest(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!session.loaded) await loadProfile();
  if (to.meta.public === true) {
    return session.profile !== null && to.name === 'login' ? { name: 'dashboard' } : true;
  }
  if (session.profile === null) return { name: 'login', query: { next: to.fullPath } };
  const allowed = to.meta.roles;
  if (allowed !== undefined && !allowed.includes(session.profile.user.role)) return { name: 'dashboard' };
  return true;
});
