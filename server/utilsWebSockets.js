// Description: WebSocket server for the app

const WebSocket = require('ws')
const { randomUUID } = require('crypto')

// How often to send a ping to detect dead connections (ms)
const HEARTBEAT_INTERVAL_MS = 15000;
// How long to wait for a pong before terminating (ms)
const HEARTBEAT_TIMEOUT_MS = 10000;

class Obj {

    init(httpServer, port) {

        // Define empty callbacks
        this.onConnection = (socket, id) => { }
        this.onMessage = (socket, id, obj) => { }
        this.onClose = (socket, id) => { }

        // Run WebSocket server
        this.ws = new WebSocket.Server({ server: httpServer, perMessageDeflate: true })
        this.socketsClients = new Map()
        console.log(`Listening for WebSocket queries on ${port}`)

        // What to do when a websocket client connects
        this.ws.on('connection', (ws) => { this.newConnection(ws) })

        // Periodic ping to detect and terminate dead connections
        this._heartbeatTimer = setInterval(() => {
            this._runHeartbeat();
        }, HEARTBEAT_INTERVAL_MS);
    }

    end() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        this.ws.close()
    }

    send(socket, msg) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(msg)
            return true
        }
        return false
    }

    isOpen(socket) {
        return !!socket && socket.readyState === WebSocket.OPEN
    }

    getBufferedAmount(socket) {
        if (!socket) {
            return 0
        }
        if (typeof socket.bufferedAmount === 'number') {
            return socket.bufferedAmount
        }
        if (socket._socket && typeof socket._socket.writableLength === 'number') {
            return socket._socket.writableLength
        }
        return 0
    }

    hasBackpressure(socket, threshold = 0) {
        return this.getBufferedAmount(socket) > Math.max(0, threshold)
    }

    sendToClientById(id, msg) {
        for (const [socket, metadata] of this.socketsClients.entries()) {
            if (metadata.id === id) {
                this.send(socket, msg);
                return true;
            }
        }
        return false;
    }

    // Close a client cleanly with a WebSocket close code the client can inspect.
    // Code 4000-4999 are reserved for application use by the WS spec.
    closeClientWithCode(id, code, reason) {
        for (const [socket, metadata] of this.socketsClients.entries()) {
            if (metadata.id === id) {
                console.log(`Closing client ${id} with code ${code} (${reason})`);
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close(code, reason);
                }
                return true;
            }
        }
        return false;
    }

    // Force-terminate a client socket by ID (for heartbeat timeouts etc.)
    terminateClient(id) {
        for (const [socket, metadata] of this.socketsClients.entries()) {
            if (metadata.id === id) {
                console.log(`Terminating client ${id} (forced)`);
                socket.terminate();
                return true;
            }
        }
        return false;
    }

    // A websocket client connects
    newConnection(con) {
        console.log("Client connected");

        // Generar ID únic per al client
        const id = "C" + randomUUID().substring(0, 5).toUpperCase();
        const metadata = { id, isAlive: true, pongTimeoutTimer: null };
        this.socketsClients.set(con, metadata);

        // Mark alive on pong response
        con.on('pong', () => {
            const meta = this.socketsClients.get(con);
            if (meta) {
                meta.isAlive = true;
                if (meta.pongTimeoutTimer) {
                    clearTimeout(meta.pongTimeoutTimer);
                    meta.pongTimeoutTimer = null;
                }
            }
        });

        // Enviar missatge de benvinguda amb ID únic
        con.send(JSON.stringify({
            type: "welcome",
            id: id,
            message: "Welcome to the server"
        }));

        // Informar tots els clients de la nova connexió
        this.broadcast(JSON.stringify({
            type: "newClient",
            id: id
        }));

        if (this.onConnection && typeof this.onConnection === "function") {
            this.onConnection(con, id);
        }

        con.on("close", () => {
            const meta = this.socketsClients.get(con);
            if (meta && meta.pongTimeoutTimer) {
                clearTimeout(meta.pongTimeoutTimer);
            }
            this.closeConnection(con);
            this.socketsClients.delete(con);
        });

        con.on('message', (bufferedMessage) => {
            this.newMessage(con, id, bufferedMessage);
        });
    }

    closeConnection(con) {
        if (this.onClose && typeof this.onClose === "function") {
            const meta = this.socketsClients.get(con);
            if (!meta) return;
            this.onClose(con, meta.id)
        }
    }

    // Ping all clients; terminate those that didn't respond to the previous ping
    _runHeartbeat() {
        this.socketsClients.forEach((metadata, socket) => {
            if (socket.readyState !== WebSocket.OPEN) {
                return;
            }

            if (!metadata.isAlive) {
                // Did not respond to last ping — terminate
                console.log(`Heartbeat timeout for client ${metadata.id}, terminating`);
                socket.terminate();
                return;
            }

            metadata.isAlive = false;
            socket.ping();

            // Safety: if pong never arrives, terminate after timeout
            if (metadata.pongTimeoutTimer) {
                clearTimeout(metadata.pongTimeoutTimer);
            }
            metadata.pongTimeoutTimer = setTimeout(() => {
                if (!metadata.isAlive && socket.readyState === WebSocket.OPEN) {
                    console.log(`Pong timeout for client ${metadata.id}, terminating`);
                    socket.terminate();
                }
                metadata.pongTimeoutTimer = null;
            }, HEARTBEAT_TIMEOUT_MS);
        });
    }

    // Send a message to all websocket clients
    broadcast(msg) {
        this.forEachClient((client) => {
            client.send(msg)
        })
    }

    forEachClient(callback) {
        this.socketsClients.forEach((metadata, client) => {
            if (client.readyState === WebSocket.OPEN) {
                callback(client, metadata.id, metadata)
            }
        })
    }

    // A message is received from a websocket client
    newMessage(ws, id, bufferedMessage) {
        var messageAsString = bufferedMessage.toString()
        if (this.onMessage && typeof this.onMessage === "function") {
            this.onMessage(ws, id, messageAsString)
        }
    }

    getClientData(id) {
        for (let [client, metadata] of this.socketsClients.entries()) {
            if (metadata.id === id) {
                return metadata;
            }
        }
        return null;
    }

    getClientsIds() {
        let clients = [];
        this.socketsClients.forEach((value, key) => {
            clients.push(value.id);
        });
        return clients;
    }

    getClientsData() {
        let clients = [];
        for (let [client, metadata] of this.socketsClients.entries()) {
            clients.push(metadata);
        }
        return clients;
    }
}

module.exports = Obj
