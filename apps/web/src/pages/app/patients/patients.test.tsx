import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, get, post } from '../../../api/client';
import type { Me } from '../../../api/types';
import { ME_KEY } from '../../../auth/session';
import { LocaleProvider } from '../../../i18n';
import { NewPatientPage } from './NewPatientPage';
import { PatientPage } from './PatientPage';

vi.mock('../../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../api/client')>();
  return { ...actual, get: vi.fn(), post: vi.fn() };
});

const ADMIN = ['patients.read', 'patients.create', 'patients.update', 'history.read_summary', 'history.write'];
const FINANCE = ['dashboard.read', 'invoices.read', 'invoices.manage', 'patients.read'];

function me(permissions: string[]): Me {
  return {
    person: { id: 'p', displayName: 'Bilal', language: 'en', mfaEnabled: false },
    isPlatformAdmin: false,
    authLevel: 'password',
    memberships: [],
    context: { orgSlug: 'shifa', facilityId: null },
    permissions,
    modules: [],
    org: { slug: 'shifa', name: 'Shifa', status: 'active', defaultLanguage: 'en' },
  };
}

function renderAt(path: string, route: string, element: ReactElement, permissions: string[]) {
  // The session is set up front, so it must not be refetched through the mocked API.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(ME_KEY, me(permissions));
  const router = createMemoryRouter([{ path: route, element }], { initialEntries: [path] });
  render(
    <LocaleProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LocaleProvider>,
  );
}

const PATIENT = {
  id: '11111111-1111-4111-8111-111111111111',
  patientNumber: 'P-000001',
  nameEn: 'Hira Anwar',
  nameUr: null,
  sex: 'female',
  dateOfBirth: null,
  approximateAge: 30,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  createdAt: '2026-10-14T00:00:00.000Z',
  phones: [{ phone: '923001234567', label: 'mobile' }],
};

beforeEach(() => {
  vi.mocked(get).mockReset();
  vi.mocked(post).mockReset();
});

describe('new patient screen', () => {
  it('shows a likely duplicate and keeps saving blocked until the receptionist confirms', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValueOnce(
      new ApiError(409, 'possible_duplicates', 'A patient with a similar name or phone number already exists.', {
        duplicates: [{ id: PATIENT.id, patientNumber: 'P-000001', name: 'Hira Anwar', reason: 'phone' }],
      }),
    );
    renderAt('/app/shifa/patients/new', '/app/:slug/patients/new', <NewPatientPage />, ADMIN);

    await user.type(screen.getByLabelText('Name (English)'), 'Hira Anwar');
    await user.click(screen.getByRole('button', { name: 'Save patient' }));

    expect(await screen.findByText('Check for an existing patient first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /P-000001/ })).toHaveAttribute('href', `/app/shifa/patients/${PATIENT.id}`);
    expect(screen.getByRole('button', { name: 'Save patient' })).toBeDisabled();

    await user.click(screen.getByLabelText('This is a different person. Save as a new patient.'));
    expect(screen.getByRole('button', { name: 'Save patient' })).toBeEnabled();
  });
});

describe('patient record', () => {
  it('shows medical history to a clinician-capable role', async () => {
    vi.mocked(get).mockImplementation(async (path: string) => {
      if (path.endsWith('/history')) {
        return [
          {
            section: 'allergy',
            state: 'has_entries',
            entries: [{ id: 'e1', section: 'allergy', content: { substance: 'Penicillin', severity: 'severe' }, source: 'clinician_recorded', status: 'active', recordedAt: '2026-10-14T00:00:00.000Z', supersedesId: null }],
          },
          { section: 'condition', state: 'not_assessed', entries: [] },
          { section: 'surgery', state: 'not_assessed', entries: [] },
          { section: 'medication', state: 'not_assessed', entries: [] },
          { section: 'family', state: 'not_assessed', entries: [] },
        ];
      }
      return PATIENT;
    });
    renderAt(`/app/shifa/patients/${PATIENT.id}`, '/app/:slug/patients/:id', <PatientPage />, ADMIN);

    expect(await screen.findByRole('heading', { name: 'Medical history' })).toBeInTheDocument();
    // Once in the allergy banner at the top, once in the Allergies card.
    expect(screen.getAllByText('Penicillin · Severe')).toHaveLength(2);
    expect(screen.getAllByText('Not yet asked').length).toBeGreaterThan(0);
  });

  it('hides medical history from finance, who see identifiers only', async () => {
    vi.mocked(get).mockImplementation(async (path: string) => {
      if (path.endsWith('/history')) throw new Error('finance must not request history');
      return PATIENT;
    });
    renderAt(`/app/shifa/patients/${PATIENT.id}`, '/app/:slug/patients/:id', <PatientPage />, FINANCE);

    expect(await screen.findByText('Hira Anwar')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Medical history' })).not.toBeInTheDocument();
    expect(screen.getByText('Medical history is not shown for your role.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringMatching(/\/history$/));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  });
});
