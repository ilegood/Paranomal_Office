(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 게임 초기화 및 메인 업데이트/렌더링 루프 관리
   */
  class Game {
    constructor() {
      this.stageElement = document.getElementById('game-stage');
      this.canvas = document.getElementById('game-canvas');

      if (!this.stageElement || !this.canvas) {
        throw new Error('필수 게임 DOM 요소(#game-stage, #game-canvas)를 찾을 수 없습니다.');
      }

      // 모듈 초기화
      this.map = new PO.OfficeMap();
      this.player = new PO.Player({
        x: this.map.spawnPoint.x,
        y: this.map.spawnPoint.y,
        speed: 260,
        hp: 100,
        maxHp: 100
      });
      this.input = new PO.InputManager(window);
      this.movement = new PO.MovementSystem();
      this.combat = new PO.CombatSystem(PO.CombatSystem.createDefaultTargets());
      this.renderer = new PO.Renderer(this.canvas, this.stageElement, this.map);
      this.ui = new PO.UIManager();

      // 마우스 월드 조준 좌표 (마우스 입력 전에는 null)
      this.aimWorld = null;

      this.isRunning = false;
      this._lastTimestamp = 0;
      this._rafId = null;
      this._boundTick = this._tick.bind(this);
    }

    start() {
      if (this.isRunning) {
        return;
      }

      this.isRunning = true;
      this._lastTimestamp = performance.now();

      // 첫 프레임 즉시 동기화 및 렌더링
      this.ui.update(this.player, this.input.getState(), this.combat.getUIState());
      this.renderer.render(this.map, this.player, this.combat, this.aimWorld);

      this._rafId = requestAnimationFrame(this._boundTick);
    }

    stop() {
      this.isRunning = false;
      if (this._rafId !== null) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
    }

    _tick(timestamp) {
      if (!this.isRunning) {
        return;
      }

      // 탭 전환 시 과도한 dt 점프를 방지하기 위해 최대 50ms로 제한
      const rawDt = (timestamp - this._lastTimestamp) / 1000;
      const dt = Math.max(0, Math.min(rawDt, 0.05));
      this._lastTimestamp = timestamp;

      this.update(dt);
      this.render();

      this._rafId = requestAnimationFrame(this._boundTick);
    }

    /**
     * 마우스 커서의 화면 좌표를 월드 좌표로 변환하여 플레이어 조준 방향 갱신
     */
    _updateAimFromMouse() {
      if (!this.input.mouse.hasPosition) {
        return;
      }

      if (this.input.consumeMouseDirty() || this.aimWorld === null) {
        const rawWorld = this.renderer.screenToWorld(
          this.input.mouse.clientX,
          this.input.mouse.clientY
        );
        this.aimWorld = {
          x: Math.max(0, Math.min(this.map.width, rawWorld.x)),
          y: Math.max(0, Math.min(this.map.height, rawWorld.y))
        };
      }

      const aimOrigin = this.player.getAimOrigin();
      this.player.setDirection(this.aimWorld.x - aimOrigin.x, this.aimWorld.y - aimOrigin.y);
    }

    update(dt) {
      // 1. 무기 전환 입력 처리 (1: 근접 스테이플러, 2: 원거리 권총)
      const requestedSlot = this.input.consumeWeaponSwitch();
      if (requestedSlot !== null) {
        this.combat.switchWeapon(requestedSlot);
      }

      // 2. WASD 플레이어 이동 및 벽/장애물/타겟 충돌 처리
      const moveVector = this.input.getMoveVector();
      this.movement.update(this.player, moveVector, this.map, dt, {
        updateDirection: !this.input.mouse.hasPosition,
        circleBlockers: this.combat.targets
      });

      // 3. 마우스 커서 방향 조준 갱신 (이동 후 플레이어 최신 좌표 기준으로 조준각 계산)
      this._updateAimFromMouse();

      // 4. 공격 판정, 투사체 이동/벽 충돌, 쿨다운, 타겟 피격 업데이트
      const shouldAttack = this.input.consumeAttackInput();
      this.combat.update(dt, this.player, this.map, shouldAttack);

      // 5. UI 동기화
      this.ui.update(this.player, this.input.getState(), this.combat.getUIState());
    }

    render() {
      this.renderer.render(this.map, this.player, this.combat, this.aimWorld);
    }
  }

  PO.Game = Game;

  // DOM 로드 완료 후 게임 자동 시작
  function bootstrap() {
    const game = new Game();
    PO.gameInstance = game;
    game.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})(window);
