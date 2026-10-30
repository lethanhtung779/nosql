const path = require('path');
require('express-async-errors');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const auth = require('./routes/auth');
const catalog = require('./routes/catalog');
const appointments = require('./routes/appointments');
const reviews = require('./routes/reviews');
const reports = require('./routes/reports');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date() }));
app.use('/api/auth', auth);
app.use('/api', catalog);
app.use('/api/appointments', appointments);
app.use('/api/reviews', reviews);
app.use('/api/reports', reports);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use(notFound);
app.use(errorHandler);

module.exports = app;
