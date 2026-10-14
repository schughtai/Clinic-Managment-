import type { Translate } from '../../../i18n';

export type Sex = 'female' | 'male' | 'other' | 'unknown';
export type PhoneLabel = 'mobile' | 'home' | 'emergency' | 'other';
export type HistorySection = 'allergy' | 'condition' | 'surgery' | 'medication' | 'family';
export type SectionState = 'not_assessed' | 'unknown' | 'patient_reports_none' | 'has_entries';

export interface PatientSummary {
  id: string;
  patientNumber: string;
  nameEn: string | null;
  nameUr: string | null;
  sex: Sex;
  dateOfBirth: string | null;
  approximateAge: number | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: string;
}

export interface PatientDetail extends PatientSummary {
  phones: { phone: string; label: PhoneLabel }[];
}

export interface HistoryEntry {
  id: string;
  section: HistorySection;
  content: Record<string, unknown>;
  source: string;
  status: string;
  recordedAt: string;
  supersedesId: string | null;
}

export interface HistorySectionView {
  section: HistorySection;
  state: SectionState;
  entries: HistoryEntry[];
}

export const HISTORY_LABELS: Record<HistorySection, string> = {
  allergy: 'Allergies',
  condition: 'Conditions',
  surgery: 'Surgeries',
  medication: 'Medicines',
  family: 'Family history',
};

/** Display name: English first, then Urdu, so a name written in either script shows. */
export function displayName(patient: Pick<PatientSummary, 'nameEn' | 'nameUr'>): string {
  return patient.nameEn ?? patient.nameUr ?? '';
}

/** Age in years from a date of birth, or the approximate age that was recorded. */
export function ageText(patient: Pick<PatientSummary, 'dateOfBirth' | 'approximateAge'>, t: Translate): string {
  if (patient.dateOfBirth !== null) {
    const birth = new Date(`${patient.dateOfBirth}T00:00:00`);
    const today = new Date();
    let years = today.getFullYear() - birth.getFullYear();
    const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
    if (beforeBirthday) years -= 1;
    return `${years}`;
  }
  if (patient.approximateAge !== null) return t('about {n}', { n: String(patient.approximateAge) });
  return '—';
}

/** Shows stored digits as +92 300 1234567 (Pakistan) or +<digits> for other countries. */
export function formatPhone(digits: string): string {
  if (digits.startsWith('92') && digits.length === 12) return `+92 ${digits.slice(2, 5)} ${digits.slice(5)}`;
  return `+${digits}`;
}

export const SEX_LABELS: Record<Sex, string> = {
  female: 'Female',
  male: 'Male',
  other: 'Other',
  unknown: 'Not recorded',
};

export const STATE_LABELS: Record<SectionState, string> = {
  not_assessed: 'Not yet asked',
  unknown: 'Unknown',
  patient_reports_none: 'Patient reports none',
  has_entries: 'Recorded',
};
