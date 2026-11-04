(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 적 AI 상태 상수 정의
   */
  const ENEMY_STATES = Object.freeze({
    IDLE: 'Idle',
    PATROL: 'Patrol',
    CHASE: 'Chase',
    DEAD: 'Dead'
  });

  /**
   * 기본 적 밸런스 및 AI 동작 설정값 (추후 조정 용이하도록 별도 상수 객체로 관리)
   */
  const ENEMY_CONFIG = {
    maxHp: 100, // 적 기본 체력: 100
    speedRatioToPlayer: 0.65, // 플레이어 일반 이동 속도(260) 대비 약 65%
    moveSpeed: 169, // 기본 추적 이동 속도 (260 * 0.65 = 169 px/sec)
    patrolSpeedRatio: 0.6, // 순찰 이동 시 속도 비율
    detectionRange: 250, // 플레이어 감지 범위: 약 250px
    colliderRadius: 17, // 바닥 원형 충돌 반경 (px)
    chaseStopDistance: 37, // 플레이어와 겹침·떨림 방지 정지 거리 (16 + 17 + 4)
    lostSightChaseDuration: 2.0, // 감지 이탈 후 마지막 발견 위치 추적 유지 시간 (초)
    arrivalThreshold: 8, // 목표 지점(순찰/마지막 발견 위치) 도착 판정 반경 (px)
    patrolDistance: 56, // 제자리 주변 짧은 순찰 거리 (px)
    idleDuration: 1.0, // 대기(Idle) 상태 유지 시간 (초)
    maxPatrolDuration: 1.8, // 단일 순찰 구간 최대 이동 시간 (초)
    hitFlashDuration: 0.14, // 피격 점멸 피드백 시간 (초)
    hitShakeDuration: 0.18, // 피격 흔들림 피드백 시간 (초)
    alertPopDuration: 0.45, // 플레이어 발견 시 느낌표(!) 표시 시간 (초)
    deathDuration: 0.45 // 사망 연출 지속 시간 후 제거 (초)
  };

  /**
   * 기본 적 엔티티 데이터 및 상태 모델 (플레이어 및 테스트 타깃과 분리)
   */
  class Enemy {
    constructor(config = {}) {
      this.id = config.id ?? 'enemy-1';
      this.isEnemy = true;

      // 위치 (쿼터뷰 바닥 접지면 중심 좌표)
      this.position = {
        x: config.x ?? 1005,
        y: config.y ?? 415
      };

      // 체력 및 이동/감지 수치
      this.maxHp = config.maxHp ?? ENEMY_CONFIG.maxHp;
      this.hp = config.hp ?? this.maxHp;
      this.speed =
        config.speed ??
        (config.playerBaseSpeed
          ? config.playerBaseSpeed * ENEMY_CONFIG.speedRatioToPlayer
          : ENEMY_CONFIG.moveSpeed);
      this.detectionRange = config.detectionRange ?? ENEMY_CONFIG.detectionRange;

      // 충돌 반경 (MovementSystem 및 CombatSystem 공통 호환을 위해 두 속성 동기화)
      this.colliderRadius = config.colliderRadius ?? ENEMY_CONFIG.colliderRadius;
      this.radius = this.colliderRadius;
      this.chaseStopDistance = config.chaseStopDistance ?? ENEMY_CONFIG.chaseStopDistance;

      // 현재 AI 상태 (Idle, Patrol, Chase, Dead)
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

      // 장애물 우회 방향 일관성 유지를 위한 단기 회피 상태
      this.avoidSign = 1;
      this.avoidCommitTimer = 0;

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
     * 체력이 0 이하가 되었을 때 즉시 Dead 상태로 전환하고 추적/충돌을 비활성화한다.
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
   * 적 AI 상태 전이(Idle / Patrol / Chase / Dead), 플레이어 추적, 장애물 충돌 및 회피를 담당하는 시스템
   */
  class EnemySystem {
    constructor(initialEnemies = []) {
      this.enemies = initialEnemies.map((cfg) => (cfg instanceof Enemy ? cfg : new Enemy(cfg)));
    }

    /**
     * 테스트 사무실 맵의 기본 적 1마리 초기 배치 데이터 반환
     * (플레이어 시작점(640, 455)으로부터 약 367px 떨어진 우측 복도에 배치하여 초기 대기/순찰 확인 가능)
     */
    static createDefaultEnemies(playerBaseSpeed = 260) {
      return [
        {
          id: 'enemy-office-1',
          x: 1005,
          y: 415,
          playerBaseSpeed,
          maxHp: ENEMY_CONFIG.maxHp,
          detectionRange: ENEMY_CONFIG.detectionRange
        }
      ];
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
     * 매 프레임 적 AI, 이동, 타이머, 사망 후 제거 처리
     */
    update(dt, player, officeMap, staticBlockers = []) {
      if (dt <= 0) {
        return;
      }

      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const enemy = this.enemies[i];

        // 1. 피격 시각 타이머 및 발견 알림 타이머 감소
        if (enemy.hitFlashTimer > 0) {
          enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
        }
        if (enemy.shakeTimer > 0) {
          enemy.shakeTimer = Math.max(0, enemy.shakeTimer - dt);
        }
        if (enemy.alertTimer > 0) {
          enemy.alertTimer = Math.max(0, enemy.alertTimer - dt);
        }
        if (enemy.avoidCommitTimer > 0) {
          enemy.avoidCommitTimer = Math.max(0, enemy.avoidCommitTimer - dt);
        }

        // 2. Dead 상태: 추적/판정에 참여하지 않고 사망 연출 완료 후 목록에서 제거
        if (enemy.state === ENEMY_STATES.DEAD || !enemy.alive) {
          enemy.deathTimer += dt;
          if (enemy.deathTimer >= enemy.deathDuration) {
            enemy.shouldRemove = true;
            this.enemies.splice(i, 1);
          }
          continue;
        }

        // 3. 플레이어 거리 및 감지 범위(250px) 판정
        const dxToPlayer = player.position.x - enemy.position.x;
        const dyToPlayer = player.position.y - enemy.position.y;
        const distToPlayer = Math.hypot(dxToPlayer, dyToPlayer);
        const detectedNow = distToPlayer <= enemy.detectionRange;

        enemy.isPlayerInRange = detectedNow;

        if (detectedNow) {
          if (enemy.state !== ENEMY_STATES.CHASE) {
            enemy.state = ENEMY_STATES.CHASE;
            enemy.alertTimer = ENEMY_CONFIG.alertPopDuration;
          }
          enemy.lastKnownPlayerPos = {
            x: player.position.x,
            y: player.position.y
          };
          enemy.lostSightChaseTimer = ENEMY_CONFIG.lostSightChaseDuration;
        }

        // 4. 상태별 AI 행동 수행
        switch (enemy.state) {
          case ENEMY_STATES.IDLE:
            this._updateIdleState(enemy, dt);
            break;
          case ENEMY_STATES.PATROL:
            this._updatePatrolState(enemy, dt, player, officeMap, staticBlockers);
            break;
          case ENEMY_STATES.CHASE:
            this._updateChaseState(enemy, dt, player, distToPlayer, officeMap, staticBlockers);
            break;
          default:
            break;
        }
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

      // 순찰 중 벽이나 장애물에 가로막혀 거의 전진하지 못하면 반대 방향으로 전환 후 대기
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
        // 플레이어가 감지 범위 내에 있을 때: 실시간 플레이어 위치를 향해 추적
        const dx = player.position.x - enemy.position.x;
        const dy = player.position.y - enemy.position.y;
        enemy.setDirection(dx, dy);

        // 플레이어와 겹쳐서 떨리는 현상 방지를 위해 최소 정지 거리 확보
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
        return;
      }

      // 플레이어가 감지 범위를 벗어난 경우: 즉시 멈추지 않고 짧은 시간 동안 마지막 발견 위치로 이동
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

    _returnToIdleFromChase(enemy) {
      enemy.state = ENEMY_STATES.IDLE;
      enemy.idleTimer = ENEMY_CONFIG.idleDuration;
      enemy.lastKnownPlayerPos = null;
      enemy.lostSightChaseTimer = 0;
      enemy.velocity.x = 0;
      enemy.velocity.y = 0;
      enemy.isMoving = false;
      enemy.walkPhase = 0;

      // 현재 도달한 위치를 새로운 짧은 순찰 기준점으로 갱신
      enemy.patrolOrigin.x = enemy.position.x;
      enemy.patrolOrigin.y = enemy.position.y;
    }

    /**
     * 목표 지점을 향해 정규화된 방향 계산 + 간단한 장애물 우회 + 서브스테핑 충돌 해결 수행
     */
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

      // 대각선 이동 시에도 속도가 일정하도록 단위 벡터로 정규화
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

      // 1. 목표 지점까지의 직선 구간에서 가장 먼저 가로막는 사각형 장애물 탐색
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
          bounds
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

      // 2. 전방 근거리 원형 장애물(테스트 타겟 더미 등)에 대한 간단한 접선 회피
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

    /**
     * 선분 (x0,y0)->(x1,y1)이 반경 pad만큼 확장된 사각형과 교차하는 최소 진행 비율 t(0~1) 반환
     */
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

    /**
     * 가로막힌 사각형 장애물의 4개 외곽 모서리 중 현재 위치에서 바로 이동 가능하고 우회 거리가 가장 짧은 지점 선택
     */
    _pickReachableCornerWaypoint(enemy, targetX, targetY, rect, obstacles, bounds) {
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

        // 이미 도달한 모서리는 건너뜀
        const distToCorner = Math.hypot(cx - ex, cy - ey);
        if (distToCorner < 4) {
          continue;
        }

        // 모서리로 향하는 직선이 해당 장애물 내부 몸통을 가로지르면 직접 도달 불가
        if (this._segmentExpandedRectHitT(ex, ey, cx, cy, rect, Math.max(2, r - 2.5)) !== null) {
          continue;
        }

        // 모서리 좌표 자체가 다른 고체 장애물 내부에 박혀 있는 경우 제외
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

        // 해당 모서리에서 목표 지점까지 직선이 이 장애물을 완전히 벗어나는지 여부 우선 판별
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

    /**
     * 축별 분리 이동 + 원-사각형/원-원 밀어내기를 결합하여 벽·책상 관통 방지 및 자연스러운 슬라이딩 처리
     */
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
        // X축 이동 후 충돌 해결, 이어서 Y축 이동 후 충돌 해결 (축별 슬라이딩 보장)
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

        if (player && player.hp > 0) {
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

    _clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
  }

  PO.ENEMY_STATES = ENEMY_STATES;
  PO.ENEMY_CONFIG = ENEMY_CONFIG;
  PO.Enemy = Enemy;
  PO.EnemySystem = EnemySystem;
})(window);
