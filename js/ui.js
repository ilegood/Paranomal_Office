(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * HUD UI(체력 바, WASD 조작 표시, 장착 무기/공격 방식/탄약/쿨다운 상태)를 실제 게임 데이터와 동기화하는 모듈
   */
  class UIManager {
    constructor() {
      this.hpTextEl = document.getElementById('hp-text');
      this.hpBarFillEl = document.getElementById('hp-bar-fill');

      this.keyEls = {
        up: document.getElementById('key-w'),
        left: document.getElementById('key-a'),
        down: document.getElementById('key-s'),
        right: document.getElementById('key-d')
      };

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
        right: false
      };

      this._lastWeaponSlot = null;
      this._lastAmmo = null;
      this._lastUsesAmmo = null;
      this._lastCooldownText = null;
      this._lastCooldownPercent = null;
    }

    /**
     * 플레이어의 체력, 입력 상태, 무기/공격 상태를 UI에 반영
     */
    update(player, inputState, combatUIState = null) {
      this._syncHealth(player.hp, player.maxHp);
      if (inputState) {
        this._syncKeys(inputState);
      }
      if (combatUIState) {
        this._syncCombat(combatUIState);
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
      const directions = ['up', 'left', 'down', 'right'];
      for (let i = 0; i < directions.length; i++) {
        const dir = directions[i];
        const pressed = Boolean(state[dir]);
        if (pressed !== this._lastKeyState[dir]) {
          this._lastKeyState[dir] = pressed;
          const el = this.keyEls[dir];
          if (el) {
            el.classList.toggle('is-pressed', pressed);
          }
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
