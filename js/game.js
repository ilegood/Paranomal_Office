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
      this.meta = PO.metaProgression || null;
      this.runRewardAwarded = false;
      this.lastRunReward = null;

      // 마우스 월드 조준 좌표 (마우스 입력 전에는 null)
      this.aimWorld = null;
      this.isGameOver = false;
      this.isVictory = false;
      this.runTime = 0;
      this.ui.hideVictory();
      this.escapeDevice = null;

      // 영구 강화 상점 및 캐릭터 선택 시스템 초기화
      this.characterSystem = PO.characterSystem || null;
      this.ui.initShop(this.meta);
      this.ui.initCharacterSelect(this.characterSystem, this.meta, (charId, action) => {
        if (action === 'select') {
          this._applyCurrentCharacterModifiers();
        }
      });

      // 랜덤 맵 생성 및 플레이어, 피해 시스템, 적, 전투, 아이템 등 런타임 상태 초기화
      this._initRunState({ seed: startupOptions.initialSeed });

      // 게임 오버 화면 및 탈출 성공 화면의 재시작 버튼 이벤트 연결 (재시작 시 새로운 랜덤 맵 생성)
      this.ui.bindRestart(() => this.restart());
      this.ui.bindVictoryRestart(() => this.restart());

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
      this.isVictory = false;
      this.runRewardAwarded = false;
      this.runTime = 0;
      this.ui.hideVictory();
      this.ui.setGameOver(false);

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

      // Phase 12 & 13: 영구 강화 수치 및 선택된 캐릭터 고유 능력치 결합 적용
      const metaModifiers = this.meta
        ? this.meta.getModifiers()
        : { maxHpBonus: 0, attackBonus: 0, dashCooldownReduction: 0 };

      const charModifiers = this.characterSystem
        ? this.characterSystem.getEffectiveModifiers()
        : { meleeDamageMultiplier: 1.0, rangedDamageMultiplier: 1.0, dashCooldownMultiplier: 1.0 };

      const baseMaxHp = 100 + (metaModifiers.maxHpBonus || 0);

      // 대시 쿨다운 계산: (기본 1.20s - 영구강화 감소량) * 캐릭터 고유 대시 배율
      const baseDashCooldown = 1.20;
      const metaDashReduction = metaModifiers.dashCooldownReduction || 0;
      const cooldownAfterMeta = Math.max(0.4, baseDashCooldown - metaDashReduction);
      const finalDashCooldown = Number(
        (cooldownAfterMeta * (charModifiers.dashCooldownMultiplier || 1.0)).toFixed(2)
      );

      // 2. 시작 방 스폰 지점에 플레이어 생성 및 주변 시스템 초기화
      this.player = new PO.Player({
        x: this.map.spawnPoint.x,
        y: this.map.spawnPoint.y,
        speed: 260,
        hp: baseMaxHp,
        maxHp: baseMaxHp,
        dashCooldown: finalDashCooldown
      });

      this.playerDamage = new PO.PlayerDamageSystem({
        onPlayerDeath: () => this._handlePlayerDeath()
      });

      this.enemies = new PO.EnemySystem(
        PO.EnemySystem.createDefaultEnemies(this.player.speed, this.map)
      );

      // Phase 10: 보스 방 보스 엔티티(야근 감독관) 초기화
      this.boss =
        PO.Boss && this.map.bossSpawn
          ? new PO.Boss(this.map.bossSpawn)
          : null;

      // Phase 15: 적 및 보스 처치 시 런 아이템 드롭 연동
      this.enemies.onEnemyDefeated = (enemy) => {
        if (this.items && typeof this.items.rollEnemyDrop === 'function') {
          this.items.rollEnemyDrop(enemy, enemy.position.x, enemy.position.y);
        }
      };

      if (this.boss) {
        this.boss.onDeath = (boss) => {
          if (this.items && typeof this.items.rollEnemyDrop === 'function') {
            this.items.rollEnemyDrop({ isBoss: true, name: boss.name }, boss.position.x, boss.position.y);
          }
        };
      }

      // Phase 9 & 10: 전투 방/보스 방 상태(Unvisited / Active / Cleared), 문 잠금 및 방별 적 수 추적 초기화
      this.combatRooms = PO.CombatRoomSystem
        ? new PO.CombatRoomSystem(this.map, this.enemies, {}, this.boss)
        : null;

      // Phase 12 & 13: 영구 공격력 보너스 및 캐릭터 고유 공격력 배율(퇴마 담당 근접 +20%)을 CombatSystem에 주입
      this.combat = new PO.CombatSystem(
        PO.CombatSystem.createDefaultTargets(this.map),
        {
          permanentAttackBonus: metaModifiers.attackBonus || 0,
          meleeDamageMultiplier: charModifiers.meleeDamageMultiplier || 1.0,
          rangedDamageMultiplier: charModifiers.rangedDamageMultiplier || 1.0
        }
      );

      this.items = PO.ItemSystem
        ? new PO.ItemSystem(PO.ItemSystem.createDefaultMapItems(this.map))
        : null;

      // Phase 11: 보스 방 비상 탈출 엘리베이터(탈출 장치) 초기화
      this.escapeDevice =
        PO.EscapeDevice && this.map.escapeDeviceSpawn
          ? new PO.EscapeDevice(this.map.escapeDeviceSpawn)
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
     * Phase 12: 이번 런 처치 적 수 기반 야근 수당 계산 및 1회 지급
     */
    _handlePlayerDeath() {
      if (this.isGameOver || this.isVictory) {
        return;
      }
      this.isGameOver = true;
      this.input.reset();

      const kills =
        (this.enemies && typeof this.enemies.getDefeatedCount === 'function'
          ? this.enemies.getDefeatedCount()
          : 0) ||
        (this.combatRooms && typeof this.combatRooms.getTotalDefeatedEnemies === 'function'
          ? this.combatRooms.getTotalDefeatedEnemies()
          : 0);

      const customKillReward =
        this.enemies && typeof this.enemies.getDefeatedRewardTotal === 'function'
          ? this.enemies.getDefeatedRewardTotal()
          : null;

      let rewardData = {
        totalReward: 0,
        newBalance: this.meta ? this.meta.getCurrency() : 0
      };

      if (!this.runRewardAwarded && this.meta) {
        this.runRewardAwarded = true;
        rewardData = this.meta.awardRunReward(kills, false, false, customKillReward);
      }
      this.lastRunReward = rewardData;

      const runItems = this.player && this.player.runBuffs ? this.player.runBuffs.itemsCollected : [];
      const runBuffs = this.player && this.player.runBuffs ? this.player.runBuffs : null;

      this.ui.setGameOver(true, {
        kills,
        earnedCurrency: rewardData.totalReward,
        totalCurrency: rewardData.newBalance,
        runItems,
        runBuffs
      });
    }

    /**
     * Phase 11 & 12: 탈출 장치와 상호작용하여 런을 성공적으로 완료(퇴근)했을 때 호출
     * 보스 처치 보상 + 적 처치 보상 합산 야근 수당 지급
     */
    _handleVictory() {
      if (this.isVictory || this.isGameOver) {
        return;
      }
      this.isVictory = true;
      this.input.reset();

      if (this.player) {
        this.player.velocity.x = 0;
        this.player.velocity.y = 0;
        this.player.isMoving = false;
      }

      // 런 통계 데이터 수집
      const totalSec = Math.max(0, Math.floor(this.runTime));
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      const formattedTime = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

      const kills =
        (this.enemies && typeof this.enemies.getDefeatedCount === 'function'
          ? this.enemies.getDefeatedCount()
          : 0) ||
        (this.combatRooms && typeof this.combatRooms.getTotalDefeatedEnemies === 'function'
          ? this.combatRooms.getTotalDefeatedEnemies()
          : 0);

      const customKillReward =
        this.enemies && typeof this.enemies.getDefeatedRewardTotal === 'function'
          ? this.enemies.getDefeatedRewardTotal()
          : null;

      const bossKilled = Boolean(this.boss && (this.boss.isDead() || this.boss.hp <= 0));

      let rewardData = {
        totalReward: 0,
        newBalance: this.meta ? this.meta.getCurrency() : 0
      };

      if (!this.runRewardAwarded && this.meta) {
        this.runRewardAwarded = true;
        rewardData = this.meta.awardRunReward(kills, bossKilled, true, customKillReward);
      }
      this.lastRunReward = rewardData;

      let equipmentStr = '기본 장비';
      if (this.combat) {
        const upLevel = this.combat.upgradeLevel || 0;
        const w1 = this.combat.weapons[1];
        const w2 = this.combat.weapons[2];
        const meleeName = w1?.config?.name || '근접 무기';
        const rangedName = w2?.config?.name || '원거리 무기';
        const meleeDmg = this.combat.getWeaponDamage(1);
        const rangedDmg = this.combat.getWeaponDamage(2);
        const rangedAmmo = w2 ? (w2.ammo !== null ? `${w2.ammo}발` : '무제한') : '0발';
        const upgradeBonus = upLevel > 0 ? ` (+${upLevel * 25}% 강화)` : '';
        equipmentStr = `${meleeName} (${meleeDmg} dmg) · ${rangedName} (${rangedDmg} dmg, ${rangedAmmo})${upgradeBonus}`;
      }

      const runItems = this.player && this.player.runBuffs ? this.player.runBuffs.itemsCollected : [];
      const runBuffs = this.player && this.player.runBuffs ? this.player.runBuffs : null;

      this.ui.showVictory({
        runTime: formattedTime,
        kills,
        bossKilled,
        equipment: equipmentStr,
        earnedCurrency: rewardData.totalReward,
        totalCurrency: rewardData.newBalance,
        runItems,
        runBuffs
      });
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
        this.items ? this.items.getUIState(this.player, this.combat) : null,
        this.combatRooms ? this.combatRooms.getUIState() : null,
        this.boss ? this.boss.getUIState() : null,
        this.escapeDevice ? this.escapeDevice.getPrompt() : null
      );
      this.render();
    }

    /**
     * Phase 13: 선택된 캐릭터의 고유 능력치(대시 쿨다운, 근접 공격력)를 활성 플레이어 및 전투 시스템에 실시간 동기화
     */
    _applyCurrentCharacterModifiers() {
      if (!this.player || this.player.isDead) return;

      const metaModifiers = this.meta
        ? this.meta.getModifiers()
        : { maxHpBonus: 0, attackBonus: 0, dashCooldownReduction: 0 };

      const charModifiers = this.characterSystem
        ? this.characterSystem.getEffectiveModifiers()
        : { meleeDamageMultiplier: 1.0, rangedDamageMultiplier: 1.0, dashCooldownMultiplier: 1.0 };

      const baseDashCooldown = 1.20;
      const metaDashReduction = metaModifiers.dashCooldownReduction || 0;
      const cooldownAfterMeta = Math.max(0.4, baseDashCooldown - metaDashReduction);
      const finalDashCooldown = Number(
        (cooldownAfterMeta * (charModifiers.dashCooldownMultiplier || 1.0)).toFixed(2)
      );

      this.player.baseDashCooldownBeforeBuffs = finalDashCooldown;
      const runDashMult = this.player.runBuffs ? this.player.runBuffs.dashCooldownMultiplier : 1.0;
      this.player.dash.cooldownTotal = Math.max(
        0.3,
        Number((finalDashCooldown * runDashMult).toFixed(2))
      );

      if (this.combat) {
        this.combat.meleeDamageMultiplier = charModifiers.meleeDamageMultiplier || 1.0;
        this.combat.rangedDamageMultiplier = charModifiers.rangedDamageMultiplier || 1.0;
        if (this.player.runBuffs) {
          this.combat.runAttackBonusPercent = this.player.runBuffs.attackBonusPercent;
        }
      }
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
        this.items ? this.items.getUIState(this.player, this.combat) : null,
        this.combatRooms ? this.combatRooms.getUIState() : null,
        this.boss ? this.boss.getUIState() : null,
        this.escapeDevice ? this.escapeDevice.getPrompt() : null
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
      if (this.ui && (this.ui.isShopOpen() || this.ui.isCharacterModalOpen())) {
        // 상점 또는 캐릭터 인사발령 모달이 열려 있는 동안에는 인게임 조작 및 런타임 진행 일시 정지
        this.input.consumeWeaponSwitch();
        this.input.consumeDashInput();
        this.input.consumeInteractInput();
        this.input.consumeAttackInput();
        return;
      }

      if (this.isVictory) {
        // Phase 11: 탈출 성공 화면이 표시된 동안에는 플레이어 이동, 공격, 대시 및 적/보스 이동/공격을 모두 중단
        this.input.consumeWeaponSwitch();
        this.input.consumeDashInput();
        this.input.consumeInteractInput();
        this.input.consumeAttackInput();
        return;
      }

      if (!this.isGameOver) {
        this.runTime += dt;
      }

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

        // 4. 대시 이동 / 일반 WASD 이동 및 벽·장애물·타겟·생존 적·보스 충돌 처리
        const circleBlockers = [
          ...this.combat.getAliveTargets(),
          ...this.enemies.getAliveEnemies()
        ];
        if (this.boss && this.boss.alive && !this.boss.isDead()) {
          circleBlockers.push(this.boss);
        }
        this.movement.update(this.player, moveVector, this.map, dt, {
          updateDirection: !this.input.mouse.hasPosition,
          circleBlockers
        });

        // 플레이어가 미방문 전투 방 또는 보스 방에 진입했다면 즉시 Active 전환 및 출입문 충돌체 잠금 적용
        if (this.combatRooms) {
          this.combatRooms.checkPlayerEntry(
            this.player,
            this.map,
            this.enemies,
            this.isGameOver,
            this.boss
          );
        }

        // 카메라를 플레이어의 새 위치로 먼저 갱신한 뒤 조준 좌표를 재보정
        this.renderer.updateCamera(this.player, this.map);

        // 5. 플레이어 상태 타이머(대시 쿨다운 1.2s, 대시 무적 0.25s, 피격 무적 0.6s, 잔상 수명) 업데이트
        this.player.updateStatusTimers(dt);

        // 6. 탈출 장치 업데이트 및 이동 완료 후 E 키 탈출/아이템 상호작용 처리 (자동 획득 없음)
        if (this.escapeDevice) {
          this.escapeDevice.update(dt, this.player, this.boss, this.combatRooms);
        }

        if (this.items) {
          this.items.update(dt, this.player, this.combat, this.map);
        }

        const isInteractPressed = this.input.consumeInteractInput();
        if (isInteractPressed) {
          if (this.escapeDevice && this.escapeDevice.isFocused) {
            if (this.escapeDevice.tryInteract(this.player)) {
              this._handleVictory();
              return;
            }
          } else if (this.items) {
            this.items.tryInteract({
              player: this.player,
              combat: this.combat,
              officeMap: this.map,
              game: this
            });
          }
        }

        // 7. 이동 완료 후 플레이어 최신 좌표 기준으로 조준각 재보정
        this._updateAimFromMouse();

        // 8. 플레이어 공격 판정, 투사체 이동/벽 충돌, 쿨다운, 타겟, 생존 적 및 보스 피격 업데이트
        const shouldAttack = this.input.consumeAttackInput();
        this.combat.update(
          dt,
          this.player,
          this.map,
          shouldAttack,
          this.enemies.getAliveEnemies(),
          this.boss
        );
      } else {
        // 사망(게임 오버) 상태에서는 이동·공격·대시·무기 전환·상호작용 입력을 모두 무시하고 잔여 이펙트만 정리
        this.input.consumeWeaponSwitch();
        this.input.consumeDashInput();
        this.input.consumeInteractInput();
        this.input.consumeAttackInput();
        this.player.updateStatusTimers(dt);
        if (this.escapeDevice) {
          this.escapeDevice.update(dt, this.player, this.boss, this.combatRooms);
        }
        if (this.items) {
          this.items.update(dt, this.player, this.combat, this.map);
        }
        this.combat.update(
          dt,
          this.player,
          this.map,
          false,
          this.enemies.getAliveEnemies(),
          this.boss
        );
      }

      // 9. 일반 적 AI 상태 전이(Idle/Patrol/Chase/Attack/Dead), 근접 공격 및 플레이어 피해 처리
      this.enemies.update(
        dt,
        this.player,
        this.map,
        this.combat.getAliveTargets(),
        this.playerDamage
      );

      // 9-2. Phase 10: 보스 AI 상태 전이(Idle/Chase/Telegraph/Attack/Recovery/Dead), 공격 패턴 및 플레이어 피해 처리
      if (this.boss) {
        this.boss.update(dt, this.player, this.map, this.playerDamage);
      }

      // 10. 전투 방/보스 방 적 처치 집계, 방 클리어 및 출입문 개방 처리
      if (this.combatRooms) {
        this.combatRooms.update(
          dt,
          this.player,
          this.map,
          this.enemies,
          this.isGameOver,
          this.boss
        );
      }

      // 11. 임시 무적 테스트용 위험 구역 판정 (분리된 선택 모듈)
      if (this.testHazard) {
        this.testHazard.update(dt, this.player);
        if (this.player.isDead && !this.isGameOver) {
          this._handlePlayerDeath();
        }
      }

      // 12. 플레이어 피격/회피 플로팅 팝업 및 피격 링 이펙트 갱신
      this.playerDamage.update(dt);

      // 플레이어 체력 소진 시 게임 오버 및 영구 재화 정산 처리
      if (this.player.isDead && !this.isGameOver) {
        this._handlePlayerDeath();
      }

      // 13. UI 동기화 (체력 바, 무기 강화 단계, 아이템 알림, 전투 방 HUD, 보스 체력 바, 게임 오버 오버레이)
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

      const escapePrompt = this.escapeDevice ? this.escapeDevice.getPrompt() : null;

      this.ui.update(
        this.player,
        uiInputState,
        this.combat.getUIState(),
        this.player.getDashUIState(),
        this.isGameOver,
        this.items ? this.items.getUIState(this.player, this.combat) : null,
        this.combatRooms ? this.combatRooms.getUIState() : null,
        this.boss ? this.boss.getUIState() : null,
        escapePrompt
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
        this.items,
        this.boss,
        this.escapeDevice
      );

      if (this.minimap) {
        this.minimap.render(
          this.map,
          this.player,
          this.enemies,
          this.items,
          this.renderer.camera,
          this.boss,
          this.escapeDevice
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
