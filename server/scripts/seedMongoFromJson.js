'use strict';

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.resolve(__dirname, '..', 'mongodb');
const ENV_FILE = path.resolve(__dirname, '..', 'config.env');
const COLLECTION_FILES = {
  nivells: 'nivells.json',
  jugadors: 'jugadors.json',
  partides: 'partides.json',
  moviments: 'moviments.json',
  records_temps: 'records_temps.json'
};

loadEnvFile(ENV_FILE);

async function main() {
  const uri = String(process.env.MONGODB_URI || '').trim();
  const dbName = String(process.env.MONGODB_DB || 'picopark').trim() || 'picopark';
  if (!uri) {
    throw new Error('Missing MONGODB_URI. Set it in environment or server/config.env.');
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  try {
    for (const [collectionName, fileName] of Object.entries(COLLECTION_FILES)) {
      const filePath = path.join(DATA_DIR, fileName);
      if (!fs.existsSync(filePath)) {
        console.log(`Skip ${collectionName}: file not found (${filePath})`);
        continue;
      }

      const raw = fs.readFileSync(filePath, 'utf8');
      const docs = JSON.parse(raw);
      if (!Array.isArray(docs)) {
        console.log(`Skip ${collectionName}: JSON is not an array`);
        continue;
      }

      const collection = db.collection(collectionName);
      await collection.deleteMany({});
      if (docs.length > 0) {
        await collection.insertMany(docs, { ordered: true });
      }
      console.log(`Seeded ${collectionName}: ${docs.length} docs`);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] != null) {
      continue;
    }

    process.env[key] = value;
  }
}