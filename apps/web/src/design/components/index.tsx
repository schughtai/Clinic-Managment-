import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useEffect,
  useId,
  useRef,
} from 'react';
import { useT } from '../../i18n';
import { Icon, type IconName } from './Icon';

export { Icon, type IconName } from './Icon';

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export function Button({
  variant = 'secondary',
  size,
  block,
  loading,
  icon,
  children,
  disabled,
  type = 'button',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm';
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
}) {
  const classes = ['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', block === true ? 'btn-block' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    // Disabled while loading so a double click cannot submit twice.
    <button type={type} className={classes} disabled={disabled === true || loading === true} aria-busy={loading === true} {...rest}>
      {loading === true ? <span className="spinner" style={{ inlineSize: 16, blockSize: 16, borderWidth: 2 }} aria-hidden /> : null}
      {loading !== true && icon !== undefined ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Field and inputs

export function Field({
  label,
  hint,
  error,
  required,
  children,
  id,
}: {
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  /** Receives the input id and the ids that describe it. */
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }) => ReactNode;
  id?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint !== undefined ? hintId : null, error !== undefined ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={inputId}>
        {label}
        {required === true ? (
          <span className="required" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children({
        id: inputId,
        ...(describedBy !== '' ? { 'aria-describedby': describedBy } : {}),
        ...(error !== undefined ? { 'aria-invalid': true } : {}),
        ...(required === true ? { required: true } : {}),
      })}
      {hint !== undefined ? (
        <span id={hintId} className="hint">
          {hint}
        </span>
      ) : null}
      {error !== undefined ? (
        <span id={errorId} className="error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select({ options, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { options: ReadonlyArray<{ value: string; label: string }> }) {
  return (
    <select className="select" {...props}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- Badge and Alert

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
const TONE_ICON: Record<Tone, IconName> = { neutral: 'dot', success: 'check', warning: 'alert', danger: 'alert', info: 'info' };

/** Status is always text plus an icon, never colour alone. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      <Icon name={TONE_ICON[tone]} size={12} />
      {children}
    </span>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: Exclude<Tone, 'neutral'>; title?: string; children?: ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon name={TONE_ICON[tone]} />
      <div className="stack-sm">
        {title !== undefined ? <strong>{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Dialog and Drawer

export function Dialog({
  title,
  children,
  onClose,
  actions,
  drawer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  drawer?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first ?? ref.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className={`overlay${drawer === true ? ' drawer' : ''}`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1}>
        <div className="row">
          <h2 id={titleId} className="spacer">
            {title}
          </h2>
          <CloseButton onClose={onClose} />
        </div>
        {children}
        {actions !== undefined ? <div className="dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <button type="button" className="btn btn-tertiary btn-sm" onClick={onClose} aria-label={t('Close')} data-close>
      <Icon name="x" />
    </button>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  destructive,
  loading,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button variant={destructive === true ? 'destructive' : 'primary'} loading={loading ?? false} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
      {children}
    </Dialog>
  );
}

// ---------------------------------------------------------------- Page header and states

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="titles">
        <h1>{title}</h1>
        {subtitle !== undefined ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span className="visually-hidden">{label ?? t('Loading')}</span>
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <Icon name="inbox" size={32} />
      <h2>{title}</h2>
      {message !== undefined ? <p>{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div className="state" role="alert">
      <Icon name="alert" size={32} />
      <h2>{t('Something went wrong. Please try again.')}</h2>
      {message !== undefined ? <p>{message}</p> : null}
      {onRetry !== undefined ? <Button onClick={onRetry}>{t('Try again')}</Button> : null}
    </div>
  );
}

export function AccessDenied() {
  const t = useT();
  return (
    <div className="state" role="alert">
      <Icon name="lock" size={32} />
      <h2>{t('Access denied')}</h2>
      <p>{t('You do not have permission to see this page.')}</p>
    </div>
  );
}
