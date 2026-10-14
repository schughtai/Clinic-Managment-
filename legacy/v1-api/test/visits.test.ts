import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  type AiProvider,
  AiError,
  type HandwritingResult,
  type ImageMime,
  type StructuredNote,
} from '../src/modules/ai/ai.types';
import { type SignedInClinic, type TestApp, addStaff, signUpClinic, startTestApp } from './support/app';

/** A stand-in for the AI service. It records what it was asked and answers as told. */
class FakeAi implements AiProvider {
  available = true;
  handwritingCalls: { size: number; mime: ImageMime }[] = [];
  structureCalls: string[] = [];
  handwritingFailure: AiError | undefined;
  handwriting: HandwritingResult = { text: 'Fever 3 days. Tab Panadol 500mg TDS', uncertainWords: ['Panadol'], language: 'english' };
  structured: StructuredNote = { complaint: 'Fever', history: '3 days', examination: '', diagnosis: '', plan: 'Rest' };

  transcribeHandwriting(image: { data: Buffer; mime: ImageMime }): Promise<HandwritingResult> {
    this.handwritingCalls.push({ size: image.data.length, mime: image.mime });
    return this.handwritingFailure === undefined ? Promise.resolve(this.handwriting) : Promise.reject(this.handwritingFailure);
  }

  structureNote(text: string): Promise<StructuredNote> {
    this.structureCalls.push(text);
    return Promise.resolve(this.structured);
  }
}

const fakeAi = new FakeAi();
let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp({}, { aiProvider: fakeAi });
});

afterAll(async () => {
  await testApp.close();
});

interface VisitDetail {
  visit: { id: string; doctorName: string; complaint: string | null; diagnosis: string | null; vitals: Record<string, unknown>; inputSource: string; aiAssisted: boolean };
  attachments: { id: string; transcription: string | null; aiTranscribed: boolean }[];
}
interface UploadBody {
  attachment: { id: string; transcription: string | null; aiTranscribed: boolean };
  ai: { status: string; code?: string; uncertainWords?: string[] };
}
interface ErrorBody {
  error: { code: string };
}

interface Team {
  owner: SignedInClinic;
  doctor: SignedInClinic & { userId: string };
  otherDoctor: SignedInClinic & { userId: string };
  reception: SignedInClinic & { userId: string };
  patientId: string;
  doctorId: string;
}

async function team(): Promise<Team> {
  const owner = await signUpClinic(testApp);
  const doctor = await addStaff(testApp, owner, 'doctor', 'Dr First');
  const otherDoctor = await addStaff(testApp, owner, 'doctor', 'Dr Second');
  const reception = await addStaff(testApp, owner, 'receptionist');
  const patient = await owner.agent.post('/api/patients').send({ name: 'Visit Patient', phone: '03001234500' });
  const doctors = (await owner.agent.get('/api/doctors')).body as { id: string; name: string }[];
  const doctorId = doctors.find((entry) => entry.name === 'Dr First')?.id ?? '';
  return { owner, doctor, otherDoctor, reception, patientId: (patient.body as { id: string }).id, doctorId };
}

async function newVisit(who: SignedInClinic, patientId: string, extra: Record<string, unknown> = {}): Promise<VisitDetail> {
  const response = await who.agent.post('/api/visits').send({ patientId, complaint: 'Fever', ...extra });
  if (response.status !== 201) throw new Error(`Could not create visit: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body as VisitDetail;
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2_000, 7)]);

function upload(who: SignedInClinic, visitId: string, data: Buffer = JPEG, filename = 'note.jpg') {
  return who.agent.post(`/api/visits/${visitId}/handwriting`).attach('image', data, { filename, contentType: 'image/jpeg' });
}

function resetFake(): void {
  fakeAi.available = true;
  fakeAi.handwritingCalls = [];
  fakeAi.structureCalls = [];
  fakeAi.handwritingFailure = undefined;
}

describe('recording a visit', () => {
  it('lets a doctor record a visit for themselves with vitals', async () => {
    const { doctor, patientId } = await team();
    const detail = await newVisit(doctor, patientId, {
      history: '3 days',
      diagnosis: 'Viral fever',
      vitals: { bloodPressure: '120/80', pulse: 88, temperatureC: 38.4, weightKg: 70.5 },
    });
    expect(detail.visit).toMatchObject({
      doctorName: 'Dr First',
      diagnosis: 'Viral fever',
      inputSource: 'typed',
      aiAssisted: false,
      vitals: { bloodPressure: '120/80', pulse: 88, temperatureC: 38.4, weightKg: 70.5 },
    });
  });

  it('makes an owner say which doctor saw the patient', async () => {
    const { owner, patientId, doctorId } = await team();
    const missing = await owner.agent.post('/api/visits').send({ patientId, complaint: 'x' });
    expect(missing.status).toBe(400);
    expect((missing.body as ErrorBody).error.code).toBe('doctor_required');
    expect((await owner.agent.post('/api/visits').send({ patientId, doctorId, complaint: 'x' })).status).toBe(201);
  });

  it('stops a doctor from recording a visit as another doctor', async () => {
    const { doctor, patientId } = await team();
    const other = (await doctor.agent.get('/api/doctors')).body as { id: string; name: string }[];
    const second = other.find((entry) => entry.name === 'Dr Second')?.id ?? '';
    expect((await doctor.agent.post('/api/visits').send({ patientId, doctorId: second })).status).toBe(403);
  });

  it('keeps the reception desk out of clinical notes entirely', async () => {
    const { reception, doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    expect((await reception.agent.post('/api/visits').send({ patientId, doctorId: patientId })).status).toBe(403);
    expect((await reception.agent.get(`/api/visits/${visit.visit.id}`)).status).toBe(403);
    expect((await reception.agent.get(`/api/patients/${patientId}/visits`)).status).toBe(403);
    expect((await reception.agent.patch(`/api/visits/${visit.visit.id}`).send({ diagnosis: 'x' })).status).toBe(403);
  });

  it('rejects impossible measurements, unknown fields and oversized notes', async () => {
    const { doctor, patientId } = await team();
    const bad: Record<string, unknown>[] = [
      { vitals: { bloodPressure: '120-80' } },
      { vitals: { pulse: 500 } },
      { vitals: { temperatureC: 12 } },
      { vitals: { oxygenSaturation: 101 } },
      { vitals: { heartbeat: 70 } },
      { clinicId: '00000000-0000-4000-8000-000000000000' },
      { complaint: 'x'.repeat(20_001) },
      { inputSource: 'telepathy' },
    ];
    for (const body of bad) {
      const response = await doctor.agent.post('/api/visits').send({ patientId, ...body });
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });

  it('links a visit to its appointment only when patient and doctor match, and only once', async () => {
    const { owner, doctor, patientId, doctorId } = await team();
    const walkin = (await owner.agent.post('/api/appointments/walkin').send({ patientId, doctorId })).body as { id: string };
    const stranger = (await owner.agent.post('/api/patients').send({ name: 'Someone Else' })).body as { id: string };

    const mismatch = await doctor.agent.post('/api/visits').send({ patientId: stranger.id, appointmentId: walkin.id });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as ErrorBody).error.code).toBe('appointment_mismatch');

    expect((await doctor.agent.post('/api/visits').send({ patientId, appointmentId: walkin.id })).status).toBe(201);
    const again = await doctor.agent.post('/api/visits').send({ patientId, appointmentId: walkin.id });
    expect(again.status).toBe(409);
    expect((again.body as ErrorBody).error.code).toBe('visit_exists');
  });
});

describe('the patient timeline', () => {
  it('lists visits newest first with a short summary and page totals', async () => {
    const { doctor, patientId } = await team();
    await newVisit(doctor, patientId, { complaint: 'First visit', diagnosis: 'A' });
    await newVisit(doctor, patientId, { complaint: 'Second visit', diagnosis: 'B' });
    const long = await newVisit(doctor, patientId, { complaint: 'x'.repeat(500) });
    await doctor.agent.put(`/api/visits/${long.visit.id}/prescription`).send({ items: [{ medicine: 'Tab A' }] });

    const response = await doctor.agent.get(`/api/patients/${patientId}/visits`).query({ limit: 2 });
    const body = response.body as { items: { complaint: string; hasPrescription: boolean }[]; total: number };
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.items[0]?.complaint.length).toBe(200);
    expect(body.items[0]?.hasPrescription).toBe(true);
    expect(body.items[1]?.complaint).toBe('Second visit');
  });

  it('returns 404 for an unknown patient', async () => {
    const { doctor } = await team();
    expect((await doctor.agent.get('/api/patients/00000000-0000-4000-8000-000000000000/visits')).status).toBe(404);
  });
});

describe('changing a visit', () => {
  it('lets the doctor who saw the patient and the owner edit, but not another doctor', async () => {
    const { owner, doctor, otherDoctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId, { vitals: { pulse: 70 } });
    const url = `/api/visits/${visit.visit.id}`;

    expect((await otherDoctor.agent.patch(url).send({ diagnosis: 'Hijack' })).status).toBe(403);
    const own = await doctor.agent.patch(url).send({ diagnosis: 'Flu', vitals: { pulse: 80 } });
    expect(own.status).toBe(200);
    expect((own.body as VisitDetail).visit).toMatchObject({ diagnosis: 'Flu', vitals: { pulse: 80 } });
    const byOwner = await owner.agent.patch(url).send({ plan: 'Rest' });
    expect(byOwner.status).toBe(200);
    expect((await otherDoctor.agent.get(url)).status).toBe(200);
  });

  it('records every opening and change in the audit trail', async () => {
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    await doctor.agent.get(`/api/visits/${visit.visit.id}`);
    await doctor.agent.patch(`/api/visits/${visit.visit.id}`).send({ diagnosis: 'Secret diagnosis text' });

    const admin = new Client({ connectionString: inject('adminUrl') });
    await admin.connect();
    try {
      const rows = await admin.query<{ action: string; meta: Record<string, unknown> }>(
        "select action, meta from audit_log where entity_id = $1 and action like 'visit.%' order by id",
        [visit.visit.id],
      );
      expect(rows.rows.map((row) => row.action)).toEqual(['visit.created', 'visit.viewed', 'visit.updated']);
      expect(JSON.stringify(rows.rows)).not.toContain('Secret diagnosis text');
    } finally {
      await admin.end();
    }
  });
});

describe('prescriptions', () => {
  it('saves, replaces and reads a prescription', async () => {
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const url = `/api/visits/${visit.visit.id}/prescription`;
    const saved = await doctor.agent.put(url).send({
      items: [{ medicine: 'Tab Paracetamol 500mg', dose: '1 tablet', frequency: 'Three times a day', duration: '3 days' }],
      advice: 'Plenty of fluids',
      followUpOn: '2030-05-01',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      items: [{ medicine: 'Tab Paracetamol 500mg', dose: '1 tablet', instructions: null }],
      advice: 'Plenty of fluids',
      followUpOn: '2030-05-01',
    });

    await doctor.agent.put(url).send({ items: [{ medicine: 'Syrup X' }] });
    const read = (await doctor.agent.get(url)).body as { items: { medicine: string }[]; advice: string | null };
    expect(read.items.map((item) => item.medicine)).toEqual(['Syrup X']);
    expect(read.advice).toBeNull();
  });

  it('rejects empty, oversized and malformed prescriptions', async () => {
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const url = `/api/visits/${visit.visit.id}/prescription`;
    const many = Array.from({ length: 31 }, (_, index) => ({ medicine: `Drug ${index}` }));
    for (const body of [{ items: [] }, { items: [{ medicine: ' ' }] }, { items: many }, { items: [{ medicine: 'A', price: 5 }] }, { items: [{ medicine: 'A' }], followUpOn: 'soon' }]) {
      expect((await doctor.agent.put(url).send(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await doctor.agent.get(url)).status).toBe(404);
  });

  it('is written by the treating doctor or the owner only', async () => {
    const { owner, doctor, otherDoctor, reception, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const url = `/api/visits/${visit.visit.id}/prescription`;
    const body = { items: [{ medicine: 'Tab A' }] };
    expect((await otherDoctor.agent.put(url).send(body)).status).toBe(403);
    expect((await reception.agent.put(url).send(body)).status).toBe(403);
    expect((await owner.agent.put(url).send(body)).status).toBe(200);
  });

  it('prints with the clinic header, and hides the diagnosis from the reception desk', async () => {
    const { owner, doctor, reception, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ name: 'Print Clinic', city: 'Lahore' });
    const visit = await newVisit(doctor, patientId, { diagnosis: 'Viral fever' });
    await doctor.agent.put(`/api/visits/${visit.visit.id}/prescription`).send({ items: [{ medicine: 'Tab A', dose: '1' }], advice: 'Rest' });
    const url = `/api/visits/${visit.visit.id}/prescription/print`;

    const asDoctor = (await doctor.agent.get(url)).body as Record<string, unknown>;
    expect(asDoctor).toMatchObject({
      clinic: { name: 'Print Clinic', city: 'Lahore' },
      patient: { name: 'Visit Patient', patientNo: 1 },
      doctor: { name: 'Dr First' },
      diagnosis: 'Viral fever',
      advice: 'Rest',
    });
    const asReception = (await reception.agent.get(url)).body as Record<string, unknown>;
    expect(asReception.diagnosis).toBeNull();
    expect((asReception.items as unknown[]).length).toBe(1);
  });

  it('keeps reusable templates per clinic', async () => {
    const { owner, doctor, reception } = await team();
    const created = await doctor.agent.post('/api/prescription-templates').send({ name: 'Fever adult', items: [{ medicine: 'Tab Paracetamol', frequency: 'TDS' }], advice: 'Fluids' });
    expect(created.status).toBe(201);
    const duplicate = await doctor.agent.post('/api/prescription-templates').send({ name: 'Fever adult', items: [{ medicine: 'X' }] });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as ErrorBody).error.code).toBe('name_in_use');
    expect(((await owner.agent.get('/api/prescription-templates')).body as { name: string }[]).map((entry) => entry.name)).toEqual(['Fever adult']);
    expect((await reception.agent.get('/api/prescription-templates')).status).toBe(403);

    const other = await signUpClinic(testApp, 'Elsewhere');
    expect(((await other.agent.get('/api/prescription-templates')).body as unknown[]).length).toBe(0);
    const id = (created.body as { id: string }).id;
    expect((await other.agent.delete(`/api/prescription-templates/${id}`)).status).toBe(404);
    expect((await doctor.agent.delete(`/api/prescription-templates/${id}`)).status).toBe(204);
  });
});

describe('handwritten notes', () => {
  it('saves the photo and says AI is off until the clinic turns it on', async () => {
    resetFake();
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const response = await upload(doctor, visit.visit.id);
    expect(response.status).toBe(201);
    const body = response.body as UploadBody;
    expect(body.ai).toMatchObject({ status: 'skipped', code: 'ai_not_enabled' });
    expect(body.attachment.transcription).toBeNull();
    expect(fakeAi.handwritingCalls).toHaveLength(0);
  });

  it('transcribes with AI for a clinic that switched it on, and leaves the visit text for the doctor to accept', async () => {
    resetFake();
    const { owner, doctor, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const visit = await newVisit(doctor, patientId);

    const response = await upload(doctor, visit.visit.id);
    expect(response.status).toBe(201);
    const body = response.body as UploadBody;
    expect(body.ai).toMatchObject({ status: 'transcribed', uncertainWords: ['Panadol'] });
    expect(body.attachment).toMatchObject({ transcription: 'Fever 3 days. Tab Panadol 500mg TDS', aiTranscribed: true });
    expect(fakeAi.handwritingCalls).toEqual([{ size: JPEG.length, mime: 'image/jpeg' }]);

    const detail = (await doctor.agent.get(`/api/visits/${visit.visit.id}`)).body as VisitDetail;
    // The transcription waits for the doctor to review it. The visit fields stay exactly as the doctor wrote them.
    expect(detail.visit.complaint).toBe('Fever');
    expect(detail.visit.diagnosis).toBeNull();
    expect(detail.attachments).toHaveLength(1);
  });

  it('keeps the photo when the AI service is down, and reads it again later', async () => {
    resetFake();
    const { owner, doctor, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const visit = await newVisit(doctor, patientId);

    fakeAi.handwritingFailure = new AiError('unavailable', 'down');
    const failed = await upload(doctor, visit.visit.id);
    expect(failed.status).toBe(201);
    expect((failed.body as UploadBody).ai).toMatchObject({ status: 'failed', code: 'ai_unavailable' });
    const attachmentId = (failed.body as UploadBody).attachment.id;

    fakeAi.handwritingFailure = undefined;
    const retry = await doctor.agent.post(`/api/visits/${visit.visit.id}/attachments/${attachmentId}/transcribe`);
    expect(retry.status).toBe(201);
    expect((retry.body as UploadBody).ai.status).toBe('transcribed');
    expect((retry.body as UploadBody).attachment.transcription).toContain('Fever 3 days');
  });

  it('reports a declined image without losing it', async () => {
    resetFake();
    const { owner, doctor, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const visit = await newVisit(doctor, patientId);
    fakeAi.handwritingFailure = new AiError('declined', 'no');
    const response = await upload(doctor, visit.visit.id);
    expect((response.body as UploadBody).ai).toMatchObject({ status: 'failed', code: 'ai_declined' });
  });

  it('explains when the server has no AI key at all', async () => {
    resetFake();
    fakeAi.available = false;
    const { owner, doctor, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const visit = await newVisit(doctor, patientId);
    const response = await upload(doctor, visit.visit.id);
    expect((response.body as UploadBody).ai).toMatchObject({ status: 'skipped', code: 'ai_not_configured' });
    resetFake();
  });

  it('lets the doctor correct the transcription, and keeps the note that AI helped', async () => {
    resetFake();
    const { owner, doctor, patientId } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const visit = await newVisit(doctor, patientId);
    const uploaded = (await upload(doctor, visit.visit.id)).body as UploadBody;

    const edited = await doctor.agent
      .patch(`/api/visits/${visit.visit.id}/attachments/${uploaded.attachment.id}`)
      .send({ transcription: 'Fever 3 days. Tab Panadol 500mg BD' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ transcription: 'Fever 3 days. Tab Panadol 500mg BD', aiTranscribed: true });
  });

  it('refuses files that are not images, empty uploads and missing files', async () => {
    resetFake();
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const pdf = await upload(doctor, visit.visit.id, Buffer.from('%PDF-1.7 not a picture'), 'note.jpg');
    expect(pdf.status).toBe(400);
    expect((pdf.body as ErrorBody).error.code).toBe('unsupported_image');
    const script = await upload(doctor, visit.visit.id, Buffer.from('<script>alert(1)</script>'), 'x.jpg');
    expect(script.status).toBe(400);
    const none = await doctor.agent.post(`/api/visits/${visit.visit.id}/handwriting`);
    expect(none.status).toBe(400);
    expect((none.body as ErrorBody).error.code).toBe('image_required');
    expect(fakeAi.handwritingCalls).toHaveLength(0);
  });

  it('refuses photos over the size limit', async () => {
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5_000_100, 1)]);
    const response = await upload(doctor, visit.visit.id, big);
    expect(response.status).toBe(413);
    expect((response.body as ErrorBody).error.code).toBe('payload_too_large');
  });

  it('allows at most ten photos for one visit', async () => {
    resetFake();
    const { doctor, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    for (let index = 0; index < 10; index += 1) {
      expect((await upload(doctor, visit.visit.id)).status).toBe(201);
    }
    const eleventh = await upload(doctor, visit.visit.id);
    expect(eleventh.status).toBe(400);
    expect((eleventh.body as ErrorBody).error.code).toBe('too_many_attachments');
  });

  it('stores files in a folder per clinic and serves them back safely', async () => {
    resetFake();
    const { doctor, reception, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    const uploaded = (await upload(doctor, visit.visit.id)).body as UploadBody;

    const folders = readdirSync(testApp.config.uploadDir);
    expect(folders.length).toBeGreaterThan(0);
    expect(existsSync(path.join(testApp.config.uploadDir, folders[0] ?? ''))).toBe(true);

    const url = `/api/visits/${visit.visit.id}/attachments/${uploaded.attachment.id}/image`;
    const image = await doctor.agent.get(url).buffer(true).parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.headers['cache-control']).toBe('private, no-store');
    expect((image.body as Buffer).equals(JPEG)).toBe(true);
    expect((await reception.agent.get(url)).status).toBe(403);
    expect((await testApp.anonymous().get(url)).status).toBe(401);
  });

  it('allows only the treating doctor or the owner to add photos', async () => {
    resetFake();
    const { owner, doctor, otherDoctor, reception, patientId } = await team();
    const visit = await newVisit(doctor, patientId);
    expect((await upload(otherDoctor, visit.visit.id)).status).toBe(403);
    expect((await upload(reception, visit.visit.id)).status).toBe(403);
    expect((await upload(owner, visit.visit.id)).status).toBe(201);
  });
});

describe('dictation clean-up', () => {
  it('suggests how to split a note, without saving anything or logging its text', async () => {
    resetFake();
    const { owner, doctor } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    const response = await doctor.agent.post('/api/visits/ai/structure').send({ text: 'fever three days, give rest and fluids' });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(fakeAi.structured);
    expect(fakeAi.structureCalls).toEqual(['fever three days, give rest and fluids']);

    const admin = new Client({ connectionString: inject('adminUrl') });
    await admin.connect();
    try {
      const rows = await admin.query<{ meta: Record<string, unknown> }>("select meta from audit_log where action = 'ai.note_structured'");
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(JSON.stringify(rows.rows)).not.toContain('fever three days');
      expect(rows.rows[0]?.meta).toMatchObject({ ok: true, characters: 'fever three days, give rest and fluids'.length });
    } finally {
      await admin.end();
    }
  });

  it('is refused while the clinic has AI switched off, and for empty text', async () => {
    resetFake();
    const { owner, doctor } = await team();
    const off = await doctor.agent.post('/api/visits/ai/structure').send({ text: 'something' });
    expect(off.status).toBe(409);
    expect((off.body as ErrorBody).error.code).toBe('ai_not_enabled');
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    expect((await doctor.agent.post('/api/visits/ai/structure').send({ text: '   ' })).status).toBe(400);
    expect((await doctor.agent.post('/api/visits/ai/structure').send({ text: 'x', extra: 1 })).status).toBe(400);
  });

  it('is not available to the reception desk', async () => {
    const { owner, reception } = await team();
    await owner.agent.patch('/api/clinic').send({ aiEnabled: true });
    expect((await reception.agent.post('/api/visits/ai/structure').send({ text: 'x' })).status).toBe(403);
  });
});

describe('clinical privacy between clinics', () => {
  it('never exposes visits, photos or prescriptions to another clinic', async () => {
    resetFake();
    const mine = await team();
    const visit = await newVisit(mine.doctor, mine.patientId);
    const uploaded = (await upload(mine.doctor, visit.visit.id)).body as UploadBody;
    await mine.doctor.agent.put(`/api/visits/${visit.visit.id}/prescription`).send({ items: [{ medicine: 'Tab A' }] });

    const stranger = await team();
    const base = `/api/visits/${visit.visit.id}`;
    expect((await stranger.owner.agent.get(base)).status).toBe(404);
    expect((await stranger.doctor.agent.get(base)).status).toBe(404);
    expect((await stranger.owner.agent.patch(base).send({ diagnosis: 'x' })).status).toBe(404);
    expect((await stranger.owner.agent.get(`${base}/prescription`)).status).toBe(404);
    expect((await stranger.owner.agent.get(`${base}/prescription/print`)).status).toBe(404);
    expect((await stranger.owner.agent.get(`${base}/attachments/${uploaded.attachment.id}/image`)).status).toBe(404);
    expect((await upload(stranger.owner, visit.visit.id)).status).toBe(404);
    expect((await stranger.doctor.agent.get(`/api/patients/${mine.patientId}/visits`)).status).toBe(404);
    expect((await stranger.doctor.agent.post('/api/visits').send({ patientId: mine.patientId })).status).toBe(404);
  });
});
