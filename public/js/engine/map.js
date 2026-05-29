/**
 * WebRO - Isometric Map & Object Renderer
 * Draws the ground, obstacles, water animations, portals and depth-sorted objects.
 */
class GameMap {
  constructor() {
    this.name = 'prontera';
    this.displayName = 'Prontera';
    this.width = 30;
    this.height = 30;
    this.grid = [];
    this.warps = [];
    
    this.waterFrame = 0;
    this.waterTime = 0;
  }

  setMapData(data) {
    this.name = data.name;
    this.displayName = data.displayName || data.name;
    this.width = data.width;
    this.height = data.height;
    this.grid = data.grid;
    this.warps = data.warps || [];
  }

  update(deltaTime) {
    // Actualizar animación del agua
    this.waterTime += deltaTime;
    if (this.waterTime > 200) {
      this.waterFrame = (this.waterFrame + 1) % 4;
      this.waterTime = 0;
    }
  }

  // Dibujar el suelo (se dibuja primero para todo el mapa visible)
  drawGround(ctx, camera) {
    if (this.grid.length === 0) return;

    // Obtener celdas visibles para optimizar (culling básico)
    // Para simplificar, recorremos la grilla entera de este mapa pequeño
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tileType = this.grid[y][x];
        const screenPos = camera.tileToScreen(x, y);

        // Optimización rápida (culling): Dibujar solo si está dentro de la pantalla
        if (screenPos.x < -100 || screenPos.x > camera.screenWidth + 100 ||
            screenPos.y < -100 || screenPos.y > camera.screenHeight + 100) {
          continue;
        }

        this.drawFloorTile(ctx, screenPos, tileType, camera);
      }
    }

    // Dibujar portales (Warps)
    this.warps.forEach(warp => {
      // Dibujar en cada celda del portal
      for (let wx = warp.x; wx < warp.x + warp.width; wx++) {
        for (let wy = warp.y; wy < warp.y + warp.height; wy++) {
          const screenPos = camera.tileToScreen(wx, wy);
          this.drawPortalGlow(ctx, screenPos, camera);
        }
      }
    });
  }

  // Dibujar una baldosa de piso procedimentalmente con detalles premium
  drawFloorTile(ctx, pos, type, camera) {
    const w = camera.tileWidth * camera.zoom;
    const h = camera.tileHeight * camera.zoom * camera.pitch * 2;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - h / 2);
    ctx.lineTo(pos.x + w / 2, pos.y);
    ctx.lineTo(pos.x, pos.y + h / 2);
    ctx.lineTo(pos.x - w / 2, pos.y);
    ctx.closePath();

    // Colores según tipo de terreno
    let fill = '#16a34a'; // Verde Césped por defecto
    let stroke = 'rgba(22, 163, 74, 0.2)';

    switch (type) {
      case '.': // Césped común
        fill = '#1b4332'; // Verde boscoso oscuro
        stroke = 'rgba(45, 106, 79, 0.15)';
        break;
      case '+': // Camino de Tierra / Piedra
        fill = '#475569'; // Pizarra/Gris camino
        stroke = 'rgba(100, 116, 139, 0.2)';
        break;
      case '*': // Agua animada
        const waterCycle = Math.sin((Date.now() / 600) + pos.x * 0.2 + pos.y * 0.2) * 8;
        fill = `hsl(${200 + waterCycle}, 75%, 35%)`;
        stroke = 'rgba(14, 116, 144, 0.2)';
        break;
      case '#': // Base de Muros
        fill = '#0f172a';
        stroke = '#1e293b';
        break;
      case 'T': // Base de Árboles
        fill = '#0f241a';
        stroke = 'rgba(25, 50, 30, 0.2)';
        break;
      case 'F': // Fuente
        fill = '#334155';
        stroke = '#475569';
        break;
    }

    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Detalles adicionales (textura suave de césped o brillo de agua)
    if (type === '.' && camera.zoom > 0.8) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.fillRect(pos.x - 2, pos.y - 2, 4, 4);
    } else if (type === '*') {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, w / 4, h / 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // Dibujar efecto de portal flotante clásico de RO (Warp Portal)
  drawPortalGlow(ctx, pos, camera) {
    const w = camera.tileWidth * camera.zoom;
    const h = camera.tileHeight * camera.zoom * camera.pitch * 2;

    ctx.save();
    // Aura azul cian transparente con pulsaciones
    const pulse = Math.sin(Date.now() / 250) * 0.15 + 0.85;
    const grad = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, w / 2 * pulse);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.55)');
    grad.addColorStop(0.5, 'rgba(6, 182, 212, 0.25)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Círculos concéntricos ascendentes (efecto 3D simple del portal)
    ctx.strokeStyle = `rgba(34, 211, 238, ${0.4 * pulse})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 4, w / 2.3, h / 2.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y - 12, w / 2.8, h / 2.8, 0, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
  }

  // Recolectar obstáculos verticales del mapa que necesitan ordenamiento por profundidad
  getObstacles(camera) {
    const obstacles = [];
    if (this.grid.length === 0) return obstacles;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const type = this.grid[y][x];
        if (type === 'T' || type === '#' || type === 'F') {
          obstacles.push({
            type: 'obstacle',
            subType: type,
            x: x,
            y: y,
            depth: x + y + 0.5 // Profundidad ligeramente adelantada
          });
        }
      }
    }
    return obstacles;
  }

  // Dibujar obstáculos verticales en 3D
  drawObstacle(ctx, obs, camera) {
    const pos = camera.tileToScreen(obs.x, obs.y);
    const w = camera.tileWidth * camera.zoom;
    const h = camera.tileHeight * camera.zoom * camera.pitch * 2;

    ctx.save();

    // Sombra del obstáculo en el suelo
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(pos.x, pos.y, w / 2.5, h / 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    if (obs.subType === 'T') {
      // --- Árbol de Pino 2.5D en Pixel Art procedimental ---
      const treeHeight = 120 * camera.zoom;
      
      // Tronco
      ctx.fillStyle = '#78350f'; // Café oscuro
      ctx.fillRect(pos.x - 3 * camera.zoom, pos.y - treeHeight * 0.15, 6 * camera.zoom, treeHeight * 0.15);

      // Follaje (Conos Verdes)
      const layers = [
        { bottom: 0.15, top: 0.55, w: 0.35, color: '#14532d' },
        { bottom: 0.40, top: 0.80, w: 0.28, color: '#15803d' },
        { bottom: 0.65, top: 1.00, w: 0.18, color: '#22c55e' }
      ];

      layers.forEach(layer => {
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.moveTo(pos.x - w * layer.w, pos.y - treeHeight * layer.bottom);
        ctx.lineTo(pos.x + w * layer.w, pos.y - treeHeight * layer.bottom);
        ctx.lineTo(pos.x, pos.y - treeHeight * layer.top);
        ctx.closePath();
        ctx.fill();
        
        // Bordes para darle volumen
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.stroke();
      });

    } else if (obs.subType === '#') {
      // --- Muro de Piedra / Pilar de Prontera ---
      const wallHeight = 50 * camera.zoom;
      
      // Cara Izquierda (Sombra)
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(pos.x - w / 2, pos.y);
      ctx.lineTo(pos.x, pos.y + h / 2);
      ctx.lineTo(pos.x, pos.y + h / 2 - wallHeight);
      ctx.lineTo(pos.x - w / 2, pos.y - wallHeight);
      ctx.closePath();
      ctx.fill();

      // Cara Derecha (Brillo)
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y + h / 2);
      ctx.lineTo(pos.x + w / 2, pos.y);
      ctx.lineTo(pos.x + w / 2, pos.y - wallHeight);
      ctx.lineTo(pos.x, pos.y + h / 2 - wallHeight);
      ctx.closePath();
      ctx.fill();

      // Tapa Superior
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y - wallHeight - h / 2);
      ctx.lineTo(pos.x + w / 2, pos.y - wallHeight);
      ctx.lineTo(pos.x, pos.y - wallHeight + h / 2);
      ctx.lineTo(pos.x - w / 2, pos.y - wallHeight);
      ctx.closePath();
      ctx.fill();

      // Detalles del pilar
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.stroke();

    } else if (obs.subType === 'F') {
      // --- Fuente Central de Prontera ---
      const fountainHeight = 35 * camera.zoom;

      // Base cilíndrica de piedra
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#334155';
      ctx.fillRect(pos.x - w / 2, pos.y - fountainHeight, w, fountainHeight);
      
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - fountainHeight, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Agua en la fuente con ondas concéntricas
      ctx.fillStyle = 'rgba(6, 182, 212, 0.6)';
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y - fountainHeight, w / 2.3, h / 2.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Efecto de partículas de agua saltando
      const particles = 8;
      const angleStep = (Math.PI * 2) / particles;
      const time = Date.now() / 400;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      for (let i = 0; i < particles; i++) {
        const angle = i * angleStep + time;
        const px = pos.x + Math.cos(angle) * (w / 3.5);
        const py = pos.y - fountainHeight + Math.sin(angle) * (h / 3.5) - Math.abs(Math.sin(time * 2 + i)) * 12 * camera.zoom;

        ctx.beginPath();
        ctx.arc(px, py, 2 * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

// Exportar globalmente
window.GameMap = GameMap;
