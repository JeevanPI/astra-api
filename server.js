require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { DataAPIClient } = require('@datastax/astra-db-ts');
const { OpenAI } = require('openai');

const app = express();

app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// /connect
app.post('/connect', async (req, res) => {
    try {
        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;
        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });
        return res.status(200).json({ success: true, databaseId: db.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// /collection
app.post('/collection', async (req, res) => {
    try {
        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;
        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });

        // Uncomment this to create collection if needed
        await db.dropCollection('insurance_dataset')
        await db.createCollection('insurance_dataset', {
          vector: { dimension: 1536, metric: "cosine" },
          service: { provider: "datastax", model: "NV-Embed-QA" },
          fieldToEmbed: "$vectorize"
        });

        return res.status(200).json({ success: true, message: "Collection endpoint hit." });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// /insert
app.post('/insert', async (req, res) => {
    try {
        const { data } = req.body;
        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });
        const collection = await db.collection("insurance_dataset");
        const result = await collection.insertMany(data);
        return res.status(200).json({ success: true, insertedCount: result.insertedCount });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// /search
app.post('/search', async (req, res) => {
    try {
        const { query, limit = 3 } = req.body;
        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });
        const collection = await db.collection("insurance_dataset");
        const cursor = collection.find(
            {},
            {
                vector: { query },
                limit,
                projection: { "*": 1 },
            }
        );
        const results = await cursor.toArray();
        return res.status(200).json({ success: true, results });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// /sendEmail (OpenAI + search + summary)
app.post('/ask', async (req, res) => {
    try {
        const { query } = req.body;
        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });
        const collection = await db.collection("insurance_dataset");
        const cursor = collection.find(
            {},
            {
                vector: { query },
                limit: 3,
                projection: { "*": 1 },
                includeSimilarity: true,
                similarityThreshold: 0.7,
            }
        );
        const docs = await cursor.toArray();

        if (docs.length === 0) {
            return res.status(200).json({ success: true, summary: "No matches found." });
        }

        const contextText = docs.map(doc => `Context:\n${doc.$vectorize}\n`).join("\n");

        const prompt = `Use the following context to answer:\n\n${contextText}\n\nQuestion: ${query}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
                { role: "system", content: "You are a helpful assistant. Use only the provided context." },
                { role: "user", content: prompt },
            ]
        });

        const summary = completion.choices[0].message.content;
        return res.status(200).json({ success: true, summary });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = app;
