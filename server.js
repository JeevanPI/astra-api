require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { DataAPIClient } = require('@datastax/astra-db-ts');
const { OpenAI } = require('openai');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



// http://localhost:4000/search - Local testing


// 🔹 /connect
app.post('/connect', async (req, res) => {
    try {
        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });
        return res.status(200).json({ success: true, databaseId: db.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

// 🔹 /collection (create or reset)
app.post('/collection', async (req, res) => {
    try {
        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });

        // Uncomment if you want to reset the collection:
        // await db.dropCollection('insurance_dataset');

        // Uncomment to create a collection with vector config:
        // await db.createCollection('insurance_dataset', {
        //   vector: { dimension: 1536, metric: 'cosine' },
        //   service: { provider: 'datastax', model: 'NV-Embed-QA' },
        //   fieldToEmbed: '$vectorize'
        // });

        return res.status(200).json({ success: true, message: 'Collection endpoint hit.' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// 🔹 /upload
const upload = multer(); // uses memory storage
app.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Missing PDF file.' });
        }

        const fileBuffer = req.file.buffer;
        const parsed = await pdfParse(fileBuffer);
        const fullText = parsed.text || '';

        // 🟢 Step 1: Normalize whitespace
        const cleanedText = fullText.replace(/\s+/g, ' ').trim();

        // 🟢 Step 2: Split into 500-char chunks, 0 overlap
        const CHUNK_SIZE = 500;
        const OVERLAP = 0;
        const chunks = [];

        for (let i = 0; i < cleanedText.length; i += (CHUNK_SIZE - OVERLAP)) {
            const chunk = cleanedText.slice(i, i + CHUNK_SIZE);
            if (chunk.length > 0) {
                chunks.push({
                    _id: `chunk-${Date.now()}-${i}`,
                    $vectorize: chunk,
                    type: 'pdf',
                    source: req.file.originalname,
                });
            }
        }

        // 🟢 Step 3: Insert into AstraDB
        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;

        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });
        const collection = await db.collection('insurance_dataset');

        const result = await collection.insertMany(chunks);

        return res.status(200).json({
            success: true,
            insertedCount: result.insertedCount,
            fileName: req.file.originalname,
            chunkSize: CHUNK_SIZE,
        });

    } catch (error) {
        console.error('❌ Error inserting PDF:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});


// 🔹 /insert
app.post('/insert', async (req, res) => {
    try {
        const { data } = req.body;
        if (!Array.isArray(data)) {
            return res.status(400).json({ error: "'data' must be an array." });
        }

        const client = new DataAPIClient();
        const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
            token: process.env.ASTRA_DB_APPLICATION_TOKEN,
        });

        const collection = await db.collection('insurance_dataset');
        const result = await collection.insertMany(data);

        return res.status(200).json({ success: true, insertedCount: result.insertedCount });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

//Search
app.post('/search', async function (req, res) {
    try {
        const { query, limit = 3 } = req.body;
        if (!query) {
            return res.status(400).json({ error: "Missing 'query' in request body" });
        }

        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;

        if (!endpoint || !token) {
            return res.status(500).json({ error: "Missing required env vars." });
        }

        const { DataAPIClient } = require('@datastax/astra-db-ts');
        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });

        const collection = await db.collection('insurance_dataset');

        // ✅ Same as Lambda — object shorthand works in v2.0.1
        const cursor = collection.find(
            {},
            {
                vector: { query },       // ✅ keep this for v2.0.1
                limit,
                projection: { "*": 1 }
            }
        );

        const results = await cursor.toArray();

        return res.status(200).json({ success: true, results });
    } catch (error) {
        console.error("❌ Error searching insurance_dataset:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});


// 🔹 /Ask AI (query → vector search → GPT summary)
app.post('/ask', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({ error: "Missing 'query' in request body" });
        }

        // 🔹 Connect to Astra DB
        const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
        const token = process.env.ASTRA_DB_APPLICATION_TOKEN;

        const client = new DataAPIClient();
        const db = client.db(endpoint, { token });

        const collection = await db.collection('insurance_workspace');

        // 🔹 Semantic Search with auto-vectorize
        const cursor = collection.find(
            {},
            {
                vector: { query }, // ✅ this works in v2.0.1
                limit: 3,
                projection: { "*": 1 },
                includeSimilarity: true,
                similarityThreshold: 0.7
            }
        );

        const docs = await cursor.toArray();

        if (docs.length === 0) {
            return res.status(200).json({ success: true, summary: "No matches found." });
        }

        // 🔹 Prepare context for OpenAI
        const contextText = docs
            .map(doc => `Context:\n${doc.$vectorize}\n`)
            .join("\n");

        const finalPrompt = `Use the following pieces of context to answer the question at the end.

${contextText}

Question: ${query}`;

        // 🔹 Query OpenAI (gpt-4o-mini)
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "You are a helpful assistant. Answer the question based ONLY on the provided context."
                },
                {
                    role: "user",
                    content: finalPrompt
                }
            ]
        });

        const summary = completion.choices[0].message.content;

        return res.status(200).json({ success: true, summary });

    } catch (error) {
        console.error("❌ Error in /ask:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// ✅ Required for Render: listen on dynamic port
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`✅ Server is running on port ${PORT}`);
});
