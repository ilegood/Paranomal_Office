(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * HUD UI(체력 바, WASD/Space 조작 표시, 대시 상태, 장착 무기/공격 방식/탄약/쿨다운 상태) 동기화 모듈
   */
  class UIManager {
    constructor() {
      this.hpTextEl = document.getElementById('hp-text');
      this.hpBarFillEl = document.getElementById('hp-bar-fill');

      this.keyEls = {
        up: document.getElementById('key-w'),
        left: document.getElementById('key-a'),
        down: document.getElementById('key-s'),
        right: document.getElementById('key-d'),
        dash: document.getElementById('key-space')
      };

      // 대시 UI 요소
      this.dashPanelEl = document.getElementById('dash-panel');
      this.dashStatusTextEl = document.getElementById('dash-status-text');
      this.dashFillEl = document.getElementById('dash-cooldown-fill');

      // 공격/무기 UI 요소
      this.slotTab1El = document.getElementById('slot-tab-1');
      this.slotTab2El = document.getElementById('slot-tab-2');
      this.weaponNameEl = document.getElementById('weapon-name');
      this.weaponModeEl = document.getElementById('weapon-mode');
      this.weaponAmmoRowEl = document.getElementById('weapon-ammo-row');
      this.weaponAmmoEl = document.getElementById('weapon-ammo');
      this.cooldownTextEl = document.getElementById('weapon-cooldown-text');
      this.cooldownFillEl = document.getElementById('weapon-cooldown-fill');

      this._lastHp = null;
      this._lastMaxHp = null;
      this._lastKeyState = {
        up: false,
        left: false,
        down: false,
        right: false,
        dash: false
      };

      this._lastDashLabel = null;
      this._lastDashPercent = null;
      this._lastDashMode = null;

      this._lastWeaponSlot = null;
      this._lastAmmo = null;
      this._lastUsesAmmo = null;
      this._lastCooldownText = null;
      this._lastCooldownPercent = null;
    }

    /**
     * 플레이어의 체력, 입력 상태, 무기/공격 상태, 대시 상태를 UI에 반영
     */
    update(player, inputState, combatUIState = null, dashUIState = null) {
      this._syncHealth(player.hp, player.maxHp);
      if (inputState) {
        this._syncKeys(inputState);
      }
      if (combatUIState) {
        this._syncCombat(combatUIState);
      }
      const effectiveDashState = dashUIState || (player.getDashUIState ? player.getDashUIState() : null);
      if (effectiveDashState) {
        this._syncDash(effectiveDashState);
      }
    }

    _syncHealth(hp, maxHp) {
      const safeMax = Math.max(1, maxHp);
      const safeHp = Math.max(0, Math.min(safeMax, hp));

      if (safeHp === this._lastHp && safeMax === this._lastMaxHp) {
        return;
      }

      this._lastHp = safeHp;
      this._lastMaxHp = safeMax;

      const percent = (safeHp / safeMax) * 100;

      if (this.hpTextEl) {
        this.hpTextEl.textContent = `${safeHp} / ${safeMax}`;
      }
      if (this.hpBarFillEl) {
        this.hpBarFillEl.style.width = `${percent}%`;
      }
    }

    _syncKeys(state) {
      const keys = ['up', 'left', 'down', 'right', 'dash'];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const pressed = Boolean(state[k]);
        if (pressed !== this._lastKeyState[k]) {
          this._lastKeyState[k] = pressed;
          const el = this.keyEls[k];
          if (el) {
            el.classList.toggle('is-pressed', pressed);
          }
        }
      }
    }

    _syncDash(dashState) {
      let label = '사용 가능';
      let mode = 'ready';
      let percent = 100;

      if (dashState.isDashing) {
        label = '대시 중!';
        mode = 'dashing';
        percent = 100;
      } else if (!dashState.canDash && dashState.cooldownRemaining > 0.005) {
        label = `쿨다운 ${dashState.cooldownRemaining.toFixed(2)}s`;
        mode = 'cooling';
        percent = Math.round(dashState.cooldownRatio * 100);
      }

      if (label !== this._lastDashLabel) {
        this._lastDashLabel = label;
        if (this.dashStatusTextEl) {
          this.dashStatusTextEl.textContent = label;
        }
      }

      if (mode !== this._lastDashMode) {
        this._lastDashMode = mode;
        if (this.dashPanelEl) {
          this.dashPanelEl.classList.toggle('is-dashing', mode === 'dashing');
        }
        if (this.dashStatusTextEl) {
          this.dashStatusTextEl.classList.toggle('is-ready', mode === 'ready');
          this.dashStatusTextEl.classList.toggle('is-dashing', mode === 'dashing');
        }
        if (this.dashFillEl) {
          this.dashFillEl.classList.toggle('is-ready', mode === 'ready');
          this.dashFillEl.classList.toggle('is-dashing', mode === 'dashing');
        }
      }

      if (percent !== this._lastDashPercent) {
        this._lastDashPercent = percent;
        if (this.dashFillEl) {
          this.dashFillEl.style.width = `${percent}%`;
        }
      }
    }

    _syncCombat(combatState) {
      // 1. 장착 무기 슬롯, 이름, 공격 방식 갱신
      if (combatState.slot !== this._lastWeaponSlot) {
        this._lastWeaponSlot = combatState.slot;

        if (this.slotTab1El) {
          this.slotTab1El.classList.toggle('is-active', combatState.slot === 1);
        }
        if (this.slotTab2El) {
          this.slotTab2El.classList.toggle('is-active', combatState.slot === 2);
        }
        if (this.weaponNameEl) {
          this.weaponNameEl.textContent = combatState.weaponName;
        }
        if (this.weaponModeEl) {
          this.weaponModeEl.textContent = combatState.attackModeText;
        }
      }

      // 2. 탄약 UI 표시 여부 및 잔탄 수 갱신 (근접 무기는 탄약 UI를 표시하지 않음)
      if (combatState.usesAmmo !== this._lastUsesAmmo) {
        this._lastUsesAmmo = combatState.usesAmmo;
        if (this.weaponAmmoRowEl) {
          this.weaponAmmoRowEl.hidden = !combatState.usesAmmo;
        }
      }

      if (combatState.usesAmmo && combatState.ammo !== this._lastAmmo) {
        this._lastAmmo = combatState.ammo;
        if (this.weaponAmmoEl) {
          this.weaponAmmoEl.textContent = `${combatState.ammo} / ${combatState.maxAmmo}`;
          this.weaponAmmoEl.classList.toggle('is-empty', combatState.ammo <= 0);
        }
      }

      // 3. 공격 쿨다운 상태 텍스트 및 게이지 갱신
      let cooldownLabel = '공격 가능';
      let stateClass = 'ready';

      if (combatState.cooldownRemaining > 0.005) {
        cooldownLabel = `쿨다운 ${combatState.cooldownRemaining.toFixed(2)}s`;
        stateClass = 'cooling';
      } else if (combatState.usesAmmo && combatState.ammo <= 0) {
        cooldownLabel = '탄약 소진';
        stateClass = 'empty';
      }

      if (cooldownLabel !== this._lastCooldownText) {
        this._lastCooldownText = cooldownLabel;
        if (this.cooldownTextEl) {
          this.cooldownTextEl.textContent = cooldownLabel;
          this.cooldownTextEl.classList.toggle('is-ready', stateClass === 'ready');
          this.cooldownTextEl.classList.toggle('is-empty', stateClass === 'empty');
        }
      }

      const percent = Math.round(combatState.cooldownRatio * 100);
      if (percent !== this._lastCooldownPercent) {
        this._lastCooldownPercent = percent;
        if (this.cooldownFillEl) {
          this.cooldownFillEl.style.width = `${percent}%`;
          this.cooldownFillEl.classList.toggle('is-ready', combatState.cooldownRemaining <= 0.005);
        }
      }
    }
  }

  PO.UIManager = UIManager;
})(window);
