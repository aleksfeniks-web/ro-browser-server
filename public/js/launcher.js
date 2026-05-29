/**
 * WebRO - Launcher controller
 */
document.addEventListener('DOMContentLoaded', () => {
  // Conectar con el servidor WebSocket (detecta HTTPS en la nube para usar WSS)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socketUrl = `${protocol}//${window.location.host}`;
  let ws = new WebSocket(socketUrl);
  let pingInterval = null;
  let serverCheckInterval = null;
  let currentAccountId = null;
  let selectedCharId = null;
  let characterList = [];

  // Configuración de creación de personaje
  let createGender = 'M';
  let createHairStyle = 1;
  const maxHairStyles = 3;
  let createHairColor = 0;
  const createStats = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  let remainingStatPoints = 48;

  // Sonido de Clic utilitario
  function playClick() {
    if (window.soundManager) {
      window.soundManager.playClick();
    }
  }

  // --- Elementos del DOM ---
  const elSrvState = document.getElementById('srv-state');
  const elSrvPing = document.getElementById('srv-ping');
  const elSrvPlayers = document.getElementById('srv-players');

  const panelAuth = document.getElementById('auth-panel');
  const panelChar = document.getElementById('char-panel');
  const panelCreate = document.getElementById('create-panel');

  // Auth Inputs y Botones
  const inputUser = document.getElementById('username');
  const inputPass = document.getElementById('password');
  const btnLogin = document.getElementById('btn-login');
  const btnToggleReg = document.getElementById('btn-toggle-register');
  const elAuthError = document.getElementById('auth-error-msg');
  const elAuthSuccess = document.getElementById('auth-success-msg');

  // Botones de Selección
  const elCharSlots = document.getElementById('char-slots');
  const btnEnterGame = document.getElementById('btn-enter-game');
  const btnCreateCharNav = document.getElementById('btn-create-char-nav');
  const btnLogout = document.getElementById('btn-logout');

  // Creación de Personaje
  const inputNewCharName = document.getElementById('new-char-name');
  const btnsGender = document.querySelectorAll('.gender-btn');
  const labelHairStyle = document.getElementById('hair-style-label');
  const btnPrevHair = document.getElementById('prev-hair');
  const btnNextHair = document.getElementById('next-hair');
  const dotsHairColor = document.querySelectorAll('.color-palette, .color-dot');
  const labelStatPoints = document.getElementById('stat-points-left');
  const elCreateError = document.getElementById('create-error-msg');
  const btnSubmitChar = document.getElementById('btn-submit-char');
  const btnCancelCreate = document.getElementById('btn-cancel-create');

  // --- Eventos y Conectividad del Servidor ---
  function setupWebSocket() {
    ws.onopen = () => {
      console.log('Conexión con el servidor establecida.');
      elSrvState.textContent = 'Online';
      elSrvState.className = 'status-text online';
      document.querySelector('.status-dot').className = 'status-dot online';
      
      // Iniciar latencia e informes periódicos
      startLatencyCheck();
    };

    ws.onclose = () => {
      console.log('Conexión perdida.');
      elSrvState.textContent = 'Offline';
      elSrvState.className = 'status-text';
      document.querySelector('.status-dot').className = 'status-dot';
      elSrvPing.textContent = '-- ms';
      elSrvPlayers.textContent = '--';
      stopLatencyCheck();

      // Intentar reconectar tras 3 segundos
      setTimeout(() => {
        ws = new WebSocket(socketUrl);
        setupWebSocket();
      }, 3000);
    };

    ws.onmessage = (event) => {
      let packet;
      try {
        packet = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      switch (packet.type) {
        case 'pong_ping': {
          const latency = Date.now() - packet.timestamp;
          elSrvPing.textContent = `${latency} ms`;
          break;
        }
        case 'server_info': {
          elSrvPlayers.textContent = packet.playerCount;
          break;
        }
        case 'auth_response':
          handleAuthResponse(packet);
          break;
        case 'char_list_response':
          handleCharListResponse(packet);
          break;
        case 'char_create_response':
          handleCharCreateResponse(packet);
          break;
      }
    };
  }

  function startLatencyCheck() {
    stopLatencyCheck();
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping_request', timestamp: Date.now() }));
      }
    }, 4000);
  }

  function stopLatencyCheck() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }

  setupWebSocket();

  // --- Autenticación (Login / Registro) ---
  let isRegisterMode = false;

  btnToggleReg.addEventListener('click', () => {
    playClick();
    isRegisterMode = !isRegisterMode;
    elAuthError.style.display = 'none';
    elAuthSuccess.style.display = 'none';

    if (isRegisterMode) {
      document.getElementById('auth-title').textContent = 'Crear Cuenta';
      btnLogin.textContent = 'Registrarse';
      btnToggleReg.textContent = 'Tengo una Cuenta';
    } else {
      document.getElementById('auth-title').textContent = 'Iniciar Sesión';
      btnLogin.textContent = 'Entrar al Servidor';
      btnToggleReg.textContent = 'Crear Cuenta';
    }
  });

  btnLogin.addEventListener('click', () => {
    playClick();
    const username = inputUser.value.trim();
    const password = inputPass.value.trim();

    if (!username || !password) {
      showAuthError('Por favor ingresa usuario y contraseña.');
      return;
    }

    if (ws.readyState !== WebSocket.OPEN) {
      showAuthError('El servidor no está disponible actualmente.');
      return;
    }

    ws.send(JSON.stringify({
      type: 'auth_request',
      username,
      password,
      register: isRegisterMode
    }));
  });

  function showAuthError(msg) {
    elAuthError.textContent = msg;
    elAuthError.style.display = 'block';
    elAuthSuccess.style.display = 'none';
  }

  function showAuthSuccess(msg) {
    elAuthSuccess.textContent = msg;
    elAuthSuccess.style.display = 'block';
    elAuthError.style.display = 'none';
  }

  function handleAuthResponse(packet) {
    if (packet.success) {
      if (isRegisterMode) {
        showAuthSuccess(packet.message);
        // Volver a login automático
        btnToggleReg.click();
        inputPass.value = '';
      } else {
        // Guardar cuenta e ir a selección
        currentAccountId = packet.accountId;
        sessionStorage.setItem('gm_account', packet.gm);
        
        panelAuth.classList.add('hidden');
        panelChar.classList.remove('hidden');

        // Solicitar lista de personajes
        ws.send(JSON.stringify({
          type: 'char_list_request',
          accountId: currentAccountId
        }));
      }
    } else {
      showAuthError(packet.message);
    }
  }

  // --- Selección de Personajes ---
  function handleCharListResponse(packet) {
    characterList = packet.chars;
    renderCharacterSlots();
  }

  function renderCharacterSlots() {
    elCharSlots.innerHTML = '';
    selectedCharId = null;
    btnEnterGame.classList.add('disabled');
    btnEnterGame.disabled = true;

    // Ragnarok tiene 3 ranuras clásicas en esta versión reducida
    for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
      const char = characterList[slotIdx];
      const slotEl = document.createElement('div');

      if (char) {
        slotEl.className = 'char-slot';
        slotEl.dataset.charId = char.id;

        // Renderizar avatar en 2D Canvas dinámico o dibujo CSS
        const avatarColor = getHairColorHex(char.hairColor);
        const hairStyleName = char.hair === 1 ? 'Largo' : char.hair === 2 ? 'Espinado' : 'Corto';

        slotEl.innerHTML = `
          <div class="char-avatar-container">
            <svg class="char-avatar-draw" viewBox="0 0 40 40">
              <!-- Cara -->
              <circle cx="20" cy="20" r="10" fill="#fbc4b2"/>
              <!-- Ojos -->
              <circle cx="17" cy="18" r="1.5" fill="#333"/>
              <circle cx="23" cy="18" r="1.5" fill="#333"/>
              <path d="M 18 24 Q 20 26 22 24" stroke="#333" stroke-width="1" fill="none"/>
              <!-- Cabello según color y género -->
              ${char.hair === 1 
                ? `<path d="M 10 18 Q 20 5 30 18 Q 32 30 28 32 L 12 32 Z" fill="${avatarColor}" opacity="0.9"/>`
                : char.hair === 2
                ? `<path d="M 8 20 L 12 10 L 20 5 L 28 10 L 32 20 L 25 15 L 20 12 L 15 15 Z" fill="${avatarColor}"/>`
                : `<ellipse cx="20" cy="13" rx="11" ry="6" fill="${avatarColor}"/>`
              }
              <!-- Sombrero si está equipado (ej: Poring Hat) -->
              ${char.equipment && char.equipment.headgear 
                ? `<circle cx="20" cy="10" r="6" fill="#ff9999" stroke="#ff4d4d" stroke-width="1"/>
                   <circle cx="18" cy="10" r="1" fill="#fff"/>
                   <circle cx="22" cy="10" r="1" fill="#fff"/>`
                : ''
              }
            </svg>
          </div>
          <div class="char-name">${char.name}</div>
          <div class="char-job">${char.job}</div>
          <div class="char-level">Lv. ${char.baseLevel} / Jv. ${char.jobLevel}</div>
        `;

        slotEl.addEventListener('click', () => {
          playClick();
          document.querySelectorAll('.char-slot').forEach(s => s.classList.remove('active'));
          slotEl.classList.add('active');
          selectedCharId = char.id;
          btnEnterGame.classList.remove('disabled');
          btnEnterGame.disabled = false;
        });

      } else {
        // Ranura Vacía
        slotEl.className = 'char-slot empty';
        slotEl.innerHTML = `
          <div class="plus-icon">+</div>
          <div class="char-name">Crear</div>
        `;
        slotEl.addEventListener('click', () => {
          playClick();
          openCharacterCreation();
        });
      }

      elCharSlots.appendChild(slotEl);
    }
  }

  function getHairColorHex(idx) {
    const colors = ['#ffd480', '#ff8080', '#80c4ff', '#c480ff', '#80ff80'];
    return colors[idx] || '#ffd480';
  }

  btnLogout.addEventListener('click', () => {
    playClick();
    currentAccountId = null;
    panelChar.classList.add('hidden');
    panelAuth.classList.remove('hidden');
  });

  btnEnterGame.addEventListener('click', () => {
    playClick();
    if (!selectedCharId) return;

    // Guardar personaje en sesión y redirigir
    sessionStorage.setItem('charId', selectedCharId);
    window.location.href = 'game.html';
  });

  // --- Creación de Personaje ---
  btnCreateCharNav.addEventListener('click', () => {
    playClick();
    openCharacterCreation();
  });

  function openCharacterCreation() {
    // Verificar si ya tiene 3 personajes
    if (characterList.length >= 3) {
      alert('Has alcanzado el límite máximo de 3 personajes.');
      return;
    }

    panelChar.classList.add('hidden');
    panelCreate.classList.remove('hidden');

    // Inicializar stats
    inputNewCharName.value = '';
    createGender = 'M';
    createHairStyle = 1;
    createHairColor = 0;
    
    // Resetear botones género
    btnsGender.forEach(btn => {
      btn.classList.remove('active');
      if (btn.dataset.gender === 'M') btn.classList.add('active');
    });

    labelHairStyle.textContent = `Estilo ${createHairStyle}`;
    
    // Resetear dots de color
    dotsHairColor.forEach(dot => {
      dot.classList.remove('active');
      if (parseInt(dot.dataset.color) === 0) dot.classList.add('active');
    });

    // Resetear stats
    Object.keys(createStats).forEach(s => createStats[s] = 1);
    remainingStatPoints = 48;
    updateCreateStatsUI();
  }

  // Selección de Género
  btnsGender.forEach(btn => {
    btn.addEventListener('click', () => {
      playClick();
      btnsGender.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      createGender = btn.dataset.gender;
    });
  });

  // Peinado
  btnPrevHair.addEventListener('click', () => {
    playClick();
    createHairStyle = createHairStyle - 1 < 1 ? maxHairStyles : createHairStyle - 1;
    labelHairStyle.textContent = `Estilo ${createHairStyle}`;
  });

  btnNextHair.addEventListener('click', () => {
    playClick();
    createHairStyle = createHairStyle + 1 > maxHairStyles ? 1 : createHairStyle + 1;
    labelHairStyle.textContent = `Estilo ${createHairStyle}`;
  });

  // Color de Cabello
  dotsHairColor.forEach(dot => {
    dot.addEventListener('click', () => {
      playClick();
      dotsHairColor.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      createHairColor = parseInt(dot.dataset.color);
    });
  });

  // Distribución de Atributos (STR, AGI, VIT, INT, DEX, LUK)
  document.querySelectorAll('.stat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playClick();
      const stat = btn.dataset.stat;
      const isPlus = btn.classList.contains('plus');
      const currentVal = createStats[stat];

      if (isPlus) {
        // Costo del atributo clásico: por simplicidad de novicio cuesta 1 punto
        if (remainingStatPoints > 0 && currentVal < 9) {
          createStats[stat]++;
          remainingStatPoints--;
        }
      } else {
        if (currentVal > 1) {
          createStats[stat]--;
          remainingStatPoints++;
        }
      }

      updateCreateStatsUI();
    });
  });

  function updateCreateStatsUI() {
    labelStatPoints.textContent = remainingStatPoints;
    Object.keys(createStats).forEach(s => {
      document.getElementById(`stat-${s}`).textContent = createStats[s];
    });
  }

  // Enviar Formulario de Creación
  btnSubmitChar.addEventListener('click', () => {
    playClick();
    const name = inputNewCharName.value.trim();
    if (!name) {
      showCreateError('Por favor ingresa un nombre.');
      return;
    }
    if (name.length < 3) {
      showCreateError('El nombre debe tener al menos 3 caracteres.');
      return;
    }
    if (remainingStatPoints > 0) {
      showCreateError('Reparte todos tus puntos de atributos iniciales.');
      return;
    }

    ws.send(JSON.stringify({
      type: 'char_create_request',
      accountId: currentAccountId,
      name,
      gender: createGender,
      hair: createHairStyle,
      hairColor: createHairColor,
      ...createStats
    }));
  });

  function showCreateError(msg) {
    elCreateError.textContent = msg;
    elCreateError.style.display = 'block';
  }

  function handleCharCreateResponse(packet) {
    if (packet.success) {
      elCreateError.style.display = 'none';
      panelCreate.classList.add('hidden');
      panelChar.classList.remove('remove');
      panelChar.classList.remove('hidden');

      // Re-solicitar lista de personajes
      ws.send(JSON.stringify({
        type: 'char_list_request',
        accountId: currentAccountId
      }));
    } else {
      showCreateError(packet.message);
    }
  }

  btnCancelCreate.addEventListener('click', () => {
    playClick();
    elCreateError.style.display = 'none';
    panelCreate.classList.add('hidden');
    panelChar.classList.remove('hidden');
  });
});
