import type { OrgStatus } from '../../api/types';
import { useT } from '../../i18n';
import { Badge, type Tone } from './index';

const LABEL: Record<OrgStatus, { label: string; tone: Tone }> = {
  provisioning: { label: 'Provisioning', tone: 'neutral' },
  setup_required: { label: 'Setup required', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  suspended: { label: 'Suspended', tone: 'danger' },
  deactivated: { label: 'Deactivated', tone: 'neutral' },
};

export function OrgStatusBadge({ status }: { status: string }) {
  const t = useT();
  const entry = LABEL[status as OrgStatus] ?? { label: status, tone: 'neutral' as const };
  return <Badge tone={entry.tone}>{t(entry.label)}</Badge>;
}
