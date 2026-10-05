// S2: minimal email sender. Dev-local only -- it logs the recipient and
// subject and nothing else. The verification and password-reset bodies carry
// single-use account-takeover tokens, and Workers logs ship to Logpush and are
// retained, so the message body must never reach a log sink.
//
// TODO(resend): swap the body for a real provider call. Keep this signature;
// every caller treats it as best-effort and never blocks auth on it.
export async function sendEmail(to: string, subject: string, _text: string): Promise<void> {
  console.log(`[email] queued to=${to} subject="${subject}"`);
}
