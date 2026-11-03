/**
 * Maps an axios error from a sign-in request to a message the operator can act on. Pure (no imports) so it
 * is unit-tested. When the server cannot be reached at all the renderer cannot tell DNS from TLS from a
 * refused connection; the desktop main process does that (see electron/config.cjs classifyNetworkError).
 */
export const API_NOT_CONFIGURED = 'API_NOT_CONFIGURED';

export type LoginErrorKind = 'not_configured' | 'unreachable' | 'timeout' | 'invalid_credentials' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'wrong_path' | 'server_error' | 'unknown';

export interface DescribedError {
  kind: LoginErrorKind;
  message: string;
}

export const describeLoginError = (err: any): DescribedError => {
  if (err?.code === API_NOT_CONFIGURED) {
    return { kind: 'not_configured', message: 'No server address is set. Open Server settings and enter the Food Court server address.' };
  }
  const res = err?.response;
  if (!res) {
    if (err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message))) {
      return { kind: 'timeout', message: 'The server did not respond in time. Check the server address and your network, then try again.' };
    }
    return { kind: 'unreachable', message: 'Cannot reach the server. Check the server address in Server settings and your network connection.' };
  }
  const status: number = res.status;
  const data = res.data;
  const serverMessage: string | undefined = typeof data?.message === 'string' ? data.message : undefined;
  if (status === 422) {
    const first = data?.errors?.email?.[0] ?? data?.errors?.password?.[0] ?? serverMessage;
    const credentialsRejected = typeof first === 'string' && /credentials/i.test(first);
    return {
      kind: 'invalid_credentials',
      message: credentialsRejected || !first ? 'Invalid email or password.' : first,
    };
  }
  if (status === 401) return { kind: 'unauthorized', message: 'Unauthorized: the server did not accept this sign-in. Check your email and password.' };
  if (status === 403) return { kind: 'forbidden', message: serverMessage || 'Access denied for this account.' };
  if (status === 429) return { kind: 'rate_limited', message: 'Too many sign-in attempts. Wait a minute and try again.' };
  if (status === 404) return { kind: 'wrong_path', message: 'The server answered but this is not the Food Court API (404). Check that the server address ends in /api.' };
  if (status >= 500) return { kind: 'server_error', message: `The server reported an internal error (HTTP ${status}). Try again; if it persists, contact the administrator.` };
  return { kind: 'unknown', message: serverMessage || `Sign-in failed (HTTP ${status}).` };
};
