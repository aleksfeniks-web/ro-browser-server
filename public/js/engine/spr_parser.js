/**
 * WebRO - Client-side original RO Sprite (.spr) parser and renderer
 * Decodes Run-Length Encoded (RLE) index bytes and applies the 256-color palette
 * to output ready-to-draw offscreen Canvas frames.
 */
class SprParser {
  static async loadAndParse(path) {
    // 1. Intentar cargar desde el LocalGRF del navegador (IndexedDB - ideal para Render.com en la nube)
    if (window.localGRF && window.localGRF.isLoaded) {
      try {
        const bytes = await window.localGRF.readBytes(path);
        return this.parse(bytes.buffer);
      } catch (err) {
        console.warn(`[SprParser] No se pudo leer localmente ${path}, intentando desde la API:`, err);
      }
    }

    // 2. Intentar cargar desde la API del servidor (Localhost / Fallback)
    const url = `/api/grf/file?path=${encodeURIComponent(path)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Falla al cargar sprite ${path}: ${response.statusText}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return this.parse(arrayBuffer);
  }

  static parse(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    // 1. Validar Cabecera ("SP" + versión)
    if (bytes.length < 8) {
      throw new Error('Archivo sprite demasiado corto.');
    }

    const signature = String.fromCharCode(bytes[0], bytes[1]);
    if (signature !== 'SP') {
      throw new Error('Firma de sprite de RO inválida.');
    }
    
    const version = view.getUint16(2, true); // Ej: 0x201 (RLE) o 0x200 (sin compresión)
    const indexedFramesCount = view.getUint16(4, true);
    const rgbaFramesCount = view.getUint16(6, true);

    // 2. Extraer Paleta (los últimos 1024 bytes del archivo)
    // Contiene 256 colores RGBA
    const paletteOffset = arrayBuffer.byteLength - 1024;
    const palette = [];
    
    if (paletteOffset > 0 && paletteOffset < arrayBuffer.byteLength) {
      for (let i = 0; i < 256; i++) {
        const idx = paletteOffset + i * 4;
        const r = bytes[idx];
        const g = bytes[idx + 1];
        const b = bytes[idx + 2];
        // El primer color (índice 0) o el color rosa brillante clásico de RO (Magenta 255,0,255) son transparentes
        const isTransparent = (i === 0) || (r === 255 && g === 0 && b === 255);
        const a = isTransparent ? 0 : 255;
        palette.push({ r, g, b, a });
      }
    } else {
      // Paleta por defecto si falla
      for (let i = 0; i < 256; i++) {
        palette.push({ r: i, g: i, b: i, a: 255 });
      }
    }

    // 3. Parsear Marcos Indexados (Indexed Frames)
    let offset = 8;
    const frames = [];

    for (let f = 0; f < indexedFramesCount; f++) {
      if (offset + 4 > arrayBuffer.byteLength) break;
      
      const width = view.getUint16(offset, true);
      const height = view.getUint16(offset + 2, true);
      offset += 4;

      if (width === 0 || height === 0) {
        frames.push(null);
        continue;
      }

      let pixelData;
      if (version === 0x201) {
        // Formato RLE comprimido
        if (offset + 2 > arrayBuffer.byteLength) break;
        const compressedSize = view.getUint16(offset, true);
        offset += 2;

        if (offset + compressedSize > arrayBuffer.byteLength) break;
        const compressedBytes = bytes.subarray(offset, offset + compressedSize);
        offset += compressedSize;

        pixelData = this.decodeRLE(compressedBytes, width, height);
      } else {
        // Sin compresión
        const size = width * height;
        if (offset + size > arrayBuffer.byteLength) break;
        pixelData = bytes.subarray(offset, offset + size);
        offset += size;
      }

      // Convertir el mapa de índices de píxeles a imagen de Canvas (Canvas Image)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(width, height);

      for (let i = 0; i < width * height; i++) {
        const colorIdx = pixelData[i];
        const color = palette[colorIdx] || { r: 0, g: 0, b: 0, a: 0 };
        const dIdx = i * 4;
        imgData.data[dIdx] = color.r;
        imgData.data[dIdx + 1] = color.g;
        imgData.data[dIdx + 2] = color.b;
        imgData.data[dIdx + 3] = color.a;
      }
      
      ctx.putImageData(imgData, 0, 0);
      frames.push(canvas);
    }

    return {
      frames: frames,
      version: version,
      palette: palette
    };
  }

  static decodeRLE(bytes, width, height) {
    const pixels = new Uint8Array(width * height);
    let outIdx = 0;
    let inIdx = 0;
    
    while (outIdx < pixels.length && inIdx < bytes.length) {
      const val = bytes[inIdx++];
      if (val === 0) {
        // Repetir transparente
        if (inIdx >= bytes.length) break;
        const count = bytes[inIdx++];
        for (let i = 0; i < count; i++) {
          if (outIdx < pixels.length) {
            pixels[outIdx++] = 0;
          }
        }
      } else {
        pixels[outIdx++] = val;
      }
    }
    return pixels;
  }
}

window.SprParser = SprParser;
