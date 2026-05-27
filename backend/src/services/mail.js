const { RESEND_API_KEY, MAIL_FROM } = require('../config/env');

async function send(to, subject, text, devLabel, link) {
  if (!RESEND_API_KEY) {
    // No provider configured: make local development usable by printing the link.
    if (process.env.NODE_ENV !== 'production') console.log(`[mail disabled] ${devLabel} for ${to}: ${link}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: MAIL_FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend responded with ${res.status}`);
}

exports.sendResetEmail = (to, link) =>
  send(
    to,
    'Reset your Stamp password',
    `Use this link to choose a new password (valid for 30 minutes):\n\n${link}\n\nIf you did not ask for this, ignore this email.`,
    'password reset link',
    link
  );

exports.sendVerifyEmail = (to, link) =>
  send(
    to,
    'Verify your email for Stamp',
    `Confirm your email address to start using the AI features (valid for 24 hours):\n\n${link}\n\nIf you did not sign up, ignore this email.`,
    'email verification link',
    link
  );
