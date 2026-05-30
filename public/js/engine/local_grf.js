/**
 * WebRO - Client-side Local GRF Reader using IndexedDB
 * Enables playing with original assets on cloud deployments
 * by storing the data.grf File object in IndexedDB and parsing it locally.
 * Supports dual Hangeul/EUC-KR and Windows-1252 file path indexing for full compatibility.
 */

// Mapa de traducción bidireccional para carpetas y términos coreanos en Ragnarok Online
const KOREAN_TRANSLATION_MAP = {
  '¸ó½ºÅÍ': '몬스터',
  'ÀÎ°£Á·': '인간족',
  '¸öÅë': '몸통',
  '³²': '남',
  '¿©': '여',
  'ÃÊº¸ÀÚ_³²': '초보자_남',
  'ÃÊº¸ÀÚ_¿©': '초보자_여',
  '¸Ó¸®Åë': '머리통'
};

function getAlternativePaths(path) {
  const alts = [];
  
  // 1. Traducir de windows-1252 a Hangeul (Coreano)
  let alt1 = path;
  let hasRep1 = false;
  for (const [key, val] of Object.entries(KOREAN_TRANSLATION_MAP)) {
    if (alt1.includes(key)) {
      alt1 = alt1.replaceAll(key, val);
      hasRep1 = true;
    }
  }
  if (hasRep1) alts.push(alt1);

  // 2. Traducir de Hangeul a windows-1252
  let alt2 = path;
  let hasRep2 = false;
  for (const [key, val] of Object.entries(KOREAN_TRANSLATION_MAP)) {
    if (alt2.includes(val)) {
      alt2 = alt2.replaceAll(val, key);
      hasRep2 = true;
    }
  }
  if (hasRep2) alts.push(alt2);

  // 3. Variantes de nombre para sprites de cabeza
  // Algunos GRFs usan backslash en vez de forward slash
  const backslashVariant = path.replace(/\//g, '\\');
  if (backslashVariant !== path) alts.push(backslashVariant);

  return alts;
}

class LocalGRF {
  constructor() {
    this.dbName = 'WebRO_GRF_DB';
    this.storeName = 'assets';
    this.db = null;
    this.file = null;
    this.index = new Map();
    this.isLoaded = false;
    this.isSaved = false;
    this.parsePromise = null;
  }

  async init() {
    await this.initDB();
    const loadedFile = await this.loadGRFFile();
    if (loadedFile) {
      console.log(`📦 [LocalGRF] Detectado data.grf local guardado en IndexedDB.`);
      this.isSaved = true;
      
      this.parsePromise = this.parseGRF().then(() => {
        this.isLoaded = true;
      }).catch(err => {
        console.error('❌ [LocalGRF] Error al parsear data.grf local:', err);
      });
    }
  }

  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  saveGRFFile(file) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('IndexedDB no inicializada.'));
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.put(file, 'dataGRF');
      req.onsuccess = () => {
        this.file = file;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  loadGRFFile() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('IndexedDB no inicializada.'));
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      const req = store.get('dataGRF');
      req.onsuccess = (e) => {
        const file = e.target.result;
        if (file) {
          this.file = file;
          resolve(file);
        } else {
          resolve(null);
        }
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  clearGRFFile() {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('IndexedDB no inicializada.'));
      const tx = this.db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      const req = store.delete('dataGRF');
      req.onsuccess = () => {
        this.file = null;
        this.index.clear();
        this.isLoaded = false;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async parseGRF() {
    if (!this.file) return;

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const headerBlob = this.file.slice(0, 47);
      
      reader.onload = (e) => {
        try {
          const buffer = e.target.result;
          const view = new DataView(buffer);

          let magic = '';
          for (let i = 0; i < 15; i++) {
            const char = view.getUint8(i);
            if (char !== 0) magic += String.fromCharCode(char);
          }

          if (magic !== 'Master of Magic') {
            return reject(new Error('Firma de GRF local inválida.'));
          }

          const fileTableOffset = view.getUint32(30, true);
          const seed = view.getUint32(34, true);
          const filesCount = view.getUint32(38, true) - seed - 7;

          const headReader = new FileReader();
          const tableHeadBlob = this.file.slice(fileTableOffset + 46, fileTableOffset + 46 + 8);
          
          headReader.onload = (evt) => {
            try {
              const headView = new DataView(evt.target.result);
              const compressedSize = headView.getUint32(0, true);

              const dataReader = new FileReader();
              const tableDataBlob = this.file.slice(fileTableOffset + 46 + 8, fileTableOffset + 46 + 8 + compressedSize);
              
              dataReader.onload = (ev) => {
                try {
                  const compressedBytes = new Uint8Array(ev.target.result);
                  const unpacked = pako.inflate(compressedBytes);
                  const viewUnpacked = new DataView(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength);

                  let offset = 0;
                  this.index.clear();
                  
                  // Decodificadores duales: Windows-1252 y EUC-KR (Coreano)
                  const decoder1252 = new TextDecoder('windows-1252');
                  const decoderEUCKR = new TextDecoder('euc-kr');

                  for (let i = 0; i < filesCount; i++) {
                    if (offset >= unpacked.length) break;

                    const nextNull = unpacked.indexOf(0, offset);
                    if (nextNull === -1 || nextNull >= unpacked.length) break;

                    const rawBytes = unpacked.subarray(offset, nextNull);
                    offset = nextNull + 1; // saltar null

                    if (offset + 17 > unpacked.length) break;

                    const cLen = viewUnpacked.getUint32(offset, true);
                    const uLen = viewUnpacked.getUint32(offset + 4, true);
                    const flag = unpacked[offset + 12];
                    const fileOffset = viewUnpacked.getUint32(offset + 13, true);
                    offset += 17;

                    const entry = {
                      offset: fileOffset,
                      compressedSize: cLen,
                      uncompressedSize: uLen,
                      flag: flag
                    };

                    // 1. Indexar en windows-1252 (Rutas por defecto del cliente)
                    const filePath1252 = decoder1252.decode(rawBytes);
                    const cleanPath1252 = filePath1252.toLowerCase().replace(/\\/g, '/');
                    this.index.set(cleanPath1252, entry);

                    // 2. Indexar en EUC-KR (Rutas en coreano original si difieren)
                    try {
                      const filePathEUCKR = decoderEUCKR.decode(rawBytes);
                      const cleanPathEUCKR = filePathEUCKR.toLowerCase().replace(/\\/g, '/');
                      if (cleanPathEUCKR !== cleanPath1252) {
                        this.index.set(cleanPathEUCKR, entry);
                      }
                    } catch (e) {
                      // Ignorar errores individuales si no contiene caracteres coreanos decodificables
                    }
                  }

                  this.isLoaded = true;
                  console.log(`✅ [LocalGRF] Parseado con éxito. ${this.index.size} rutas indexadas dualmente en navegador.`);
                  resolve();
                } catch (err) { reject(err); }
              };
              dataReader.readAsArrayBuffer(tableDataBlob);
            } catch (err) { reject(err); }
          };
          headReader.readAsArrayBuffer(tableHeadBlob);
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(headerBlob);
    });
  }

  readBytes(path) {
    return new Promise((resolve, reject) => {
      if (!this.file || !this.isLoaded) return reject(new Error('GRF local no inicializado.'));

      const cleanPath = path.toLowerCase().replace(/\\/g, '/');
      let entry = this.index.get(cleanPath);

      // Si no se encuentra en el primer intento, probar rutas alternativas
      if (!entry) {
        const alts = getAlternativePaths(cleanPath);
        for (const alt of alts) {
          entry = this.index.get(alt);
          if (entry) {
            console.log(`🎯 [LocalGRF] Archivo resuelto mediante ruta alternativa coreana: ${alt}`);
            break;
          }
        }
      }

      // Búsqueda parcial/fuzzy: si la ruta exacta y alternativas fallan,
      // buscar por nombre de archivo en todo el índice
      if (!entry) {
        const fileName = cleanPath.split('/').pop();
        if (fileName) {
          for (const [indexPath, indexEntry] of this.index) {
            if (indexPath.endsWith('/' + fileName) || indexPath.endsWith('\\' + fileName)) {
              entry = indexEntry;
              console.log(`🔍 [LocalGRF] Encontrado por búsqueda parcial: ${indexPath} (buscando: ${path})`);
              break;
            }
          }
        }
      }

      if (!entry) return reject(new Error(`Archivo no encontrado en GRF local: ${path}`));

      const fileBlob = this.file.slice(entry.offset + 46, entry.offset + 46 + entry.compressedSize);
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const compressed = new Uint8Array(e.target.result);
          const decompressed = pako.inflate(compressed);
          const cleanBytes = new Uint8Array(decompressed.buffer.slice(decompressed.byteOffset, decompressed.byteOffset + decompressed.byteLength));
          resolve(cleanBytes);
        } catch (err) { reject(err); }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(fileBlob);
    });
  }

  // Método de diagnóstico: busca archivos en el índice por patrón
  searchFiles(pattern) {
    const results = [];
    const lowerPattern = pattern.toLowerCase();
    for (const [path] of this.index) {
      if (path.includes(lowerPattern)) {
        results.push(path);
      }
    }
    return results;
  }
}

window.localGRF = new LocalGRF();
