/**
 * Maps an axios error from a sign-in request to a message the operator can act on. Pure (no imports) so it
 * is unit-tested. When the server cannot be reached at all the renderer cannot tell DNS from TLS from a
 * refused connection; the desktop main process does that (see electron/config.cjs classifyNetworkError).
 */
export const API_NOT_CONFIGURED = 'API_NOT_CONFIGURED';

export type LoginErrorKind = 'not_configured' | 'unreachable' | 'timeout' | 'invalid_credentials' | 'unauthorized' | 'forbidden' | 'rate_limited' | 'wrong_path' | 'server_error' | 'setup_required' | 'owner_missing' | 'device_not_paired' | 'unknown';

export interface DescribedError {
  kind: LoginErrorKind;
  message: string;
}

export const describeLoginError = (err: any): DescribedError => {
  if (err?.code === API_NOT_CONFIGURED) {
    return { kind: 'not_configured', message: 'The application is still starting. Wait a moment and try again.' };
  }
  const res = err?.response;
  if (!res) {
    if (err?.code === 'ECONNABORTED' || /timeout/i.test(String(err?.message))) {
      return { kind: 'timeout', message: 'The food court services did not respond in time. Try again in a moment.' };
    }
    return { kind: 'unreachable', message: 'Cannot reach the food court services. Check the network connection, or close and reopen the application.' };
  }
  const status: number = res.status;
  const data = res.data;
  const serverMessage: string | undefined = typeof data?.message === 'string' ? data.message : undefined;
  // Distinct, actionable situations the server names explicitly (it never says whether an email exists)
  if (data?.code === 'setup_required') return { kind: 'setup_required', message: serverMessage || 'This Food Court has not been set up yet.' };
  if (data?.code === 'owner_missing') return { kind: 'owner_missing', message: serverMessage || 'No accounts exist. Restore the owner account with your recovery key.' };
  if (data?.code === 'device_not_paired') return { kind: 'device_not_paired', message: serverMessage || 'This computer is not connected to the food court.' };
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
  if (status === 404) return { kind: 'wrong_path', message: 'The food court services did not recognise this request. Close and reopen the application, or contact your administrator.' };
  if (status >= 500) return { kind: 'server_error', message: 'The food court services reported a problem. Try again; if it persists, contact your administrator.' };
  return { kind: 'unknown', message: serverMessage || `Sign-in failed (HTTP ${status}).` };
};
