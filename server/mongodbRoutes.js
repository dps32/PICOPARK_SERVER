'use strict';

const express = require('express');
const { loadSchema, filterCollection, getMongoState } = require('./mongodbStore.js');

const router = express.Router();

function wrap(data) {
  return {
    success: true,
    count: Array.isArray(data) ? data.length : 1,
    timestamp: new Date().toISOString(),
    data
  };
}

router.get('/schema', async (_req, res) => {
  try {
    res.json(wrap(await loadSchema()));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/nivells', async (req, res) => {
  try {
    res.json(wrap(await filterCollection('nivells', req.query)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/jugadors', async (req, res) => {
  try {
    res.json(wrap(await filterCollection('jugadors', req.query)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/partides', async (req, res) => {
  const query = {
    nivell_id: req.query.nivell_id,
    estat: req.query.estat,
    jugador_id: req.query.jugador_id
  };
  try {
    res.json(wrap(await filterCollection('partides', query)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/moviments', async (req, res) => {
  const query = {
    partida_id: req.query.partida_id,
    jugador_id: req.query.jugador_id,
    tipus_moviment: req.query.tipus_moviment,
    direccio: req.query.direccio
  };

  try {
    res.json(wrap(await filterCollection('moviments', query)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/records_temps', async (req, res) => {
  const query = {
    nivell_id: req.query.nivell_id,
    partida_id: req.query.partida_id,
    jugador_id: req.query.jugador_id
  };

  try {
    res.json(wrap(await filterCollection('records_temps', query)));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/mongo/status', (_req, res) => {
  res.json(wrap(getMongoState()));
});

module.exports = router;