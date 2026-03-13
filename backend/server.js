const env = require('./src/config/env');
const logger = require('./src/config/logger');
const connectDB = require('./src/config/db');
const app = require('./src/app');

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled rejection'));

connectDB().then(() => {
  app.listen(env.PORT, () => logger.info(`Backend running on port ${env.PORT}`));
});
