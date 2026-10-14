import { describe, expect, it } from 'vitest';
import { assertTransition, canTransition, TransitionError } from './transitions';

describe('appointment transitions', () => {
  it('allows the normal visit path', () => {
    expect(canTransition('booked', 'confirmed')).toBe(true);
    expect(canTransition('confirmed', 'checked_in')).toBe(true);
    expect(canTransition('checked_in', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'completed')).toBe(true);
  });

  it('refuses skipping steps and leaving a final state', () => {
    expect(() => assertTransition('booked', 'completed')).toThrow(TransitionError);
    expect(() => assertTransition('completed', 'booked')).toThrow(TransitionError);
    expect(() => assertTransition('cancelled', 'booked')).toThrow(TransitionError);
    expect(() => assertTransition('no_show', 'checked_in')).toThrow(TransitionError);
  });
});
