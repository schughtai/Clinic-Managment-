import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit.service';
import { AppError, badRequest } from '../../common/errors';
import { nameKey } from '../../common/name-key';
import { normalizePhone } from '../../common/phone';
import type { ReqCtx } from '../../common/request-context';
import { DbService } from '../../db/db.service';
import { normalizeHeader, parseCsv } from './csv';

export const MAX_IMPORT_ROWS = 2_000;

const COLUMN_ALIASES: Readonly<Record<string, readonly string[]>> = {
  name: ['name', 'fullname', 'patientname', 'patient'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'cell', 'contact', 'contactnumber'],
  gender: ['gender', 'sex'],
  age: ['age'],
  address: ['address'],
  allergies: ['allergies', 'allergy'],
  guardian: ['guardian', 'guardianname', 'fathername', 'husbandname', 'fatherhusbandname'],
  notes: ['notes', 'remarks'],
};

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  valid: number;
  created: number;
  skippedDuplicates: number;
  errors: ImportRowError[];
}

interface CleanRow {
  name: string;
  nameKey: string;
  phone: string | null;
  gender: string | null;
  birthYear: number | null;
  guardian: string | null;
  address: string | null;
  allergies: string | null;
  notes: string | null;
}

const GENDERS: Readonly<Record<string, string>> = {
  m: 'male', male: 'male', man: 'male', boy: 'male',
  f: 'female', female: 'female', woman: 'female', girl: 'female',
  o: 'other', other: 'other',
};

function limited(value: string | undefined, max: number): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  return trimmed.length > max ? null : trimmed;
}

/** Turns one CSV row into a clean patient, or a message saying what is wrong with it. */
function cleanRow(cells: Record<string, string>, year: number): CleanRow | string {
  const name = (cells.name ?? '').trim();
  if (name === '') return 'The name is empty.';
  if (name.length > 120) return 'The name is longer than 120 characters.';

  let phone: string | null = null;
  const rawPhone = (cells.phone ?? '').trim();
  if (rawPhone !== '') {
    phone = normalizePhone(rawPhone);
    if (phone === null) return `The phone number "${rawPhone}" is not valid.`;
  }

  let gender: string | null = null;
  const rawGender = (cells.gender ?? '').trim().toLowerCase();
  if (rawGender !== '') {
    gender = GENDERS[rawGender] ?? null;
    if (gender === null) return `The gender "${cells.gender ?? ''}" is not recognised. Use male, female or other.`;
  }

  let birthYear: number | null = null;
  const rawAge = (cells.age ?? '').trim();
  if (rawAge !== '') {
    const age = Number(rawAge);
    if (!Number.isInteger(age) || age < 0 || age > 130) return `The age "${rawAge}" is not a whole number from 0 to 130.`;
    birthYear = year - age;
  }

  const overlong = (value: string | undefined, max: number, label: string): string | null =>
    (value ?? '').trim().length > max ? `The ${label} is longer than ${max} characters.` : null;
  const problem =
    overlong(cells.address, 300, 'address') ??
    overlong(cells.allergies, 1000, 'allergies') ??
    overlong(cells.guardian, 120, 'guardian name') ??
    overlong(cells.notes, 2000, 'notes');
  if (problem !== null) return problem;

  return {
    name,
    nameKey: nameKey(name),
    phone,
    gender,
    birthYear,
    guardian: limited(cells.guardian, 120),
    address: limited(cells.address, 300),
    allergies: limited(cells.allergies, 1000),
    notes: limited(cells.notes, 2000),
  };
}

@Injectable()
export class ImportService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Imports patients from a spreadsheet saved as CSV. With dryRun the file is checked and nothing is written,
   * so the clinic can fix problems first. A real import is all-or-nothing, and people already in the system
   * with the same name and phone number are skipped.
   */
  async importPatients(ctx: ReqCtx, csvText: string, dryRun: boolean): Promise<ImportResult> {
    const table = parseCsv(csvText);
    const header = table[0];
    if (header === undefined) throw badRequest('empty_file', 'The file is empty.');

    const columnOf = new Map<string, number>();
    header.forEach((title, index) => {
      const normalized = normalizeHeader(title);
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.includes(normalized) && !columnOf.has(field)) columnOf.set(field, index);
      }
    });
    if (!columnOf.has('name')) {
      throw badRequest('missing_name_column', 'The first row must have a column named Name.');
    }
    const dataRows = table.slice(1);
    if (dataRows.length === 0) throw badRequest('no_rows', 'The file has a header but no patients.');
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new AppError(413, 'too_many_rows', `Import at most ${MAX_IMPORT_ROWS} patients at a time. Split the file and try again.`);
    }

    const year = new Date().getUTCFullYear();
    const errors: ImportRowError[] = [];
    const clean: CleanRow[] = [];
    dataRows.forEach((cells, index) => {
      const record: Record<string, string> = {};
      for (const [field, column] of columnOf) record[field] = cells[column] ?? '';
      const result = cleanRow(record, year);
      if (typeof result === 'string') errors.push({ row: index + 2, message: result });
      else clean.push(result);
    });

    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const phones = [...new Set(clean.flatMap((row) => (row.phone === null ? [] : [row.phone])))];
      const existing =
        phones.length === 0
          ? []
          : await tx.many<{ phone: string; nameKey: string }>(
              'select phone, name_key as "nameKey" from patients where phone = any($1::text[])',
              [phones],
            );
      const seen = new Set(existing.map((row) => `${row.phone}|${row.nameKey}`));

      const toCreate: CleanRow[] = [];
      let skipped = 0;
      for (const row of clean) {
        if (row.phone !== null) {
          const key = `${row.phone}|${row.nameKey}`;
          if (seen.has(key)) {
            skipped += 1;
            continue;
          }
          seen.add(key);
        }
        toCreate.push(row);
      }

      if (dryRun || toCreate.length === 0 || errors.length > 0) {
        // A file with problems is not imported at all, so the clinic never ends up with half a list.
        return { dryRun, rows: dataRows.length, valid: toCreate.length, created: 0, skippedDuplicates: skipped, errors };
      }

      // Reserve a block of patient numbers in one step, then insert every row with one statement.
      const block = await tx.one<{ seq: number }>(
        'update clinics set patient_seq = patient_seq + $2 where id = $1 returning patient_seq as seq',
        [ctx.user.clinicId, toCreate.length],
      );
      const first = block.seq - toCreate.length + 1;
      await tx.execute(
        `insert into patients (clinic_id, patient_no, name, name_key, phone, gender, birth_year, guardian_name, address, allergies, notes, created_by)
         select $1::uuid, $2::int + (u.n - 1)::int, u.name, u.name_key, u.phone, u.gender, u.birth_year, u.guardian, u.address, u.allergies, u.notes, $12::uuid
           from unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[], $10::text[], $11::text[])
                with ordinality as u(name, name_key, phone, gender, birth_year, guardian, address, allergies, notes, n)`,
        [
          ctx.user.clinicId,
          first,
          toCreate.map((row) => row.name),
          toCreate.map((row) => row.nameKey),
          toCreate.map((row) => row.phone),
          toCreate.map((row) => row.gender),
          toCreate.map((row) => row.birthYear),
          toCreate.map((row) => row.guardian),
          toCreate.map((row) => row.address),
          toCreate.map((row) => row.allergies),
          toCreate.map((row) => row.notes),
          ctx.user.id,
        ],
      );
      await this.audit.record(tx, ctx, {
        action: 'patients.imported',
        meta: { created: toCreate.length, skipped, rows: dataRows.length },
      });
      return { dryRun, rows: dataRows.length, valid: toCreate.length, created: toCreate.length, skippedDuplicates: skipped, errors };
    });
  }
}
