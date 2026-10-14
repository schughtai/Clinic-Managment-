import { z } from 'zod';

/** The five history sections. Each has its own required fields, so a free-text note cannot stand in for them. */
export const HISTORY_SECTIONS = ['allergy', 'condition', 'surgery', 'medication', 'family'] as const;
export type HistorySection = (typeof HISTORY_SECTIONS)[number];

export const HISTORY_SOURCES = ['patient_reported', 'representative_reported', 'imported', 'clinician_recorded'] as const;
export const HISTORY_STATUSES = ['active', 'resolved', 'historical', 'entered_in_error'] as const;
export const ASSESSMENT_STATES = ['not_assessed', 'unknown', 'patient_reports_none'] as const;

const text = (max: number) => z.string().trim().min(1, 'Required.').max(max);
const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));

/** Content per section. Validated before anything is stored. */
export const SECTION_CONTENT = {
  allergy: z.object({
    substance: text(120),
    reaction: optional(200),
    severity: z.enum(['mild', 'moderate', 'severe']).optional(),
  }),
  condition: z.object({
    name: text(120),
    since: optional(40),
    notes: optional(500),
  }),
  surgery: z.object({
    procedure: text(160),
    year: z.number().int().min(1900).max(2100).optional(),
    notes: optional(500),
  }),
  medication: z.object({
    name: text(120),
    dose: optional(60),
    frequency: optional(60),
  }),
  family: z.object({
    relation: text(40),
    condition: text(120),
  }),
} satisfies Record<HistorySection, z.ZodType>;

export const addEntrySchema = z
  .object({
    section: z.enum(HISTORY_SECTIONS),
    content: z.record(z.string(), z.unknown()),
    source: z.enum(HISTORY_SOURCES).default('clinician_recorded'),
    supersedesId: z.string().uuid().optional(),
  })
  .superRefine((value, context) => {
    const parsed = SECTION_CONTENT[value.section].safeParse(value.content);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({ code: 'custom', path: ['content', ...issue.path], message: issue.message });
      }
    }
  });

export const assessmentSchema = z.object({
  section: z.enum(HISTORY_SECTIONS),
  state: z.enum(ASSESSMENT_STATES),
});

/** Parses content after the superRefine check, returning the cleaned object for storage. */
export function cleanContent(section: HistorySection, content: Record<string, unknown>): Record<string, unknown> {
  return SECTION_CONTENT[section].parse(content) as Record<string, unknown>;
}
