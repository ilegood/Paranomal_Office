(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 키보드(WASD 이동, Space 대시, E 상호작용, 1/2 무기 전환) 및 마우스(조준 좌표, 좌클릭 공격) 입력 관리
   */
  class InputManager {
    constructor(targetWindow = window) {
      this.targetWindow = targetWindow;
      this.keys = {
        up: false,
        down: false,
        left: false,
        right: false,
        dash: false,
        interact: false
      };

      // 대시 단발 입력 버퍼 (Space 키)
      this.dashBuffered = false;

      // 아이템 상호작용 단발 입력 버퍼 (E 키)
      this.interactBuffered = false;

      // 마우스 조준 및 좌클릭 공격 상태
      this.mouse = {
        clientX: 0,
        clientY: 0,
        hasPosition: false,
        dirty: false,
        leftDown: false,
        attackBuffered: false
      };

      // 무기 전환 요청 슬롯 (1 또는 2)
      this.pendingWeaponSlot = null;

      this._onKeyDown = this._handleKeyDown.bind(this);
      this._onKeyUp = this._handleKeyUp.bind(this);
      this._onMouseMove = this._handleMouseMove.bind(this);
      this._onMouseDown = this._handleMouseDown.bind(this);
      this._onMouseUp = this._handleMouseUp.bind(this);
      this._onReset = this.reset.bind(this);

      this.bindEvents();
    }

    bindEvents() {
      this.targetWindow.addEventListener('keydown', this._onKeyDown);
      this.targetWindow.addEventListener('keyup', this._onKeyUp);
      this.targetWindow.addEventListener('mousemove', this._onMouseMove);
      this.targetWindow.addEventListener('mousedown', this._onMouseDown);
      this.targetWindow.addEventListener('mouseup', this._onMouseUp);
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
    _resolveMoveAction(event) {
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

    /**
     * E 키(아이템 상호작용) 판별 (한글 'ㄷ'/'ㄸ' 상태 호환 포함)
     */
    _isInteractKey(event) {
      if (event.code === 'KeyE') {
        return true;
      }
      const key = (event.key || '').toLowerCase();
      return key === 'e' || key === 'ㄷ' || key === 'ㄸ';
    }

    /**
     * 숫자 1 / 2 무기 전환 키 판별
     */
    _resolveWeaponSlot(event) {
      if (event.code === 'Digit1' || event.code === 'Numpad1' || event.key === '1') {
        return 1;
      }
      if (event.code === 'Digit2' || event.code === 'Numpad2' || event.key === '2') {
        return 2;
      }
      return null;
    }

    _handleKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (event.code === 'Space' || event.key === ' ') {
        event.preventDefault();
        this.keys.dash = true;
        if (!event.repeat) {
          this.dashBuffered = true;
        }
        return;
      }

      if (this._isInteractKey(event)) {
        event.preventDefault();
        this.keys.interact = true;
        if (!event.repeat) {
          this.interactBuffered = true;
        }
        return;
      }

      const slot = this._resolveWeaponSlot(event);
      if (slot !== null) {
        event.preventDefault();
        this.pendingWeaponSlot = slot;
        return;
      }

      const action = this._resolveMoveAction(event);
      if (!action) {
        return;
      }

      event.preventDefault();
      this.keys[action] = true;
    }

    _handleKeyUp(event) {
      if (event.code === 'Space' || event.key === ' ') {
        this.keys.dash = false;
        return;
      }

      if (this._isInteractKey(event)) {
        this.keys.interact = false;
        return;
      }

      const action = this._resolveMoveAction(event);
      if (!action) {
        return;
      }

      this.keys[action] = false;
    }

    _handleMouseMove(event) {
      this.mouse.clientX = event.clientX;
      this.mouse.clientY = event.clientY;
      this.mouse.hasPosition = true;
      this.mouse.dirty = true;
    }

    _handleMouseDown(event) {
      if (event.button !== 0) {
        return;
      }

      this.mouse.clientX = event.clientX;
      this.mouse.clientY = event.clientY;
      this.mouse.hasPosition = true;
      this.mouse.dirty = true;
      this.mouse.leftDown = true;
      this.mouse.attackBuffered = true;
    }

    _handleMouseUp(event) {
      if (event.button !== 0) {
        return;
      }

      this.mouse.leftDown = false;
    }

    reset() {
      this.keys.up = false;
      this.keys.down = false;
      this.keys.left = false;
      this.keys.right = false;
      this.keys.dash = false;
      this.keys.interact = false;
      this.dashBuffered = false;
      this.interactBuffered = false;
      this.mouse.leftDown = false;
      this.mouse.attackBuffered = false;
      this.pendingWeaponSlot = null;
    }

    /**
     * Space 대시 입력이 있었는지 확인하고 버퍼를 소비
     */
    consumeDashInput() {
      const triggered = this.dashBuffered;
      this.dashBuffered = false;
      return triggered;
    }

    /**
     * E 아이템 상호작용 단발 입력이 있었는지 확인하고 버퍼를 소비
     */
    consumeInteractInput() {
      const triggered = this.interactBuffered;
      this.interactBuffered = false;
      return triggered;
    }

    /**
     * 무기 전환 입력이 있었다면 슬롯 번호(1 또는 2)를 반환하고 초기화
     */
    consumeWeaponSwitch() {
      const slot = this.pendingWeaponSlot;
      this.pendingWeaponSlot = null;
      return slot;
    }

    /**
     * 새로운 마우스 이동/클릭 이벤트가 발생했는지 확인하고 플래그 소비
     */
    consumeMouseDirty() {
      const wasDirty = this.mouse.dirty;
      this.mouse.dirty = false;
      return wasDirty;
    }

    /**
     * 마우스 좌클릭 공격 입력 여부 반환 (짧은 단발 클릭 버퍼 소비 포함)
     */
    consumeAttackInput() {
      const triggered = this.mouse.leftDown || this.mouse.attackBuffered;
      this.mouse.attackBuffered = false;
      return triggered;
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
        right: this.keys.right,
        dash: this.keys.dash,
        interact: this.keys.interact,
        leftClick: this.mouse.leftDown
      };
    }
  }

  PO.InputManager = InputManager;
})(window);
