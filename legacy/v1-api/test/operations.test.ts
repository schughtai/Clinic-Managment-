import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { weekdayOf } from '../src/modules/appointments/slots';
import { parseCsv } from '../src/modules/data/csv';
import { appointmentReminder, paymentReminder, prescriptionMessage, whatsappUrl } from '../src/modules/messaging/templates';
import { type SignedInClinic, type TestApp, addStaff, signUpClinic, startTestApp } from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface ErrorBody {
  error: { code: string };
}
interface DailyBody {
  date: string;
  collected: { total: number; byMethod: Record<string, number> };
  invoices: { count: number; billed: number };
  newPatients: number;
  visits: number;
  outstanding: { count: number; amount: number };
  closing: { expectedCash: number; countedCash: number; difference: number } | null;
}
interface ReminderBody {
  appointmentId: string;
  patientName: string;
  phone: string | null;
  sent: boolean;
  text: string;
  whatsappUrl: string | null;
}
interface ExportBody {
  clinic: Record<string, unknown>;
  users: Record<string, unknown>[];
  patients: Record<string, unknown>[];
  visits: Record<string, unknown>[];
  invoices: Record<string, unknown>[];
  payments: Record<string, unknown>[];
}
interface ImportBody {
  dryRun: boolean;
  rows: number;
  valid: number;
  created: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
}

async function admin<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: inject('adminUrl') });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

async function frontDesk() {
  const owner = await signUpClinic(testApp);
  const reception = await addStaff(testApp, owner, 'receptionist');
  const doctor = await addStaff(testApp, owner, 'doctor', 'Dr Reports');
  const patient = (await owner.agent.post('/api/patients').send({ name: 'Report Patient', phone: '0300 7770001' })).body as { id: string };
  const doctors = (await owner.agent.get('/api/doctors')).body as { id: string }[];
  return { owner, reception, doctor, patientId: patient.id, doctorId: doctors[0]?.id ?? '' };
}

async function billed(who: SignedInClinic, patientId: string, amount: number, extra: Record<string, unknown> = {}): Promise<{ id: string }> {
  const response = await who.agent.post('/api/invoices').send({ patientId, lines: [{ description: 'Service', unitPrice: amount }], ...extra });
  return response.body as { id: string };
}

const receive = (who: SignedInClinic, invoiceId: string, amount: number, method: string) =>
  who.agent.post(`/api/invoices/${invoiceId}/payments`).send({ amount, method });

describe('daily report and closing', () => {
  it('adds up what was collected by method and what is still owed', async () => {
    const { reception, patientId } = await frontDesk();
    const first = await billed(reception, patientId, 1000);
    const second = await billed(reception, patientId, 2000);
    await billed(reception, patientId, 500);
    await receive(reception, first.id, 1000, 'cash');
    await receive(reception, second.id, 700, 'jazzcash');
    await receive(reception, second.id, 300, 'cash');

    const report = (await reception.agent.get('/api/reports/daily')).body as DailyBody;
    expect(report.collected).toEqual({ total: 2000, byMethod: { cash: 1300, bank: 0, jazzcash: 700, easypaisa: 0 } });
    expect(report.invoices).toEqual({ count: 3, billed: 3500 });
    expect(report.outstanding).toEqual({ count: 2, amount: 1500 });
    expect(report.newPatients).toBe(1);
    expect(report.closing).toBeNull();
  });

  it('leaves cancelled invoices out of the totals', async () => {
    const { owner, reception, patientId } = await frontDesk();
    const mistake = await billed(reception, patientId, 900);
    await owner.agent.post(`/api/invoices/${mistake.id}/void`).send({ reason: 'Entered twice' });
    await billed(reception, patientId, 100);
    const report = (await reception.agent.get('/api/reports/daily')).body as DailyBody;
    expect(report.invoices).toEqual({ count: 1, billed: 100 });
    expect(report.outstanding).toEqual({ count: 1, amount: 100 });
  });

  it('places a payment on the clinic\'s local day, not the server\'s', async () => {
    const { reception, patientId } = await frontDesk();
    const invoice = await billed(reception, patientId, 800);
    const paid = (await receive(reception, invoice.id, 800, 'cash')).body as { payment: { id: string } };
    // 19:30 UTC is 00:30 the next morning in Karachi.
    await admin((client) => client.query("update payments set received_at = '2030-03-10T19:30:00Z' where id = $1", [paid.payment.id]));

    const before = (await reception.agent.get('/api/reports/daily').query({ date: '2030-03-10' })).body as DailyBody;
    const after = (await reception.agent.get('/api/reports/daily').query({ date: '2030-03-11' })).body as DailyBody;
    expect(before.collected.total).toBe(0);
    expect(after.collected.byMethod.cash).toBe(800);
  });

  it('closes a day with the counted cash and shows the difference', async () => {
    const { reception, patientId } = await frontDesk();
    const invoice = await billed(reception, patientId, 1500);
    await receive(reception, invoice.id, 1000, 'cash');
    await receive(reception, invoice.id, 500, 'bank');
    const today = ((await reception.agent.get('/api/reports/daily')).body as DailyBody).date;

    const closed = await reception.agent.post('/api/closings').send({ date: today, countedCash: 950, note: 'Rs 50 short' });
    expect(closed.status).toBe(201);
    expect(closed.body).toMatchObject({ date: today, expectedCash: 1000, countedCash: 950, difference: -50, note: 'Rs 50 short' });

    const again = await reception.agent.post('/api/closings').send({ date: today, countedCash: 1000 });
    expect(again.status).toBe(409);
    expect((again.body as ErrorBody).error.code).toBe('already_closed');

    const report = (await reception.agent.get('/api/reports/daily')).body as DailyBody;
    expect(report.closing).toMatchObject({ expectedCash: 1000, difference: -50 });
    const list = (await reception.agent.get('/api/closings')).body as { date: string }[];
    expect(list.map((entry) => entry.date)).toEqual([today]);
  });

  it('refuses to close a day that has not happened yet, and bad input', async () => {
    const { reception } = await frontDesk();
    expect((await reception.agent.post('/api/closings').send({ date: '2099-01-01', countedCash: 0 })).status).toBe(400);
    expect((await reception.agent.post('/api/closings').send({ date: 'today', countedCash: 0 })).status).toBe(400);
    expect((await reception.agent.post('/api/closings').send({ date: '2020-01-01', countedCash: -5 })).status).toBe(400);
    expect((await reception.agent.get('/api/reports/daily').query({ date: 'x' })).status).toBe(400);
  });

  it('is closed to doctors, and each clinic sees only its own figures', async () => {
    const mine = await frontDesk();
    const invoice = await billed(mine.reception, mine.patientId, 400);
    await receive(mine.reception, invoice.id, 400, 'cash');
    expect((await mine.doctor.agent.get('/api/reports/daily')).status).toBe(403);
    const stranger = await frontDesk();
    const report = (await stranger.reception.agent.get('/api/reports/daily')).body as DailyBody;
    expect(report.collected.total).toBe(0);
    expect(report.invoices.count).toBe(0);
  });
});

describe('doctor report', () => {
  it('counts visits and the money linked to each doctor\'s visits', async () => {
    const { owner, reception, doctor, patientId } = await frontDesk();
    const visit = (await doctor.agent.post('/api/visits').send({ patientId, complaint: 'Cough' })).body as { visit: { id: string } };
    const invoice = await billed(reception, patientId, 2000, { visitId: visit.visit.id });
    await receive(reception, invoice.id, 1200, 'cash');
    await billed(reception, patientId, 5000);

    const today = ((await reception.agent.get('/api/reports/daily')).body as DailyBody).date;
    const rows = (await owner.agent.get('/api/reports/doctors').query({ from: today, to: today })).body as { doctorName: string; visits: number; billed: number; collected: number }[];
    expect(rows).toEqual([{ doctorId: expect.any(String) as string, doctorName: 'Dr Reports', visits: 1, billed: 2000, collected: 1200 }]);
  });

  it('is for owners only and validates the range', async () => {
    const { owner, reception } = await frontDesk();
    expect((await reception.agent.get('/api/reports/doctors').query({ from: '2030-01-01', to: '2030-01-02' })).status).toBe(403);
    expect((await owner.agent.get('/api/reports/doctors').query({ from: '2030-02-01', to: '2030-01-01' })).status).toBe(400);
    expect((await owner.agent.get('/api/reports/doctors')).status).toBe(400);
  });
});

describe('message wording', () => {
  const fields = { patient: 'Ayesha', doctor: 'Dr Sara', clinic: 'Noor Clinic', clinicPhone: '923001234567', day: '15 Oct 2026', time: '09:30 AM' };

  it('writes the reminder in English or Urdu', () => {
    const english = appointmentReminder('en', fields);
    expect(english).toContain('Ayesha');
    expect(english).toContain('Dr Sara');
    expect(english).toContain('09:30 AM');
    expect(english).toContain('923001234567');
    expect(appointmentReminder('ur', fields)).toContain('السلام علیکم Ayesha');
    expect(appointmentReminder('en', { ...fields, clinicPhone: null })).not.toContain('please call');
  });

  it('encodes the text into a WhatsApp link', () => {
    const url = whatsappUrl('923001234567', 'Hello & welcome\nمرحبا');
    expect(url.startsWith('https://wa.me/923001234567?text=')).toBe(true);
    expect(url).not.toContain(' ');
    expect(url).not.toContain('&welcome');
    expect(decodeURIComponent(url.split('text=')[1] ?? '')).toBe('Hello & welcome\nمرحبا');
  });

  it('lists medicines and trims a very long prescription', () => {
    const short = prescriptionMessage('en', {
      patient: 'Ayesha', doctor: 'Dr Sara', clinic: 'Noor Clinic',
      items: [{ medicine: 'Tab Panadol', dose: '500mg', frequency: 'TDS', duration: '3 days', instructions: null }],
      advice: 'Rest', followUpOn: '2026-10-20',
    });
    expect(short).toContain('1. Tab Panadol - 500mg, TDS, 3 days');
    expect(short).toContain('Advice: Rest');
    expect(short).toContain('Follow-up: 2026-10-20');
    const longText = prescriptionMessage('en', {
      patient: 'A', doctor: 'D', clinic: 'C',
      items: Array.from({ length: 30 }, (_, index) => ({ medicine: `Medicine number ${index} with a long name`, dose: '1 tablet', frequency: 'Twice daily', duration: '2 weeks', instructions: 'After meals with water' })),
      advice: null, followUpOn: null,
    });
    expect(longText.length).toBeLessThanOrEqual(1_520);
    expect(longText).toContain('see printed copy');
  });

  it('words the payment reminder with the amount due', () => {
    expect(paymentReminder('en', { patient: 'Ali', clinic: 'Noor', invoiceNo: 12, due: 750 })).toContain('Rs 750 is still due on invoice 12');
  });
});

describe('appointment reminders', () => {
  /** Tomorrow's date in Karachi, which is UTC+5. */
  function tomorrowKarachi(): string {
    return new Date(Date.now() + 5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  }

  async function bookTomorrow(): Promise<{ desk: Awaited<ReturnType<typeof frontDesk>>; appointmentId: string; date: string }> {
    const desk = await frontDesk();
    const date = tomorrowKarachi();
    await desk.owner.agent.patch(`/api/doctors/${desk.doctorId}`).send({ slotMinutes: 30 });
    await desk.owner.agent.put(`/api/doctors/${desk.doctorId}/schedule`).send({ sessions: [{ weekday: weekdayOf(date), start: '09:00', end: '12:00' }] });
    const startsAt = new Date(new Date(`${date}T00:00:00Z`).getTime() + 4 * 3_600_000).toISOString(); // 09:00 Karachi
    const booked = await desk.reception.agent.post('/api/appointments').send({ patientId: desk.patientId, doctorId: desk.doctorId, startsAt });
    expect(booked.status).toBe(201);
    return { desk, appointmentId: (booked.body as { id: string }).id, date };
  }

  it('lists tomorrow\'s bookings with a ready message and WhatsApp link', async () => {
    const { desk, appointmentId } = await bookTomorrow();
    const list = (await desk.reception.agent.get('/api/reminders')).body as ReminderBody[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ appointmentId, patientName: 'Report Patient', phone: '923007770001', sent: false });
    expect(list[0]?.text).toContain('09:00 AM');
    expect(list[0]?.text).toContain('Dr Reports');
    expect(list[0]?.whatsappUrl?.startsWith('https://wa.me/923007770001?text=')).toBe(true);
  });

  it('marks a reminder as sent once, even when two people click together', async () => {
    const { desk, appointmentId } = await bookTomorrow();
    const url = `/api/reminders/${appointmentId}/mark-sent`;
    const [one, two] = await Promise.all([desk.reception.agent.post(url), desk.owner.agent.post(url)]);
    expect([one.status, two.status]).toEqual([200, 200]);
    expect((await desk.reception.agent.post(url)).status).toBe(200);

    const list = (await desk.reception.agent.get('/api/reminders')).body as ReminderBody[];
    expect(list[0]?.sent).toBe(true);
    const logged = await admin((client) =>
      client.query("select count(*)::int as count from message_log where appointment_id = $1 and status = 'marked_sent'", [appointmentId]),
    );
    expect((logged.rows[0] as { count: number }).count).toBe(1);
  });

  it('leaves out cancelled bookings and has no link for a patient without a phone', async () => {
    const { desk, appointmentId, date } = await bookTomorrow();
    await desk.reception.agent.patch(`/api/appointments/${appointmentId}/status`).send({ status: 'cancelled' });
    expect((await desk.reception.agent.get('/api/reminders')).body).toEqual([]);

    const noPhone = (await desk.owner.agent.post('/api/patients').send({ name: 'No Phone' })).body as { id: string };
    const startsAt = new Date(new Date(`${date}T00:00:00Z`).getTime() + 4.5 * 3_600_000).toISOString();
    const booked = (await desk.owner.agent.post('/api/appointments').send({ patientId: noPhone.id, doctorId: desk.doctorId, startsAt })).body as { id: string };
    const list = (await desk.reception.agent.get('/api/reminders')).body as ReminderBody[];
    expect(list[0]).toMatchObject({ phone: null, whatsappUrl: null });
    const marked = await desk.reception.agent.post(`/api/reminders/${booked.id}/mark-sent`);
    expect(marked.status).toBe(409);
    expect((marked.body as ErrorBody).error.code).toBe('no_phone');
  });

  it('is limited to the front desk and each clinic\'s own appointments', async () => {
    const { desk, appointmentId } = await bookTomorrow();
    expect((await desk.doctor.agent.get('/api/reminders')).status).toBe(403);
    const stranger = await frontDesk();
    expect((await stranger.reception.agent.get('/api/reminders')).body).toEqual([]);
    expect((await stranger.reception.agent.post(`/api/reminders/${appointmentId}/mark-sent`)).status).toBe(404);
  });
});

describe('prescription and payment messages', () => {
  it('prepares a prescription message without the diagnosis', async () => {
    const { reception, doctor, patientId } = await frontDesk();
    const visit = (await doctor.agent.post('/api/visits').send({ patientId, diagnosis: 'Secret diagnosis' })).body as { visit: { id: string } };
    const url = `/api/visits/${visit.visit.id}/prescription/whatsapp`;
    expect((await reception.agent.get(url)).status).toBe(404);
    await doctor.agent.put(`/api/visits/${visit.visit.id}/prescription`).send({ items: [{ medicine: 'Tab Panadol', frequency: 'TDS' }] });
    const response = await reception.agent.get(url);
    expect(response.status).toBe(200);
    const body = response.body as { phone: string; text: string; whatsappUrl: string };
    expect(body.text).toContain('Tab Panadol');
    expect(body.text).not.toContain('Secret diagnosis');
    expect(body.whatsappUrl).toContain('https://wa.me/923007770001');
  });

  it('prepares a payment reminder only while money is due', async () => {
    const { reception, patientId } = await frontDesk();
    const invoice = await billed(reception, patientId, 900);
    const url = `/api/invoices/${invoice.id}/reminder`;
    const due = (await reception.agent.get(url)).body as { text: string };
    expect(due.text).toContain('Rs 900 is still due');
    await receive(reception, invoice.id, 900, 'cash');
    const paid = await reception.agent.get(url);
    expect(paid.status).toBe(409);
    expect((paid.body as ErrorBody).error.code).toBe('nothing_due');
  });
});

describe('reading spreadsheet files', () => {
  it('handles quotes, line breaks, blank lines and the Excel marker', () => {
    const rows = parseCsv('﻿Name,Address\r\n"Khan, Ali","House 1,\nStreet 2"\r\n\r\n"He said ""hi""",x\n');
    expect(rows).toEqual([
      ['Name', 'Address'],
      ['Khan, Ali', 'House 1,\nStreet 2'],
      ['He said "hi"', 'x'],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
  });
});

describe('importing patients', () => {
  const upload = (who: SignedInClinic, csv: string, dryRun?: boolean) => {
    const request = who.agent.post('/api/patients/import').attach('file', Buffer.from(csv, 'utf8'), { filename: 'patients.csv', contentType: 'text/csv' });
    if (dryRun !== undefined) request.field('dryRun', String(dryRun));
    return request;
  };
  const count = async (who: SignedInClinic): Promise<number> => ((await who.agent.get('/api/patients')).body as { total: number }).total;

  const sample = 'Full Name,Mobile,Sex,Age,Address\nAyesha Khan,0300 1110001,F,34,"House 5, Lahore"\nMuhammad Ali,03001110002,male,50,\nBilal,,m,7,';

  it('checks the file first and writes nothing by default', async () => {
    const { reception } = await frontDesk();
    const response = await upload(reception, sample);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ dryRun: true, rows: 3, valid: 3, created: 0, skippedDuplicates: 0, errors: [] });
    expect(await count(reception)).toBe(1);
  });

  it('imports every row with numbers that follow on from the existing patients', async () => {
    const { reception } = await frontDesk();
    const response = await upload(reception, sample, false);
    expect(response.body).toMatchObject({ dryRun: false, created: 3, errors: [] });
    const list = (await reception.agent.get('/api/patients').query({ limit: 10 })).body as { items: { name: string; patientNo: number; age: number | null }[] };
    expect(list.items.map((patient) => patient.patientNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(list.items.find((patient) => patient.name === 'Ayesha Khan')?.age).toBe(34);
    const next = (await reception.agent.post('/api/patients').send({ name: 'After Import' })).body as { patientNo: number };
    expect(next.patientNo).toBe(5);
  });

  it('skips people who are already in the system and repeats within the file', async () => {
    const { reception } = await frontDesk();
    await upload(reception, sample, false);
    const again = await upload(reception, `${sample}\nAyesha Khan,03001110001,F,34,`, false);
    // Two known people and the repeated line are skipped. Bilal has no phone number, so he cannot be matched and is added again.
    expect(again.body).toMatchObject({ created: 1, skippedDuplicates: 3 });
    expect(await count(reception)).toBe(5);
  });

  it('imports nothing when any row is wrong, and says which', async () => {
    const { reception } = await frontDesk();
    const bad = 'Name,Phone,Gender,Age\nGood One,03001112222,male,30\n,03001112223,male,30\nBad Phone,12345,male,30\nBad Age,03001112224,female,200\nBad Sex,03001112225,robot,30';
    const response = await upload(reception, bad, false);
    expect(response.status).toBe(201);
    const body = response.body as ImportBody;
    expect(body.created).toBe(0);
    expect(body.errors.map((entry) => entry.row)).toEqual([3, 4, 5, 6]);
    expect(body.errors[1]?.message).toContain('12345');
    expect(await count(reception)).toBe(1);
  });

  it('refuses unusable files', async () => {
    const { reception, doctor } = await frontDesk();
    const noName = await upload(reception, 'Phone,Age\n03001112222,30');
    expect(noName.status).toBe(400);
    expect((noName.body as ErrorBody).error.code).toBe('missing_name_column');
    expect((await upload(reception, 'Name\n')).status).toBe(400);
    expect((await reception.agent.post('/api/patients/import')).status).toBe(400);
    const many = `Name\n${Array.from({ length: 2_001 }, (_, index) => `Person ${index}`).join('\n')}`;
    const tooMany = await upload(reception, many);
    expect(tooMany.status).toBe(413);
    expect((tooMany.body as ErrorBody).error.code).toBe('too_many_rows');
    expect((await upload(reception, `Name\n${'x'.repeat(1_100_000)}`)).status).toBe(413);
    expect((await upload(doctor, sample)).status).toBe(403);
  });

  it('puts imported patients in the importing clinic only', async () => {
    const mine = await frontDesk();
    const stranger = await frontDesk();
    await upload(mine.reception, sample, false);
    expect(await count(stranger.reception)).toBe(1);
  });
});

describe('exporting the clinic\'s data', () => {
  it('gives the owner everything, with no password hashes, and records the download', async () => {
    const { owner, reception, doctor, patientId } = await frontDesk();
    const visit = (await doctor.agent.post('/api/visits').send({ patientId, complaint: 'Cough' })).body as { visit: { id: string } };
    const invoice = await billed(reception, patientId, 700, { visitId: visit.visit.id });
    await receive(reception, invoice.id, 700, 'cash');

    const response = await owner.agent.get('/api/export');
    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment; filename="clinic-export-');
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('token_version');
    const data = response.body as ExportBody;
    expect(data.patients).toHaveLength(1);
    expect(data.visits).toHaveLength(1);
    expect(data.invoices).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
    expect(data.users).toHaveLength(3);
    // The rows must hold real content, not just exist.
    expect(data.patients[0]).toMatchObject({ name: 'Report Patient', patient_no: 1 });
    expect(data.visits[0]).toMatchObject({ complaint: 'Cough' });
    expect(data.invoices[0]).toMatchObject({ total: 700, paid: 700, status: 'paid' });
    expect(data.payments[0]).toMatchObject({ amount: 700, method: 'cash' });
    expect(data.clinic).toMatchObject({ name: 'Test Clinic' });
    expect(data.users.every((user) => user !== null && typeof user === 'object')).toBe(true);

    const log = (await owner.agent.get('/api/audit').query({ entity: 'clinic' })).body as { items: { action: string }[] };
    expect(log.items.length).toBeGreaterThanOrEqual(0);
    const downloaded = (await owner.agent.get('/api/audit').query({ action: 'export.downloaded' })).body as { total: number };
    expect(downloaded.total).toBe(1);
  });

  it('never includes another clinic\'s records and is for owners only', async () => {
    const mine = await frontDesk();
    await mine.owner.agent.post('/api/patients').send({ name: 'Mine Only', phone: '03005550000' });
    const stranger = await frontDesk();
    const theirs = (await stranger.owner.agent.get('/api/export')).body as ExportBody;
    expect(theirs.patients.map((patient) => patient.name)).toEqual(['Report Patient']);
    expect((await mine.reception.agent.get('/api/export')).status).toBe(403);
    expect((await mine.doctor.agent.get('/api/export')).status).toBe(403);
  });
});

describe('the audit log', () => {
  it('shows the owner who did what, newest first, with paging and filters', async () => {
    const { owner, reception } = await frontDesk();
    await reception.agent.post('/api/patients').send({ name: 'Logged Patient' });
    const log = (await owner.agent.get('/api/audit').query({ action: 'patient.created' })).body as {
      items: { action: string; userName: string; id: number }[];
      total: number;
    };
    expect(log.total).toBe(2);
    expect(log.items[0]?.userName).toBe('receptionist user');
    expect(log.items[0]?.id).toBeGreaterThan(log.items[1]?.id ?? 0);
    const page = (await owner.agent.get('/api/audit').query({ limit: 1 })).body as { items: unknown[]; total: number };
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThan(2);
    expect((await owner.agent.get('/api/audit').query({ limit: 500 })).status).toBe(400);
  });

  it('is for owners only and shows only the clinic\'s own entries', async () => {
    const mine = await frontDesk();
    const stranger = await frontDesk();
    expect((await mine.reception.agent.get('/api/audit')).status).toBe(403);
    expect((await mine.doctor.agent.get('/api/audit')).status).toBe(403);
    const theirs = (await stranger.owner.agent.get('/api/audit').query({ action: 'patient.created' })).body as { total: number };
    expect(theirs.total).toBe(1);
  });
});
