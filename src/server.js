const env = require('./config/env');
const { connectDB } = require('./config/database');
const createApp = require('./app');

async function start() {
  await connectDB(env.MONGODB_URI);
  const app = createApp();
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`CRM API listening on :${env.PORT} (${env.NODE_ENV})`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err.message);
    process.exit(1);
  });
}

module.exports = start;
