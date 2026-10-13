export type Role = 'owner' | 'doctor' | 'receptionist';
export type Method = 'cash' | 'bank' | 'jazzcash' | 'easypaisa';

export interface Profile {
  user: { id: string; name: string; role: Role; phone: string };
  clinic: { id: string; name: string; locale: 'en' | 'ur'; timezone: string; aiEnabled: boolean; aiAvailable: boolean; modules: string[] };
}

export interface ClinicSettings {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  locale: 'en' | 'ur';
  timezone: string;
  aiEnabled: boolean;
  aiAvailable: boolean;
  modules: string[];
}

export interface Patient {
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
}

export interface PatientListItem {
  id: string;
  patientNo: number;
  name: string;
  phone: string | null;
  gender: 'male' | 'female' | 'other' | null;
  age: number | null;
  lastVisitAt: string | null;
}

export type AppointmentStatus = 'booked' | 'arrived' | 'in_consult' | 'done' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  kind: 'appointment' | 'walkin';
  status: AppointmentStatus;
  startsAt: string;
  endsAt: string;
  tokenNo: number | null;
  reason: string | null;
  patientId: string;
  patientName: string;
  patientNo: number;
  patientPhone: string | null;
  doctorId: string;
  doctorName: string;
}

export interface ScheduleSession {
  weekday: number;
  start: string;
  end: string;
}

export interface Doctor {
  id: string;
  userId: string | null;
  name: string;
  specialty: string | null;
  defaultFee: number;
  slotMinutes: number;
  active: boolean;
  schedule: ScheduleSession[];
}

export interface Slot {
  startsAt: string;
  available: boolean;
}

export interface SlotsResult {
  date: string;
  onLeave: boolean;
  slotMinutes: number;
  slots: Slot[];
}

export interface Vitals {
  bloodPressure?: string;
  pulse?: number;
  temperatureC?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  weightKg?: number;
  heightCm?: number;
}

export interface Visit {
  id: string;
  patientId: string;
  doctorId: string;
  doctorName: string;
  appointmentId: string | null;
  visitedAt: string;
  complaint: string | null;
  history: string | null;
  examination: string | null;
  diagnosis: string | null;
  plan: string | null;
  vitals: Vitals;
  inputSource: 'typed' | 'voice' | 'handwriting' | 'mixed';
  aiAssisted: boolean;
}

export interface Attachment {
  id: string;
  visitId: string;
  mimeType: string;
  sizeBytes: number;
  transcription: string | null;
  aiTranscribed: boolean;
  createdAt: string;
}

export interface VisitDetail {
  visit: Visit;
  attachments: Attachment[];
}

export interface VisitSummary {
  id: string;
  visitedAt: string;
  doctorName: string;
  complaint: string | null;
  diagnosis: string | null;
  inputSource: Visit['inputSource'];
  hasPrescription: boolean;
  attachmentCount: number;
}

export interface UploadResult {
  attachment: Attachment;
  ai:
    | { status: 'transcribed'; uncertainWords: string[]; language: string }
    | { status: 'skipped'; code: string; message: string }
    | { status: 'failed'; code: string; message: string };
}

export interface StructuredNote {
  complaint: string;
  history: string;
  examination: string;
  diagnosis: string;
  plan: string;
}

export interface PrescriptionItem {
  medicine: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  instructions: string | null;
}

export interface Prescription {
  id: string;
  visitId: string;
  items: PrescriptionItem[];
  advice: string | null;
  followUpOn: string | null;
}

export interface Template {
  id: string;
  name: string;
  items: PrescriptionItem[];
  advice: string | null;
}

export interface PrescriptionPrint {
  clinic: { name: string; phone: string | null; address: string | null; city: string | null; locale: 'en' | 'ur' };
  patient: { name: string; patientNo: number; age: number | null; gender: string | null };
  doctor: { name: string; specialty: string | null };
  visitedAt: string;
  diagnosis: string | null;
  items: PrescriptionItem[];
  advice: string | null;
  followUpOn: string | null;
}

export interface Invoice {
  id: string;
  invoiceNo: number;
  patientId: string;
  patientName: string;
  patientPhone: string | null;
  visitId: string | null;
  status: 'unpaid' | 'partial' | 'paid' | 'void';
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  due: number;
  voidReason: string | null;
  createdAt: string;
}

export interface InvoiceDetail extends Invoice {
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  payments: { id: string; amount: number; method: Method; reference: string | null; receivedAt: string }[];
}

export interface DailyReport {
  date: string;
  collected: { total: number; byMethod: Record<Method, number> };
  invoices: { count: number; billed: number };
  newPatients: number;
  visits: number;
  appointments: Record<string, number>;
  outstanding: { count: number; amount: number };
  closing: { expectedCash: number; countedCash: number; difference: number; note: string | null } | null;
}

export interface Closing {
  id: string;
  date: string;
  expectedCash: number;
  countedCash: number;
  difference: number;
  note: string | null;
}

export interface DoctorReportRow {
  doctorId: string;
  doctorName: string;
  visits: number;
  billed: number;
  collected: number;
}

export interface ReminderEntry {
  appointmentId: string;
  startsAt: string;
  patientName: string;
  doctorName: string;
  phone: string | null;
  sent: boolean;
  text: string;
  whatsappUrl: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  phone: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

export interface AuditEntry {
  id: number;
  action: string;
  entity: string | null;
  entityId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  valid: number;
  created: number;
  skippedDuplicates: number;
  errors: { row: number; message: string }[];
}
