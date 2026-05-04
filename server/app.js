const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const GameLogic = require('./gameLogic.js');
const webSockets = require('./utilsWebSockets.js');
const GameMessages = require('./utilsGameMessages.js');
const GameLoop = require('./utilsGameLoop.js');
const InactivityMonitor = require('./inactivityMonitor.js');
const mongodbRoutes = require('./mongodbRoutes.js');
const { getMongoState } = require('./mongodbClient.js');

loadEnvFiles([
  path.resolve(__dirname, 'config.env')
]);

const debug = process.env.DEBUG_WS === '1';
const port = Number.parseInt(String(process.env.PORT || '3000').trim(), 10) || 3000;
const adminPassword = String(process.env.WEB_ADMIN_PASSWORD || '').trim();
const serveStatic = process.env.SERVE_STATIC === '1';
const publicDir = path.resolve(__dirname, '..', 'public');

// Inactivity kick: players idle for more than this are forcibly disconnected (ms)
const INACTIVITY_TIMEOUT_MS = 60_000;
// How often to check for inactive players (ms)
const INACTIVITY_CHECK_INTERVAL_MS = 10_000;

// Inicialitzar WebSockets i la lògica del joc
const ws = new webSockets();
const game = new GameLogic();
const gameMessages = new GameMessages(ws);
let gameLoop = new GameLoop();
let gameplayBroadcastIndex = 0;

const inactivityMonitor = new InactivityMonitor({
    inactivityTimeoutMs: INACTIVITY_TIMEOUT_MS,
    checkIntervalMs: INACTIVITY_CHECK_INTERVAL_MS,
    getInactive: (timeoutMs) => game.getInactivePlayers(timeoutMs),
    onKick: (id) => {
        // Close with code 4001 so the client knows this is a kick, not a
        // network error, and suppresses auto-reconnect.
        ws.closeClientWithCode(id, 4001, 'kicked:inactivity');
    }
});

// Inicialitzar servidor Express
const app = express();
if (serveStatic) {
  app.use(express.static(publicDir, {
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
}
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.use('/api', mongodbRoutes);

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/health', (_req, res) => {
  const mongo = getMongoState();
  res.json({
    ok: true,
    status: 'up',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    mongo
  });
});

if (serveStatic) {
  app.get('/qr', (req, res) => {
    res.sendFile(path.resolve(publicDir, 'qr.html'));
  });
}

app.post('/api/admin/restart-match', (req, res) => {
  if (!adminPassword) {
    return res.status(503).json({
      ok: false,
      error: 'WEB_ADMIN_PASSWORD is not configured on this server.'
    });
  }
  if (!hasValidAdminSecret(req)) {
    return res.status(403).json({
      ok: false,
      error: 'Invalid admin secret.'
    });
  }

  game.restartToWaitingRoom();
  broadcastGameState();
  return res.json({
    ok: true,
    gameState: game.getGameplayState()
  });
});

// Inicialitzar servidor HTTP
const httpServer = app.listen(port, () => {
    console.log(`Servidor HTTP escoltant a: http://localhost:${port}`);
});

// Gestionar WebSockets
ws.init(httpServer, port);

ws.onConnection = (socket, id) => {
    if (debug) console.log("WebSocket client connected: " + id);
    const addedPlayer = game.addClient(id);
    if (!addedPlayer) {
      ws.send(socket, JSON.stringify({
        type: 'room:error',
        message: 'Room is full (max 8 players).'
      }));
      socket.close();
      return;
    }
    gameMessages.addClient(id);
    queueSnapshotToClient(socket, id, game.getSnapshotState(), true);
    queueGameplayStateToClient(socket, id, {
      includeOtherPlayers: true,
      includeGems: true
    }, true);
};

ws.onMessage = (socket, id, msg) => {
    if (debug) console.log(`New message from ${id}: ${msg.substring(0, 32)}...`);
    const stateChanged = game.handleMessage(id, msg);
    if (stateChanged) {
        broadcastGameState();
    }
};

ws.onClose = (socket, id) => {
    if (debug) console.log("WebSocket client disconnected: " + id);
    game.removeClient(id);
    gameMessages.removeClient(id);

    // Force a reliable snapshot to every remaining client so they immediately
    // remove the disconnected player. Using reliable (not replaceable) prevents
    // the message from being dropped if a replaceable snapshot is already queued,
    // and flushAll sends it right away without waiting for the next game loop tick.
    const snapshot = game.getSnapshotState();
    game.clearSnapshotDirty();
    ws.forEachClient((clientSocket, clientId) => {
        queueSnapshotToClient(clientSocket, clientId, snapshot, true);
        queueGameplayStateToClient(clientSocket, clientId, {
            includeOtherPlayers: true,
            includeGems: true
        }, true);
    });
    gameMessages.flushAll();
};

// **Game Loop**
gameLoop.run = (fps) => {
    game.updateGame(fps);
    broadcastGameState();
    gameMessages.flushAll();
};
gameLoop.start();
inactivityMonitor.start();

// Gestionar el tancament del servidor
let shuttingDown = false;
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
  process.once(signal, shutDown);
});
function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Rebuda senyal de tancament, aturant el servidor...');
  inactivityMonitor.stop();
  httpServer.close(() => {
    ws.end();
    gameLoop.stop();
    process.exit(0);
  });
}

function broadcastGameState() {
  const snapshot = game.consumeSnapshotState();
  const includeOtherPlayers = true;
  const includeGems = true;

  if (snapshot) {
    ws.forEachClient((socket, id) => {
      queueSnapshotToClient(socket, id, snapshot);
    });
  }

  ws.forEachClient((socket, id) => {
    queueGameplayStateToClient(socket, id, {
      includeOtherPlayers,
      includeGems
    });
  });

  gameplayBroadcastIndex = (gameplayBroadcastIndex + 1) % 2;
}

function queueSnapshotToClient(socket, id, snapshot, reliable = false) {
  const payload = JSON.stringify({ type: 'snapshot', snapshot });
  if (reliable) {
    gameMessages.enqueueReliable(socket, id, payload);
    return;
  }
  gameMessages.enqueueReplaceable(socket, id, 'snapshot', payload);
}

function queueGameplayStateToClient(socket, id, options, reliable = false) {
  const gameState = game.getGameplayStateForPlayer(id, options);
  const payload = JSON.stringify({ type: 'gameplay', gameState });
  if (reliable) {
    gameMessages.enqueueReliable(socket, id, payload);
    return;
  }
  gameMessages.enqueueReplaceable(socket, id, 'gameplay', payload);
}

function hasValidAdminSecret(req) {
  const candidates = [
    req.get('x-admin-secret'),
    req.body?.secret,
    req.query?.secret
  ]
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  return candidates.some((candidate) => secretsMatch(candidate, adminPassword));
}

function secretsMatch(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
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
      if (!key) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      value = value.replace(/\s+#.*$/, '').trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

