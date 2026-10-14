import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { conflict, notFound } from '../../common/errors';
import type { ReqCtx } from '../../common/request-context';
import { dateSchema } from '../../common/validate';
import { DbService } from '../../db/db.service';
import {
  type Locale,
  type PrescriptionFields,
  appointmentReminder,
  paymentReminder,
  prescriptionMessage,
  whatsappUrl,
} from './templates';

export const remindersQuerySchema = z.object({ date: dateSchema.optional() });

export interface ReminderEntry {
  appointmentId: string;
  startsAt: Date;
  patientName: string;
  doctorName: string;
  phone: string | null;
  sent: boolean;
  text: string;
  /** Null when the patient has no phone number on file. */
  whatsappUrl: string | null;
}

export interface PreparedMessage {
  phone: string;
  text: string;
  whatsappUrl: string;
}

interface ReminderRow {
  appointmentId: string;
  startsAt: Date;
  patientId: string;
  patientName: string;
  doctorName: string;
  phone: string | null;
  clinicName: string;
  clinicPhone: string | null;
  locale: Locale;
  day: string;
  time: string;
  sent: boolean;
}

const REMINDER_SELECT = `
  select a.id as "appointmentId", a.starts_at as "startsAt", p.id as "patientId", p.name as "patientName",
         d.name as "doctorName", p.phone, c.name as "clinicName", c.phone as "clinicPhone", c.locale,
         to_char(a.starts_at at time zone c.timezone, 'DD Mon YYYY') as day,
         to_char(a.starts_at at time zone c.timezone, 'HH12:MI AM') as time,
         exists (select 1 from message_log m where m.appointment_id = a.id
                   and m.kind = 'appointment_reminder' and m.status = 'marked_sent') as sent
    from appointments a
    join patients p on p.id = a.patient_id
    join doctors d on d.id = a.doctor_id
    join clinics c on c.id = a.clinic_id`;

function toEntry(row: ReminderRow): ReminderEntry {
  const text = appointmentReminder(row.locale, {
    patient: row.patientName,
    doctor: row.doctorName,
    clinic: row.clinicName,
    clinicPhone: row.clinicPhone,
    day: row.day,
    time: row.time,
  });
  return {
    appointmentId: row.appointmentId,
    startsAt: row.startsAt,
    patientName: row.patientName,
    doctorName: row.doctorName,
    phone: row.phone,
    sent: row.sent,
    text,
    whatsappUrl: row.phone === null ? null : whatsappUrl(row.phone, text),
  };
}

/**
 * Click-to-send messages. The server writes the text and builds the link, a person at the desk
 * presses send in WhatsApp, and the log records which reminders were handled. Nothing is sent
 * automatically, so there is no vendor account, no per-message cost and no risk of a wrong bulk send.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Booked appointments on a day, which defaults to tomorrow in the clinic's time zone. */
  reminders(ctx: ReqCtx, date: string | undefined): Promise<ReminderEntry[]> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const rows = await tx.many<ReminderRow>(
        `${REMINDER_SELECT}
          where a.status = 'booked' and a.kind = 'appointment'
            and a.starts_at >= (coalesce($1::date, (now() at time zone c.timezone)::date + 1)::timestamp at time zone c.timezone)
            and a.starts_at < ((coalesce($1::date, (now() at time zone c.timezone)::date + 1) + 1)::timestamp at time zone c.timezone)
          order by a.starts_at`,
        [date ?? null],
      );
      return rows.map(toEntry);
    });
  }

  /** Marking a reminder as sent twice has no further effect. */
  async markReminderSent(ctx: ReqCtx, appointmentId: string): Promise<ReminderEntry> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.maybeOne<ReminderRow>(`${REMINDER_SELECT} where a.id = $1 for update of a`, [appointmentId]);
      if (row === null) throw notFound('This appointment');
      if (row.phone === null) throw conflict('no_phone', 'This patient has no phone number.');
      const entry = toEntry(row);
      if (!row.sent) {
        // The unique index lets only one of two simultaneous requests write the log row.
        const written = await tx.execute(
          `insert into message_log (clinic_id, patient_id, appointment_id, kind, to_phone, body, status, created_by, marked_sent_at)
           values ($1, $2, $3, 'appointment_reminder', $4, $5, 'marked_sent', $6, now())
           on conflict (appointment_id) where kind = 'appointment_reminder' and status = 'marked_sent' do nothing`,
          [ctx.user.clinicId, row.patientId, appointmentId, row.phone, entry.text, ctx.user.id],
        );
        if (written > 0) {
          await this.audit.record(tx, ctx, { action: 'reminder.marked_sent', entity: 'appointment', entityId: appointmentId });
        }
      }
      return { ...entry, sent: true };
    });
  }

  /** The prescription as a WhatsApp message. It leaves out the diagnosis and lists only what the patient needs. */
  async prescription(ctx: ReqCtx, visitId: string): Promise<PreparedMessage> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.maybeOne<PrescriptionFields & { phone: string | null; locale: Locale }>(
        `select pt.name as patient, pt.phone, d.name as doctor, c.name as clinic, c.locale,
                p.items, p.advice, to_char(p.follow_up_on, 'YYYY-MM-DD') as "followUpOn"
           from prescriptions p
           join visits v on v.id = p.visit_id
           join patients pt on pt.id = v.patient_id
           join doctors d on d.id = v.doctor_id
           join clinics c on c.id = v.clinic_id
          where p.visit_id = $1`,
        [visitId],
      );
      if (row === null) throw notFound('This prescription');
      if (row.phone === null) throw conflict('no_phone', 'This patient has no phone number.');
      const text = prescriptionMessage(row.locale, row);
      await this.audit.record(tx, ctx, { action: 'prescription.whatsapp_prepared', entity: 'visit', entityId: visitId });
      return { phone: row.phone, text, whatsappUrl: whatsappUrl(row.phone, text) };
    });
  }

  async paymentReminder(ctx: ReqCtx, invoiceId: string): Promise<PreparedMessage> {
    return this.db.withClinic(ctx.user.clinicId, async (tx) => {
      const row = await tx.maybeOne<{ patient: string; phone: string | null; clinic: string; locale: Locale; invoiceNo: number; due: number; status: string }>(
        `select p.name as patient, p.phone, c.name as clinic, c.locale, i.invoice_no as "invoiceNo",
                (i.total - i.paid) as due, i.status
           from invoices i join patients p on p.id = i.patient_id join clinics c on c.id = i.clinic_id
          where i.id = $1`,
        [invoiceId],
      );
      if (row === null) throw notFound('This invoice');
      if (row.status === 'void' || row.due === 0) throw conflict('nothing_due', 'Nothing is due on this invoice.');
      if (row.phone === null) throw conflict('no_phone', 'This patient has no phone number.');
      const text = paymentReminder(row.locale, { patient: row.patient, clinic: row.clinic, invoiceNo: row.invoiceNo, due: row.due });
      return { phone: row.phone, text, whatsappUrl: whatsappUrl(row.phone, text) };
    });
  }
}
