/**
 * WebRO - Three.js WebGL Orbit Perspective Camera
 * Manages 3D camera coordinates, smooth orbital rotations, screen projections,
 * and mouse-to-grid raycasting calculations.
 */
class Camera {
  constructor() {
    this.x = 15; // Grid cell target X
    this.y = 15; // Grid cell target Y
    this.currentX = 15; // Interpolated X
    this.currentY = 15; // Interpolated Y
    
    this.zoom = 1.0;
    this.targetZoom = 1.0;
    this.rotation = Math.PI / 4; // Angle of orbital rotation (default 45 deg)
    this.targetRotation = Math.PI / 4;
    
    // Pitch / Inclinación angular de cámara (~37 grados para recrear la perspectiva clásica de RO)
    this.pitch = 0.65; 

    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;

    // Inicializar cámara Three.js PerspectiveCamera
    this.camera3D = new THREE.PerspectiveCamera(
      35, // Field of View (FOV)
      this.screenWidth / this.screenHeight, // Aspect Ratio
      1.0, // Near plane
      1000.0 // Far plane
    );
  }

  update(targetX, targetY, deltaTime) {
    this.x = targetX;
    this.y = targetY;

    // Interpolación suave del foco de la cámara en el jugador
    const lerpFactor = 0.08;
    this.currentX += (this.x - this.currentX) * lerpFactor;
    this.currentY += (this.y - this.currentY) * lerpFactor;

    // Interpolación suave de zoom y rotación angular
    this.zoom += (this.targetZoom - this.zoom) * 0.1;
    
    let diff = this.targetRotation - this.rotation;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.rotation += diff * 0.1;

    // --- CÁLCULO DE ÓRBITA EN 3D ---
    // Distancia base de la cámara escalada según nivel de Zoom
    const baseDistance = 35;
    const distance = baseDistance / this.zoom;

    // Posición focal (Personaje) en plano 3D (X, 0, Z)
    const focalPoint = new THREE.Vector3(this.currentX, 0, this.currentY);

    // Coordenadas esféricas de órbita alrededor del foco
    const camX = focalPoint.x + distance * Math.cos(this.rotation) * Math.cos(this.pitch);
    const camY = focalPoint.y + distance * Math.sin(this.pitch);
    const camZ = focalPoint.z + distance * Math.sin(this.rotation) * Math.cos(this.pitch);

    this.camera3D.position.set(camX, camY, camZ);
    this.camera3D.lookAt(focalPoint);
  }

  resize(width, height) {
    this.screenWidth = width;
    this.screenHeight = height;
    this.camera3D.aspect = width / height;
    this.camera3D.updateProjectionMatrix();
  }

  // Proyectar coordenadas 3D (X, Y_altura, Z_grilla) a coordenadas 2D de pantalla (Pixeles)
  // Mantiene 100% de compatibilidad con chat bubbles, nombres y damage pops flotantes de 2D Canvas!
  tileToScreen(gridX, gridY, height = 0) {
    // Crear vector 3D (X de celda, Altura, Y de celda mapeada a Z)
    const p = new THREE.Vector3(gridX, height, gridY);
    
    // Proyectar el vector 3D al Viewport de la cámara (normalizado -1 a 1)
    p.project(this.camera3D);
    
    // Convertir de coordenadas normalizadas a coordenadas físicas de pixeles
    return {
      x: (p.x * 0.5 + 0.5) * this.screenWidth,
      y: (-p.y * 0.5 + 0.5) * this.screenHeight
    };
  }

  // Proyectar clic de ratón 2D a celda de la grilla 3D horizontal (Plano Y=0) mediante Raycasting
  screenToTile(screenX, screenY) {
    // Normalizar coordenadas a rango [-1, 1]
    const mouse = new THREE.Vector2();
    mouse.x = (screenX / this.screenWidth) * 2 - 1;
    mouse.y = -(screenY / this.screenHeight) * 2 + 1;

    // Lanzar rayo desde la cámara
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera3D);

    // Definir plano horizontal del suelo (Y=0, normal hacia arriba)
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectionPoint = new THREE.Vector3();
    
    // Calcular punto de intersección matemática del rayo con el plano del suelo
    raycaster.ray.intersectPlane(floorPlane, intersectionPoint);

    // Mapear plano X-Z de vuelta a celdas X-Y de la grilla
    return {
      x: Math.round(intersectionPoint.x),
      y: Math.round(intersectionPoint.z)
    };
  }

  // Límites clásicos del zoom
  addZoom(amount) {
    this.targetZoom = Math.min(1.8, Math.max(0.5, this.targetZoom + amount));
  }

  // Rotación suave libre
  addRotation(amount) {
    this.targetRotation += amount;
  }
}

window.Camera = Camera;
