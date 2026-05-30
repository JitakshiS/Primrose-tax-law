// Vercel Serverless Function: /api/contact
// Receives form POSTs (incl. optional base64 file attachment),
// saves metadata to Firestore, emails Primrose via Resend with attachment.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';

// Raise body limit so base64-encoded attachments fit (default Vercel: ~1MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

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
// CLIENT_EMAIL accepts a single address or a comma-separated list.
// Update in Vercel env without redeploying code when removing the QA recipient.
const CLIENT_EMAILS = (process.env.CLIENT_EMAIL || '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);
const FROM_EMAIL = 'Primrose Tax Law <noreply@primrosetax.ca>';

// ----- Allowed origins (CORS + light anti-abuse) -----
const ALLOWED_ORIGINS = [
  'https://primrosetax.ca',
  'https://www.primrosetax.ca',
  'https://primrosetax.com',
  'https://www.primrosetax.com',
];
const isAllowedOrigin = (o) =>
  !!o && (ALLOWED_ORIGINS.includes(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o));

// ----- Best-effort in-memory rate limit (per warm serverless instance) -----
const RATE_BUCKET = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const WINDOW_MS = 60000; // 1 minute
  const MAX_HITS = 6;
  const hits = (RATE_BUCKET.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  RATE_BUCKET.set(ip, hits);
  return hits.length > MAX_HITS;
}

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function buildEmailHtml({ name, email, subject, message, source, firm, province, targetDate, attachmentName }) {
  const sentAt = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Halifax',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const row = (label, value) => value
    ? `<tr><td style="padding:8px 0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(0,0,0,.45);width:140px;">${label}</td><td style="padding:8px 0;font-size:15px;color:#1C1C1C;">${value}</td></tr>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1C1C1C;max-width:600px;margin:0 auto;padding:24px;background:#F5F0EB;">
  <div style="background:#1C1C1C;color:#F5F0EB;padding:24px 32px;border-radius:12px 12px 0 0;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#7C9A8E;margin-bottom:8px;">New inquiry${source ? ` &middot; ${escapeHtml(source)}` : ''}</div>
    <div style="font-size:20px;font-weight:700;">Primrose Tax Law</div>
  </div>
  <div style="background:#FAFAF8;padding:32px;border-radius:0 0 12px 12px;border:1px solid rgba(0,0,0,.06);border-top:none;">
    <table style="width:100%;border-collapse:collapse;">
      ${row('From', `<span style="font-weight:500;">${escapeHtml(name) || '&mdash;'}</span>`)}
      ${row('Email', `<a href="mailto:${escapeHtml(email)}" style="color:#4A6B5D;text-decoration:none;">${escapeHtml(email) || '&mdash;'}</a>`)}
      ${row('Firm', escapeHtml(firm))}
      ${row('Province', escapeHtml(province))}
      ${row('Target date', escapeHtml(targetDate))}
      ${row('Subject', `<span style="color:rgba(0,0,0,.7);font-size:14px;">${escapeHtml(subject)}</span>`)}
      ${row('Attachment', attachmentName ? `<span style="color:#4A6B5D;font-weight:500;">&#128206; ${escapeHtml(attachmentName)} <span style="color:rgba(0,0,0,.4);font-weight:400;">(attached to this email)</span></span>` : '')}
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
  // CORS — echo the request origin only if it's primrosetax.ca/.com or a Vercel preview
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Origin', isAllowedOrigin(origin) ? origin : 'https://www.primrosetax.ca');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  // Block cross-site browser submissions (lenient: only when an Origin is present and foreign)
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }

  // Basic per-IP rate limiting
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Too many requests. Please try again shortly.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};

    // Honeypot: a hidden field real users never fill. If it's set, it's a bot —
    // pretend success (so the bot moves on) but drop the submission entirely.
    if (body._hp && String(body._hp).trim()) {
      return res.status(200).json({ ok: true, id: null });
    }

    const name = String(body.name || '').trim().slice(0, 200);
    const email = String(body.email || '').trim().slice(0, 200);
    const subject = String(body.subject || '').trim().slice(0, 300);
    const message = String(body.message || '').trim().slice(0, 5000);
    const source = String(body.source || body.subject || 'Website').trim().slice(0, 100);
    const firm = String(body.firm || '').trim().slice(0, 200);
    const province = String(body.province || '').trim().slice(0, 100);
    const targetDate = String(body.targetDate || '').trim().slice(0, 50);

    // Optional file attachment (base64 from client; { filename, content, contentType, size })
    const attachment = body.attachment && body.attachment.content && body.attachment.filename
      ? {
          filename: String(body.attachment.filename).slice(0, 200),
          content: body.attachment.content, // base64 string
          contentType: body.attachment.contentType || 'application/octet-stream',
          size: Number(body.attachment.size || 0),
        }
      : null;

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({ ok: false, error: 'Name, email and message are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Invalid email address.' });
    }

    // 1) Save to Firestore (metadata only — we don't store the file body)
    let firestoreId = null;
    try {
      const db = getDb();
      const docRef = await db.collection('contacts').add({
        name,
        email,
        subject: subject || null,
        message,
        source,
        firm: firm || null,
        province: province || null,
        targetDate: targetDate || null,
        attachmentName: attachment ? attachment.filename : null,
        attachmentSize: attachment ? attachment.size : null,
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
    if (process.env.resend_api_key && CLIENT_EMAILS.length) {
      const resend = new Resend(process.env.resend_api_key);
      const payload = {
        from: FROM_EMAIL,
        to: CLIENT_EMAILS,
        reply_to: email,
        subject: subject ? `New inquiry: ${subject}` : `New inquiry from ${name}`,
        html: buildEmailHtml({ name, email, subject, message, source, firm, province, targetDate, attachmentName: attachment?.filename }),
      };
      if (attachment) {
        payload.attachments = [{
          filename: attachment.filename,
          content: attachment.content, // Resend accepts base64 string for `content`
        }];
      }
      const { data, error } = await resend.emails.send(payload);
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
