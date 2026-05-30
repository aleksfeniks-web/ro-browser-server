/**
 * WebRO - Three.js WebGL 3D Map Engine
 * Compiles grid cells into a structured 3D landscape, handles transparent animated water,
 * generates 3D obstacles (trees, pillars, city fountain), and manages warp portals.
 */
class GameMap {
  constructor() {
    this.name = 'prontera';
    this.displayName = 'Prontera';
    this.width = 30;
    this.height = 30;
    this.grid = [];
    this.warps = [];
    
    // Referencias a la escena de Three.js
    this.scene = null;
    this.mapGroup = null;
    this.waterMeshes = [];
    this.portalMeshes = [];
    this.fountainParticles = [];
    this.fountainParticlesGroup = null;

    // Texturas de suelo de la grilla (Imagen estándar para fallback)
    this.textures = {
      grass: new Image(),
      stone: new Image()
    };
    
    // Texturas de Three.js
    this.threeTextures = {
      grass: null,
      stone: null
    };

    this.setupTextureListeners();
    this.loadGroundTextures();
  }

  setupTextureListeners() {
    // Cuando la imagen termine de cargarse, crear la textura de Three.js
    this.textures.grass.onload = () => {
      this.threeTextures.grass = new THREE.Texture(this.textures.grass);
      this.threeTextures.grass.wrapS = THREE.RepeatWrapping;
      this.threeTextures.grass.wrapT = THREE.RepeatWrapping;
      this.threeTextures.grass.needsUpdate = true;
      this.rebuildTerrain();
    };

    this.textures.stone.onload = () => {
      this.threeTextures.stone = new THREE.Texture(this.textures.stone);
      this.threeTextures.stone.wrapS = THREE.RepeatWrapping;
      this.threeTextures.stone.wrapT = THREE.RepeatWrapping;
      this.threeTextures.stone.needsUpdate = true;
      this.rebuildTerrain();
    };
  }

  async loadGroundTextures() {
    const grassPath = 'data/texture/ÀÌ¹ÌÁöÆÇ/grass01.bmp';
    const stonePath = 'data/texture/ÀÌ¹ÌÁöÆÇ/stone01.bmp';

    // 1. Intentar cargar desde el CDN en la nube si está configurado
    if (window.WebROConfig && window.WebROConfig.cdnUrl) {
      try {
        this.textures.grass.src = `${window.WebROConfig.cdnUrl}${grassPath}`;
        this.textures.stone.src = `${window.WebROConfig.cdnUrl}${stonePath}`;
        console.log('✅ [Map3D] Cargando texturas desde el CDN en la nube.');
        return;
      } catch (err) {
        console.warn('[Map3D] Falló la carga desde el CDN:', err);
      }
    }

    // 2. Intentar cargar desde el LocalGRF (IndexedDB)
    if (window.localGRF && window.localGRF.isLoaded) {
      try {
        const grassBytes = await window.localGRF.readBytes(grassPath);
        const stoneBytes = await window.localGRF.readBytes(stonePath);

        this.textures.grass.src = URL.createObjectURL(new Blob([grassBytes], { type: 'image/bmp' }));
        this.textures.stone.src = URL.createObjectURL(new Blob([stoneBytes], { type: 'image/bmp' }));
        console.log('✅ [Map3D] Texturas cargadas con éxito desde data.grf local.');
        return;
      } catch (err) {
        console.warn('[Map3D] No se pudieron cargar texturas localmente:', err);
      }
    }

    // 3. Cargar desde la API del servidor (Localhost / Fallback)
    this.textures.grass.src = `/api/grf/file?path=${encodeURIComponent(grassPath)}`;
    this.textures.stone.src = `/api/grf/file?path=${encodeURIComponent(stonePath)}`;
  }

  // Inicializar escena 3D y compilar elementos del mapa
  init3DScene(threeScene) {
    this.cleanup(); // Asegurar limpiar el mapa anterior

    this.scene = threeScene;
    this.mapGroup = new THREE.Group();
    this.scene.add(this.mapGroup);

    this.buildTerrain();
    this.buildObstacles();
    this.buildPortals();
  }

  // Compilar grilla de terreno
  buildTerrain() {
    if (!this.mapGroup || this.grid.length === 0) return;

    // Crear geometrías reutilizables para optimizar rendimiento
    const tileGeo = new THREE.BoxGeometry(1.0, 0.2, 1.0); // Baldosas 3D de terreno
    
    // Crear materiales estándar premium
    const grassMat = new THREE.MeshStandardMaterial({
      map: this.threeTextures.grass,
      color: this.threeTextures.grass ? 0xffffff : 0x1e3f20, // Color si no hay textura
      roughness: 0.8,
      bumpScale: 0.05
    });

    const stoneMat = new THREE.MeshStandardMaterial({
      map: this.threeTextures.stone,
      color: this.threeTextures.stone ? 0xffffff : 0x556370,
      roughness: 0.6
    });

    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Gris pizarra oscuro para base de muros
      roughness: 0.9
    });

    // Mapear celdas en bucle
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const type = this.grid[y][x];
        
        if (type === '*') {
          // --- BALDOSA DE AGUA ANIMADA ---
          const waterGeo = new THREE.BoxGeometry(1.0, 0.1, 1.0);
          const waterMat = new THREE.MeshStandardMaterial({
            color: 0x0891b2, // Azul cian premium
            transparent: true,
            opacity: 0.75,
            roughness: 0.1,
            metalness: 0.1
          });
          const waterMesh = new THREE.Mesh(waterGeo, waterMat);
          waterMesh.position.set(x, -0.05, y); // Ligeramente por debajo del suelo
          this.mapGroup.add(waterMesh);
          this.waterMeshes.push(waterMesh);
          continue;
        }

        let mat = grassMat;
        if (type === '+') mat = stoneMat;
        else if (type === '#') mat = wallMat;

        const mesh = new THREE.Mesh(tileGeo, mat);
        mesh.position.set(x, -0.1, y); // Baldosa en altura central y=0
        mesh.receiveShadow = true;
        this.mapGroup.add(mesh);
      }
    }
  }

  // Re-compilar terreno cuando se cargan las texturas originales
  rebuildTerrain() {
    if (!this.mapGroup) return;
    
    // Limpiar baldosas antiguas (manteniendo agua y obstáculos)
    const toRemove = [];
    this.mapGroup.children.forEach(child => {
      if (child.geometry && child.geometry.type === 'BoxGeometry' && child.position.y === -0.1) {
        toRemove.push(child);
      }
    });

    toRemove.forEach(mesh => {
      this.mapGroup.remove(mesh);
      mesh.geometry.dispose();
    });

    this.buildTerrain();
  }

  // Construir elementos 3D del mapa (Árboles, Columnas, Fuentes)
  buildObstacles() {
    if (!this.mapGroup || this.grid.length === 0) return;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const type = this.grid[y][x];

        if (type === 'T') {
          // --- ÁRBOL DE PINO EN 3D ---
          const treeGroup = new THREE.Group();
          treeGroup.position.set(x, 0, y);

          // Tronco (Cilindro marrón)
          const trunkGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.6, 6);
          const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c2e0b, roughness: 0.9 });
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.y = 0.3;
          treeGroup.add(trunk);

          // Follaje (Stack de conos verdes de abajo a arriba)
          const leafMat1 = new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.8 });
          const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.8 });
          const leafMat3 = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 });

          const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.5, 6), leafMat1);
          c1.position.y = 0.7;
          treeGroup.add(c1);

          const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 6), leafMat2);
          c2.position.y = 1.0;
          treeGroup.add(c2);

          const c3 = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 6), leafMat3);
          c3.position.y = 1.25;
          treeGroup.add(c3);

          this.mapGroup.add(treeGroup);

        } else if (type === '#') {
          // --- PILAR / MURO DE PIEDRA 3D ---
          const pilarGeo = new THREE.BoxGeometry(0.9, 2.0, 0.9);
          const pilarMat = new THREE.MeshStandardMaterial({
            map: this.threeTextures.stone,
            color: this.threeTextures.stone ? 0xffffff : 0x334155,
            roughness: 0.7
          });
          const pilar = new THREE.Mesh(pilarGeo, pilarMat);
          pilar.position.set(x, 1.0, y); // Apoyado sobre el suelo y=0
          pilar.castShadow = true;
          pilar.receiveShadow = true;
          this.mapGroup.add(pilar);

        } else if (type === 'F') {
          // --- FUENTE CENTRAL DE PRONTERA 3D ---
          const fountainGroup = new THREE.Group();
          fountainGroup.position.set(x, 0, y);

          // Base circular de la fuente
          const baseGeo = new THREE.CylinderGeometry(1.6, 1.7, 0.5, 12);
          const stoneMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });
          const base = new THREE.Mesh(baseGeo, stoneMat);
          base.position.y = 0.25;
          fountainGroup.add(base);

          // Plato de agua interior (Ligeramente elevado)
          const waterBaseGeo = new THREE.CylinderGeometry(1.4, 1.4, 0.1, 12);
          const waterMat = new THREE.MeshStandardMaterial({
            color: 0x06b6d4,
            transparent: true,
            opacity: 0.8,
            roughness: 0.1
          });
          const water = new THREE.Mesh(waterBaseGeo, waterMat);
          water.position.y = 0.46;
          fountainGroup.add(water);

          // Columna central de la fuente
          const centerGeo = new THREE.CylinderGeometry(0.2, 0.3, 0.8, 8);
          const center = new THREE.Mesh(centerGeo, stoneMat);
          center.position.y = 0.9;
          fountainGroup.add(center);

          // Segundo plato pequeño arriba
          const topBowlGeo = new THREE.CylinderGeometry(0.6, 0.4, 0.15, 8);
          const topBowl = new THREE.Mesh(topBowlGeo, stoneMat);
          topBowl.position.y = 1.3;
          fountainGroup.add(topBowl);

          this.mapGroup.add(fountainGroup);

          // --- SISTEMA DE PARTÍCULAS / CHORROS DE AGUA ---
          this.fountainParticlesGroup = new THREE.Group();
          this.fountainParticlesGroup.position.set(x, 0.5, y);
          this.mapGroup.add(this.fountainParticlesGroup);

          const particlesCount = 20;
          const pGeo = new THREE.SphereGeometry(0.02, 3, 3);
          const pMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });

          for (let i = 0; i < particlesCount; i++) {
            const pMesh = new THREE.Mesh(pGeo, pMat);
            
            // Ángulo y velocidad aleatoria para el chorro de agua
            const angle = (Math.PI * 2) * (i / particlesCount);
            pMesh.userData = {
              angle: angle,
              radius: 0.2 + Math.random() * 1.0,
              baseY: 0.8 + Math.random() * 0.2,
              speed: 1.0 + Math.random() * 1.5,
              time: Math.random() * Math.PI
            };

            this.fountainParticlesGroup.add(pMesh);
            this.fountainParticles.push(pMesh);
          }
        }
      }
    }
  }

  // Crear portales brillantes (Warps) del mapa
  buildPortals() {
    if (!this.mapGroup || this.warps.length === 0) return;

    this.warps.forEach(warp => {
      // Dibujar en el centro del portal
      const centerX = warp.x + warp.width / 2 - 0.5;
      const centerY = warp.y + warp.height / 2 - 0.5;

      const portalGroup = new THREE.Group();
      portalGroup.position.set(centerX, 0, centerY);

      // Cilindro translúcido brillante de RO
      const geo = new THREE.CylinderGeometry(warp.width / 2, warp.width / 2, 2.0, 16, 1, true);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4, // Cyan
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const cyl = new THREE.Mesh(geo, mat);
      cyl.position.y = 1.0;
      portalGroup.add(cyl);

      // Anillo base brillante
      const ringGeo = new THREE.RingGeometry(warp.width / 2.3, warp.width / 2, 16);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2; // Acostar en el suelo
      ring.position.y = 0.02;
      portalGroup.add(ring);

      this.mapGroup.add(portalGroup);
      this.portalMeshes.push({
        group: portalGroup,
        cylinder: cyl,
        ring: ring,
        pulseSpeed: 1.5 + Math.random() * 0.5
      });
    });
  }

  setMapData(data) {
    this.name = data.name;
    this.displayName = data.displayName || data.name;
    this.width = data.width;
    this.height = data.height;
    this.grid = data.grid;
    this.warps = data.warps || [];

    // Re-iniciar gráficos 3D si la escena ya está cargada
    if (this.scene) {
      this.init3DScene(this.scene);
    }
  }

  update(deltaTime) {
    const timeSec = Date.now() * 0.001;

    // 1. Animación suave del Agua (Efecto ondulatorio sinusoidal vertical en 3D)
    this.waterMeshes.forEach((mesh, idx) => {
      const x = mesh.position.x;
      const z = mesh.position.z;
      const wave = Math.sin(timeSec * 2.5 + x * 0.3 + z * 0.3) * 0.02;
      mesh.position.y = -0.05 + wave;
    });

    // 2. Animación de Partículas de la Fuente Central (Splashing)
    this.fountainParticles.forEach(p => {
      const ud = p.userData;
      ud.time += deltaTime * 0.003 * ud.speed;
      if (ud.time > Math.PI) ud.time = 0; // Reiniciar arco

      // Arco parabólico: saltar del centro hacia afuera
      const factor = Math.sin(ud.time);
      const currentRadius = ud.radius * (ud.time / Math.PI);
      
      const px = Math.cos(ud.angle) * currentRadius;
      const py = ud.baseY * factor;
      const pz = Math.sin(ud.angle) * currentRadius;

      p.position.set(px, py, pz);
    });

    // 3. Animación de Portales (Pulsación de escala y opacidad)
    this.portalMeshes.forEach(p => {
      const pulse = Math.sin(timeSec * p.pulseSpeed) * 0.15 + 0.85;
      
      // Escalar horizontalmente
      p.cylinder.scale.set(pulse, 1.0, pulse);
      p.cylinder.material.opacity = 0.15 + (Math.cos(timeSec * p.pulseSpeed) * 0.1);
      
      // Anillo en el piso pulsando
      p.ring.scale.set(pulse * 1.05, pulse * 1.05, 1.0);
      p.ring.material.opacity = 0.35 + (Math.sin(timeSec * p.pulseSpeed) * 0.15);
    });
  }

  // --- SIGNATURAS COMPATIBLES VACÍAS ---
  // Evitan errores de compilación con la lógica 2D antigua del cliente
  drawGround(ctx, camera) {}
  getObstacles(camera) { return []; }
  drawObstacle(ctx, obs, camera) {}

  // Liberar recursos 3D de la memoria para evitar leaks al teleportarse
  cleanup() {
    if (this.mapGroup && this.scene) {
      this.scene.remove(this.mapGroup);
      
      this.mapGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      
      this.mapGroup = null;
    }

    this.waterMeshes = [];
    this.portalMeshes = [];
    this.fountainParticles = [];
    this.fountainParticlesGroup = null;
  }
}

// Exportar globalmente
window.GameMap = GameMap;
