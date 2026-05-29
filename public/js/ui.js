/**
 * WebRO - UI & HUD Window Controller (Draggable classic RO skin)
 */
class UIController {
  constructor(game) {
    this.game = game;
    this.activeInventoryTab = 'consume'; // consume | equip
    this.draggedWindow = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.init();
  }

  init() {
    // Configurar ventanas arrastrables
    const headers = document.querySelectorAll('.win-header');
    headers.forEach(header => {
      header.addEventListener('mousedown', (e) => this.onMouseDown(e, header.parentElement));
    });

    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('mouseup', () => this.onMouseUp());

    // Configurar cierre de modal GM dinámico
    const btnGMClose = document.querySelector('#modal-gm-help .btn-primary');
    if (btnGMClose) {
      btnGMClose.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof closeGMHelp === 'function') {
          closeGMHelp();
        }
      });
    }

    const overlayGM = document.getElementById('modal-gm-help');
    if (overlayGM) {
      overlayGM.addEventListener('click', (e) => {
        if (typeof closeGMHelp === 'function') {
          closeGMHelp();
        }
      });
    }

    // Configurar entrada del chat
    const chatInput = document.getElementById('chat-input-box');
    const chatSend = document.getElementById('btn-chat-send');

    const handleSend = () => {
      const msg = chatInput.value.trim();
      if (msg) {
        this.game.network.sendChat(msg);
        chatInput.value = '';
        chatInput.blur(); // Quitar foco para poder seguir jugando
      }
    };

    chatSend.addEventListener('click', handleSend);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSend();
      }
      e.stopPropagation(); // Evitar que el juego reciba teclas calientes mientras chatea
    });

    // Configurar hotkeys de teclado generales
    document.addEventListener('keydown', (e) => {
      // Si el chat está enfocado, no procesar atajos
      if (document.activeElement === chatInput) return;

      const key = e.key.toUpperCase();
      const alt = e.altKey;

      if (alt) {
        e.preventDefault();
        if (key === 'A') this.toggleWindow('win-status');
        if (key === 'E') this.toggleWindow('win-inventory');
        if (key === 'S') this.toggleWindow('win-skills');
        if (key === 'V') this.toggleWindow('win-basic');
      }

      // Teclas calientes F1 - F9
      if (e.key.startsWith('F') && e.key.length === 2) {
        const num = parseInt(e.key.substring(1));
        if (num >= 1 && num <= 9) {
          e.preventDefault();
          this.triggerHotkey(num);
        }
      }
    });

    // Configurar ranuras de hotkey para arrastre
    this.setupHotkeySlots();
  }

  // --- Arrastre de Ventanas Flotantes ---
  onMouseDown(e, win) {
    this.draggedWindow = win;
    this.dragOffsetX = e.clientX - win.offsetLeft;
    this.dragOffsetY = e.clientY - win.offsetTop;
    // Traer al frente
    document.querySelectorAll('.ro-window, .win-chat').forEach(w => w.style.zIndex = 100);
    win.style.zIndex = 101;
  }

  onMouseMove(e) {
    if (!this.draggedWindow) return;
    const left = e.clientX - this.dragOffsetX;
    const top = e.clientY - this.dragOffsetY;
    
    // Límites de pantalla aproximados
    const maxLeft = window.innerWidth - this.draggedWindow.offsetWidth;
    const maxTop = window.innerHeight - this.draggedWindow.offsetHeight;

    this.draggedWindow.style.left = `${Math.min(maxLeft, Math.max(0, left))}px`;
    this.draggedWindow.style.top = `${Math.min(maxTop, Math.max(0, top))}px`;
  }

  onMouseUp() {
    this.draggedWindow = null;
  }

  // Mostrar / Ocultar ventanas
  toggleWindow(id) {
    if (window.soundManager) window.soundManager.playClick();
    const win = document.getElementById(id);
    if (win) {
      win.classList.toggle('hidden');
    }
  }

  // --- Actualizar Información Básica (HUD) ---
  updateHUD(char) {
    document.getElementById('hud-name').textContent = char.name;
    document.getElementById('hud-job').textContent = char.job;
    document.getElementById('hud-hp').textContent = `${char.hp}/${char.maxHp}`;
    document.getElementById('hud-sp').textContent = `${char.sp}/${char.maxSp}`;
    
    // Porcentajes de barras
    const hpPct = Math.min(100, Math.max(0, (char.hp / char.maxHp) * 100));
    const spPct = Math.min(100, Math.max(0, (char.sp / char.maxSp) * 100));
    document.getElementById('bar-hp').style.width = `${hpPct}%`;
    document.getElementById('bar-sp').style.width = `${spPct}%`;

    // Experiencia
    const nextBaseExp = Math.floor(Math.pow(char.baseLevel, 2.2) * 45) + 80;
    const nextJobExp = Math.floor(Math.pow(char.jobLevel, 2.0) * 35) + 50;
    const basePct = Math.min(100, Math.max(0, (char.baseExp / nextBaseExp) * 100));
    const jobPct = Math.min(100, Math.max(0, (char.jobExp / nextJobExp) * 100));

    document.getElementById('hud-base-exp').textContent = `${basePct.toFixed(1)}%`;
    document.getElementById('hud-job-exp').textContent = `${jobPct.toFixed(1)}%`;
    document.getElementById('bar-base-exp').style.width = `${basePct}%`;
    document.getElementById('bar-job-exp').style.width = `${jobPct}%`;

    // Ventana de Atributos (Stats)
    document.getElementById('stat-points-avail').textContent = char.statPoints;
    const stats = ['str', 'agi', 'vit', 'int', 'dex', 'luk'];
    stats.forEach(s => {
      document.getElementById(`stat-val-${s}`).textContent = char[s];
      // Mostrar u ocultar botón "+" según puntos disponibles y límites
      const plusBtn = document.querySelector(`#win-status .stat-item:nth-child(${stats.indexOf(s) + 2}) .btn-stat-plus`);
      if (plusBtn) {
        plusBtn.style.display = char.statPoints > 0 ? 'flex' : 'none';
      }
    });

    document.getElementById('stat-atk').textContent = char.atk;
    document.getElementById('stat-def').textContent = char.def;
    document.getElementById('stat-matk').textContent = char.matk;
    document.getElementById('stat-flee').textContent = char.flee;
    document.getElementById('stat-hit').textContent = char.hit;
    document.getElementById('stat-lvl').textContent = char.baseLevel;

    // Minimapa
    document.getElementById('coord-label').textContent = `X: ${char.x}, Y: ${char.y}`;
  }

  // Aumentar atributo
  addStatPoint(stat) {
    if (this.game.localPlayer && this.game.localPlayer.statPoints > 0) {
      if (window.soundManager) window.soundManager.playClick();
      this.game.network.sendAddStat(stat);
    }
  }

  // --- Inventario ---
  switchInventoryTab(tab) {
    if (window.soundManager) window.soundManager.playClick();
    this.activeInventoryTab = tab;
    
    const tabs = document.querySelectorAll('.inv-tab');
    tabs.forEach(t => t.classList.remove('active'));
    if (tab === 'consume') tabs[0].classList.add('active');
    else tabs[1].classList.add('active');

    if (this.game.localPlayer) {
      this.renderInventory(this.game.localPlayer.inventory, this.game.itemsDb);
    }
  }

  renderInventory(inventory, itemsDb) {
    const container = document.getElementById('inventory-items');
    container.innerHTML = '';

    if (!inventory || inventory.length === 0) {
      container.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:15px;">Inventario vacío</div>';
      return;
    }

    // Filtrar según pestaña activa
    const filtered = inventory.filter(invItem => {
      const item = itemsDb[invItem.itemId];
      if (!item) return false;
      return item.type === this.activeInventoryTab;
    });

    if (filtered.length === 0) {
      container.innerHTML = '<div style="font-size:0.75rem; color:#94a3b8; text-align:center; padding:15px;">Ningún objeto en esta pestaña</div>';
      return;
    }

    filtered.forEach(invItem => {
      const item = itemsDb[invItem.itemId];
      const row = document.createElement('div');
      row.className = `item-row ${invItem.equipped ? 'equipped' : ''}`;
      row.draggable = true;

      // Iconos eemulados
      let icon = '📦';
      if (item.sprite === 'red_potion') icon = '🧪';
      else if (item.sprite === 'orange_potion') icon = '🧪';
      else if (item.sprite === 'knife') icon = '🗡️';
      else if (item.sprite === 'sword') icon = '⚔️';
      else if (item.sprite === 'staff') icon = '🪄';
      else if (item.sprite === 'poring_hat') icon = '👒';
      else if (item.sprite === 'ribbon') icon = '🎀';

      row.innerHTML = `
        <div class="item-icon-wrapper">${icon}</div>
        <div class="item-details">
          <div class="item-name">${item.name}</div>
          <div class="item-desc" title="${item.description}">${item.description}</div>
        </div>
        <div class="item-count">x${invItem.count}</div>
        ${invItem.equipped ? '<span class="item-equipped-tag">Equipado</span>' : ''}
      `;

      // Doble click para usar / equipar
      row.addEventListener('dblclick', () => {
        if (window.soundManager) window.soundManager.playClick();
        this.game.network.sendUseItem(invItem.itemId);
      });

      // Implementar arrastre a barra de hotkeys
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          type: 'item',
          itemId: invItem.itemId,
          icon: icon
        }));
      });

      container.appendChild(row);
    });
  }

  // --- Habilidades ---
  renderSkills(char) {
    const container = document.getElementById('skill-list');
    container.innerHTML = '';

    document.getElementById('skill-points-avail').textContent = char.skillPoints;

    // Base de Habilidades según Job
    const skillTemplates = {
      'Novice': [
        { id: 'bash', name: 'Golpe Bash (Bash)', icon: '💥', desc: 'Golpe físico fuerte. Daño +150%.' }
      ],
      'Swordman': [
        { id: 'bash', name: 'Golpe Bash (Bash)', icon: '💥', desc: 'Golpe de espada masivo. Daño +250%.' },
        { id: 'heal', name: 'Auto Curación (Heal)', icon: '💚', desc: 'Curación sagrada rápida usando energía.' }
      ],
      'Mage': [
        { id: 'fire_bolt', name: 'Flecha de Fuego (Fire Bolt)', icon: '🔥', desc: 'Lanza proyectiles de fuego mágico.' }
      ],
      'Acolyte': [
        { id: 'heal', name: 'Curación Divina (Heal)', icon: '💚', desc: 'Sana las heridas del objetivo con luz.' }
      ],
      'Archer': [
        { id: 'double_strafe', name: 'Doble Flecha (Double Strafe)', icon: '🏹', desc: 'Dispara dos flechas consecutivas rápidas.' }
      ]
    };

    const jobSkills = skillTemplates[char.job] || skillTemplates['Novice'];

    jobSkills.forEach(skill => {
      const level = char.skills[skill.id] || 0;
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.draggable = level > 0; // Solo arrastrable si está aprendida

      row.innerHTML = `
        <div class="skill-icon-wrapper">${skill.icon}</div>
        <div class="skill-details">
          <div class="skill-name">${skill.name}</div>
          <div class="skill-desc">${skill.desc}</div>
        </div>
        <div class="skill-level-lbl">Nv. ${level}</div>
        ${char.skillPoints > 0 && level < 10 
          ? `<button class="btn-stat-plus" onclick="UI.learnSkill('${skill.id}')">+</button>` 
          : ''
        }
      `;

      // Clic para lanzar habilidad si es aprendida y tenemos objetivo
      row.addEventListener('click', () => {
        if (level > 0) {
          this.triggerSkill(skill.id);
        }
      });

      // Arrastrar a hotkeys
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({
          type: 'skill',
          skillId: skill.id,
          icon: skill.icon
        }));
      });

      container.appendChild(row);
    });
  }

  learnSkill(skillId) {
    if (this.game.localPlayer && this.game.localPlayer.skillPoints > 0) {
      if (window.soundManager) window.soundManager.playClick();
      this.game.network.sendLearnSkill(skillId);
    }
  }

  // --- Consola de Chat ---
  appendChatLog(sender, message, isSystem = false) {
    const chatBox = document.getElementById('chat-log-box');
    const msgEl = document.createElement('div');

    if (isSystem) {
      msgEl.className = 'chat-system';
      msgEl.innerHTML = `[Sistema] ${message}`;
    } else {
      msgEl.className = 'chat-normal';
      msgEl.innerHTML = `<strong>${sender}:</strong> ${message}`;
    }

    chatBox.appendChild(msgEl);
    
    // Auto-scroll si está cerca de la base
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  // --- Configuración de Barra de Hotkeys ---
  setupHotkeySlots() {
    this.hotkeys = {}; // slotId -> { type, id, icon }
    const slots = document.querySelectorAll('.hotkey-slot');

    slots.forEach(slot => {
      const keyId = parseInt(slot.dataset.key);

      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        try {
          const data = JSON.parse(e.dataTransfer.getData('text/plain'));
          this.assignHotkey(keyId, data);
        } catch (err) {}
      });

      slot.addEventListener('click', () => {
        this.triggerHotkey(keyId);
      });
    });
  }

  assignHotkey(slotId, data) {
    if (window.soundManager) window.soundManager.playClick();
    this.hotkeys[slotId] = data;
    const iconEl = document.getElementById(`hk-icon-${slotId}`);
    if (iconEl) {
      iconEl.textContent = data.icon;
    }
  }

  triggerHotkey(slotId) {
    const action = this.hotkeys[slotId];
    if (!action) return;

    if (action.type === 'item') {
      // Consumir
      this.game.network.sendUseItem(action.itemId);
    } else if (action.type === 'skill') {
      // Lanzar habilidad sobre el objetivo seleccionado
      this.triggerSkill(action.skillId);
    }
  }

  triggerSkill(skillId) {
    if (!this.game.localPlayer) return;
    
    // Curar puede lanzarse sobre uno mismo
    if (skillId === 'heal') {
      this.game.network.sendCastSkill(skillId, this.game.localPlayer.id);
      return;
    }

    // Otras habilidades ofensivas requieren objetivo seleccionado
    if (!this.game.selectedTargetId) {
      this.appendChatLog("Sistema", "Selecciona un monstruo objetivo para lanzar esta habilidad.", true);
      return;
    }

    this.game.network.sendCastSkill(skillId, this.game.selectedTargetId);
  }

  // --- Renderizar Minimapa (Canvas del Minimapa) ---
  drawMinimap() {
    const canvas = document.getElementById('minimap-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const map = this.game.map;
    
    ctx.clearRect(0,0, canvas.width, canvas.height);

    if (map.grid.length === 0) return;

    // Calcular escala de conversión
    const scaleX = canvas.width / map.width;
    const scaleY = canvas.height / map.height;

    // 1. Dibujar obstaculos y grilla del mapa
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const type = map.grid[y][x];
        ctx.fillStyle = '#1e293b'; // Walkable por defecto oscuro

        if (type === 'T' || type === '#') {
          ctx.fillStyle = '#0f172a'; // Bloqueado
        } else if (type === '*') {
          ctx.fillStyle = '#0891b2'; // Agua
        } else if (type === 'F') {
          ctx.fillStyle = '#64748b'; // Fuente
        } else if (type === '+') {
          ctx.fillStyle = '#334155'; // Caminos
        }

        ctx.fillRect(x * scaleX, y * scaleY, scaleX, scaleY);
      }
    }

    // 2. Dibujar Portales (Warps) en verde neon
    ctx.fillStyle = '#10b981';
    map.warps.forEach(warp => {
      ctx.fillRect(warp.x * scaleX, warp.y * scaleY, warp.width * scaleX, warp.height * scaleY);
    });

    // 3. Dibujar Otras Entidades (Monstruos = rojo, Jugadores = azul)
    Object.keys(this.game.entities).forEach(id => {
      const ent = this.game.entities[id];
      ctx.fillStyle = ent.type === 'monster' ? '#f87171' : '#60a5fa';
      ctx.beginPath();
      ctx.arc((ent.x + 0.5) * scaleX, (ent.y + 0.5) * scaleY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 4. Dibujar Jugador Local (Flecha Amarilla)
    if (this.game.localPlayer) {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc((this.game.localPlayer.x + 0.5) * scaleX, (this.game.localPlayer.y + 0.5) * scaleY, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// Ventanas globales toggles de ayuda para callbacks inline
function toggleWindow(id) {
  if (window.UI) window.UI.toggleWindow(id);
}

function switchInventoryTab(tab) {
  if (window.UI) window.UI.switchInventoryTab(tab);
}

function addStatPoint(stat) {
  if (window.UI) window.UI.addStatPoint(stat);
}

function showGMCommandsHelp() {
  if (window.soundManager) window.soundManager.playClick();
  document.getElementById('modal-gm-help').classList.remove('hidden');
}

function closeGMHelp() {
  if (window.soundManager) window.soundManager.playClick();
  document.getElementById('modal-gm-help').classList.add('hidden');
}

function exitGame() {
  if (window.soundManager) window.soundManager.playClick();
  window.location.href = 'index.html';
}

// Asignar a la ventana global para enganche robusto
window.toggleWindow = toggleWindow;
window.switchInventoryTab = switchInventoryTab;
window.addStatPoint = addStatPoint;
window.showGMCommandsHelp = showGMCommandsHelp;
window.closeGMHelp = closeGMHelp;
window.exitGame = exitGame;
window.UIController = UIController;
