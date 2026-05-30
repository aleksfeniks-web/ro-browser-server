/**
 * WebRO - Network Controller & Client Protocol
 */
class Network {
  constructor(game) {
    this.game = game;
    this.ws = null;
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socketUrl = `${protocol}//${window.location.host}`;
    this.ws = new WebSocket(socketUrl);

    this.ws.onopen = () => {
      console.log('Conexión del juego establecida.');
      
      // Solicitar entrar al juego con el ID cargado en launcher
      const charId = parseInt(sessionStorage.getItem('charId'));
      if (!charId) {
        window.location.href = 'index.html';
        return;
      }

      this.send({
        type: 'enter_game_request',
        charId
      });
    };

    this.ws.onclose = () => {
      console.log('Juego desconectado del servidor.');
      // Volver a selección tras desconexión
      alert('Se ha perdido la conexión con el servidor.');
      window.location.href = 'index.html';
    };

    this.ws.onmessage = (event) => {
      let packet;
      try {
        packet = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      this.handlePacket(packet);
    };
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handlePacket(packet) {
    switch (packet.type) {
      case 'enter_game_response': {
        if (!packet.success) {
          alert('Error al entrar al juego: No se pudo cargar el personaje. Asegúrate de haber ejecutado el archivo schema.sql en Neon.tech y que la base de datos esté lista.');
          window.location.href = 'index.html';
        }
        break;
      }

      case 'game_init': {
        // Inicializar datos del jugador local
        this.game.localPlayer = packet.char;
        this.game.itemsDb = packet.items_db;
        
        // Configurar posición inicial de la cámara
        if (this.game.loading) {
          this.game.camera.currentX = packet.char.x;
          this.game.camera.currentY = packet.char.y;
          this.game.camera.x = packet.char.x;
          this.game.camera.y = packet.char.y;
        }

        // Actualizar HUD
        if (window.UI) {
          window.UI.updateHUD(packet.char);
          window.UI.renderInventory(packet.char.inventory, packet.items_db);
          window.UI.renderSkills(packet.char);
        }

        // Finalizar pantalla de carga tras primer spawn
        setTimeout(() => {
          this.game.loading = false;
          const overlay = document.getElementById('loading-overlay');
          if (overlay) overlay.style.opacity = 0;
          setTimeout(() => { if (overlay) overlay.classList.add('hidden'); }, 500);
        }, 800);
        break;
      }

      case 'spawn_entities': {
        packet.entities.forEach(ent => {
          // Si es el jugador local, actualizar sus datos pero no duplicar en lista de otras entidades
          if (this.game.localPlayer && ent.id === this.game.localPlayer.id) {
            this.game.localPlayer.x = ent.x;
            this.game.localPlayer.y = ent.y;
            this.game.localPlayer.speed = ent.speed;
            this.game.localPlayer.equipment = this.game.localPlayer.equipment || {};
            this.game.localPlayer.equipment.headgear = ent.headgear;
            return;
          }

          // Crear entidad local
          const existing = this.game.entities[ent.id];
          if (existing) {
            // Actualizar datos
            existing.x = ent.x;
            existing.y = ent.y;
            existing.hp = ent.hp;
            existing.maxHp = ent.maxHp;
            existing.speed = ent.speed;
            existing.state = ent.state || 'idle';
            if (ent.type === 'player') {
              existing.headgear = ent.headgear;
              existing.job = ent.job;
            }
          } else {
            // Nueva entidad
            this.game.entities[ent.id] = {
              ...ent,
              targetX: ent.x,
              targetY: ent.y,
              startX: ent.x,
              startY: ent.y,
              lerpProgress: 1,
              animFrame: 0,
              animTime: 0,
              chatBubble: null,
              chatBubbleTime: 0
            };
          }
        });
        break;
      }

      case 'despawn_entity': {
        const ent = this.game.entities[packet.id];
        if (ent && this.game.removeEntity3D) {
          this.game.removeEntity3D(ent);
        }
        delete this.game.entities[packet.id];
        // Quitar objetivo si es que era nuestro blanco
        if (this.game.selectedTargetId === packet.id) {
          this.game.selectedTargetId = null;
        }
        break;
      }

      case 'entity_move': {
        const entId = packet.id;
        let ent = null;

        if (this.game.localPlayer && entId === this.game.localPlayer.id) {
          ent = this.game.localPlayer;
        } else {
          ent = this.game.entities[entId];
        }

        if (ent) {
          ent.targetX = packet.x;
          ent.targetY = packet.y;
          ent.startX = ent.x;
          ent.startY = ent.y;
          ent.lerpProgress = 0;
          ent.speed = packet.speed || ent.speed;
          ent.state = 'moving';
        }
        break;
      }

      case 'damage_pop': {
        const { targetId, attackerId, damage, isCrit, isMiss, heal, dead } = packet;
        let targetEnt = null;

        if (this.game.localPlayer && targetId === this.game.localPlayer.id) {
          targetEnt = this.game.localPlayer;
        } else {
          targetEnt = this.game.entities[targetId];
        }

        if (targetEnt) {
          if (damage > 0 && !heal) {
            targetEnt.hp = Math.max(0, targetEnt.hp - damage);
            
            // Spawnear efecto visual de chispa/corte de golpe clásico
            this.game.particleEffects.push({
              x: targetEnt.x,
              y: targetEnt.y,
              color: isCrit ? '#facc15' : '#ef4444',
              life: 0.25,
              type: 'hit_spark'
            });
          } else if (heal) {
            targetEnt.hp = Math.min(targetEnt.maxHp, targetEnt.hp + damage);
          }

          // Crear flotante de daño
          this.game.damagePops.push({
            x: targetEnt.x,
            y: targetEnt.y,
            text: isMiss ? 'MISS' : damage,
            isCrit,
            isMiss,
            heal,
            life: 1.0, // Va disminuyendo para desvanecerse
            vy: -1.5  // Velocidad de flotación
          });

          // Reproducir efectos de sonido correspondientes
          if (window.soundManager) {
            if (heal) {
              window.soundManager.playHeal();
            } else if (isMiss) {
              // Miss sound (no sound o ligero aire)
            } else {
              if (targetId === this.game.localPlayer.id) {
                window.soundManager.playHit(); // Daño recibido
              } else {
                window.soundManager.playAttack(); // Daño causado
              }
            }
          }
        }
        break;
      }

      case 'skill_effect': {
        const { targetId, skillName, effectColor } = packet;
        let ent = null;
        if (this.game.localPlayer && targetId === this.game.localPlayer.id) {
          ent = this.game.localPlayer;
        } else {
          ent = this.game.entities[targetId];
        }

        if (ent) {
          // Agregar un efecto de partículas mágicas en la posición de la entidad
          this.game.particleEffects.push({
            x: ent.x,
            y: ent.y,
            color: effectColor || '#ffcc00',
            life: 1.0,
            type: skillName
          });

          // Reproducir sonido clásico sintetizado
          if (window.soundManager) {
            if (skillName === 'heal' || skillName === 'heal_potion') {
              window.soundManager.playHeal();
            } else {
              window.soundManager.playTeleport(); // Sonido alternativo de magia
            }
          }
        }
        break;
      }

      case 'chat_message': {
        const { senderId, sender, message, system } = packet;
        
        // Agregar a la consola de chat
        if (window.UI) {
          window.UI.appendChatLog(sender, message, system);
        }

        // Agregar burbuja de chat sobre el personaje si no es de sistema
        if (!system) {
          let ent = null;
          if (this.game.localPlayer && senderId === this.game.localPlayer.id) {
            ent = this.game.localPlayer;
          } else {
            ent = this.game.entities[senderId];
          }

          if (ent) {
            ent.chatBubble = message;
            ent.chatBubbleTime = 4.0; // 4 segundos visible
          }
        }
        break;
      }

      case 'level_up': {
        const { id, name, baseLevel, jobLevel } = packet;
        let ent = null;
        if (this.game.localPlayer && id === this.game.localPlayer.id) {
          ent = this.game.localPlayer;
          ent.baseLevel = baseLevel;
          ent.jobLevel = jobLevel;
        } else {
          ent = this.game.entities[id];
          if (ent) {
            ent.baseLevel = baseLevel;
            ent.jobLevel = jobLevel;
          }
        }

        if (ent) {
          // Agregar animación icónica del Level Up! (alas doradas/halo de luz azul)
          this.game.particleEffects.push({
            x: ent.x,
            y: ent.y,
            color: '#ffd700',
            life: 1.5,
            type: 'level_up'
          });

          // Reproducir sonido icónico sintetizado de Level Up
          if (window.soundManager) {
            window.soundManager.playLevelUp();
          }

          if (window.UI) {
            window.UI.appendChatLog("Sistema", `¡${name} ha subido de nivel!`, true);
          }
        }
        break;
      }

      case 'update_self_stats': {
        if (this.game.localPlayer) {
          this.game.localPlayer.hp = packet.hp;
          this.game.localPlayer.sp = packet.sp;
          if (window.UI) {
            window.UI.updateHUD(this.game.localPlayer);
          }
        }
        break;
      }

      case 'map_change': {
        // Iniciar pantalla de carga
        this.game.loading = true;
        const overlay = document.getElementById('loading-overlay');
        const loadStatus = document.getElementById('load-status');
        if (overlay) {
          overlay.classList.remove('hidden');
          overlay.style.opacity = 1;
        }
        if (loadStatus) {
          loadStatus.textContent = 'Teletransportando...';
        }

        // Limpiar todas las entidades del mapa anterior en 3D y memoria
        if (this.game.clearAllEntities3D) {
          this.game.clearAllEntities3D();
        }
        this.game.entities = {};
        this.game.selectedTargetId = null;
        this.game.damagePops = [];
        this.game.particleEffects = [];

        // Cambiar mapa en renderizador
        this.game.map.setMapData(packet.mapData);
        this.game.localPlayer.map = packet.mapName;
        this.game.localPlayer.x = packet.x;
        this.game.localPlayer.y = packet.y;

        // Foco de la cámara
        this.game.camera.currentX = packet.x;
        this.game.camera.currentY = packet.y;
        this.game.camera.x = packet.x;
        this.game.camera.y = packet.y;

        // Sonido de warp
        if (window.soundManager) {
          window.soundManager.playTeleport();
        }

        // Ocultar pantalla de carga
        setTimeout(() => {
          this.game.loading = false;
          if (overlay) overlay.style.opacity = 0;
          setTimeout(() => { if (overlay) overlay.classList.add('hidden'); }, 500);
        }, 800);
        break;
      }

      case 'system_message': {
        if (window.UI) {
          window.UI.appendChatLog("Sistema", packet.message, true);
        }
        break;
      }
    }
  }

  sendMove(path) {
    this.send({
      type: 'player_move',
      path
    });
  }

  sendAttack(targetId) {
    this.send({
      type: 'player_attack',
      targetId
    });
  }

  sendUseItem(itemId) {
    this.send({
      type: 'use_item',
      itemId
    });
  }

  sendAddStat(stat) {
    this.send({
      type: 'add_stat',
      stat
    });
  }

  sendLearnSkill(skill) {
    this.send({
      type: 'learn_skill',
      skill
    });
  }

  sendCastSkill(skill, targetId) {
    this.send({
      type: 'cast_skill',
      skill,
      targetId
    });
  }

  sendChat(message) {
    this.send({
      type: 'chat_message',
      message
    });
  }
}

// Exportar globalmente
window.Network = Network;
