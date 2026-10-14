import { useState } from 'react';
import type { ShareLink } from '../../api/types';
import { useT } from '../../i18n';
import { Alert, Button } from './index';

/**
 * Shows a one-time invitation or reset link once. Nothing is sent automatically: the person copies
 * it or opens WhatsApp with the message ready and presses send themselves.
 */
export function ShareLinkPanel({ share, kind }: { share: ShareLink; kind: 'invite' | 'reset' }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share.link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="stack-sm">
      <Alert tone="warning" title={t('Shown only once')}>
        {kind === 'invite'
          ? t('Send this link only to the person you invited. It works once and expires on {date}.', { date: new Date(share.expiresAt).toLocaleString() })
          : t('Send this link only to this person. It works once and expires on {date}.', { date: new Date(share.expiresAt).toLocaleString() })}
      </Alert>
      <p className="code-box" aria-label={t(kind === 'invite' ? 'Invitation link' : 'Reset link')}>
        {share.link}
      </p>
      <div className="row">
        <Button icon="copy" onClick={() => void copy()}>
          {copied ? t('Copied') : t('Copy')}
        </Button>
        <a className="btn btn-primary" href={share.whatsappUrl} target="_blank" rel="noreferrer noopener">
          {t('Send by WhatsApp')}
        </a>
      </div>
    </div>
  );
}
