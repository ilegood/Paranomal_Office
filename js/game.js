(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 게임 초기화, 재시작 및 메인 업데이트/렌더링 루프 관리
   */
  class Game {
    constructor() {
      this.stageElement = document.getElementById('game-stage');
      this.canvas = document.getElementById('game-canvas');

      if (!this.stageElement || !this.canvas) {
        throw new Error('필수 게임 DOM 요소(#game-stage, #game-canvas)를 찾을 수 없습니다.');
      }

      // 고정 맵 및 입출력/렌더링/UI 모듈 초기화
      this.map = new PO.OfficeMap();
      this.input = new PO.InputManager(window);
      this.movement = new PO.MovementSystem();
      this.renderer = new PO.Renderer(this.canvas, this.stageElement, this.map);
      this.ui = new PO.UIManager();

      // 마우스 월드 조준 좌표 (마우스 입력 전에는 null)
      this.aimWorld = null;
      this.isGameOver = false;

      // 플레이어, 피해 시스템, 적, 전투 타겟, 맵 아이템 등 런타임 상태 초기화
      this._initRunState();

      // 게임 오버 화면의 재시작 버튼 이벤트 연결
      this.ui.bindRestart(() => this.restart());

      this.isRunning = false;
      this._lastTimestamp = 0;
      this._rafId = null;
      this._boundTick = this._tick.bind(this);
    }

    /**
     * 테스트 맵의 플레이어, 피해 처리 시스템, 적, 전투(무기 강화 포함), 아이템 상태를 초기 상태로 생성/재설정
     */
    _initRunState() {
      this.isGameOver = false;

      this.player = new PO.Player({
        x: this.map.spawnPoint.x,
        y: this.map.spawnPoint.y,
        speed: 260,
        hp: 100,
        maxHp: 100
      });

      this.playerDamage = new PO.PlayerDamageSystem({
        onPlayerDeath: () => this._handlePlayerDeath()
      });

      this.enemies = new PO.EnemySystem(
        PO.EnemySystem.createDefaultEnemies(this.player.speed)
      );

      this.combat = new PO.CombatSystem(PO.CombatSystem.createDefaultTargets());

      this.items = PO.ItemSystem
        ? new PO.ItemSystem(PO.ItemSystem.createDefaultMapItems())
        : null;

      // 대시 무적 판정 검증용 임시 위험 구역 (코어 시스템과 분리, 미로드 시 자동 생략)
      this.testHazard = PO.TestDamageZone ? new PO.TestDamageZone() : null;
    }

    /**
     * 플레이어 사망(체력 0 이하) 전환 시 입력 초기화 및 게임 오버 상태 활성화
     */
    _handlePlayerDeath() {
      if (this.isGameOver) {
        return;
      }
      this.isGameOver = true;
      this.input.reset();
    }

    /**
     * 테스트 맵을 초기 상태로 다시 시작 (아이템 및 무기 강화 단계 모두 초기화)
     */
    restart() {
      this.input.reset();
      this._initRunState();

      if (this.input.mouse.hasPosition) {
        this.input.mouse.dirty = true;
        this._updateAimFromMouse();
      } else {
        this.aimWorld = null;
      }

      if (this.items) {
        this.items.update(0, this.player, this.combat, this.map);
      }

      this._lastTimestamp = performance.now();

      this.ui.update(
        this.player,
        this.input.getState(),
        this.combat.getUIState(),
        this.player.getDashUIState(),
        this.isGameOver,
        this.items ? this.items.getUIState(this.player, this.combat) : null
      );
      this.render();
    }

    start() {
      if (this.isRunning) {
        return;
      }

      this.isRunning = true;
      this._lastTimestamp = performance.now();

      if (this.items) {
        this.items.update(0, this.player, this.combat, this.map);
      }

      // 첫 프레임 즉시 동기화 및 렌더링
      this.ui.update(
        this.player,
        this.input.getState(),
        this.combat.getUIState(),
        this.player.getDashUIState(),
        this.isGameOver,
        this.items ? this.items.getUIState(this.player, this.combat) : null
      );
      this.render();

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
      if (!this.input.mouse.hasPosition || this.player.isDead) {
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
      const playerCanAct = !this.isGameOver && !this.player.isDead;

      if (playerCanAct) {
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

        // 4. 대시 이동 / 일반 WASD 이동 및 벽·장애물·타겟·생존 적 충돌 처리
        const circleBlockers = [
          ...this.combat.getAliveTargets(),
          ...this.enemies.getAliveEnemies()
        ];
        this.movement.update(this.player, moveVector, this.map, dt, {
          updateDirection: !this.input.mouse.hasPosition,
          circleBlockers
        });

        // 5. 플레이어 상태 타이머(대시 쿨다운 1.2s, 대시 무적 0.25s, 피격 무적 0.6s, 잔상 수명) 업데이트
        this.player.updateStatusTimers(dt);

        // 6. 이동 완료 후 E 키 아이템 상호작용 처리 (자동 획득 없음)
        if (this.items) {
          this.items.update(dt, this.player, this.combat, this.map);
          if (this.input.consumeInteractInput()) {
            this.items.tryInteract({
              player: this.player,
              combat: this.combat,
              officeMap: this.map
            });
          }
        } else {
          this.input.consumeInteractInput();
        }

        // 7. 이동 완료 후 플레이어 최신 좌표 기준으로 조준각 재보정
        this._updateAimFromMouse();

        // 8. 플레이어 공격 판정, 투사체 이동/벽 충돌, 쿨다운, 타겟 및 생존 적 피격 업데이트
        const shouldAttack = this.input.consumeAttackInput();
        this.combat.update(
          dt,
          this.player,
          this.map,
          shouldAttack,
          this.enemies.getAliveEnemies()
        );
      } else {
        // 사망(게임 오버) 상태에서는 이동·공격·대시·무기 전환·상호작용 입력을 모두 무시하고 잔여 이펙트만 정리
        this.input.consumeWeaponSwitch();
        this.input.consumeDashInput();
        this.input.consumeInteractInput();
        this.input.consumeAttackInput();
        this.player.updateStatusTimers(dt);
        if (this.items) {
          this.items.update(dt, this.player, this.combat, this.map);
        }
        this.combat.update(
          dt,
          this.player,
          this.map,
          false,
          this.enemies.getAliveEnemies()
        );
      }

      // 9. 적 AI 상태 전이(Idle/Patrol/Chase/Attack/Dead), 근접 공격 및 플레이어 피해 처리
      this.enemies.update(
        dt,
        this.player,
        this.map,
        this.combat.getAliveTargets(),
        this.playerDamage
      );

      // 10. 임시 무적 테스트용 위험 구역 판정 (분리된 선택 모듈)
      if (this.testHazard) {
        this.testHazard.update(dt, this.player);
        if (this.player.isDead && !this.isGameOver) {
          this._handlePlayerDeath();
        }
      }

      // 11. 플레이어 피격/회피 플로팅 팝업 및 피격 링 이펙트 갱신
      this.playerDamage.update(dt);

      // 12. UI 동기화 (체력 바, 무기 강화 단계, 아이템 획득 안내/결과 알림, 게임 오버 오버레이)
      const uiInputState = this.isGameOver
        ? {
            up: false,
            down: false,
            left: false,
            right: false,
            dash: false,
            interact: false,
            leftClick: false
          }
        : this.input.getState();

      this.ui.update(
        this.player,
        uiInputState,
        this.combat.getUIState(),
        this.player.getDashUIState(),
        this.isGameOver,
        this.items ? this.items.getUIState(this.player, this.combat) : null
      );
    }

    render() {
      const activeAim = this.player.isDead ? null : this.aimWorld;
      this.renderer.render(
        this.map,
        this.player,
        this.combat,
        activeAim,
        this.testHazard,
        this.enemies,
        this.playerDamage,
        this.items
      );
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
