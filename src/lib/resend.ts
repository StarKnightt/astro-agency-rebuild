export interface Enquiry {
  name: string;
  email: string;
  projectType: string;
  budget?: string;
  location?: string;
  message: string;
}

interface SendOptions {
  apiKey: string;
  from: string;
  to: string;
  enquiry: Enquiry;
}

type SendResult = { ok: true; id: string } | { ok: false; status: number };

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

async function sha256(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sendEnquiry({ apiKey, from, to, enquiry }: SendOptions): Promise<SendResult> {
  const rows: [string, string | undefined][] = [
    ['Name', enquiry.name],
    ['Email', enquiry.email],
    ['Project type', enquiry.projectType],
    ['Budget', enquiry.budget],
    ['Site location', enquiry.location],
  ];
  const filled = rows.filter((row): row is [string, string] => Boolean(row[1]));

  const text = [...filled.map(([label, value]) => `${label}: ${value}`), '', enquiry.message].join('\n');
  const html = `
    <h2 style="font-family:sans-serif">New enquiry from the website</h2>
    <table style="font-family:sans-serif;border-collapse:collapse">
      ${filled.map(([label, value]) => `<tr><td style="padding:4px 16px 4px 0;color:#555">${label}</td><td style="padding:4px 0">${escapeHtml(value)}</td></tr>`).join('')}
    </table>
    <p style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(enquiry.message)}</p>`;

  const subject = `New enquiry: ${enquiry.projectType} from ${enquiry.name}`.replace(/[\r\n]+/g, ' ');
  const idempotencyKey = `contact-${(await sha256(`${enquiry.email}\n${enquiry.message}`)).slice(0, 48)}`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: to.split(',').map((address) => address.trim()),
      reply_to: enquiry.email,
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return { ok: false, status: response.status };
  const body = (await response.json()) as { id?: string };
  return { ok: true, id: body.id ?? '' };
}
