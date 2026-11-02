// Transactional email. With RESEND_API_KEY it sends through Resend; without it
// (local development) it prints to the server console.
const env = (k: string) => (import.meta.env[k] as string | undefined) ?? process.env[k];

export const mailConfigured = () => !!env('RESEND_API_KEY');

export async function sendMail(to: string, subject: string, text: string) {
  const key = env('RESEND_API_KEY');
  if (!key) {
    console.info(`\n[correo de desarrollo] Para: ${to}\nAsunto: ${subject}\n${text}\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM') ?? 'Primor <no-reply@primor.cl>', to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`No se pudo enviar el correo (${res.status}).`);
}

/** Codes are shown on screen only in local development, never in production. */
export const showDevCodes = () => !import.meta.env.PROD && !mailConfigured() && env('DEV_SHOW_CODES') !== 'false';
