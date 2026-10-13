import { z } from 'zod';
import { nullableText, pageSchema } from '../../common/validate';

const text = nullableText(20_000);

/** Measurements are checked against ranges a living person can have, to catch typing slips. */
export const vitalsSchema = z
  .object({
    bloodPressure: z.string().regex(/^\d{2,3}\/\d{2,3}$/, 'Use the form 120/80.').optional(),
    pulse: z.number().int().min(20).max(300).optional(),
    temperatureC: z.number().min(30).max(45).optional(),
    respiratoryRate: z.number().int().min(4).max(80).optional(),
    oxygenSaturation: z.number().int().min(50).max(100).optional(),
    weightKg: z.number().min(0.3).max(500).optional(),
    heightCm: z.number().min(20).max(260).optional(),
  })
  .strict();
export type Vitals = z.output<typeof vitalsSchema>;

const inputSource = z.enum(['typed', 'voice', 'handwriting', 'mixed']);

export const createVisitSchema = z
  .object({
    patientId: z.string().uuid(),
    /** Doctors always use their own profile. An owner must say which doctor saw the patient. */
    doctorId: z.string().uuid().optional(),
    appointmentId: z.string().uuid().optional(),
    complaint: text,
    history: text,
    examination: text,
    diagnosis: text,
    plan: text,
    vitals: vitalsSchema.optional(),
    inputSource: inputSource.default('typed'),
    aiAssisted: z.boolean().default(false),
  })
  .strict();

export const updateVisitSchema = z
  .object({
    complaint: text,
    history: text,
    examination: text,
    diagnosis: text,
    plan: text,
    vitals: vitalsSchema.optional(),
    inputSource: inputSource.optional(),
    aiAssisted: z.boolean().optional(),
  })
  .strict();

export const listVisitsSchema = pageSchema;

export const structureNoteSchema = z.object({ text: z.string().trim().min(1).max(20_000) }).strict();

export const transcriptionEditSchema = z.object({ transcription: z.string().max(20_000) }).strict();

export type CreateVisit = z.output<typeof createVisitSchema>;
export type UpdateVisit = z.output<typeof updateVisitSchema>;
