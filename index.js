const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// 内存存储房间数据
const rooms = new Map();

// 生成房间ID
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 初始化玩家状态
function initPlayerState(id, name, mode) {
  const baseHealth = mode === 'duel' ? 1 : 3;
  return {
    id,
    name,
    health: baseHealth,
    maxHealth: baseHealth,
    ammo: 0,
    carriers: 0,
    satellites: 0,
    detectors: 0,
    marks: {
      shield: 0,
      doubleShield: 0,
      radiation: false,
      fireworks: 0,
      weak: 0
    },
    isReady: false,
    isOnline: true
  };
}

// 初始化房间状态
function initRoomState(roomId, hostId, mode) {
  return {
    id: roomId,
    hostId,
    players: [],
    settings: { mode },
    round: 0,
    status: 'waiting',
    log: []
  };
}

// 手势配置
const GESTURES = {
  reload: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  crouchReload: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  shield: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  doubleShield: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  tripleShield: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  crouch: { cost: 0, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  spike: { cost: 0, damage: 1, pierce: 0, isFlying: false, isShooting: false },
  rock: { cost: 0, damage: 1, pierce: 0, isFlying: false, isShooting: false },
  singleGun: { cost: 1, damage: 1, pierce: 1, isFlying: false, isShooting: true },
  machineGun: { cost: 1, damage: 2, pierce: 1, isFlying: false, isShooting: true },
  detector: { cost: 1, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  doubleGun: { cost: 2, damage: 2, pierce: 2, isFlying: false, isShooting: true },
  sniper: { cost: 2, damage: 2, pierce: 1, isFlying: false, isShooting: true },
  crouchGun: { cost: 2, damage: 1, pierce: 1, isFlying: false, isShooting: true },
  carrier: { cost: 2, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  mine: { cost: 2, damage: 1, pierce: 0, isFlying: false, isShooting: false },
  torpedo: { cost: 2, damage: 2, pierce: 0, isFlying: false, isShooting: false },
  tank: { cost: 2, damage: 1, pierce: 0, isFlying: false, isShooting: false },
  plane: { cost: 3, damage: 1, pierce: 0, isFlying: true, isShooting: false },
  heavyTank: { cost: 3, damage: 2, pierce: 2, isFlying: false, isShooting: true },
  fortress: { cost: 3, damage: 1, pierce: 1, isFlying: false, isShooting: true },
  missile: { cost: 3, damage: 2, pierce: Infinity, isFlying: false, isShooting: false },
  cannon: { cost: 4, damage: 2, pierce: Infinity, isFlying: false, isShooting: true },
  forceField: { cost: 4, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  bomber: { cost: 5, damage: 2, pierce: 0, isFlying: true, isShooting: false },
  railgun: { cost: 5, damage: 3, pierce: Infinity, isFlying: false, isShooting: true },
  speedCar: { cost: 5, damage: 3, pierce: Infinity, isFlying: false, isShooting: true },
  satellite: { cost: 6, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  pull: { cost: 6, damage: 0, pierce: 0, isFlying: false, isShooting: false },
  laser: { cost: 7, damage: 4, pierce: Infinity, isFlying: false, isShooting: true },
  plasma: { cost: 8, damage: 4, pierce: Infinity, isFlying: false, isShooting: true },
  ray: { cost: 10, damage: 5, pierce: Infinity, isFlying: false, isShooting: true }
};

// 检查是否对掉
function isCountered(g1, g2) {
  const counterPairs = [
    ['singleGun', 'heavyTank'], ['singleGun', 'fortress'], ['singleGun', 'railgun'],
    ['machineGun', 'heavyTank'], ['machineGun', 'fortress'], ['machineGun', 'railgun'],
    ['doubleGun', 'sniper'], ['doubleGun', 'fortress'],
    ['sniper', 'bomber'],
    ['tank', 'singleGun'],
    ['heavyTank', 'singleGun'], ['heavyTank', 'machineGun'],
    ['cannon', 'railgun'],
    ['railgun', 'singleGun'], ['railgun', 'machineGun'], ['railgun', 'fortress'], ['railgun', 'cannon'], ['railgun', 'bomber'],
    ['speedCar', 'fortress'],
    ['plasma', 'plasma'],
    ['ray', 'ray']
  ];
  return counterPairs.some(([a, b]) => (g1 === a && g2 === b) || (g1 === b && g2 === a));
}

// 检查能否打到
function canHit(attacker, defender) {
  const aConfig = GESTURES[attacker];
  const dConfig = GESTURES[defender];
  if (!aConfig || !dConfig) return false;

  if ((defender === 'reload' || defender === 'crouchReload') && aConfig.cost === 0 && aConfig.damage > 0) return false;
  if (defender === 'reload' && aConfig.isFlying) return false;
  if (defender === 'crouchReload' && (attacker === 'singleGun' || attacker === 'doubleGun' || attacker === 'fortress')) return false;
  if (defender === 'crouch' && (attacker === 'rock' || attacker === 'sniper')) return false;
  if (attacker === 'singleGun' && (defender === 'crouch' || defender === 'crouchReload' || defender === 'crouchGun')) return false;
  if (attacker === 'singleGun' && (defender === 'mine' || defender === 'torpedo' || dConfig.isFlying)) return false;
  if (attacker === 'machineGun' && (defender === 'crouch' || defender === 'crouchReload' || defender === 'crouchGun' || defender === 'mine' || defender === 'torpedo' || dConfig.isFlying)) return false;
  if (attacker === 'doubleGun' && (defender === 'crouch' || defender === 'crouchReload' || defender === 'crouchGun' || defender === 'mine' || defender === 'torpedo' || dConfig.isFlying)) return false;
  if (attacker === 'sniper' && (defender === 'crouch' || defender === 'crouchGun')) return false;
  if (aConfig.isShooting && !aConfig.isFlying && (defender === 'mine' || defender === 'torpedo')) return false;
  if (aConfig.isFlying && defender === 'carrier') return false;
  if (defender === 'spike' && (attacker === 'singleGun' || attacker === 'bomber')) return false;
  if (defender === 'fortress' && aConfig.cost <= 6 && attacker !== 'heavyTank' && attacker !== 'missile') return false;
  if (defender === 'fortress' && aConfig.pierce <= 1) return false;

  return true;
}

// 计算伤害
function calculateDamage(attacker, defender, mode) {
  const aConfig = GESTURES[attacker];
  const result = { damage: 0, isBlocked: false, isDodged: false, isCountered: false, events: [] };
  if (!aConfig) return result;

  if (isCountered(attacker, defender)) {
    result.isCountered = true;
    result.events.push('手势对掉，未造成伤害');
    return result;
  }

  if (!canHit(attacker, defender)) {
    result.isDodged = true;
    result.events.push('打不到对方');
    return result;
  }

  let damage = aConfig.damage;

  if (defender === 'carrier' && aConfig.isShooting && attacker !== 'sniper') {
    damage *= 3;
    result.events.push('枪类秒杀航母！');
  }
  if (attacker === 'plane' && defender === 'speedCar') damage = 3;
  if (attacker === 'bomber' && defender === 'speedCar') damage = 3;
  if (defender === 'carrier' && (attacker === 'mine' || attacker === 'torpedo')) damage *= 2;

  if (defender === 'shield' && aConfig.pierce < 2 && !aConfig.isFlying) {
    result.isBlocked = true;
    result.events.push('单盾防御成功');
    return result;
  }
  if (defender === 'doubleShield' && aConfig.pierce < 3 && !aConfig.isFlying) {
    result.isBlocked = true;
    result.events.push('双盾防御成功');
    return result;
  }
  if (defender === 'tripleShield' && aConfig.pierce < 4) {
    result.isBlocked = true;
    result.events.push('三盾防御成功');
    return result;
  }

  if (mode === 'threeCarrier' && damage > 0) damage = 1;

  result.damage = damage;
  return result;
}

// 应用回合效果
function applyRoundEffects(player1, player2, p1Gesture, p2Gesture, mode) {
  const log = {
    round: 0,
    player1Gesture: p1Gesture,
    player2Gesture: p2Gesture,
    player1Damage: 0,
    player2Damage: 0,
    player1AmmoChange: 0,
    player2AmmoChange: 0,
    events: []
  };

  const p1Config = GESTURES[p1Gesture];
  const p2Config = GESTURES[p2Gesture];
  if (!p1Config || !p2Config) return log;

  player1.ammo -= p1Config.cost;
  player2.ammo -= p2Config.cost;
  log.player1AmmoChange = -p1Config.cost;
  log.player2AmmoChange = -p2Config.cost;

  if (p1Gesture === 'pull' || p2Gesture === 'pull') {
    log.events.push('拉人触发，本回合作废');
    player1.ammo += p1Config.cost;
    player2.ammo += p2Config.cost;
    log.player1AmmoChange = 0;
    log.player2AmmoChange = 0;
    return log;
  }

  if (p1Config.isFlying && p2Config.isFlying) {
    player1.health -= 1;
    player2.health -= 1;
    log.player1Damage = 1;
    log.player2Damage = 1;
    log.events.push('坠机！双方各扣1滴血');
    return log;
  }

  if (p1Gesture === 'mine' && p2Gesture === 'mine') {
    player1.health -= 1;
    player2.health -= 1;
    log.player1Damage = 1;
    log.player2Damage = 1;
    log.events.push('多地雷自毁！双方各扣1滴血');
    return log;
  }

  if ((p1Gesture === 'satellite' && p2Config.isFlying) || (p2Gesture === 'satellite' && p1Config.isFlying)) {
    const planePlayer = p1Config.isFlying ? player1 : player2;
    planePlayer.health -= 1;
    log.events.push('卫星坠机事故！飞行物扣1滴血，卫星发射失败');
    if (p1Gesture === 'satellite') log.player1Damage = 0;
    else log.player2Damage = 0;
  }

  const p1ToP2 = calculateDamage(p1Gesture, p2Gesture, mode);
  const p2ToP1 = calculateDamage(p2Gesture, p1Gesture, mode);

  let p1ActualDamage = p2ToP1.damage;
  let p2ActualDamage = p1ToP2.damage;

  if (p2ActualDamage > 0 && player2.carriers > 0) {
    player2.carriers--;
    p2ActualDamage--;
    log.events.push(`${player2.name}的航母抵挡了1点伤害`);
  }
  if (p1ActualDamage > 0 && player1.carriers > 0) {
    player1.carriers--;
    p1ActualDamage--;
    log.events.push(`${player1.name}的航母抵挡了1点伤害`);
  }

  if (p2ActualDamage > 0 && player2.satellites > 0) {
    player2.satellites--;
    p2ActualDamage = Math.max(0, p2ActualDamage - 2);
    log.events.push(`${player2.name}的卫星抵挡了伤害`);
  }
  if (p1ActualDamage > 0 && player1.satellites > 0) {
    player1.satellites--;
    p1ActualDamage = Math.max(0, p1ActualDamage - 2);
    log.events.push(`${player1.name}的卫星抵挡了伤害`);
  }

  player1.health -= p1ActualDamage;
  player2.health -= p2ActualDamage;
  log.player1Damage = p1ActualDamage;
  log.player2Damage = p2ActualDamage;

  if (p1ActualDamage > 0) log.events.push(`${player2.name}对${player1.name}造成了${p1ActualDamage}点伤害`);
  if (p2ActualDamage > 0) log.events.push(`${player1.name}对${player2.name}造成了${p2ActualDamage}点伤害`);

  if (p1Gesture === 'reload' || p1Gesture === 'crouchReload') {
    player1.ammo += 1;
    log.player1AmmoChange += 1;
  }
  if (p2Gesture === 'reload' || p2Gesture === 'crouchReload') {
    player2.ammo += 1;
    log.player2AmmoChange += 1;
  }

  if (p1Gesture === 'carrier' && p1ActualDamage === 0) {
    player1.carriers++;
    log.events.push(`${player1.name}获得了一个航母`);
  }
  if (p2Gesture === 'carrier' && p2ActualDamage === 0) {
    player2.carriers++;
    log.events.push(`${player2.name}获得了一个航母`);
  }

  if (player1.carriers > 0) {
    player1.ammo += player1.carriers;
    log.player1AmmoChange += player1.carriers;
    log.events.push(`${player1.name}的航母增加了${player1.carriers}发弹药`);
  }
  if (player2.carriers > 0) {
    player2.ammo += player2.carriers;
    log.player2AmmoChange += player2.carriers;
    log.events.push(`${player2.name}的航母增加了${player2.carriers}发弹药`);
  }

  if (p1Gesture === 'satellite' && p1ActualDamage === 0) {
    player1.satellites = 1;
    log.events.push(`${player1.name}获得了一个卫星`);
  }
  if (p2Gesture === 'satellite' && p2ActualDamage === 0) {
    player2.satellites = 1;
    log.events.push(`${player2.name}获得了一个卫星`);
  }

  if (p1Gesture === 'detector' && p1ActualDamage === 0 && player1.detectors < 2) {
    player1.detectors++;
    log.events.push(`${player1.name}获得了一个探测器`);
  }
  if (p2Gesture === 'detector' && p2ActualDamage === 0 && player2.detectors < 2) {
    player2.detectors++;
    log.events.push(`${player2.name}获得了一个探测器`);
  }

  if (p1Gesture === 'shield') {
    player1.marks.shield++;
    log.events.push(`${player1.name}获得了一个单盾标记`);
  }
  if (p2Gesture === 'shield') {
    player2.marks.shield++;
    log.events.push(`${player2.name}获得了一个单盾标记`);
  }

  if (p1Gesture === 'doubleShield') {
    player1.marks.shield--;
    player1.marks.doubleShield++;
    log.events.push(`${player1.name}消耗单盾标记，获得双盾标记`);
  }
  if (p2Gesture === 'doubleShield') {
    player2.marks.shield--;
    player2.marks.doubleShield++;
    log.events.push(`${player2.name}消耗单盾标记，获得双盾标记`);
  }

  if (p1Gesture === 'tripleShield') {
    player1.marks.doubleShield--;
    log.events.push(`${player1.name}消耗双盾标记，获得三盾效果`);
  }
  if (p2Gesture === 'tripleShield') {
    player2.marks.doubleShield--;
    log.events.push(`${player2.name}消耗双盾标记，获得三盾效果`);
  }

  if (mode === 'threeCarrier') {
    player1.ammo += 3;
    player2.ammo += 3;
    log.player1AmmoChange += 3;
    log.player2AmmoChange += 3;
  }

  if (player1.marks.radiation) {
    const groundGestures = ['crouchReload', 'crouch', 'spike', 'rock', 'crouchGun', 'mine', 'torpedo', 'heavyTank'];
    if (groundGestures.includes(p1Gesture)) {
      player1.health -= 1;
      log.events.push(`${player1.name}受到核辐射影响，扣1滴血`);
    }
    player1.marks.radiation = false;
  }
  if (player2.marks.radiation) {
    const groundGestures = ['crouchReload', 'crouch', 'spike', 'rock', 'crouchGun', 'mine', 'torpedo', 'heavyTank'];
    if (groundGestures.includes(p2Gesture)) {
      player2.health -= 1;
      log.events.push(`${player2.name}受到核辐射影响，扣1滴血`);
    }
    player2.marks.radiation = false;
  }

  if (p1Gesture === 'missile') {
    player2.marks.radiation = true;
    log.events.push(`${player2.name}被标记了核辐射`);
  }
  if (p2Gesture === 'missile') {
    player1.marks.radiation = true;
    log.events.push(`${player1.name}被标记了核辐射`);
  }

  return log;
}

// 检查游戏结束
function checkGameEnd(players) {
  const alivePlayers = players.filter(p => p.health > 0);
  if (alivePlayers.length === 1) return alivePlayers[0].id;
  if (alivePlayers.length === 0) return 'draw';
  return null;
}

// Socket.io 连接处理
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('room:create', ({ mode, playerName }, callback) => {
    const roomId = generateRoomId();
    const playerId = socket.id;
    const room = initRoomState(roomId, playerId, mode);
    
    const player = initPlayerState(playerId, playerName || '玩家1', mode);
    room.players.push(player);
    
    rooms.set(roomId, room);
    socket.join(roomId);
    
    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId, room });
  });

  socket.on('room:join', ({ roomId, playerName }, callback) => {
    const upperRoomId = roomId.toUpperCase();
    const room = rooms.get(upperRoomId);
    
    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }
    
    if (room.players.length >= 2) {
      callback({ success: false, error: '房间已满' });
      return;
    }
    
    if (room.status !== 'waiting') {
      callback({ success: false, error: '游戏已开始' });
      return;
    }

    const playerId = socket.id;
    const player = initPlayerState(playerId, playerName || '玩家2', room.settings.mode);
    room.players.push(player);
    
    socket.join(upperRoomId);
    socket.to(upperRoomId).emit('room:playerJoined', { player, room });
    
    console.log(`Player ${playerName} joined room: ${upperRoomId}`);
    callback({ success: true, room });
  });

  socket.on('room:leave', () => {
    const roomId = findPlayerRoom(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          socket.to(roomId).emit('room:playerLeft', { playerId: socket.id, room });
        }
      }
      socket.leave(roomId);
    }
  });

  socket.on('player:ready', () => {
    const roomId = findPlayerRoom(socket.id);
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = !player.isReady;
      io.to(roomId).emit('room:update', room);
    }
  });

  socket.on('game:start', () => {
    const roomId = findPlayerRoom(socket.id);
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.players.every(p => p.isReady) && room.players.length === 2) {
      room.status = 'playing';
      room.round = 1;
      room.players.forEach(p => {
        p.isReady = false;
        p.gesture = undefined;
      });
      io.to(roomId).emit('game:started', room);
    }
  });

  socket.on('player:gesture', (gesture) => {
    const roomId = findPlayerRoom(socket.id);
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    player.gesture = gesture;
    player.isReady = true;

    const otherPlayer = room.players.find(p => p.id !== socket.id);
    if (otherPlayer?.gesture && player.gesture) {
      const log = applyRoundEffects(
        room.players[0],
        room.players[1],
        room.players[0].gesture,
        room.players[1].gesture,
        room.settings.mode
      );
      log.round = room.round;
      
      room.log.push(log);

      const winner = checkGameEnd(room.players);
      if (winner) {
        room.status = 'ended';
        room.winner = winner;
        io.to(roomId).emit('game:roundResult', { log, room });
        io.to(roomId).emit('game:ended', { winner, room });
      } else {
        room.round++;
        room.players.forEach(p => {
          p.gesture = undefined;
          p.isReady = false;
        });
        io.to(roomId).emit('game:roundResult', { log, room });
      }
    } else {
      io.to(roomId).emit('room:update', room);
    }
  });

  socket.on('game:restart', () => {
    const roomId = findPlayerRoom(socket.id);
    if (!roomId) return;
    
    const room = rooms.get(roomId);
    if (!room) return;

    room.status = 'waiting';
    room.round = 0;
    room.winner = undefined;
    room.log = [];
    
    room.players.forEach(p => {
      p.health = room.settings.mode === 'duel' ? 1 : 3;
      p.maxHealth = p.health;
      p.ammo = 0;
      p.carriers = 0;
      p.satellites = 0;
      p.detectors = 0;
      p.marks = { shield: 0, doubleShield: 0, radiation: false, fireworks: 0, weak: 0 };
      p.gesture = undefined;
      p.isReady = false;
    });

    io.to(roomId).emit('game:restarted', room);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const roomId = findPlayerRoom(socket.id);
    if (roomId) {
      const room = rooms.get(roomId);
      if (room) {
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
          player.isOnline = false;
          socket.to(roomId).emit('player:disconnected', { playerId: socket.id, room });
        }
      }
    }
  });
});

function findPlayerRoom(playerId) {
  for (const [roomId, room] of rooms) {
    if (room.players.some(p => p.id === playerId)) return roomId;
  }
  return null;
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
