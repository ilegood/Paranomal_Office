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
      this.renderer = new PO.Renderer(this.canvas, this.stageElement, this.map);
      this.ui = new PO.UIManager();

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
      this.ui.update(this.player, this.input.getState());
      this.renderer.render(this.map, this.player);

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

    update(dt) {
      const moveVector = this.input.getMoveVector();
      this.movement.update(this.player, moveVector, this.map, dt);
      this.ui.update(this.player, this.input.getState());
    }

    render() {
      this.renderer.render(this.map, this.player);
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

