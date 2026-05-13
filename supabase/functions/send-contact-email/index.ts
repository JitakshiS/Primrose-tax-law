// Supabase Edge Function: send-contact-email
// Triggered by database webhook on INSERT to public.contacts
// Sends an email via Resend to hello@primrosetax.ca

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const TO_EMAIL = 'hello@primrosetax.ca';
const FROM_EMAIL = 'Primrose Tax Law <onboarding@resend.dev>';

interface ContactRow {
  id?: string | number;
  name: string;
  email: string;
  subject?: string | null;
  message?: string | null;
  created_at?: string;
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: ContactRow;
  schema: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildEmailHtml = (row: ContactRow): string => `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1C1C1C; max-width: 600px; margin: 0 auto; padding: 24px;">
  <div style="background: #1C1C1C; color: #F5F0EB; padding: 24px 32px; border-radius: 12px 12px 0 0;">
    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; color: #7C9A8E; margin-bottom: 8px;">New Inquiry</div>
    <div style="font-size: 20px; font-weight: 700;">Primrose Tax Law</div>
  </div>
  <div style="background: #FAFAF8; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid rgba(0,0,0,0.06); border-top: none;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(0,0,0,0.45); width: 90px;">From</td>
        <td style="padding: 8px 0; font-size: 15px; color: #1C1C1C; font-weight: 500;">${escapeHtml(row.name || '—')}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(0,0,0,0.45);">Email</td>
        <td style="padding: 8px 0; font-size: 15px; color: #1C1C1C;"><a href="mailto:${escapeHtml(row.email || '')}" style="color: #4A6B5D; text-decoration: none;">${escapeHtml(row.email || '—')}</a></td>
      </tr>
      ${row.subject ? `<tr>
        <td style="padding: 8px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(0,0,0,0.45);">Source</td>
        <td style="padding: 8px 0; font-size: 14px; color: rgba(0,0,0,0.6);">${escapeHtml(row.subject)}</td>
      </tr>` : ''}
    </table>
    <div style="margin-top: 24px; padding-top: 24px; border-top: 1px solid rgba(0,0,0,0.08);">
      <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(0,0,0,0.45); margin-bottom: 12px;">Message</div>
      <div style="font-size: 15px; line-height: 1.6; color: #1C1C1C; white-space: pre-wrap;">${escapeHtml(row.message || '(no message)')}</div>
    </div>
    <div style="margin-top: 32px; font-size: 11px; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.08em;">Sent ${row.created_at ? new Date(row.created_at).toLocaleString('en-CA', { timeZone: 'America/Halifax' }) : 'just now'} · Atlantic</div>
  </div>
</body>
</html>`;

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== 'INSERT' || payload.table !== 'contacts') {
      return new Response(JSON.stringify({ skipped: true, reason: 'not an insert on contacts' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const row = payload.record;
    const subject = row.subject && row.subject.trim().length > 0
      ? `New inquiry: ${row.subject}`
      : `New inquiry from ${row.name}`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: row.email,
        subject,
        html: buildEmailHtml(row),
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', resendRes.status, errText);
      return new Response(JSON.stringify({ ok: false, error: errText }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await resendRes.json();
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Function error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
