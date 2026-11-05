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

      // 디버그용 URL 쿼리(?seed=... 또는 ?debug=1) 파싱
      const startupOptions = this._readStartupDebugOptions();
      this.currentSeed = null;
      this.debugSeedVisible = startupOptions.debugVisible;
      this._lastLayoutSignature = '';

      // 입출력/이동/미니맵/UI 모듈 초기화
      this.map = null;
      this.input = new PO.InputManager(window);
      this.movement = new PO.MovementSystem();
      this.renderer = null;
      this.minimap = PO.Minimap ? new PO.Minimap() : null;
      this.ui = new PO.UIManager();

      // 마우스 월드 조준 좌표 (마우스 입력 전에는 null)
      this.aimWorld = null;
      this.isGameOver = false;

      // 랜덤 맵 생성 및 플레이어, 피해 시스템, 적, 전투, 아이템 등 런타임 상태 초기화
      this._initRunState({ seed: startupOptions.initialSeed });

      // 게임 오버 화면의 재시작 버튼 이벤트 연결 (재시작 시 새로운 랜덤 맵 생성)
      this.ui.bindRestart(() => this.restart());

      // 디버그 시드 표시 토글 단축키(F3) 연결 (일반 플레이 UI 비간섭)
      this._onDebugKeyDown = (event) => {
        if (event.code === 'F3') {
          event.preventDefault();
          this.toggleDebugSeed();
        }
      };
      window.addEventListener('keydown', this._onDebugKeyDown);

      this.isRunning = false;
      this._lastTimestamp = 0;
      this._rafId = null;
      this._boundTick = this._tick.bind(this);
    }

    /**
     * URL 쿼리 파라미터에서 선택적 디버그 시드(?seed=) 및 표시 플래그(?debug=1) 확인
     */
    _readStartupDebugOptions() {
      try {
        const params = new URLSearchParams(window.location.search || '');
        const rawSeed = params.get('seed');
        const initialSeed = rawSeed && rawSeed.trim() !== '' ? rawSeed.trim() : null;
        const rawDebug = params.get('debug');
        const debugVisible =
          rawDebug === '1' || rawDebug === 'true' || Boolean(initialSeed);
        return { initialSeed, debugVisible };
      } catch (_err) {
        return { initialSeed: null, debugVisible: false };
      }
    }

    /**
     * 생성된 맵의 방 위치·크기·연결 구조를 요약한 서명 문자열 반환 (연속 재시작 시 동일 구조 방지용)
     */
    _computeMapSignature(officeMap) {
      if (!officeMap || !Array.isArray(officeMap.rooms)) {
        return '';
      }
      const roomPart = officeMap.rooms
        .map((r) => `${r.id}:${r.type}@${r.x},${r.y},${r.width}x${r.height}`)
        .join('|');
      const corrPart = (officeMap.corridors || [])
        .map((c) => `${c.fromRoomId}->${c.toRoomId}@${c.x},${c.y}`)
        .join('|');
      return `${roomPart}#${corrPart}`;
    }

    /**
     * 시작 또는 재시작 시 사용할 OfficeMap 생성
     * - 시드가 지정되면 해당 시드로 동일한 맵을 100% 재현
     * - 시드가 없으면 이전 판과 다른 새로운 랜덤 맵을 안전하게 생성
     */
    _createMapForRun(seedOverride = null) {
      const hasExplicitSeed =
        seedOverride !== undefined &&
        seedOverride !== null &&
        String(seedOverride).trim() !== '';

      if (hasExplicitSeed) {
        const cleanSeed = String(seedOverride).trim();
        return PO.OfficeMap.createRandom({ seed: cleanSeed });
      }

      let candidateMap = null;
      for (let i = 0; i < 6; i++) {
        let nextSeed =
          PO.SeededRandom && typeof PO.SeededRandom.createRandomSeedString === 'function'
            ? PO.SeededRandom.createRandomSeedString()
            : `op-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

        if (nextSeed === this.currentSeed) {
          nextSeed = `${nextSeed}-${i + 1}`;
        }

        candidateMap = PO.OfficeMap.createRandom({ seed: nextSeed });
        const sig = this._computeMapSignature(candidateMap);
        if (!this._lastLayoutSignature || sig !== this._lastLayoutSignature) {
          break;
        }
      }

      return candidateMap || new PO.OfficeMap();
    }

    /**
     * 새로운 맵(또는 지정 시드 맵)을 생성하고 플레이어, 적, 전투, 아이템, 미니맵, 충돌 데이터를 완전 초기화
     */
    _initRunState(options = {}) {
      const requestedSeed =
        typeof options === 'string' || typeof options === 'number'
          ? String(options)
          : options && options.seed !== undefined
            ? options.seed
            : null;

      this.isGameOver = false;

      // 1. 새로운 맵 생성 및 렌더러·미니맵의 이전 맵 잔여 상태 초기화
      this.map = this._createMapForRun(requestedSeed);
      this.currentSeed = this.map.seed;
      this._lastLayoutSignature = this._computeMapSignature(this.map);

      if (!this.renderer) {
        this.renderer = new PO.Renderer(this.canvas, this.stageElement, this.map);
      } else {
        this.renderer.officeMap = this.map;
      }

      if (this.minimap && typeof this.minimap.reset === 'function') {
        this.minimap.reset();
      }

      // 2. 시작 방 스폰 지점에 플레이어 생성 및 주변 시스템 초기화
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
        PO.EnemySystem.createDefaultEnemies(this.player.speed, this.map)
      );

      this.combat = new PO.CombatSystem(PO.CombatSystem.createDefaultTargets(this.map));

      this.items = PO.ItemSystem
        ? new PO.ItemSystem(PO.ItemSystem.createDefaultMapItems(this.map))
        : null;

      // 테스트용 고정 위험 구역은 레이아웃에 명시된 경우에만 활성화
      this.testHazard =
        PO.TestDamageZone && this.map.testHazardSpawn
          ? new PO.TestDamageZone(this.map.testHazardSpawn)
          : null;

      this.ui.setDebugSeed(this.currentSeed, this.debugSeedVisible);

      if (this.renderer) {
        this.renderer.updateCamera(this.player, this.map);
      }
    }

    /**
     * 현재 맵의 시드 문자열 반환 (디버그 및 재현 검증용)
     */
    getSeed() {
      return this.currentSeed;
    }

    /**
     * 디버그 시드 배지 노출 여부 설정
     */
    setDebugSeedVisible(visible) {
      this.debugSeedVisible = Boolean(visible);
      this.ui.setDebugSeed(this.currentSeed, this.debugSeedVisible);
    }

    /**
     * 디버그 시드 배지 표시 토글 (F3)
     */
    toggleDebugSeed() {
      this.setDebugSeedVisible(!this.debugSeedVisible);
      return this.debugSeedVisible;
    }

    /**
     * 디버그용: 지정한 시드(생략 시 새 랜덤 시드)로 즉시 맵을 재생성
     */
    regenerateMap(seed = null) {
      this.restart(seed !== null && seed !== undefined ? { seed } : {});
      return this.currentSeed;
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
     * 새로운 랜덤 맵(또는 options.seed 지정 맵)을 생성하여 처음부터 다시 시작
     * 이전 맵의 적·아이템·충돌·미니맵·무기 강화 상태가 남지 않도록 완전히 초기화한다.
     */
    restart(options = {}) {
      this.input.reset();
      this._initRunState(options);

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
     * 마우스 커서의 화면 좌표를 카메라 오프셋이 반영된 월드 좌표로 변환하여 플레이어 조준 방향 갱신
     * (플레이어 이동으로 카메라가 스크롤될 때도 조준 좌표가 항상 마우스 커서와 일치하도록 매 프레임 계산)
     */
    _updateAimFromMouse() {
      if (!this.input.mouse.hasPosition || this.player.isDead) {
        return;
      }

      this.input.consumeMouseDirty();
      const rawWorld = this.renderer.screenToWorld(
        this.input.mouse.clientX,
        this.input.mouse.clientY
      );
      this.aimWorld = {
        x: Math.max(0, Math.min(this.map.width, rawWorld.x)),
        y: Math.max(0, Math.min(this.map.height, rawWorld.y))
      };

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

        // 카메라를 플레이어의 새 위치로 먼저 갱신한 뒤 조준 좌표를 재보정
        this.renderer.updateCamera(this.player, this.map);

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

      if (this.minimap) {
        this.minimap.render(
          this.map,
          this.player,
          this.enemies,
          this.items,
          this.renderer.camera
        );
      }
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
