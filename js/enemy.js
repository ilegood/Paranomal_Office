(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 적 AI 및 전투 상태 상수 정의
   */
  const ENEMY_STATES = Object.freeze({
    IDLE: 'Idle',
    PATROL: 'Patrol',
    CHASE: 'Chase',
    ATTACK: 'Attack',
    DEAD: 'Dead'
  });

  /**
   * Phase 14: 5종 적 데이터 정의 (적 데이터 구조와 AI 로직의 명확한 분리)
   * 고유 ID, 이름, 최대 체력, 이동 속도, 공격력, 공격 범위, 공격 쿨다운, 공격 방식(melee/ranged), 처치 보상
   */
  const ENEMY_DEFINITIONS = Object.freeze({
    ghost: {
      type: 'ghost',
      name: '사무실 망령',
      maxHp: 100,
      moveSpeed: 169, // 플레이어(260)의 65%
      attackDamage: 15,
      attackRange: 45,
      attackCooldown: 1.2,
      attackType: 'melee',
      attackWindupDuration: 0.35,
      attackRecoveryDuration: 0.16,
      attackArcDegrees: 120,
      reward: 10,
      colliderRadius: 17,
      chaseStopDistance: 38,
      detectionRange: 250,
      isElite: false,
      description: '과중한 업무로 승천하지 못한 망령. 기본적인 플레이어 추적과 근접 공격을 가합니다.'
    },
    stalker: {
      type: 'stalker',
      name: '야근 추적자',
      maxHp: 60, // 체력 낮음
      moveSpeed: 240, // 매우 빠른 추적 (플레이어 260의 ~92%)
      attackDamage: 12,
      attackRange: 42,
      attackCooldown: 0.9, // 빠른 공격 쿨다운
      attackType: 'melee',
      attackWindupDuration: 0.22, // 짧은 선딜레이
      attackRecoveryDuration: 0.12,
      attackArcDegrees: 110,
      reward: 10,
      colliderRadius: 15,
      chaseStopDistance: 36,
      detectionRange: 270,
      isElite: false,
      description: '퇴근하는 자를 용납하지 못하는 고속 추적자. 빠른 이동 속도로 접근해 찌릅니다.'
    },
    thrower: {
      type: 'thrower',
      name: '서류 투척자',
      maxHp: 75,
      moveSpeed: 150, // 플레이어(260)의 58%
      attackDamage: 12,
      attackRange: 240, // 원거리 조준 사거리
      attackCooldown: 1.8,
      attackType: 'ranged',
      attackWindupDuration: 0.40, // 서류 장전 및 조준 선딜레이
      attackRecoveryDuration: 0.20,
      attackArcDegrees: 360,
      reward: 15,
      colliderRadius: 16,
      chaseStopDistance: 170, // 정지 거리
      preferredMinDistance: 150, // 이 거리보다 가까우면 뒤로 후퇴(kiting)
      preferredMaxDistance: 230, // 이 거리보다 멀면 접근
      projectileSpeed: 300, // 날아가는 서류 속도 (px/s)
      projectileLifetime: 2.2, // 투사체 수명 (초)
      projectileRadius: 8, // 투사체 피격 반경 (px)
      detectionRange: 290,
      isElite: false,
      description: '플레이어와 일정 거리를 유지(카이팅)하며 날카로운 결재 서류 뭉치를 투척합니다.'
    },
    cabinet: {
      type: 'cabinet',
      name: '철제 캐비닛',
      maxHp: 220, // 매우 높은 체력
      moveSpeed: 105, // 느린 이동 (플레이어의 ~40%)
      attackDamage: 28, // 묵직하고 강력한 일격
      attackRange: 55, // 덩치에 걸맞은 넓은 사거리
      attackCooldown: 2.0, // 느린 공격 주기
      attackType: 'melee',
      attackWindupDuration: 0.55, // 묵직한 선딜레이
      attackRecoveryDuration: 0.30,
      attackArcDegrees: 140, // 넓은 부채꼴 판정
      reward: 20,
      colliderRadius: 22, // 큰 충돌 크기
      chaseStopDistance: 48,
      detectionRange: 240,
      isElite: false,
      description: '육중한 철제 사무 캐비닛 괴이. 느리지만 강력한 체력과 무거운 타격을 자랑합니다.'
    },
    manager: {
      type: 'manager',
      name: '야근 팀장',
      maxHp: 180, // 높은 체력
      moveSpeed: 185, // 준수한 속도 (플레이어의 ~71%)
      attackDamage: 22, // 높은 공격력
      attackRange: 50,
      attackCooldown: 1.4,
      attackType: 'melee',
      attackWindupDuration: 0.32,
      attackRecoveryDuration: 0.18,
      attackArcDegrees: 130,
      reward: 30, // 높은 처치 보상
      colliderRadius: 19,
      chaseStopDistance: 42,
      detectionRange: 280,
      isElite: true,
      description: '부하 직원들을 감시하는 엘리트 야근 팀장. 높은 체력과 공격력을 지닌 요주의 적입니다.'
    }
  });

  /**
   * 기본 적 밸런스, AI 추적 및 공격 공통 설정값
   */
  const ENEMY_CONFIG = {
    maxHp: 100,
    speedRatioToPlayer: 0.65,
    moveSpeed: 169,
    patrolSpeedRatio: 0.6,
    detectionRange: 250,
    colliderRadius: 17,
    chaseStopDistance: 38,

    attackRange: 45,
    attackDamage: 15,
    attackCooldown: 1.2,
    attackWindupDuration: 0.35,
    attackRecoveryDuration: 0.16,
    attackArcDegrees: 120,

    lostSightChaseDuration: 2.0,
    arrivalThreshold: 8,
    patrolDistance: 56,
    idleDuration: 1.0,
    maxPatrolDuration: 1.8,
    hitFlashDuration: 0.14,
    hitShakeDuration: 0.18,
    alertPopDuration: 0.45,
    deathDuration: 0.45
  };

  /**
   * Phase 14: 원거리 적(서류 투척자) 발사체 엔티티 모델
   */
  class EnemyProjectile {
    constructor(config = {}) {
      this.id = config.id || `eproj-${Math.random().toString(36).slice(2, 9)}`;
      this.x = config.x || 0;
      this.y = config.y || 0;
      this.prevX = this.x;
      this.prevY = this.y;
      this.dirX = config.dirX || 1;
      this.dirY = config.dirY || 0;
      this.speed = config.speed || 300;
      this.damage = config.damage || 12;
      this.radius = config.radius || 8;
      this.lifeTime = config.lifeTime || 2.2;
      this.elapsed = 0;
      this.alive = true;
      this.attackerId = config.attackerId || null;
      this.angle = Math.atan2(this.dirY, this.dirX);
      this.spinPhase = Math.random() * Math.PI * 2;
    }

    update(dt, player, officeMap, playerDamageSystem = null) {
      if (!this.alive) return false;

      this.prevX = this.x;
      this.prevY = this.y;
      this.elapsed += dt;
      this.spinPhase += dt * 14;

      if (this.elapsed >= this.lifeTime) {
        this.alive = false;
        return false;
      }

      this.x += this.dirX * this.speed * dt;
      this.y += this.dirY * this.speed * dt;

      // 1. 맵 외곽 및 벽 충돌 검사
      if (officeMap) {
        if (typeof officeMap.getPlayableBounds === 'function') {
          const bounds = officeMap.getPlayableBounds(0);
          if (
            this.x < bounds.minX ||
            this.x > bounds.maxX ||
            this.y < bounds.minY ||
            this.y > bounds.maxY
          ) {
            this.alive = false;
            return false;
          }
        }

        const walls =
          typeof officeMap.getWalls === 'function'
            ? officeMap.getWalls()
            : officeMap.walls || [];
        for (let i = 0; i < walls.length; i++) {
          const w = walls[i];
          if (
            this.x >= w.x &&
            this.x <= w.x + w.width &&
            this.y >= w.y &&
            this.y <= w.y + w.height
          ) {
            this.alive = false;
            return false;
          }
        }
      }

      // 2. 플레이어 충돌 검사
      if (player && !player.isDead && player.hp > 0) {
        const dx = player.position.x - this.x;
        const dy = player.position.y - this.y;
        const hitDist = (player.colliderRadius || 16) + this.radius;
        if (dx * dx + dy * dy <= hitDist * hitDist) {
          this.alive = false;
          if (playerDamageSystem) {
            playerDamageSystem.applyDamage(player, this.damage, {
              source: 'enemy_ranged',
              attackerId: this.attackerId
            });
          } else {
            player.takeDamage(this.damage, {
              source: 'enemy_ranged',
              attackerId: this.attackerId
            });
          }
          return false;
        }
      }

      return true;
    }
  }

  /**
   * 기본 적 엔티티 데이터 및 상태 모델 (플레이어 및 테스트 타깃과 분리)
   */
  class Enemy {
    constructor(config = {}) {
      this.id = config.id ?? 'enemy-1';
      this.isEnemy = true;
      this.roomId = config.roomId ?? null;

      // Phase 14: 적 종류(enemyType) 및 데이터 분리 정의 적용
      this.enemyType = config.enemyType || 'ghost';
      const def = ENEMY_DEFINITIONS[this.enemyType] || ENEMY_DEFINITIONS.ghost;

      this.name = config.name ?? def.name;
      this.enemyType = def.type;
      this.attackType = config.attackType ?? def.attackType; // 'melee' | 'ranged'
      this.reward = config.reward ?? def.reward;
      this.isElite = Boolean(config.isElite ?? def.isElite);

      // 위치 (쿼터뷰 바닥 접지면 중심 좌표)
      this.position = {
        x: config.x ?? 1005,
        y: config.y ?? 415
      };

      // 체력 및 이동/감지/공격 수치
      this.maxHp = config.maxHp ?? def.maxHp;
      this.hp = config.hp ?? this.maxHp;
      this.speed =
        config.speed ??
        (config.playerBaseSpeed
          ? config.playerBaseSpeed * (def.moveSpeed / 260)
          : def.moveSpeed);
      this.detectionRange = config.detectionRange ?? def.detectionRange;

      // 충돌 반경 및 정지 거리
      this.colliderRadius = config.colliderRadius ?? def.colliderRadius;
      this.radius = this.colliderRadius;
      this.chaseStopDistance = config.chaseStopDistance ?? def.chaseStopDistance;

      // 원거리 카이팅 및 투사체 설정
      this.preferredMinDistance = config.preferredMinDistance ?? def.preferredMinDistance ?? 150;
      this.preferredMaxDistance = config.preferredMaxDistance ?? def.preferredMaxDistance ?? 230;
      this.projectileSpeed = config.projectileSpeed ?? def.projectileSpeed ?? 300;
      this.projectileLifetime = config.projectileLifetime ?? def.projectileLifetime ?? 2.2;
      this.projectileRadius = config.projectileRadius ?? def.projectileRadius ?? 8;

      // 근접/원거리 공격 속성
      this.attackRange = config.attackRange ?? def.attackRange;
      this.attackDamage = config.attackDamage ?? def.attackDamage;
      const arcDeg = config.attackArcDegrees ?? def.attackArcDegrees;
      this.attackArcRad = (arcDeg * Math.PI) / 180;

      // 현재 AI 상태 (Idle, Patrol, Chase, Attack, Dead)
      this.state = config.initialState ?? ENEMY_STATES.IDLE;
      this.alive = this.hp > 0 && this.state !== ENEMY_STATES.DEAD;
      this.shouldRemove = false;

      // 바라보는 방향 및 현재 이동 속도 벡터
      this.direction = {
        x: -1,
        y: 0,
        angle: Math.PI,
        facing: 'left'
      };
      this.velocity = {
        x: 0,
        y: 0
      };
      this.isMoving = false;
      this.walkPhase = 0;

      // 대기(Idle) 및 짧은 순찰(Patrol) 상태 관리 데이터
      this.patrolOrigin = {
        x: this.position.x,
        y: this.position.y
      };
      this.patrolDistance = config.patrolDistance ?? ENEMY_CONFIG.patrolDistance;
      this.patrolDir = -1;
      this.idleTimer = config.idleDuration ?? ENEMY_CONFIG.idleDuration;
      this.patrolTimer = 0;

      // 추적(Chase) 및 마지막 발견 위치 유지 데이터
      this.isPlayerInRange = false;
      this.lastKnownPlayerPos = null;
      this.lostSightChaseTimer = 0;
      this.alertTimer = 0;

      // 공격(Attack) 준비·판정·쿨다운 상태 데이터
      this.attack = {
        phase: 'none', // 'none' | 'windup' | 'recovery'
        timer: 0,
        windupDuration: config.attackWindupDuration ?? def.attackWindupDuration,
        recoveryDuration: config.attackRecoveryDuration ?? def.attackRecoveryDuration,
        cooldownRemaining: 0,
        cooldownTotal: config.attackCooldown ?? def.attackCooldown,
        aimAngle: Math.PI,
        aimDirX: -1,
        aimDirY: 0,
        hasAppliedStrike: false,
        slashTimer: 0,
        slashDuration: 0.18
      };

      // 피격 및 사망 연출 타이머
      this.hitFlashTimer = 0;
      this.shakeTimer = 0;
      this.lastHitDirX = 0;
      this.deathTimer = 0;
      this.deathDuration = config.deathDuration ?? ENEMY_CONFIG.deathDuration;
    }

    /**
     * 방향 벡터를 정규화하여 적의 시선/진행 방향을 갱신한다.
     */
    setDirection(dx, dy) {
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        return;
      }

      const nx = dx / len;
      const ny = dy / len;
      this.direction.x = nx;
      this.direction.y = ny;
      this.direction.angle = Math.atan2(ny, nx);

      if (Math.abs(ny) >= Math.abs(nx)) {
        this.direction.facing = ny < 0 ? 'up' : 'down';
      } else {
        this.direction.facing = nx < 0 ? 'left' : 'right';
      }
    }

    /**
     * 진행 중인 공격 동작을 즉시 취소한다. (적 사망 또는 플레이어 사망 시 호출)
     */
    cancelAttack() {
      this.attack.phase = 'none';
      this.attack.timer = 0;
      this.attack.hasAppliedStrike = true;
      this.attack.slashTimer = 0;
    }

    /**
     * 공격 시스템으로부터 피해를 받을 때 호출된다.
     */
    takeDamage(amount, hitDirX = 0) {
      if (!this.alive || this.state === ENEMY_STATES.DEAD || amount <= 0) {
        return 0;
      }

      const actualDamage = Math.min(this.hp, amount);
      this.hp = Math.max(0, this.hp - amount);
      this.hitFlashTimer = ENEMY_CONFIG.hitFlashDuration;
      this.shakeTimer = ENEMY_CONFIG.hitShakeDuration;
      this.lastHitDirX = hitDirX;

      if (this.hp <= 0) {
        this.enterDeadState();
      }

      return actualDamage;
    }

    /**
     * 체력이 0 이하가 되었을 때 즉시 Dead 상태로 전환하고 진행 중이던 추적/공격/충돌을 중단한다.
     */
    enterDeadState() {
      this.hp = 0;
      this.state = ENEMY_STATES.DEAD;
      this.alive = false;
      this.isMoving = false;
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isPlayerInRange = false;
      this.lastKnownPlayerPos = null;
      this.lostSightChaseTimer = 0;
      this.cancelAttack();
      this.deathTimer = 0;
    }

    isDead() {
      return this.state === ENEMY_STATES.DEAD || !this.alive;
    }

    getSortY() {
      return this.position.y;
    }
  }

  /**
   * 적 AI 상태 전이(Idle / Patrol / Chase / Attack / Dead), 근접 및 원거리 공격 판정, 투사체 및 장애물 회피 시스템
   */
  class EnemySystem {
    constructor(initialEnemies = []) {
      this.enemies = initialEnemies.map((cfg) => (cfg instanceof Enemy ? cfg : new Enemy(cfg)));
      this.enemyProjectiles = [];
      this.defeatedEnemyIds = new Set();
      this.defeatedRewards = new Map();
    }

    getDefeatedCount() {
      return this.defeatedEnemyIds.size;
    }

    /**
     * Phase 14: 처치된 모든 적의 종류별 개별 보상 합계 계산
     */
    getDefeatedRewardTotal() {
      let total = 0;
      for (const reward of this.defeatedRewards.values()) {
        total += reward;
      }
      return total;
    }

    /**
     * Phase 14: 적 종류별 스폰 가중치 추첨
     * 일반 적(ghost) ~40%, 빠른 적(stalker) ~20%, 원거리 적(thrower) ~20%, 탱커(cabinet) ~10%, 엘리트(manager) ~10%
     */
    static pickRandomEnemyType(rng = null) {
      const roll =
        rng && typeof rng.float === 'function'
          ? rng.float(0, 100)
          : Math.random() * 100;

      if (roll < 40) return 'ghost';
      if (roll < 60) return 'stalker';
      if (roll < 80) return 'thrower';
      if (roll < 90) return 'cabinet';
      return 'manager';
    }

    /**
     * 테스트 사무실 맵의 전투 방 기본 적 초기 배치 데이터 반환
     */
    static createDefaultEnemies(playerBaseSpeed = 260, officeMap = null) {
      const spawns =
        officeMap && Array.isArray(officeMap.enemySpawns)
          ? officeMap.enemySpawns
          : [
              { id: 'enemy-combat-1', x: 1200, y: 910 },
              { id: 'enemy-combat-2', x: 2055, y: 910 }
            ];

      return spawns.map((spawn, idx) => {
        const assignedRoomId =
          spawn.roomId ??
          (officeMap && typeof officeMap.getRoomAt === 'function'
            ? officeMap.getRoomAt(spawn.x, spawn.y)?.id ?? null
            : null);

        const enemyType = spawn.enemyType || EnemySystem.pickRandomEnemyType();
        const def = ENEMY_DEFINITIONS[enemyType] || ENEMY_DEFINITIONS.ghost;

        return {
          id: spawn.id ?? `enemy-office-${idx + 1}`,
          enemyType,
          name: spawn.name ?? def.name,
          roomId: assignedRoomId,
          x: spawn.x,
          y: spawn.y,
          playerBaseSpeed,
          maxHp: spawn.maxHp ?? def.maxHp,
          detectionRange: spawn.detectionRange ?? def.detectionRange,
          attackRange: spawn.attackRange ?? def.attackRange,
          attackDamage: spawn.attackDamage ?? def.attackDamage,
          attackCooldown: spawn.attackCooldown ?? def.attackCooldown,
          attackWindupDuration: spawn.attackWindupDuration ?? def.attackWindupDuration,
          attackRecoveryDuration: spawn.attackRecoveryDuration ?? def.attackRecoveryDuration,
          attackType: spawn.attackType ?? def.attackType,
          reward: spawn.reward ?? def.reward,
          colliderRadius: spawn.colliderRadius ?? def.colliderRadius,
          chaseStopDistance: spawn.chaseStopDistance ?? def.chaseStopDistance,
          preferredMinDistance: spawn.preferredMinDistance ?? def.preferredMinDistance,
          preferredMaxDistance: spawn.preferredMaxDistance ?? def.preferredMaxDistance,
          projectileSpeed: spawn.projectileSpeed ?? def.projectileSpeed,
          isElite: spawn.isElite ?? def.isElite
        };
      });
    }

    /**
     * 생존 중인 적 목록 반환 (공격 피격 판정 및 플레이어 이동 충돌용)
     */
    getAliveEnemies() {
      return this.enemies.filter((e) => e.alive && e.state !== ENEMY_STATES.DEAD);
    }

    /**
     * 렌더링 대상 적 목록 반환 (사망 애니메이션 진행 중인 적 포함)
     */
    getRenderableEnemies() {
      return this.enemies.filter((e) => !e.shouldRemove);
    }

    /**
     * 매 프레임 적 AI, 공격 준비/판정/쿨다운, 이동 및 사망 후 제거 처리
     */
    update(dt, player, officeMap, staticBlockers = [], playerDamageSystem = null) {
      if (dt <= 0) {
        return;
      }

      const isPlayerDead = !player || Boolean(player.isDead) || player.hp <= 0;

      // 0. Phase 14: 원거리 적(서류 투척자) 서류 투사체 업데이트 및 플레이어 충돌 판정
      for (let pIdx = this.enemyProjectiles.length - 1; pIdx >= 0; pIdx--) {
        const proj = this.enemyProjectiles[pIdx];
        const stillAlive = proj.update(dt, player, officeMap, playerDamageSystem);
        if (!stillAlive || !proj.alive) {
          this.enemyProjectiles.splice(pIdx, 1);
        }
      }

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];

        // 1. 공통 시각·쿨다운 타이머 감소
        if (enemy.hitFlashTimer > 0) {
          enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
        }
        if (enemy.shakeTimer > 0) {
          enemy.shakeTimer = Math.max(0, enemy.shakeTimer - dt);
        }
        if (enemy.alertTimer > 0) {
          enemy.alertTimer = Math.max(0, enemy.alertTimer - dt);
        }
        if (enemy.attack.cooldownRemaining > 0) {
          enemy.attack.cooldownRemaining = Math.max(0, enemy.attack.cooldownRemaining - dt);
        }
        if (enemy.attack.slashTimer > 0) {
          enemy.attack.slashTimer = Math.max(0, enemy.attack.slashTimer - dt);
        }

        // 2. Dead 상태: 공격·추적을 모두 중단하고 사망 연출 완료 후 제거
        if (enemy.state === ENEMY_STATES.DEAD || !enemy.alive) {
          if (!this.defeatedEnemyIds.has(enemy.id)) {
            this.defeatedEnemyIds.add(enemy.id);
            this.defeatedRewards.set(enemy.id, enemy.reward || 10);
          }
          enemy.deathTimer += dt;
          if (enemy.deathTimer >= enemy.deathDuration) {
            enemy.shouldRemove = true;
            this.enemies.splice(i, 1);
          }
          continue;
        }

        // 다른 생존 적들도 원형 충돌 대상에 포함하여 다중 적 추적 시 서로 겹치지 않도록 유지
        const entityBlockers = [
          ...staticBlockers,
          ...this.enemies.filter((other) => other !== enemy && other.alive && other.state !== ENEMY_STATES.DEAD)
        ];

        // 3. 플레이어가 사망한 경우: 공격 및 추적을 즉시 중단하고 대기/순찰 유지
        if (isPlayerDead) {
          if (enemy.state === ENEMY_STATES.ATTACK || enemy.state === ENEMY_STATES.CHASE) {
            enemy.cancelAttack();
            this._returnToIdleFromChase(enemy);
          }

          if (enemy.state === ENEMY_STATES.IDLE) {
            this._updateIdleState(enemy, dt);
          } else if (enemy.state === ENEMY_STATES.PATROL) {
            this._updatePatrolState(enemy, dt, null, officeMap, entityBlockers);
          }
          continue;
        }

        // 4. 플레이어와의 현재 거리 및 방 격벽 차폐 여부 계산 (책상/기둥은 시야 허용, 고체 벽 너머만 차단)
        const dxToPlayer = player.position.x - enemy.position.x;
        const dyToPlayer = player.position.y - enemy.position.y;
        const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);
        const wallBlocked = this._isBlockedByWall(
          enemy.position.x,
          enemy.position.y,
          player.position.x,
          player.position.y,
          officeMap
        );
        const detectedNow = distToPlayer <= enemy.detectionRange && !wallBlocked;

        enemy.isPlayerInRange = detectedNow;
        if (detectedNow) {
          enemy.lastKnownPlayerPos = {
            x: player.position.x,
            y: player.position.y
          };
          enemy.lostSightChaseTimer = ENEMY_CONFIG.lostSightChaseDuration;
        }

        // 5. 공격(Attack) 진행 중에는 즉시 Chase로 덮어쓰지 않고 공격 동작을 끝까지 수행
        if (enemy.state === ENEMY_STATES.ATTACK) {
          this._updateAttackState(enemy, dt, player, playerDamageSystem, officeMap);
          continue;
        }

        // 6. 감지 범위 내 진입 시 Chase 또는 사거리 내 즉시 Attack 전환
        if (detectedNow) {
          if (distToPlayer <= enemy.attackRange && enemy.attack.cooldownRemaining <= 0) {
            this._startAttack(enemy, player);
            continue;
          }
          if (enemy.state !== ENEMY_STATES.CHASE) {
            enemy.state = ENEMY_STATES.CHASE;
            enemy.alertTimer = ENEMY_CONFIG.alertPopDuration;
          }
        }

        // 7. 비공격 상태별 행동 수행
        switch (enemy.state) {
          case ENEMY_STATES.IDLE:
            this._updateIdleState(enemy, dt);
            break;
          case ENEMY_STATES.PATROL:
            this._updatePatrolState(enemy, dt, player, officeMap, entityBlockers);
            break;
          case ENEMY_STATES.CHASE:
            this._updateChaseState(
              enemy,
              dt,
              player,
              distToPlayer,
              officeMap,
              entityBlockers
            );
            break;
          default:
            break;
        }
      }
    }

    /**
     * 적 공격 준비(Windup) 시작: 이동을 멈추고 플레이어 방향으로 조준 고정
     */
    _startAttack(enemy, player) {
      enemy.state = ENEMY_STATES.ATTACK;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      enemy.setDirection(dx, dy);

      enemy.attack.phase = 'windup';
      enemy.attack.timer = enemy.attack.windupDuration;
      enemy.attack.aimAngle = enemy.direction.angle;
      enemy.attack.aimDirX = enemy.direction.x;
      enemy.attack.aimDirY = enemy.direction.y;
      enemy.attack.hasAppliedStrike = false;
    }

    /**
     * Attack 상태 업데이트: 준비 시간 후 판정/발사 수행 -> 후딜 후 거리 재확인
     */
    _updateAttackState(enemy, dt, player, playerDamageSystem, officeMap = null) {
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;

      if (enemy.attack.phase === 'windup') {
        enemy.attack.timer -= dt;
        if (enemy.attack.timer > 0) {
          return;
        }

        const overflowDt = -enemy.attack.timer;

        // 공격 준비 완료 시점에 단 한 번만 판정 및 쿨다운 적용
        if (!enemy.attack.hasAppliedStrike) {
          if (enemy.attackType === 'ranged') {
            this._executeRangedAttackOnce(enemy, player, officeMap);
          } else {
            this._executeMeleeStrikeOnce(enemy, player, playerDamageSystem, officeMap);
          }
        }

        enemy.attack.phase = 'recovery';
        enemy.attack.timer = Math.max(0, enemy.attack.recoveryDuration - overflowDt);
        if (enemy.attack.timer <= 0) {
          this._finishAttackAndTransition(enemy, player, officeMap);
        }
        return;
      }

      if (enemy.attack.phase === 'recovery') {
        enemy.attack.timer -= dt;
        if (enemy.attack.timer <= 0) {
          this._finishAttackAndTransition(enemy, player, officeMap);
        }
      } else {
        this._finishAttackAndTransition(enemy, player, officeMap);
      }
    }

    /**
     * Phase 14: 원거리 적(서류 투척자) 서류 투사체 발사 처리
     */
    _executeRangedAttackOnce(enemy, player, officeMap = null) {
      enemy.attack.hasAppliedStrike = true;
      enemy.attack.cooldownRemaining = enemy.attack.cooldownTotal;

      if (!player || player.isDead || player.hp <= 0) {
        return false;
      }

      const dx = player.position.x - enemy.position.x;
      const dy = (player.position.y - 12) - (enemy.position.y - 18);
      const len = Math.hypot(dx, dy);
      const dirX = len > 1e-5 ? dx / len : enemy.direction.x;
      const dirY = len > 1e-5 ? dy / len : enemy.direction.y;

      const proj = new EnemyProjectile({
        x: enemy.position.x + dirX * 14,
        y: enemy.position.y - 18 + dirY * 14,
        dirX,
        dirY,
        speed: enemy.projectileSpeed,
        damage: enemy.attackDamage,
        radius: enemy.projectileRadius,
        lifeTime: enemy.projectileLifetime,
        attackerId: enemy.id
      });

      this.enemyProjectiles.push(proj);
      return true;
    }

    /**
     * 실제 근접 공격 판정 시점에 플레이어가 공격 사거리 및 공격 방향 범위 안에 있을 때만 1회 피해 적용
     */
    _executeMeleeStrikeOnce(enemy, player, playerDamageSystem, officeMap = null) {
      enemy.attack.hasAppliedStrike = true;
      enemy.attack.cooldownRemaining = enemy.attack.cooldownTotal;
      enemy.attack.slashTimer = enemy.attack.slashDuration;

      if (!player || player.isDead || player.hp <= 0) {
        return false;
      }

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      const dist = Math.hypot(dx, dy);

      // 1. 공격 사거리 바깥이거나 벽 너머라면 피해 미적용
      if (dist > enemy.attackRange) {
        return false;
      }
      if (
        this._isBlockedByWall(
          enemy.position.x,
          enemy.position.y,
          player.position.x,
          player.position.y,
          officeMap
        )
      ) {
        return false;
      }

      // 2. 공격 조준 방향 전방 부채꼴 범위 확인
      if (dist > 1e-5) {
        const angleToPlayer = Math.atan2(dy, dx);
        const angleDiff = Math.abs(this._normalizeAngle(angleToPlayer - enemy.attack.aimAngle));
        const halfArc = enemy.attackArcRad * 0.5;
        const closePadding = Math.min(0.28, Math.atan2(player.colliderRadius * 0.6, dist));

        if (angleDiff > halfArc + closePadding) {
          return false;
        }
      }

      // 3. 재사용 가능한 플레이어 피해 시스템을 통해 체력 감소(무적 시 자동 무시)
      if (playerDamageSystem) {
        playerDamageSystem.applyDamage(player, enemy.attackDamage, {
          source: 'enemy_melee',
          attackerId: enemy.id
        });
      } else {
        player.takeDamage(enemy.attackDamage, {
          source: 'enemy_melee',
          attackerId: enemy.id
        });
      }
      return true;
    }

    /**
     * 공격 동작 종료 후 플레이어와의 거리를 다시 확인하여 Attack / Chase / Idle 상태로 전환
     */
    _finishAttackAndTransition(enemy, player, officeMap = null) {
      enemy.attack.phase = 'none';
      enemy.attack.timer = 0;

      if (!player || player.isDead || player.hp <= 0) {
        this._returnToIdleFromChase(enemy);
        return;
      }

      const dx = player.position.x - enemy.position.x;
      const dy = player.position.y - enemy.position.y;
      const dist = Math.hypot(dx, dy);
      const wallBlocked = this._isBlockedByWall(
        enemy.position.x,
        enemy.position.y,
        player.position.x,
        player.position.y,
        officeMap
      );

      if (dist <= enemy.attackRange && !wallBlocked && enemy.attack.cooldownRemaining <= 0) {
        this._startAttack(enemy, player);
      } else if (dist <= enemy.detectionRange && !wallBlocked) {
        enemy.state = ENEMY_STATES.CHASE;
        enemy.isPlayerInRange = true;
        enemy.lastKnownPlayerPos = { x: player.position.x, y: player.position.y };
        enemy.lostSightChaseTimer = ENEMY_CONFIG.lostSightChaseDuration;
      } else if (enemy.lastKnownPlayerPos && enemy.lostSightChaseTimer > 0) {
        enemy.state = ENEMY_STATES.CHASE;
        enemy.isPlayerInRange = false;
      } else {
        this._returnToIdleFromChase(enemy);
      }
    }

    _updateIdleState(enemy, dt) {
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;

      enemy.idleTimer -= dt;
      if (enemy.idleTimer <= 0) {
        enemy.state = ENEMY_STATES.PATROL;
        enemy.patrolTimer = ENEMY_CONFIG.maxPatrolDuration;
      }
    }

    _updatePatrolState(enemy, dt, player, officeMap, staticBlockers) {
      const targetX = enemy.patrolOrigin.x + enemy.patrolDir * enemy.patrolDistance;
      const targetY = enemy.patrolOrigin.y;

      const dx = targetX - enemy.position.x;
      const dy = targetY - enemy.position.y;
      const dist = Math.hypot(dx, dy);

      enemy.patrolTimer -= dt;

      if (dist <= ENEMY_CONFIG.arrivalThreshold || enemy.patrolTimer <= 0) {
        this._finishPatrolLeg(enemy);
        return;
      }

      const patrolSpeed = enemy.speed * ENEMY_CONFIG.patrolSpeedRatio;
      const desiredStep = Math.min(patrolSpeed * dt, dist);
      const moved = this._moveTowardsPoint(
        enemy,
        targetX,
        targetY,
        patrolSpeed,
        desiredStep,
        dt,
        player,
        officeMap,
        staticBlockers,
        false
      );

      if (desiredStep > 0.5 && moved < desiredStep * 0.25) {
        this._finishPatrolLeg(enemy);
      }
    }

    _finishPatrolLeg(enemy) {
      enemy.patrolDir *= -1;
      enemy.state = ENEMY_STATES.IDLE;
      enemy.idleTimer = ENEMY_CONFIG.idleDuration;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;
    }

    _updateChaseState(enemy, dt, player, distToPlayer, officeMap, staticBlockers) {
      if (enemy.isPlayerInRange) {
        const dx = player.position.x - enemy.position.x;
        const dy = player.position.y - enemy.position.y;
        enemy.setDirection(dx, dy);

        // Phase 14: 원거리 적(thrower) 카이팅 및 거리 유지 로직 분기
        if (enemy.attackType === 'ranged') {
          return this._updateRangedEnemyChase(
            enemy,
            dt,
            player,
            distToPlayer,
            officeMap,
            staticBlockers
          );
        }

        // 근접 적(ghost, stalker, cabinet, manager)
        if (distToPlayer <= enemy.attackRange) {
          enemy.velocity.x = 0;
          enemy.velocity.y = 0;
          enemy.isMoving = false;
          enemy.walkPhase = 0;

          if (enemy.attack.cooldownRemaining <= 0) {
            this._startAttack(enemy, player);
          }
          return;
        }

        const stopDist = Math.max(
          enemy.chaseStopDistance,
          player.colliderRadius + enemy.colliderRadius + 3
        );
        const remainingDist = distToPlayer - stopDist;

        if (remainingDist <= 0.5) {
          enemy.velocity.x = 0;
          enemy.velocity.y = 0;
          enemy.isMoving = false;
          enemy.walkPhase = 0;
          return;
        }

        const desiredStep = Math.min(enemy.speed * dt, remainingDist);
        this._moveTowardsPoint(
          enemy,
          player.position.x,
          player.position.y,
          enemy.speed,
          desiredStep,
          dt,
          player,
          officeMap,
          staticBlockers,
          true
        );

        // 이번 프레임 이동으로 공격 사거리 안에 진입했고 쿨다운이 끝났다면 즉시 공격 준비 시작
        const newDist = Math.hypot(
          player.position.x - enemy.position.x,
          player.position.y - enemy.position.y
        );
        if (newDist <= enemy.attackRange && enemy.attack.cooldownRemaining <= 0) {
          this._startAttack(enemy, player);
        }
        return;
      }

      // 플레이어가 감지 범위를 벗어난 경우: 짧은 시간 동안 마지막 발견 위치로 이동
      enemy.lostSightChaseTimer -= dt;

      if (!enemy.lastKnownPlayerPos || enemy.lostSightChaseTimer <= 0) {
        this._returnToIdleFromChase(enemy);
        return;
      }

      const dxLast = enemy.lastKnownPlayerPos.x - enemy.position.x;
      const dyLast = enemy.lastKnownPlayerPos.y - enemy.position.y;
      const distToLast = Math.hypot(dxLast, dyLast);

      if (distToLast <= ENEMY_CONFIG.arrivalThreshold) {
        this._returnToIdleFromChase(enemy);
        return;
      }

      const desiredStep = Math.min(enemy.speed * dt, distToLast);
      this._moveTowardsPoint(
        enemy,
        enemy.lastKnownPlayerPos.x,
        enemy.lastKnownPlayerPos.y,
        enemy.speed,
        desiredStep,
        dt,
        player,
        officeMap,
        staticBlockers,
        true
      );
    }

    /**
     * Phase 14: 원거리 적(서류 투척자) 전용 카이팅 AI
     * - 거리가 너무 가까우면(< preferredMinDistance) 반대 방향으로 후퇴
     * - 거리가 너무 멀면(> preferredMaxDistance) 플레이어에게 접근
     * - 적정 거리 내에서는 조준 유지 및 쿨다운 시 투척
     */
    _updateRangedEnemyChase(enemy, dt, player, distToPlayer, officeMap, staticBlockers) {
      const minPreferred = enemy.preferredMinDistance || 150;
      const maxPreferred = enemy.preferredMaxDistance || 230;

      // 1. 공격 쿨다운이 완료되었고 사거리 내이면 공격 시도
      if (distToPlayer <= enemy.attackRange && enemy.attack.cooldownRemaining <= 0) {
        this._startAttack(enemy, player);
        return;
      }

      // 2. 플레이어와의 거리가 너무 가까우면 뒤로 후퇴 (카이팅 kiting)
      if (distToPlayer < minPreferred) {
        const dx = enemy.position.x - player.position.x;
        const dy = enemy.position.y - player.position.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-4) {
          const retreatStep = enemy.speed * dt * 0.95;
          const targetX = enemy.position.x + (dx / len) * 80;
          const targetY = enemy.position.y + (dy / len) * 80;
          this._moveTowardsPoint(
            enemy,
            targetX,
            targetY,
            enemy.speed * 0.95,
            retreatStep,
            dt,
            player,
            officeMap,
            staticBlockers,
            true
          );
        }
        // 시선은 플레이어를 바라봄
        enemy.setDirection(player.position.x - enemy.position.x, player.position.y - enemy.position.y);
        return;
      }

      // 3. 플레이어와의 거리가 너무 멀면 접근
      if (distToPlayer > maxPreferred) {
        const approachDist = distToPlayer - maxPreferred + 15;
        const desiredStep = Math.min(enemy.speed * dt, approachDist);
        this._moveTowardsPoint(
          enemy,
          player.position.x,
          player.position.y,
          enemy.speed,
          desiredStep,
          dt,
          player,
          officeMap,
          staticBlockers,
          true
        );
        return;
      }

      // 4. 적정 유지 거리(150~230px) 안에서는 조준 상태로 대기
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;
      enemy.setDirection(player.position.x - enemy.position.x, player.position.y - enemy.position.y);
    }

    _returnToIdleFromChase(enemy) {
      enemy.state = ENEMY_STATES.IDLE;
      enemy.idleTimer = ENEMY_CONFIG.idleDuration;
      enemy.lastKnownPlayerPos = null;
      enemy.lostSightChaseTimer = 0;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;

      enemy.patrolOrigin.x = enemy.position.x;
      enemy.patrolOrigin.y = enemy.position.y;
    }

    _moveTowardsPoint(
      enemy,
      targetX,
      targetY,
      moveSpeed,
      desiredStep,
      dt,
      player,
      officeMap,
      staticBlockers,
      enableObstacleSteering
    ) {
      const dx = targetX - enemy.position.x;
      const dy = targetY - enemy.position.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= 1e-6 || desiredStep <= 1e-6) {
        enemy.velocity.x = 0;
        enemy.velocity.y = 0;
        enemy.isMoving = false;
        return 0;
      }

      let dirX = dx / dist;
      let dirY = dy / dist;

      if (enableObstacleSteering) {
        const steered = this._chooseSteeringDirection(
          enemy,
          dirX,
          dirY,
          dist,
          targetX,
          targetY,
          officeMap,
          staticBlockers
        );
        dirX = steered.dirX;
        dirY = steered.dirY;
      }

      enemy.velocity.x = dirX * moveSpeed;
      enemy.velocity.y = dirY * moveSpeed;
      enemy.setDirection(dirX, dirY);

      const prevX = enemy.position.x;
      const prevY = enemy.position.y;

      this._applyMovementWithCollisions(
        enemy,
        dirX * desiredStep,
        dirY * desiredStep,
        player,
        officeMap,
        staticBlockers
      );

      const movedDist = Math.hypot(enemy.position.x - prevX, enemy.position.y - prevY);
      enemy.isMoving = movedDist > 0.05;
      if (enemy.isMoving) {
        enemy.walkPhase += dt * (enemy.state === ENEMY_STATES.CHASE ? 10.5 : 6.8);
      }
      return movedDist;
    }

    /**
     * A* 없이 직선 경로상 첫 장애물의 도달 가능한 외곽 모서리로 우회하는 간단한 로컬 회피 처리
     */
    _chooseSteeringDirection(
      enemy,
      baseDirX,
      baseDirY,
      distToTarget,
      targetX,
      targetY,
      officeMap,
      staticBlockers
    ) {
      const radius = enemy.colliderRadius;
      const bounds = officeMap.getPlayableBounds(radius);
      const obstacles = officeMap.getSolidObstacles();
      const ex = enemy.position.x;
      const ey = enemy.position.y;

      let nearestRect = null;
      let nearestT = Infinity;

      for (let i = 0; i < obstacles.length; i++) {
        const rect = obstacles[i];
        const hitT = this._segmentExpandedRectHitT(
          ex,
          ey,
          targetX,
          targetY,
          rect,
          radius + 1.5
        );
        if (hitT !== null && hitT < nearestT) {
          nearestT = hitT;
          nearestRect = rect;
        }
      }

      if (nearestRect) {
        const waypoint = this._pickReachableCornerWaypoint(
          enemy,
          targetX,
          targetY,
          nearestRect,
          obstacles,
          bounds,
          officeMap
        );
        if (waypoint) {
          const wx = waypoint.x - ex;
          const wy = waypoint.y - ey;
          const wLen = Math.hypot(wx, wy);
          if (wLen > 1e-5) {
            return { dirX: wx / wLen, dirY: wy / wLen };
          }
        }
      }

      const lookDist = Math.min(distToTarget, 26);
      const probeX = ex + baseDirX * lookDist;
      const probeY = ey + baseDirY * lookDist;
      for (let i = 0; i < staticBlockers.length; i++) {
        const b = staticBlockers[i];
        if (!b.alive) continue;
        if (Math.hypot(probeX - b.position.x, probeY - b.position.y) < radius + b.radius + 2) {
          const cross = baseDirX * (b.position.y - ey) - baseDirY * (b.position.x - ex);
          const sign = cross >= 0 ? -1 : 1;
          const ang = Math.atan2(baseDirY, baseDirX) + sign * 1.05;
          return { dirX: Math.cos(ang), dirY: Math.sin(ang) };
        }
      }

      return { dirX: baseDirX, dirY: baseDirY };
    }

    _segmentExpandedRectHitT(x0, y0, x1, y1, rect, pad) {
      const minX = rect.x - pad;
      const maxX = rect.x + rect.width + pad;
      const minY = rect.y - pad;
      const maxY = rect.y + rect.height + pad;

      const dx = x1 - x0;
      const dy = y1 - y0;

      let tMin = 0;
      let tMax = 1;

      if (Math.abs(dx) < 1e-8) {
        if (x0 < minX || x0 > maxX) return null;
      } else {
        const invDx = 1 / dx;
        let t1 = (minX - x0) * invDx;
        let t2 = (maxX - x0) * invDx;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }

      if (Math.abs(dy) < 1e-8) {
        if (y0 < minY || y0 > maxY) return null;
      } else {
        const invDy = 1 / dy;
        let t1 = (minY - y0) * invDy;
        let t2 = (maxY - y0) * invDy;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        tMin = Math.max(tMin, t1);
        tMax = Math.min(tMax, t2);
        if (tMin > tMax) return null;
      }

      return tMin;
    }

    _isBlockedByWall(x0, y0, x1, y1, officeMap) {
      if (!officeMap || typeof officeMap.getWalls !== 'function') {
        return false;
      }
      const walls = officeMap.getWalls();
      for (let i = 0; i < walls.length; i++) {
        if (this._segmentExpandedRectHitT(x0, y0, x1, y1, walls[i], 0) !== null) {
          return true;
        }
      }
      return false;
    }

    _pickReachableCornerWaypoint(
      enemy,
      targetX,
      targetY,
      rect,
      obstacles,
      bounds,
      officeMap = null
    ) {
      const r = enemy.colliderRadius;
      const ex = enemy.position.x;
      const ey = enemy.position.y;
      const pad = r + 7;

      const corners = [
        { x: rect.x - pad, y: rect.y - pad },
        { x: rect.x + rect.width + pad, y: rect.y - pad },
        { x: rect.x - pad, y: rect.y + rect.height + pad },
        { x: rect.x + rect.width + pad, y: rect.y + rect.height + pad }
      ];

      let bestCorner = null;
      let bestClearsRect = false;
      let bestCost = Infinity;

      for (let i = 0; i < corners.length; i++) {
        const c = corners[i];
        const cx = this._clamp(c.x, bounds.minX, bounds.maxX);
        const cy = this._clamp(c.y, bounds.minY, bounds.maxY);

        if (
          officeMap &&
          typeof officeMap.isInsideWalkableArea === 'function' &&
          !officeMap.isInsideWalkableArea(cx, cy, Math.max(2, r - 2))
        ) {
          continue;
        }

        const distToCorner = Math.hypot(cx - ex, cy - ey);
        if (distToCorner < 4) {
          continue;
        }

        if (this._segmentExpandedRectHitT(ex, ey, cx, cy, rect, Math.max(2, r - 2.5)) !== null) {
          continue;
        }

        let insideOther = false;
        for (let j = 0; j < obstacles.length; j++) {
          const other = obstacles[j];
          if (other === rect) continue;
          const kx = this._clamp(cx, other.x, other.x + other.width);
          const ky = this._clamp(cy, other.y, other.y + other.height);
          if ((cx - kx) ** 2 + (cy - ky) ** 2 < (r - 1) ** 2) {
            insideOther = true;
            break;
          }
        }
        if (insideOther) {
          continue;
        }

        const clearsRect =
          this._segmentExpandedRectHitT(cx, cy, targetX, targetY, rect, Math.max(2, r - 2)) ===
          null;
        const totalCost = distToCorner + Math.hypot(targetX - cx, targetY - cy);

        if (
          (clearsRect && !bestClearsRect) ||
          (clearsRect === bestClearsRect && totalCost < bestCost)
        ) {
          bestClearsRect = clearsRect;
          bestCost = totalCost;
          bestCorner = { x: cx, y: cy };
        }
      }

      return bestCorner;
    }

    _applyMovementWithCollisions(enemy, moveX, moveY, player, officeMap, staticBlockers) {
      const totalDist = Math.hypot(moveX, moveY);
      const steps = Math.max(1, Math.ceil(totalDist / 8));
      const stepX = moveX / steps;
      const stepY = moveY / steps;

      const radius = enemy.colliderRadius;
      const bounds = officeMap.getPlayableBounds(radius);
      const obstacles = officeMap.getSolidObstacles();

      let nextX = enemy.position.x;
      let nextY = enemy.position.y;

      for (let s = 0; s < steps; s++) {
        nextX = this._clamp(nextX + stepX, bounds.minX, bounds.maxX);
        const afterX = this._resolveStepCollisions(
          nextX,
          nextY,
          radius,
          bounds,
          obstacles,
          staticBlockers,
          player
        );
        nextX = afterX.x;
        nextY = afterX.y;

        nextY = this._clamp(nextY + stepY, bounds.minY, bounds.maxY);
        const afterY = this._resolveStepCollisions(
          nextX,
          nextY,
          radius,
          bounds,
          obstacles,
          staticBlockers,
          player
        );
        nextX = afterY.x;
        nextY = afterY.y;
      }

      enemy.position.x = this._clamp(nextX, bounds.minX, bounds.maxX);
      enemy.position.y = this._clamp(nextY, bounds.minY, bounds.maxY);
    }

    _resolveStepCollisions(cx, cy, radius, bounds, obstacles, staticBlockers, player) {
      let nextX = cx;
      let nextY = cy;

      for (let iter = 0; iter < 2; iter++) {
        nextX = this._clamp(nextX, bounds.minX, bounds.maxX);
        nextY = this._clamp(nextY, bounds.minY, bounds.maxY);

        for (let i = 0; i < staticBlockers.length; i++) {
          const blocker = staticBlockers[i];
          if (!blocker.alive) continue;
          const resC = this._resolveCircleCircle(
            nextX,
            nextY,
            radius,
            blocker.position.x,
            blocker.position.y,
            blocker.radius
          );
          nextX = resC.x;
          nextY = resC.y;
        }

        if (player && !player.isDead && player.hp > 0) {
          const resP = this._resolveCircleCircle(
            nextX,
            nextY,
            radius,
            player.position.x,
            player.position.y,
            player.colliderRadius
          );
          nextX = resP.x;
          nextY = resP.y;
        }

        for (let i = 0; i < obstacles.length; i++) {
          const resR = this._resolveCircleRect(nextX, nextY, radius, obstacles[i]);
          nextX = resR.x;
          nextY = resR.y;
        }
      }

      return { x: nextX, y: nextY };
    }

    _resolveCircleCircle(cx, cy, r1, bx, by, r2) {
      const dx = cx - bx;
      const dy = cy - by;
      const minDist = r1 + r2;
      const distSq = dx * dx + dy * dy;

      if (distSq >= minDist * minDist) {
        return { x: cx, y: cy };
      }

      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        return {
          x: cx + (dx / dist) * overlap,
          y: cy + (dy / dist) * overlap
        };
      }

      return { x: bx + minDist, y: cy };
    }

    _resolveCircleRect(cx, cy, radius, rect) {
      const left = rect.x;
      const right = rect.x + rect.width;
      const top = rect.y;
      const bottom = rect.y + rect.height;

      const closestX = this._clamp(cx, left, right);
      const closestY = this._clamp(cy, top, bottom);

      const distX = cx - closestX;
      const distY = cy - closestY;
      const distSq = distX * distX + distY * distY;

      if (distSq >= radius * radius) {
        return { x: cx, y: cy };
      }

      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        return {
          x: cx + (distX / dist) * overlap,
          y: cy + (distY / dist) * overlap
        };
      }

      const penLeft = cx - left;
      const penRight = right - cx;
      const penTop = cy - top;
      const penBottom = bottom - cy;
      const minPen = Math.min(penLeft, penRight, penTop, penBottom);

      if (minPen === penLeft) return { x: left - radius, y: cy };
      if (minPen === penRight) return { x: right + radius, y: cy };
      if (minPen === penTop) return { x: cx, y: top - radius };
      return { x: cx, y: bottom + radius };
    }

    _normalizeAngle(rad) {
      let angle = rad % (Math.PI * 2);
      if (angle > Math.PI) angle -= Math.PI * 2;
      if (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    }

    _clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
  }

  PO.ENEMY_STATES = ENEMY_STATES;
  PO.ENEMY_CONFIG = ENEMY_CONFIG;
  PO.ENEMY_DEFINITIONS = ENEMY_DEFINITIONS;
  PO.EnemyProjectile = EnemyProjectile;
  PO.Enemy = Enemy;
  PO.EnemySystem = EnemySystem;
})(window);
