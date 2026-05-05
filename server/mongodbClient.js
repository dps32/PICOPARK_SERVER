'use strict';

const { MongoClient } = require('mongodb');

let client = null;
let db = null;
let connectingPromise = null;

function isMongoConfigured() {
  return Boolean(String(process.env.MONGODB_URI || '').trim());
}

function isMongoRequired() {
  return String(process.env.MONGODB_REQUIRED || '0').trim() === '1';
}

function getMongoDbName() {
  return String(process.env.MONGODB_DB || 'picopark').trim() || 'picopark';
}

async function connectMongo() {
  if (!isMongoConfigured()) {
    return null;
  }
  if (db) {
    return db;
  }
  if (connectingPromise) {
    return connectingPromise;
  }

  const uri = String(process.env.MONGODB_URI || '').trim();
  const dbName = getMongoDbName();

  connectingPromise = (async () => {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3000
    });
    await client.connect();
    db = client.db(dbName);
    return db;
  })();

  try {
    return await connectingPromise;
  } finally {
    connectingPromise = null;
  }
}

async function getCollection(name) {
  const connectedDb = await connectMongo();
  if (!connectedDb) {
    return null;
  }
  return connectedDb.collection(name);
}

function getMongoState() {
  return {
    configured: isMongoConfigured(),
    connected: Boolean(db),
    dbName: getMongoDbName(),
    required: isMongoRequired()
  };
}

module.exports = {
  connectMongo,
  getCollection,
  isMongoConfigured,
  isMongoRequired,
  getMongoState
};