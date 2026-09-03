const express = require('express');
const quoteRoutes = require('./routes/quoteRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const { sampleQuotes } = require('./data/sampleQuotes');

function createApp() {
    const app = express();

    app.use(express.json());

    app.get('/health', (req, res) => {
        res.status(200).json({ success: true, status: 'ok' });
    });

    app.get('/api/v1/sample-quotes', (req, res) => {
        res.status(200).json({ success: true, data: sampleQuotes });
    });

    app.use('/api/v1', quoteRoutes);
    app.use('/api/v1/whatsapp', whatsappRoutes);

    // Malformed JSON bodies land here via express.json()'s parse error.
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ success: false, errors: ['Request body must be valid JSON.'] });
        }
        return next(err);
    });

    app.use((req, res) => {
        res.status(404).json({ success: false, errors: ['Not found.'] });
    });

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        res.status(500).json({ success: false, errors: ['Internal server error.'] });
    });

    return app;
}

module.exports = { createApp };
