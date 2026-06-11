// Must run before anything requires src/config/env.js (dotenv never overrides vars that are already set,
// so the real backend/.env values cannot leak into tests).
Object.assign(process.env, {
  MONGO_URI: 'mongodb://unused',
  COHERE_API_KEY: 'test-key',
  JWT_SECRET: 'test-secret',
  NODE_ENV: 'test',
  DAILY_AI_LIMIT: '20',
  RESEND_API_KEY: '',
  MAIL_FROM: 'test@example.com',
  CLIENT_ORIGIN: 'http://localhost:5173',
  TRUST_PROXY: process.env.TRUST_PROXY ?? '1', // tests rotate IPs via X-Forwarded-For
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let mongod;
let counter = 0;

exports.start = async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
};

exports.stop = async () => {
  await mongoose.disconnect();
  await mongod.stop();
};

exports.app = () => require('../src/app');

exports.makeUser = (overrides = {}) =>
  require('../src/models/user').create({
    name: 'Test User',
    email: `user${++counter}@example.com`,
    password: 'not-a-real-hash',
    ...overrides,
  });

exports.tokenFor = (user) =>
  jwt.sign({ id: user._id, v: user.tokenVersion }, process.env.JWT_SECRET, { expiresIn: '1h' });

// Rate limits key on req.ip; with `trust proxy` set, X-Forwarded-For controls it.
exports.ip = () => `10.${(++counter >> 8) & 255}.${counter & 255}.1`;
