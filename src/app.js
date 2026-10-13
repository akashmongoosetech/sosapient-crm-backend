const express = require('express');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { applySecurity } = require('./config/security');
const { generalLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const adminRoutes = require('./routes/admin.routes');

const leadRoutes = require('./routes/lead.routes');
const dealRoutes = require('./routes/deal.routes');
const { fileRoutes } = require('./routes/file.routes');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  applySecurity(app);
  // Import batches (up to 5000 rich records) need a larger payload budget.
  // Mounted first: body-parser skips already-parsed requests, so the
  // stricter global limit below still applies to every other route.
  app.use('/api/leads/import', express.json({ limit: '25mb' }));
  // 1mb default for everything else (auth payloads are far smaller).
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (process.env.NODE_ENV !== 'test') app.use(morgan('combined'));
  app.use('/api/', generalLimiter);
  app.get('/api/health', (_req, res) => res.json({ success: true, message: 'ok', data: {} }));
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/deals', dealRoutes);
  fileRoutes(app);
  // eslint-disable-next-line no-unused-vars
  app.use((req, res, _next) => res.status(404).json({ success: false, message: 'Not found', errors: [] }));
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
