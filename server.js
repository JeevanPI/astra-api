require('dotenv').config(); // 🔐 Load env variables

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { DataAPIClient } = require('@datastax/astra-db-ts');
const { OpenAI } = require('openai');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// EXAMPLE API route (keep adding yours here)
app.post('/connect', async (req, res) => {
    try {
        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;

        if (!endpoint || !token) {
            return res.status(500).json({ error: "Missing environment variables" });
        }

        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });

        return res.status(200).json({ success: true, message: `Connected to DB: ${db.id}` });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// ✅ START SERVER — Required for Render to detect it's running
const PORT = 4000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
