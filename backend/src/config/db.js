const mongoose = require('mongoose');
const { MONGO_URI } = require('./env');
const logger = require('./logger');

module.exports = async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI);
    logger.info('Database connected');
  } catch (err) {
    logger.error({ err }, 'Database connection failed');
    process.exit(1);
  }
};
