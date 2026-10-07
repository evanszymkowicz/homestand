// S2 email sender: Gmail SMTP via @workermailer/smtp. The verification and
// password-reset bodies carry single-use account-takeover tokens, so the body
// must never be logged (Workers logs ship to Logpush and are retained).
//
// GMAIL_USER / GMAIL_APP_PASSWORD are secrets (`wrangler secret put`, or
// .env locally). Unset → log recipient+subject only and send nothing, so
// local dev and tests work with no credentials.
import { WorkerMailer } from "@workermailer/smtp";

export async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  const user = env.GMAIL_USER;
  const password = env.GMAIL_APP_PASSWORD;
  if (!user || !password) {
    console.log(`[email] skipped to=${to} subject="${subject}" (GMAIL_USER/GMAIL_APP_PASSWORD unset)`);
    return;
  }
  await WorkerMailer.send(
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      authType: "plain",
      credentials: { username: user, password },
    },
    { from: `Homestand <${user}>`, to, subject, text },
  );
}
