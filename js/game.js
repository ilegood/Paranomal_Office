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

      // 핵심 모듈 초기화
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

      // 대시 무적 판정 검증용 임시 위험 구역 (코어 시스템과 분리, 미로드 시 자동 생략)
      this.testHazard = PO.TestDamageZone ? new PO.TestDamageZone() : null;

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
      this.ui.update(
        this.player,
        this.input.getState(),
        this.combat.getUIState(),
        this.player.getDashUIState()
      );
      this.renderer.render(this.map, this.player, this.combat, this.aimWorld, this.testHazard);

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

      // 2. 대시 전 최신 마우스 조준 방향 반영 (이동 입력 없을 때 조준 방향으로 대시하기 위함)
      this._updateAimFromMouse();

      // 3. Space 대시 시작 입력 처리
      const moveVector = this.input.getMoveVector();
      if (this.input.consumeDashInput()) {
        this.movement.tryStartDash(this.player, moveVector);
      }

      // 4. 대시 이동 / 일반 WASD 이동 및 벽·장애물·타겟 충돌 처리
      this.movement.update(this.player, moveVector, this.map, dt, {
        updateDirection: !this.input.mouse.hasPosition,
        circleBlockers: this.combat.targets
      });

      // 5. 플레이어 상태 타이머(대시 쿨다운 1.2s, 무적 시간 0.25s, 잔상 수명) 업데이트
      this.player.updateStatusTimers(dt);

      // 6. 이동 완료 후 플레이어 최신 좌표 기준으로 조준각 재보정
      this._updateAimFromMouse();

      // 7. 공격 판정, 투사체 이동/벽 충돌, 쿨다운, 타겟 피격 업데이트
      const shouldAttack = this.input.consumeAttackInput();
      this.combat.update(dt, this.player, this.map, shouldAttack);

      // 8. 임시 무적 테스트용 위험 구역 판정 (분리된 선택 모듈)
      if (this.testHazard) {
        this.testHazard.update(dt, this.player);
      }

      // 9. UI 동기화
      this.ui.update(
        this.player,
        this.input.getState(),
        this.combat.getUIState(),
        this.player.getDashUIState()
      );
    }

    render() {
      this.renderer.render(this.map, this.player, this.combat, this.aimWorld, this.testHazard);
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
