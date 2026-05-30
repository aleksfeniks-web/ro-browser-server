/**
 * WebRO - Client Main Controller & Three.js 3D WebGL Engine
 * Manages the core game loop, network packets, 3D coordinate mapping,
 * vertical billboard entity rendering, and projected 2D overlays.
 */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    
    // --- INICIALIZAR RENDERIZADOR WEBGL 3D ---
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- CREAR CAPA CANVASES 2D OVERLAYS ---
    // Esta capa transparente se dibuja encima del canvas 3D y muestra nombres,
    // burbujas de chat y flotantes de daño con precisión matemática proyectada.
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.id = 'game-overlay-canvas';
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.width = '100%';
    this.overlayCanvas.style.height = '100%';
    this.overlayCanvas.style.pointerEvents = 'none'; // Clics traspasan al canvas 3D inferior
    this.overlayCanvas.style.zIndex = '5';
    document.body.appendChild(this.overlayCanvas);
    this.ctx = this.overlayCanvas.getContext('2d');
    
    this.loading = true;
    this.lastTime = 0;
    
    // --- INICIALIZAR ESCENA 3D ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#05070c');
    this.scene.fog = new THREE.FogExp2('#05070c', 0.012); // Neblina atmosférica oscura

    // --- LUCES DE LA ESCENA ---
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.75);
    dirLight.position.set(25, 45, 15);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    this.scene.add(dirLight);

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
    this.grfHeadSprites = {};

    // Configurar Canvas
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    // Inicializar Controles e Inputs
    this.initControls();
    
    // Inicializar Red
    this.network.connect();
    
    // Crear Instancia global de UI
    window.UI = new UIController(this);

    // Vincular escena 3D al mapa
    this.map.init3DScene(this.scene);

    // Cargar sprites originales del GRF
    this.loadOriginalSprites();

    // Arrancar Bucle del Juego
    requestAnimationFrame((t) => this.loop(t));
  }

  resizeCanvas() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    this.canvas.width = w;
    this.canvas.height = h;
    
    this.overlayCanvas.width = w;
    this.overlayCanvas.height = h;
    
    this.renderer.setSize(w, h);
    this.camera.resize(w, h);
  }

  async loadOriginalSprites() {
    console.log('🔄 [Sprites] Cargando sprites originales desde data.grf...');
    
    // Cada sprite se carga independientemente para que un fallo no cancele los demás
    const spriteLoads = [
      { key: 'poring', path: 'data/sprite/¸ó½ºÅÍ/poring.spr' },
      { key: 'lunatic', path: 'data/sprite/¸ó½ºÅÍ/lunatic.spr' },
      { key: 'baphomet', path: 'data/sprite/¸ó½ºÅÍ/baphomet_i.spr' },
      { key: 'novice_male', path: 'data/sprite/ÀÎ°£Á·/¸öÅë/³²/ÃÊº¸ÀÚ_³².spr' },
      { key: 'novice_female', path: 'data/sprite/ÀÎ°£Á·/¸öÅë/¿©/ÃÊº¸ÀÚ_¿©.spr' }
    ];

    const results = await Promise.allSettled(
      spriteLoads.map(async ({ key, path }) => {
        try {
          const spr = await SprParser.loadAndParse(path);
          this.grfSprites[key] = spr;
          console.log(`✅ [Sprites] ${key} cargado correctamente`);
        } catch (err) {
          console.warn(`⚠️ [Sprites] No se pudo cargar ${key} (${path}):`, err);
        }
      })
    );

    const loaded = Object.keys(this.grfSprites).filter(k => this.grfSprites[k] !== null);
    console.log(`📦 [Sprites] ${loaded.length}/${spriteLoads.length} sprites cargados: ${loaded.join(', ')}`);
  }

  // --- Controles de Mouse & Movimiento ---
  initControls() {
    // Evitar menú contextual con click derecho
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.canvas.addEventListener('mousedown', (e) => {
      this.canvas.focus();
      if (window.soundManager) window.soundManager.init();

      if (e.button === 0) {
        // Clic Izquierdo: Movimiento o Ataque (Raycaster)
        this.handleLeftClick(e.clientX, e.clientY);
      } else if (e.button === 2) {
        // Clic Derecho: Rotar Cámara Orbital
        this.isDragging = true;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        // Rotar cámara orbital en 3D
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

    // Zoom con Rueda del Mouse en 3D
    this.canvas.addEventListener('wheel', (e) => {
      this.camera.addZoom(-e.deltaY * 0.0008);
    }, { passive: true });
  }

  handleLeftClick(mouseX, mouseY) {
    if (this.loading || !this.localPlayer || this.localPlayer.hp <= 0) return;

    // Convertir clic de pantalla a celda de la grilla 3D mediante Raycasting
    const gridPos = this.camera.screenToTile(mouseX, mouseY);

    // 1. Comprobar si clicó en una entidad
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
        this.selectedTargetId = clickedEntityId;
        
        const dist = Math.max(Math.abs(this.localPlayer.x - clickedEntity.x), Math.abs(this.localPlayer.y - clickedEntity.y));
        if (dist <= 1.8) {
          this.network.sendAttack(clickedEntityId);
        } else {
          const path = Pathfinding.findPath(this.map.grid, this.localPlayer, clickedEntity);
          if (path.length > 0) {
            path.pop();
            if (path.length > 0) {
              this.localPlayer.path = path;
              const nextStep = this.localPlayer.path.shift();
              this.localPlayer.targetX = nextStep.x;
              this.localPlayer.targetY = nextStep.y;
              this.localPlayer.startX = Math.round(this.localPlayer.x);
              this.localPlayer.startY = Math.round(this.localPlayer.y);
              this.localPlayer.lerpProgress = 0;
              this.localPlayer.state = 'moving';
              this.network.sendMove([nextStep, ...this.localPlayer.path]);
            }
          }
        }
      }
      return;
    }

    // 2. Clic de movimiento libre en celda libre
    if (!Pathfinding.isBlocked(this.map.grid, gridPos.x, gridPos.y)) {
      const path = Pathfinding.findPath(this.map.grid, this.localPlayer, gridPos);
      if (path.length > 0) {
        this.localPlayer.path = path;
        const nextStep = this.localPlayer.path.shift();
        this.localPlayer.targetX = nextStep.x;
        this.localPlayer.targetY = nextStep.y;
        this.localPlayer.startX = Math.round(this.localPlayer.x);
        this.localPlayer.startY = Math.round(this.localPlayer.y);
        this.localPlayer.lerpProgress = 0;
        this.localPlayer.state = 'moving';
        
        this.network.sendMove([nextStep, ...this.localPlayer.path]);

        // Partícula visual 2D proyectada
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

    // 1. Actualizar Cámara Orbital siguiendo al jugador
    if (this.localPlayer) {
      this.camera.update(this.localPlayer.x, this.localPlayer.y, deltaTime);
    }

    // 2. Actualizar Mapa (Fuentes, agua, portales)
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
          const attackSpeed = Math.max(300, 1500 - (this.localPlayer.agi * 14));
          if (!this.lastAttackTime || Date.now() - this.lastAttackTime > attackSpeed) {
            this.network.sendAttack(this.selectedTargetId);
            this.lastAttackTime = Date.now();
          }
        }
      } else {
        this.selectedTargetId = null;
      }
    }

    // 6. Actualizar flotantes de Daño (Pops)
    this.damagePops.forEach((pop, idx) => {
      pop.y += pop.vy * 0.05;
      pop.life -= deltaTime * 0.0016;
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
    if (!ent) return;

    if (ent.state === 'moving') {
      if (ent.lerpProgress === undefined) ent.lerpProgress = 1;

      const stepDuration = ent.speed || 150;
      ent.lerpProgress += deltaTime / stepDuration;

      if (ent.lerpProgress >= 1.0) {
        ent.x = ent.targetX;
        ent.y = ent.targetY;
        
        if (ent.path && ent.path.length > 0) {
          const nextStep = ent.path.shift();
          ent.startX = ent.x;
          ent.startY = ent.y;
          ent.targetX = nextStep.x;
          ent.targetY = nextStep.y;
          ent.lerpProgress = 0;
          ent.state = 'moving';
        } else {
          ent.lerpProgress = 1.0;
          ent.state = 'idle';
        }
      } else {
        ent.x = ent.startX + (ent.targetX - ent.startX) * ent.lerpProgress;
        ent.y = ent.startY + (ent.targetY - ent.startY) * ent.lerpProgress;
      }
    }

    // Actualizar animación
    ent.animTime = (ent.animTime || 0) + deltaTime;
    if (ent.animTime > 120) {
      ent.animFrame = ((ent.animFrame || 0) + 1) % 4;
      ent.animTime = 0;
    }
  }

  // --- Sincronizar Representación 3D en la Escena Three.js ---
  getOrCreateEntity3D(ent) {
    if (!ent) return null;

    if (ent.threeGroup) {
      // Retornar si ya existe
      return ent.threeGroup;
    }

    const group = new THREE.Group();
    group.position.set(ent.x, 0.1, ent.y);
    this.scene.add(group);
    ent.threeGroup = group;

    // Crear Billboard Sprite para alojar texturas del Sprite (.spr)
    const mat = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 1.5, 1.0);
    sprite.position.y = 0.65; // Elevar sobre el plano del suelo
    group.add(sprite);

    // Sprite extra para cabeza/cabello y que se encimen correctamente
    const headMat = new THREE.SpriteMaterial({
      transparent: true,
      depthWrite: false
    });
    const headSprite = new THREE.Sprite(headMat);
    headSprite.scale.set(1.5, 1.5, 1.0);
    headSprite.position.y = 0.65;
    group.add(headSprite);

    // Fallback geométrico 3D si no hay sprites del GRF
    const geoFallback = new THREE.CylinderGeometry(0.12, 0.12, 0.8, 8);
    const colorFallback = ent.type === 'player' ? 0x0ea5e9 : 0xef4444;
    const matFallback = new THREE.MeshStandardMaterial({ color: colorFallback });
    const meshFallback = new THREE.Mesh(geoFallback, matFallback);
    meshFallback.position.y = 0.4;
    meshFallback.visible = false;
    group.add(meshFallback);

    group.userData = {
      sprite,
      headSprite,
      fallback: meshFallback
    };

    return group;
  }

  removeEntity3D(ent) {
    if (ent && ent.threeGroup) {
      this.scene.remove(ent.threeGroup);
      
      ent.threeGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });

      ent.threeGroup = null;
    }
  }

  clearAllEntities3D() {
    Object.keys(this.entities).forEach(id => {
      this.removeEntity3D(this.entities[id]);
    });
    if (this.localPlayer) {
      this.removeEntity3D(this.localPlayer);
    }
  }

  // --- Dibujar Canvas Completo ---
  render() {
    // 1. Limpiar el Canvas de Overlays 2D
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.loading) return;

    // 2. Sincronizar Jugador Local en la escena 3D
    if (this.localPlayer) {
      const g = this.getOrCreateEntity3D(this.localPlayer);
      if (g) g.position.set(this.localPlayer.x, 0.1, this.localPlayer.y);
      this.syncSpriteTexture(this.localPlayer);
    }

    // 3. Sincronizar Monstruos y otros jugadores
    Object.keys(this.entities).forEach(id => {
      const ent = this.entities[id];
      const g = this.getOrCreateEntity3D(ent);
      if (g) g.position.set(ent.x, 0.1, ent.y);
      this.syncSpriteTexture(ent);
    });

    // 4. RENDERIZAR ESCENA 3D (Three.js WebGL)
    this.renderer.render(this.scene, this.camera.camera3D);

    // 5. RENDERIZAR CAPA DE OVERLAYS 2D PROYECTADA
    // Llamar a los dibujadores de UI pasándole el 2D context
    if (this.localPlayer) {
      this.drawPlayerOverlays(this.ctx, this.localPlayer);
    }
    
    Object.keys(this.entities).forEach(id => {
      const ent = this.entities[id];
      if (ent.type === 'player') {
        this.drawPlayerOverlays(this.ctx, ent);
      } else {
        this.drawMonsterOverlays(this.ctx, ent);
      }
    });

    // 6. Dibujar Partículas y Efectos de Clic
    this.drawParticles();

    // 7. Dibujar pops de daño
    this.drawDamagePops();

    // 8. Dibujar indicador de Target seleccionado
    this.drawTargetIndicator();

    // 9. Actualizar Minimapa en la UI
    if (window.UI && Math.random() < 0.1) {
      window.UI.drawMinimap();
    }
  }

  // Sincronizar texturas originales del Sprite (.spr) en los Billboards 3D
  syncSpriteTexture(char) {
    if (!char.threeGroup) return;

    const { sprite, headSprite, fallback } = char.threeGroup.userData;

    // Determinar sprite de cuerpo
    let spriteObj = null;
    let headSpriteObj = null;

    if (char.type === 'player') {
      const isMale = char.gender !== 'F';
      spriteObj = isMale ? this.grfSprites.novice_male : this.grfSprites.novice_female;

      // --- CARGA LAZY DE CABEZA (se dispara una vez y luego usa cache) ---
      const genderKey = char.gender === 'F' ? 'female' : 'male';
      const cacheKey = `${genderKey}_${char.hair || 1}`;

      if (this.grfHeadSprites[cacheKey] === undefined) {
        this.grfHeadSprites[cacheKey] = null; // Marcar como "cargando"
        const genderFolder = char.gender === 'F' ? '¿©' : '³²';
        const sprPath = `data/sprite/ÀÎ°£Á·/¸Ó¸®Åë/${genderFolder}/${char.hair || 1}_${genderFolder}.spr`;
        
        SprParser.loadAndParse(sprPath).then(sObj => {
          this.grfHeadSprites[cacheKey] = sObj;
          console.log(`✅ [Head] Sprite de cabeza cargado para ${cacheKey}`);
        }).catch(err => {
          this.grfHeadSprites[cacheKey] = false; // Marcado como fallido, no reintentar
          console.warn(`⚠️ [Head] No se pudo cargar cabeza para ${cacheKey}:`, err);
        });
      }

      const cached = this.grfHeadSprites[cacheKey];
      if (cached && cached.frames) {
        headSpriteObj = cached;
      }
    } else {
      // Monstruo
      if (char.mobId === 1001) spriteObj = this.grfSprites.poring;
      else if (char.mobId === 1002) spriteObj = this.grfSprites.lunatic;
      else if (char.mobId === 1003) spriteObj = this.grfSprites.baphomet;
    }

    if (spriteObj && spriteObj.frames && spriteObj.frames.length > 0) {
      // --- USO DE TEXTURAS ORIGINALES DE GRF ---
      sprite.visible = true;
      fallback.visible = false;

      // Pre-generar CanvasTextures en Three.js con filtro Nearest
      if (!spriteObj.threeTextures) {
        spriteObj.threeTextures = spriteObj.frames.map(canvas => {
          if (!canvas) return null;
          const tex = new THREE.CanvasTexture(canvas);
          tex.generateMipmaps = false; // Desactivar mipmaps para compatibilidad con texturas NPOT (Non-Power-of-Two)
          tex.minFilter = THREE.NearestFilter;
          tex.magFilter = THREE.NearestFilter; // Mantener hermoso aspecto pixel-art retro!
          return tex;
        });
      }

      // Animaciones de Frames
      let frameIdx = 0;
      if (char.state === 'moving') {
        const cycle = Math.floor(Date.now() / 100) % 8;
        frameIdx = cycle % spriteObj.frames.length;
      } else if (char.state === 'dead') {
        frameIdx = Math.min(spriteObj.frames.length - 1, 15);
      } else {
        frameIdx = 0;
      }

      const tex = spriteObj.threeTextures[frameIdx] || spriteObj.threeTextures[0];
      if (tex) {
        tex.needsUpdate = true; // Forzar subida a la GPU
        sprite.material.map = tex;
        sprite.material.needsUpdate = true;
      }

      // --- SINCRONIZAR CABEZA SI ES UN JUGADOR ---
      if (headSpriteObj && headSpriteObj.frames && headSpriteObj.frames.length > 0) {
        headSprite.visible = true;

        if (!headSpriteObj.threeTextures) {
          headSpriteObj.threeTextures = headSpriteObj.frames.map(canvas => {
            if (!canvas) return null;
            const tex = new THREE.CanvasTexture(canvas);
            tex.generateMipmaps = false; // Desactivar mipmaps para compatibilidad con texturas NPOT
            tex.minFilter = THREE.NearestFilter;
            tex.magFilter = THREE.NearestFilter;
            return tex;
          });
        }

        const headFrameIdx = frameIdx % headSpriteObj.frames.length;
        const headTex = headSpriteObj.threeTextures[headFrameIdx] || headSpriteObj.threeTextures[0];
        if (headTex) {
          headTex.needsUpdate = true; // Forzar subida a la GPU
          headSprite.material.map = headTex;
          headSprite.material.needsUpdate = true;
        }
      } else {
        headSprite.visible = false;
      }

    } else {
      // --- FALLBACK VECTORIAL A FALTA DE DATA.GRF ---
      sprite.visible = false;
      headSprite.visible = false;
      fallback.visible = true;
    }
  }

  // --- DIBUJAR CAPA OVERLAYS 2D PARA JUGADORES ---
  drawPlayerOverlays(ctx, char) {
    const pos = this.camera.tileToScreen(char.x, char.y, 1.2); // Proyectar 1.2 unidades arriba del suelo
    
    ctx.save();
    
    // HP Bar
    if (char.hp < char.maxHp && char.hp > 0) {
      const barW = 32 * this.camera.zoom;
      const barH = 3 * this.camera.zoom;
      const pct = char.hp / char.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pos.x - barW / 2, pos.y - 2, barW, barH);
      ctx.fillStyle = '#10b981';
      ctx.fillRect(pos.x - barW / 2, pos.y - 2, barW * pct, barH);
    }

    // Nombre
    ctx.fillStyle = '#f1f5f9';
    ctx.font = `bold ${Math.round(10 * this.camera.zoom)}px var(--font-body)`;
    ctx.textAlign = 'center';
    ctx.fillText(char.name, pos.x, pos.y - 6);

    // Burbuja de Chat
    if (char.chatBubble) {
      this.drawChatBubble(ctx, pos.x, pos.y - 15, char.chatBubble);
    }

    ctx.restore();
  }

  // --- DIBUJAR CAPA OVERLAYS 2D PARA MONSTRUOS ---
  drawMonsterOverlays(ctx, mob) {
    if (mob.state === 'dead') return;

    const pos = this.camera.tileToScreen(mob.x, mob.y, 0.9);
    
    ctx.save();

    // HP Bar
    if (mob.hp < mob.maxHp) {
      const barW = 28 * this.camera.zoom;
      const barH = 2.5 * this.camera.zoom;
      const pct = mob.hp / mob.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(pos.x - barW / 2, pos.y - 2, barW, barH);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(pos.x - barW / 2, pos.y - 2, barW * pct, barH);
    }

    // Nombre
    ctx.fillStyle = '#f87171';
    ctx.font = `${Math.round(8.5 * this.camera.zoom)}px var(--font-body)`;
    ctx.textAlign = 'center';
    ctx.fillText(mob.name, pos.x, pos.y - 6);

    // Burbuja de chat
    if (mob.chatBubble) {
      this.drawChatBubble(ctx, pos.x, pos.y - 15, mob.chatBubble);
    }

    ctx.restore();
  }

  drawChatBubble(ctx, x, y, text) {
    ctx.save();
    ctx.font = '9px var(--font-body)';
    const textWidth = ctx.measureText(text).width;
    const paddingX = 8;
    const w = textWidth + paddingX * 2;
    const h = 18;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 3, y);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x, y + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - h / 2);

    ctx.restore();
  }

  // --- DIBUJAR EFECTOS / PARTÍCULAS EN 2D PROYECTADOS ---
  drawParticles() {
    this.particleEffects.forEach(eff => {
      const pos = this.camera.tileToScreen(eff.x, eff.y, 0.1);
      const w = 64 * this.camera.zoom;
      
      this.ctx.save();

      if (eff.type === 'click_wave') {
        const progress = 1.0 - eff.life / 0.4;
        this.ctx.strokeStyle = eff.color;
        this.ctx.lineWidth = 2 * (1.0 - progress);
        this.ctx.beginPath();
        this.ctx.ellipse(pos.x, pos.y, (w / 3) * progress, (w / 6) * progress, 0, 0, Math.PI * 2);
        this.ctx.stroke();

      } else if (eff.type === 'level_up') {
        const progress = 1.0 - eff.life / 1.5;
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
        const radius = (25 * (1.0 - eff.life)) * this.camera.zoom;
        this.ctx.fillStyle = eff.color;
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y - 10 * this.camera.zoom, radius, 0, Math.PI * 2);
        this.ctx.fill();

      } else if (eff.type === 'fire_bolt') {
        const progress = 1.0 - eff.life;
        const fy = pos.y - 150 * this.camera.zoom * (1 - progress);
        this.ctx.fillStyle = '#ff4500';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, fy, 8 * this.camera.zoom, 0, Math.PI * 2);
        this.ctx.fill();
        
        if (progress > 0.8) {
          this.ctx.fillStyle = 'rgba(255, 69, 0, 0.4)';
          this.ctx.beginPath();
          this.ctx.ellipse(pos.x, pos.y, w / 2, w / 4, 0, 0, Math.PI * 2);
          this.ctx.fill();
        }
      } else if (eff.type === 'heal' || eff.type === 'heal_potion') {
        const progress = 1.0 - eff.life;
        this.ctx.fillStyle = 'rgba(92, 214, 92, 0.4)';
        this.ctx.beginPath();
        this.ctx.ellipse(pos.x, pos.y, w / 2 * progress, w / 4 * progress, 0, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.fillStyle = eff.color;
        this.ctx.font = `bold ${Math.round(20 * this.camera.zoom)}px var(--font-body)`;
        this.ctx.textAlign = 'center';
        this.ctx.fillText("+", pos.x, pos.y - 20 * this.camera.zoom - 30 * this.camera.zoom * progress);
      } else if (eff.type === 'hit_spark') {
        const progress = 1.0 - eff.life / 0.25;
        this.ctx.strokeStyle = eff.color;
        this.ctx.lineWidth = 3 * (1.0 - progress) * this.camera.zoom;
        const length = 15 * progress * this.camera.zoom;
        
        this.ctx.beginPath();
        this.ctx.moveTo(pos.x - length, pos.y - 12 * this.camera.zoom - length);
        this.ctx.lineTo(pos.x + length, pos.y - 12 * this.camera.zoom + length);
        this.ctx.moveTo(pos.x - length, pos.y - 12 * this.camera.zoom + length);
        this.ctx.lineTo(pos.x + length, pos.y - 12 * this.camera.zoom - length);
        this.ctx.stroke();

        this.ctx.fillStyle = '#fff';
        this.ctx.beginPath();
        this.ctx.arc(pos.x, pos.y - 12 * this.camera.zoom, 4 * (1.0 - progress) * this.camera.zoom, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    });
  }

  // --- RENDERIZAR COMBAT DAMAGE TEXT FLOATING ---
  drawDamagePops() {
    this.damagePops.forEach(pop => {
      const pos = this.camera.tileToScreen(pop.x, pop.y, 1.3);
      this.ctx.save();

      this.ctx.textAlign = 'center';
      
      let fill = '#fff';
      let font = `${Math.round(15 * this.camera.zoom)}px var(--font-title)`;
      let text = pop.text;

      if (pop.isCrit) {
        fill = '#facc15';
        font = `bold ${Math.round(20 * this.camera.zoom)}px var(--font-title)`;
        text = `★ ${text} ★`;
      } else if (pop.isMiss) {
        fill = '#94a3b8';
        font = `bold ${Math.round(13 * this.camera.zoom)}px var(--font-body)`;
      } else if (pop.heal) {
        fill = '#22c55e';
        font = `bold ${Math.round(16 * this.camera.zoom)}px var(--font-title)`;
        text = `+${text}`;
      }

      // Sombra
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      this.ctx.font = font;
      this.ctx.fillText(text, pos.x + 1, pos.y + pop.y + 1);

      // Frente
      this.ctx.fillStyle = fill;
      this.ctx.globalAlpha = Math.min(1.0, pop.life * 2.0);
      this.ctx.fillText(text, pos.x, pos.y + pop.y);

      this.ctx.restore();
    });
  }

  // --- DIBUJAR AURA DE TARGET EN EL SUELO ---
  drawTargetIndicator() {
    if (!this.selectedTargetId) return;

    const target = this.entities[this.selectedTargetId];
    if (!target || target.hp <= 0) {
      this.selectedTargetId = null;
      return;
    }

    const pos = this.camera.tileToScreen(target.x, target.y, 0.02);
    const w = 64 * this.camera.zoom;
    const h = 32 * this.camera.zoom;

    this.ctx.save();
    
    const alpha = 0.35 + Math.sin(Date.now() / 150) * 0.15;
    this.ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
    this.ctx.lineWidth = 2 * this.camera.zoom;

    this.ctx.beginPath();
    this.ctx.ellipse(pos.x, pos.y + 1, w / 2.3, h / 2.3, 0, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.restore();
  }

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
        if (window.localGRF.parsePromise) {
          console.log('⏳ [LocalGRF] Esperando a que el indexador en segundo plano termine...');
          await window.localGRF.parsePromise;
        }
      } catch (err) {
        console.error('❌ [LocalGRF] Fallo al inicializar LocalGRF:', err);
      }
    }
    window.gameInstance = new Game();
  }
};
