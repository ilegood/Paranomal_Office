(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 플레이어 대시(Dash) 및 회피 밸런스 설정값 (추후 조정 용이하도록 별도 분리)
   */
  const DASH_CONFIG = {
    duration: 0.18, // 대시 이동 지속 시간 (초)
    speedMultiplier: 2.5, // 일반 이동 속도 대비 배율
    invincibilityDuration: 0.25, // 대시 무적 지속 시간 (초) - 피격 무적 시간과 별도 관리
    cooldown: 1.2, // 대시 재사용 대기시간 (초)
    afterimageInterval: 0.028, // 잔상 생성 간격 (초)
    afterimageDuration: 0.16 // 개별 잔상 유지 시간 (초)
  };

  /**
   * 플레이어 피격 및 무적 밸런스 설정값
   */
  const PLAYER_DAMAGE_CONFIG = {
    defaultMaxHp: 100, // 플레이어 기본 체력: 100
    hitInvincibilityDuration: 0.6, // 피격 직후 무적 시간: 약 0.6초
    hurtFlashDuration: 0.22 // 피격 직후 붉은 점멸 피드백 시간 (초)
  };

  /**
   * 플레이어(회사원 캐릭터) 상태 및 속성 데이터 모델
   * 위치(position), 조준 방향(direction), 대시 이동(dash),
   * 대시 무적(dashInvincibility), 피격 무적(hitInvincibility), 사망 상태(isDead)를 각각 분리 관리한다.
   */
  class Player {
    constructor(config = {}) {
      // 위치 (쿼터뷰 바닥 접지면 중심 좌표)
      this.position = {
        x: config.x ?? 640,
        y: config.y ?? 455
      };

      // 일반 이동 속도 (px/sec)
      this.speed = config.speed ?? 260;

      // 체력 (기본값 100) 및 생존/사망 상태
      this.maxHp = config.maxHp ?? PLAYER_DAMAGE_CONFIG.defaultMaxHp;
      this.hp = config.hp ?? this.maxHp;
      this.isDead = this.hp <= 0;
      this.state = this.isDead ? 'Dead' : 'Alive';

      // 현재 바라보는 방향 (정규화된 단위 벡터 + 라디안 각도 + 주 방향 레이블)
      this.direction = {
        x: 0,
        y: 1,
        angle: Math.PI / 2,
        facing: 'down'
      };

      // 현재 이동 속도 벡터 및 이동 여부
      this.velocity = {
        x: 0,
        y: 0
      };
      this.isMoving = false;

      // 쿼터뷰 자연스러운 보행 표현을 위한 단순 보행 타이머
      this.walkPhase = 0;

      // 바닥 충돌 반경 (발 주변 원형 영역)
      this.colliderRadius = config.colliderRadius ?? 16;

      // 쿼터뷰에서 상체/손 높이 기준 마우스 조준 오프셋 (Y축)
      this.aimOffsetY = -18;

      // 대시 이동 상태 (무적 상태와 별도로 관리)
      this.dash = {
        isDashing: false,
        timer: 0,
        duration: config.dashDuration ?? DASH_CONFIG.duration,
        speedMultiplier: config.dashSpeedMultiplier ?? DASH_CONFIG.speedMultiplier,
        cooldownRemaining: 0,
        cooldownTotal: config.dashCooldown ?? DASH_CONFIG.cooldown,
        dirX: 0,
        dirY: 1,
        afterimageSpawnTimer: 0,
        afterimages: []
      };

      // 1. 대시 무적 상태 (0.25초 - 피격 후 무적과 별도 관리)
      this.dashInvincibility = {
        isInvincible: false,
        timer: 0,
        duration: config.invincibilityDuration ?? DASH_CONFIG.invincibilityDuration
      };
      // Phase 3 기존 참조 호환 별칭
      this.invincibility = this.dashInvincibility;

      // 2. 피격 후 무적 상태 (0.6초 - 대시 무적과 별도 관리)
      this.hitInvincibility = {
        isInvincible: false,
        timer: 0,
        duration: config.hitInvincibilityDuration ?? PLAYER_DAMAGE_CONFIG.hitInvincibilityDuration
      };

      // 피격 시 짧은 붉은 점멸 피드백 타이머
      this.hurtFlashTimer = 0;
    }

    /**
     * 마우스 조준 방향 계산 시 기준이 되는 플레이어 상체/무기 중심 월드 좌표 반환
     */
    getAimOrigin() {
      return {
        x: this.position.x,
        y: this.position.y + this.aimOffsetY
      };
    }

    /**
     * 방향 벡터를 정규화하여 현재 방향 정보를 갱신한다.
     */
    setDirection(dx, dy) {
      if (this.isDead) {
        return;
      }

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
     * 대시 사용 가능 여부 반환 (생존 중 + 쿨다운 완료 + 현재 대시 중이 아닐 때)
     */
    canDash() {
      return !this.isDead && !this.dash.isDashing && this.dash.cooldownRemaining <= 0;
    }

    /**
     * 정규화된 방향으로 대시 이동 상태를 시작한다.
     */
    startDash(dirX, dirY) {
      if (this.isDead) {
        return false;
      }

      const len = Math.hypot(dirX, dirY);
      if (len < 1e-6) {
        return false;
      }

      this.dash.isDashing = true;
      this.dash.timer = this.dash.duration;
      this.dash.cooldownRemaining = this.dash.cooldownTotal;
      this.dash.dirX = dirX / len;
      this.dash.dirY = dirY / len;
      this.dash.afterimageSpawnTimer = 0;

      // 시작 위치에 첫 잔상 기록
      this.spawnAfterimage();
      return true;
    }

    /**
     * 대시 이동 상태를 명시적으로 종료한다.
     */
    endDashMovement() {
      this.dash.isDashing = false;
      this.dash.timer = 0;
    }

    /**
     * 대시 무적 상태를 명시적으로 시작한다. (피격 무적과 독립)
     */
    startDashInvincibility(duration = this.dashInvincibility.duration) {
      if (duration <= 0 || this.isDead) {
        return;
      }
      this.dashInvincibility.isInvincible = true;
      this.dashInvincibility.timer = Math.max(this.dashInvincibility.timer, duration);
    }

    /**
     * 대시 무적 상태를 명시적으로 종료한다.
     */
    endDashInvincibility() {
      this.dashInvincibility.isInvincible = false;
      this.dashInvincibility.timer = 0;
    }

    // 기존 MovementSystem 호환 메서드 유지
    startInvincibility(duration = this.dashInvincibility.duration) {
      this.startDashInvincibility(duration);
    }

    endInvincibility() {
      this.endDashInvincibility();
    }

    /**
     * 피격 후 무적 상태(0.6초)를 명시적으로 시작한다. (대시 무적과 독립)
     */
    startHitInvincibility(duration = this.hitInvincibility.duration) {
      if (duration <= 0 || this.isDead) {
        return;
      }
      this.hitInvincibility.isInvincible = true;
      this.hitInvincibility.timer = Math.max(this.hitInvincibility.timer, duration);
    }

    /**
     * 피격 후 무적 상태를 명시적으로 종료한다.
     */
    endHitInvincibility() {
      this.hitInvincibility.isInvincible = false;
      this.hitInvincibility.timer = 0;
    }

    /**
     * 개별 무적 활성화 여부 조회
     */
    isDashInvulnerable() {
      return Boolean(this.dashInvincibility.isInvincible);
    }

    isHitInvulnerable() {
      return Boolean(this.hitInvincibility.isInvincible);
    }

    /**
     * 통합 무적 판정: 대시 무적 또는 피격 후 무적 중 하나라도 활성화되어 있으면 피해 무시
     */
    isInvulnerable() {
      return this.isDashInvulnerable() || this.isHitInvulnerable();
    }

    /**
     * 플레이어 사망 상태 전환 (이동, 대시 등 즉시 정지)
     */
    markDead() {
      this.hp = 0;
      this.isDead = true;
      this.state = 'Dead';
      this.velocity.x = 0;
      this.velocity.y = 0;
      this.isMoving = false;
      this.walkPhase = 0;
      this.endDashMovement();
      this.endDashInvincibility();
      this.endHitInvincibility();
    }

    /**
     * 대시 잔상 스냅샷 추가
     */
    spawnAfterimage() {
      this.dash.afterimages.push({
        x: this.position.x,
        y: this.position.y,
        facingBack: this.direction.y < -0.55,
        elapsed: 0,
        duration: DASH_CONFIG.afterimageDuration
      });
    }

    /**
     * 매 프레임 대시 쿨다운, 대시 무적 타이머, 피격 무적 타이머, 잔상 수명을 각각 갱신한다.
     */
    updateStatusTimers(dt) {
      if (dt <= 0) {
        return;
      }

      // 1. 대시 쿨다운 감소
      if (this.dash.cooldownRemaining > 0) {
        this.dash.cooldownRemaining = Math.max(0, this.dash.cooldownRemaining - dt);
      }

      // 2. 대시 무적 타이머 감소 및 만료 처리 (피격 무적과 독립)
      if (this.dashInvincibility.isInvincible) {
        this.dashInvincibility.timer -= dt;
        if (this.dashInvincibility.timer <= 0) {
          this.endDashInvincibility();
        }
      }

      // 3. 피격 후 무적 타이머(0.6초) 감소 및 만료 처리 (대시 무적과 독립)
      if (this.hitInvincibility.isInvincible) {
        this.hitInvincibility.timer -= dt;
        if (this.hitInvincibility.timer <= 0) {
          this.endHitInvincibility();
        }
      }

      // 4. 피격 점멸 타이머 감소
      if (this.hurtFlashTimer > 0) {
        this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);
      }

      // 5. 대시 잔상 수명 갱신
      for (let i = this.dash.afterimages.length - 1; i >= 0; i--) {
        const ghost = this.dash.afterimages[i];
        ghost.elapsed += dt;
        if (ghost.elapsed >= ghost.duration) {
          this.dash.afterimages.splice(i, 1);
        }
      }
    }

    /**
     * 플레이어 직접 피해 호출 진입점 (재사용 가능한 PlayerDamageSystem의 정적 로직 위임)
     */
    takeDamage(amount, options = {}) {
      return PlayerDamageSystem.processDamage(this, amount, options);
    }

    /**
     * 체력 값을 안전하게 설정한다.
     */
    setHp(nextHp) {
      this.hp = Math.max(0, Math.min(this.maxHp, Math.round(nextHp)));
    }

    /**
     * 쿼터뷰 Y-정렬 기준점 (바닥에 닿은 발의 Y 좌표)
     */
    getSortY() {
      return this.position.y;
    }

    /**
     * UI 표시용 대시 상태 스냅샷 반환
     */
    getDashUIState() {
      const cdTotal = this.dash.cooldownTotal;
      const cdRem = this.dash.cooldownRemaining;
      const cooldownRatio = cdTotal > 0 ? 1 - Math.min(1, cdRem / cdTotal) : 1;

      return {
        isDashing: this.dash.isDashing,
        isInvincible: this.isDashInvulnerable(),
        isHitInvincible: this.isHitInvulnerable(),
        canDash: this.canDash(),
        cooldownRemaining: cdRem,
        cooldownTotal: cdTotal,
        cooldownRatio
      };
    }
  }

  /**
   * 플레이어 피해 적용, 무적(대시 무적 / 피격 무적) 판정, 사망 전환 및 피격 시각 피드백을
   * 전담하는 재사용 가능 시스템 (적 근접 공격, 추후 원거리 공격/함정 등에서 공통 사용)
   */
  class PlayerDamageSystem {
    constructor(options = {}) {
      this.onPlayerDeath = options.onPlayerDeath || null;
      this.popups = [];
      this.hitRings = [];
    }

    /**
     * 순수 플레이어 피해 및 사망 처리 공통 함수
     */
    static processDamage(player, amount, options = {}) {
      if (!player || amount <= 0 || player.isDead || player.hp <= 0) {
        return {
          applied: false,
          blockedByInvincibility: false,
          blockedBy: null,
          damage: 0,
          died: false
        };
      }

      // 대시 무적 또는 피격 후 무적 중 하나라도 활성화되어 있으면 피해 무시
      if (player.isDashInvulnerable()) {
        return {
          applied: false,
          blockedByInvincibility: true,
          blockedBy: 'dash',
          damage: 0,
          died: false
        };
      }

      if (player.isHitInvulnerable()) {
        return {
          applied: false,
          blockedByInvincibility: true,
          blockedBy: 'hit',
          damage: 0,
          died: false
        };
      }

      const prevHp = player.hp;
      player.setHp(player.hp - amount);
      const actualDamage = prevHp - player.hp;
      player.hurtFlashTimer = PLAYER_DAMAGE_CONFIG.hurtFlashDuration;

      if (player.hp <= 0) {
        PlayerDamageSystem.handleDeath(player, options.onDeath);
        return {
          applied: true,
          blockedByInvincibility: false,
          blockedBy: null,
          damage: actualDamage,
          died: true
        };
      }

      // 생존 시 짧은 피격 무적 시간(0.6초) 부여
      if (options.grantHitInvincibility !== false) {
        const hitInvulnSec =
          options.hitInvincibilityDuration ?? player.hitInvincibility.duration;
        player.startHitInvincibility(hitInvulnSec);
      }

      return {
        applied: true,
        blockedByInvincibility: false,
        blockedBy: null,
        damage: actualDamage,
        died: false
      };
    }

    /**
     * 플레이어 체력 0 이하 도달 시 사망 상태 전환 공통 처리
     */
    static handleDeath(player, onDeathCallback = null) {
      if (!player || player.isDead) {
        return;
      }
      player.markDead();
      if (typeof onDeathCallback === 'function') {
        onDeathCallback(player);
      }
    }

    /**
     * 게임 내 적 공격·함정 등에서 호출하는 인스턴스 진입점 (피격/회피 팝업 및 사망 콜백 연동)
     */
    applyDamage(player, amount, options = {}) {
      const result = PlayerDamageSystem.processDamage(player, amount, {
        ...options,
        onDeath: (deadPlayer) => {
          if (typeof this.onPlayerDeath === 'function') {
            this.onPlayerDeath(deadPlayer);
          }
          if (typeof options.onDeath === 'function') {
            options.onDeath(deadPlayer);
          }
        }
      });

      if (result.blockedByInvincibility && result.blockedBy === 'dash') {
        this.popups.push({
          x: player.position.x,
          y: player.position.y - 64,
          text: '대시 회피!',
          color: '#67e8f9',
          elapsed: 0,
          duration: 0.6
        });
      } else if (result.applied) {
        this.popups.push({
          x: player.position.x + (Math.random() - 0.5) * 8,
          y: player.position.y - 66,
          text: `-${result.damage}`,
          color: '#fb7185',
          elapsed: 0,
          duration: 0.7
        });

        this.hitRings.push({
          x: player.position.x,
          y: player.position.y - 20,
          color: result.died ? '#ef4444' : '#fb7185',
          maxRadius: result.died ? 34 : 22,
          elapsed: 0,
          duration: result.died ? 0.35 : 0.22
        });
      }

      return result;
    }

    update(dt) {
      if (dt <= 0) {
        return;
      }

      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.elapsed += dt;
        p.y -= dt * 28;
        if (p.elapsed >= p.duration) {
          this.popups.splice(i, 1);
        }
      }

      for (let i = this.hitRings.length - 1; i >= 0; i--) {
        const ring = this.hitRings[i];
        ring.elapsed += dt;
        if (ring.elapsed >= ring.duration) {
          this.hitRings.splice(i, 1);
        }
      }
    }
  }

  PO.DASH_CONFIG = DASH_CONFIG;
  PO.PLAYER_DAMAGE_CONFIG = PLAYER_DAMAGE_CONFIG;
  PO.Player = Player;
  PO.PlayerDamageSystem = PlayerDamageSystem;
})(window);
