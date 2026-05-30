/**
 * WebRO - Client-side original RO Scene World (.rsw) binary parser
 * Parses water settings, light configurations, and 3D model placements
 * directly from data.grf byte buffers.
 */
class RswParser {
  static async loadAndParse(path) {
    // 1. Intentar cargar desde el CDN en la nube si está configurado
    if (window.WebROConfig && window.WebROConfig.cdnUrl) {
      try {
        const url = `${window.WebROConfig.cdnUrl}${path}`;
        const response = await fetch(url);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          return this.parse(arrayBuffer);
        }
      } catch (err) {
        console.warn(`[RswParser] Falló la carga desde el CDN en la nube para ${path}, intentando local:`, err);
      }
    }

    // 2. Intentar cargar desde el LocalGRF del navegador (IndexedDB)
    if (window.localGRF && window.localGRF.isLoaded) {
      try {
        const bytes = await window.localGRF.readBytes(path);
        const cleanBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return this.parse(cleanBuffer);
      } catch (err) {
        console.warn(`[RswParser] No se pudo leer localmente ${path}, intentando desde la API:`, err);
      }
    }

    // 3. Intentar cargar desde la API del servidor
    const url = `/api/grf/file?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falla al cargar world rsw ${path}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return this.parse(arrayBuffer);
  }

  static parse(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < 40) {
      throw new Error('Archivo .rsw demasiado corto.');
    }

    // 1. Validar Cabecera ("GRSW")
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (signature !== 'GRSW') {
      throw new Error('Firma de escena de RO (.rsw) inválida.');
    }

    const majorVersion = bytes[4];
    const minorVersion = bytes[5];
    console.log(`[RswParser] Cargada escena versión ${majorVersion}.${minorVersion}`);

    let offset = 6;

    // 2. Ajustes de Agua (Water settings)
    const waterHeight = view.getFloat32(offset, true); offset += 4;
    const waterType = view.getInt32(offset, true); offset += 4;
    const waterWaveHeight = view.getFloat32(offset, true); offset += 4;
    const waterSpeed = view.getFloat32(offset, true); offset += 4;
    const waterPitch = view.getFloat32(offset, true); offset += 4;

    // 3. Luces (Lighting settings)
    const lightLongitude = view.getInt32(offset, true); offset += 4;
    const lightLatitude = view.getInt32(offset, true); offset += 4;
    
    const lightDiffuse = {
      r: view.getFloat32(offset, true),
      g: view.getFloat32(offset + 4, true),
      b: view.getFloat32(offset + 8, true)
    };
    offset += 12;

    const lightAmbient = {
      r: view.getFloat32(offset, true),
      g: view.getFloat32(offset + 4, true),
      b: view.getFloat32(offset + 8, true)
    };
    offset += 12;

    // 4. Leer lista de objetos
    if (offset + 4 > arrayBuffer.byteLength) {
      return { waterHeight, waterType, objects: [] };
    }

    const objectsCount = view.getUint32(offset, true);
    offset += 4;

    const objects = [];
    const decoder = new TextDecoder('windows-1252');

    for (let i = 0; i < objectsCount; i++) {
      if (offset + 4 > arrayBuffer.byteLength) break;
      const type = view.getInt32(offset, true);
      offset += 4;

      if (type === 1) {
        // --- TIPO 1: MODELO 3D (RSM) ---
        // Nombre del modelo (40 bytes)
        const nameBytes = bytes.subarray(offset, offset + 40);
        let name = decoder.decode(nameBytes);
        const nullIdx = name.indexOf('\0');
        if (nullIdx !== -1) name = name.substring(0, nullIdx);
        offset += 40;

        // Animación (4 bytes)
        const animType = view.getInt32(offset, true); offset += 4;
        const animSpeed = view.getFloat32(offset, true); offset += 4;
        const blockType = view.getInt32(offset, true); offset += 4;

        // Archivo del modelo (.rsm) (80 bytes)
        const fileBytes = bytes.subarray(offset, offset + 80);
        let modelFile = decoder.decode(fileBytes);
        const fNullIdx = modelFile.indexOf('\0');
        if (fNullIdx !== -1) modelFile = modelFile.substring(0, fNullIdx);
        offset += 80;

        // Nodo / Nombre del nodo (80 bytes)
        offset += 80;

        // Posición (3 floats)
        const pos = {
          x: view.getFloat32(offset, true),
          y: view.getFloat32(offset + 4, true),
          z: view.getFloat32(offset + 8, true)
        };
        offset += 12;

        // Rotación (3 floats)
        const rot = {
          x: view.getFloat32(offset, true),
          y: view.getFloat32(offset + 4, true),
          z: view.getFloat32(offset + 8, true)
        };
        offset += 12;

        // Escala (3 floats)
        const scale = {
          x: view.getFloat32(offset, true),
          y: view.getFloat32(offset + 4, true),
          z: view.getFloat32(offset + 8, true)
        };
        offset += 12;

        objects.push({
          type: 'model',
          name,
          modelFile: modelFile.replace(/\\/g, '/').toLowerCase(),
          position: pos,
          rotation: rot,
          scale: scale
        });

      } else if (type === 2) {
        // --- TIPO 2: FUENTE DE LUZ ---
        // Nombre (80 bytes)
        offset += 80;
        // Posición (3 floats)
        const pos = {
          x: view.getFloat32(offset, true),
          y: view.getFloat32(offset + 4, true),
          z: view.getFloat32(offset + 8, true)
        };
        offset += 12;

        // Color (3 floats)
        const color = {
          r: view.getFloat32(offset, true),
          g: view.getFloat32(offset + 4, true),
          b: view.getFloat32(offset + 8, true)
        };
        offset += 12;

        // Rango (float)
        const range = view.getFloat32(offset, true);
        offset += 4;

        objects.push({
          type: 'light',
          position: pos,
          color,
          range
        });

      } else if (type === 3) {
        // --- TIPO 3: EFECTO DE SONIDO ---
        // Saltar detalles de sonido (128 bytes)
        offset += 128;
      } else if (type === 4) {
        // --- TIPO 4: EFECTO DE ESCENA ---
        // Saltar detalles de efecto (64 bytes)
        offset += 64;
      } else {
        // Desconocido, saltar un bloque genérico para evitar corrupción
        offset += 16;
      }
    }

    return {
      version: `${majorVersion}.${minorVersion}`,
      waterHeight,
      waterType,
      waterWaveHeight,
      waterSpeed,
      lightDiffuse,
      lightAmbient,
      objects
    };
  }
}

window.RswParser = RswParser;
