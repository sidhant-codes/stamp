require('dotenv').config();

const required = ['MONGO_URI', 'COHERE_API_KEY', 'JWT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing env vars: ${missing.join(', ')}`);

module.exports = {
  PORT: process.env.PORT || 4000,
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  MONGO_URI: process.env.MONGO_URI,
  COHERE_API_KEY: process.env.COHERE_API_KEY,
  COHERE_MODEL: process.env.COHERE_MODEL || 'command-a-03-2025',
  JWT_SECRET: process.env.JWT_SECRET,
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  MAIL_FROM: process.env.MAIL_FROM || 'onboarding@resend.dev',
  // How many reverse proxies sit in front of the API (0 = none). Wrong values let clients spoof X-Forwarded-For.
  TRUST_PROXY: Number(process.env.TRUST_PROXY) || 0,
  DAILY_AI_LIMIT: Number(process.env.DAILY_AI_LIMIT) || 20,
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
};
