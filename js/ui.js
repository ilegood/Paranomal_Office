(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 기본 HUD UI(체력 바, 체력 수치, WASD 조작 표시)를 실제 게임 데이터와 동기화하는 모듈
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

      this._lastHp = null;
      this._lastMaxHp = null;
      this._lastKeyState = {
        up: false,
        left: false,
        down: false,
        right: false
      };
    }

    /**
     * 플레이어의 실제 체력 데이터 및 입력 상태를 UI에 반영
     */
    update(player, inputState) {
      this._syncHealth(player.hp, player.maxHp);
      if (inputState) {
        this._syncKeys(inputState);
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
  }

  PO.UIManager = UIManager;
})(window);

