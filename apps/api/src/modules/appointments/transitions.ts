/** Appointment statuses and the moves allowed between them (v2 §7). Pure, so it is unit-tested. */

export const APPOINTMENT_STATUSES = ['booked', 'confirmed', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Statuses that hold the practitioner's time (matches the database exclusion constraint). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['booked', 'confirmed', 'checked_in', 'in_progress'];

const ALLOWED: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ['confirmed', 'checked_in', 'cancelled', 'no_show'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!canTransition(from, to)) {
    throw new TransitionError(`A ${from.replace('_', ' ')} appointment cannot become ${to.replace('_', ' ')}.`);
  }
}

export class TransitionError extends Error {}
