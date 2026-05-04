'use strict';

// Monitors player inactivity and kicks players that have been idle too long.
// Decoupled from GameLogic and WebSockets — depends only on callbacks (DIP).
class InactivityMonitor {
    /**
     * @param {object} options
     * @param {number} options.inactivityTimeoutMs   - Idle time before kick
     * @param {number} options.checkIntervalMs       - How often to run the check
     * @param {() => string[]} options.getInactive   - Returns list of idle player IDs
     * @param {(id: string) => void} options.onKick  - Called for each kicked player ID
     */
    constructor({ inactivityTimeoutMs, checkIntervalMs, getInactive, onKick }) {
        this._timeoutMs = inactivityTimeoutMs;
        this._intervalMs = checkIntervalMs;
        this._getInactive = getInactive;
        this._onKick = onKick;
        this._timer = null;
    }

    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this._check(), this._intervalMs);
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    _check() {
        const ids = this._getInactive(this._timeoutMs);
        for (const id of ids) {
            console.log(`Kicking player ${id} for inactivity (>${this._timeoutMs / 1000}s idle)`);
            this._onKick(id);
        }
    }
}

module.exports = InactivityMonitor;
