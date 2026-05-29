/**
 * WebRO - Isometric 2.5D Camera
 * Manages view coordinates, zoom, rotation, interpolation and coordinate translation.
 */
class Camera {
  constructor() {
    this.x = 15; // Grid cell target X
    this.y = 15; // Grid cell target Y
    this.currentX = 15; // Interpolated X
    this.currentY = 15; // Interpolated Y
    
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.rotation = Math.PI / 4; // Angle of isometric rotation (default 45 deg)
    this.targetRotation = Math.PI / 4;
    this.pitch = 0.55; // Angle of inclination (2.5D pitch)
    
    this.tileWidth = 64; // Base width of isometric tile
    this.tileHeight = 32; // Base height of isometric tile (half of width for standard iso ratio)
    
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  }

  update(targetX, targetY, deltaTime) {
    this.x = targetX;
    this.y = targetY;

    // Interpolación suave del seguidor de cámara
    const lerpFactor = 0.08;
    this.currentX += (this.x - this.currentX) * lerpFactor;
    this.currentY += (this.y - this.currentY) * lerpFactor;

    // Interpolación suave de zoom y rotación
    this.zoom += (this.targetZoom - this.zoom) * 0.1;
    
    // Suavizar rotación evitando saltos de ángulo
    let diff = this.targetRotation - this.rotation;
    // Normalizar a [-PI, PI]
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.rotation += diff * 0.1;
  }

  resize(width, height) {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  // Convertir Coordenada de Grilla (X, Y) a Coordenadas de Pantalla (2.5D)
  tileToScreen(gridX, gridY) {
    // 1. Centrar respecto al foco de la cámara
    const dx = gridX - this.currentX;
    const dy = gridY - this.currentY;

    // 2. Aplicar rotación
    const rx = dx * Math.cos(this.rotation) - dy * Math.sin(this.rotation);
    const ry = dx * Math.sin(this.rotation) + dy * Math.cos(this.rotation);

    // 3. Proyección isométrica (achatar el eje Y aplicando el pitch de la cámara)
    const screenX = rx * this.tileWidth * this.zoom;
    const screenY = ry * this.tileHeight * this.zoom * this.pitch * 2;

    // 4. Trasladar al centro de la pantalla
    return {
      x: screenX + this.screenWidth / 2,
      y: screenY + this.screenHeight / 2
    };
  }

  // Convertir Coordenada de Pantalla (Mouse Click) a Coordenada de Grilla (X, Y)
  screenToTile(screenX, screenY) {
    // 1. Deshacer la traslación del centro
    const cx = screenX - this.screenWidth / 2;
    const cy = screenY - this.screenHeight / 2;

    // 2. Deshacer la proyección de pitch e isométrica
    const rx = cx / (this.tileWidth * this.zoom);
    const ry = cy / (this.tileHeight * this.zoom * this.pitch * 2);

    // 3. Deshacer la rotación de la cámara (rotación inversa = -rotation)
    const cosR = Math.cos(-this.rotation);
    const sinR = Math.sin(-this.rotation);

    const dx = rx * cosR - ry * sinR;
    const dy = rx * sinR + ry * cosR;

    // 4. Sumar la posición actual de la cámara
    return {
      x: Math.round(dx + this.currentX),
      y: Math.round(dy + this.currentY)
    };
  }

  // Ajustar zoom dentro de límites
  addZoom(amount) {
    this.targetZoom = Math.min(1.8, Math.max(0.5, this.targetZoom + amount));
  }

  // Ajustar rotación por mouse drag
  addRotation(amount) {
    this.targetRotation += amount;
  }
}

// Exportar globalmente
window.Camera = Camera;
