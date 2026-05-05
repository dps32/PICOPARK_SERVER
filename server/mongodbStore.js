'use strict';

const fs = require('fs');
const path = require('path');
const { getCollection, isMongoConfigured, isMongoRequired, getMongoState } = require('./mongodbClient.js');

const DATA_DIR = path.resolve(__dirname, 'mongodb');
const COLLECTION_FILES = {
  nivells: 'nivells.json',
  jugadors: 'jugadors.json',
  partides: 'partides.json',
  moviments: 'moviments.json',
  records_temps: 'records_temps.json'
};

function loadCollectionFromJson(name) {
  const fileName = COLLECTION_FILES[name];
  if (!fileName) {
    return [];
  }

  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function buildMongoQuery(name, query = {}) {
  const mongoQuery = {};
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') {
      continue;
    }
    mongoQuery[key] = value;
  }

  // Domain shortcut: jugador_id filters on partides.jugador_ids[]
  if (name === 'partides' && mongoQuery.jugador_id) {
    mongoQuery.jugador_ids = String(mongoQuery.jugador_id);
    delete mongoQuery.jugador_id;
  }

  return mongoQuery;
}

function filterLocalCollection(name, query = {}) {
  const localQuery = { ...query };
  if (name === 'partides' && localQuery.jugador_id) {
    localQuery.jugador_ids = String(localQuery.jugador_id);
    delete localQuery.jugador_id;
  }

  const items = loadCollectionFromJson(name);
  if (!localQuery || Object.keys(localQuery).length <= 0) {
    return items;
  }

  return items.filter((item) => {
    for (const [key, value] of Object.entries(localQuery)) {
      if (value == null || value === '') {
        continue;
      }

      const itemValue = item[key];
      if (Array.isArray(itemValue)) {
        if (!itemValue.map(String).includes(String(value))) {
          return false;
        }
        continue;
      }

      if (String(itemValue) !== String(value)) {
        return false;
      }
    }
    return true;
  });
}

async function loadCollection(name) {
  if (isMongoRequired() && !isMongoConfigured()) {
    throw new Error('MongoDB is required but MONGODB_URI is not configured.');
  }

  if (isMongoConfigured()) {
    try {
      const collection = await getCollection(name);
      if (collection) {
        return await collection.find({}).toArray();
      }
    } catch (err) {
      if (isMongoRequired()) {
        throw new Error(`MongoDB connection failed: ${err.message}`);
      }
      // Fallback to local JSON if Mongo is not reachable.
    }
  }

  if (isMongoRequired()) {
    throw new Error('MongoDB is required but no collection could be loaded.');
  }

  return loadCollectionFromJson(name);
}

async function loadSchema() {
  return {
    nivells: await loadCollection('nivells'),
    jugadors: await loadCollection('jugadors'),
    partides: await loadCollection('partides'),
    moviments: await loadCollection('moviments'),
    records_temps: await loadCollection('records_temps')
  };
}

async function filterCollection(name, query = {}) {
  if (isMongoRequired() && !isMongoConfigured()) {
    throw new Error('MongoDB is required but MONGODB_URI is not configured.');
  }

  if (isMongoConfigured()) {
    try {
      const collection = await getCollection(name);
      if (collection) {
        const mongoQuery = buildMongoQuery(name, query);
        return await collection.find(mongoQuery).toArray();
      }
    } catch (err) {
      if (isMongoRequired()) {
        throw new Error(`MongoDB connection failed: ${err.message}`);
      }
      // Fallback to local JSON if Mongo is not reachable.
    }
  }

  if (isMongoRequired()) {
    throw new Error('MongoDB is required but no collection could be queried.');
  }

  return filterLocalCollection(name, query);
}

module.exports = {
  loadSchema,
  filterCollection,
  getMongoState
};