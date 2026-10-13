import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type SignedInClinic, type TestApp, addStaff, signUpClinic, startTestApp } from './support/app';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await startTestApp();
});

afterAll(async () => {
  await testApp.close();
});

interface InvoiceBody {
  id: string;
  invoiceNo: number;
  status: string;
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  payments: { id: string; amount: number; method: string }[];
}
interface PaymentBody {
  payment: { id: string; amount: number };
  invoice: { status: string; paid: number; due: number };
  replayed: boolean;
}
interface ErrorBody {
  error: { code: string; details?: { remaining?: number } };
}

interface Desk {
  owner: SignedInClinic;
  reception: SignedInClinic;
  doctor: SignedInClinic;
  patientId: string;
}

async function desk(): Promise<Desk> {
  const owner = await signUpClinic(testApp);
  const reception = await addStaff(testApp, owner, 'receptionist');
  const doctor = await addStaff(testApp, owner, 'doctor');
  const patient = await owner.agent.post('/api/patients').send({ name: 'Billing Patient', phone: '03001239999' });
  return { owner, reception, doctor, patientId: (patient.body as { id: string }).id };
}

interface Line {
  description: string;
  unitPrice: number;
  quantity?: number;
}

async function invoice(who: SignedInClinic, patientId: string, lines: Line[] = [{ description: 'Consultation', unitPrice: 1000 }], extra: Record<string, unknown> = {}): Promise<InvoiceBody> {
  const response = await who.agent.post('/api/invoices').send({ patientId, lines, ...extra });
  if (response.status !== 201) throw new Error(`Could not create invoice: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body as InvoiceBody;
}

const pay = (who: SignedInClinic, id: string, amount: number, method = 'cash', key?: string) => {
  const request = who.agent.post(`/api/invoices/${id}/payments`);
  if (key !== undefined) request.set('Idempotency-Key', key);
  return request.send({ amount, method });
};

describe('creating invoices', () => {
  it('prices the items and applies a percentage discount in whole rupees', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(
      reception,
      patientId,
      [{ description: 'Consultation', unitPrice: 1500 }, { description: 'Injection', quantity: 2, unitPrice: 250 }],
      { discount: { kind: 'percent', value: 10 } },
    );
    expect(created).toMatchObject({ invoiceNo: 1, status: 'unpaid', subtotal: 2000, discount: 200, total: 1800, paid: 0, due: 1800 });
    expect(created.items.map((item) => item.amount)).toEqual([1500, 500]);
  });

  it('rounds a percentage discount half up', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId, [{ description: 'Visit', unitPrice: 1235 }], { discount: { kind: 'percent', value: 10 } });
    expect(created.discount).toBe(124);
    expect(created.total).toBe(1111);
  });

  it('numbers invoices without gaps or repeats, even when created together', async () => {
    const { reception, patientId } = await desk();
    const results = await Promise.all(Array.from({ length: 6 }, () => invoice(reception, patientId)));
    expect(results.map((result) => result.invoiceNo).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('treats an invoice with nothing to pay as already paid', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId, [{ description: 'Free review', unitPrice: 0 }]);
    expect(created).toMatchObject({ total: 0, status: 'paid', due: 0 });
  });

  it('rejects empty, negative, oversized and unknown input', async () => {
    const { reception, patientId } = await desk();
    const url = '/api/invoices';
    const good = { description: 'X', unitPrice: 100 };
    const bad: Record<string, unknown>[] = [
      { patientId, lines: [] },
      { patientId, lines: [{ description: 'X', unitPrice: -5 }] },
      { patientId, lines: [{ description: 'X', unitPrice: 10.5 }] },
      { patientId, lines: [{ description: ' ', unitPrice: 5 }] },
      { patientId, lines: [{ description: 'X', quantity: 0, unitPrice: 5 }] },
      { patientId, lines: [good], discount: { kind: 'percent', value: 101 } },
      { patientId, lines: [good], discount: { kind: 'amount', value: -1 } },
      { patientId, lines: [good], discount: { kind: 'bogus', value: 1 } },
      { patientId, lines: [good], total: 1 },
      { patientId, lines: Array.from({ length: 51 }, () => good) },
    ];
    for (const body of bad) {
      expect((await reception.agent.post(url).send(body)).status, JSON.stringify(body).slice(0, 70)).toBe(400);
    }
    const tooBig = await reception.agent.post(url).send({ patientId, lines: [good], discount: { kind: 'amount', value: 101 } });
    expect(tooBig.status).toBe(422);
    expect((tooBig.body as ErrorBody).error.code).toBe('discount_too_large');
  });

  it('refuses unknown patients and a visit that belongs to someone else', async () => {
    const { owner, reception, patientId } = await desk();
    const lines = [{ description: 'X', unitPrice: 100 }];
    expect((await reception.agent.post('/api/invoices').send({ patientId: randomUUID(), lines })).status).toBe(404);
    const other = (await owner.agent.post('/api/patients').send({ name: 'Another Person' })).body as { id: string };
    const doctors = (await owner.agent.get('/api/doctors')).body as { id: string }[];
    const visit = (await owner.agent.post('/api/visits').send({ patientId: other.id, doctorId: doctors[0]?.id })).body as { visit: { id: string } };
    const mismatch = await reception.agent.post('/api/invoices').send({ patientId, visitId: visit.visit.id, lines });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as ErrorBody).error.code).toBe('visit_mismatch');
  });

  it('is closed to doctors and visitors', async () => {
    const { doctor, patientId } = await desk();
    expect((await doctor.agent.post('/api/invoices').send({ patientId, lines: [{ description: 'X', unitPrice: 1 }] })).status).toBe(403);
    expect((await doctor.agent.get('/api/invoices')).status).toBe(403);
    expect((await testApp.anonymous().get('/api/invoices')).status).toBe(401);
  });
});

describe('taking payments', () => {
  it('moves an invoice from unpaid to partial to paid', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const first = (await pay(reception, created.id, 400, 'jazzcash')).body as PaymentBody;
    expect(first.invoice).toMatchObject({ status: 'partial', paid: 400, due: 600 });
    const second = (await pay(reception, created.id, 600, 'cash')).body as PaymentBody;
    expect(second.invoice).toMatchObject({ status: 'paid', paid: 1000, due: 0 });
    const detail = (await reception.agent.get(`/api/invoices/${created.id}`)).body as InvoiceBody;
    expect(detail.payments.map((payment) => [payment.amount, payment.method])).toEqual([[400, 'jazzcash'], [600, 'cash']]);
  });

  it('refuses more than is due and a payment on a settled invoice', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    await pay(reception, created.id, 700);
    const over = await pay(reception, created.id, 400);
    expect(over.status).toBe(422);
    expect((over.body as ErrorBody).error).toMatchObject({ code: 'overpayment', details: { remaining: 300 } });
    await pay(reception, created.id, 300);
    const settled = await pay(reception, created.id, 1);
    expect(settled.status).toBe(409);
    expect((settled.body as ErrorBody).error.code).toBe('already_paid');
  });

  it('rejects zero, fractional and unknown payments', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const url = `/api/invoices/${created.id}/payments`;
    for (const body of [{ amount: 0, method: 'cash' }, { amount: 10.5, method: 'cash' }, { amount: 10, method: 'cheque' }, { amount: 10 }, { amount: 10, method: 'cash', extra: 1 }]) {
      expect((await reception.agent.post(url).send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('never lets simultaneous payments add up to more than the invoice total', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const responses = await Promise.all(Array.from({ length: 6 }, () => pay(reception, created.id, 300)));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([201, 201, 201, 422, 422, 422]);
    const detail = (await reception.agent.get(`/api/invoices/${created.id}`)).body as InvoiceBody;
    expect(detail.paid).toBe(900);
    expect(detail.status).toBe('partial');
    expect(detail.payments).toHaveLength(3);
  });

  it('records a repeated request once when it carries the same idempotency key', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const key = randomUUID();
    const first = (await pay(reception, created.id, 400, 'cash', key)).body as PaymentBody;
    const again = await pay(reception, created.id, 400, 'cash', key);
    expect(again.status).toBe(201);
    const replay = again.body as PaymentBody;
    expect(replay.replayed).toBe(true);
    expect(replay.payment.id).toBe(first.payment.id);
    expect(replay.invoice.paid).toBe(400);
    expect(first.replayed).toBe(false);
  });

  it('records a payment once when the same request arrives twice at the same moment', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const key = randomUUID();
    const [one, two] = await Promise.all([pay(reception, created.id, 500, 'cash', key), pay(reception, created.id, 500, 'cash', key)]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const detail = (await reception.agent.get(`/api/invoices/${created.id}`)).body as InvoiceBody;
    expect(detail.payments).toHaveLength(1);
    expect(detail.paid).toBe(500);
  });

  it('refuses a key that was already used for a different payment', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const key = randomUUID();
    await pay(reception, created.id, 100, 'cash', key);
    const conflict = await pay(reception, created.id, 200, 'cash', key);
    expect(conflict.status).toBe(409);
    expect((conflict.body as ErrorBody).error.code).toBe('idempotency_conflict');
    expect((await pay(reception, created.id, 100, 'cash', 'short')).status).toBe(400);
    expect((await pay(reception, created.id, 100, 'cash', 'bad key with spaces!')).status).toBe(400);
  });

  it('writes an audit entry for each payment', async () => {
    const { reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    await pay(reception, created.id, 250, 'easypaisa');
    const admin = new Client({ connectionString: inject('adminUrl') });
    await admin.connect();
    try {
      const rows = await admin.query<{ meta: { amount: number; method: string } }>(
        "select meta from audit_log where entity_id = $1 and action = 'payment.recorded'",
        [created.id],
      );
      expect(rows.rows.map((row) => row.meta)).toEqual([{ amount: 250, method: 'easypaisa' }]);
    } finally {
      await admin.end();
    }
  });
});

describe('cancelling invoices', () => {
  it('lets only the owner cancel an unpaid invoice, with a reason', async () => {
    const { owner, reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    const url = `/api/invoices/${created.id}/void`;
    expect((await reception.agent.post(url).send({ reason: 'Entered by mistake' })).status).toBe(403);
    expect((await owner.agent.post(url).send({ reason: 'x' })).status).toBe(400);
    const voided = await owner.agent.post(url).send({ reason: 'Entered by mistake' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'void', due: 0, voidReason: 'Entered by mistake' });
    expect((await owner.agent.post(url).send({ reason: 'Again please' })).status).toBe(409);
    const pays = await pay(reception, created.id, 100);
    expect(pays.status).toBe(409);
    expect((pays.body as ErrorBody).error.code).toBe('invoice_void');
  });

  it('refuses to cancel an invoice that already took money', async () => {
    const { owner, reception, patientId } = await desk();
    const created = await invoice(reception, patientId);
    await pay(reception, created.id, 100);
    const response = await owner.agent.post(`/api/invoices/${created.id}/void`).send({ reason: 'Customer changed mind' });
    expect(response.status).toBe(409);
    expect((response.body as ErrorBody).error.code).toBe('has_payments');
  });
});

describe('finding invoices', () => {
  it('filters by status and patient, and pages through results', async () => {
    const { owner, reception, patientId } = await desk();
    const second = (await owner.agent.post('/api/patients').send({ name: 'Second Patient' })).body as { id: string };
    const paid = await invoice(reception, patientId);
    await pay(reception, paid.id, 1000);
    const partial = await invoice(reception, patientId);
    await pay(reception, partial.id, 100);
    await invoice(reception, second.id);

    const list = async (query: Record<string, unknown>) =>
      (await reception.agent.get('/api/invoices').query(query)).body as { items: InvoiceBody[]; total: number };
    expect((await list({})).total).toBe(3);
    expect((await list({ status: 'open' })).total).toBe(2);
    expect((await list({ status: 'paid' })).items.map((item) => item.id)).toEqual([paid.id]);
    expect((await list({ patientId: second.id })).total).toBe(1);
    const page = await list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.invoiceNo).toBe(3);
    expect((await reception.agent.get('/api/invoices').query({ status: 'weird' })).status).toBe(400);
  });
});

describe('billing between clinics', () => {
  it('never shows, pays or cancels another clinic\'s invoices', async () => {
    const mine = await desk();
    const created = await invoice(mine.reception, mine.patientId);
    const stranger = await desk();
    const base = `/api/invoices/${created.id}`;
    expect((await stranger.reception.agent.get(base)).status).toBe(404);
    expect((await stranger.owner.agent.get(base)).status).toBe(404);
    expect((await stranger.reception.agent.post(`${base}/payments`).send({ amount: 10, method: 'cash' })).status).toBe(404);
    expect((await stranger.owner.agent.post(`${base}/void`).send({ reason: 'Not yours to cancel' })).status).toBe(404);
    expect(((await stranger.reception.agent.get('/api/invoices')).body as { total: number }).total).toBe(0);
    expect((await mine.reception.agent.get(base)).status).toBe(200);
  });
});
