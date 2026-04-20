'use strict';

const DEFAULT_BACKPRESSURE_THRESHOLD = 64 * 1024;

class UtilsGameMessages {
    constructor(webSockets, options = {}) {
        this.webSockets = webSockets;
        this.backpressureThreshold = Number(options.backpressureThreshold) > 0
            ? Number(options.backpressureThreshold)
            : DEFAULT_BACKPRESSURE_THRESHOLD;
        this.clientQueues = new Map();
    }

    addClient(id) {
        this.getClientQueue(id);
    }

    removeClient(id) {
        this.clientQueues.delete(id);
    }

    enqueueReplaceable(socket, id, key, msg) {
        const queue = this.getClientQueue(id);
        queue.replaceableByKey.set(key, msg);
        this.flushClient(socket, id);
    }

    enqueueReliable(socket, id, msg) {
        const queue = this.getClientQueue(id);
        queue.reliable.push(msg);
        this.flushClient(socket, id);
    }

    flushAll() {
        this.webSockets.forEachClient((socket, id) => {
            this.flushClient(socket, id);
        });
    }

    flushClient(socket, id) {
        if (!this.webSockets.isOpen(socket)) {
            return false;
        }

        const queue = this.clientQueues.get(id);
        if (!queue) {
            return true;
        }

        while (queue.reliable.length > 0) {
            if (this.webSockets.hasBackpressure(socket, this.backpressureThreshold)) {
                return false;
            }
            const msg = queue.reliable.shift();
            this.webSockets.send(socket, msg);
        }

        for (const [key, msg] of queue.replaceableByKey.entries()) {
            if (this.webSockets.hasBackpressure(socket, this.backpressureThreshold)) {
                return false;
            }
            this.webSockets.send(socket, msg);
            queue.replaceableByKey.delete(key);
        }

        return !this.webSockets.hasBackpressure(socket, this.backpressureThreshold);
    }

    getClientQueue(id) {
        let queue = this.clientQueues.get(id);
        if (!queue) {
            queue = {
                reliable: [],
                replaceableByKey: new Map()
            };
            this.clientQueues.set(id, queue);
        }
        return queue;
    }
}

module.exports = UtilsGameMessages;
