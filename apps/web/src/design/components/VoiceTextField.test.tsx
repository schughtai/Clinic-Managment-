import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../i18n';
import type { Recognition } from './useDictation';
import { VoiceTextField } from './VoiceTextField';

class FakeRecognition implements Recognition {
  static last: FakeRecognition | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: Recognition['onresult'] = null;
  onerror: Recognition['onerror'] = null;
  onend: Recognition['onend'] = null;
  started = false;
  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.onend?.();
  }
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  }
}

function Harness({ onSave }: { onSave?: (value: string) => void }) {
  const [value, setValue] = useState('Fever');
  return (
    <LocaleProvider>
      <VoiceTextField label="Address" value={value} onChange={setValue} />
      <output data-testid="value">{value}</output>
      {onSave !== undefined ? <button onClick={() => onSave(value)}>Save</button> : null}
    </LocaleProvider>
  );
}

afterEach(() => {
  delete (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  FakeRecognition.last = null;
});

describe('VoiceTextField', () => {
  it('explains when the browser has no speech recognition, and typing still works', async () => {
    render(<Harness />);
    expect(screen.getByText('Voice typing works in Chrome and Edge.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Speak/ })).toBeNull();
    await userEvent.type(screen.getByLabelText('Address'), ' and cough');
    expect(screen.getByTestId('value')).toHaveTextContent('Fever and cough');
  });

  it('adds finished speech to the field without saving, in the chosen language', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'ur-PK');
    await userEvent.click(screen.getByRole('button', { name: /Speak/ }));
    const engine = FakeRecognition.last!;
    expect(engine.started).toBe(true);
    expect(engine.lang).toBe('ur-PK');

    act(() => engine.say('since two', false));
    expect(screen.getByText('since two')).toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('Fever');

    act(() => engine.say('since two days', true));
    expect(screen.getByTestId('value')).toHaveTextContent('Fever since two days');
    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(screen.getByRole('button', { name: /Speak/ })).toBeInTheDocument();
  });

  it('shows a readable message when the microphone is blocked', async () => {
    (globalThis as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /Speak/ }));
    act(() => FakeRecognition.last!.onerror?.({ error: 'not-allowed' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Microphone access was blocked');
  });
});
