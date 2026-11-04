(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 키보드 WASD 입력을 관리하고 정규화된 이동 방향 벡터를 반환하는 클래스
   */
  class InputManager {
    constructor(targetWindow = window) {
      this.targetWindow = targetWindow;
      this.keys = {
        up: false,
        down: false,
        left: false,
        right: false
      };

      this._onKeyDown = this._handleKeyDown.bind(this);
      this._onKeyUp = this._handleKeyUp.bind(this);
      this._onReset = this.reset.bind(this);

      this.bindEvents();
    }

    bindEvents() {
      this.targetWindow.addEventListener('keydown', this._onKeyDown);
      this.targetWindow.addEventListener('keyup', this._onKeyUp);
      this.targetWindow.addEventListener('blur', this._onReset);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.reset();
        }
      });
    }

    /**
     * 물리 키 코드(event.code)와 문자(event.key) 모두 지원하여
     * 한글 입력(한/영 전환)이나 CapsLock 상태에서도 WASD가 정상 동작하도록 처리
     */
    _resolveAction(event) {
      switch (event.code) {
        case 'KeyW':
          return 'up';
        case 'KeyS':
          return 'down';
        case 'KeyA':
          return 'left';
        case 'KeyD':
          return 'right';
        default:
          break;
      }

      const key = (event.key || '').toLowerCase();
      switch (key) {
        case 'w':
        case 'ㅈ':
          return 'up';
        case 's':
        case 'ㄴ':
          return 'down';
        case 'a':
        case 'ㅁ':
          return 'left';
        case 'd':
        case 'ㅇ':
          return 'right';
        default:
          return null;
      }
    }

    _handleKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const action = this._resolveAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();
      this.keys[action] = true;
    }

    _handleKeyUp(event) {
      const action = this._resolveAction(event);
      if (!action) {
        return;
      }

      this.keys[action] = false;
    }

    reset() {
      this.keys.up = false;
      this.keys.down = false;
      this.keys.left = false;
      this.keys.right = false;
    }

    /**
     * 대각선 이동 시에도 크기가 1이 되도록 정규화된 2D 이동 벡터를 반환
     */
    getMoveVector() {
      const rawX = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      const rawY = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);

      if (rawX === 0 && rawY === 0) {
        return { x: 0, y: 0 };
      }

      const length = Math.hypot(rawX, rawY);
      return {
        x: rawX / length,
        y: rawY / length
      };
    }

    getState() {
      return {
        up: this.keys.up,
        down: this.keys.down,
        left: this.keys.left,
        right: this.keys.right
      };
    }
  }

  PO.InputManager = InputManager;
})(window);

