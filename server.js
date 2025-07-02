import express from 'express';
import cors from 'cors';
import { DataAPIClient } from '@datastax/astra-db-ts';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for frontend access (e.g. React at localhost:3000)
app.use(cors({
    origin: '*', // or replace '*' with 'http://localhost:3000' for specific domain
}));

// Optional: to parse JSON in POST requests
app.use(express.json());

const client = new DataAPIClient();
const db = client.db(process.env.ASTRA_DB_API_ENDPOINT, {
    token: process.env.ASTRA_DB_APPLICATION_TOKEN,
});

app.get('/collections', async (req, res) => {
    try {
        const collections = await db.listCollections();
        res.json(collections);
    } catch (error) {
        console.error('Error fetching collections:', error);
        res.status(500).json({ error: 'Failed to fetch collections' });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
