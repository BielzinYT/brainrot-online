// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Lógica do Jogo
const players = {};
const brainRots = {};
const mapWidth = 1200;
const mapHeight = 800;
const availableBases = [1,2,3,4,5,6]; // Track available base numbers
let adminEventActive = false;
let ownerId = null; // Track the owner (first player)
const bots = {}; // Store bot instances
let gameMode = 'online'; // Default mode

// Propriedades do Tapete Transportador (agora vertical)
const CONVEYOR_BELT_PROPS = {
    x: mapWidth / 2 - 100 / 2, // Centraliza no mapa
    y: 0, // Inicia no topo do mapa (ou ajusta se quiser mais abaixo)
    width: 100,
    height: mapHeight, // Vai de cima a baixo do mapa
    speed: 1 // Velocidade de movimento dos Brain Rots no tapete (ajustada para ser um pouco mais rápida)
};

// Base positions
const BASE_POSITIONS = {
    'base-1': { x: 50 + 250/2, y: 50 + 150/2 },
    'base-2': { x: mapWidth - 50 - 250/2, y: 50 + 150/2 },
    'base-3': { x: 50 + 250/2, y: 325 + 150/2 },
    'base-4': { x: mapWidth - 50 - 250/2, y: 325 + 150/2 },
    'base-5': { x: 50 + 250/2, y: mapHeight - 50 - 150/2 },
    'base-6': { x: mapWidth - 50 - 250/2, y: mapHeight - 50 - 150/2 }
};

const BRAIN_ROT_TYPES = [
    { name: 'Skibidi Toilet', rarity: 'Comum', price: 10, sellPrice: 5, generationRate: 0.1, class: 'common' },
    { name: 'Sigma Face', rarity: 'Comum', price: 12, sellPrice: 6, generationRate: 0.12, class: 'common' },
    { name: 'Cbum', rarity: 'Raro', price: 50, sellPrice: 25, generationRate: 0.5, class: 'rare' },
    { name: 'Baby Gronk', rarity: 'Raro', price: 60, sellPrice: 30, generationRate: 0.6, class: 'rare' },
    { name: 'NPC Streamer', rarity: 'Épico', price: 200, sellPrice: 100, generationRate: 2, class: 'epic' },
    { name: 'The Weeknd', rarity: 'Épico', price: 250, sellPrice: 125, generationRate: 2.5, class: 'epic' },
    { name: 'Bebê Dançando', rarity: 'Lendário', price: 1000, sellPrice: 500, generationRate: 10, class: 'legendary' },
    { name: 'Gato Cansado', rarity: 'Lendário', price: 1200, sellPrice: 600, generationRate: 12, class: 'legendary' },
    { name: 'Morte ao Vivo', rarity: 'Mítico', price: 2500, sellPrice: 1250, generationRate: 25, class: 'mythic' },
    { name: 'Brain Rot God', rarity: 'Deus', price: 5000, sellPrice: 2500, generationRate: 50, class: 'god' },
    { name: 'OG Meme', rarity: 'OG', price: 8000, sellPrice: 4000, generationRate: 80, class: 'og' },
    { name: 'Brainrot Secreto', rarity: 'Secreto', price: 15000, sellPrice: 7500, generationRate: 150, class: 'secret' },
    { name: 'Animação 3D do Minecraft', rarity: 'Galactic', price: 25000, sellPrice: 12500, generationRate: 250, class: 'galactic' },
    { name: 'Sopa de Letrinhas', rarity: 'Galactic', price: 30000, sellPrice: 15000, generationRate: 300, class: 'galactic' },
    { name: 'GigaChad', rarity: 'Cosmic', price: 50000, sellPrice: 25000, generationRate: 500, class: 'cosmic' },
    { name: 'Meme do Mago', rarity: 'Cosmic', price: 60000, sellPrice: 30000, generationRate: 600, class: 'cosmic' },
    { name: 'Dancinha do Tik Tok', rarity: 'Transcendental', price: 150000, sellPrice: 75000, generationRate: 1500, class: 'transcendental' },
    { name: 'Morte do Jogo do Roblox', rarity: 'Transcendental', price: 180000, sellPrice: 90000, generationRate: 1800, class: 'transcendental' },
    { name: 'Portal para Outra Dimensão', rarity: 'Paradoxal', price: 500000, sellPrice: 250000, generationRate: 5000, class: 'paradoxal' },
    { name: 'O Começo de Tudo', rarity: 'Paradoxal', price: 750000, sellPrice: 375000, generationRate: 7500, class: 'paradoxal' },
    { name: 'O Fim da Jornada', rarity: 'Eterno', price: 1500000, sellPrice: 750000, generationRate: 15000, class: 'eternal' },
    { name: 'Eterno Retorno', rarity: 'Eterno', price: 2000000, sellPrice: 1000000, generationRate: 20000, class: 'eternal' },
    { name: 'O Vazio do Universo', rarity: 'Divino', price: 5000000, sellPrice: 2500000, generationRate: 50000, class: 'divine' },
    { name: 'A Essência da Existência', rarity: 'Divino', price: 10000000, sellPrice: 5000000, generationRate: 100000, class: 'divine' },
    { name: 'O Guardião do Tempo', rarity: 'Místico', price: 25000000, sellPrice: 12500000, generationRate: 250000, class: 'mystic' },
    { name: 'O Código da Realidade', rarity: 'Místico', price: 50000000, sellPrice: 25000000, generationRate: 500000, class: 'mystic' },
    { name: 'A Lenda de Outro Mundo', rarity: 'Lendário', price: 100000000, sellPrice: 50000000, generationRate: 1000000, class: 'legendary-new' },
    { name: 'O Deus Supremo', rarity: 'Lendário', price: 200000000, sellPrice: 100000000, generationRate: 2000000, class: 'legendary-new' },
    { name: 'Fragmento do Imortal', rarity: 'Imortal', price: 500000000, sellPrice: 250000000, generationRate: 5000000, class: 'immortal' },
    { name: 'O Sussurro do Caos', rarity: 'Imortal', price: 1000000000, sellPrice: 500000000, generationRate: 10000000, class: 'immortal' },
    { name: 'A Ascensão Absoluta', rarity: 'Absoluto', price: 5000000000, sellPrice: 2500000000, generationRate: 50000000, class: 'absolute' },
    { name: 'O Fim de Tudo', rarity: 'Absoluto', price: 10000000000, sellPrice: 5000000000, generationRate: 100000000, class: 'absolute' },
    { name: 'Chuva de Metade', rarity: 'Cosmológico', price: 500000000000, sellPrice: 250000000000, generationRate: 500000000, class: 'cosmologic' },
    { name: 'A Criança do Apocalipse', rarity: 'Cosmológico', price: 1000000000000, sellPrice: 500000000000, generationRate: 1000000000, class: 'cosmologic' },
    { name: 'O Coração do Universo', rarity: 'Final', price: 50000000000000, sellPrice: 25000000000000, generationRate: 50000000000, class: 'final' },
    { name: 'O Fim da História', rarity: 'Final', price: 100000000000000, sellPrice: 50000000000000, generationRate: 100000000000, class: 'final' },
    { name: 'Dança do Fanum Tax', rarity: 'Comum', price: 15, sellPrice: 7, generationRate: 0.15, class: 'common' },
    { name: 'Rizzler Supremo', rarity: 'Raro', price: 70, sellPrice: 35, generationRate: 0.7, class: 'rare' },
    { name: 'Ohio Mode Activated', rarity: 'Épico', price: 300, sellPrice: 150, generationRate: 3, class: 'epic' },
    { name: 'Skibidi Rizz', rarity: 'Lendário', price: 1500, sellPrice: 750, generationRate: 15, class: 'legendary' },
    { name: 'Brainrot Overload', rarity: 'Mítico', price: 3000, sellPrice: 1500, generationRate: 30, class: 'mythic' },
    { name: 'Sigma Male Grindset', rarity: 'Deus', price: 6000, sellPrice: 3000, generationRate: 60, class: 'god' },
    { name: 'Fanum Tax Collector', rarity: 'OG', price: 10000, sellPrice: 5000, generationRate: 100, class: 'og' },
    { name: 'Rizz God Emperor', rarity: 'Galactic', price: 35000, sellPrice: 17500, generationRate: 350, class: 'galactic' },
    { name: 'Ohio Sigma King', rarity: 'Cosmic', price: 70000, sellPrice: 35000, generationRate: 700, class: 'cosmic' },
    { name: 'Brainrot Apocalypse', rarity: 'Transcendental', price: 200000, sellPrice: 100000, generationRate: 2000, class: 'transcendental' },
    { name: 'Infinite Rizz Loop', rarity: 'Paradoxal', price: 1000000, sellPrice: 500000, generationRate: 10000, class: 'paradoxal' },
    { name: 'Sigma Rule #1', rarity: 'Eterno', price: 3000000, sellPrice: 1500000, generationRate: 30000, class: 'eternal' },
    { name: 'Fanum Tax Empire', rarity: 'Divino', price: 15000000, sellPrice: 7500000, generationRate: 150000, class: 'divine' },
    { name: 'Rizz Dimension', rarity: 'Místico', price: 30000000, sellPrice: 15000000, generationRate: 300000, class: 'mystic' },
    { name: 'Ohio Overlord', rarity: 'Imortal', price: 1500000000, sellPrice: 750000000, generationRate: 15000000, class: 'immortal' },
    { name: 'Brainrot Singularity', rarity: 'Absoluto', price: 10000000000000, sellPrice: 5000000000000, generationRate: 100000000000, class: 'absolute' }
];


function getRandomRarity() {
    let rarityChances = {
        'Comum': 0.50,
        'Raro': 0.25,
        'Épico': 0.15,
        'Lendário': 0.05,
        'Mítico': 0.02,
        'Deus': 0.015,
        'OG': 0.01,
        'Secreto': 0.005,
        'Galactic': 0.003,
        'Cosmic': 0.002,
        'Transcendental': 0.001,
        'Paradoxal': 0.0005,
        'Eterno': 0.0002,
        'Divino': 0.0001,
        'Místico': 0.00005,
        'Lendário-new': 0.00001,
        'Imortal': 0.000005,
        'Absoluto': 0.000001,
        'Cosmológico': 0.0000005,
        'Final': 0.0000001
    };

    if (adminEventActive) {
        // Boost rare chances during admin event
        rarityChances = {
            'Comum': 0.20,
            'Raro': 0.20,
            'Épico': 0.15,
            'Lendário': 0.10,
            'Mítico': 0.08,
            'Deus': 0.07,
            'OG': 0.06,
            'Secreto': 0.05,
            'Galactic': 0.04,
            'Cosmic': 0.03,
            'Transcendental': 0.01,
            'Paradoxal': 0.005,
            'Eterno': 0.002,
            'Divino': 0.001,
            'Místico': 0.0005,
            'Lendário-new': 0.0001,
            'Imortal': 0.00005,
            'Absoluto': 0.00001,
            'Cosmológico': 0.000005,
            'Final': 0.000001
        };
    }

    let randomValue = Math.random();
    let cumulativeChance = 0;

    for (const rarity in rarityChances) {
        cumulativeChance += rarityChances[rarity];
        if (randomValue <= cumulativeChance) {
            return rarity;
        }
    }
    return 'Comum'; // Fallback
}

function spawnBrainRot() {
    const rotId = `rot-${Date.now()}-${Math.floor(Math.random() * 1000)}`; // ID mais robusto
    const randomRarity = getRandomRarity();
    const filteredRots = BRAIN_ROT_TYPES.filter(rot => rot.rarity === randomRarity);
    const rotType = filteredRots[Math.floor(Math.random() * filteredRots.length)];

    // Posição horizontal aleatória dentro da largura do tapete
    const randomXOffset = Math.random() * (CONVEYOR_BELT_PROPS.width - 40); // 40 é a largura do item

    brainRots[rotId] = {
        id: rotId,
        x: CONVEYOR_BELT_PROPS.x + randomXOffset, // Posição X aleatória dentro do tapete
        y: CONVEYOR_BELT_PROPS.y, // Posição Y inicial no topo do tapete
        name: rotType.name,
        class: rotType.class,
        rarity: rotType.rarity, // Adiciona a raridade ao objeto para o cliente renderizar
        owner: null,
        targetBase: null
    };
}

function spawnBots() {
    const botCount = 5; // Spawn 5 bots
    for (let i = 0; i < botCount; i++) {
        if (availableBases.length === 0) break;

        const baseNumber = availableBases.shift();
        const baseId = `base-${baseNumber}`;
        const botId = `bot-${baseNumber}`;

        const botData = {
            x: mapWidth / 4,
            y: mapHeight / 2,
            id: botId,
            username: `Bot ${baseNumber}`,
            baseId: baseId,
            baseNumber: baseNumber,
            inventory: [],
            money: 250,
            baseLocked: false,
            baseLockTime: 0,
            lastMoveTime: Date.now(),
            lastPosition: { x: mapWidth / 4, y: mapHeight / 2 },
            isBot: true
        };

        players[botId] = botData;
        bots[botId] = botData;
    }

    // Send updated players to all clients
    io.emit('updatePlayers', players);
    io.emit('updateInventories', players);
    io.emit('updateMoney', players);
}

// Spawna um Brain Rot a cada 1.5 segundos (ajustado para mais frequência)
setInterval(spawnBrainRot, 1500);

function updateBotBehavior(bot) {
    // Find closest brainrot that bot can afford
    let closestRot = null;
    let closestDist = Infinity;

    for (const rotId in brainRots) {
        const rot = brainRots[rotId];
        if (rot.owner) continue; // Already owned

        const rotType = BRAIN_ROT_TYPES.find(type => type.name === rot.name);
        if (!rotType || bot.money < rotType.price) continue; // Can't afford

        const dist = Math.sqrt((bot.x - rot.x) ** 2 + (bot.y - rot.y) ** 2);
        if (dist < closestDist) {
            closestDist = dist;
            closestRot = rot;
        }
    }

    if (closestRot && closestDist < 100) { // Within pickup range
        // Move towards brainrot
        const dx = closestRot.x - bot.x;
        const dy = closestRot.y - bot.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
            bot.x += (dx / dist) * 3; // Bot speed
            bot.y += (dy / dist) * 3;
        } else {
            // Pick up the brainrot
            const rotType = BRAIN_ROT_TYPES.find(type => type.name === closestRot.name);
            if (rotType && bot.money >= rotType.price && bot.inventory.length < 6) {
                bot.money -= rotType.price;
                closestRot.owner = bot.id;
                closestRot.targetBase = bot.baseId;
                bot.inventory.push({
                    id: closestRot.id,
                    name: closestRot.name,
                    rarity: closestRot.rarity,
                    class: closestRot.class
                });
                io.emit('updateBrainRots', brainRots);
                io.emit('updateMoney', players);
                io.emit('updateInventories', players);
            }
        }
    } else {
        // Random movement or steal attempt
        if (Math.random() < 0.3) { // 30% chance to try stealing
            // Find a random player to steal from
            const playerIds = Object.keys(players).filter(id => id !== bot.id && !players[id].isBot);
            if (playerIds.length > 0) {
                const targetId = playerIds[Math.floor(Math.random() * playerIds.length)];
                const target = players[targetId];
                if (target && target.inventory.length > 0 && !target.baseLocked) {
                    const rotIndex = Math.floor(Math.random() * target.inventory.length);
                    const stolenRot = target.inventory.splice(rotIndex, 1)[0];
                    bot.inventory.push(stolenRot);
                    io.emit('updateInventories', players);
                }
            }
        } else {
            // Random movement
            const directions = [
                { dx: 3, dy: 0 },   // Right
                { dx: -3, dy: 0 },  // Left
                { dx: 0, dy: 3 },   // Down
                { dx: 0, dy: -3 },  // Up
                { dx: 2, dy: 2 },   // Diagonal
                { dx: -2, dy: 2 },
                { dx: 2, dy: -2 },
                { dx: -2, dy: -2 }
            ];
            const dir = directions[Math.floor(Math.random() * directions.length)];
            bot.x += dir.dx;
            bot.y += dir.dy;

            // Keep within bounds
            bot.x = Math.max(0, Math.min(mapWidth - 30, bot.x));
            bot.y = Math.max(0, Math.min(mapHeight - 30, bot.y));
        }
    }

    // Update bot position for clients
    io.emit('updatePlayers', players);
}

// Money generation
setInterval(() => {
    for (const playerId in players) {
        const player = players[playerId];
        let totalGeneration = 0;
        player.inventory.forEach(rot => {
            const rotType = BRAIN_ROT_TYPES.find(type => type.name === rot.name);
            if (rotType) {
                totalGeneration += rotType.generationRate;
            }
        });
        player.money += totalGeneration;
    }
    io.emit('updateMoney', players);
}, 1000); // Every second

// Bot behavior
setInterval(() => {
    if (gameMode === 'ai') {
        for (const botId in bots) {
            const bot = bots[botId];
            if (!bot) continue;

            // Bot actions
            updateBotBehavior(bot);
        }
    }
}, 2000); // Every 2 seconds

// Loop de atualização do servidor
setInterval(() => {
    for (const rotId in brainRots) {
        const rot = brainRots[rotId];
        if (rot.owner && rot.targetBase) {
            // Move towards base
            const target = BASE_POSITIONS[rot.targetBase];
            const dx = target.x - rot.x;
            const dy = target.y - rot.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) {
                // Reached base, add to inventory if space
                const player = players[rot.owner];
                if (player && player.inventory.length < 6) {
                    player.inventory.push({
                        id: rot.id,
                        name: rot.name,
                        rarity: rot.rarity,
                        class: rot.class
                    });
                    io.emit('updateInventories', players);
                }
                delete brainRots[rotId];
            } else {
                const speed = 2;
                rot.x += (dx / dist) * speed;
                rot.y += (dy / dist) * speed;
            }
        } else if (!rot.owner) {
            rot.y += CONVEYOR_BELT_PROPS.speed; // Move o Brain Rot para baixo

            // Se o Brain Rot sair da parte inferior do mapa, remove-o
            if (rot.y > mapHeight) { // Usar mapHeight para ir até o fim da tela
                delete brainRots[rotId];
            }
        }
    }
    io.emit('updateBrainRots', brainRots);
}, 1000 / 60); // Atualiza 60 vezes por segundo


io.on('connection', (socket) => {
    console.log('Um novo jogador se conectou:', socket.id);

    socket.on('joinGame', (data) => {
        const { username, mode } = data;
        gameMode = mode;

        // Handle different game modes
        if (mode === 'solo') {
            // Solo mode: only 1 player allowed
            if (Object.keys(players).length > 0) {
                socket.emit('serverFull', 'Modo Solo: Apenas 1 jogador permitido!');
                socket.disconnect();
                return;
            }
        } else if (mode === 'online') {
            // Online mode: normal multiplayer
            if (availableBases.length === 0) {
                socket.emit('serverFull', 'Servidor cheio! Máximo 6 jogadores.');
                socket.disconnect();
                return;
            }
        } else if (mode === 'ai') {
            // AI mode: player + bots
            if (availableBases.length === 0) {
                socket.emit('serverFull', 'Servidor cheio! Máximo 6 jogadores.');
                socket.disconnect();
                return;
            }
        }

        // Set owner if first player
        if (ownerId === null) {
            ownerId = socket.id;
        }

        // Assign the lowest available base
        const baseNumber = availableBases.shift();
        const baseId = `base-${baseNumber}`;

        // Create new player with initial state
        const playerData = {
            x: mapWidth / 4,
            y: mapHeight / 2,
            id: socket.id,
            username: username,
            baseId: baseId,
            baseNumber: baseNumber,
            inventory: [],
            money: 250,
            baseLocked: false,
            baseLockTime: 0,
            lastMoveTime: Date.now(),
            lastPosition: { x: mapWidth / 4, y: mapHeight / 2 }
        };

        players[socket.id] = playerData;

        socket.emit('updatePlayers', players);
        socket.emit('updateBrainRots', brainRots);
        socket.emit('assignBase', {
            baseId,
            playerId: socket.id,
            baseNumber,
            isOwner: baseNumber === 1,
            dataRestored: false
        });

        // Send inventory and money updates
        setTimeout(() => {
            io.emit('updateInventories', players);
            io.emit('updateMoney', players);
            socket.emit('updateInventories', players);
            socket.emit('updateMoney', players);
        }, 100);

        socket.broadcast.emit('updatePlayers', players);

        // If AI mode, spawn bots after player joins
        if (mode === 'ai') {
            spawnBots();
        }
    });

    socket.on('playerMove', (data) => {
        const player = players[socket.id];
        if (player) {
            // Validate input
            if (typeof data.dx !== 'number' || typeof data.dy !== 'number' ||
                Math.abs(data.dx) > 15 || Math.abs(data.dy) > 15) {
                socket.emit('moveRejected', 'Movimento inválido detectado.');
                return;
            }

            // Rate limiting (max 50 moves per second for smoother movement)
            const now = Date.now();
            if (now - player.lastMoveTime < 20) { // ~50 FPS
                return; // Too fast, ignore
            }
            player.lastMoveTime = now;

            // Speed validation - allow faster movement
            const newX = player.x + data.dx;
            const newY = player.y + data.dy;
            const distance = Math.sqrt((newX - player.lastPosition.x) ** 2 + (newY - player.lastPosition.y) ** 2);

            if (distance > 10) { // Max 10 pixels per move (increased from 5)
                socket.emit('moveRejected', 'Movimento muito rápido detectado.');
                return;
            }

            player.x = newX;
            player.y = newY;
            player.lastPosition = { x: newX, y: newY };

            // Boundary validation
            player.x = Math.max(0, Math.min(mapWidth - 30, player.x));
            player.y = Math.max(0, Math.min(mapHeight - 30, player.y));

            io.emit('updatePlayers', players);
        }
    });

    socket.on('pickUpBrainRot', (data) => {
        const player = players[socket.id];
        if (!player) return;

        // Validate input
        if (!data.rotId || typeof data.rotId !== 'string') {
            socket.emit('pickupFailed', 'Dados inválidos.');
            return;
        }

        const rot = brainRots[data.rotId];
        if (rot && !rot.owner) {
            const rotType = BRAIN_ROT_TYPES.find(type => type.name === rot.name);
            if (rotType && player.money >= rotType.price) {
                player.money -= rotType.price;
                rot.owner = socket.id;
                rot.targetBase = player.baseId;
                io.emit('updateBrainRots', brainRots);
                io.emit('updateMoney', players);
            } else {
                socket.emit('pickupFailed', 'Dinheiro insuficiente!');
            }
        }
    });

    socket.on('stealBrainRot', (data) => {
        const player = players[socket.id];
        if (!player) return;

        // Validate input
        if (!data.targetPlayerId || !data.rotId || typeof data.targetPlayerId !== 'string' || typeof data.rotId !== 'string') {
            socket.emit('stealFailed', 'Dados inválidos.');
            return;
        }

        const thief = players[socket.id];
        const target = players[data.targetPlayerId];
        if (thief && target) {
            // Check if target base is locked
            if (target.baseLocked && Date.now() < target.baseLockTime) {
                socket.emit('stealFailed', 'Base bloqueada! Tente novamente mais tarde.');
                return;
            }
            const rotIndex = target.inventory.findIndex(rot => rot.id === data.rotId);
            if (rotIndex !== -1) {
                const stolenRot = target.inventory.splice(rotIndex, 1)[0];
                thief.inventory.push(stolenRot);
                io.emit('updateInventories', players);
            }
        }
    });

    socket.on('lockBase', () => {
        const player = players[socket.id];
        if (player && !player.baseLocked) {
            player.baseLocked = true;
            player.baseLockTime = Date.now() + 60000; // 60 seconds
            io.emit('updateBaseLocks', players);
            // Auto-unlock after 60 seconds
            setTimeout(() => {
                player.baseLocked = false;
                io.emit('updateBaseLocks', players);
            }, 60000);
        }
    });

    socket.on('sellBrainRot', (data) => {
        const player = players[socket.id];
        if (!player) return;

        // Validate input
        if (!data.rotId || typeof data.rotId !== 'string') {
            socket.emit('sellFailed', 'Dados inválidos.');
            return;
        }

        const rotIndex = player.inventory.findIndex(rot => rot.id === data.rotId);
        if (rotIndex !== -1) {
            const soldRot = player.inventory.splice(rotIndex, 1)[0];
            const rotType = BRAIN_ROT_TYPES.find(type => type.name === soldRot.name);
            if (rotType) {
                player.money += rotType.sellPrice;
            }
            io.emit('updateInventories', players);
            io.emit('updateMoney', players);
        }
    });

    socket.on('triggerAdminEvent', (data) => {
        // Only allow player with base 1 (owner)
        const player = players[socket.id];
        if (player && player.baseNumber === 1) {
            const duration = data.duration || 30000; // Default 30s
            adminEventActive = !adminEventActive;
            io.emit('adminEvent', { active: adminEventActive, duration: duration });
            if (adminEventActive) {
                // Auto-disable after duration
                setTimeout(() => {
                    adminEventActive = false;
                    io.emit('adminEvent', { active: false });
                }, duration);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Um jogador se desconectou:', socket.id);
        if (players[socket.id]) {
            const player = players[socket.id];
            const baseNumber = player.baseNumber;

            // Clear brainrots from base visually for all clients
            io.emit('clearBaseBrainrots', { baseId: player.baseId });

            // Send inventory update to clear the base slots
            io.emit('updateInventories', players);

            // Make base available again
            availableBases.push(baseNumber);
            availableBases.sort();

            // Remove from bots if it's a bot
            if (bots[socket.id]) {
                delete bots[socket.id];
            }

            delete players[socket.id];
        }
        io.emit('updatePlayers', players);
    });
});

http.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
