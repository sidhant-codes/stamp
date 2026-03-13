const pino = require('pino');

// Silent under test so the suite output stays readable; LOG_LEVEL overrides elsewhere.
module.exports = pino({ level: process.env.NODE_ENV === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info' });
