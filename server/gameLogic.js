'use strict';

const { loadMultiplayerLevel } = require('./multiplayerLevelData.js');

const MIN_PLAYERS_TO_START = 2;
const MAX_PLAYERS = 8;
const TARGET_FPS_FALLBACK = 60;
const PLAYER_WIDTH = 20;
const PLAYER_HEIGHT = 20;
const PLAYER_START_X = 32;
const PLAYER_START_Y = 32;
const PLAYER_START_STEP_X = 32;
const PLAYER_START_STEP_Y = 32;
const KEY_CARRY_OFFSET_Y = 6;

const MOVE_SPEED_PER_SECOND = 135;
const ACCELERATION_PER_SECOND = 1200;
const DECELERATION_PER_SECOND = 800;
const JUMP_IMPULSE = 320;
const GRAVITY_PER_SECOND = 1000;
const MAX_FALL_SPEED = 500;
const MOVEMENT_DIRECTION_THRESHOLD = 2;
const VELOCITY_STOP_THRESHOLD = 0.5;
const MAX_COLLISION_SLIDE_ITERATIONS = 4;
const COLLISION_SWEEP_ITERATIONS = 12;
const COLLISION_TIME_BACKOFF = 0.001;
const COLLISION_PROBE_SPACING = 1.0;
const MOVEMENT_EPSILON = 0.0001;
const BLOCK_COLLISION_INSET_X = 1;
const BLOCK_COLLISION_INSET_TOP = 0;
const BLOCK_COLLISION_INSET_BOTTOM = 0;
const PLAYER_COLLISION_ITERATIONS = 4;
const PLAYER_SUPPORT_TOLERANCE = 3;
const PLAYER_STACK_MAX_PENETRATION = 8;
const PLAYER_HORIZONTAL_SPLIT_RATIO = 0.5;
const PLAYER_SUPPORT_MIN_OVERLAP = 4;

// duracion hardcodeada de las fases de la secuencia de victoria, en segundos
const WIN_STAGE_OPENING_SECONDS = 0.85;
// hacemos que la fase de walking dure mas que el fundido a negro del cliente
// (2s) para que el player no se vea frenando antes de quedar oculto
const WIN_STAGE_WALKING_SECONDS = 3.0;
// durante la fase de walking el player camina mas tranquilo, a 1/3 del speed
const WIN_WALK_SPEED_FACTOR = 1 / 3;

const DIRECTIONS = {
    left: { dx: -1, facing: 'left' },
    right: { dx: 1, facing: 'right' },
    none: { dx: 0, facing: 'right' }
};

const LEVEL = loadMultiplayerLevel();
const PLAYER_TEMPLATE = findPlayerTemplate(LEVEL.sprites);
const KEY_TEMPLATE = findKeyTemplate(LEVEL.sprites);
const DOOR_TEMPLATE = findDoorTemplate(LEVEL.sprites);

class GameLogic {
    constructor() {
        this.players = new Map();
        this.tickCounter = 0;
        this.nextJoinOrder = 0;
        this.phase = 'waiting';
        this.lobbyEndsAt = null;
        this.initialStateDirty = true;
        this.keySpawnState = createKeySpawnState(KEY_TEMPLATE);
        this.keyState = {
            ...this.keySpawnState
        };
        this.doorState = createDoorState(DOOR_TEMPLATE);
        this.doorWonAtTick = -1;

        this.layerRuntimeStates = LEVEL.layers.map((layer) => ({
            x: layer.x,
            y: layer.y
        }));
        this.zoneRuntimeStates = LEVEL.zones.map((zone) => ({
            x: zone.x,
            y: zone.y
        }));
        this.zonePreviousRuntimeStates = LEVEL.zones.map((zone) => ({
            x: zone.x,
            y: zone.y
        }));
        this.pathMotionTimeSeconds = 0;

        this.pathRuntimeById = new Map();
        for (const path of LEVEL.paths) {
            const runtime = createPathRuntime(path);
            if (runtime) {
                this.pathRuntimeById.set(path.id, runtime);
            }
        }

        this.pathBindingRuntimes = LEVEL.pathBindings
            .filter((binding) => binding.enabled)
            .map((binding) => {
                const pathRuntime = this.pathRuntimeById.get(binding.pathId);
                if (!pathRuntime) {
                    return null;
                }
                const initial = this.getInitialTargetPosition(binding.targetType, binding.targetIndex);
                if (!initial) {
                    return null;
                }
                return {
                    binding,
                    pathRuntime,
                    initialX: initial.x,
                    initialY: initial.y
                };
            })
            .filter(Boolean);

        this.wallZoneIndices = classifyZoneIndices(['wall', 'ground', 'platform', 'bloque'], LEVEL.zones);
        this.blockLikeZoneIndices = new Set(classifyZoneIndices(['ground', 'platform', 'bloque', 'block'], LEVEL.zones));
    }

    addClient(id) {
        if (this.players.size >= MAX_PLAYERS) {
            return null;
        }
        const spawn = this.getSpawnPosition(this.players.size);
        const player = {
            id,
            name: `Player ${this.players.size + 1}`,
            x: spawn.x,
            y: spawn.y,
            width: PLAYER_WIDTH,
            height: PLAYER_HEIGHT,
            direction: 'none',
            facing: 'right',
            moving: false,
            joinOrder: this.nextJoinOrder++,
            velocityX: 0,
            velocityY: 0,
            onGround: true,
            animationId: PLAYER_TEMPLATE ? PLAYER_TEMPLATE.animationId : '',
            frameIndex: PLAYER_TEMPLATE ? resolveClipStartFrame(PLAYER_TEMPLATE.animationId) : 0,
            flipX: false,
            flipY: false,
            winStage: 'none',
            winStageStartTick: 0,
            lastActivityAt: Date.now()
        };
        this.players.set(id, player);
        this.initialStateDirty = true;

        if (this.players.size === 1) {
            this.startWaitingRoom();
        } else if (this.phase === 'playing') {
            this.resetPlayerForMatch(player, this.players.size - 1);
        }

        return player;
    }

    removeClient(id) {
        this.players.delete(id);
        if (this.keyState.carrierId === id) {
            this.resetKeyState();
        }
        this.initialStateDirty = true;
        if (this.players.size <= 0) {
            this.resetMatch();
            this.nextJoinOrder = 0;
        }
    }

    getPlayerCount() {
        return this.players.size;
    }

    touchActivity(id) {
        const player = this.players.get(id);
        if (player) {
            player.lastActivityAt = Date.now();
        }
    }

    getInactivePlayers(timeoutMs) {
        const now = Date.now();
        const inactive = [];
        for (const player of this.players.values()) {
            if (now - player.lastActivityAt > timeoutMs) {
                inactive.push(player.id);
            }
        }
        return inactive;
    }

    handleMessage(id, msg) {
        try {
            const obj = JSON.parse(msg);
            if (!obj || !obj.type) {
                return false;
            }

            const player = this.players.get(id);
            if (!player) {
                return false;
            }

            player.lastActivityAt = Date.now();

            switch (obj.type) {
            case 'ping':
                // Client heartbeat — activity already stamped above, no state change needed
                return false;
            case 'register':
                {
                    const nextName = sanitizePlayerName(obj.playerName, player.name);
                    if (nextName !== player.name) {
                        player.name = nextName;
                        this.initialStateDirty = true;
                        return true;
                    }
                }
                break;
            case 'direction':
                player.direction = normalizePlatformerDirection(obj.value);
                if (player.direction !== 'none') {
                    player.facing = DIRECTIONS[player.direction].facing;
                }
                break;
            case 'jump':
                if (player.onGround) {
                    player.velocityY = -JUMP_IMPULSE;
                    player.onGround = false;
                    player.animationId = resolvePlatformerAnimationId(player.facing, false, true, false);
                    player.frameIndex = resolveClipStartFrame(player.animationId);
                    return true;
                }
                break;
            case 'restartMatch':
                if (this.phase === 'finished') {
                    this.restartToWaitingRoom();
                    return true;
                }
                break;
            case 'startMatch':
                if (this.phase === 'waiting' && this.players.size >= MIN_PLAYERS_TO_START) {
                    this.startMatch();
                    return true;
                }
                break;
            default:
                break;
            }
        } catch (_) {
        }
        return false;
    }

    updateGame(fps) {
        if (this.players.size <= 0) {
            return;
        }

        const safeFps = Math.max(1, fps || TARGET_FPS_FALLBACK);
        const dtSeconds = 1 / safeFps;
        this.tickCounter = (this.tickCounter + 1) % 1000000;

        this.advanceEnvironment(dtSeconds);

        if (this.phase === 'waiting') {
            return;
        }

        if (this.phase !== 'playing') {
            return;
        }

        this.syncKeyCarrierPosition();
        this.applyWinSequenceInputs();

        for (const player of this.players.values()) {
            this.applyMovingWallCarry(player);
            this.resolveWallPenetration(player);
            const wasOnGround = this.isPlayerOnGround(player);

            const direction = DIRECTIONS[player.direction] || DIRECTIONS.none;
            const speedFactor = player.winStage === 'walking' ? WIN_WALK_SPEED_FACTOR : 1;
            const targetVelocityX = direction.dx * MOVE_SPEED_PER_SECOND * speedFactor;
            const hasInput = player.direction !== 'none';
            const acceleration = ACCELERATION_PER_SECOND;
            const deceleration = DECELERATION_PER_SECOND;
            const maxVelocityDelta = (hasInput ? acceleration : deceleration) * dtSeconds;

            player.velocityX = approach(player.velocityX, targetVelocityX, maxVelocityDelta);
            if (Math.abs(player.velocityX) < VELOCITY_STOP_THRESHOLD) {
                player.velocityX = 0;
            }

            if (wasOnGround && player.velocityY > 0) {
                player.velocityY = 0;
            }
            if (!wasOnGround || player.velocityY < 0) {
                player.velocityY = Math.min(player.velocityY + GRAVITY_PER_SECOND * dtSeconds, MAX_FALL_SPEED);
            }

            const movingLeft = player.velocityX < -MOVEMENT_DIRECTION_THRESHOLD;
            const movingRight = player.velocityX > MOVEMENT_DIRECTION_THRESHOLD;
            if (movingLeft) {
                player.facing = 'left';
            } else if (movingRight) {
                player.facing = 'right';
            }


            const previousX = player.x;
            const previousY = player.y;
            player.previousX = previousX;
            player.previousY = previousY;
            const dx = player.velocityX * dtSeconds;
            const dy = player.velocityY * dtSeconds;
            this.movePlayerWithWallCollisions(player, previousX, previousY, dx, dy);
        }

        this.resolvePlayerCollisions();
        this.tryPickupKey();
        this.tryEnterDoor();
        this.advanceWinSequences(safeFps);
        this.syncKeyCarrierPosition();
        this.syncDoorAnimationFrame(safeFps);

        for (const player of this.players.values()) {
            this.snapPlayerToSupport(player);
            player.moving = player.direction !== 'none' && Math.abs(player.velocityX) > MOVEMENT_DIRECTION_THRESHOLD;
            player.onGround = this.isPlayerOnGround(player);
            if (player.onGround && player.velocityY > 0) {
                player.velocityY = 0;
            }

            const isJumping = !player.onGround && player.velocityY < -50;
            const isFalling = !player.onGround && player.velocityY > 50;
            player.animationId = resolvePlatformerAnimationId(player.facing, player.onGround, isJumping, isFalling);
            player.frameIndex = resolveAnimationFrame(player.animationId, this.tickCounter / safeFps);
        }

    }

    consumeSnapshotState() {
        if (!this.initialStateDirty) {
            return null;
        }
        this.initialStateDirty = false;
        return this.getSnapshotState();
    }

    clearSnapshotDirty() {
        this.initialStateDirty = false;
    }

    getSnapshotState() {
        const players = Array.from(this.players.values()).sort(comparePlayers);
        return {
            level: LEVEL.levelName,
            players: players.map((player) => ({
                id: player.id,
                name: player.name,
                width: player.width,
                height: player.height,
                joinOrder: player.joinOrder
            }))
        };
    }

    getGameplayState() {
        const players = Array.from(this.players.values()).sort(comparePlayers);
        return {
            ...this.getGameplayStateBase(players),
            players: players.map((player) => ({
                ...this.serializeGameplayPlayer(player),
            })),
        };
    }

    getGameplayStateForPlayer(playerId, options = {}) {
        const includeOtherPlayers = options.includeOtherPlayers !== false;
        const includeGems = options.includeGems !== false;
        const players = Array.from(this.players.values()).sort(comparePlayers);
        const selfPlayer = this.players.get(playerId);
        const state = {
            ...this.getGameplayStateBase(players),
            players: players.map((player) => this.serializeGameplayPlayer(player)),
            selfPlayer: selfPlayer ? this.serializeGameplayPlayer(selfPlayer) : null,
        };

        if (includeOtherPlayers) {
            state.otherPlayers = players
                .filter((player) => player.id !== playerId)
                .map((player) => this.serializeGameplayPlayer(player));
        }
        if (includeGems) {
            state.gems = [];
        }

        return state;
    }

    getFullState() {
        return {
            ...this.getSnapshotState(),
            ...this.getGameplayState()
        };
    }

    getGameplayStateBase(players) {
        const countdownSeconds = this.phase === 'waiting' && this.lobbyEndsAt != null
            ? Math.max(0, Math.ceil((this.lobbyEndsAt - Date.now()) / 1000))
            : 0;

        return {
            tickCounter: this.tickCounter,
            phase: this.phase,
            countdownSeconds,
            remainingGems: 0,
            winnerId: '',
            winnerName: '',
            key: this.serializeKeyState(),
            door: this.serializeDoorState(),
            layerTransforms: this.layerRuntimeStates.map((layer, index) => ({
                index,
                x: round2(layer.x),
                y: round2(layer.y)
            })),
            zoneTransforms: this.zoneRuntimeStates.map((zone, index) => ({
                index,
                x: round2(zone.x),
                y: round2(zone.y)
            }))
        };
    }

    serializeGameplayPlayer(player) {
        return {
            id: player.id,
            x: round2(player.x),
            y: round2(player.y),
            direction: player.direction,
            facing: player.facing,
            moving: player.moving,
            velocityY: round2(player.velocityY),
            onGround: player.onGround,
            winStage: player.winStage || 'none'
        };
    }

    startWaitingRoom() {
        this.phase = 'waiting';
        this.lobbyEndsAt = null;
        this.initialStateDirty = true;
        this.resetEnvironmentRuntime();
        this.positionPlayersForStart();
    }

    startMatch() {
        this.phase = 'playing';
        this.winnerId = '';
        this.lobbyEndsAt = null;
        this.resetEnvironmentRuntime();
        this.positionPlayersForStart();
    }

    restartToWaitingRoom() {
        if (this.players.size <= 0) {
            this.resetMatch();
            return;
        }
        this.startWaitingRoom();
    }

    resetMatch() {
        this.tickCounter = 0;
        this.winnerId = '';
        this.phase = 'waiting';
        this.lobbyEndsAt = null;
        this.initialStateDirty = true;
        this.resetEnvironmentRuntime();
    }

    resetEnvironmentRuntime() {
        this.pathMotionTimeSeconds = 0;
        this.layerRuntimeStates = LEVEL.layers.map((layer) => ({
            x: layer.x,
            y: layer.y
        }));
        this.zoneRuntimeStates = LEVEL.zones.map((zone) => ({
            x: zone.x,
            y: zone.y
        }));
        this.zonePreviousRuntimeStates = LEVEL.zones.map((zone) => ({
            x: zone.x,
            y: zone.y
        }));
        this.resetKeyState();
        this.resetDoorState();
        this.doorWonAtTick = -1;
    }

    advanceEnvironment(dtSeconds) {
        for (let i = 0; i < this.zoneRuntimeStates.length; i++) {
            this.zonePreviousRuntimeStates[i].x = this.zoneRuntimeStates[i].x;
            this.zonePreviousRuntimeStates[i].y = this.zoneRuntimeStates[i].y;
        }

        this.pathMotionTimeSeconds += dtSeconds;
        for (const runtime of this.pathBindingRuntimes) {
            const progress = pathProgressAtTime(
                runtime.binding.behavior,
                runtime.binding.durationSeconds,
                this.pathMotionTimeSeconds
            );
            const sample = samplePathAtProgress(runtime.pathRuntime, progress);
            const targetX = runtime.binding.relativeToInitialPosition
                ? runtime.initialX + (sample.x - runtime.pathRuntime.firstPointX)
                : sample.x;
            const targetY = runtime.binding.relativeToInitialPosition
                ? runtime.initialY + (sample.y - runtime.pathRuntime.firstPointY)
                : sample.y;
            this.applyPathTarget(runtime.binding.targetType, runtime.binding.targetIndex, targetX, targetY);
        }
    }

    applyPathTarget(targetType, targetIndex, x, y) {
        if (targetType === 'layer' && this.layerRuntimeStates[targetIndex]) {
            this.layerRuntimeStates[targetIndex].x = x;
            this.layerRuntimeStates[targetIndex].y = y;
            return;
        }
        if (targetType === 'zone' && this.zoneRuntimeStates[targetIndex]) {
            this.zoneRuntimeStates[targetIndex].x = x;
            this.zoneRuntimeStates[targetIndex].y = y;
        }
    }

    getInitialTargetPosition(targetType, targetIndex) {
        if (targetType === 'layer' && LEVEL.layers[targetIndex]) {
            return { x: LEVEL.layers[targetIndex].x, y: LEVEL.layers[targetIndex].y };
        }
        if (targetType === 'zone' && LEVEL.zones[targetIndex]) {
            return { x: LEVEL.zones[targetIndex].x, y: LEVEL.zones[targetIndex].y };
        }
        return null;
    }

    positionPlayersForStart() {
        const players = Array.from(this.players.values()).sort((a, b) => a.joinOrder - b.joinOrder);
        players.forEach((player, index) => {
            this.resetPlayerForMatch(player, index);
        });
    }

    resetPlayerForMatch(player, index) {
        const spawn = this.getSpawnPosition(index);
        player.x = spawn.x;
        player.y = spawn.y;
        player.direction = 'none';
        player.facing = 'right';
        player.moving = false;
        player.winStage = 'none';
        player.winStageStartTick = 0;
        player.velocityX = 0;
        player.velocityY = 0;
        player.score = 0;
        player.gemsCollected = 0;
        player.animationId = PLAYER_TEMPLATE ? PLAYER_TEMPLATE.animationId : '';
        player.frameIndex = PLAYER_TEMPLATE ? resolveClipStartFrame(PLAYER_TEMPLATE.animationId) : 0;
        player.flipX = false;
        player.flipY = false;
        this.resolveWallPenetration(player);
        player.onGround = this.isPlayerOnGround(player);
    }

    resetKeyState() {
        this.keyState = {
            ...this.keySpawnState
        };
    }

    serializeKeyState() {
        return {
            picked: this.keyState.picked,
            carrierId: this.keyState.carrierId,
            x: round2(this.keyState.x),
            y: round2(this.keyState.y),
            width: round2(this.keyState.width),
            height: round2(this.keyState.height)
        };
    }

    resetDoorState() {
        this.doorState = createDoorState(DOOR_TEMPLATE);
    }

    serializeDoorState() {
        return {
            enabled: this.doorState.enabled,
            opened: this.doorState.opened,
            carrierId: this.doorState.carrierId,
            spriteIndex: this.doorState.spriteIndex,
            animationId: this.doorState.animationId,
            openedAtTick: this.doorState.openedAtTick,
            frameIndex: this.doorState.frameIndex,
            x: round2(this.doorState.x),
            y: round2(this.doorState.y),
            width: round2(this.doorState.width),
            height: round2(this.doorState.height)
        };
    }

    tryPickupKey() {
        if (!this.keyState.enabled || this.keyState.picked) {
            return;
        }

        const keyRect = rectAt(
            this.keyState.x,
            this.keyState.y,
            this.keyState.width,
            this.keyState.height
        );
        for (const player of this.players.values()) {
            const playerRect = this.playerCollisionRect(player);
            if (!playerRect || !rectsOverlap(playerRect, keyRect)) {
                continue;
            }
            this.keyState.picked = true;
            this.keyState.carrierId = player.id;
            this.syncKeyCarrierPosition();
            return;
        }
    }

    // gestionamos los players que tocan la puerta. El portador la abre y se queda
    // esperando la animacion (opening). Cualquier otro player que la toque cuando
    // ya esta abierta entra directamente en walking. Cada player gana por separado.
    tryEnterDoor() {
        if (!this.doorState.enabled) {
            return;
        }

        const doorRect = rectAt(
            this.doorState.x,
            this.doorState.y,
            this.doorState.width,
            this.doorState.height
        );

        for (const player of this.players.values()) {
            if (player.winStage !== 'none') {
                continue;
            }
            const playerRect = this.playerCollisionRect(player);
            if (!playerRect || !rectsOverlap(playerRect, doorRect)) {
                continue;
            }

            if (this.doorState.opened) {
                // puerta ya abierta: el player pasa directamente a caminar
                player.winStage = 'walking';
                player.winStageStartTick = this.tickCounter;
                continue;
            }

            // si la puerta no esta abierta, solo el portador de la llave puede abrirla
            if (this.keyState.picked && this.keyState.carrierId === player.id) {
                this.doorState.opened = true;
                this.doorState.carrierId = player.id;
                this.doorState.openedAtTick = this.tickCounter;
                this.syncDoorAnimationFrame(Math.max(1, TARGET_FPS_FALLBACK));
                player.winStage = 'opening';
                player.winStageStartTick = this.tickCounter;
            }
        }
    }

    // forzamos los inputs de los players que estan en la secuencia de victoria
    // para que no se puedan controlar mientras dura la animacion
    applyWinSequenceInputs() {
        for (const player of this.players.values()) {
            if (player.winStage === 'opening') {
                player.direction = 'none';
                player.velocityX = 0;
            } else if (player.winStage === 'walking') {
                player.direction = 'right';
                player.facing = 'right';
            }
        }
    }

    // avanzamos las fases de la secuencia para cada player de forma individual.
    // Cuando todos los players estan en 'won' marcamos la partida como finished
    // para que aparezca el boton de restart globalmente.
    advanceWinSequences(fps) {
        const safeFps = Math.max(1, fps || TARGET_FPS_FALLBACK);
        const openingTicks = Math.max(1, Math.round(WIN_STAGE_OPENING_SECONDS * safeFps));
        const walkingTicks = Math.max(1, Math.round(WIN_STAGE_WALKING_SECONDS * safeFps));

        for (const player of this.players.values()) {
            if (player.winStage === 'opening') {
                if (this.tickCounter - player.winStageStartTick >= openingTicks) {
                    player.winStage = 'walking';
                    player.winStageStartTick = this.tickCounter;
                }
            } else if (player.winStage === 'walking') {
                if (this.tickCounter - player.winStageStartTick >= walkingTicks) {
                    player.winStage = 'won';
                    player.winStageStartTick = this.tickCounter;
                    if (!this.winnerId) {
                        this.winnerId = player.id;
                        this.doorWonAtTick = this.tickCounter;
                    }
                }
            }
        }

        // si todos los players activos han ganado pasamos la partida a finished
        if (this.phase === 'playing' && this.players.size > 0) {
            let allWon = true;
            for (const player of this.players.values()) {
                if (player.winStage !== 'won') {
                    allWon = false;
                    break;
                }
            }
            if (allWon) {
                this.phase = 'finished';
            }
        }
    }

    syncDoorAnimationFrame(fps) {
        if (!this.doorState.enabled) {
            return;
        }

        if (!this.doorState.opened) {
            this.doorState.frameIndex = resolveClipStartFrame(this.doorState.animationId);
            return;
        }

        const safeFps = Math.max(1, fps || TARGET_FPS_FALLBACK);
        const elapsedSeconds = Math.max(0, (this.tickCounter - this.doorState.openedAtTick) / safeFps);
        this.doorState.frameIndex = resolveAnimationFrame(this.doorState.animationId, elapsedSeconds);
    }

    syncKeyCarrierPosition() {
        if (!this.keyState.enabled || !this.keyState.picked) {
            return;
        }

        const carrier = this.players.get(this.keyState.carrierId);
        if (!carrier) {
            this.resetKeyState();
            return;
        }

        this.keyState.x = carrier.x + (carrier.width - this.keyState.width) * 0.5;
        this.keyState.y = carrier.y - this.keyState.height - KEY_CARRY_OFFSET_Y;
    }

    getSpawnPosition(index) {
        const maxRows = Math.max(
            1,
            Math.floor((LEVEL.worldHeight - PLAYER_START_Y - PLAYER_HEIGHT) / PLAYER_START_STEP_Y) + 1
        );
        const maxColumns = Math.max(
            1,
            Math.floor((LEVEL.worldWidth * 0.25 - PLAYER_START_X - PLAYER_WIDTH) / PLAYER_START_STEP_X) + 1
        );
        const row = index % maxRows;
        const column = Math.floor(index / maxRows) % maxColumns;
        return {
            x: PLAYER_START_X + column * PLAYER_START_STEP_X,
            y: PLAYER_START_Y + row * PLAYER_START_STEP_Y
        };
    }

    movePlayerWithWallCollisions(player, previousX, previousY, deltaX, deltaY) {
        let currentX = previousX;
        let currentY = previousY;
        let remainingX = deltaX;
        let remainingY = deltaY;

        for (let i = 0; i < MAX_COLLISION_SLIDE_ITERATIONS; i++) {
            if (Math.abs(remainingX) <= MOVEMENT_EPSILON &&
                Math.abs(remainingY) <= MOVEMENT_EPSILON) {
                break;
            }

            const targetX = currentX + remainingX;
            const targetY = currentY + remainingY;
            if (!this.wouldCollideBlocked(player, targetX, targetY)) {
                currentX = targetX;
                currentY = targetY;
                break;
            }

            const hitT = this.findCollisionTimeOnSegment(player, currentX, currentY, remainingX, remainingY);
            const safeT = clamp(hitT - COLLISION_TIME_BACKOFF, 0, 1);
            const probeT = clamp(hitT + COLLISION_TIME_BACKOFF, 0, 1);

            const segmentStartX = currentX;
            const segmentStartY = currentY;
            currentX = segmentStartX + remainingX * safeT;
            currentY = segmentStartY + remainingY * safeT;

            const probeX = segmentStartX + remainingX * probeT;
            const probeY = segmentStartY + remainingY * probeT;
            const normal = this.estimateCollisionNormalAt(player, probeX, probeY, remainingX, remainingY);

            const remainingScale = Math.max(0, 1 - safeT);
            let slideX = remainingX * remainingScale;
            let slideY = remainingY * remainingScale;
            const intoWall = slideX * normal.x + slideY * normal.y;
            if (intoWall < 0) {
                slideX -= intoWall * normal.x;
                slideY -= intoWall * normal.y;
            }

            remainingX = slideX;
            remainingY = slideY;
        }

        player.x = currentX;
        player.y = currentY;
        if (this.wouldCollideBlocked(player, player.x, player.y)) {
            player.x = previousX;
            player.y = previousY;
            this.resolveWallPenetration(player);
        }
    }

    resolveWallPenetration(player) {
        if (!this.wouldCollideBlocked(player, player.x, player.y)) {
            return;
        }

        for (const zoneIndex of this.wallZoneIndices) {
            if (!this.collidesWithZoneAt(player, zoneIndex, player.x, player.y)) {
                continue;
            }

            const zoneRect = this.zoneRectAtIndex(zoneIndex);
            const playerRect = this.playerCollisionRect(player);
            if (!playerRect) {
                return;
            }

            const penLeft = playerRect.right - zoneRect.left;
            const penRight = zoneRect.right - playerRect.left;
            const penTop = playerRect.bottom - zoneRect.top;
            const penBottom = zoneRect.bottom - playerRect.top;

            let minPen = penLeft;
            let pushX = -penLeft;
            let pushY = 0;

            if (penRight < minPen) {
                minPen = penRight;
                pushX = penRight;
                pushY = 0;
            }
            if (penTop < minPen) {
                minPen = penTop;
                pushX = 0;
                pushY = -penTop;
            }
            if (penBottom < minPen) {
                minPen = penBottom;
                pushX = 0;
                pushY = penBottom;
            }

            player.x += pushX;
            player.y += pushY;
            player.x = clamp(player.x, 0, Math.max(0, LEVEL.worldWidth - player.width));
            player.y = clamp(player.y, 0, Math.max(0, LEVEL.worldHeight - player.height));

            if (!this.wouldCollideBlocked(player, player.x, player.y)) {
                return;
            }
        }
    }

    applyMovingWallCarry(player) {
        let bestDeltaMagnitudeSq = 0;
        let carryX = 0;
        let carryY = 0;

        for (const zoneIndex of this.wallZoneIndices) {
            if (!this.collidesWithZoneAt(player, zoneIndex, player.x, player.y)) {
                continue;
            }

            const deltaX = this.zoneDeltaX(zoneIndex);
            const deltaY = 0;
            if (Math.abs(deltaX) <= MOVEMENT_EPSILON &&
                Math.abs(deltaY) <= MOVEMENT_EPSILON) {
                continue;
            }

            const candidateX = clamp(
                player.x + deltaX,
                0,
                Math.max(0, LEVEL.worldWidth - player.width)
            );
            const candidateY = clamp(
                player.y + deltaY,
                0,
                Math.max(0, LEVEL.worldHeight - player.height)
            );

            const stillCollides = this.collidesWithZoneAt(player, zoneIndex, candidateX, candidateY);
            if (stillCollides) {
                continue;
            }

            const deltaMagnitudeSq = deltaX * deltaX + deltaY * deltaY;
            if (deltaMagnitudeSq > bestDeltaMagnitudeSq) {
                bestDeltaMagnitudeSq = deltaMagnitudeSq;
                carryX = candidateX - player.x;
                carryY = candidateY - player.y;
            }
        }

        if (bestDeltaMagnitudeSq > 0) {
            player.x += carryX;
            player.y += carryY;
        }
    }

    findCollisionTimeOnSegment(player, startX, startY, deltaX, deltaY) {
        if (this.wouldCollideBlocked(player, startX, startY)) {
            return 0;
        }
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance <= MOVEMENT_EPSILON) {
            return 1;
        }

        const probeCount = Math.max(1, Math.ceil(distance / COLLISION_PROBE_SPACING));
        let low = 0;
        let high = 1;
        let hasCollision = false;
        for (let i = 1; i <= probeCount; i++) {
            const t = i / probeCount;
            const sampleX = startX + deltaX * t;
            const sampleY = startY + deltaY * t;
            if (this.wouldCollideBlocked(player, sampleX, sampleY)) {
                high = t;
                hasCollision = true;
                break;
            }
            low = t;
        }

        if (!hasCollision) {
            return 1;
        }

        for (let i = 0; i < COLLISION_SWEEP_ITERATIONS; i++) {
            const mid = (low + high) * 0.5;
            const midX = startX + deltaX * mid;
            const midY = startY + deltaY * mid;
            if (this.wouldCollideBlocked(player, midX, midY)) {
                high = mid;
            } else {
                low = mid;
            }
        }
        return high;
    }

    estimateCollisionNormalAt(player, x, y, movementX, movementY) {
        const playerRect = rectAt(x, y, player.width, player.height);
        let bestScore = Number.POSITIVE_INFINITY;
        let bestNormalX = 0;
        let bestNormalY = 0;

        for (const zoneIndex of this.wallZoneIndices) {
            if (!this.collidesWithZoneAt(player, zoneIndex, x, y)) {
                continue;
            }

            const zoneRect = this.zoneRectAtIndex(zoneIndex);
            const relativeX = movementX - this.zoneDeltaX(zoneIndex);
            const relativeY = movementY - this.zoneDeltaY(zoneIndex);
            const relativeSpeedSq = relativeX * relativeX + relativeY * relativeY;
            const hasRelativeMotion = relativeSpeedSq > MOVEMENT_EPSILON * MOVEMENT_EPSILON;

            const consider = (penetration, normalX, normalY) => {
                if (!Number.isFinite(penetration) || penetration <= MOVEMENT_EPSILON) {
                    return;
                }
                let score = penetration;
                if (hasRelativeMotion) {
                    const relativeDot = relativeX * normalX + relativeY * normalY;
                    if (relativeDot >= 0) {
                        score += 1000000;
                    }
                }
                if (score < bestScore) {
                    bestScore = score;
                    bestNormalX = normalX;
                    bestNormalY = normalY;
                }
            };

            consider(playerRect.right - zoneRect.left, -1, 0);
            consider(zoneRect.right - playerRect.left, 1, 0);
            consider(playerRect.bottom - zoneRect.top, 0, -1);
            consider(zoneRect.bottom - playerRect.top, 0, 1);
        }

        if (Number.isFinite(bestScore)) {
            return { x: bestNormalX, y: bestNormalY };
        }

        const moveLen = Math.sqrt(movementX * movementX + movementY * movementY);
        if (moveLen > MOVEMENT_EPSILON) {
            return { x: -movementX / moveLen, y: -movementY / moveLen };
        }
        return { x: 0, y: -1 };
    }

    collidesWithZoneAt(player, zoneIndex, x, y) {
        const zoneRect = this.zoneRectAtIndex(zoneIndex);
        for (const hitBoxRect of this.playerHitBoxRectsAt(player, x, y)) {
            if (rectsOverlap(hitBoxRect, zoneRect)) {
                return true;
            }
        }
        return false;
    }

    wouldCollideBlocked(player, x, y) {
        for (const zoneIndex of this.wallZoneIndices) {
            const zoneRect = this.zoneRectAtIndex(zoneIndex);
            for (const hitBoxRect of this.playerHitBoxRectsAt(player, x, y)) {
                if (rectsOverlap(hitBoxRect, zoneRect)) {
                    return true;
                }
            }
        }
        if (!this.doorState.enabled || this.doorState.opened) {
            return false;
        }
        // si el player lleva la llave, la puerta no bloquea para que pueda entrar y abrirla
        if (this.keyState.picked && this.keyState.carrierId === player.id) {
            return false;
        }
        const doorRect = rectAt(this.doorState.x, this.doorState.y, this.doorState.width, this.doorState.height);
        for (const hitBoxRect of this.playerHitBoxRectsAt(player, x, y)) {
            if (rectsOverlap(hitBoxRect, doorRect)) {
                return true;
            }
        }
        return false;
    }

    zoneRectAtIndex(zoneIndex) {
        const zone = LEVEL.zones[zoneIndex];
        const runtime = this.zoneRuntimeStates[zoneIndex] || zone;
        const zoneRect = rectAt(runtime.x, runtime.y, zone.width, zone.height);
        if (!this.blockLikeZoneIndices.has(zoneIndex)) {
            return zoneRect;
        }
        return insetRect(
            zoneRect,
            BLOCK_COLLISION_INSET_X,
            BLOCK_COLLISION_INSET_TOP,
            BLOCK_COLLISION_INSET_X,
            BLOCK_COLLISION_INSET_BOTTOM
        );
    }

    zoneDeltaX(zoneIndex) {
        const current = this.zoneRuntimeStates[zoneIndex];
        const previous = this.zonePreviousRuntimeStates[zoneIndex];
        if (!current || !previous) {
            return 0;
        }
        return current.x - previous.x;
    }

    zoneDeltaY(zoneIndex) {
        const current = this.zoneRuntimeStates[zoneIndex];
        const previous = this.zonePreviousRuntimeStates[zoneIndex];
        if (!current || !previous) {
            return 0;
        }
        return current.y - previous.y;
    }

    playerCollisionRect(player) {
        return this.playerCollisionRectAt(player, player.x, player.y);
    }

    playerCollisionRectAt(player, x, y) {
        return unionRects(this.playerHitBoxRectsAt(player, x, y));
    }

    playerHitBoxRectsAt(player, x, y) {
        const clip = LEVEL.animationClips.get(player.animationId);
        const hitBoxes = activeHitBoxesForClip(clip, player.frameIndex);
        if (!hitBoxes || hitBoxes.length <= 0) {
            return [];
        }
        return hitBoxes.map((hitBox) =>
            hitBoxRectAt(x, y, player.width, player.height, hitBox, player.flipX, player.flipY)
        );
    }

    isPlayerOnGround(player) {
        return this.findPlayerSupport(player) != null;
    }

    findPlayerSupport(player) {
        const playerRect = this.playerCollisionRect(player);
        if (!playerRect) {
            return null;
        }
        let bestSupportTop = null;

        for (const zoneIndex of this.wallZoneIndices) {
            const zoneRect = this.zoneRectAtIndex(zoneIndex);
            if (!isStandingOnRect(playerRect, zoneRect, PLAYER_SUPPORT_TOLERANCE, PLAYER_SUPPORT_MIN_OVERLAP)) {
                continue;
            }
            if (bestSupportTop == null || zoneRect.top < bestSupportTop) {
                bestSupportTop = zoneRect.top;
            }
        }

        for (const other of this.players.values()) {
            if (other.id === player.id) {
                continue;
            }
            const otherRect = this.playerCollisionRect(other);
            if (!otherRect) {
                continue;
            }
            if (!isStandingOnRect(playerRect, otherRect, PLAYER_SUPPORT_TOLERANCE, PLAYER_SUPPORT_MIN_OVERLAP)) {
                continue;
            }
            if (bestSupportTop == null || otherRect.top < bestSupportTop) {
                bestSupportTop = otherRect.top;
            }
        }

        const floorTop = LEVEL.worldHeight;
        if (playerRect.bottom >= floorTop - 1) {
            bestSupportTop = bestSupportTop == null ? floorTop : Math.min(bestSupportTop, floorTop);
        }

        return bestSupportTop == null ? null : { top: bestSupportTop };
    }

    snapPlayerToSupport(player) {
        const support = this.findPlayerSupport(player);
        if (!support) {
            return false;
        }
        const physicsRect = this.playerCollisionRectAt(player, player.x, player.y);
        if (!physicsRect) {
            return false;
        }
        const targetY = support.top - physicsRect.height - (physicsRect.top - player.y);
        if (Math.abs(player.y - targetY) <= PLAYER_SUPPORT_TOLERANCE) {
            player.y = targetY;
            return true;
        }
        return false;
    }

    resolvePlayerCollisions() {
        const players = Array.from(this.players.values());
        if (players.length <= 1) {
            return;
        }

        for (let iteration = 0; iteration < PLAYER_COLLISION_ITERATIONS; iteration++) {
            let resolvedAny = false;
            for (let i = 0; i < players.length; i++) {
                for (let j = i + 1; j < players.length; j++) {
                    const a = players[i];
                    const b = players[j];
                    if (this.resolvePlayerPairCollision(a, b)) {
                        resolvedAny = true;
                    }
                }
            }
            if (!resolvedAny) {
                break;
            }
        }
    }

    resolvePlayerPairCollision(a, b) {
        const aRect = this.playerCollisionRect(a);
        const bRect = this.playerCollisionRect(b);
        if (!aRect || !bRect || !rectsOverlap(aRect, bRect)) {
            return false;
        }

        const overlapLeft = aRect.right - bRect.left;
        const overlapRight = bRect.right - aRect.left;
        const overlapTop = aRect.bottom - bRect.top;
        const overlapBottom = bRect.bottom - aRect.top;
        const overlapX = Math.min(overlapLeft, overlapRight);
        const overlapY = Math.min(overlapTop, overlapBottom);

        if (overlapX <= MOVEMENT_EPSILON || overlapY <= MOVEMENT_EPSILON) {
            return false;
        }

        const aPreviousRect = this.playerCollisionRectAt(a, a.previousX ?? a.x, a.previousY ?? a.y);
        const bPreviousRect = this.playerCollisionRectAt(b, b.previousX ?? b.x, b.previousY ?? b.y);
        if (!aPreviousRect || !bPreviousRect) {
            return false;
        }
        const aPreviousBottom = aPreviousRect.bottom;
        const bPreviousBottom = bPreviousRect.bottom;
        const aFromAbove =
            aPreviousBottom <= bRect.top + PLAYER_SUPPORT_TOLERANCE &&
            overlapX >= PLAYER_SUPPORT_MIN_OVERLAP &&
            a.velocityY >= b.velocityY;
        const bFromAbove =
            bPreviousBottom <= aRect.top + PLAYER_SUPPORT_TOLERANCE &&
            overlapX >= PLAYER_SUPPORT_MIN_OVERLAP &&
            b.velocityY >= a.velocityY;

        if (aFromAbove && overlapY <= PLAYER_STACK_MAX_PENETRATION) {
            const aPhysicsRect = this.playerCollisionRectAt(a, a.x, a.y);
            if (!aPhysicsRect) {
                return false;
            }
            a.y = bRect.top - aPhysicsRect.height - (aPhysicsRect.top - a.y);
            if (a.velocityY > b.velocityY) {
                a.velocityY = b.velocityY;
            }
            this.resolveWallPenetration(a);
            return true;
        }
        if (bFromAbove && overlapY <= PLAYER_STACK_MAX_PENETRATION) {
            const bPhysicsRect = this.playerCollisionRectAt(b, b.x, b.y);
            if (!bPhysicsRect) {
                return false;
            }
            b.y = aRect.top - bPhysicsRect.height - (bPhysicsRect.top - b.y);
            if (b.velocityY > a.velocityY) {
                b.velocityY = a.velocityY;
            }
            this.resolveWallPenetration(b);
            return true;
        }

        if (overlapX < overlapY) {
            const push = overlapX * PLAYER_HORIZONTAL_SPLIT_RATIO;
            if (aRect.left < bRect.left) {
                a.x -= push;
                b.x += overlapX - push;
            } else {
                a.x += push;
                b.x -= overlapX - push;
            }
            a.velocityX = 0;
            b.velocityX = 0;
        } else {
            const push = overlapY * 0.5;
            if (aRect.top < bRect.top) {
                a.y -= push;
                b.y += overlapY - push;
            } else {
                a.y += push;
                b.y -= overlapY - push;
            }
            if (a.velocityY > 0) {
                a.velocityY = 0;
            }
            if (b.velocityY > 0) {
                b.velocityY = 0;
            }
        }

        this.clampPlayerToWorld(a);
        this.clampPlayerToWorld(b);
        this.resolveWallPenetration(a);
        this.resolveWallPenetration(b);
        return true;
    }

    clampPlayerToWorld(player) {
        player.x = clamp(player.x, 0, Math.max(0, LEVEL.worldWidth - player.width));
        player.y = clamp(player.y, 0, Math.max(0, LEVEL.worldHeight - player.height));
    }

}

function createPathRuntime(path) {
    if (!path || !Array.isArray(path.points) || path.points.length < 2) {
        return null;
    }

    const segments = [];
    let totalLength = 0;
    for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1];
        const b = path.points[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length <= 0) {
            continue;
        }
        segments.push({
            ax: a.x,
            ay: a.y,
            bx: b.x,
            by: b.y,
            length,
            startLength: totalLength,
            endLength: totalLength + length
        });
        totalLength += length;
    }

    if (segments.length <= 0 || totalLength <= 0) {
        return null;
    }

    return {
        firstPointX: path.points[0].x,
        firstPointY: path.points[0].y,
        totalLength,
        segments
    };
}

function samplePathAtProgress(pathRuntime, progress) {
    if (!pathRuntime) {
        return { x: 0, y: 0 };
    }

    const clamped = clamp(progress, 0, 1);
    const targetLength = clamped * pathRuntime.totalLength;
    for (const segment of pathRuntime.segments) {
        if (targetLength <= segment.endLength) {
            const localLength = targetLength - segment.startLength;
            const alpha = segment.length <= 0 ? 0 : localLength / segment.length;
            return {
                x: lerp(segment.ax, segment.bx, alpha),
                y: lerp(segment.ay, segment.by, alpha)
            };
        }
    }

    const last = pathRuntime.segments[pathRuntime.segments.length - 1];
    return { x: last.bx, y: last.by };
}

function pathProgressAtTime(behavior, durationSeconds, timeSeconds) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    const t = Math.max(0, timeSeconds);
    const normalizedBehavior = String(behavior || '').trim().toLowerCase();
    if (normalizedBehavior === 'ping_pong' || normalizedBehavior === 'pingpong') {
        const cycle = durationSeconds * 2;
        const cycleTime = t % cycle;
        if (cycleTime <= durationSeconds) {
            return cycleTime / durationSeconds;
        }
        return 1 - ((cycleTime - durationSeconds) / durationSeconds);
    }
    if (normalizedBehavior === 'once') {
        return clamp(t / durationSeconds, 0, 1);
    }
    return (t % durationSeconds) / durationSeconds;
}

function classifyZoneIndices(tokens, zones) {
    const indices = [];
    for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];
        const type = normalize(zone.type);
        const name = normalize(zone.name);
        if (containsAny(type, tokens) || containsAny(name, tokens)) {
            indices.push(i);
        }
    }
    return indices;
}

function resolveFacing(previousFacing, up, down, left, right) {
    if (up && left) {
        return 'upLeft';
    }
    if (up && right) {
        return 'upRight';
    }
    if (down && left) {
        return 'downLeft';
    }
    if (down && right) {
        return 'downRight';
    }
    if (up) {
        return 'up';
    }
    if (down) {
        return 'down';
    }
    if (left) {
        return 'left';
    }
    if (right) {
        return 'right';
    }
    return previousFacing || 'down';
}

function comparePlayers(a, b) {
    return a.joinOrder - b.joinOrder;
}

function sanitizePlayerName(value, fallback) {
    const name = String(value || '').replace(/\s+/g, ' ').trim();
    if (!name) {
        return fallback;
    }
    return name.substring(0, 18);
}

function findPlayerTemplate(sprites) {
    for (const sprite of sprites) {
        const type = normalize(sprite.type);
        const name = normalize(sprite.name);
        if (containsAny(type, ['player', 'hero', 'heroi', 'foxy']) ||
            containsAny(name, ['player', 'hero', 'heroi', 'foxy'])) {
            return sprite;
        }
    }
    return sprites[0] || null;
}

function findKeyTemplate(sprites) {
    for (const sprite of sprites) {
        const type = normalize(sprite.type);
        const name = normalize(sprite.name);
        if (containsAny(type, ['key', 'llave', 'netankey']) ||
            containsAny(name, ['key', 'llave', 'netankey'])) {
            return sprite;
        }
    }
    return null;
}

function findDoorTemplate(sprites) {
    for (let index = 0; index < sprites.length; index++) {
        const sprite = sprites[index];
        const type = normalize(sprite.type);
        const name = normalize(sprite.name);
        if (containsAny(type, ['door', 'netandoor']) ||
            containsAny(name, ['door', 'netandoor'])) {
            return {
                sprite,
                index
            };
        }
    }
    return null;
}

function createKeySpawnState(template) {
    return {
        enabled: !!template,
        picked: false,
        carrierId: '',
        x: template ? Number(template.x || 0) : 0,
        y: template ? Number(template.y || 0) : 0,
        width: template ? Math.max(1, Number(template.width || 16)) : 16,
        height: template ? Math.max(1, Number(template.height || 16)) : 16
    };
}

function createDoorState(template) {
    const sprite = template ? template.sprite : null;
    return {
        enabled: !!sprite,
        opened: false,
        carrierId: '',
        spriteIndex: template ? template.index : -1,
        animationId: sprite ? String(sprite.animationId || '') : '',
        openedAtTick: 0,
        frameIndex: sprite ? resolveClipStartFrame(sprite.animationId) : 0,
        x: sprite ? Number(sprite.x || 0) : 0,
        y: sprite ? Number(sprite.y || 0) : 0,
        width: sprite ? Math.max(1, Number(sprite.width || 27)) : 27,
        height: sprite ? Math.max(1, Number(sprite.height || 39)) : 39
    };
}

function resolvePlayerAnimationId(facing, moving) {
    const animationName = resolvePlayerAnimationName(facing, moving);
    for (const clip of LEVEL.animationClips.values()) {
        if (normalize(clip.name) === normalize(animationName)) {
            return clip.id;
        }
    }
    return PLAYER_TEMPLATE ? PLAYER_TEMPLATE.animationId : '';
}

function resolvePlatformerAnimationId(facing, onGround, isJumping, isFalling) {
    let animationName = '';
    if (!onGround && isJumping) {
        animationName = 'Character Jump ' + (facing === 'left' ? 'Left' : 'Right');
    } else if (!onGround && isFalling) {
        animationName = 'Character Fall ' + (facing === 'left' ? 'Left' : 'Right');
    } else if (!onGround) {
        animationName = 'Character Jump ' + (facing === 'left' ? 'Left' : 'Right');
    } else {
        animationName = 'Character Idle ' + (facing === 'left' ? 'Left' : 'Right');
    }
    for (const clip of LEVEL.animationClips.values()) {
        if (normalize(clip.name) === normalize(animationName)) {
            return clip.id;
        }
    }
    return PLAYER_TEMPLATE ? PLAYER_TEMPLATE.animationId : '';
}

function resolvePlayerAnimationName(facing, moving) {
    if (facing === 'left') {
        return moving ? 'Character Walk Left' : 'Character Idle Left';
    }
    return moving ? 'Character Walk Right' : 'Character Idle Right';
}

function resolveAnimationFrame(animationId, elapsedSeconds) {
    const clip = LEVEL.animationClips.get(animationId);
    if (!clip) {
        return 0;
    }
    const start = Math.max(0, clip.startFrame);
    const end = Math.max(start, clip.endFrame);
    const span = Math.max(1, end - start + 1);
    const ticks = Math.floor(Math.max(0, elapsedSeconds) * clip.fps);
    const offset = clip.loop ? positiveMod(ticks, span) : Math.min(ticks, span - 1);
    return start + offset;
}

function resolveClipStartFrame(animationId) {
    const clip = LEVEL.animationClips.get(animationId);
    return clip ? Math.max(0, clip.startFrame) : 0;
}

function activeHitBoxesForClip(clip, frameIndex) {
    if (!clip) {
        return null;
    }
    const frameRig = clip.frameRigs.get(frameIndex);
    if (frameRig && frameRig.hitBoxes.length > 0) {
        return frameRig.hitBoxes;
    }
    if (clip.hitBoxes.length > 0) {
        return clip.hitBoxes;
    }
    return null;
}

function hitBoxRectAt(x, y, width, height, hitBox, flipX, flipY) {
    let normalizedX = hitBox.x;
    let normalizedY = hitBox.y;
    if (flipX) {
        normalizedX = 1 - hitBox.x - hitBox.width;
    }
    if (flipY) {
        normalizedY = 1 - hitBox.y - hitBox.height;
    }
    return rectAt(
        x + normalizedX * width,
        y + normalizedY * height,
        hitBox.width * width,
        hitBox.height * height
    );
}

function unionRects(rects) {
    if (!rects || rects.length <= 0) {
        return null;
    }
    let minLeft = Number.POSITIVE_INFINITY;
    let minTop = Number.POSITIVE_INFINITY;
    let maxRight = Number.NEGATIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;
    for (const rect of rects) {
        minLeft = Math.min(minLeft, rect.left);
        minTop = Math.min(minTop, rect.top);
        maxRight = Math.max(maxRight, rect.right);
        maxBottom = Math.max(maxBottom, rect.bottom);
    }
    if (!Number.isFinite(minLeft) || !Number.isFinite(minTop) ||
        !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
        return null;
    }
    return rectAt(minLeft, minTop, maxRight - minLeft, maxBottom - minTop);
}

function positiveMod(value, divisor) {
    const mod = value % divisor;
    return mod < 0 ? mod + divisor : mod;
}

function normalizePlatformerDirection(value) {
    const direction = String(value || '').trim();
    if (direction === 'left' || direction === 'right' || direction === 'none') {
        return direction;
    }
    return 'none';
}

function normalizeDirection(value) {
    return normalizePlatformerDirection(value);
}

function rectAt(x, y, width, height) {
    return {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        width,
        height
    };
}

function insetRect(rect, insetLeft, insetTop, insetRight, insetBottom) {
    const width = Math.max(0, rect.width - insetLeft - insetRight);
    const height = Math.max(0, rect.height - insetTop - insetBottom);
    return rectAt(rect.left + insetLeft, rect.top + insetTop, width, height);
}

function rectsOverlap(a, b) {
    return a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top;
}

function isStandingOnRect(subjectRect, supportRect, tolerance, minOverlap) {
    const overlap = Math.min(subjectRect.right, supportRect.right) - Math.max(subjectRect.left, supportRect.left);
    return overlap >= minOverlap &&
        subjectRect.bottom >= supportRect.top - tolerance &&
        subjectRect.bottom <= supportRect.top + tolerance;
}

function approach(current, target, maxDelta) {
    if (current < target) {
        return Math.min(current + maxDelta, target);
    }
    if (current > target) {
        return Math.max(current - maxDelta, target);
    }
    return target;
}

function containsAny(value, needles) {
    for (const needle of needles) {
        if (needle && value.includes(needle)) {
            return true;
        }
    }
    return false;
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(from, to, alpha) {
    return from + (to - from) * alpha;
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

module.exports = GameLogic;
