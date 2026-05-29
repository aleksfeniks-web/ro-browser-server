const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'database.json');

// --- Adaptador Dual de Base de Datos: JSON Local / PostgreSQL (Neon.tech) ---
let db = { accounts: [], characters: [], mobs_db: {}, items_db: {} };
let pgPool = null;
let isPg = false;

if (process.env.DATABASE_URL) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  isPg = true;
  console.log('🚀 [Database] Enlace detectado: El servidor utilizará PostgreSQL (Neon.tech).');
} else {
  console.log('💾 [Database] Sin enlace en la nube: El servidor utilizará base de datos JSON local.');
}

// Cargar Base de Datos JSON Local (Fallback)
function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      console.log('Cargados datos JSON locales.');
    }
  } catch (err) {
    console.error('Error al cargar base de datos JSON local, usando valores por defecto:', err);
  }
}

// Guardar Base de Datos JSON Local (Fallback)
function saveDb() {
  if (isPg) return; // En PG no guardamos en archivo
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error('Error al guardar base de datos JSON local:', err);
  }
}

// Inicializar Base de Datos (SQL o JSON)
async function initDatabase() {
  // Cargar siempre la base de datos estática de monstruos y objetos
  loadDb(); 

  if (!isPg) return;

  try {
    const client = await pgPool.connect();
    console.log('✅ Conexión con PostgreSQL en Neon.tech establecida con éxito.');

    // 1. Crear tabla de cuentas
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password VARCHAR(100) NOT NULL,
          gm BOOLEAN DEFAULT FALSE
      );
    `);

    // 2. Crear tabla de personajes
    await client.query(`
      CREATE TABLE IF NOT EXISTS characters (
          id SERIAL PRIMARY KEY,
          account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
          name VARCHAR(12) UNIQUE NOT NULL,
          gender VARCHAR(1) NOT NULL,
          hair INTEGER DEFAULT 1,
          hair_color INTEGER DEFAULT 0,
          job VARCHAR(30) DEFAULT 'Novice',
          base_level INTEGER DEFAULT 1,
          job_level INTEGER DEFAULT 1,
          base_exp INTEGER DEFAULT 0,
          job_exp INTEGER DEFAULT 0,
          hp INTEGER DEFAULT 100,
          max_hp INTEGER DEFAULT 100,
          sp INTEGER DEFAULT 30,
          max_sp INTEGER DEFAULT 30,
          str INTEGER DEFAULT 1,
          agi INTEGER DEFAULT 1,
          vit INTEGER DEFAULT 1,
          int_stat INTEGER DEFAULT 1,
          dex INTEGER DEFAULT 1,
          luk INTEGER DEFAULT 1,
          stat_points INTEGER DEFAULT 0,
          skill_points INTEGER DEFAULT 0,
          map_name VARCHAR(50) DEFAULT 'prontera',
          x INTEGER DEFAULT 15,
          y INTEGER DEFAULT 15,
          inventory JSONB DEFAULT '[]'::jsonb,
          equipment JSONB DEFAULT '{"weapon": null, "headgear": null}'::jsonb,
          skills JSONB DEFAULT '{"double_strafe": 0, "bash": 0, "fire_bolt": 0, "heal": 0}'::jsonb
      );
    `);

    // 3. Crear cuentas demo por defecto
    await client.query(`
      INSERT INTO accounts (username, password, gm) 
      VALUES ('admin', 'admin', true) 
      ON CONFLICT (username) DO NOTHING;
    `);

    await client.query(`
      INSERT INTO accounts (username, password, gm) 
      VALUES ('user', 'user', false) 
      ON CONFLICT (username) DO NOTHING;
    `);

    client.release();
    console.log('✨ Tablas del juego inicializadas correctamente en Neon.tech.');
  } catch (err) {
    console.error('❌ Error fatal al inicializar tablas en PostgreSQL:', err);
  }
}

// Guardar progreso del personaje en la base de datos activa
async function saveCharacter(char) {
  if (!isPg) {
    saveDb();
    return;
  }

  try {
    await pgPool.query(`
      UPDATE characters SET 
        job = $1, base_level = $2, job_level = $3, base_exp = $4, job_exp = $5,
        hp = $6, max_hp = $7, sp = $8, max_sp = $9,
        str = $10, agi = $11, vit = $12, int_stat = $13, dex = $14, luk = $15,
        stat_points = $16, skill_points = $17, map_name = $18, x = $19, y = $20,
        inventory = $21, equipment = $22, skills = $23
      WHERE id = $24
    `, [
      char.job, char.baseLevel, char.jobLevel, char.baseExp, char.jobExp,
      char.hp, char.maxHp, char.sp, char.maxSp,
      char.str, char.agi, char.vit, char.int, char.dex, char.luk,
      char.statPoints, char.skillPoints, char.map, char.x, char.y,
      JSON.stringify(char.inventory), JSON.stringify(char.equipment), JSON.stringify(char.skills),
      char.id
    ]);
  } catch (err) {
    console.error(`Error al guardar personaje ${char.name} en PostgreSQL:`, err);
  }
}

initDatabase();

// --- Cargar Mapas ---
const maps = {};
const MAPS_DIR = path.join(__dirname, 'data', 'maps');
function loadMaps() {
  try {
    const files = fs.readdirSync(MAPS_DIR);
    files.forEach(file => {
      if (file.endsWith('.json')) {
        const mapData = JSON.parse(fs.readFileSync(path.join(MAPS_DIR, file), 'utf8'));
        maps[mapData.name] = mapData;
        console.log(`Mapa '${mapData.name}' cargado.`);
      }
    });
  } catch (err) {
    console.error('Error al cargar mapas:', err);
  }
}
loadMaps();

// Inicializar Servidor Web
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- Lector Dinámico de data.grf para Gráficos Originales ---
const GRF_PATH = `C:\\Users\\nh250032\\Downloads\\RagnarokMéxicoV1\\RagnarokMéxicoV1\\data.grf`;
let grfIndex = new Map();
let grfFd = null;

function initGRF() {
  if (!fs.existsSync(GRF_PATH)) {
    console.log('⚠️ [GRF] No se detectó data.grf en la ruta oficial. No se cargarán gráficos originales.');
    return;
  }

  console.log('📦 [GRF] Detectado data.grf. Cargando índice de archivos en memoria...');
  try {
    grfFd = fs.openSync(GRF_PATH, 'r');
    const headerBuffer = Buffer.alloc(46);
    fs.readSync(grfFd, headerBuffer, 0, 46, 0);

    const magic = headerBuffer.toString('ascii', 0, 15);
    if (!magic.startsWith('Master of Magic')) {
      console.error('❌ [GRF] Firma de data.grf inválida.');
      return;
    }

    const fileTableOffset = headerBuffer.readUInt32LE(30);
    const seed = headerBuffer.readUInt32LE(34);
    const rawFilesCount = headerBuffer.readUInt32LE(38);
    const filesCount = rawFilesCount - seed - 7;

    console.log(`📦 [GRF] Leyendo tabla a offset: ${fileTableOffset + 46}, archivos: ${filesCount}`);

    // Leer cabecera de tabla de archivos
    const tableHeader = Buffer.alloc(8);
    fs.readSync(grfFd, tableHeader, 0, 8, fileTableOffset + 46);
    const compressedSize = tableHeader.readUInt32LE(0);
    const uncompressedSize = tableHeader.readUInt32LE(4);

    // Leer tabla comprimida
    const compressedData = Buffer.alloc(compressedSize);
    fs.readSync(grfFd, compressedData, 0, compressedSize, fileTableOffset + 46 + 8);

    const decompressed = zlib.inflateSync(compressedData);
    
    // Parsear tabla de archivos
    let offset = 0;
    for (let i = 0; i < filesCount; i++) {
      if (offset >= decompressed.length) break;

      // Leer ruta
      let filePath = '';
      while (decompressed[offset] !== 0 && offset < decompressed.length) {
        filePath += String.fromCharCode(decompressed[offset]);
        offset++;
      }
      offset++; // saltar null

      if (offset + 17 > decompressed.length) break;

      const cLen = decompressed.readUInt32LE(offset);
      const uLen = decompressed.readUInt32LE(offset + 4);
      const uLenAligned = decompressed.readUInt32LE(offset + 8);
      const flag = decompressed[offset + 12];
      const fileOffset = decompressed.readUInt32LE(offset + 13);
      offset += 17;

      // Guardar en índice (usar minúsculas y barras normales)
      const cleanPath = filePath.toLowerCase().replace(/\\/g, '/');
      grfIndex.set(cleanPath, {
        offset: fileOffset,
        compressedSize: cLen,
        uncompressedSize: uLen,
        flag: flag
      });
    }

    console.log(`✅ [GRF] Índice cargado correctamente. ${grfIndex.size} archivos indexados.`);
  } catch (err) {
    console.error('❌ [GRF] Error al cargar data.grf:', err);
  }
}

initGRF();

// API Endpoint para extraer archivos del GRF en tiempo real
app.get('/api/grf/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).send('Falta el parámetro "path".');
  }

  const cleanPath = filePath.toLowerCase().replace(/\\/g, '/');
  const originalCleanPath = filePath.replace(/\\/g, '/');

  // 1. Si existe un archivo pre-extraído en la carpeta public/, servirlo directamente (ideal para Render.com en la nube)
  // Soporta tanto rutas en minúsculas como con mayúsculas originales en sistemas Linux sensibles a mayúsculas
  let localPreExtractedPath = path.join(__dirname, 'public', originalCleanPath);
  if (!fs.existsSync(localPreExtractedPath)) {
    localPreExtractedPath = path.join(__dirname, 'public', cleanPath);
  }

  if (fs.existsSync(localPreExtractedPath)) {
    let contentType = 'application/octet-stream';
    if (cleanPath.endsWith('.bmp')) contentType = 'image/bmp';
    else if (cleanPath.endsWith('.png')) contentType = 'image/png';
    else if (cleanPath.endsWith('.tga')) contentType = 'image/tga';
    else if (cleanPath.endsWith('.wav')) contentType = 'audio/wav';
    else if (cleanPath.endsWith('.mp3')) contentType = 'audio/mpeg';

    res.setHeader('Content-Type', contentType);
    return res.sendFile(localPreExtractedPath);
  }

  // 2. Si no, intentar leer desde el GRF físico local (sólo en localhost)
  if (!grfFd || grfIndex.size === 0) {
    return res.status(503).send('Servicio de GRF no disponible en la nube.');
  }

  const entry = grfIndex.get(cleanPath);

  if (!entry) {
    return res.status(404).send(`Archivo no encontrado en GRF: ${filePath}`);
  }

  try {
    const compressedData = Buffer.alloc(entry.compressedSize);
    fs.readSync(grfFd, compressedData, 0, entry.compressedSize, entry.offset + 46);

    const decompressed = zlib.inflateSync(compressedData);
    
    // Determinar content-type aproximado
    let contentType = 'application/octet-stream';
    if (cleanPath.endsWith('.bmp')) contentType = 'image/bmp';
    else if (cleanPath.endsWith('.png')) contentType = 'image/png';
    else if (cleanPath.endsWith('.tga')) contentType = 'image/tga';
    else if (cleanPath.endsWith('.wav')) contentType = 'audio/wav';
    else if (cleanPath.endsWith('.mp3')) contentType = 'audio/mpeg';

    res.setHeader('Content-Type', contentType);
    res.send(decompressed);
  } catch (err) {
    console.error(`Error al extraer ${filePath} del GRF:`, err);
    res.status(500).send(`Error al extraer archivo: ${err.message}`);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Estado del Servidor en Tiempo Real (Jugadores y Monstruos activos)
const activePlayers = new Map(); // ws -> character
const mapEntities = {}; // mapName -> { entityId: entity }
let nextEntityId = 10000;

// Inicializar Entidades de Monstruos en los mapas
Object.keys(maps).forEach(mapName => {
  mapEntities[mapName] = {};
  const map = maps[mapName];
  if (map.spawns) {
    map.spawns.forEach(spawn => {
      const mobTemplate = db.mobs_db[spawn.mobId];
      if (mobTemplate) {
        for (let i = 0; i < spawn.count; i++) {
          spawnMonster(mapName, spawn.mobId, spawn.x, spawn.y, spawn.friendly);
        }
      }
    });
  }
});

// Función para generar un monstruo
function spawnMonster(mapName, mobId, x = null, y = null, friendly = false) {
  const map = maps[mapName];
  if (!map) return null;
  const mobTemplate = db.mobs_db[mobId];
  if (!mobTemplate) return null;

  let rx = x;
  let ry = y;
  let attempts = 0;
  while ((rx === null || ry === null || isCellBlocked(mapName, rx, ry)) && attempts < 100) {
    rx = Math.floor(Math.random() * map.width);
    ry = Math.floor(Math.random() * map.height);
    attempts++;
  }

  if (attempts >= 100 && (rx === null || ry === null)) {
    rx = 10; ry = 10;
  }

  const mobInstance = {
    id: nextEntityId++,
    type: 'monster',
    mobId: mobId,
    name: mobTemplate.name,
    level: mobTemplate.level,
    hp: mobTemplate.hp,
    maxHp: mobTemplate.maxHp,
    atk: mobTemplate.atk,
    def: mobTemplate.def,
    flee: mobTemplate.flee,
    hit: mobTemplate.hit,
    exp: mobTemplate.exp,
    jobExp: mobTemplate.jobExp,
    moveSpeed: mobTemplate.moveSpeed,
    attackSpeed: mobTemplate.attackSpeed,
    scale: mobTemplate.scale || 1,
    x: rx,
    y: ry,
    startX: rx,
    startY: ry,
    map: mapName,
    state: 'idle',
    targetId: null,
    path: [],
    lastActionTime: Date.now(),
    friendly: friendly,
    respawnTimer: null,
    drops: mobTemplate.drops || []
  };

  mapEntities[mapName][mobInstance.id] = mobInstance;
  broadcastToMap(mapName, {
    type: 'spawn_entities',
    entities: [getNetworkEntity(mobInstance)]
  });

  return mobInstance;
}

// Validar colisiones
function isCellBlocked(mapName, x, y) {
  const map = maps[mapName];
  if (!map) return true;
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return true;
  const cell = map.grid[y][x];
  return cell === 'T' || cell === '#' || cell === '*' || cell === 'F';
}

// Convertir entidad para el paquete de red
function getNetworkEntity(ent) {
  if (ent.type === 'player') {
    return {
      id: ent.id,
      type: 'player',
      name: ent.name,
      job: ent.job,
      baseLevel: ent.baseLevel,
      jobLevel: ent.jobLevel,
      hp: ent.hp,
      maxHp: ent.maxHp,
      sp: ent.sp,
      maxSp: ent.maxSp,
      x: ent.x,
      y: ent.y,
      hair: ent.hair,
      hairColor: ent.hairColor,
      gender: ent.gender,
      speed: ent.speed || 150,
      headgear: ent.equipment ? ent.equipment.headgear : null
    };
  } else {
    return {
      id: ent.id,
      type: 'monster',
      mobId: ent.mobId,
      name: ent.name,
      level: ent.level,
      hp: ent.hp,
      maxHp: ent.maxHp,
      x: ent.x,
      y: ent.y,
      speed: ent.moveSpeed,
      scale: ent.scale,
      state: ent.state
    };
  }
}

// Enviar paquete a todos en un mapa
function broadcastToMap(mapName, data, excludeWs = null) {
  const message = JSON.stringify(data);
  activePlayers.forEach((char, ws) => {
    if (char.map === mapName && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

// Calcular estadísticas derivadas del personaje
function updateCharacterDerivedStats(char) {
  let weaponAtk = 0;
  let weaponMatk = 0;
  let armorDef = 0;
  let headgearDef = 0;

  if (!char.equipment) {
    char.equipment = { weapon: null, headgear: null };
  }
  
  if (char.equipment.weapon) {
    const item = db.items_db[char.equipment.weapon];
    if (item) {
      weaponAtk = item.atk || 0;
      weaponMatk = item.matk || 0;
    }
  }
  if (char.equipment.headgear) {
    const item = db.items_db[char.equipment.headgear];
    if (item) {
      headgearDef = item.def || 0;
    }
  }

  char.maxHp = 100 + (char.vit * 12) + (char.baseLevel * 15);
  char.maxSp = 30 + (char.int * 5) + (char.baseLevel * 3);
  
  if (char.hp > char.maxHp) char.hp = char.maxHp;
  if (char.sp > char.maxSp) char.sp = char.maxSp;

  char.atk = Math.floor(char.str * 1.5) + weaponAtk;
  char.matk = Math.floor(char.int * 1.8) + weaponMatk;
  char.def = Math.floor(char.vit * 0.5) + armorDef + headgearDef;
  char.flee = char.baseLevel + char.agi + Math.floor(char.luk * 0.2);
  char.hit = char.baseLevel + char.dex + 50;
  char.speed = Math.max(80, 200 - (char.agi * 1.2));
}

// Bucle del Juego (IA de Monstruos - 100ms)
setInterval(() => {
  const now = Date.now();

  Object.keys(mapEntities).forEach(mapName => {
    const entities = mapEntities[mapName];
    Object.keys(entities).forEach(id => {
      const ent = entities[id];
      if (ent.type !== 'monster') return;
      if (ent.state === 'dead') return;

      if (ent.state === 'idle') {
        if (!ent.friendly && now - ent.lastActionTime > 4000 + Math.random() * 4000) {
          const directions = [
            {x:0, y:-1}, {x:0, y:1}, {x:-1, y:0}, {x:1, y:0},
            {x:-1, y:-1}, {x:1, y:-1}, {x:-1, y:1}, {x:1, y:1}
          ];
          const dir = directions[Math.floor(Math.random() * directions.length)];
          const tx = ent.startX + dir.x * (Math.floor(Math.random() * 4) + 1);
          const ty = ent.startY + dir.y * (Math.floor(Math.random() * 4) + 1);

          if (!isCellBlocked(mapName, tx, ty)) {
            ent.state = 'moving';
            ent.path = [{x: tx, y: ty}];
            ent.lastActionTime = now;
            broadcastToMap(mapName, {
              type: 'entity_move',
              id: ent.id,
              x: tx,
              y: ty,
              speed: ent.moveSpeed
            });
          }
        }
      } else if (ent.state === 'moving') {
        if (ent.path.length > 0) {
          const step = ent.path[0];
          ent.x = step.x;
          ent.y = step.y;
          ent.path.shift();
        }
        if (ent.path.length === 0) {
          ent.state = 'idle';
          ent.lastActionTime = now;
        }
      } else if (ent.state === 'chase') {
        const target = getEntityById(mapName, ent.targetId);
        if (!target || target.hp <= 0 || target.map !== mapName) {
          ent.targetId = null;
          ent.state = 'idle';
          ent.lastActionTime = now;
          return;
        }

        const dist = Math.max(Math.abs(ent.x - target.x), Math.abs(ent.y - target.y));
        if (dist <= 1) {
          ent.state = 'attack';
          ent.lastActionTime = now;
        } else if (now - ent.lastActionTime > 800) {
          const nextStepX = ent.x + Math.sign(target.x - ent.x);
          const nextStepY = ent.y + Math.sign(target.y - ent.y);
          if (!isCellBlocked(mapName, nextStepX, nextStepY)) {
            ent.x = nextStepX;
            ent.y = nextStepY;
            broadcastToMap(mapName, {
              type: 'entity_move',
              id: ent.id,
              x: ent.x,
              y: ent.y,
              speed: ent.moveSpeed
            });
          }
          ent.lastActionTime = now;
        }
      } else if (ent.state === 'attack') {
        const target = getEntityById(mapName, ent.targetId);
        if (!target || target.hp <= 0) {
          ent.targetId = null;
          ent.state = 'idle';
          ent.lastActionTime = now;
          return;
        }

        const dist = Math.max(Math.abs(ent.x - target.x), Math.abs(ent.y - target.y));
        if (dist > 1) {
          ent.state = 'chase';
          ent.lastActionTime = now;
          return;
        }

        if (now - ent.lastActionTime > ent.attackSpeed) {
          ent.lastActionTime = now;
          const hitChance = Math.min(95, Math.max(5, ent.hit - target.flee));
          const isHit = (Math.random() * 100) < hitChance;

          if (isHit) {
            let dmg = Math.max(1, ent.atk - target.def);
            dmg = Math.floor(dmg * (0.9 + Math.random() * 0.2));
            target.hp -= dmg;
            if (target.hp < 0) target.hp = 0;

            broadcastToMap(mapName, {
              type: 'damage_pop',
              targetId: target.id,
              attackerId: ent.id,
              damage: dmg,
              isMiss: false
            });

            sendToPlayer(target, {
              type: 'update_self_stats',
              hp: target.hp,
              sp: target.sp
            });

            if (target.hp <= 0) {
              broadcastToMap(mapName, {
                type: 'chat_message',
                sender: "Sistema",
                message: `${target.name} ha sido derrotado por un ${ent.name}.`,
                system: true
              });
              ent.targetId = null;
              ent.state = 'idle';
            }
          } else {
            broadcastToMap(mapName, {
              type: 'damage_pop',
              targetId: target.id,
              attackerId: ent.id,
              damage: 0,
              isMiss: true
            });
          }
        }
      }
    });
  });
}, 100);

// Regeneración periódica (5s)
setInterval(() => {
  activePlayers.forEach((char) => {
    if (char.hp > 0) {
      let hpRegen = Math.max(1, Math.floor(char.vit / 5) + 3);
      let spRegen = Math.max(1, Math.floor(char.int / 6) + 2);
      
      char.hp = Math.min(char.maxHp, char.hp + hpRegen);
      char.sp = Math.min(char.maxSp, char.sp + spRegen);

      sendToPlayer(char, {
        type: 'update_self_stats',
        hp: char.hp,
        sp: char.sp
      });
    }
  });
}, 5000);

function getEntityById(mapName, id) {
  if (mapEntities[mapName] && mapEntities[mapName][id]) {
    return mapEntities[mapName][id];
  }
  let found = null;
  activePlayers.forEach((char) => {
    if (char.map === mapName && char.id === id) {
      found = char;
    }
  });
  return found;
}

function sendToPlayer(char, data) {
  activePlayers.forEach((playerChar, ws) => {
    if (playerChar.id === char.id && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  });
}

// Muerte de Monstruo y Recompensas
function killMonster(mob, killer) {
  mob.state = 'dead';
  broadcastToMap(mob.map, {
    type: 'damage_pop',
    targetId: mob.id,
    attackerId: killer.id,
    damage: 0,
    isMiss: false,
    dead: true
  });

  broadcastToMap(mob.map, {
    type: 'despawn_entity',
    id: mob.id
  });

  killer.baseExp += mob.exp;
  killer.jobExp += mob.jobExp;

  let baseLevelUp = false;
  let jobLevelUp = false;

  const nextBaseExp = Math.floor(Math.pow(killer.baseLevel, 2.2) * 45) + 80;
  const nextJobExp = Math.floor(Math.pow(killer.jobLevel, 2.0) * 35) + 50;

  if (killer.baseExp >= nextBaseExp) {
    killer.baseExp -= nextBaseExp;
    killer.baseLevel++;
    killer.statPoints += 4 + Math.floor(killer.baseLevel / 5);
    baseLevelUp = true;
  }
  if (killer.jobExp >= nextJobExp) {
    killer.jobExp -= nextJobExp;
    killer.jobLevel++;
    killer.skillPoints += 1;
    jobLevelUp = true;
  }

  mob.drops.forEach(drop => {
    if (Math.random() < drop.chance) {
      const itemTemplate = db.items_db[drop.itemId];
      if (itemTemplate) {
        addItemToInventory(killer, drop.itemId, 1);
      }
    }
  });

  updateCharacterDerivedStats(killer);

  if (baseLevelUp || jobLevelUp) {
    killer.hp = killer.maxHp;
    killer.sp = killer.maxSp;

    broadcastToMap(killer.map, {
      type: 'level_up',
      id: killer.id,
      name: killer.name,
      baseLevel: killer.baseLevel,
      jobLevel: killer.jobLevel
    });
  }

  saveCharacter(killer);

  sendToPlayer(killer, {
    type: 'game_init',
    char: killer,
    items_db: db.items_db
  });

  setTimeout(() => {
    delete mapEntities[mob.map][mob.id];
    spawnMonster(mob.map, mob.mobId, mob.startX, mob.startY, mob.friendly);
  }, 10000);
}

function addItemToInventory(char, itemId, count) {
  if (!char.inventory) char.inventory = [];
  const existing = char.inventory.find(i => i.itemId === itemId);
  if (existing) {
    existing.count += count;
  } else {
    char.inventory.push({ itemId, count, equipped: false });
  }
}

// Conexión WebSockets
wss.on('connection', ws => {
  console.log('Nueva conexión de red establecida.');

  // Enviar periódicamente estatus al cliente
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'server_info',
        playerCount: activePlayers.size
      }));
    }
  }, 3000);

  ws.on('message', async messageString => {
    let packet;
    try {
      packet = JSON.parse(messageString);
    } catch (e) {
      return;
    }

    switch (packet.type) {
      case 'ping_request': {
        ws.send(JSON.stringify({ type: 'pong_ping', timestamp: packet.timestamp }));
        break;
      }

      case 'auth_request': {
        const { username, password, register } = packet;
        if (register) {
          if (isPg) {
            try {
              const res = await pgPool.query('SELECT * FROM accounts WHERE username = $1', [username]);
              if (res.rows.length > 0) {
                ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'El usuario ya existe.' }));
              } else {
                await pgPool.query(
                  'INSERT INTO accounts (username, password, gm) VALUES ($1, $2, $3)',
                  [username, password, username.toLowerCase().includes('admin')]
                );
                ws.send(JSON.stringify({ type: 'auth_response', success: true, message: 'Registro exitoso, por favor inicia sesión.' }));
              }
            } catch (err) {
              console.error(err);
              ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'Error en la base de datos de Neon.' }));
            }
          } else {
            const exists = db.accounts.some(acc => acc.username === username);
            if (exists) {
              ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'El usuario ya existe.' }));
            } else {
              const newAcc = {
                id: db.accounts.length + 1,
                username,
                password,
                gm: username.toLowerCase().includes('admin')
              };
              db.accounts.push(newAcc);
              saveDb();
              ws.send(JSON.stringify({ type: 'auth_response', success: true, message: 'Registro exitoso, por favor inicia sesión.' }));
            }
          }
        } else {
          if (isPg) {
            try {
              const res = await pgPool.query('SELECT * FROM accounts WHERE username = $1 AND password = $2', [username, password]);
              if (res.rows.length > 0) {
                const acc = res.rows[0];
                ws.send(JSON.stringify({ type: 'auth_response', success: true, accountId: acc.id, gm: acc.gm }));
              } else {
                ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'Credenciales inválidas.' }));
              }
            } catch (err) {
              console.error(err);
              ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'Error de conexión con Neon.' }));
            }
          } else {
            const acc = db.accounts.find(a => a.username === username && a.password === password);
            if (acc) {
              ws.send(JSON.stringify({ type: 'auth_response', success: true, accountId: acc.id, gm: acc.gm }));
            } else {
              ws.send(JSON.stringify({ type: 'auth_response', success: false, message: 'Credenciales inválidas.' }));
            }
          }
        }
        break;
      }

      case 'char_list_request': {
        const { accountId } = packet;
        if (isPg) {
          try {
            const res = await pgPool.query('SELECT * FROM characters WHERE account_id = $1', [accountId]);
            const chars = res.rows.map(row => ({
              id: row.id,
              accountId: row.account_id,
              name: row.name,
              gender: row.gender,
              hair: row.hair,
              hairColor: row.hair_color,
              job: row.job,
              baseLevel: row.base_level,
              jobLevel: row.job_level,
              baseExp: row.base_exp,
              jobExp: row.job_exp,
              hp: row.hp,
              maxHp: row.max_hp,
              sp: row.sp,
              maxSp: row.max_sp,
              str: row.str,
              agi: row.agi,
              vit: row.vit,
              int: row.int_stat,
              dex: row.dex,
              luk: row.luk,
              statPoints: row.stat_points,
              skillPoints: row.skill_points,
              map: row.map_name,
              x: row.x,
              y: row.y,
              inventory: row.inventory,
              equipment: row.equipment,
              skills: row.skills
            }));
            ws.send(JSON.stringify({ type: 'char_list_response', chars }));
          } catch (err) {
            console.error(err);
          }
        } else {
          const chars = db.characters.filter(c => c.accountId === accountId);
          ws.send(JSON.stringify({ type: 'char_list_response', chars }));
        }
        break;
      }

      case 'char_create_request': {
        const { accountId, name, gender, hair, hairColor, str, agi, vit, int, dex, luk } = packet;
        
        if (isPg) {
          try {
            const nameCheck = await pgPool.query('SELECT * FROM characters WHERE LOWER(name) = LOWER($1)', [name]);
            if (nameCheck.rows.length > 0) {
              ws.send(JSON.stringify({ type: 'char_create_response', success: false, message: 'El nombre ya está en uso.' }));
              return;
            }

            const totalStats = str + agi + vit + int + dex + luk;
            if (totalStats > 54) {
              ws.send(JSON.stringify({ type: 'char_create_response', success: false, message: 'Distribución de estadísticas inválida.' }));
              return;
            }

            await pgPool.query(`
              INSERT INTO characters (
                account_id, name, gender, hair, hair_color, 
                str, agi, vit, int_stat, dex, luk,
                inventory, equipment, skills
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            `, [
              accountId, name, gender, hair, hairColor,
              str, agi, vit, int, dex, luk,
              JSON.stringify([
                { itemId: 501, count: 5, equipped: false },
                { itemId: 1201, count: 1, equipped: false }
              ]),
              JSON.stringify({ weapon: null, headgear: null }),
              JSON.stringify({ double_strafe: 0, bash: 0, fire_bolt: 0, heal: 0 })
            ]);

            ws.send(JSON.stringify({ type: 'char_create_response', success: true }));
          } catch (err) {
            console.error(err);
            ws.send(JSON.stringify({ type: 'char_create_response', success: false, message: 'Error de creación en la nube.' }));
          }
        } else {
          const nameExists = db.characters.some(c => c.name.toLowerCase() === name.toLowerCase());
          if (nameExists) {
            ws.send(JSON.stringify({ type: 'char_create_response', success: false, message: 'El nombre ya está en uso.' }));
            return;
          }

          const totalStats = str + agi + vit + int + dex + luk;
          if (totalStats > 54) {
            ws.send(JSON.stringify({ type: 'char_create_response', success: false, message: 'Distribución de estadísticas inválida.' }));
            return;
          }

          const newChar = {
            id: db.characters.length + 1,
            accountId,
            name,
            gender,
            hair,
            hairColor,
            job: 'Novice',
            baseLevel: 1,
            jobLevel: 1,
            baseExp: 0,
            jobExp: 0,
            hp: 100,
            maxHp: 100,
            sp: 30,
            maxSp: 30,
            str,
            agi,
            vit,
            int,
            dex,
            luk,
            statPoints: 0,
            skillPoints: 0,
            map: 'prontera',
            x: 15,
            y: 15,
            inventory: [
              { itemId: 501, count: 5, equipped: false },
              { itemId: 1201, count: 1, equipped: false }
            ],
            equipment: { weapon: null, headgear: null },
            skills: { "double_strafe": 0, "bash": 0, "fire_bolt": 0, "heal": 0 }
          };

          db.characters.push(newChar);
          saveDb();
          ws.send(JSON.stringify({ type: 'char_create_response', success: true }));
        }
        break;
      }

      case 'enter_game_request': {
        const { charId } = packet;
        let char = null;

        if (isPg) {
          try {
            const res = await pgPool.query('SELECT * FROM characters WHERE id = $1', [charId]);
            if (res.rows.length > 0) {
              const row = res.rows[0];
              char = {
                id: row.id,
                accountId: row.account_id,
                name: row.name,
                gender: row.gender,
                hair: row.hair,
                hairColor: row.hair_color,
                job: row.job,
                baseLevel: row.base_level,
                jobLevel: row.job_level,
                baseExp: row.base_exp,
                jobExp: row.job_exp,
                hp: row.hp,
                maxHp: row.max_hp,
                sp: row.sp,
                maxSp: row.max_sp,
                str: row.str,
                agi: row.agi,
                vit: row.vit,
                int: row.int_stat,
                dex: row.dex,
                luk: row.luk,
                statPoints: row.stat_points,
                skillPoints: row.skill_points,
                map: row.map_name,
                x: row.x,
                y: row.y,
                inventory: row.inventory,
                equipment: row.equipment,
                skills: row.skills
              };
            }
          } catch (err) {
            console.error(err);
          }
        } else {
          char = db.characters.find(c => c.id === charId);
        }

        if (!char) {
          ws.send(JSON.stringify({ type: 'enter_game_response', success: false }));
          return;
        }

        updateCharacterDerivedStats(char);
        char.type = 'player';
        activePlayers.set(ws, char);

        ws.send(JSON.stringify({
          type: 'game_init',
          char,
          items_db: db.items_db
        }));

        // Enviar datos de carga del mapa inicial
        ws.send(JSON.stringify({
          type: 'map_change',
          mapName: char.map,
          x: char.x,
          y: char.y,
          mapData: maps[char.map]
        }));

        broadcastToMap(char.map, {
          type: 'spawn_entities',
          entities: [getNetworkEntity(char)]
        }, ws);

        const localEntities = [];
        activePlayers.forEach((otherChar) => {
          if (otherChar.map === char.map) {
            localEntities.push(getNetworkEntity(otherChar));
          }
        });
        if (mapEntities[char.map]) {
          Object.keys(mapEntities[char.map]).forEach(id => {
            const mob = mapEntities[char.map][id];
            if (mob.state !== 'dead') {
              localEntities.push(getNetworkEntity(mob));
            }
          });
        }

        ws.send(JSON.stringify({
          type: 'spawn_entities',
          entities: localEntities
        }));
        break;
      }

      case 'player_move': {
        const char = activePlayers.get(ws);
        if (!char) return;

        const { path: movePath } = packet;
        if (movePath && movePath.length > 0) {
          const destination = movePath[movePath.length - 1];
          
          if (!isCellBlocked(char.map, destination.x, destination.y)) {
            char.x = destination.x;
            char.y = destination.y;

            broadcastToMap(char.map, {
              type: 'entity_move',
              id: char.id,
              x: char.x,
              y: char.y,
              speed: char.speed
            }, ws);

            const map = maps[char.map];
            if (map.warps) {
              const warp = map.warps.find(w => 
                char.x >= w.x && char.x < w.x + w.width &&
                char.y >= w.y && char.y < w.y + w.height
              );

              if (warp) {
                executeWarp(ws, char, warp.targetMap, warp.targetX, warp.targetY);
              } else {
                saveCharacter(char);
              }
            } else {
              saveCharacter(char);
            }
          }
        }
        break;
      }

      case 'player_attack': {
        const char = activePlayers.get(ws);
        if (!char || char.hp <= 0) return;

        const { targetId } = packet;
        const target = getEntityById(char.map, targetId);
        if (!target || target.hp <= 0) return;

        const dist = Math.max(Math.abs(char.x - target.x), Math.abs(char.y - target.y));
        if (dist > 1.8) return;

        const hitChance = Math.min(95, Math.max(5, char.hit - target.flee));
        const isHit = (Math.random() * 100) < hitChance;

        if (isHit) {
          let isCrit = Math.random() < (char.luk * 0.015);
          let dmg = Math.max(1, char.atk - target.def);

          if (isCrit) dmg = Math.floor(dmg * 1.5);
          dmg = Math.floor(dmg * (0.95 + Math.random() * 0.1));
          target.hp -= dmg;
          if (target.hp < 0) target.hp = 0;

          if (target.type === 'monster' && (target.state === 'idle' || target.state === 'moving')) {
            target.state = 'chase';
            target.targetId = char.id;
            target.lastActionTime = Date.now();
          }

          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: dmg,
            isCrit: isCrit,
            isMiss: false
          });

          if (target.hp <= 0 && target.type === 'monster') {
            killMonster(target, char);
          }
        } else {
          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: 0,
            isMiss: true
          });
        }
        break;
      }

      case 'use_item': {
        const char = activePlayers.get(ws);
        if (!char || char.hp <= 0) return;

        const { itemId } = packet;
        const invIndex = char.inventory.findIndex(i => i.itemId === itemId);
        if (invIndex === -1) return;

        const item = db.items_db[itemId];
        if (!item) return;

        if (item.type === 'consume') {
          if (item.effect === 'heal_hp') {
            char.hp = Math.min(char.maxHp, char.hp + item.value);
            char.inventory[invIndex].count--;
            if (char.inventory[invIndex].count <= 0) {
              char.inventory.splice(invIndex, 1);
            }
            updateCharacterDerivedStats(char);
            
            broadcastToMap(char.map, {
              type: 'skill_effect',
              targetId: char.id,
              skillName: 'heal_potion',
              effectColor: '#5cd65c'
            });

            saveCharacter(char);

            ws.send(JSON.stringify({
              type: 'game_init',
              char,
              items_db: db.items_db
            }));
          }
        } else if (item.type === 'equip') {
          const invItem = char.inventory[invIndex];
          const isEquipped = invItem.equipped;

          if (isEquipped) {
            invItem.equipped = false;
            char.equipment[item.slot] = null;
          } else {
            char.inventory.forEach(i => {
              const otherItem = db.items_db[i.itemId];
              if (otherItem && otherItem.type === 'equip' && otherItem.slot === item.slot) {
                i.equipped = false;
              }
            });
            invItem.equipped = true;
            char.equipment[item.slot] = itemId;
          }

          updateCharacterDerivedStats(char);
          saveCharacter(char);
          
          ws.send(JSON.stringify({
            type: 'game_init',
            char,
            items_db: db.items_db
          }));

          broadcastToMap(char.map, {
            type: 'spawn_entities',
            entities: [getNetworkEntity(char)]
          });
        }
        break;
      }

      case 'add_stat': {
        const char = activePlayers.get(ws);
        if (!char || char.statPoints <= 0) return;

        const { stat } = packet;
        if (['str', 'agi', 'vit', 'int', 'dex', 'luk'].includes(stat)) {
          char[stat]++;
          char.statPoints--;
          updateCharacterDerivedStats(char);
          saveCharacter(char);
          
          ws.send(JSON.stringify({
            type: 'game_init',
            char,
            items_db: db.items_db
          }));
        }
        break;
      }

      case 'learn_skill': {
        const char = activePlayers.get(ws);
        if (!char || char.skillPoints <= 0) return;

        const { skill } = packet;
        if (char.skills && char.skills[skill] !== undefined) {
          char.skills[skill]++;
          char.skillPoints--;
          saveCharacter(char);

          ws.send(JSON.stringify({
            type: 'game_init',
            char,
            items_db: db.items_db
          }));
        }
        break;
      }

      case 'cast_skill': {
        const char = activePlayers.get(ws);
        if (!char || char.hp <= 0) return;

        const { skill, targetId } = packet;
        const skillLevel = char.skills[skill] || 0;
        if (skillLevel <= 0) return;

        const target = getEntityById(char.map, targetId);
        if (!target || target.hp <= 0) return;

        let spCost = 5 + skillLevel * 3;
        if (char.sp < spCost) {
          ws.send(JSON.stringify({ type: 'system_message', message: 'SP Insuficiente.' }));
          return;
        }

        char.sp -= spCost;

        if (skill === 'heal') {
          let healVal = Math.floor(char.matk * 1.5) + (skillLevel * 30);
          target.hp = Math.min(target.maxHp, target.hp + healVal);
          
          broadcastToMap(char.map, {
            type: 'skill_effect',
            targetId: target.id,
            skillName: 'heal',
            effectColor: '#70db70'
          });

          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: healVal,
            isMiss: false,
            heal: true
          });

          if (target.type === 'player') {
            sendToPlayer(target, { type: 'update_self_stats', hp: target.hp, sp: target.sp });
            saveCharacter(target);
          }
        } else if (skill === 'bash') {
          let mult = 1.2 + skillLevel * 0.3;
          let dmg = Math.floor((char.atk * mult) - target.def);
          dmg = Math.max(10, dmg);

          target.hp = Math.max(0, target.hp - dmg);
          
          if (target.type === 'monster' && (target.state === 'idle' || target.state === 'moving')) {
            target.state = 'chase';
            target.targetId = char.id;
          }

          broadcastToMap(char.map, {
            type: 'skill_effect',
            targetId: target.id,
            skillName: 'bash',
            effectColor: '#ff9900'
          });

          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: dmg,
            isCrit: true
          });

          if (target.hp <= 0 && target.type === 'monster') {
            killMonster(target, char);
          }
        } else if (skill === 'fire_bolt') {
          let hits = Math.min(10, skillLevel);
          let baseDmg = Math.floor(char.matk * 0.9);
          let totalDmg = 0;

          for (let i = 0; i < hits; i++) {
            let chunk = Math.max(5, baseDmg - Math.floor(target.def * 0.3));
            totalDmg += Math.floor(chunk * (0.9 + Math.random() * 0.2));
          }

          target.hp = Math.max(0, target.hp - totalDmg);

          if (target.type === 'monster' && (target.state === 'idle' || target.state === 'moving')) {
            target.state = 'chase';
            target.targetId = char.id;
          }

          broadcastToMap(char.map, {
            type: 'skill_effect',
            targetId: target.id,
            skillName: 'fire_bolt',
            effectColor: '#ff3300'
          });

          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: totalDmg,
            isCrit: false
          });

          if (target.hp <= 0 && target.type === 'monster') {
            killMonster(target, char);
          }
        } else if (skill === 'double_strafe') {
          let dmg1 = Math.floor(char.atk * 1.0 - target.def);
          let dmg2 = Math.floor(char.atk * 1.0 - target.def);
          let totalDmg = Math.max(5, dmg1) + Math.max(5, dmg2);
          totalDmg = Math.floor(totalDmg * (1.0 + skillLevel * 0.1));

          target.hp = Math.max(0, target.hp - totalDmg);

          if (target.type === 'monster' && (target.state === 'idle' || target.state === 'moving')) {
            target.state = 'chase';
            target.targetId = char.id;
          }

          broadcastToMap(char.map, {
            type: 'skill_effect',
            targetId: target.id,
            skillName: 'double_strafe',
            effectColor: '#ffcc00'
          });

          broadcastToMap(char.map, {
            type: 'damage_pop',
            targetId: target.id,
            attackerId: char.id,
            damage: totalDmg,
            isCrit: false
          });

          if (target.hp <= 0 && target.type === 'monster') {
            killMonster(target, char);
          }
        }

        saveCharacter(char);
        updateCharacterDerivedStats(char);

        ws.send(JSON.stringify({
          type: 'game_init',
          char,
          items_db: db.items_db
        }));
        break;
      }

      case 'chat_message': {
        const char = activePlayers.get(ws);
        if (!char) return;

        const { message } = packet;

        // Comprobar comandos GM si tiene permiso (id de cuenta 1 o gm true)
        if (message.startsWith('/')) {
          const args = message.substring(1).split(' ');
          const cmd = args[0].toLowerCase();

          // Comprobar si tiene rango de GM
          const isGM = isPg ? char.accountId === 1 || char.id === 1 : char.accountId === 1;
          if (isGM) {
            if (cmd === 'spawn') {
              const mobId = parseInt(args[1]) || 1001;
              const count = parseInt(args[2]) || 1;
              for (let i = 0; i < count; i++) {
                spawnMonster(char.map, mobId, char.x, char.y);
              }
              ws.send(JSON.stringify({ type: 'system_message', message: `Invocados ${count} monstruos con ID ${mobId}.` }));
            } else if (cmd === 'warp') {
              const destMap = args[1] || 'prontera';
              const tx = parseInt(args[2]) || 15;
              const ty = parseInt(args[3]) || 15;
              executeWarp(ws, char, destMap, tx, ty);
            } else if (cmd === 'item') {
              const itemId = parseInt(args[1]) || 501;
              const count = parseInt(args[2]) || 1;
              addItemToInventory(char, itemId, count);
              saveCharacter(char);
              ws.send(JSON.stringify({
                type: 'game_init',
                char,
                items_db: db.items_db
              }));
              ws.send(JSON.stringify({ type: 'system_message', message: `Añadido item ${itemId} x${count} al inventario.` }));
            } else if (cmd === 'heal') {
              char.hp = char.maxHp;
              char.sp = char.maxSp;
              saveCharacter(char);
              ws.send(JSON.stringify({
                type: 'game_init',
                char,
                items_db: db.items_db
              }));
              ws.send(JSON.stringify({ type: 'system_message', message: 'Sanado por completo.' }));
            } else if (cmd === 'baselevel') {
              const val = parseInt(args[1]) || 1;
              char.baseLevel = val;
              updateCharacterDerivedStats(char);
              saveCharacter(char);
              ws.send(JSON.stringify({
                type: 'game_init',
                char,
                items_db: db.items_db
              }));
            } else if (cmd === 'joblevel') {
              const val = parseInt(args[1]) || 1;
              char.jobLevel = val;
              saveCharacter(char);
              ws.send(JSON.stringify({
                type: 'game_init',
                char,
                items_db: db.items_db
              }));
            } else if (cmd === 'job') {
              const val = args[1] || 'Swordman';
              char.job = val;
              updateCharacterDerivedStats(char);
              saveCharacter(char);
              ws.send(JSON.stringify({
                type: 'game_init',
                char,
                items_db: db.items_db
              }));
            } else {
              ws.send(JSON.stringify({ type: 'system_message', message: 'Comando desconocido.' }));
            }
          }
          return;
        }

        broadcastToMap(char.map, {
          type: 'chat_message',
          senderId: char.id,
          sender: char.name,
          message: message
        });
        break;
      }
    }
  });

  ws.on('close', () => {
    clearInterval(interval);
    const char = activePlayers.get(ws);
    if (char) {
      console.log(`Jugador ${char.name} desconectado.`);
      broadcastToMap(char.map, {
        type: 'despawn_entity',
        id: char.id
      });
      activePlayers.delete(ws);
      saveCharacter(char);
    }
  });
});

// Función de Teletransporte / Warp
function executeWarp(ws, char, targetMap, tx, ty) {
  if (!maps[targetMap]) return;

  broadcastToMap(char.map, {
    type: 'despawn_entity',
    id: char.id
  }, ws);

  char.map = targetMap;
  char.x = tx;
  char.y = ty;
  saveCharacter(char);

  ws.send(JSON.stringify({
    type: 'map_change',
    mapName: targetMap,
    x: tx,
    y: ty,
    mapData: maps[targetMap]
  }));

  broadcastToMap(char.map, {
    type: 'spawn_entities',
    entities: [getNetworkEntity(char)]
  }, ws);

  const localEntities = [];
  activePlayers.forEach((otherChar) => {
    if (otherChar.map === char.map) {
      localEntities.push(getNetworkEntity(otherChar));
    }
  });
  if (mapEntities[char.map]) {
    Object.keys(mapEntities[char.map]).forEach(id => {
      const mob = mapEntities[char.map][id];
      if (mob.state !== 'dead') {
        localEntities.push(getNetworkEntity(mob));
      }
    });
  }

  ws.send(JSON.stringify({
    type: 'spawn_entities',
    entities: localEntities
  }));
}

// Escuchar puerto
server.listen(PORT, () => {
  console.log(`Servidor WebRO escuchando en el puerto ${PORT}`);
});
