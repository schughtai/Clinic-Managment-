import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { nameKey } from '../common/name-key';

/**
 * Synthetic demo data for development only. None of these people exist.
 * The sign-in details are listed in the README so a developer can try the system straight away.
 */
export const DEMO_PASSWORD = 'demo-password-123';
export const DEMO_ACCOUNTS = {
  owner: { name: 'Demo Owner', phone: '923001000001', role: 'owner' as const },
  doctor: { name: 'Dr Sana Malik', phone: '923001000002', role: 'doctor' as const },
  receptionist: { name: 'Demo Receptionist', phone: '923001000003', role: 'receptionist' as const },
};

const PATIENTS: readonly { name: string; phone: string | null; gender: 'male' | 'female'; age: number; allergies?: string }[] = [
  { name: 'Muhammad Ali', phone: '923001110001', gender: 'male', age: 45 },
  { name: 'Ayesha Khan', phone: '923001110002', gender: 'female', age: 34, allergies: 'Penicillin' },
  { name: 'Fatima Bibi', phone: '923001110003', gender: 'female', age: 62 },
  { name: 'Usman Ahmed', phone: '923001110004', gender: 'male', age: 28 },
  { name: 'Zainab Hussain', phone: '923001110005', gender: 'female', age: 9 },
  { name: 'علی رضا', phone: '923001110006', gender: 'male', age: 51 },
  { name: 'Qasim Raza', phone: '923001110007', gender: 'male', age: 39 },
  { name: 'Mehwish Tariq', phone: '923001110008', gender: 'female', age: 27 },
  { name: 'Bilal Shah', phone: null, gender: 'male', age: 7 },
  { name: 'Sakina Noor', phone: '923001110010', gender: 'female', age: 71, allergies: 'Sulfa drugs' },
];

export interface SeedResult {
  seeded: boolean;
  clinicId?: string;
}

/** Creates a demo clinic when the database has none. Safe to run repeatedly. */
export async function seedDemo(adminUrl: string): Promise<SeedResult> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const existing = await client.query<{ count: number }>('select count(*)::int as count from clinics');
    if ((existing.rows[0]?.count ?? 0) > 0) return { seeded: false };

    await client.query('begin');
    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
    const registered = await client.query<{ clinic_id: string; user_id: string }>(
      'select * from register_clinic($1, $2, $3, $4)',
      ['Demo Clinic', DEMO_ACCOUNTS.owner.name, DEMO_ACCOUNTS.owner.phone, hash],
    );
    const clinicId = registered.rows[0]?.clinic_id;
    const ownerId = registered.rows[0]?.user_id;
    if (clinicId === undefined || ownerId === undefined) throw new Error('Demo clinic was not created.');

    await client.query("update clinics set city = 'Lahore', address = '12 Mall Road', locale = 'en' where id = $1", [clinicId]);

    const doctorUser = await client.query<{ id: string }>(
      "insert into users (clinic_id, name, phone, password_hash, role) values ($1, $2, $3, $4, 'doctor') returning id",
      [clinicId, DEMO_ACCOUNTS.doctor.name, DEMO_ACCOUNTS.doctor.phone, hash],
    );
    await client.query(
      "insert into users (clinic_id, name, phone, password_hash, role) values ($1, $2, $3, $4, 'receptionist')",
      [clinicId, DEMO_ACCOUNTS.receptionist.name, DEMO_ACCOUNTS.receptionist.phone, hash],
    );

    const doctor = await client.query<{ id: string }>(
      "insert into doctors (clinic_id, user_id, name, specialty, default_fee, slot_minutes) values ($1, $2, $3, 'General Physician', 1500, 15) returning id",
      [clinicId, doctorUser.rows[0]?.id, DEMO_ACCOUNTS.doctor.name],
    );
    const visiting = await client.query<{ id: string }>(
      "insert into doctors (clinic_id, name, specialty, default_fee, slot_minutes) values ($1, 'Dr Imran Siddiqui', 'Paediatrician', 2000, 20) returning id",
      [clinicId],
    );
    for (const [doctorId, sessions] of [
      [doctor.rows[0]?.id, [['09:00', '13:00'], ['17:00', '20:00']]],
      [visiting.rows[0]?.id, [['15:00', '18:00']]],
    ] as const) {
      for (const weekday of [1, 2, 3, 4, 5, 6]) {
        for (const [start, end] of sessions) {
          await client.query(
            'insert into doctor_schedules (clinic_id, doctor_id, weekday, start_time, end_time) values ($1, $2, $3, $4, $5)',
            [clinicId, doctorId, weekday, start, end],
          );
        }
      }
    }

    const year = new Date().getUTCFullYear();
    const patientIds: string[] = [];
    for (const [index, patient] of PATIENTS.entries()) {
      const created = await client.query<{ id: string }>(
        `insert into patients (clinic_id, patient_no, name, name_key, phone, gender, birth_year, allergies, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [clinicId, index + 1, patient.name, nameKey(patient.name), patient.phone, patient.gender, year - patient.age, patient.allergies ?? null, ownerId],
      );
      patientIds.push(created.rows[0]?.id ?? '');
    }
    await client.query('update clinics set patient_seq = $2 where id = $1', [clinicId, PATIENTS.length]);

    const visit = await client.query<{ id: string }>(
      `insert into visits (clinic_id, patient_id, doctor_id, complaint, history, examination, diagnosis, plan, vitals, created_by)
       values ($1, $2, $3, 'Fever and body ache for 3 days', 'No cough. Appetite reduced.', 'Throat mildly red. Chest clear.',
               'Viral fever', 'Rest, fluids. Review in 3 days if fever continues.', $4::jsonb, $5) returning id`,
      [clinicId, patientIds[1], doctor.rows[0]?.id, JSON.stringify({ bloodPressure: '110/70', pulse: 92, temperatureC: 38.6, weightKg: 62 }), doctorUser.rows[0]?.id],
    );
    await client.query(
      `insert into prescriptions (clinic_id, visit_id, items, advice, created_by) values ($1, $2, $3::jsonb, 'Drink plenty of fluids.', $4)`,
      [
        clinicId,
        visit.rows[0]?.id,
        JSON.stringify([
          { medicine: 'Tab Paracetamol 500mg', dose: '1 tablet', frequency: 'Three times a day', duration: '3 days', instructions: 'After meals' },
          { medicine: 'ORS sachet', dose: '1 sachet in 1 litre water', frequency: 'Through the day', duration: '3 days', instructions: null },
        ]),
        doctorUser.rows[0]?.id,
      ],
    );

    const invoice = await client.query<{ id: string }>(
      `insert into invoices (clinic_id, invoice_no, patient_id, visit_id, status, subtotal, discount, total, paid, created_by)
       values ($1, 1, $2, $3, 'partial', 1500, 0, 1500, 1000, $4) returning id`,
      [clinicId, patientIds[1], visit.rows[0]?.id, ownerId],
    );
    await client.query(
      "insert into invoice_items (clinic_id, invoice_id, position, description, quantity, unit_price, amount) values ($1, $2, 0, 'Consultation', 1, 1500, 1500)",
      [clinicId, invoice.rows[0]?.id],
    );
    await client.query("insert into payments (clinic_id, invoice_id, amount, method, received_by) values ($1, $2, 1000, 'cash', $3)", [
      clinicId,
      invoice.rows[0]?.id,
      ownerId,
    ]);
    await client.query('update clinics set invoice_seq = 1 where id = $1', [clinicId]);

    await client.query('commit');
    return { seeded: true, clinicId };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
