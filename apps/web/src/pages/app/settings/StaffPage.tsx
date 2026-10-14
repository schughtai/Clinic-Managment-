import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError, get, messageOf, post, put } from '../../../api/client';
import type { ShareLink } from '../../../api/types';
import { can, ME_KEY, useMe } from '../../../auth/session';
import { Alert, Badge, Button, Checkbox, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, PageHeader, Spinner, TextInput } from '../../../design/components';
import { ShareLinkPanel } from '../../../design/components/ShareLinkPanel';
import { useT } from '../../../i18n';
import type { Facility } from './FacilitiesPage';

interface Member {
  membershipId: string;
  personId: string;
  name: string;
  identifier: string;
  roles: Array<{ id: string; key: string; name: string }>;
  facilityScope: 'all' | 'selected';
  facilities: Array<{ id: string; name: string }>;
  status: 'active' | 'deactivated';
  lastLoginAt: string | null;
  isSelf: boolean;
}

interface PendingInvitation {
  id: string;
  inviteeName: string;
  identifier: string;
  roles: string[];
  facilityScope: 'all' | 'selected';
  expiresAt: string;
  expired: boolean;
}

export interface Role {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  requiresModule: string | null;
  assignable: boolean;
}

interface Access {
  roleIds: string[];
  facilityScope: 'all' | 'selected';
  facilityIds: string[];
}

type Action =
  | { kind: 'invite' }
  | { kind: 'access'; member: Member }
  | { kind: 'deactivate'; member: Member }
  | { kind: 'reset'; member: Member }
  | { kind: 'share'; title: string; share: ShareLink; type: 'invite' | 'reset' };

export function StaffPage() {
  const t = useT();
  const { slug = '' } = useParams();
  const me = useMe();
  const client = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const staff = useQuery({ queryKey: ['staff', slug], queryFn: () => get<{ members: Member[]; invitations: PendingInvitation[] }>(`/orgs/${slug}/staff`) });
  const roles = useQuery({ queryKey: ['roles', slug], queryFn: () => get<Role[]>(`/orgs/${slug}/roles`), enabled: can(me.data, 'role.read') });
  const facilities = useQuery({ queryKey: ['facilities', slug], queryFn: () => get<Facility[]>(`/orgs/${slug}/facilities`) });

  const refresh = () => Promise.all([client.invalidateQueries({ queryKey: ['staff', slug] }), client.invalidateQueries({ queryKey: ['dashboard', slug] })]);

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  if (staff.isPending) return <Spinner />;
  if (staff.isError) return <ErrorState message={messageOf(staff.error)} onRetry={() => void staff.refetch()} />;
  const canManage = can(me.data, 'staff.manage');
  const canInvite = can(me.data, 'staff.invite');
  const canReset = can(me.data, 'staff.reset_password');

  return (
    <>
      <PageHeader
        title={t('Staff')}
        subtitle={t('People who can sign in to this organization, and pending invitations.')}
        actions={
          canInvite ? (
            <Button variant="primary" icon="plus" onClick={() => setAction({ kind: 'invite' })}>
              {t('Invite staff')}
            </Button>
          ) : undefined
        }
      />
      <div className="stack">
        {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Roles')}</th>
                <th>{t('Branches')}</th>
                <th>{t('Status')}</th>
                <th>
                  <span className="visually-hidden">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.data.members.map((member) => (
                <tr key={member.membershipId}>
                  <td data-label={t('Name')}>
                    <strong>{member.name}</strong>
                    {member.isSelf ? <span className="small muted"> ({t('you')})</span> : null}
                    <div className="small muted">{member.identifier}</div>
                  </td>
                  <td data-label={t('Roles')}>{member.roles.map((role) => role.name).join(', ')}</td>
                  <td data-label={t('Branches')} className="small">
                    {member.facilityScope === 'all' ? t('All branches') : member.facilities.map((f) => f.name).join(', ') || t('None')}
                  </td>
                  <td data-label={t('Status')}>
                    <Badge tone={member.status === 'active' ? 'success' : 'neutral'}>{member.status === 'active' ? t('Active') : t('Deactivated')}</Badge>
                  </td>
                  <td>
                    <div className="row">
                      {canManage && member.status === 'active' ? (
                        <Button size="sm" onClick={() => setAction({ kind: 'access', member })}>
                          {t('Change access')}
                        </Button>
                      ) : null}
                      {canReset && member.status === 'active' && !member.isSelf ? (
                        <Button size="sm" onClick={() => setAction({ kind: 'reset', member })}>
                          {t('Reset password')}
                        </Button>
                      ) : null}
                      {canManage && member.status === 'active' && !member.isSelf ? (
                        <Button size="sm" variant="tertiary" onClick={() => setAction({ kind: 'deactivate', member })}>
                          {t('Deactivate')}
                        </Button>
                      ) : null}
                      {canManage && member.status === 'deactivated' ? (
                        <Button
                          size="sm"
                          loading={busy === member.membershipId}
                          onClick={() => void run(member.membershipId, () => post(`/orgs/${slug}/staff/${member.membershipId}/reactivate`))}
                        >
                          {t('Reactivate')}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="stack-sm" aria-labelledby="pending">
          <h2 id="pending">{t('Pending invitations')}</h2>
          {staff.data.invitations.length === 0 ? (
            <EmptyState title={t('No pending invitations')} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('Name')}</th>
                    <th>{t('Roles')}</th>
                    <th>{t('Expires')}</th>
                    <th>
                      <span className="visually-hidden">{t('Actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {staff.data.invitations.map((invitation) => (
                    <tr key={invitation.id}>
                      <td data-label={t('Name')}>
                        <strong>{invitation.inviteeName}</strong>
                        <div className="small muted">{invitation.identifier}</div>
                      </td>
                      <td data-label={t('Roles')}>{invitation.roles.join(', ')}</td>
                      <td data-label={t('Expires')} className="small">
                        {invitation.expired ? <Badge tone="warning">{t('Expired')}</Badge> : new Date(invitation.expiresAt).toLocaleString()}
                      </td>
                      <td>
                        {canInvite ? (
                          <div className="row">
                            <Button
                              size="sm"
                              loading={busy === `reissue-${invitation.id}`}
                              onClick={() =>
                                void run(`reissue-${invitation.id}`, async () => {
                                  const share = await post<ShareLink>(`/orgs/${slug}/invitations/${invitation.id}/reissue`);
                                  setAction({ kind: 'share', title: t('New invitation link'), share, type: 'invite' });
                                })
                              }
                            >
                              {t('New link')}
                            </Button>
                            <Button
                              size="sm"
                              variant="tertiary"
                              loading={busy === `revoke-${invitation.id}`}
                              onClick={() => void run(`revoke-${invitation.id}`, () => post(`/orgs/${slug}/invitations/${invitation.id}/revoke`))}
                            >
                              {t('Revoke')}
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {action?.kind === 'invite' || action?.kind === 'access' ? (
        <AccessDialog
          slug={slug}
          member={action.kind === 'access' ? action.member : null}
          roles={roles.data ?? []}
          facilities={(facilities.data ?? []).filter((f) => f.active)}
          onClose={() => setAction(null)}
          onShare={(share) => {
            setAction({ kind: 'share', title: t('Invitation link'), share, type: 'invite' });
            void refresh();
          }}
          onSaved={async () => {
            await refresh();
            await client.invalidateQueries({ queryKey: ME_KEY });
            setAction(null);
          }}
        />
      ) : null}
      {action?.kind === 'deactivate' ? (
        <ConfirmDialog
          title={t('Deactivate {name}?', { name: action.member.name })}
          message={t('They are signed out at once and cannot use this organization until reactivated. Their records are kept.')}
          confirmLabel={t('Deactivate')}
          destructive
          loading={busy === 'deactivate'}
          onClose={() => setAction(null)}
          onConfirm={() =>
            void run('deactivate', async () => {
              await post(`/orgs/${slug}/staff/${action.member.membershipId}/deactivate`);
              setAction(null);
            })
          }
        />
      ) : null}
      {action?.kind === 'reset' ? (
        <ConfirmDialog
          title={t('Reset password for {name}?', { name: action.member.name })}
          message={t('They are signed out everywhere. You get a one-time link, valid for 24 hours, to send them.')}
          confirmLabel={t('Create reset link')}
          loading={busy === 'reset'}
          onClose={() => setAction(null)}
          onConfirm={() =>
            void run('reset', async () => {
              const share = await post<ShareLink>(`/orgs/${slug}/staff/${action.member.membershipId}/reset-password`);
              setAction({ kind: 'share', title: t('Password reset link'), share, type: 'reset' });
            })
          }
        />
      ) : null}
      {action?.kind === 'share' ? (
        <Dialog
          title={action.title}
          onClose={() => setAction(null)}
          actions={
            <Button variant="primary" onClick={() => setAction(null)}>
              {t('Done')}
            </Button>
          }
        >
          <ShareLinkPanel share={action.share} kind={action.type} />
        </Dialog>
      ) : null}
    </>
  );
}

function AccessDialog({
  slug,
  member,
  roles,
  facilities,
  onClose,
  onShare,
  onSaved,
}: {
  slug: string;
  member: Member | null;
  roles: Role[];
  facilities: Facility[];
  onClose: () => void;
  onShare: (share: ShareLink) => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [access, setAccess] = useState<Access>({
    roleIds: member?.roles.map((role) => role.id) ?? [],
    facilityScope: member?.facilityScope ?? 'all',
    facilityIds: member?.facilities.map((f) => f.id) ?? [],
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      if (member === null) {
        const contactField = contact.includes('@') ? { email: contact } : { phone: contact };
        onShare(await post<ShareLink>(`/orgs/${slug}/invitations`, { inviteeName: name, ...contactField, ...access }));
      } else {
        await put(`/orgs/${slug}/staff/${member.membershipId}`, access);
        await onSaved();
      }
    } catch (caught) {
      if (caught instanceof ApiError) setErrors(caught.fieldErrors());
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const valid = access.roleIds.length > 0 && (access.facilityScope === 'all' || access.facilityIds.length > 0) && (member !== null || (name.trim() !== '' && contact.trim() !== ''));

  return (
    <Dialog
      drawer
      title={member === null ? t('Invite staff') : t('Change access for {name}', { name: member.name })}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button type="submit" form="access-form" variant="primary" loading={busy} disabled={!valid}>
            {member === null ? t('Create invitation') : t('Save')}
          </Button>
        </>
      }
    >
      {error !== null ? <Alert tone="danger">{t(error)}</Alert> : null}
      <form id="access-form" className="stack" onSubmit={(event) => void submit(event)} noValidate>
        {member === null ? (
          <>
            <Field label={t('Name')} required error={errors.inviteeName}>
              {(props) => <TextInput {...props} value={name} onChange={(event) => setName(event.target.value)} />}
            </Field>
            <Field label={t('Phone number or email')} required error={errors.phone ?? errors.email} hint={t('Used to sign in and to send the WhatsApp message.')}>
              {(props) => <TextInput {...props} value={contact} onChange={(event) => setContact(event.target.value)} />}
            </Field>
          </>
        ) : null}
        <fieldset className="stack-sm">
          <legend>{t('Roles')}</legend>
          {roles.map((role) => (
            <div key={role.id}>
              <Checkbox
                label={role.name}
                checked={access.roleIds.includes(role.id)}
                disabled={!role.assignable && !access.roleIds.includes(role.id)}
                onChange={() => setAccess({ ...access, roleIds: toggle(access.roleIds, role.id) })}
              />
              {!role.assignable ? (
                <div className="small muted" style={{ paddingInlineStart: 26 }}>
                  {role.requiresModule !== null ? t('Needs the {module} module, which is switched off.', { module: role.requiresModule }) : t('You cannot give this role.')}
                </div>
              ) : null}
            </div>
          ))}
        </fieldset>
        <fieldset className="stack-sm">
          <legend>{t('Branch access')}</legend>
          <label className="checkbox">
            <input type="radio" name="scope" checked={access.facilityScope === 'all'} onChange={() => setAccess({ ...access, facilityScope: 'all' })} />
            {t('All branches, including new ones')}
          </label>
          <label className="checkbox">
            <input type="radio" name="scope" checked={access.facilityScope === 'selected'} onChange={() => setAccess({ ...access, facilityScope: 'selected' })} />
            {t('Only these branches')}
          </label>
          {access.facilityScope === 'selected' ? (
            <div className="stack-sm" style={{ paddingInlineStart: 26 }}>
              {facilities.map((facility) => (
                <Checkbox
                  key={facility.id}
                  label={facility.name}
                  checked={access.facilityIds.includes(facility.id)}
                  onChange={() => setAccess({ ...access, facilityIds: toggle(access.facilityIds, facility.id) })}
                />
              ))}
            </div>
          ) : null}
        </fieldset>
      </form>
    </Dialog>
  );
}
