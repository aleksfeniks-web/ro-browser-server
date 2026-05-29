/**
 * WebRO - Client-side Local GRF Reader using IndexedDB
 * Enables playing with original assets on cloud deployments (Render.com)
 * by storing the data.grf File object in IndexedDB and parsing it locally.
 */
class LocalGRF {
  constructor() {
    this.dbName = 'WebRO_GRF_DB';
    this.storeName = 'assets';
    this.db = null;
    this.file = null;
    this.index = new Map();
    this.isLoaded = false;
  }

  async init() {
    await this.initDB();
    const loadedFile = await this.loadGRFFile();
    if (loadedFile) {
      console.log(`📦 [LocalGRF] Detectado data.grf local guardado en IndexedDB.`);
      try {
        await this.parseGRF();
      } catch (err) {
        console.error('❌ [LocalGRF] Error al parsear data.grf local:', err);
      }
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

          // Firma
          let magic = '';
          for (let i = 0; i < 15; i++) {
            const char = view.getUint8(i);
            if (char !== 0) magic += String.fromCharCode(char);
          }

          if (magic !== 'Master of Magic') {
            return reject(new Error('Firma de GRF local inválida.'));
          }

          // Offsets con getUint32 (sin signo para > 2GB)
          const fileTableOffset = view.getUint32(30, true);
          const seed = view.getUint32(34, true);
          const filesCount = view.getUint32(38, true) - seed - 7;

          // Leer la tabla comprimida
          const headReader = new FileReader();
          const tableHeadBlob = this.file.slice(fileTableOffset + 46, fileTableOffset + 46 + 8);
          
          headReader.onload = (evt) => {
            try {
              const headView = new DataView(evt.target.result);
              const compressedSize = headView.getUint32(0, true);
              const uncompressedSize = headView.getUint32(4, true);

              const dataReader = new FileReader();
              const tableDataBlob = this.file.slice(fileTableOffset + 46 + 8, fileTableOffset + 46 + 8 + compressedSize);
              
              dataReader.onload = (ev) => {
                try {
                  const compressedBytes = new Uint8Array(ev.target.result);
                  const unpacked = pako.inflate(compressedBytes);
                  const viewUnpacked = new DataView(unpacked.buffer);

                  let offset = 0;
                  this.index.clear();

                  for (let i = 0; i < filesCount; i++) {
                    if (offset >= unpacked.length) break;

                    let filePath = '';
                    while (unpacked[offset] !== 0 && offset < unpacked.length) {
                      filePath += String.fromCharCode(unpacked[offset]);
                      offset++;
                    }
                    offset++; // saltar null

                    if (offset + 17 > unpacked.length) break;

                    const cLen = viewUnpacked.getUint32(offset, true);
                    const uLen = viewUnpacked.getUint32(offset + 4, true);
                    const uLenAligned = viewUnpacked.getUint32(offset + 8, true);
                    const flag = unpacked[offset + 12];
                    const fileOffset = viewUnpacked.getUint32(offset + 13, true);
                    offset += 17;

                    const cleanPath = filePath.toLowerCase().replace(/\\/g, '/');
                    this.index.set(cleanPath, {
                      offset: fileOffset,
                      compressedSize: cLen,
                      uncompressedSize: uLen,
                      flag: flag
                    });
                  }

                  this.isLoaded = true;
                  console.log(`✅ [LocalGRF] Parseado con éxito. ${this.index.size} archivos indexados en navegador.`);
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
      const entry = this.index.get(cleanPath);
      if (!entry) return reject(new Error(`Archivo no encontrado en GRF local: ${path}`));

      const fileBlob = this.file.slice(entry.offset + 46, entry.offset + 46 + entry.compressedSize);
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const compressed = new Uint8Array(e.target.result);
          const decompressed = pako.inflate(compressed);
          resolve(decompressed);
        } catch (err) { reject(err); }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(fileBlob);
    });
  }
}

window.localGRF = new LocalGRF();
