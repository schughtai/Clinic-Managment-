/** An expected failure with a stable code that clients can rely on. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in again.'): AppError =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this.'): AppError =>
  new AppError(403, 'forbidden', message);
export const notFound = (what: string): AppError => new AppError(404, 'not_found', `${what} was not found.`);
export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);

/** Stable error codes added by v2 (see specs/001-platform-tenant-foundation/contracts/api.md). */
export const mfaRequired = (): AppError => new AppError(403, 'mfa_required', 'Enter the code from your authenticator app to continue.');
export const mfaInvalid = (): AppError => new AppError(400, 'mfa_invalid', 'That code is not right. Check your authenticator app and try again.');
export const accountLocked = (): AppError =>
  new AppError(423, 'account_locked', 'Too many wrong attempts. Wait 15 minutes, or ask an administrator to reset your password.');
export const invitationInvalid = (): AppError =>
  new AppError(410, 'invitation_invalid', 'This invitation link has expired or was already used. Ask for a new one.');
export const resetInvalid = (): AppError =>
  new AppError(410, 'reset_invalid', 'This reset link has expired or was already used. Ask an administrator for a new one.');
export const organizationSuspended = (): AppError =>
  new AppError(403, 'organization_suspended', 'This organization is suspended. Contact the platform administrator.');
export const permissionEscalation = (): AppError =>
  new AppError(403, 'permission_escalation', 'You cannot give someone permissions you do not have yourself.');
export const lastAdmin = (): AppError =>
  new AppError(409, 'last_admin', 'The organization must keep at least one active administrator.');
export const moduleDisabled = (): AppError =>
  new AppError(409, 'module_disabled', 'This role needs a module that is switched off for the organization.');
export const contextRequired = (): AppError =>
  new AppError(409, 'context_required', 'Choose an organization and branch to continue.');
