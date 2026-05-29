/**
 * WebRO - Client main controller & 60 FPS Isometric Engine
 */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    
    this.loading = true;
    this.lastTime = 0;
    
    // Módulos
    this.camera = new Camera();
    this.map = new GameMap();
    this.network = new Network(this);
    
    // Estado del juego
    this.localPlayer = null;
    this.entities = {}; // id -> entity
    this.damagePops = []; // floating combat text
    this.particleEffects = []; // skill visual effects
    this.itemsDb = {};
    
    this.selectedTargetId = null;
    
    // Controles de cámara con mouse
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    // Sprites cargados del GRF original
    this.grfSprites = {
      poring: null,
      lunatic: null,
      baphomet: null,
      novice_male: null,
      novice_female: null
    };

    // Configurar Canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Inicializar Controles e Inputs
    this.initControls();
    
    // Inicializar Red
    this.network.connect();
    
    // Crear Instancia global de UI
    window.UI = new UIController(this);

    // Cargar sprites originales del GRF
    this.loadOriginalSprites();

    // Arrancar Bucle del Juego
    requestAnimationFrame((t) => this.loop(t));
  }

  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.camera.resize(this.canvas.width, this.canvas.height);
  }

  async loadOriginalSprites() {
    console.log('🔄 [Sprites] Cargando sprites originales desde data.grf...');
    try {
      this.grfSprites.poring = await SprParser.loadAndParse('data/sprite/¸ó½ºÅÍ/poring.spr');
      this.grfSprites.lunatic = await SprParser.loadAndParse('data/sprite/¸ó½ºÅÍ/lunatic.spr');
      this.grfSprites.baphomet = await SprParser.loadAndParse('data/sprite/¸ó½ºÅÍ/baphomet_i.spr');
      this.grfSprites.novice_male = await SprParser.loadAndParse('data/sprite/ÀÎ°£Á·/¸öÅë/³²/ÃÊº¸ÀÚ_³².spr');
      this.grfSprites.novice_female = await SprParser.loadAndParse('data/sprite/ÀÎ°£Á·/¸öÅë/¿©/ÃÊº¸ÀÚ_¿©.spr');
      
      console.log('✅ [Sprites] Sprites originales cargados con éxito.');
    } catch (err) {
      console.warn('⚠️ [Sprites] No se pudieron cargar los sprites originales del GRF, usando fallbacks vectoriales:', err);
    }
  }

  // --- Controles de Mouse & Movimiento ---
  initControls() {
    // Evitar menú contextual con click derecho
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      this.canvas.focus();
      // Asegurar que AudioContext empiece tras interacción del usuario
      if (window.soundManager) window.soundManager.init();

      if (e.button === 0) {
        // Clic Izquierdo: Movimiento o Ataque
        this.handleLeftClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Clic Derecho: Rotar Cámara
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        // Rotar cámara isométricamente por arrastre
        const dx = e.clientX - this.lastMouseX;
        this.camera.addRotation(dx * 0.007);
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        this.isDragging = false;
      }
    });

    // Zoom con Rueda del Mouse
    this.canvas.addEventListener('wheel', (e) => {
      this.camera.addZoom(-e.deltaY * 0.0008);
    }, { passive: true });
  }

  handleLeftClick(mouseX, mouseY) {
    if (this.loading || !this.localPlayer || this.localPlayer.hp <= 0) return;

    // Convertir clic de pantalla a celda de la grilla
    const gridPos = this.camera.screenToTile(mouseX, mouseY);

    // 1. Comprobar si clicó en una entidad (Monstruo u otro Jugador)
    let clickedEntityId = null;
    let clickedEntity = null;

    Object.keys(this.entities).forEach(id => {
      const ent = this.entities[id];
      if (Math.abs(ent.x - gridPos.x) <= 1 && Math.abs(ent.y - gridPos.y) <= 1) {
        clickedEntityId = ent.id;
        clickedEntity = ent;
      }
    });

    if (clickedEntityId) {
      if (clickedEntity.type === 'monster') {
        // Seleccionar como objetivo clásico de ataque
        this.selectedTargetId = clickedEntityId;
        
        // Lanzar ataque directo si ya está a rango
        const dist = Math.max(Math.abs(this.localPlayer.x - clickedEntity.x), Math.abs(this.localPlayer.y - clickedEntity.y));
        if (dist <= 1.8) {
          this.network.sendAttack(clickedEntityId);
        } else {
          // Si está lejos, caminar hacia él
          const path = Pathfinding.findPath(this.map.grid, this.localPlayer, clickedEntity);
          if (path.length > 0) {
            // Recortar último paso para no pararse encima
            path.pop();
            if (path.length > 0) {
              this.localPlayer.targetX = path[path.length - 1].x;
              this.localPlayer.targetY = path[path.length - 1].y;
              this.localPlayer.startX = this.localPlayer.x;
              this.localPlayer.startY = this.localPlayer.y;
              this.localPlayer.lerpProgress = 0;
              this.localPlayer.state = 'moving';
              this.network.sendMove(path);
            }
          }
        }
      }
      return;
    }

    // 2. Si no clicó en monstruo, es un clic de movimiento en grilla libre
    if (!Pathfinding.isBlocked(this.map.grid, gridPos.x, gridPos.y)) {
      const path = Pathfinding.findPath(this.map.grid, this.localPlayer, gridPos);
      if (path.length > 0) {
        this.localPlayer.targetX = gridPos.x;
        this.localPlayer.targetY = gridPos.y;
        this.localPlayer.startX = this.localPlayer.x;
        this.localPlayer.startY = this.localPlayer.y;
        this.localPlayer.lerpProgress = 0;
        this.localPlayer.state = 'moving';
        
        // Enviar ruta calculada al servidor
        this.network.sendMove(path);

        // Crear una pequeña onda visual de clic en el suelo
        this.particleEffects.push({
          x: gridPos.x,
          y: gridPos.y,
          color: '#38bdf8',
          life: 0.4,
          type: 'click_wave'
        });
      }
    }
  }

  // --- Bucle Maestro (Tick / Renderizado) ---
  loop(timestamp) {
    if (!this.lastTime) this.lastTime = timestamp;
    const deltaTime = timestamp - this.lastTime;
    this.lastTime = timestamp;

    this.update(deltaTime);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  // --- Lógica del Cliente ---
  update(deltaTime) {
    if (this.loading) return;

    // 1. Actualizar Cámara con respecto a Jugador Local
    if (this.localPlayer) {
      this.camera.update(this.localPlayer.x, this.localPlayer.y, deltaTime);
    }

    // 2. Actualizar Mapa (Animación del agua, etc.)
    this.map.update(deltaTime);

    // 3. Interpolación suave de Movimiento para Jugador Local
    this.interpolateEntityMovement(this.localPlayer, deltaTime);

    // 4. Interpolación suave de Movimiento para Monstruos/Otros Jugadores
    Object.keys(this.entities).forEach(id => {
      this.interpolateEntityMovement(this.entities[id], deltaTime);
    });

    // 5. Auto-ataque periódico si tenemos objetivo en rango
    if (this.localPlayer && this.selectedTargetId && this.localPlayer.hp > 0) {
      const target = this.entities[this.selectedTargetId];
      if (target && target.hp > 0) {
        const dist = Math.max(Math.abs(this.localPlayer.x - target.x), Math.abs(this.localPlayer.y - target.y));
        if (dist <= 1.8) {
          // Bucle de auto-ataque periódico simple basado en AGI
          const attackSpeed = Math.max(300, 1500 - (this.localPlayer.agi * 14));
          if (!this.lastAttackTime || Date.now() - this.lastAttackTime > attackSpeed) {
            this.network.sendAttack(this.selectedTargetId);
            this.lastAttackTime = Date.now();
          }
        }
      } else {
        this.selectedTargetId = null; // Quitar target si murió
      }
    }

    // 6. Actualizar flotantes de Daño (Pops)
    this.damagePops.forEach((pop, idx) => {
      pop.y += pop.vy * 0.05; // Subir verticalmente
      pop.life -= deltaTime * 0.0016; // Durar unos 600ms
      if (pop.life <= 0) {
        this.damagePops.splice(idx, 1);
      }
    });

    // 7. Actualizar Partículas
    this.particleEffects.forEach((eff, idx) => {
      eff.life -= deltaTime * 0.002;
      if (eff.life <= 0) {
        this.particleEffects.splice(idx, 1);
      }
    });

    // 8. Actualizar burbujas de texto flotantes de chat
    if (this.localPlayer && this.localPlayer.chatBubble) {
      this.localPlayer.chatBubbleTime -= deltaTime * 0.001;
      if (this.localPlayer.chatBubbleTime <= 0) this.localPlayer.chatBubble = null;
    }
    Object.keys(this.entities).forEach(id => {
      const ent = this.entities[id];
      if (ent.chatBubble) {
        ent.chatBubbleTime -= deltaTime * 0.001;
        if (ent.chatBubbleTime <= 0) ent.chatBubble = null;
      }
    });
  }

  interpolateEntityMovement(ent, deltaTime) {
    if (!ent || ent.state !== 'moving') return;

    if (ent.lerpProgress === undefined) ent.lerpProgress = 1;

    // Calcular avance del paso basado en la velocidad (speed es tiempo en ms por celda)
    const stepDuration = ent.speed || 150;
    ent.lerpProgress += deltaTime / stepDuration;

    if (ent.lerpProgress >= 1.0) {
      ent.x = ent.targetX;
      ent.y = ent.targetY;
      ent.lerpProgress = 1.0;
      ent.state = 'idle';
    } else {
      // Interpolación lineal
      ent.x = ent.startX + (ent.targetX - ent.startX) * ent.lerpProgress;
      ent.y = ent.startY + (ent.targetY - ent.startY) * ent.lerpProgress;
    }

    // Animación de pie
    ent.animTime = (ent.animTime || 0) + deltaTime;
    if (ent.animTime > 120) {
      ent.animFrame = ((ent.animFrame || 0) + 1) % 4;
      ent.animTime = 0;
    }
  }

  // --- Dibujar Canvas Completo ---
  render() {
    this.ctx.fillStyle = '#05070c'; // Espacio oscuro premium
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.loading) return;

    // 1. Dibujar el Suelo (Césped, caminos, agua)
    this.map.drawGround(this.ctx, this.camera);

    // 2. Colectar todos los elementos verticales que requieren ordenamiento en 2.5D (Profundidad)
    let renderables = [];

    // Obstáculos del mapa (árboles, muros, fuente)
    const obstacles = this.map.getObstacles(this.camera);
    renderables = renderables.concat(obstacles);

    // Jugador Local
    if (this.localPlayer) {
      renderables.push({
        type: 'player',
        ref: this.localPlayer,
        depth: this.localPlayer.x + this.localPlayer.y
      });
    }

    // Monstruos y otros jugadores
    Object.keys(this.entities).forEach(id => {
      const ent = this.entities[id];
      renderables.push({
        type: ent.type,
        ref: ent,
        depth: ent.x + ent.y
      });
    });

    // 3. ORDENAR ELEMENTOS POR PROFUNDIDAD (Pintado de Atrás hacia Adelante)
    // El criterio isométrico clásico es: menor valor de (x + y) se dibuja primero.
    renderables.sort((a, b) => a.depth - b.depth);

    // 4. DIBUJAR ELEMENTOS ORDENADOS
    renderables.forEach(item => {
      if (item.type === 'obstacle') {
        this.map.drawObstacle(this.ctx, item, this.camera);
      } else if (item.type === 'player') {
        this.drawPlayerSprite(this.ctx, item.ref);
      } else if (item.type === 'monster') {
        this.drawMonsterSprite(this.ctx, item.ref);
      }
    });

    // 5. Dibujar Guía de Ruta del Pathfinder si hay destino clicado
    this.drawPathGuide();

    // 6. Dibujar Partículas
    this.drawParticles();

    // 7. Dibujar Pops de Daño flotando
    this.drawDamagePops();

    // 8. Dibujar indicador de Target / Objetivo Activo
    this.drawTargetIndicator();

    // 9. Actualizar Minimapa en la UI
    if (window.UI && Math.random() < 0.1) { // Reducir frecuencia de dibujado de minimapa para optimizar
      window.UI.drawMinimap();
    }
  }

  // --- Dibujar Jugador ---
  drawPlayerSprite(ctx, char) {
    const pos = this.camera.tileToScreen(char.x, char.y);
    const w = this.camera.tileWidth * this.camera.zoom;
    const h = this.camera.tileHeight * this.camera.zoom * this.camera.pitch * 2;

    ctx.save();

    // 1. Sombra circular
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 2, w / 3, h / 3, 0, 0, Math.PI * 2);
    ctx.fill();

    const scale = this.camera.zoom * 0.9;
    
    // Determinar si tenemos un sprite del GRF cargado
    const isMale = char.gender !== 'F';
    const spriteObj = isMale ? this.grfSprites.novice_male : this.grfSprites.novice_female;

    if (spriteObj && spriteObj.frames && spriteObj.frames.length > 0) {
      // --- RENDERIZAR CUERPO NOVICE ORIGINAL DE GRF ---
      let frameIdx = 0;
      const totalFrames = spriteObj.frames.length;
      
      if (char.state === 'moving') {
        const cycle = Math.floor(Date.now() / 100) % 8; // 8 celdas de caminata
        frameIdx = cycle % totalFrames;
      } else {
        // Idle
        frameIdx = 0;
      }

      const frame = spriteObj.frames[frameIdx] || spriteObj.frames[0];
      if (frame) {
        const sw = frame.width * scale * 1.3;
        const sh = frame.height * scale * 1.3;
        
        // Centrar y dibujar
        ctx.drawImage(frame, pos.x - sw / 2, pos.y - sh + 5 * scale, sw, sh);
        
        // Barra de Vida
        if (char.hp < char.maxHp && char.hp > 0) {
          const barW = 32 * this.camera.zoom;
          const barH = 3 * this.camera.zoom;
          const pct = char.hp / char.maxHp;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(pos.x - barW / 2, pos.y - sh - 2, barW, barH);
          ctx.fillStyle = '#10b981';
          ctx.fillRect(pos.x - barW / 2, pos.y - sh - 2, barW * pct, barH);
        }

        // Nombre
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `bold ${Math.round(10 * this.camera.zoom)}px var(--font-body)`;
        ctx.textAlign = 'center';
        ctx.fillText(char.name, pos.x, pos.y - sh - 6);

        if (char.chatBubble) {
          this.drawChatBubble(ctx, pos.x, pos.y - sh - 15, char.chatBubble);
        }

        ctx.restore();
        return;
      }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 2, w / 3, h / 3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Pequeño balanceo por animación de movimiento
    let bob = 0;
    if (char.state === 'moving') {
      bob = Math.abs(Math.sin((char.animFrame || 0) * Math.PI / 2)) * 4 * this.camera.zoom;
    }

    // 2. Dibujar Cuerpo del Personaje
    const charColor = this.getHairColorHex(char.hairColor);

    // Traje según Clase
    let clothColor = '#38bdf8'; // Novice celeste
    if (char.job === 'Swordman') clothColor = '#e2e8f0'; // Swordman metalico gris
    else if (char.job === 'Mage') clothColor = '#a855f7'; // Mago morado

    // Renderizar cuerpo con vector simple estilizado pixel-retro
    ctx.fillStyle = clothColor;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 12 * scale - bob, 8 * scale, 12 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();

    // Cabeza (Cara)
    ctx.fillStyle = '#fbc4b2'; // Piel clara
    ctx.beginPath();
    ctx.arc(pos.x, pos.y - 25 * scale - bob, 6 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Ojos
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(pos.x - 2 * scale, pos.y - 26 * scale - bob, 0.8 * scale, 0, Math.PI * 2);
    ctx.arc(pos.x + 2 * scale, pos.y - 26 * scale - bob, 0.8 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Cabello
    ctx.fillStyle = charColor;
    if (char.hair === 1) { // Cabello Largo
      ctx.beginPath();
      ctx.moveTo(pos.x - 7 * scale, pos.y - 24 * scale - bob);
      ctx.quadraticCurveTo(pos.x, pos.y - 34 * scale - bob, pos.x + 7 * scale, pos.y - 24 * scale - bob);
      ctx.quadraticCurveTo(pos.x + 8 * scale, pos.y - 18 * scale - bob, pos.x + 5 * scale, pos.y - 18 * scale - bob);
      ctx.lineTo(pos.x - 5 * scale, pos.y - 18 * scale - bob);
      ctx.closePath();
      ctx.fill();
    } else if (char.hair === 2) { // Espinado (Punk)
      ctx.beginPath();
      ctx.moveTo(pos.x - 7 * scale, pos.y - 24 * scale - bob);
      ctx.lineTo(pos.x - 9 * scale, pos.y - 29 * scale - bob);
      ctx.lineTo(pos.x - 4 * scale, pos.y - 28 * scale - bob);
      ctx.lineTo(pos.x, pos.y - 34 * scale - bob);
      ctx.lineTo(pos.x + 4 * scale, pos.y - 28 * scale - bob);
      ctx.lineTo(pos.x + 9 * scale, pos.y - 29 * scale - bob);
      ctx.lineTo(pos.x + 7 * scale, pos.y - 24 * scale - bob);
      ctx.closePath();
      ctx.fill();
    } else { // Corto
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - 28 * scale - bob, 7 * scale, 4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dibujar Sombrero si tiene (Poring Hat)
    if (char.equipment && char.equipment.headgear === 2201) {
      ctx.fillStyle = '#fda4af'; // Rosa poring
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 31 * scale - bob, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ojitos del sombrero poring
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(pos.x - 2 * scale, pos.y - 31 * scale - bob, 0.8 * scale, 0, Math.PI * 2);
      ctx.arc(pos.x + 2 * scale, pos.y - 31 * scale - bob, 0.8 * scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (char.equipment && char.equipment.headgear === 2202) { // Cinta
      ctx.fillStyle = '#ef4444'; // Cinta Roja
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - 30 * scale - bob, 4 * scale, 1.8 * scale, 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Arma (Espada/Cuchillo en mano)
    if (char.equipment && char.equipment.weapon) {
      ctx.strokeStyle = '#cbd5e1'; // Metal
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(pos.x + 6 * scale, pos.y - 12 * scale - bob);
      ctx.lineTo(pos.x + 16 * scale, pos.y - 18 * scale - bob);
      ctx.stroke();
    }

    // 3. Barra de Vida reducida clásica (solo si está dañado)
    if (char.hp < char.maxHp && char.hp > 0) {
      const barW = 32 * this.camera.zoom;
      const barH = 3 * this.camera.zoom;
      const pct = char.hp / char.maxHp;

      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pos.x - barW / 2, pos.y - 42 * scale - bob, barW, barH);
      ctx.fillStyle = '#10b981'; // Verde vida
      ctx.fillRect(pos.x - barW / 2, pos.y - 42 * scale - bob, barW * pct, barH);
    }

    // 4. Nombre flotante clásico de RO (Gris suave)
    ctx.fillStyle = '#f1f5f9';
    ctx.font = `bold ${Math.round(10 * this.camera.zoom)}px var(--font-body)`;
    ctx.textAlign = 'center';
    ctx.fillText(char.name, pos.x, pos.y - 46 * scale - bob);

    // Burbuja de Chat flotante
    if (char.chatBubble) {
      this.drawChatBubble(ctx, pos.x, pos.y - 65 * scale - bob, char.chatBubble);
    }

    ctx.restore();
  }

  // --- Dibujar Monstruo (Poring, Lunatic, Baphomet Jr) ---
  drawMonsterSprite(ctx, mob) {
    const pos = this.camera.tileToScreen(mob.x, mob.y);
    const w = this.camera.tileWidth * this.camera.zoom;
    const h = this.camera.tileHeight * this.camera.zoom * this.camera.pitch * 2;

    ctx.save();

    // 1. Sombra
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y + 1, w / 3.5, h / 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const scale = this.camera.zoom * (mob.scale || 1.0);
    
    // Determinar si tenemos un sprite del GRF cargado
    let spriteObj = null;
    if (mob.mobId === 1001) spriteObj = this.grfSprites.poring;
    else if (mob.mobId === 1002) spriteObj = this.grfSprites.lunatic;
    else if (mob.mobId === 1003) spriteObj = this.grfSprites.baphomet;

    if (spriteObj && spriteObj.frames && spriteObj.frames.length > 0) {
      // --- RENDERIZAR SPRITE ORIGINAL DE GRF ---
      let frameIdx = 0;
      const totalFrames = spriteObj.frames.length;
      
      if (mob.state === 'dead') {
        frameIdx = Math.min(totalFrames - 1, 15); // frame de muerte
      } else {
        const cycle = Math.floor(Date.now() / 150) % 4; // 4 marcos de caminata
        frameIdx = cycle % totalFrames;
      }

      const frame = spriteObj.frames[frameIdx] || spriteObj.frames[0];
      if (frame) {
        const sw = frame.width * scale * 1.2;
        const sh = frame.height * scale * 1.2;
        
        // Centrar y dibujar
        ctx.drawImage(frame, pos.x - sw / 2, pos.y - sh + 5 * scale, sw, sh);
        
        // Dibujar barra de vida y nombre
        if (mob.state !== 'dead') {
          if (mob.hp < mob.maxHp) {
            const barW = 28 * this.camera.zoom;
            const barH = 2.5 * this.camera.zoom;
            const pct = mob.hp / mob.maxHp;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(pos.x - barW / 2, pos.y - sh - 2, barW, barH);
            ctx.fillStyle = '#ef4444';
            ctx.fillRect(pos.x - barW / 2, pos.y - sh - 2, barW * pct, barH);
          }
          ctx.fillStyle = '#f87171';
          ctx.font = `${Math.round(8.5 * this.camera.zoom)}px var(--font-body)`;
          ctx.textAlign = 'center';
          ctx.fillText(mob.name, pos.x, pos.y - sh - 6);
        }
        
        if (mob.chatBubble) {
          this.drawChatBubble(ctx, pos.x, pos.y - sh - 15, mob.chatBubble);
        }
        
        ctx.restore();
        return;
      }
    }
    
    // Animación de Salto / Rebote clásica de Poring
    let bounce = 0;
    let squishX = 0;
    let squishY = 0;
    const cycle = (Date.now() / 300) + mob.id; // Desfasar cada monstruo

    if (mob.state === 'dead') {
      bounce = 0;
    } else {
      bounce = Math.max(0, Math.sin(cycle)) * 8 * scale;
      squishX = Math.cos(cycle) * 1.5 * scale;
      squishY = -Math.cos(cycle) * 1.5 * scale;
    }

    if (mob.mobId === 1001) {
      // --- PORING (Burbuja Gelatinosa Rosa) ---
      ctx.fillStyle = '#fda4af'; // Rosa Poring
      ctx.beginPath();
      // Dibujar como elipse distorsionada para dar sensación gelatinosa
      ctx.ellipse(pos.x, pos.y - 8 * scale - bounce, (9 + squishX) * scale, (8 + squishY) * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1 * scale;
      ctx.stroke();

      // Ojitos
      ctx.fillStyle = '#312e81';
      ctx.beginPath();
      ctx.arc(pos.x - 3 * scale, pos.y - 8 * scale - bounce, 0.8 * scale, 0, Math.PI * 2);
      ctx.arc(pos.x + 3 * scale, pos.y - 8 * scale - bounce, 0.8 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Boca sonriente
      ctx.strokeStyle = '#312e81';
      ctx.lineWidth = 0.8 * scale;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 6 * scale - bounce, 1.5 * scale, 0.1, Math.PI - 0.1);
      ctx.stroke();

    } else if (mob.mobId === 1002) {
      // --- LUNATIC (Conejo Blanco Saltador con Orejas Grandes) ---
      // Cuerpo
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - 8 * scale - bounce, (8 + squishX) * scale, (8 + squishY) * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1 * scale;
      ctx.stroke();

      // Orejas grandes
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.ellipse(pos.x - 3 * scale, pos.y - 16 * scale - bounce, 2 * scale, 5 * scale, -0.2, 0, Math.PI * 2);
      ctx.ellipse(pos.x + 3 * scale, pos.y - 16 * scale - bounce, 2 * scale, 5 * scale, 0.2, 0, Math.PI * 2);
      ctx.fill();

      // Ojos de Lunatic (Rosa/Rojo suave)
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(pos.x - 2 * scale, pos.y - 8 * scale - bounce, 1.0 * scale, 0, Math.PI * 2);
      ctx.arc(pos.x + 2 * scale, pos.y - 8 * scale - bounce, 1.0 * scale, 0, Math.PI * 2);
      ctx.fill();

    } else if (mob.mobId === 1003) {
      // --- BAPHOMET JR (Pequeño Demonio Oscuro) ---
      // Capa/Cuerpo oscuro
      ctx.fillStyle = '#1e1b4b'; // Azul marino muy oscuro
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - 12 * scale - bounce, 8 * scale, 12 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cabeza
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y - 24 * scale - bounce, 6 * scale, 0, Math.PI * 2);
      ctx.fill();

      // Cuernos rojos curvados premium
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.arc(pos.x - 5 * scale, pos.y - 26 * scale - bounce, 4 * scale, Math.PI, Math.PI * 1.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pos.x + 5 * scale, pos.y - 26 * scale - bounce, 4 * scale, Math.PI * 1.4, 0);
      ctx.stroke();

      // Ojos Brillantes de Baphomet (Cian/Neon)
      ctx.fillStyle = '#06b6d4';
      ctx.beginPath();
      ctx.arc(pos.x - 2 * scale, pos.y - 24 * scale - bounce, 1 * scale, 0, Math.PI * 2);
      ctx.arc(pos.x + 2 * scale, pos.y - 24 * scale - bounce, 1 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // Nombre y vida flotante reducida
    if (mob.state !== 'dead') {
      // Barra de Vida
      if (mob.hp < mob.maxHp) {
        const barW = 28 * this.camera.zoom;
        const barH = 2.5 * this.camera.zoom;
        const pct = mob.hp / mob.maxHp;
        
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(pos.x - barW / 2, pos.y - 35 * scale - bounce, barW, barH);
        ctx.fillStyle = '#ef4444'; // Rojo vida monstruo
        ctx.fillRect(pos.x - barW / 2, pos.y - 35 * scale - bounce, barW * pct, barH);
      }

      // Nombre
      ctx.fillStyle = '#f87171';
      ctx.font = `${Math.round(8.5 * this.camera.zoom)}px var(--font-body)`;
      ctx.textAlign = 'center';
      ctx.fillText(mob.name, pos.x, pos.y - 39 * scale - bounce);
    }

    // Burbuja de Chat flotante
    if (mob.chatBubble) {
      this.drawChatBubble(ctx, pos.x, pos.y - 50 * scale - bounce, mob.chatBubble);
    }

    ctx.restore();
  }

  // --- Dibujar Burbuja de Habla ---
  drawChatBubble(ctx, x, y, text) {
    ctx.save();
    ctx.font = '9px var(--font-body)';
    const textWidth = ctx.measureText(text).width;
    const paddingX = 8;
    const paddingY = 5;
    const w = textWidth + paddingX * 2;
    const h = 18;

    // Caja de la burbuja
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Pequeño triángulo indicador apuntando abajo
    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y + 4);
    ctx.closePath();
    ctx.fill();

    // Texto
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - h / 2);

    ctx.restore();
  }

  // --- Dibujar Guías de Camino en el Suelo ---
  drawPathGuide() {
    if (!this.localPlayer || this.localPlayer.state !== 'moving') return;

    // Si queremos dibujar el camino, podemos almacenar los puntos y dibujarlos
    // Por simplicidad estética, dibujaremos una onda azul pequeña en el destino del click
  }

  // --- Dibujar Partículas y Efectos de Magia ---
  drawParticles() {
    this.particleEffects.forEach(eff => {
      const pos = this.camera.tileToScreen(eff.x, eff.y);
      const w = this.camera.tileWidth * this.camera.zoom;
      
      this.ctx.save();

      if (eff.type === 'click_wave') {
        // Onda de choque circular en el suelo
        const progress = 1.0 - eff.life / 0.4;
        this.ctx.strokeStyle = eff.color;
        this.ctx.lineWidth = 2 * (1.0 - progress);
        this.ctx.beginPath();
        this.ctx.ellipse(pos.x, pos.y, (w / 3) * progress, (w / 6) * progress, 0, 0, Math.PI * 2);
        this.ctx.stroke();

      } else if (eff.type === 'level_up') {
        // Aura de luz ascendente icónica de level up
        const progress = 1.0 - eff.life / 1.5;
        
        // Dibujar pilar de luz dorado translúcido
        const grad = this.ctx.createLinearGradient(pos.x, pos.y, pos.x, pos.y - 120 * this.camera.zoom);
        grad.addColorStop(0, 'rgba(253, 224, 71, 0.6)');
        grad.addColorStop(0.5, 'rgba(253, 224, 71, 0.3)');
        grad.addColorStop(1, 'rgba(253, 224, 71, 0)');

        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.ellipse(pos.x, pos.y, (w / 1.8) * (1 - progress * 0.3), (w / 3.6) * (1 - progress * 0.3), 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillRect(pos.x - (w / 2) * (1 - progress), pos.y - 140 * this.camera.zoom * progress, w * (1 - progress), 140 * this.camera.zoom);

      } else if (eff.type === 'bash' || eff.type === 'double_strafe') {
        // Impacto rojo/naranja
        const radius = (25 * (1.0 - eff.life)) * this.camera.zoom;
        this.ctx.fillStyle = eff.color;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y - 10 * this.camera.zoom, radius, 0, Math.PI * 2);
        this.ctx.fill();

      } else if (eff.type === 'fire_bolt') {
        // Lluvia de bolas de fuego cayendo del cielo
        const progress = 1.0 - eff.life;
        const fy = pos.y - 150 * this.camera.zoom * (1 - progress);
        this.ctx.fillStyle = '#ff4500';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, fy, 8 * this.camera.zoom, 0, Math.PI * 2);
        this.ctx.fill();
        
        // Destello en el suelo
        if (progress > 0.8) {
          this.ctx.fillStyle = 'rgba(255, 69, 0, 0.4)';
          this.ctx.beginPath();
          this.ctx.ellipse(pos.x, pos.y, w / 2, w / 4, 0, 0, Math.PI * 2);
          this.ctx.fill();
        }
      } else if (eff.type === 'heal' || eff.type === 'heal_potion') {
        // Cruz verde y pilares ascendentes de curación
        const progress = 1.0 - eff.life;
        this.ctx.fillStyle = 'rgba(92, 214, 92, 0.4)';
        this.ctx.beginPath();
        this.ctx.ellipse(pos.x, pos.y, w / 2 * progress, w / 4 * progress, 0, 0, Math.PI * 2);
        this.ctx.fill();

        // Cruz verde flotando arriba
        this.ctx.fillStyle = eff.color;
        this.ctx.font = `bold ${Math.round(20 * this.camera.zoom)}px var(--font-body)`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText("+", pos.x, pos.y - 20 * this.camera.zoom - 30 * this.camera.zoom * progress);
      }

      this.ctx.restore();
    });
  }

  // --- Dibujar Combat Text Flotante (Damage Pops) ---
  drawDamagePops() {
    this.damagePops.forEach(pop => {
      const pos = this.camera.tileToScreen(pop.x, pop.y);
      this.ctx.save();

      this.ctx.textAlign = 'center';
      
      let fill = '#fff'; // Daño estándar blanco
      let font = `${Math.round(15 * this.camera.zoom)}px var(--font-title)`;
      let text = pop.text;

      if (pop.isCrit) {
        fill = '#facc15'; // Crítico dorado
        font = `bold ${Math.round(20 * this.camera.zoom)}px var(--font-title)`;
        text = `★ ${text} ★`;
      } else if (pop.isMiss) {
        fill = '#94a3b8'; // Miss gris
        font = `bold ${Math.round(13 * this.camera.zoom)}px var(--font-body)`;
      } else if (pop.heal) {
        fill = '#22c55e'; // Curación verde
        font = `bold ${Math.round(16 * this.camera.zoom)}px var(--font-title)`;
        text = `+${text}`;
      }

      // Sombra del texto
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.font = font;
      this.ctx.fillText(text, pos.x + 1, pos.y - 25 * this.camera.zoom + pop.y + 1);

      // Texto de frente con alpha progresivo para fade out
      this.ctx.fillStyle = fill;
      this.ctx.globalAlpha = Math.min(1.0, pop.life * 2.0); // Desvanecer suavemente al final
      this.ctx.fillText(text, pos.x, pos.y - 25 * this.camera.zoom + pop.y);

      this.ctx.restore();
    });
  }

  // --- Dibujar Objetivo Seleccionado (Aura Roja en el suelo) ---
  drawTargetIndicator() {
    if (!this.selectedTargetId) return;

    const target = this.entities[this.selectedTargetId];
    if (!target || target.hp <= 0) {
      this.selectedTargetId = null;
      return;
    }

    const pos = this.camera.tileToScreen(target.x, target.y);
    const w = this.camera.tileWidth * this.camera.zoom;
    const h = this.camera.tileHeight * this.camera.zoom * this.camera.pitch * 2;

    this.ctx.save();
    
    // Círculo rojo intermitente bajo el monstruo
    const alpha = 0.35 + Math.sin(Date.now() / 150) * 0.15;
    this.ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
    this.ctx.lineWidth = 2 * this.camera.zoom;

    this.ctx.beginPath();
    this.ctx.ellipse(pos.x, pos.y + 1, w / 2.3, h / 2.3, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.restore();
  }

  // Helper de colores de pelo
  getHairColorHex(idx) {
    const colors = ['#ffd480', '#ff8080', '#80c4ff', '#c480ff', '#80ff80'];
    return colors[idx] || '#ffd480';
  }
}

// Iniciar aplicación al cargar todo
window.onload = async () => {
  if (window.location.pathname.endsWith('game.html')) {
    if (window.localGRF) {
      try {
        console.log('🔄 [LocalGRF] Inicializando base de datos local GRF antes del motor...');
        await window.localGRF.init();
      } catch (err) {
        console.error('❌ [LocalGRF] Fallo al inicializar LocalGRF:', err);
      }
    }
    window.gameInstance = new Game();
  }
};
