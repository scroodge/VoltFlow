import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

const FROM = "VoltFlow <noreply@voltflow.app>";

const SUBJECT = "Your VoltFlow account will be deleted due to inactivity";

const TEXT = `Hi,

Your VoltFlow account has not been used for 30 days. If you do not log in within the next 30 days, your account and all associated data will be permanently deleted.

To keep your account, simply log in at:
https://volt-flow-beige.vercel.app/login

If you no longer need the service, no action is needed — your data will be automatically removed after 60 days of inactivity.

If you have any questions, reply to this email.

— VoltFlow team`;

export async function sendInactivityWarning(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: email,
      subject: SUBJECT,
      text: TEXT,
    });
    if (result.error) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { ok: false, error: message };
  }
}
