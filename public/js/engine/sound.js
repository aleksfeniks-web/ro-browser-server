/**
 * WebRO - SoundManager (Web Audio API Synthesizer)
 * Recreates classic Ragnarok retro sound effects and synth background music in real-time.
 */
class SoundManager {
  constructor() {
    this.ctx = null;
    this.bgmInterval = null;
    this.bgmOscs = [];
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Web Audio Context inicializado.');
    } catch (e) {
      console.error('Web Audio API no soportada en este navegador.', e);
    }
  }

  // Efecto de Sonido: Clic de UI
  playClick() {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.05);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }

  // Efecto de Sonido: Ataque Físico
  playAttack() {
    this.init();
    if (!this.ctx) return;

    // Ruido blanco para emular el golpe físico clásico
    const bufferSize = this.ctx.sampleRate * 0.1; // 100ms
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.09);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    noise.start();
    noise.stop(this.ctx.currentTime + 0.1);
  }

  // Efecto de Sonido: Golpe Recibido (Daño)
  playHit() {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.25, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.18);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.18);
  }

  // Efecto de Sonido: Curación (Heal)
  playHeal() {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50]; // Arpegio de Do Mayor ascendente
    
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.value = freq;

      const startTime = now + idx * 0.06;
      const duration = 0.25;

      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.12, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    });
  }

  // Efecto de Sonido: Teletransporte (Warp)
  playTeleport() {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 0.45);

    gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.45);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.45);
  }

  // Efecto de Sonido: Nivel Subido (Iconic LEVEL UP!)
  playLevelUp() {
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    
    // 1. Fanfarria de Nivel Subido (Acordes de Metal Brillantes)
    const chords = [
      [523.25, 659.25, 783.99], // Do Mayor (C5, E5, G5) - 0.0s
      [587.33, 739.99, 880.00], // Re Mayor (D5, F#5, A5) - 0.2s
      [659.25, 830.61, 987.77], // Mi Mayor (E5, G#5, B5) - 0.4s
      [783.99, 987.77, 1174.66, 1567.98] // Sol Mayor brillante con octava alta - 0.6s
    ];

    chords.forEach((freqs, chordIdx) => {
      const startTime = now + chordIdx * 0.16;
      const duration = 0.4;

      freqs.forEach(freq => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Mezclar onda senoidal con cuadrada suave para brillo retro
        osc.type = 'square';
        osc.frequency.value = freq;

        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.05, startTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + duration);
      });
    });
  }

  // Reproductor de Música de Fondo (BGM)
  playBGM() {
    this.init();
    if (!this.ctx) return;
    this.stopBGM();

    const now = this.ctx.currentTime;
    
    // Melodía Nostálgica Simple (Tema de Prontera en Loop)
    // Notas en formato [Frecuencia, Duración en segundos]
    const melody = [
      [261.63, 0.4], [293.66, 0.4], [329.63, 0.4], [392.00, 0.4],
      [440.00, 0.8], [392.00, 0.8],
      [329.63, 0.4], [392.00, 0.4], [329.63, 0.4], [293.66, 0.4],
      [261.63, 0.8], [293.66, 0.8]
    ];

    let timeAcc = 0;
    const playSequence = () => {
      const startTime = this.ctx.currentTime;
      timeAcc = 0;
      
      melody.forEach(([freq, dur]) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle'; // Sonido suave de flauta/viento retro
        osc.frequency.value = freq;

        const noteStart = startTime + timeAcc;
        gain.gain.setValueAtTime(0, noteStart);
        gain.gain.linearRampToValueAtTime(0.06, noteStart + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, noteStart + dur - 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(noteStart);
        osc.stop(noteStart + dur);
        
        this.bgmOscs.push(osc);
        timeAcc += dur;
      });
    };

    // Lanzar primera vez
    playSequence();
    
    // Ciclo infinito cada 7.2 segundos
    this.bgmInterval = setInterval(playSequence, 7200);
  }

  stopBGM() {
    if (this.bgmInterval) {
      clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
    this.bgmOscs.forEach(osc => {
      try {
        osc.stop();
      } catch (e) {}
    });
    this.bgmOscs = [];
  }
}

// Exportar globalmente
window.soundManager = new SoundManager();
