/**
 * WebRO - Client-side original RO Scene Model (.rsm) 3D mesh binary parser
 * Parses 3D meshes, texture lists, vertices, UV mapping, and faces
 * directly from data.grf byte arrays to feed Three.js geometries.
 */
class RsmParser {
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
        console.warn(`[RsmParser] Falló la carga desde el CDN en la nube para ${path}, intentando local:`, err);
      }
    }

    // 2. Intentar cargar desde el LocalGRF del navegador (IndexedDB)
    if (window.localGRF && window.localGRF.isLoaded) {
      try {
        const bytes = await window.localGRF.readBytes(path);
        const cleanBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return this.parse(cleanBuffer);
      } catch (err) {
        console.warn(`[RsmParser] No se pudo leer localmente ${path}, intentando desde la API:`, err);
      }
    }

    // 3. Intentar cargar desde la API del servidor
    const url = `/api/grf/file?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falla al cargar modelo rsm ${path}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return this.parse(arrayBuffer);
  }

  static parse(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    if (bytes.length < 20) {
      throw new Error('Archivo .rsm demasiado corto.');
    }

    // 1. Validar Cabecera ("GRSM")
    const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (signature !== 'GRSM') {
      throw new Error('Firma de modelo 3D de RO (.rsm) inválida.');
    }

    const majorVersion = bytes[4];
    const minorVersion = bytes[5];
    console.log(`[RsmParser] Cargado modelo 3D versión ${majorVersion}.${minorVersion}`);

    let offset = 6;

    // Animación (float)
    const animLength = view.getInt32(offset, true); offset += 4;
    const shadeType = view.getInt32(offset, true); offset += 4;
    
    // Si la versión es >= 1.4, saltar un float extra
    if (majorVersion > 1 || (majorVersion === 1 && minorVersion >= 4)) {
      offset += 4;
    }

    // 2. Leer Texturas (Cada nombre son 40 bytes)
    const textureCount = view.getUint32(offset, true);
    offset += 4;

    const textures = [];
    const decoder = new TextDecoder('windows-1252');

    for (let t = 0; t < textureCount; t++) {
      if (offset + 40 > arrayBuffer.byteLength) break;
      const nameBytes = bytes.subarray(offset, offset + 40);
      let texName = decoder.decode(nameBytes);
      const nullIdx = texName.indexOf('\0');
      if (nullIdx !== -1) texName = texName.substring(0, nullIdx);
      textures.push(texName.toLowerCase().replace(/\\/g, '/'));
      offset += 40;
    }

    // Saltar nodo raíz (40 bytes) si existe
    offset += 40;

    // 3. Leer Meshes
    if (offset + 4 > arrayBuffer.byteLength) {
      return { textures, meshes: [] };
    }

    const meshCount = view.getUint32(offset, true);
    offset += 4;

    const meshes = [];

    for (let m = 0; m < meshCount; m++) {
      if (offset + 80 > arrayBuffer.byteLength) break;

      // Nombre de mesh (40 bytes)
      const meshNameBytes = bytes.subarray(offset, offset + 40);
      let meshName = decoder.decode(meshNameBytes);
      const nullIdx = meshName.indexOf('\0');
      if (nullIdx !== -1) meshName = meshName.substring(0, nullIdx);
      offset += 40;

      // Saltar nombre padre (40 bytes)
      offset += 40;

      // Texturas del mesh
      const meshTexCount = view.getUint32(offset, true);
      offset += 4;
      
      const meshTexIndices = [];
      for (let mt = 0; mt < meshTexCount; mt++) {
        meshTexIndices.push(view.getInt32(offset, true));
        offset += 4;
      }

      // Matriz de transformación local (9 floats rotación, 3 floats posición, 3 floats posición extra)
      // Saltamos esto porque en nuestro motor usaremos rotaciones Three.js del RSW
      offset += (9 + 3 + 3) * 4;

      // Posición relativa (3 floats)
      const pos = {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 4, true),
        z: view.getFloat32(offset + 8, true)
      };
      offset += 12;

      // Escala (3 floats)
      offset += 12;

      // 4. Leer VÉRTICES (3 floats c/u)
      const verticesCount = view.getUint32(offset, true);
      offset += 4;

      const vertices = [];
      for (let v = 0; v < verticesCount; v++) {
        vertices.push({
          x: view.getFloat32(offset, true),
          y: view.getFloat32(offset + 4, true),
          z: view.getFloat32(offset + 8, true)
        });
        offset += 12;
      }

      // 5. Leer Coordenadas de Texturas UV (4 bytes flag, 2 floats U, V)
      const uvsCount = view.getUint32(offset, true);
      offset += 4;

      const uvs = [];
      for (let u = 0; u < uvsCount; u++) {
        // En versiones >= 1.2 hay un uint32 extra de flag/color
        if (majorVersion > 1 || (majorVersion === 1 && minorVersion >= 2)) {
          offset += 4; 
        }
        uvs.push({
          u: view.getFloat32(offset, true),
          v: view.getFloat32(offset + 4, true)
        });
        offset += 8;
      }

      // 6. Leer CARAS (Faces) (3 vertex indices, 3 UV indices, 2 bytes texture index, 2 bytes padding)
      const facesCount = view.getUint32(offset, true);
      offset += 4;

      const faces = [];
      for (let f = 0; f < facesCount; f++) {
        const v0 = view.getUint16(offset, true);
        const v1 = view.getUint16(offset + 2, true);
        const v2 = view.getUint16(offset + 4, true);

        const uv0 = view.getUint16(offset + 6, true);
        const uv1 = view.getUint16(offset + 8, true);
        const uv2 = view.getUint16(offset + 10, true);

        const texIdx = view.getUint16(offset + 12, true);
        offset += 16; // 14 bytes + 2 bytes padding

        faces.push({
          v0, v1, v2,
          uv0, uv1, uv2,
          texIdx: meshTexIndices[texIdx] !== undefined ? meshTexIndices[texIdx] : texIdx
        });
      }

      meshes.push({
        name: meshName,
        position: pos,
        vertices,
        uvs,
        faces
      });
    }

    return {
      textures,
      meshes
    };
  }
}

window.RsmParser = RsmParser;
