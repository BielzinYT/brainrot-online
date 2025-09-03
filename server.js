// server.js
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});
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

// Base upgrade system
const BASE_UPGRADES = {
    capacity: {
        levels: [6, 8, 10, 12, 15], // Max inventory slots
        costs: [500, 1500, 4000, 10000, 25000]
    },
    generation: {
        levels: [1.0, 1.25, 1.5, 2.0, 3.0], // Generation multiplier
        costs: [1000, 3000, 8000, 20000, 50000]
    }
};

// Daily quests system
const DAILY_QUESTS = [
    { id: 'collect_10', name: 'Coletor Iniciante', description: 'Colete 10 Brain Rots', reward: 100, target: 10, type: 'collect' },
    { id: 'collect_25', name: 'Coletor Experiente', description: 'Colete 25 Brain Rots', reward: 250, target: 25, type: 'collect' },
    { id: 'sell_5', name: 'Vendedor', description: 'Venda 5 Brain Rots', reward: 150, target: 5, type: 'sell' },
    { id: 'steal_3', name: 'Ladrão Ardiloso', description: 'Roube 3 Brain Rots', reward: 200, target: 3, type: 'steal' },
    { id: 'upgrade_1', name: 'Construtor', description: 'Faça 1 upgrade na base', reward: 300, target: 1, type: 'upgrade' },
    { id: 'money_1000', name: 'Capitalista', description: 'Ganhe $1,000', reward: 500, target: 1000, type: 'money' }
];

function generateDailyQuests() {
    // Return 3 random quests for the day
    const shuffled = [...DAILY_QUESTS].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 3);
}

function checkQuestCompletion(player, actionType, currentValue) {
    const completedQuests = [];

    player.quests.daily.forEach(quest => {
        if (quest.type === actionType && !player.quests.completed.includes(quest.id)) {
            if (currentValue >= quest.target) {
                // Quest completed!
                player.quests.completed.push(quest.id);
                player.money += quest.reward;
                player.stats.totalMoneyEarned += quest.reward;
                completedQuests.push(quest);

                console.log(`Player ${player.username} completed quest: ${quest.name} (+$${quest.reward})`);
            }
        }
    });

    // Notify player of completed quests
    if (completedQuests.length > 0) {
        const playerSocket = io.sockets.sockets.get(player.id);
        if (playerSocket) {
            completedQuests.forEach(quest => {
                playerSocket.emit('questCompleted', {
                    quest: quest,
                    reward: quest.reward,
                    newMoney: player.money
                });
            });
        }
    }
}

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

// AI functions removed - AI mode eliminated

// Spawna um Brain Rot a cada 1.5 segundos (ajustado para mais frequência)
setInterval(spawnBrainRot, 1500);

// AI functions removed - AI mode eliminated

// Money generation and cleanup system
setInterval(() => {
    try {
        const currentTime = Date.now();
        const inactivePlayers = [];

        for (const playerId in players) {
            const player = players[playerId];

            // Check for inactive players (no heartbeat for 30 seconds)
            if (player.lastHeartbeat && currentTime - player.lastHeartbeat > 30000) {
                console.log(`Player ${player.username} marked as inactive`);
                inactivePlayers.push(playerId);
                continue;
            }

            // Generate money from inventory
            let totalGeneration = 0;
            player.inventory.forEach(rot => {
                const rotType = BRAIN_ROT_TYPES.find(type => type.name === rot.name);
                if (rotType) {
                    totalGeneration += rotType.generationRate;
                }
            });

            // Apply generation upgrade multiplier
            const generationMultiplier = BASE_UPGRADES.generation.levels[player.upgrades.generation];
            const moneyEarned = totalGeneration * generationMultiplier;
            player.money += moneyEarned;
    
            // Update quest progress for money earned
            player.quests.progress.money += moneyEarned;
            player.stats.totalMoneyEarned += moneyEarned;
    
            // Check for money quest completion
            checkQuestCompletion(player, 'money', player.quests.progress.money);
        }

        // Clean up inactive players
        inactivePlayers.forEach(playerId => {
            const player = players[playerId];
            if (player) {
                console.log(`Cleaning up inactive player ${player.username}`);

                // Make base available again
                availableBases.push(player.baseNumber);
                availableBases.sort();

                // Remove player
                delete players[playerId];
            }
        });

        // Broadcast money updates if there are active players
        if (Object.keys(players).length > 0) {
            io.emit('updateMoney', players);
        }

    } catch (error) {
        console.error('Error in money generation loop:', error);
    }
}, 1000); // Every second

// Bot behavior removed - AI mode eliminated

// Loop de atualização do servidor
setInterval(() => {
    try {
        const currentTime = Date.now();
        const rotsToDelete = [];

        for (const rotId in brainRots) {
            const rot = brainRots[rotId];

            // Initialize lastUpdate if not set
            if (!rot.lastUpdate) {
                rot.lastUpdate = currentTime;
            }

            if (rot.owner && rot.targetBase) {
                // Move towards base
                const target = BASE_POSITIONS[rot.targetBase];
                if (!target) {
                    console.error(`Invalid target base: ${rot.targetBase}`);
                    rotsToDelete.push(rotId);
                    continue;
                }

                const dx = target.x - rot.x;
                const dy = target.y - rot.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 5) {
                    // Reached base, add to inventory if space
                    const player = players[rot.owner];
                    if (player) {
                        const maxCapacity = BASE_UPGRADES.capacity.levels[player.upgrades.capacity];
                        if (player.inventory.length < maxCapacity) {
                            player.inventory.push({
                                id: rot.id,
                                name: rot.name,
                                rarity: rot.rarity,
                                class: rot.class
                            });
                            io.emit('updateInventories', players);
                        }
                    }
                    rotsToDelete.push(rotId);
                } else {
                    const speed = 2;
                    rot.x += (dx / dist) * speed;
                    rot.y += (dy / dist) * speed;
                    rot.lastUpdate = currentTime;
                }
            } else if (!rot.owner) {
                rot.y += CONVEYOR_BELT_PROPS.speed; // Move o Brain Rot para baixo

                // Se o Brain Rot sair da parte inferior do mapa, remove-o
                if (rot.y > mapHeight) {
                    rotsToDelete.push(rotId);
                } else {
                    rot.lastUpdate = currentTime;
                }
            }
        }

        // Remove brain rots that are marked for deletion
        rotsToDelete.forEach(rotId => {
            delete brainRots[rotId];
        });

        // Clean up old brain rots that might have been missed
        for (const rotId in brainRots) {
            const rot = brainRots[rotId];
            // Remove brain rots that haven't been updated in 30 seconds (stuck items)
            if (currentTime - rot.lastUpdate > 30000) {
                console.log(`Removing stuck Brain Rot: ${rotId}`);
                delete brainRots[rotId];
            }
        }

        // Broadcast brain rot updates
        io.emit('updateBrainRots', brainRots);

    } catch (error) {
        console.error('Error in server update loop:', error);
    }
}, 1000 / 60); // Atualiza 60 vezes por segundo


io.on('connection', (socket) => {
    console.log('Um novo jogador se conectou:', socket.id);

    // Handle connection errors
    socket.on('error', (error) => {
        console.error('Socket error for player', socket.id, ':', error);
    });

    // Heartbeat system for connection monitoring
    socket.on('heartbeat', (data) => {
        const player = players[socket.id];
        if (player) {
            player.lastHeartbeat = Date.now();
            socket.emit('heartbeat', { serverTime: Date.now() });
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Player disconnected:', socket.id, 'Reason:', reason);
        // Cleanup will be handled in the disconnect event below
    });

    socket.on('joinGame', (data) => {
        try {
            // Validate input data
            if (!data || typeof data !== 'object') {
                socket.emit('serverError', 'Dados inválidos recebidos.');
                socket.disconnect();
                return;
            }

            const { username, mode } = data;

            // Validate username
            if (!username || typeof username !== 'string' || username.trim().length === 0 || username.length > 20) {
                socket.emit('serverError', 'Nome de usuário inválido. Deve ter entre 1 e 20 caracteres.');
                socket.disconnect();
                return;
            }

            // Validate game mode
            if (!mode || !['solo', 'online'].includes(mode)) {
                socket.emit('serverError', 'Modo de jogo inválido.');
                socket.disconnect();
                return;
            }

            gameMode = mode;

            // Check if player is already connected
            if (players[socket.id]) {
                socket.emit('serverError', 'Jogador já conectado.');
                socket.disconnect();
                return;
            }

            // Handle different game modes
            if (mode === 'solo') {
                // Solo mode: allow multiple solo players, each playing independently
                if (availableBases.length === 0) {
                    socket.emit('serverFull', 'Servidor cheio! Máximo 6 jogadores.');
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
                username: username.trim(),
                baseId: baseId,
                baseNumber: baseNumber,
                inventory: [],
                money: 250,
                baseLocked: false,
                baseLockTime: 0,
                lastMoveTime: Date.now(),
                lastPosition: { x: mapWidth / 4, y: mapHeight / 2 },
                upgrades: {
                    capacity: 0, // Level 0 = 6 slots
                    generation: 0 // Level 0 = 1.0x generation
                },
                connectedAt: Date.now(),
                quests: {
                    daily: generateDailyQuests(),
                    progress: {
                        collect: 0,
                        sell: 0,
                        steal: 0,
                        upgrade: 0,
                        money: 0
                    },
                    completed: [],
                    lastReset: new Date().toDateString()
                },
                stats: {
                    totalCollected: 0,
                    totalSold: 0,
                    totalStolen: 0,
                    totalMoneyEarned: 0,
                    playTime: 0
                }
            };

            players[socket.id] = playerData;

            console.log(`Player ${username} joined with base ${baseNumber}`);

            // Send initial game state to new player
            socket.emit('updatePlayers', players);
            socket.emit('updateBrainRots', brainRots);
            socket.emit('assignBase', {
                baseId,
                playerId: socket.id,
                baseNumber,
                isOwner: baseNumber === 1,
                dataRestored: false
            });

            // Send inventory and money updates with delay to ensure proper initialization
            setTimeout(() => {
                try {
                    io.emit('updateInventories', players);
                    io.emit('updateMoney', players);
                    socket.emit('updateInventories', players);
                    socket.emit('updateMoney', players);
                } catch (error) {
                    console.error('Error sending initial updates:', error);
                }
            }, 100);

            // Notify other players about new player
            socket.broadcast.emit('updatePlayers', players);

        } catch (error) {
            console.error('Error in joinGame:', error);
            socket.emit('serverError', 'Erro interno do servidor.');
            socket.disconnect();
        }
    });

    socket.on('playerMove', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('moveRejected', 'Jogador não encontrado.');
                return;
            }

            // Validate input data
            if (!data || typeof data !== 'object') {
                socket.emit('moveRejected', 'Dados de movimento inválidos.');
                return;
            }

            const { dx, dy } = data;

            // Validate movement values
            if (typeof dx !== 'number' || typeof dy !== 'number' ||
                isNaN(dx) || isNaN(dy) ||
                Math.abs(dx) > 15 || Math.abs(dy) > 15) {
                socket.emit('moveRejected', 'Movimento inválido detectado.');
                return;
            }

            // Rate limiting (max 50 moves per second for smoother movement)
            const now = Date.now();
            if (now - player.lastMoveTime < 20) { // ~50 FPS
                return; // Too fast, ignore
            }
            player.lastMoveTime = now;

            // Calculate new position
            const newX = player.x + dx;
            const newY = player.y + dy;

            // Speed validation - prevent teleportation
            const distance = Math.sqrt((newX - player.lastPosition.x) ** 2 + (newY - player.lastPosition.y) ** 2);
            if (distance > 10) { // Max 10 pixels per move
                socket.emit('moveRejected', 'Movimento muito rápido detectado.');
                return;
            }

            // Boundary validation
            player.x = Math.max(0, Math.min(mapWidth - 30, newX));
            player.y = Math.max(0, Math.min(mapHeight - 30, newY));
            player.lastPosition = { x: player.x, y: player.y };

            // Broadcast movement to all players
            io.emit('updatePlayers', players);

        } catch (error) {
            console.error('Error in playerMove:', error);
            socket.emit('moveRejected', 'Erro interno no movimento.');
        }
    });

    socket.on('pickUpBrainRot', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('pickupFailed', 'Jogador não encontrado.');
                return;
            }

            // Validate input
            if (!data || !data.rotId || typeof data.rotId !== 'string') {
                socket.emit('pickupFailed', 'Dados inválidos.');
                return;
            }

            const rot = brainRots[data.rotId];
            if (!rot) {
                socket.emit('pickupFailed', 'Brain Rot não encontrado.');
                return;
            }

            if (rot.owner) {
                socket.emit('pickupFailed', 'Brain Rot já foi coletado.');
                return;
            }

            const rotType = BRAIN_ROT_TYPES.find(type => type.name === rot.name);
            if (!rotType) {
                socket.emit('pickupFailed', 'Tipo de Brain Rot inválido.');
                return;
            }

            const maxCapacity = BASE_UPGRADES.capacity.levels[player.upgrades.capacity];

            if (player.money < rotType.price) {
                socket.emit('pickupFailed', 'Dinheiro insuficiente!');
                return;
            }

            if (player.inventory.length >= maxCapacity) {
                socket.emit('pickupFailed', `Base cheia! Capacidade máxima: ${maxCapacity}`);
                return;
            }

            // Perform pickup
            player.money -= rotType.price;
            rot.owner = socket.id;
            rot.targetBase = player.baseId;
            rot.lastUpdate = Date.now();

            // Update quest progress
            player.quests.progress.collect++;
            player.stats.totalCollected++;

            // Check for quest completion
            checkQuestCompletion(player, 'collect', player.quests.progress.collect);

            // Broadcast updates
            io.emit('updateBrainRots', brainRots);
            io.emit('updateMoney', players);

            console.log(`Player ${player.username} picked up ${rotType.name} for $${rotType.price}`);

        } catch (error) {
            console.error('Error in pickUpBrainRot:', error);
            socket.emit('pickupFailed', 'Erro interno na coleta.');
        }
    });

    socket.on('stealBrainRot', (data) => {
        try {
            const thief = players[socket.id];
            if (!thief) {
                socket.emit('stealFailed', 'Ladrão não encontrado.');
                return;
            }

            // Validate input
            if (!data || !data.targetPlayerId || !data.rotId ||
                typeof data.targetPlayerId !== 'string' || typeof data.rotId !== 'string') {
                socket.emit('stealFailed', 'Dados inválidos.');
                return;
            }

            const target = players[data.targetPlayerId];
            if (!target) {
                socket.emit('stealFailed', 'Jogador alvo não encontrado.');
                return;
            }

            // Prevent stealing from yourself
            if (data.targetPlayerId === socket.id) {
                socket.emit('stealFailed', 'Você não pode roubar de si mesmo!');
                return;
            }

            // Check if target base is locked
            if (target.baseLocked && Date.now() < target.baseLockTime) {
                socket.emit('stealFailed', 'Base bloqueada! Tente novamente mais tarde.');
                return;
            }

            // Check if thief has space in inventory
            const thiefMaxCapacity = BASE_UPGRADES.capacity.levels[thief.upgrades.capacity];
            if (thief.inventory.length >= thiefMaxCapacity) {
                socket.emit('stealFailed', 'Seu inventário está cheio!');
                return;
            }

            const rotIndex = target.inventory.findIndex(rot => rot.id === data.rotId);
            if (rotIndex === -1) {
                socket.emit('stealFailed', 'Item não encontrado no inventário do alvo.');
                return;
            }

            // Perform steal
            const stolenRot = target.inventory.splice(rotIndex, 1)[0];
            thief.inventory.push(stolenRot);

            // Update quest progress
            thief.quests.progress.steal++;
            thief.stats.totalStolen++;

            // Check for quest completion
            checkQuestCompletion(thief, 'steal', thief.quests.progress.steal);

            // Broadcast inventory updates
            io.emit('updateInventories', players);

            console.log(`Player ${thief.username} stole ${stolenRot.name} from ${target.username}`);

        } catch (error) {
            console.error('Error in stealBrainRot:', error);
            socket.emit('stealFailed', 'Erro interno no roubo.');
        }
    });

    socket.on('lockBase', () => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('lockFailed', 'Jogador não encontrado.');
                return;
            }

            if (player.baseLocked) {
                socket.emit('lockFailed', 'Base já está bloqueada.');
                return;
            }

            // Lock the base
            player.baseLocked = true;
            player.baseLockTime = Date.now() + 60000; // 60 seconds

            // Broadcast lock status
            io.emit('updateBaseLocks', players);

            console.log(`Player ${player.username} locked base ${player.baseNumber}`);

            // Auto-unlock after 60 seconds
            setTimeout(() => {
                try {
                    if (player && player.baseLocked) {
                        player.baseLocked = false;
                        io.emit('updateBaseLocks', players);
                        console.log(`Base ${player.baseNumber} auto-unlocked`);
                    }
                } catch (error) {
                    console.error('Error in auto-unlock:', error);
                }
            }, 60000);

        } catch (error) {
            console.error('Error in lockBase:', error);
            socket.emit('lockFailed', 'Erro interno no bloqueio.');
        }
    });

    socket.on('sellBrainRot', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('sellFailed', 'Jogador não encontrado.');
                return;
            }

            // Validate input
            if (!data || !data.rotId || typeof data.rotId !== 'string') {
                socket.emit('sellFailed', 'Dados inválidos.');
                return;
            }

            const rotIndex = player.inventory.findIndex(rot => rot.id === data.rotId);
            if (rotIndex === -1) {
                socket.emit('sellFailed', 'Item não encontrado no inventário.');
                return;
            }

            const soldRot = player.inventory.splice(rotIndex, 1)[0];
            const rotType = BRAIN_ROT_TYPES.find(type => type.name === soldRot.name);

            if (!rotType) {
                socket.emit('sellFailed', 'Tipo de Brain Rot inválido.');
                return;
            }

            // Add sell price to player money
            player.money += rotType.sellPrice;

            // Update quest progress
            player.quests.progress.sell++;
            player.stats.totalSold++;

            // Check for quest completion
            checkQuestCompletion(player, 'sell', player.quests.progress.sell);

            // Broadcast updates
            io.emit('updateInventories', players);
            io.emit('updateMoney', players);

            console.log(`Player ${player.username} sold ${rotType.name} for $${rotType.sellPrice}`);

        } catch (error) {
            console.error('Error in sellBrainRot:', error);
            socket.emit('sellFailed', 'Erro interno na venda.');
        }
    });

    socket.on('triggerAdminEvent', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('adminEventFailed', 'Jogador não encontrado.');
                return;
            }

            // Only allow player with base 1 (owner)
            if (player.baseNumber !== 1) {
                socket.emit('adminEventFailed', 'Apenas o dono (base 1) pode ativar eventos admin.');
                return;
            }

            // Validate input data
            const duration = (data && typeof data.duration === 'number') ? data.duration : 30000;

            // Validate duration (between 10 seconds and 5 minutes)
            if (duration < 10000 || duration > 300000) {
                socket.emit('adminEventFailed', 'Duração deve ser entre 10 e 300 segundos.');
                return;
            }

            // Toggle admin event
            adminEventActive = !adminEventActive;

            console.log(`Admin event ${adminEventActive ? 'activated' : 'deactivated'} by ${player.username} for ${duration}ms`);

            // Broadcast to all players
            io.emit('adminEvent', {
                active: adminEventActive,
                duration: duration,
                triggeredBy: player.username
            });

            if (adminEventActive) {
                // Auto-disable after duration
                setTimeout(() => {
                    try {
                        adminEventActive = false;
                        io.emit('adminEvent', { active: false });
                        console.log('Admin event auto-deactivated');
                    } catch (error) {
                        console.error('Error in admin event auto-disable:', error);
                    }
                }, duration);
            }

        } catch (error) {
            console.error('Error in triggerAdminEvent:', error);
            socket.emit('adminEventFailed', 'Erro interno no evento admin.');
        }
    });

    socket.on('upgradeBase', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('upgradeFailed', 'Jogador não encontrado.');
                return;
            }

            // Validate input
            if (!data || typeof data !== 'object') {
                socket.emit('upgradeFailed', 'Dados inválidos.');
                return;
            }

            const { upgradeType, baseNumber } = data;

            // Validate upgrade type
            if (!upgradeType || !['capacity', 'generation'].includes(upgradeType)) {
                socket.emit('upgradeFailed', 'Tipo de upgrade inválido.');
                return;
            }

            // Validate that player owns the base they're trying to upgrade
            if (baseNumber && baseNumber !== player.baseNumber) {
                socket.emit('upgradeFailed', 'Você só pode fazer upgrade na sua própria base!');
                return;
            }

            // Validate upgrade data exists
            if (!BASE_UPGRADES[upgradeType]) {
                socket.emit('upgradeFailed', 'Dados de upgrade não encontrados.');
                return;
            }

            const currentLevel = player.upgrades[upgradeType];

            // Check if max level reached
            if (currentLevel >= BASE_UPGRADES[upgradeType].levels.length - 1) {
                socket.emit('upgradeFailed', 'Nível máximo alcançado!');
                return;
            }

            const upgradeCost = BASE_UPGRADES[upgradeType].costs[currentLevel];

            // Validate cost
            if (typeof upgradeCost !== 'number' || upgradeCost < 0) {
                socket.emit('upgradeFailed', 'Custo de upgrade inválido.');
                return;
            }

            // Check if player has enough money
            if (player.money < upgradeCost) {
                socket.emit('upgradeFailed', 'Dinheiro insuficiente!');
                return;
            }

            // Perform upgrade
            player.money -= upgradeCost;
            player.upgrades[upgradeType] = currentLevel + 1;

            // Validate new level
            const newLevel = player.upgrades[upgradeType];
            const newValue = BASE_UPGRADES[upgradeType].levels[newLevel];

            if (typeof newValue !== 'number') {
                socket.emit('upgradeFailed', 'Valor de upgrade inválido.');
                return;
            }

            // Update quest progress
            player.quests.progress.upgrade++;
            checkQuestCompletion(player, 'upgrade', player.quests.progress.upgrade);

            // Send success response with new level and remaining money
            socket.emit('upgradeSuccess', {
                upgradeType,
                newLevel: newLevel,
                newValue: newValue,
                remainingMoney: player.money
            });

            // Update money for all clients
            io.emit('updateMoney', players);

            console.log(`Player ${player.username} upgraded ${upgradeType} to level ${newLevel} for $${upgradeCost}`);

        } catch (error) {
            console.error('Error in upgradeBase:', error);
            socket.emit('upgradeFailed', 'Erro interno no upgrade.');
        }
    });

    socket.on('chatMessage', (data) => {
        try {
            const player = players[socket.id];
            if (!player) {
                socket.emit('chatError', 'Jogador não encontrado.');
                return;
            }

            // Validate input
            if (!data || !data.message || typeof data.message !== 'string') {
                socket.emit('chatError', 'Mensagem inválida.');
                return;
            }

            const message = data.message.trim();

            // Validate message length
            if (message.length === 0 || message.length > 100) {
                socket.emit('chatError', 'Mensagem deve ter entre 1 e 100 caracteres.');
                return;
            }

            // Check for spam (simple rate limiting)
            const now = Date.now();
            if (!player.lastChatTime) player.lastChatTime = 0;

            if (now - player.lastChatTime < 1000) { // 1 second cooldown
                socket.emit('chatError', 'Aguarde um momento antes de enviar outra mensagem.');
                return;
            }

            player.lastChatTime = now;

            // Broadcast message to all players
            io.emit('chatMessage', {
                type: 'player',
                playerId: socket.id,
                playerName: player.username,
                message: message,
                timestamp: now
            });

            console.log(`Chat: ${player.username}: ${message}`);

        } catch (error) {
            console.error('Error in chatMessage:', error);
            socket.emit('chatError', 'Erro interno no chat.');
        }
    });

    socket.on('disconnect', (reason) => {
        try {
            console.log(`Player ${socket.id} disconnected. Reason: ${reason}`);

            if (players[socket.id]) {
                const player = players[socket.id];
                const baseNumber = player.baseNumber;

                console.log(`Cleaning up player ${player.username} (base ${baseNumber})`);

                // Clear brainrots from base visually for all clients
                io.emit('clearBaseBrainrots', { baseId: player.baseId });

                // Send inventory update to clear the base slots
                io.emit('updateInventories', players);

                // Make base available again
                availableBases.push(baseNumber);
                availableBases.sort();

                // Remove player from game
                delete players[socket.id];

                // Notify all players about the disconnection
                io.emit('updatePlayers', players);

                console.log(`Player cleanup completed for ${player.username}`);
            }
        } catch (error) {
            console.error('Error in disconnect handler:', error);
        }
    });
});

http.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
