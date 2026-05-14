// Vercel Serverless Function: /api/contact
// Receives form POSTs, saves to Firestore, emails Primrose via Resend.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// ----- Firebase Admin (lazy init, singleton across cold starts) -----
function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.project_id,
        clientEmail: process.env.firebase_client_email,
        // Vercel stores the private key as-is with literal \n;
        // convert them back to real newlines for the SDK.
        privateKey: process.env.private_key?.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

// ----- Helpers -----
const CLIENT_EMAIL = process.env.CLIENT_EMAIL;
const FROM_EMAIL = 'Primrose Tax Law <onboarding@resend.dev>';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function buildEmailHtml({ name, email, subject, message, source }) {
  const sentAt = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Halifax',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1C1C1C;max-width:600px;margin:0 auto;padding:24px;background:#F5F0EB;">
  <div style="background:#1C1C1C;color:#F5F0EB;padding:24px 32px;border-radius:12px 12px 0 0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#7C9A8E;margin-bottom:8px;">New inquiry${source ? ` &middot; ${escapeHtml(source)}` : ''}</div>
    <div style="font-size:20px;font-weight:700;">Primrose Tax Law</div>
  </div>
  <div style="background:#FAFAF8;padding:32px;border-radius:0 0 12px 12px;border:1px solid rgba(0,0,0,.06);border-top:none;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,0,0,.45);width:90px;">From</td><td style="padding:8px 0;font-size:15px;color:#1C1C1C;font-weight:500;">${escapeHtml(name) || '&mdash;'}</td></tr>
      <tr><td style="padding:8px 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,0,0,.45);">Email</td><td style="padding:8px 0;font-size:15px;color:#1C1C1C;"><a href="mailto:${escapeHtml(email)}" style="color:#4A6B5D;text-decoration:none;">${escapeHtml(email) || '&mdash;'}</a></td></tr>
      ${subject ? `<tr><td style="padding:8px 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,0,0,.45);">Subject</td><td style="padding:8px 0;font-size:14px;color:rgba(0,0,0,.7);">${escapeHtml(subject)}</td></tr>` : ''}
    </table>
    <div style="margin-top:24px;padding-top:24px;border-top:1px solid rgba(0,0,0,.08);">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,0,0,.45);margin-bottom:12px;">Message</div>
      <div style="font-size:15px;line-height:1.6;color:#1C1C1C;white-space:pre-wrap;">${escapeHtml(message) || '(no message)'}</div>
    </div>
    <div style="margin-top:32px;font-size:11px;color:rgba(0,0,0,.4);text-transform:uppercase;letter-spacing:.08em;">Sent ${escapeHtml(sentAt)} &middot; Atlantic</div>
  </div>
</body></html>`;
}

// ----- Handler -----
export default async function handler(req, res) {
  // CORS (allow form posts from primrosetax.com + vercel preview)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const name = String(body.name || '').trim().slice(0, 200);
    const email = String(body.email || '').trim().slice(0, 200);
    const subject = String(body.subject || '').trim().slice(0, 300);
    const message = String(body.message || '').trim().slice(0, 5000);
    const source = String(body.source || body.subject || 'Website').trim().slice(0, 100);

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Name, email and message are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address.' });
    }

    // 1) Save to Firestore
    let firestoreId = null;
    try {
      const db = getDb();
      const docRef = await db.collection('contacts').add({
        name,
        email,
        subject: subject || null,
        message,
        source,
        userAgent: req.headers['user-agent'] || null,
        createdAt: new Date(),
      });
      firestoreId = docRef.id;
    } catch (fsErr) {
      console.error('Firestore write failed:', fsErr);
      // Continue to email; we don't want to lose the inquiry.
    }

    // 2) Send email via Resend
    let emailId = null;
    if (process.env.resend_api_key && CLIENT_EMAIL) {
      const resend = new Resend(process.env.resend_api_key);
      const { data, error } = await resend.emails.send({
        from: FROM_EMAIL,
        to: [CLIENT_EMAIL],
        reply_to: email,
        subject: subject ? `New inquiry: ${subject}` : `New inquiry from ${name}`,
        html: buildEmailHtml({ name, email, subject, message, source }),
      });
      if (error) {
        console.error('Resend error:', error);
      } else {
        emailId = data?.id;
      }
    }

    if (!firestoreId && !emailId) {
      return res.status(502).json({ ok: false, error: 'Submission failed. Please email hello@primrosetax.ca directly.' });
    }

    return res.status(200).json({ ok: true, id: firestoreId, emailId });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ ok: false, error: 'Server error. Please email hello@primrosetax.ca directly.' });
  }
}
