(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * Phase 10: 보스 AI 및 전투 상태 상수 정의
   */
  const BOSS_STATES = Object.freeze({
    IDLE: 'Idle',
    CHASE: 'Chase',
    TELEGRAPH: 'Telegraph',
    ATTACK: 'Attack',
    RECOVERY: 'Recovery',
    DEAD: 'Dead'
  });

  /**
   * 보스 공격 패턴 종류 상수 정의
   * - MELEE_SWING: 전방 부채꼴 휘두르기 (패턴 A)
   * - FLOOR_SLAM: 바닥 원형 범위 강타 (패턴 B)
   */
  const BOSS_ATTACK_PATTERNS = Object.freeze({
    MELEE_SWING: 'melee_swing',
    FLOOR_SLAM: 'floor_slam',
    GROUND_SLAM: 'floor_slam'
  });

  /**
   * 보스 '야근 감독관' 기본 설정값 (별도 상수 객체로 분리 관리)
   */
  const BOSS_CONFIG = Object.freeze({
    name: '야근 감독관',
    maxHp: 500,
    // 이동 속도: 일반 적(169px/s)보다 느림 (약 120px/s)
    speed: 120,
    colliderRadius: 30, // 바닥 충돌 반경
    zHeight: 52, // 쿼터뷰 높이

    // 플레이어 감지 및 추적 거리
    detectionRange: 420,
    chaseStopDistance: 65,

    // 공격 패턴 공통 쿨다운 (초)
    attackCooldown: 1.1,

    // 패턴 A: 근접 휘두르기 설정값
    melee: Object.freeze({
      triggerDistance: 92, // 접근 시 발동 사거리 (px)
      telegraphDuration: 0.6, // 예고 시간 (초)
      attackDuration: 0.16, // 타격 판정 시간 (초)
      recoveryDuration: 0.5, // 후딜레이 시간 (초)
      range: 96, // 공격 사거리 (px)
      arcDegrees: 130, // 공격 각도 (도)
      damage: 25 // 공격 피해량
    }),

    // 패턴 B: 바닥 범위 강타 설정값
    slam: Object.freeze({
      triggerDistanceMin: 80, // 원거리/중거리 발동 거리
      telegraphDuration: 0.8, // 예고 시간 (초)
      attackDuration: 0.2, // 판정 지속 시간 (초)
      recoveryDuration: 0.6, // 후딜레이 시간 (초)
      radius: 72, // 바닥 경고 장판 반경 (px)
      damage: 30 // 공격 피해량
    }),

    // 시각 피드백 타이머 설정값
    hitFlashDuration: 0.14,
    hitShakeDuration: 0.2,
    deathDuration: 1.5
  });

  /**
   * Phase 10: 단독 독립 보스 엔티티 클래스 (야근 감독관)
   * - 일반 적 AI와 분리된 전용 상태 머신 (Idle -> Chase -> Telegraph -> Attack -> Recovery -> Dead)
   * - 패턴 A (전방 휘두르기) 및 패턴 B (바닥 범위 공격) 탑재
   * - 플레이어 공격(근접/원거리) 피격 판정 및 PlayerDamageSystem 연동 피해 적용
   */
  class Boss {
    constructor(config = {}) {
      this.id = config.id || 'boss-overtime-director';
      this.name = config.name || BOSS_CONFIG.name;
      this.isBoss = true;
      this.roomId = config.roomId || 'room-boss';

      // 쿼터뷰 바닥 접지면 중심 좌표
      this.position = {
        x: config.x || 1200,
        y: config.y || 800
      };

      // 체력 및 스탯
      this.maxHp = config.maxHp || BOSS_CONFIG.maxHp;
      this.hp = config.hp !== undefined ? config.hp : this.maxHp;
      this.speed = config.speed || BOSS_CONFIG.speed;
      this.colliderRadius = config.colliderRadius || BOSS_CONFIG.colliderRadius;
      this.radius = this.colliderRadius;
      this.zHeight = config.zHeight || BOSS_CONFIG.zHeight;

      // 상태 머신
      this.state = BOSS_STATES.IDLE;
      this.alive = this.hp > 0;
      this.isAwakened = false;

      // 방향 및 속도
      this.direction = {
        x: 0,
        y: 1,
        angle: Math.PI * 0.5,
        facing: 'down'
      };
      this.velocity = { x: 0, y: 0 };
      this.isMoving = false;
      this.walkPhase = 0;

      // 공격 쿨다운 및 패턴 관리
      this.attackCooldownRemaining = 0.5; // 방 진입 직후 0.5초간 짧은 대기 후 공격 개시
      this.lastPattern = null;
      this.patternSequenceCount = 0;

      // 현재 진행 중인 공격 상태 데이터
      this.currentAttack = {
        pattern: null, // 'melee_swing' | 'floor_slam'
        phase: 'none', // 'none' | 'telegraph' | 'attack' | 'recovery'
        timer: 0,
        totalTelegraph: 0,
        totalRecovery: 0,
        hasHitPlayer: false, // 다중 프레임 중복 타격 방지 플래그

        // 패턴 A: 근접 부채꼴 전용 데이터
        aimAngle: Math.PI * 0.5,
        aimDirX: 0,
        aimDirY: 1,
        range: BOSS_CONFIG.melee.range,
        arcRad: (BOSS_CONFIG.melee.arcDegrees * Math.PI) / 180,
        damage: BOSS_CONFIG.melee.damage,

        // 패턴 B: 바닥 범위 공격 전용 데이터
        targetX: 0,
        targetY: 0,
        slamRadius: BOSS_CONFIG.slam.radius,
        slamDamage: BOSS_CONFIG.slam.damage
      };

      // 피격 및 사망 연출
      this.hitFlashTimer = 0;
      this.shakeTimer = 0;
      this.lastHitDirX = 0;
      this.deathTimer = 0;
      this.hasTriggeredDeath = false;

      // 시각 이펙트 목록 (렌더러 전달용)
      this.activeSlamRings = [];
      this.activeSlashArcs = [];
    }

    get x() {
      return this.position.x;
    }

    set x(val) {
      this.position.x = val;
    }

    get y() {
      return this.position.y;
    }

    set y(val) {
      this.position.y = val;
    }

    get awakened() {
      return this.isAwakened;
    }

    get isHitFlash() {
      return this.hitFlashTimer > 0;
    }

    get currentPattern() {
      return this.currentAttack ? this.currentAttack.pattern : null;
    }

    get telegraphTimer() {
      return this.currentAttack ? this.currentAttack.timer : 0;
    }

    get telegraphDuration() {
      return this.currentAttack ? this.currentAttack.totalTelegraph : 0;
    }

    get recoveryTimer() {
      return this.currentAttack ? this.currentAttack.timer : 0;
    }

    get targetAngle() {
      return this.currentAttack ? this.currentAttack.aimAngle : 0;
    }

    get slamTarget() {
      if (
        !this.currentAttack ||
        (this.currentAttack.pattern !== BOSS_ATTACK_PATTERNS.FLOOR_SLAM &&
          this.currentAttack.pattern !== 'ground_slam')
      ) {
        return null;
      }
      return {
        x: this.currentAttack.targetX,
        y: this.currentAttack.targetY,
        radius: this.currentAttack.slamRadius || BOSS_CONFIG.slam.radius
      };
    }

    get patternCooldownTimer() {
      return this.attackCooldownRemaining;
    }

    set patternCooldownTimer(v) {
      this.attackCooldownRemaining = v;
    }

    get attackCooldownTimer() {
      return this.attackCooldownRemaining;
    }

    set attackCooldownTimer(v) {
      this.attackCooldownRemaining = v;
    }

    /**
     * 외부 테스트 및 스크립트용 공격 패턴 시작 헬퍼
     */
    _startAttackPattern(pattern, player) {
      return this._startTelegraph(pattern, player);
    }

    /**
     * 보스 활성화(각성): 플레이어가 보스 방에 진입하여 문이 잠겼을 때 호출
     */
    awaken() {
      if (this.state === BOSS_STATES.DEAD) {
        return;
      }
      this.isAwakened = true;
      if (this.state === BOSS_STATES.IDLE) {
        this.state = BOSS_STATES.CHASE;
      }
    }

    /**
     * 보스 사망 여부 확인
     */
    isDead() {
      return this.hp <= 0 || this.state === BOSS_STATES.DEAD;
    }

    isAlive() {
      return !this.isDead();
    }

    /**
     * Y-소팅 기준 좌표
     */
    getSortY() {
      return this.position.y;
    }

    /**
     * 방향 벡터 갱신
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
     * Phase 16: 보스는 전기 충격봉 등의 모든 경직(Stun) 상태이상에 완전 면역
     * @returns {boolean} 면역 처리 (항상 false)
     */
    applyStun(_duration) {
      return false;
    }

    /**
     * 플레이어 공격(근접/원거리) 피격 처리
     * @param {number} amount 피해량
     * @param {number} hitDirX 피격 방향
     */
    takeDamage(amount, hitDirX = 0) {
      if (!this.alive || this.isDead() || amount <= 0) {
        return 0;
      }

      const prevHp = this.hp;
      const actualDamage = Math.min(this.hp, Math.round(amount));
      this.hp = Math.max(0, this.hp - actualDamage);

      this.hitFlashTimer = BOSS_CONFIG.hitFlashDuration;
      this.shakeTimer = BOSS_CONFIG.hitShakeDuration;
      this.lastHitDirX = hitDirX;

      // 피격 시 비활성 상태였다면 즉시 각성하여 반격
      if (!this.isAwakened && this.state === BOSS_STATES.IDLE) {
        this.awaken();
      }

      if (this.hp <= 0 && !this.hasTriggeredDeath) {
        this._die();
      }

      return actualDamage;
    }

    /**
     * 보스 사망 상태 전환 (단 1회만 실행)
     */
    _die() {
      this.hp = 0;
      this.alive = false;
      this.hasTriggeredDeath = true;
      this.state = BOSS_STATES.DEAD;
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isMoving = false;
      this.walkPhase = 0;
      this.deathTimer = BOSS_CONFIG.deathDuration;

      // 진행 중이던 공격 즉시 취소
      this.currentAttack.phase = 'none';
      this.currentAttack.pattern = null;

      // Phase 15: 보스 처치 시 콜백(아이템 100% 드롭 등) 호출
      if (typeof this.onDeath === 'function') {
        this.onDeath(this);
      }
    }

    /**
     * 매 프레임 보스 AI 상태 업데이트
     * @param {number} dt 델타 타임 (초)
     * @param {object} player 플레이어 객체
     * @param {object} officeMap 맵 객체
     * @param {object} playerDamageSystem 플레이어 피해 시스템
     */
    update(dt, player, officeMap, playerDamageSystem) {
      // 1. 피격 플래시 및 흔들림 타이머 감소
      if (this.hitFlashTimer > 0) {
        this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      }
      if (this.shakeTimer > 0) {
        this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      }

      // 2. 공격 쿨다운 감소
      if (this.attackCooldownRemaining > 0) {
        this.attackCooldownRemaining = Math.max(0, this.attackCooldownRemaining - dt);
      }

      // 3. 잔여 시각 이펙트(장판/휘두르기 잔상) 타이머 갱신
      this._updateVisualEffects(dt);

      // 사망 상태일 경우 추가 AI 동작 중단
      if (this.isDead()) {
        if (this.deathTimer > 0) {
          this.deathTimer = Math.max(0, this.deathTimer - dt);
        }
        return;
      }

      if (!player || player.isDead) {
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.isMoving = false;
        return;
      }

      const dx = player.position.x - this.position.x;
      const dy = player.position.y - this.position.y;
      const distToPlayer = Math.hypot(dx, dy);

      // 플레이어 방향으로 기본 시선 회전 (공격 중에는 조준 고정)
      if (this.state !== BOSS_STATES.TELEGRAPH && this.state !== BOSS_STATES.ATTACK) {
        this.setDirection(dx, dy);
      }

      // 4. 상태별 로직 처리
      switch (this.state) {
        case BOSS_STATES.IDLE:
          this._updateIdle(distToPlayer);
          break;
        case BOSS_STATES.CHASE:
          this._updateChase(dt, player, distToPlayer, officeMap);
          break;
        case BOSS_STATES.TELEGRAPH:
          this._updateTelegraph(dt, player, playerDamageSystem);
          break;
        case BOSS_STATES.ATTACK:
          this._updateAttack(dt, player, playerDamageSystem);
          break;
        case BOSS_STATES.RECOVERY:
          this._updateRecovery(dt);
          break;
        default:
          break;
      }
    }

    _updateIdle(distToPlayer) {
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isMoving = false;

      // 각성 상태이거나 플레이어가 감지 범위 내에 들어오면 즉시 추적으로 전환
      if (this.isAwakened || distToPlayer <= BOSS_CONFIG.detectionRange) {
        this.awaken();
      }
    }

    _updateChase(dt, player, distToPlayer, officeMap) {
      // 공격 쿨다운이 만료되었을 때 패턴 시작 검사
      if (this.attackCooldownRemaining <= 0) {
        const chosenPattern = this._selectAttackPattern(distToPlayer);
        if (chosenPattern) {
          this._startTelegraph(chosenPattern, player);
          return;
        }
      }

      // 정지 거리 도달 시 멈춤
      if (distToPlayer <= BOSS_CONFIG.chaseStopDistance) {
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.isMoving = false;
        return;
      }

      // 플레이어를 향해 이동
      const dirX = (player.position.x - this.position.x) / distToPlayer;
      const dirY = (player.position.y - this.position.y) / distToPlayer;
      const step = Math.min(this.speed * dt, distToPlayer - BOSS_CONFIG.chaseStopDistance);

      this.velocity.x = dirX * this.speed;
      this.velocity.y = dirY * this.speed;
      this.isMoving = true;
      this.walkPhase = (this.walkPhase + dt * 5.5) % (Math.PI * 2);

      this._applyMovementWithCollision(dirX * step, dirY * step, officeMap, player);

      // 이동 후 공격 사거리 내에 도달했고 쿨다운이 끝났다면 즉시 공격 시작
      const newDist = Math.hypot(
        player.position.x - this.position.x,
        player.position.y - this.position.y
      );
      if (this.attackCooldownRemaining <= 0) {
        const pattern = this._selectAttackPattern(newDist);
        if (pattern) {
          this._startTelegraph(pattern, player);
        }
      }
    }

    /**
     * 거리 및 교대 순서에 따른 공격 패턴 선택
     * - 거리가 약 95px 이하: 전방 휘두르기(Melee) 우선 고려
     * - 거리가 약 95px 이상이거나 직전 패턴이 근접이었을 경우: 바닥 강타(Slam) 고려
     * - 두 패턴이 편향되지 않도록 번갈아 실행
     */
    _selectAttackPattern(distToPlayer) {
      this.patternSequenceCount++;

      if (distToPlayer <= BOSS_CONFIG.melee.triggerDistance) {
        // 근접 거리에서는 휘두르기 우선, 단 2연속 휘두르기 후에는 바닥 강타 가능
        if (this.lastPattern === BOSS_ATTACK_PATTERNS.MELEE_SWING) {
          return BOSS_ATTACK_PATTERNS.FLOOR_SLAM;
        }
        return BOSS_ATTACK_PATTERNS.MELEE_SWING;
      }

      // 중·원거리에서는 플레이어 위치에 바닥 강타 시전
      return BOSS_ATTACK_PATTERNS.FLOOR_SLAM;
    }

    /**
     * 공격 예고(Telegraph) 시작
     */
    _startTelegraph(pattern, player) {
      this.state = BOSS_STATES.TELEGRAPH;
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isMoving = false;
      this.lastPattern = pattern;

      const att = this.currentAttack;
      att.pattern = pattern;
      att.phase = 'telegraph';
      att.timer = 0;
      att.hasHitPlayer = false;

      const dx = player.position.x - this.position.x;
      const dy = player.position.y - this.position.y;
      const angle = Math.atan2(dy, dx);
      this.setDirection(dx, dy);

      if (pattern === BOSS_ATTACK_PATTERNS.MELEE_SWING) {
        att.totalTelegraph = BOSS_CONFIG.melee.telegraphDuration;
        att.totalRecovery = BOSS_CONFIG.melee.recoveryDuration;
        att.aimAngle = angle;
        att.aimDirX = Math.cos(angle);
        att.aimDirY = Math.sin(angle);
        att.range = BOSS_CONFIG.melee.range;
        att.arcRad = (BOSS_CONFIG.melee.arcDegrees * Math.PI) / 180;
        att.damage = BOSS_CONFIG.melee.damage;
      } else {
        // 패턴 B: 예고가 시작되는 순간의 플레이어 발밑 좌표에 경고 장판 고정!
        att.totalTelegraph = BOSS_CONFIG.slam.telegraphDuration;
        att.totalRecovery = BOSS_CONFIG.slam.recoveryDuration;
        att.targetX = player.position.x;
        att.targetY = player.position.y;
        att.slamRadius = BOSS_CONFIG.slam.radius;
        att.slamDamage = BOSS_CONFIG.slam.damage;
      }
    }

    _updateTelegraph(dt, player, playerDamageSystem) {
      const att = this.currentAttack;
      att.timer += dt;

      // 예고 시간이 만료되면 즉시 판정(Attack) 상태로 전이
      if (att.timer >= att.totalTelegraph) {
        this._startAttackStrike(player, playerDamageSystem);
      }
    }

    /**
     * 실제 타격 판정 및 시각 이펙트 발동
     */
    _startAttackStrike(player, playerDamageSystem) {
      this.state = BOSS_STATES.ATTACK;
      const att = this.currentAttack;
      att.phase = 'attack';
      att.timer = 0;

      if (att.pattern === BOSS_ATTACK_PATTERNS.MELEE_SWING) {
        // 전방 휘두르기 타격 판정
        this._resolveMeleeStrike(player, playerDamageSystem);

        // 시각 이펙트(휘두르기 부채꼴 아크) 등록
        this.activeSlashArcs.push({
          x: this.position.x,
          y: this.position.y,
          aimAngle: att.aimAngle,
          arcRad: att.arcRad,
          range: att.range,
          elapsed: 0,
          duration: BOSS_CONFIG.melee.attackDuration + 0.08
        });
      } else {
        // 바닥 범위 강타 판정
        this._resolveSlamStrike(player, playerDamageSystem);

        // 시각 이펙트(바닥 충격파 링) 등록
        this.activeSlamRings.push({
          x: att.targetX,
          y: att.targetY,
          radius: att.slamRadius,
          elapsed: 0,
          duration: BOSS_CONFIG.slam.attackDuration + 0.15
        });
      }
    }

    _updateAttack(dt, player, playerDamageSystem) {
      const att = this.currentAttack;
      att.timer += dt;

      const attackDuration =
        att.pattern === BOSS_ATTACK_PATTERNS.MELEE_SWING
          ? BOSS_CONFIG.melee.attackDuration
          : BOSS_CONFIG.slam.attackDuration;

      if (att.timer >= attackDuration) {
        // 후딜레이(Recovery)로 전환
        this.state = BOSS_STATES.RECOVERY;
        att.phase = 'recovery';
        att.timer = 0;
      }
    }

    _updateRecovery(dt) {
      const att = this.currentAttack;
      att.timer += dt;

      if (att.timer >= att.totalRecovery) {
        // 후딜레이 종료 -> Chase 상태 복귀 및 다음 공격 쿨다운 시작
        this.state = BOSS_STATES.CHASE;
        att.phase = 'none';
        att.pattern = null;
        this.attackCooldownRemaining = BOSS_CONFIG.attackCooldown;
      }
    }

    /**
     * 패턴 A 판정: 전방 부채꼴 범위 내 플레이어 피격 검사 (1회만 적용)
     */
    _resolveMeleeStrike(player, playerDamageSystem) {
      const att = this.currentAttack;
      if (att.hasHitPlayer || !player || player.isDead) {
        return;
      }

      const dx = player.position.x - this.position.x;
      const dy = player.position.y - this.position.y;
      const dist = Math.hypot(dx, dy);

      // 거리 검사 (보스 공격 사거리 + 플레이어 충돌 반경)
      if (dist > att.range + player.colliderRadius) {
        return;
      }

      // 각도 검사
      const angleToPlayer = Math.atan2(dy, dx);
      const angleDiff = Math.abs(this._normalizeAngle(angleToPlayer - att.aimAngle));
      const halfArc = att.arcRad * 0.5 + 0.15; // 모서리 판정 여유폭

      if (angleDiff <= halfArc) {
        att.hasHitPlayer = true;
        this._applyDamageToPlayer(
          player,
          att.damage,
          playerDamageSystem,
          'boss_melee',
          att.aimDirX
        );
      }
    }

    /**
     * 패턴 B 판정: 바닥 원형 장판 내 플레이어 피격 검사 (1회만 적용)
     * - 플레이어가 대시 무적 상태이거나 장판 밖으로 회피한 경우 피해를 입지 않음!
     */
    _resolveSlamStrike(player, playerDamageSystem) {
      const att = this.currentAttack;
      if (att.hasHitPlayer || !player || player.isDead) {
        return;
      }

      const dist = Math.hypot(
        player.position.x - att.targetX,
        player.position.y - att.targetY
      );

      // 원형 범위 내에 플레이어가 위치하는지 검사
      if (dist <= att.slamRadius + player.colliderRadius) {
        att.hasHitPlayer = true;
        const hitDirX = player.position.x >= att.targetX ? 1 : -1;
        this._applyDamageToPlayer(
          player,
          att.slamDamage,
          playerDamageSystem,
          'boss_slam',
          hitDirX
        );
      }
    }

    /**
     * 플레이어에게 피해를 안전하게 전달 (대시 무적 판정 완벽 연동)
     */
    _applyDamageToPlayer(player, damage, playerDamageSystem, sourceTag, hitDirX) {
      if (playerDamageSystem && typeof playerDamageSystem.applyDamage === 'function') {
        playerDamageSystem.applyDamage(player, damage, {
          source: sourceTag,
          dirX: hitDirX
        });
      } else if (playerDamageSystem && typeof playerDamageSystem.dealDamage === 'function') {
        playerDamageSystem.dealDamage(player, damage, {
          source: sourceTag,
          dirX: hitDirX,
          damageText: `-${damage}`
        });
      } else if (typeof player.takeDamage === 'function') {
        player.takeDamage(damage, {
          source: sourceTag,
          dirX: hitDirX
        });
      }
    }

    /**
     * 이동 및 벽/장애물 충돌 처리
     */
    _applyMovementWithCollision(moveX, moveY, officeMap, player) {
      if (!officeMap) {
        this.position.x += moveX;
        this.position.y += moveY;
        return;
      }

      const radius = this.colliderRadius;
      const bounds = officeMap.getPlayableBounds(radius);
      const obstacles = officeMap.getSolidObstacles();

      let targetX = this._clamp(this.position.x + moveX, bounds.minX, bounds.maxX);
      let targetY = this._clamp(this.position.y + moveY, bounds.minY, bounds.maxY);

      // 고체 장애물 및 플레이어와의 원형-원형 밀어내기 충돌
      for (let iter = 0; iter < 2; iter++) {
        // 플레이어 밀어내기
        if (player && !player.isDead) {
          const dx = targetX - player.position.x;
          const dy = targetY - player.position.y;
          const minDist = radius + player.colliderRadius;
          const distSq = dx * dx + dy * dy;
          if (distSq < minDist * minDist && distSq > 1e-6) {
            const d = Math.sqrt(distSq);
            const push = minDist - d;
            targetX += (dx / d) * push * 0.5;
            targetY += (dy / d) * push * 0.5;
          }
        }

        // 고체 장애물 충돌
        for (let i = 0; i < obstacles.length; i++) {
          const rect = obstacles[i];
          const closestX = this._clamp(targetX, rect.x, rect.x + rect.width);
          const closestY = this._clamp(targetY, rect.y, rect.y + rect.height);
          const distX = targetX - closestX;
          const distY = targetY - closestY;
          const dSq = distX * distX + distY * distY;
          if (dSq < radius * radius && dSq > 1e-6) {
            const d = Math.sqrt(dSq);
            const pen = radius - d;
            targetX += (distX / d) * pen;
            targetY += (distY / d) * pen;
          }
        }
      }

      this.position.x = this._clamp(targetX, bounds.minX, bounds.maxX);
      this.position.y = this._clamp(targetY, bounds.minY, bounds.maxY);
    }

    _updateVisualEffects(dt) {
      for (let i = this.activeSlashArcs.length - 1; i >= 0; i--) {
        const arc = this.activeSlashArcs[i];
        arc.elapsed += dt;
        if (arc.elapsed >= arc.duration) {
          this.activeSlashArcs.splice(i, 1);
        }
      }

      for (let i = this.activeSlamRings.length - 1; i >= 0; i--) {
        const ring = this.activeSlamRings[i];
        ring.elapsed += dt;
        if (ring.elapsed >= ring.duration) {
          this.activeSlamRings.splice(i, 1);
        }
      }
    }

    /**
     * UI 동기화용 보스 상태 데이터 스냅샷 반환
     */
    getUIState() {
      return {
        name: this.name,
        hp: this.hp,
        maxHp: this.maxHp,
        ratio: Math.max(0, Math.min(1, this.hp / this.maxHp)),
        state: this.state,
        alive: this.alive && !this.isDead(),
        isAwakened: this.isAwakened
      };
    }

    _normalizeAngle(rad) {
      let angle = rad % (Math.PI * 2);
      if (angle > Math.PI) angle -= Math.PI * 2;
      if (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    }

    _clamp(val, min, max) {
      return Math.max(min, Math.min(max, val));
    }
  }

  PO.BOSS_STATES = BOSS_STATES;
  PO.BOSS_ATTACK_PATTERNS = BOSS_ATTACK_PATTERNS;
  PO.BOSS_CONFIG = BOSS_CONFIG;
  PO.Boss = Boss;
})(window);
