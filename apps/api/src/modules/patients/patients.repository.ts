import { Injectable } from '@nestjs/common';
import { escapeLike } from '../../db/sql';
import type { Tx } from '../../db/tx';
import { nameWords, wordKey } from '../../common/name-key';

export interface PatientRecord {
  id: string;
  patientNo: number;
  name: string;
  phone: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age: number | null;
  guardianName: string | null;
  address: string | null;
  allergies: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PatientListItem {
  id: string;
  patientNo: number;
  name: string;
  phone: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age: number | null;
  guardianName: string | null;
  lastVisitAt: Date | null;
}

export interface NewPatient {
  clinicId: string;
  patientNo: number;
  name: string;
  nameKey: string;
  phone: string | null;
  gender: string | null;
  birthYear: number | null;
  guardianName: string | null;
  address: string | null;
  allergies: string | null;
  notes: string | null;
  createdBy: string;
}

const AGE = 'case when p.birth_year is null then null else extract(year from now())::int - p.birth_year end';

const RECORD_COLUMNS = `
  p.id, p.patient_no as "patientNo", p.name, p.phone, p.gender, ${AGE} as age,
  p.guardian_name as "guardianName", p.address, p.allergies, p.notes,
  p.created_at as "createdAt", p.updated_at as "updatedAt"`;

const LIST_COLUMNS = `
  p.id, p.patient_no as "patientNo", p.name, p.phone, p.gender, ${AGE} as age,
  p.guardian_name as "guardianName",
  (select max(v.visited_at) from visits v where v.patient_id = p.id) as "lastVisitAt"`;

interface SearchFilter {
  where: string;
  params: unknown[];
  rankSql: string;
  rankParams: unknown[];
}

/** Turns what the receptionist typed into a WHERE clause. Parameters start at $1. */
export function buildSearchFilter(query: string | undefined): SearchFilter {
  const text = (query ?? '').trim();
  if (text === '') return { where: 'true', params: [], rankSql: '1::int', rankParams: [] };

  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  // A number, with or without spaces and dashes: a patient number or part of a phone number.
  if (/^[\d\s+()-]+$/.test(text)) {
    const digits = text.replace(/\D/g, '');
    const parts: string[] = [];
    if (digits.length <= 7 && digits.length > 0) parts.push(`p.patient_no = ${next(Number(digits))}`);
    if (digits.length >= 3) parts.push(`p.phone like ${next(`%${escapeLike(digits)}%`)}`);
    if (parts.length === 0) return { where: 'false', params: [], rankSql: '1::int', rankParams: [] };
    return { where: `(${parts.join(' or ')})`, params, rankSql: '1::int', rankParams: [] };
  }

  const conditions: string[] = [];
  const words = nameWords(text).slice(0, 5);
  for (const word of words) {
    const plain = `p.name ilike ${next(`%${escapeLike(word)}%`)}`;
    const key = wordKey(word);
    // The skeleton key lets Muhammad find Mohammed. It matches the start of any word in the name.
    conditions.push(key === '' ? `(${plain})` : `(${plain} or p.name_key like ${next(`% ${escapeLike(key)}%`)})`);
  }
  if (conditions.length === 0) return { where: 'false', params: [], rankSql: '1::int', rankParams: [] };

  const first = words[0] ?? '';
  return {
    where: conditions.join(' and '),
    params,
    // Names that start with what was typed come first.
    rankSql: `case when p.name ilike $RANK then 0 else 1 end`,
    rankParams: [`${escapeLike(first)}%`],
  };
}

@Injectable()
export class PatientsRepository {
  /** Numbers are handed out under a row lock on the clinic, so they never repeat or skip. */
  async nextPatientNo(tx: Tx, clinicId: string): Promise<number> {
    const row = await tx.one<{ seq: number }>(
      'update clinics set patient_seq = patient_seq + 1 where id = $1 returning patient_seq as seq',
      [clinicId],
    );
    return row.seq;
  }

  insert(tx: Tx, patient: NewPatient): Promise<PatientRecord> {
    return tx
      .one<{ id: string }>(
        `insert into patients (clinic_id, patient_no, name, name_key, phone, gender, birth_year,
                               guardian_name, address, allergies, notes, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [
          patient.clinicId,
          patient.patientNo,
          patient.name,
          patient.nameKey,
          patient.phone,
          patient.gender,
          patient.birthYear,
          patient.guardianName,
          patient.address,
          patient.allergies,
          patient.notes,
          patient.createdBy,
        ],
      )
      .then((row) => this.findById(tx, row.id))
      .then((record) => {
        if (record === null) throw new Error('Inserted patient could not be read back.');
        return record;
      });
  }

  findById(tx: Tx, id: string): Promise<PatientRecord | null> {
    return tx.maybeOne<PatientRecord>(`select ${RECORD_COLUMNS} from patients p where p.id = $1`, [id]);
  }

  /** People with the same phone number and the same name spelling are probably the same person. */
  findDuplicates(tx: Tx, phone: string, nameKey: string): Promise<PatientListItem[]> {
    return tx.many<PatientListItem>(
      `select ${LIST_COLUMNS} from patients p where p.phone = $1 and p.name_key = $2 order by p.patient_no limit 5`,
      [phone, nameKey],
    );
  }

  async search(tx: Tx, query: string | undefined, limit: number, offset: number): Promise<{ items: PatientListItem[]; total: number }> {
    const filter = buildSearchFilter(query);
    const rankIndex = filter.params.length + 1;
    const rank = filter.rankSql.replace('$RANK', `$${rankIndex}`);
    const rankParams = filter.rankParams;
    const items = await tx.many<PatientListItem>(
      `select ${LIST_COLUMNS} from patients p
        where ${filter.where}
        order by ${rank}, p.name, p.patient_no
        limit $${rankIndex + rankParams.length} offset $${rankIndex + rankParams.length + 1}`,
      [...filter.params, ...rankParams, limit, offset],
    );
    const count = await tx.one<{ total: number }>(
      `select count(*)::int as total from patients p where ${filter.where}`,
      filter.params,
    );
    return { items, total: count.total };
  }
}
