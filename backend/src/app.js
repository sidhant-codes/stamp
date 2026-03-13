const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const { CLIENT_ORIGIN, TRUST_PROXY } = require('./config/env');
const { errorHandler } = require('./middleware/error');
const { ipLimiter } = require('./middleware/rateLimit');

const app = express();
app.set('trust proxy', TRUST_PROXY); // number of proxy hops in front of us; see .env.example
// One structured log line per request, tagged with a request id that is also returned as X-Request-Id.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const id = String(req.headers['x-request-id'] || '').slice(0, 64) || crypto.randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
  })
);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));

app.get('/health', (req, res) => {
  const db = mongoose.connection.readyState === 1;
  res.status(db ? 200 : 503).json({ ok: db, db, uptime: Math.round(process.uptime()) });
});

app.use('/api', ipLimiter);
app.use('/api/user', require('./routes/user'));
app.use('/api/resume', require('./routes/resume'));
app.use(errorHandler);

module.exports = app;
