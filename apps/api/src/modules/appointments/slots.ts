/** Pure helpers for turning a doctor's weekly sessions into bookable times. Times are local HH:MM strings. */

export interface Session {
  start: string;
  end: string;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function toTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Slot start times for the given sessions. A slot is only offered if it ends within its session. */
export function sessionSlots(sessions: readonly Session[], slotMinutes: number): string[] {
  const times: string[] = [];
  for (const session of sessions) {
    const end = toMinutes(session.end);
    for (let start = toMinutes(session.start); start + slotMinutes <= end; start += slotMinutes) {
      times.push(toTime(start));
    }
  }
  return times;
}

/** Day of week for a calendar date, where 0 is Sunday. Dates carry no time zone, so UTC is safe here. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type AppointmentStatus = 'booked' | 'arrived' | 'in_consult' | 'done' | 'cancelled' | 'no_show';

export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['booked', 'arrived', 'in_consult'];

const TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  booked: ['arrived', 'cancelled', 'no_show'],
  arrived: ['in_consult', 'cancelled'],
  in_consult: ['done'],
  done: [],
  cancelled: [],
  no_show: [],
};

/** Reception can mark arrival and cancellations. Only doctors and owners start or finish a consultation. */
const RECEPTIONIST_TARGETS: readonly AppointmentStatus[] = ['arrived', 'cancelled', 'no_show'];

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function roleMayMarkStatus(role: 'owner' | 'doctor' | 'receptionist', to: AppointmentStatus): boolean {
  return role === 'receptionist' ? RECEPTIONIST_TARGETS.includes(to) : true;
}
