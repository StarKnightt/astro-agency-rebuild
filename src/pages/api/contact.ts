import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { CONTACT_FROM_EMAIL, CONTACT_TO_EMAIL, RESEND_API_KEY } from 'astro:env/server';
import { BUDGETS, HONEYPOT_FIELD, LIMITS, PROJECT_TYPES, type ContactResponse } from '../../lib/contact';
import { sendEnquiry } from '../../lib/resend';
import { site } from '../../data/site';

export const prerender = false;

const MAX_BODY_BYTES = 16_000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .transform((value) => value || undefined)
    .optional();

const enquirySchema = z.object({
  name: z
    .string({ error: 'Please tell us your name.' })
    .trim()
    .min(LIMITS.name.min, 'Please tell us your name.')
    .max(LIMITS.name.max, `Please keep your name under ${LIMITS.name.max} characters.`),
  email: z
    .string({ error: 'Please enter your email so we can reply.' })
    .trim()
    .max(LIMITS.email.max, 'That email address is too long.')
    .pipe(z.email('Please enter a valid email address, like name@example.com.')),
  projectType: z.enum(PROJECT_TYPES, { error: 'Please choose a project type.' }),
  budget: z.enum(BUDGETS).optional(),
  location: optionalText(LIMITS.location.max),
  message: z
    .string({ error: 'Please tell us a little about the project.' })
    .trim()
    .min(LIMITS.message.min, `Please write at least ${LIMITS.message.min} characters.`)
    .max(LIMITS.message.max, `Please keep the message under ${LIMITS.message.max} characters.`),
});

const FIELDS = ['name', 'email', 'projectType', 'budget', 'location', 'message'] as const;

const log = (event: string, details: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ event, ...details }));

const maskEmail = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

export const POST: APIRoute = async ({ request, redirect }) => {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');

  const reply = (status: number, body: ContactResponse, fallbackPath: string) =>
    wantsJson
      ? new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        })
      : redirect(fallbackPath, 303);

  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: 'That message is too long to send through the form.' }, '/contact#form-invalid');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return reply(400, { ok: false, error: 'We could not read the form. Please try again.' }, '/contact#form-invalid');
  }

  const mode = RESEND_API_KEY ? 'sent' : 'demo';

  if (String(form.get(HONEYPOT_FIELD) ?? '') !== '') {
    log('contact.honeypot');
    return reply(200, { ok: true, mode }, '/contact/thanks');
  }

  const raw = Object.fromEntries(
    FIELDS.map((field) => {
      const value = form.get(field);
      return [field, typeof value === 'string' ? value : undefined];
    }),
  );
  const parsed = enquirySchema.safeParse(raw);

  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? 'form');
      fields[key] ??= issue.message;
    }
    log('contact.invalid', { fields: Object.keys(fields) });
    return reply(400, { ok: false, error: 'Please fix the highlighted fields and try again.', fields }, '/contact#form-invalid');
  }

  const enquiry = parsed.data;

  if (!RESEND_API_KEY) {
    log('contact.demo', {
      from: maskEmail(enquiry.email),
      projectType: enquiry.projectType,
      messageLength: enquiry.message.length,
    });
    return reply(200, { ok: true, mode: 'demo' }, '/contact/thanks');
  }

  if (!CONTACT_TO_EMAIL) {
    log('contact.misconfigured', { missing: 'CONTACT_TO_EMAIL' });
    return reply(500, { ok: false, error: `The form is not set up yet. Please email ${site.email}.` }, '/contact#form-failed');
  }

  try {
    const result = await sendEnquiry({
      apiKey: RESEND_API_KEY,
      from: CONTACT_FROM_EMAIL ?? 'Lysning website <onboarding@resend.dev>',
      to: CONTACT_TO_EMAIL,
      enquiry,
    });

    if (!result.ok) {
      log('contact.send_failed', { status: result.status });
      return reply(
        502,
        { ok: false, error: `We could not send your message just now. Please try again in a minute, or email ${site.email}.` },
        '/contact#form-failed',
      );
    }

    log('contact.sent', { id: result.id, projectType: enquiry.projectType });
    return reply(200, { ok: true, mode: 'sent' }, '/contact/thanks');
  } catch (error) {
    log('contact.send_error', { message: error instanceof Error ? error.message : String(error) });
    return reply(
      502,
      { ok: false, error: `We could not send your message just now. Please try again in a minute, or email ${site.email}.` },
      '/contact#form-failed',
    );
  }
};

export const ALL: APIRoute = () =>
  new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
