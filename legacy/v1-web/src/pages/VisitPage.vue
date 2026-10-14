<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ApiError, api } from '../api';
import DictationButton from '../components/DictationButton.vue';
import HandwritingInput from '../components/HandwritingInput.vue';
import { dateTime, phoneText } from '../format';
import { t } from '../i18n';
import { can, session } from '../session';
import { notify, notifyError } from '../toast';
import type { Attachment, Doctor, Patient, Prescription, PrescriptionItem, StructuredNote, Template, UploadResult, Visit, VisitDetail, Vitals } from '../types';

type NoteField = 'complaint' | 'history' | 'examination' | 'diagnosis' | 'plan';
const FIELDS: { key: NoteField; label: string }[] = [
  { key: 'complaint', label: 'Complaint' },
  { key: 'history', label: 'History' },
  { key: 'examination', label: 'Examination' },
  { key: 'diagnosis', label: 'Diagnosis' },
  { key: 'plan', label: 'Plan' },
];

const route = useRoute();
const router = useRouter();
const visitId = ref<string | null>(typeof route.params.id === 'string' ? route.params.id : null);
const patient = ref<Patient | null>(null);
const doctors = ref<Doctor[]>([]);
const visit = ref<Visit | null>(null);
const attachments = ref<Attachment[]>([]);
const uploadNotes = ref<Record<string, UploadResult['ai']>>({});
const busy = ref(false);

const note = reactive<Record<NoteField, string>>({ complaint: '', history: '', examination: '', diagnosis: '', plan: '' });
const vitals = reactive({ bloodPressure: '', pulse: '', temperatureC: '', oxygenSaturation: '', weightKg: '' });
const doctorId = ref(typeof route.query.doctorId === 'string' ? route.query.doctorId : '');
const speechLang = ref('en-US');
const used = reactive({ voice: false, handwriting: false, ai: false });

const aiReady = computed(() => session.profile?.clinic.aiEnabled === true && session.profile.clinic.aiAvailable);
const needsDoctor = computed(() => can('owner') && visitId.value === null);
const inputSource = computed<Visit['inputSource']>(() => {
  if (used.voice && used.handwriting) return 'mixed';
  if (used.voice) return 'voice';
  if (used.handwriting) return 'handwriting';
  return 'typed';
});

// Dictation and AI tidy-up
const dictated = ref('');
const tidyBusy = ref(false);

// Prescription
const items = ref<PrescriptionItem[]>([]);
const advice = ref('');
const followUpOn = ref('');
const templates = ref<Template[]>([]);
const templateName = ref('');
const prescriptionSaved = ref(false);

function blankItem(): PrescriptionItem {
  return { medicine: '', dose: null, frequency: null, duration: null, instructions: null };
}

function applyVisit(source: Visit): void {
  visit.value = source;
  for (const { key } of FIELDS) note[key] = source[key] ?? '';
  const v = source.vitals;
  vitals.bloodPressure = v.bloodPressure ?? '';
  vitals.pulse = v.pulse === undefined ? '' : String(v.pulse);
  vitals.temperatureC = v.temperatureC === undefined ? '' : String(v.temperatureC);
  vitals.oxygenSaturation = v.oxygenSaturation === undefined ? '' : String(v.oxygenSaturation);
  vitals.weightKg = v.weightKg === undefined ? '' : String(v.weightKg);
  doctorId.value = source.doctorId;
}

function vitalsPayload(): Vitals {
  const out: Vitals = {};
  if (vitals.bloodPressure.trim() !== '') out.bloodPressure = vitals.bloodPressure.trim();
  if (vitals.pulse.trim() !== '') out.pulse = Number(vitals.pulse);
  if (vitals.temperatureC.trim() !== '') out.temperatureC = Number(vitals.temperatureC);
  if (vitals.oxygenSaturation.trim() !== '') out.oxygenSaturation = Number(vitals.oxygenSaturation);
  if (vitals.weightKg.trim() !== '') out.weightKg = Number(vitals.weightKg);
  return out;
}

function notePayload(): Record<string, string | null> {
  return Object.fromEntries(FIELDS.map(({ key }) => [key, note[key].trim() === '' ? null : note[key].trim()]));
}

async function load(): Promise<void> {
  try {
    templates.value = await api.get<Template[]>('/prescription-templates');
    if (visitId.value !== null) {
      const detail = await api.get<VisitDetail>(`/visits/${visitId.value}`);
      applyVisit(detail.visit);
      attachments.value = detail.attachments;
      patient.value = await api.get<Patient>(`/patients/${detail.visit.patientId}`);
      try {
        const saved = await api.get<Prescription>(`/visits/${visitId.value}/prescription`);
        items.value = saved.items;
        advice.value = saved.advice ?? '';
        followUpOn.value = saved.followUpOn ?? '';
        prescriptionSaved.value = true;
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        items.value = [blankItem()];
      }
    } else {
      const patientId = typeof route.query.patientId === 'string' ? route.query.patientId : '';
      if (patientId === '') {
        await router.push('/patients');
        return;
      }
      patient.value = await api.get<Patient>(`/patients/${patientId}`);
      if (can('owner')) doctors.value = await api.get<Doctor[]>('/doctors');
      items.value = [blankItem()];
    }
  } catch (error) {
    notifyError(error);
  }
}

async function saveVisit(): Promise<void> {
  busy.value = true;
  try {
    if (visitId.value === null) {
      const body: Record<string, unknown> = {
        patientId: patient.value?.id,
        ...notePayload(),
        vitals: vitalsPayload(),
        inputSource: inputSource.value,
        aiAssisted: used.ai,
      };
      if (typeof route.query.appointmentId === 'string') body.appointmentId = route.query.appointmentId;
      if (can('owner')) body.doctorId = doctorId.value;
      const created = await api.post<VisitDetail>('/visits', body);
      visitId.value = created.visit.id;
      applyVisit(created.visit);
      notify(t('Saved'));
      await router.replace(`/visits/${created.visit.id}`);
    } else {
      const updated = await api.patch<VisitDetail>(`/visits/${visitId.value}`, {
        ...notePayload(),
        vitals: vitalsPayload(),
        inputSource: visit.value?.inputSource === 'typed' ? inputSource.value : (visit.value?.inputSource ?? inputSource.value),
        aiAssisted: used.ai || visit.value?.aiAssisted === true,
      });
      applyVisit(updated.visit);
      notify(t('Saved'));
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'visit_exists') {
      notifyError(new ApiError(409, error.code, 'A visit was already recorded for this appointment. Open it from the patient history.'));
    } else {
      notifyError(error);
    }
  } finally {
    busy.value = false;
  }
}

function addDictation(field: NoteField, text: string): void {
  note[field] = note[field].trim() === '' ? text : `${note[field].trim()} ${text}`;
  used.voice = true;
}

async function tidy(): Promise<void> {
  if (dictated.value.trim() === '') return;
  tidyBusy.value = true;
  try {
    const result = await api.post<StructuredNote>('/visits/ai/structure', { text: dictated.value });
    for (const { key } of FIELDS) {
      if (result[key].trim() !== '') note[key] = note[key].trim() === '' ? result[key] : `${note[key].trim()}\n${result[key]}`;
    }
    used.ai = true;
    notify(t('Check the fields below before saving.'));
  } catch (error) {
    notifyError(error);
  } finally {
    tidyBusy.value = false;
  }
}

function onUploaded(result: UploadResult): void {
  attachments.value = [...attachments.value, result.attachment];
  uploadNotes.value = { ...uploadNotes.value, [result.attachment.id]: result.ai };
  used.handwriting = true;
  if (result.ai.status === 'transcribed') used.ai = true;
}

async function retry(attachment: Attachment): Promise<void> {
  try {
    const result = await api.post<UploadResult>(`/visits/${visitId.value}/attachments/${attachment.id}/transcribe`);
    attachments.value = attachments.value.map((entry) => (entry.id === attachment.id ? result.attachment : entry));
    uploadNotes.value = { ...uploadNotes.value, [attachment.id]: result.ai };
    if (result.ai.status === 'transcribed') used.ai = true;
  } catch (error) {
    notifyError(error);
  }
}

async function saveTranscription(attachment: Attachment): Promise<void> {
  try {
    const updated = await api.patch<Attachment>(`/visits/${visitId.value}/attachments/${attachment.id}`, { transcription: attachment.transcription ?? '' });
    attachments.value = attachments.value.map((entry) => (entry.id === attachment.id ? updated : entry));
    notify(t('Saved'));
  } catch (error) {
    notifyError(error);
  }
}

function moveToField(attachment: Attachment, field: NoteField): void {
  const text = (attachment.transcription ?? '').trim();
  if (text === '') return;
  note[field] = note[field].trim() === '' ? text : `${note[field].trim()}\n${text}`;
  notify(t('Added. Save the visit to keep it.'));
}

function applyTemplate(id: string): void {
  const chosen = templates.value.find((entry) => entry.id === id);
  if (chosen === undefined) return;
  items.value = chosen.items.map((item) => ({ ...item }));
  if (chosen.advice !== null) advice.value = chosen.advice;
}

function cleanItems(): PrescriptionItem[] {
  const text = (value: string | null): string | null => (value === null || value.trim() === '' ? null : value.trim());
  return items.value
    .filter((item) => item.medicine.trim() !== '')
    .map((item) => ({ medicine: item.medicine.trim(), dose: text(item.dose), frequency: text(item.frequency), duration: text(item.duration), instructions: text(item.instructions) }));
}

async function savePrescription(): Promise<void> {
  try {
    await api.put(`/visits/${visitId.value}/prescription`, { items: cleanItems(), advice: advice.value.trim() === '' ? null : advice.value.trim(), followUpOn: followUpOn.value === '' ? null : followUpOn.value });
    prescriptionSaved.value = true;
    notify(t('Prescription saved'));
  } catch (error) {
    notifyError(error);
  }
}

async function saveTemplate(): Promise<void> {
  if (templateName.value.trim() === '') return;
  try {
    const created = await api.post<Template>('/prescription-templates', { name: templateName.value.trim(), items: cleanItems(), advice: advice.value.trim() === '' ? null : advice.value.trim() });
    templates.value = [...templates.value, created].sort((a, b) => a.name.localeCompare(b.name));
    templateName.value = '';
    notify(t('Template saved'));
  } catch (error) {
    notifyError(error);
  }
}

async function whatsapp(): Promise<void> {
  try {
    const message = await api.get<{ whatsappUrl: string }>(`/visits/${visitId.value}/prescription/whatsapp`);
    window.open(message.whatsappUrl, '_blank', 'noopener');
  } catch (error) {
    notifyError(error);
  }
}

onMounted(load);
</script>

<template>
  <div v-if="patient" class="page-head">
    <h1>{{ visitId ? t('Visits') : t('New visit') }}</h1>
    <RouterLink :to="`/patients/${patient.id}`">#{{ patient.patientNo }} · {{ patient.name }}</RouterLink>
    <span class="muted">{{ phoneText(patient.phone) }}</span>
    <span v-if="visit" class="muted small">{{ dateTime(visit.visitedAt) }} · {{ visit.doctorName }}</span>
  </div>
  <div v-if="patient?.allergies" class="notice warn" style="margin-bottom: 12px">⚠ {{ t('Allergies') }}: {{ patient.allergies }}</div>

  <template v-if="patient">
    <section class="card stack">
      <div class="row">
        <label v-if="needsDoctor" class="field" style="min-width: 220px"><span>{{ t('Doctor') }}</span>
          <select v-model="doctorId" required><option value="" disabled>—</option><option v-for="doctor in doctors" :key="doctor.id" :value="doctor.id">{{ doctor.name }}</option></select>
        </label>
        <label class="field" style="min-width: 220px"><span>{{ t('Speaking language') }}</span>
          <select v-model="speechLang"><option value="en-US">English</option><option value="ur-PK">اردو (Urdu)</option></select>
        </label>
      </div>

      <div v-if="aiReady" class="stack">
        <label class="field"><span>{{ t('Dictate the whole note, then tidy it into the fields') }}</span>
          <textarea v-model="dictated" :placeholder="t('Speak or paste the note here')" />
        </label>
        <div class="row">
          <DictationButton :lang="speechLang" @text="(text) => { dictated = dictated.trim() === '' ? text : `${dictated.trim()} ${text}`; used.voice = true; }" />
          <button class="btn sm primary" type="button" :disabled="tidyBusy || dictated.trim() === ''" @click="tidy">✨ {{ t('Tidy into fields') }}</button>
        </div>
        <div class="notice small">{{ t('AI suggestions are never saved on their own. Check every field before saving.') }}</div>
      </div>

      <div v-for="field in FIELDS" :key="field.key" class="field">
        <div class="row">
          <span style="font-weight: 600; font-size: 0.875rem">{{ t(field.label) }}</span>
          <DictationButton :lang="speechLang" @text="(text) => addDictation(field.key, text)" />
        </div>
        <textarea v-model="note[field.key]" :aria-label="t(field.label)" maxlength="20000" />
      </div>

      <h3>{{ t('Vitals') }}</h3>
      <div class="grid">
        <label class="field"><span>{{ t('Blood pressure') }}</span><input v-model="vitals.bloodPressure" placeholder="120/80" inputmode="numeric" /></label>
        <label class="field"><span>{{ t('Pulse') }}</span><input v-model="vitals.pulse" type="number" inputmode="numeric" /></label>
        <label class="field"><span>{{ t('Temperature (°C)') }}</span><input v-model="vitals.temperatureC" type="number" step="0.1" inputmode="decimal" /></label>
        <label class="field"><span>{{ t('Oxygen (%)') }}</span><input v-model="vitals.oxygenSaturation" type="number" inputmode="numeric" /></label>
        <label class="field"><span>{{ t('Weight (kg)') }}</span><input v-model="vitals.weightKg" type="number" step="0.1" inputmode="decimal" /></label>
      </div>
      <div class="row"><button class="btn primary" type="button" :disabled="busy || (needsDoctor && doctorId === '')" @click="saveVisit">{{ t('Save visit') }}</button></div>
    </section>

    <section v-if="visitId" class="card stack">
      <h2>{{ t('Handwritten note') }}</h2>
      <div v-if="!aiReady" class="notice small">{{ t('Photos are saved with the visit. The owner can turn on AI reading in Settings.') }}</div>
      <HandwritingInput :visit-id="visitId" @uploaded="onUploaded" />
      <div v-for="attachment in attachments" :key="attachment.id" class="card" style="margin: 0">
        <div class="grid-2">
          <a :href="`/api/visits/${visitId}/attachments/${attachment.id}/image`" target="_blank" rel="noopener">
            <img :src="`/api/visits/${visitId}/attachments/${attachment.id}/image`" :alt="t('Handwritten note')" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--line)" loading="lazy" />
          </a>
          <div class="stack">
            <div v-if="uploadNotes[attachment.id]?.status === 'failed' || uploadNotes[attachment.id]?.status === 'skipped'" class="notice warn">{{ (uploadNotes[attachment.id] as { message: string }).message }}</div>
            <div v-if="attachment.aiTranscribed" class="pill info">✨ {{ t('Read by AI. Check it.') }}</div>
            <textarea v-model="attachment.transcription" :placeholder="t('Type what the note says, or read it with AI')" :aria-label="t('Handwritten note')" />
            <div class="row">
              <button class="btn sm" type="button" @click="saveTranscription(attachment)">{{ t('Save text') }}</button>
              <button v-if="aiReady" class="btn sm" type="button" @click="retry(attachment)">{{ t('Read again with AI') }}</button>
            </div>
            <div class="row">
              <span class="muted small">{{ t('Add to') }}:</span>
              <button v-for="field in FIELDS" :key="field.key" class="btn sm" type="button" @click="moveToField(attachment, field.key)">{{ t(field.label) }}</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="visitId" class="card stack">
      <h2>{{ t('Prescription') }}</h2>
      <label v-if="templates.length" class="field" style="max-width: 320px"><span>{{ t('Template') }}</span>
        <select @change="applyTemplate(($event.target as HTMLSelectElement).value); ($event.target as HTMLSelectElement).value = ''"><option value="">—</option><option v-for="template in templates" :key="template.id" :value="template.id">{{ template.name }}</option></select>
      </label>
      <div v-for="(item, index) in items" :key="index" class="grid" style="align-items: end">
        <label class="field"><span>{{ t('Medicine') }}</span><input v-model="item.medicine" maxlength="120" /></label>
        <label class="field"><span>{{ t('Dose') }}</span><input :value="item.dose ?? ''" maxlength="60" @input="item.dose = ($event.target as HTMLInputElement).value" /></label>
        <label class="field"><span>{{ t('Frequency') }}</span><input :value="item.frequency ?? ''" maxlength="60" @input="item.frequency = ($event.target as HTMLInputElement).value" /></label>
        <label class="field"><span>{{ t('Duration') }}</span><input :value="item.duration ?? ''" maxlength="60" @input="item.duration = ($event.target as HTMLInputElement).value" /></label>
        <label class="field"><span>{{ t('Instructions') }}</span><input :value="item.instructions ?? ''" maxlength="200" @input="item.instructions = ($event.target as HTMLInputElement).value" /></label>
        <button class="btn sm" type="button" @click="items.splice(index, 1)">{{ t('Remove') }}</button>
      </div>
      <div class="row"><button class="btn sm" type="button" @click="items.push(blankItem())">+ {{ t('Add medicine') }}</button></div>
      <label class="field"><span>{{ t('Advice') }}</span><textarea v-model="advice" maxlength="5000" /></label>
      <label class="field" style="max-width: 220px"><span>{{ t('Follow-up date') }}</span><input v-model="followUpOn" type="date" /></label>
      <div class="row">
        <button class="btn primary" type="button" @click="savePrescription">{{ t('Save prescription') }}</button>
        <a v-if="prescriptionSaved" class="btn" :href="`/print/prescription/${visitId}`" target="_blank" rel="noopener">{{ t('Print') }}</a>
        <button v-if="prescriptionSaved" class="btn" type="button" @click="whatsapp">{{ t('Send on WhatsApp') }}</button>
      </div>
      <div class="row">
        <input v-model="templateName" :placeholder="t('Template name')" style="max-width: 260px" maxlength="80" />
        <button class="btn sm" type="button" :disabled="templateName.trim() === ''" @click="saveTemplate">{{ t('Save as template') }}</button>
      </div>
    </section>
  </template>
  <div v-else class="empty">{{ t('Loading') }}…</div>
</template>
