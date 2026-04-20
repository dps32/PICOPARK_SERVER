const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const GameLogic = require('./gameLogic.js');
const webSockets = require('./utilsWebSockets.js');
const GameMessages = require('./utilsGameMessages.js');
const GameLoop = require('./utilsGameLoop.js');

loadEnvFiles([
  path.resolve(__dirname, 'config.env')
]);

const debug = process.env.DEBUG_WS === '1';
const port = Number.parseInt(String(process.env.PORT || '3000').trim(), 10) || 3000;
const adminPassword = String(process.env.WEB_ADMIN_PASSWORD || '').trim();
const publicDir = path.resolve(__dirname, '..', 'public');

// Inicialitzar WebSockets i la lògica del joc
const ws = new webSockets();
const game = new GameLogic();
const gameMessages = new GameMessages(ws);
let gameLoop = new GameLoop();
let gameplayBroadcastIndex = 0;

// Inicialitzar servidor Express
const app = express();
app.use(express.static(publicDir, {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

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
    game.addClient(id);
    gameMessages.addClient(id);
    queueSnapshotToClient(socket, id, game.getSnapshotState());
    queueGameplayStateToClient(socket, id, {
      includeOtherPlayers: true,
      includeGems: true
    });
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
    ws.broadcast(JSON.stringify({ type: "disconnected", from: "server" }));
};

// **Game Loop**
gameLoop.run = (fps) => {
    game.updateGame(fps);
    broadcastGameState();
    gameMessages.flushAll();
};
gameLoop.start();

// Gestionar el tancament del servidor
let shuttingDown = false;
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
  process.once(signal, shutDown);
});
function shutDown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Rebuda senyal de tancament, aturant el servidor...');
  httpServer.close(() => {
    ws.end();
    gameLoop.stop();
    process.exit(0);
  });
}

function broadcastGameState() {
  const snapshot = game.consumeSnapshotState();
  const includeOtherPlayers = snapshot ? true : gameplayBroadcastIndex % 2 === 0;
  const includeGems = snapshot ? true : !includeOtherPlayers;

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

function queueSnapshotToClient(socket, id, snapshot) {
  gameMessages.enqueueReplaceable(
    socket,
    id,
    'snapshot',
    JSON.stringify({ type: 'snapshot', snapshot })
  );
}

function queueGameplayStateToClient(socket, id, options) {
  const gameState = game.getGameplayStateForPlayer(id, options);
  gameMessages.enqueueReplaceable(
    socket,
    id,
    'gameplay',
    JSON.stringify({ type: 'gameplay', gameState })
  );
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
