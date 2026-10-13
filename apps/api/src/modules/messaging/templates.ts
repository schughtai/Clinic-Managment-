/** Message texts for click-to-send WhatsApp. Pure functions, so the wording is easy to test and change. */

export type Locale = 'en' | 'ur';

export interface ReminderFields {
  patient: string;
  doctor: string;
  clinic: string;
  clinicPhone: string | null;
  day: string;
  time: string;
}

export function appointmentReminder(locale: Locale, fields: ReminderFields): string {
  const contact = fields.clinicPhone === null ? '' : fields.clinicPhone;
  if (locale === 'ur') {
    return `السلام علیکم ${fields.patient}، ${fields.clinic} میں ${fields.doctor} کے ساتھ آپ کی ملاقات ${fields.day} کو ${fields.time} پر ہے۔ تبدیلی کے لیے رابطہ کریں${contact === '' ? '۔' : `: ${contact}`}`;
  }
  return `Assalam o Alaikum ${fields.patient}, this is a reminder of your appointment with ${fields.doctor} at ${fields.clinic} on ${fields.day} at ${fields.time}.${contact === '' ? '' : ` To change it, please call ${contact}.`}`;
}

export interface PrescriptionFields {
  patient: string;
  doctor: string;
  clinic: string;
  items: { medicine: string; dose: string | null; frequency: string | null; duration: string | null; instructions: string | null }[];
  advice: string | null;
  followUpOn: string | null;
}

const MAX_TEXT = 1_500;

export function prescriptionMessage(locale: Locale, fields: PrescriptionFields): string {
  const ur = locale === 'ur';
  const lines = [
    ur ? `${fields.clinic} — نسخہ برائے ${fields.patient}` : `${fields.clinic} - prescription for ${fields.patient}`,
    ur ? `ڈاکٹر: ${fields.doctor}` : `Doctor: ${fields.doctor}`,
    '',
  ];
  fields.items.forEach((item, index) => {
    const detail = [item.dose, item.frequency, item.duration, item.instructions].filter((part): part is string => part !== null && part !== '');
    lines.push(`${index + 1}. ${item.medicine}${detail.length === 0 ? '' : ` - ${detail.join(', ')}`}`);
  });
  if (fields.advice !== null && fields.advice !== '') lines.push('', ur ? `ہدایات: ${fields.advice}` : `Advice: ${fields.advice}`);
  if (fields.followUpOn !== null) lines.push('', ur ? `اگلی ملاقات: ${fields.followUpOn}` : `Follow-up: ${fields.followUpOn}`);
  const text = lines.join('\n');
  // A very long link may not open in every phone, so cut the text and say so.
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 20)}\n... (see printed copy)`;
}

export function paymentReminder(locale: Locale, fields: { patient: string; clinic: string; invoiceNo: number; due: number }): string {
  return locale === 'ur'
    ? `السلام علیکم ${fields.patient}، ${fields.clinic} کی طرف سے یاد دہانی: انوائس نمبر ${fields.invoiceNo} کی باقی رقم Rs ${fields.due} ہے۔ شکریہ۔`
    : `Assalam o Alaikum ${fields.patient}, a gentle reminder from ${fields.clinic}: Rs ${fields.due} is still due on invoice ${fields.invoiceNo}. Thank you.`;
}

/** The link opens WhatsApp with the text ready. A person still has to press send. */
export function whatsappUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
