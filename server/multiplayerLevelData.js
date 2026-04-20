'use strict';

const fs = require('fs');
const path = require('path');

const LEVEL_ROOT = path.resolve(__dirname, 'assets/levels');

function loadMultiplayerLevel() {
    const root = loadJson(path.join(LEVEL_ROOT, 'game_data.json'));
    const level = (root.levels || [])[0] || {};
    const zonesRoot = loadJson(path.join(LEVEL_ROOT, level.zonesFile));
    const pathsRoot = loadJson(path.join(LEVEL_ROOT, level.pathsFile));
    const animationsRoot = root.animationsFile
        ? loadJson(path.join(LEVEL_ROOT, root.animationsFile))
        : { animations: [] };
    const mediaSizes = loadMediaSizes(root.mediaAssets || []);
    const animationClips = loadAnimationClips(animationsRoot.animations || [], mediaSizes);

    const layers = (level.layers || []).map((layer) => ({
        name: String(layer.name || ''),
        x: Number(layer.x || 0),
        y: Number(layer.y || 0),
        tileWidth: Number(layer.tilesWidth || 16),
        tileHeight: Number(layer.tilesHeight || 16),
        tileMapFile: String(layer.tileMapFile || '')
    }));
    const zones = (zonesRoot.zones || []).map((zone) => ({
        name: String(zone.name || ''),
        type: String(zone.type || ''),
        gameplayData: String(zone.gameplayData || ''),
        x: Number(zone.x || 0),
        y: Number(zone.y || 0),
        width: Number(zone.width || 0),
        height: Number(zone.height || 0)
    }));
    const sprites = (level.sprites || []).map((sprite) => ({
        name: String(sprite.name || ''),
        type: String(sprite.type || ''),
        imageFile: String(sprite.imageFile || ''),
        animationId: String(sprite.animationId || ''),
        x: Number(sprite.x || 0),
        y: Number(sprite.y || 0),
        width: Number(sprite.width || 0),
        height: Number(sprite.height || 0),
        flipX: Boolean(sprite.flipX),
        flipY: Boolean(sprite.flipY)
    }));
    const paths = (pathsRoot.paths || []).map((pathItem) => ({
        id: String(pathItem.id || ''),
        points: (pathItem.points || []).map((point) => ({
            x: Number(point.x || 0),
            y: Number(point.y || 0)
        }))
    }));
    const pathBindings = (pathsRoot.pathBindings || []).map((binding) => ({
        id: String(binding.id || ''),
        pathId: String(binding.pathId || ''),
        targetType: String(binding.targetType || ''),
        targetIndex: Number(binding.targetIndex || 0),
        behavior: String(binding.behavior || 'loop'),
        enabled: Boolean(binding.enabled),
        relativeToInitialPosition: Boolean(binding.relativeToInitialPosition),
        durationSeconds: Math.max(0.001, Number(binding.durationMs || 0) / 1000)
    }));

    const gemLayer = layers.find((layer) => normalize(layer.name) === 'gems zone');
    const gemTileMapRoot = gemLayer && gemLayer.tileMapFile
        ? loadJson(path.join(LEVEL_ROOT, gemLayer.tileMapFile))
        : { tileMap: [] };
    const gemCells = buildGemCells(gemLayer, gemTileMapRoot.tileMap || []);

    let worldWidth = Number(level.viewportX || 0) + Number(level.viewportWidth || 320);
    let worldHeight = Number(level.viewportY || 0) + Number(level.viewportHeight || 180);

    for (const layer of layers) {
        const tileMap = layer.tileMapFile
            ? loadJson(path.join(LEVEL_ROOT, layer.tileMapFile)).tileMap || []
            : [];
        const cols = tileMap.reduce(
            (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
            0
        );
        const rows = tileMap.length;
        worldWidth = Math.max(worldWidth, layer.x + cols * layer.tileWidth);
        worldHeight = Math.max(worldHeight, layer.y + rows * layer.tileHeight);
    }
    for (const zone of zones) {
        worldWidth = Math.max(worldWidth, zone.x + zone.width);
        worldHeight = Math.max(worldHeight, zone.y + zone.height);
    }

    return {
        levelName: String(level.name || 'All together now'),
        worldWidth,
        worldHeight,
        layers,
        zones,
        sprites,
        paths,
        pathBindings,
        gemCells,
        animationClips
    };
}

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildGemCells(gemLayer, tileMap) {
    if (!gemLayer) {
        return [];
    }
    const cols = tileMap.reduce(
        (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
        0
    );
    const rows = tileMap.length;
    const cells = [];
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            cells.push({
                x: gemLayer.x + col * gemLayer.tileWidth + (gemLayer.tileWidth - 15) * 0.5,
                y: gemLayer.y + row * gemLayer.tileHeight + (gemLayer.tileHeight - 15) * 0.5
            });
        }
    }
    return cells;
}

function normalize(value) {
    return String(value || '').trim().toLowerCase();
}

function loadMediaSizes(mediaAssets) {
    const sizes = new Map();
    for (const asset of mediaAssets) {
        const fileName = String(asset.fileName || '');
        const tileWidth = Number(asset.tileWidth || 0);
        const tileHeight = Number(asset.tileHeight || 0);
        if (!fileName || tileWidth <= 0 || tileHeight <= 0) {
            continue;
        }
        sizes.set(fileName, {
            width: tileWidth,
            height: tileHeight
        });
    }
    return sizes;
}

function loadAnimationClips(animations, mediaSizes) {
    const clips = new Map();
    for (const animation of animations) {
        const id = String(animation.id || '');
        if (!id) {
            continue;
        }
        const mediaFile = String(animation.mediaFile || '');
        const mediaSize = mediaSizes.get(mediaFile) || { width: 0, height: 0 };
        const clip = {
            id,
            name: String(animation.name || id),
            mediaFile,
            frameWidth: mediaSize.width,
            frameHeight: mediaSize.height,
            startFrame: Math.max(0, Number(animation.startFrame || 0)),
            endFrame: Math.max(0, Number(animation.endFrame || 0)),
            fps: Math.max(0.001, Number(animation.fps || 8)),
            loop: animation.loop !== false,
            anchorX: finiteOrDefault(animation.anchorX, 0.5),
            anchorY: finiteOrDefault(animation.anchorY, 0.5),
            hitBoxes: parseHitBoxes(animation.hitBoxes || []),
            frameRigs: new Map()
        };

        for (const frameRig of animation.frameRigs || []) {
            const frame = Number(frameRig.frame);
            if (!Number.isFinite(frame) || frame < 0) {
                continue;
            }
            clip.frameRigs.set(frame, {
                anchorX: finiteOrDefault(frameRig.anchorX, clip.anchorX),
                anchorY: finiteOrDefault(frameRig.anchorY, clip.anchorY),
                hitBoxes: parseHitBoxes(frameRig.hitBoxes || [])
            });
        }
        clips.set(id, clip);
    }
    return clips;
}

function parseHitBoxes(hitBoxes) {
    return hitBoxes
        .map((hitBox) => ({
            x: finiteOrDefault(hitBox.x, 0),
            y: finiteOrDefault(hitBox.y, 0),
            width: finiteOrDefault(hitBox.width, 0),
            height: finiteOrDefault(hitBox.height, 0)
        }))
        .filter((hitBox) => hitBox.width > 0 && hitBox.height > 0);
}

function finiteOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

module.exports = { loadMultiplayerLevel };
