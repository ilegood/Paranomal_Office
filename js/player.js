(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 플레이어 대시(Dash) 및 회피 밸런스 설정값 (추후 조정 용이하도록 별도 분리)
   */
  const DASH_CONFIG = {
    duration: 0.18, // 대시 이동 지속 시간 (초)
    speedMultiplier: 2.5, // 일반 이동 속도 대비 배율
    invincibilityDuration: 0.25, // 대시 무적 지속 시간 (초) - 대시 이동 시간과 별도 관리
    cooldown: 1.2, // 대시 재사용 대기시간 (초)
    afterimageInterval: 0.028, // 잔상 생성 간격 (초)
    afterimageDuration: 0.16 // 개별 잔상 유지 시간 (초)
  };

  /**
   * 플레이어(회사원 캐릭터) 상태 및 속성 데이터 모델
   * 위치(position), 조준 방향(direction), 대시 이동(dash), 무적 상태(invincibility)를 각각 분리하여 관리한다.
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

      // 체력 (기본값 100)
      this.maxHp = config.maxHp ?? 100;
      this.hp = config.hp ?? 100;

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

      // 무적 상태 (대시 이동 시간과 독립된 별도 타이머 및 시작/종료 메서드로 관리)
      this.invincibility = {
        isInvincible: false,
        timer: 0,
        duration: config.invincibilityDuration ?? DASH_CONFIG.invincibilityDuration
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
     * 대시 사용 가능 여부 반환 (쿨다운 완료 및 현재 대시 중이 아닐 때)
     */
    canDash() {
      return !this.dash.isDashing && this.dash.cooldownRemaining <= 0;
    }

    /**
     * 정규화된 방향으로 대시 이동 상태를 시작한다.
     */
    startDash(dirX, dirY) {
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
     * 대시 이동 상태를 명시적으로 종료한다. (무적 상태는 별도 타이머에 의해 유지/종료됨)
     */
    endDashMovement() {
      this.dash.isDashing = false;
      this.dash.timer = 0;
    }

    /**
     * 무적 상태를 명시적으로 시작한다.
     */
    startInvincibility(duration = this.invincibility.duration) {
      if (duration <= 0) {
        return;
      }
      this.invincibility.isInvincible = true;
      this.invincibility.timer = Math.max(this.invincibility.timer, duration);
    }

    /**
     * 무적 상태를 명시적으로 종료하고 정상 피격 가능 상태로 복귀한다.
     */
    endInvincibility() {
      this.invincibility.isInvincible = false;
      this.invincibility.timer = 0;
    }

    /**
     * 현재 무적 판정 여부 반환
     */
    isInvulnerable() {
      return this.invincibility.isInvincible;
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
     * 매 프레임 대시 쿨다운, 무적 타이머, 잔상 수명을 갱신한다.
     */
    updateStatusTimers(dt) {
      if (dt <= 0) {
        return;
      }

      // 1. 대시 쿨다운 감소
      if (this.dash.cooldownRemaining > 0) {
        this.dash.cooldownRemaining = Math.max(0, this.dash.cooldownRemaining - dt);
      }

      // 2. 무적 타이머 감소 및 만료 시 명시적 종료 (대시 이동 시간과 독립 동작)
      if (this.invincibility.isInvincible) {
        this.invincibility.timer -= dt;
        if (this.invincibility.timer <= 0) {
          this.endInvincibility();
        }
      }

      // 3. 피격 점멸 타이머 감소
      if (this.hurtFlashTimer > 0) {
        this.hurtFlashTimer = Math.max(0, this.hurtFlashTimer - dt);
      }

      // 4. 대시 잔상 수명 갱신
      for (let i = this.dash.afterimages.length - 1; i >= 0; i--) {
        const ghost = this.dash.afterimages[i];
        ghost.elapsed += dt;
        if (ghost.elapsed >= ghost.duration) {
          this.dash.afterimages.splice(i, 1);
        }
      }
    }

    /**
     * 플레이어 피해 적용 진입점 (무적 상태일 경우 피해를 무효화)
     */
    takeDamage(amount) {
      if (amount <= 0 || this.hp <= 0) {
        return { applied: false, blockedByInvincibility: false, damage: 0 };
      }

      if (this.isInvulnerable()) {
        return { applied: false, blockedByInvincibility: true, damage: 0 };
      }

      const prevHp = this.hp;
      this.setHp(this.hp - amount);
      const actualDamage = prevHp - this.hp;
      this.hurtFlashTimer = 0.16;

      return { applied: true, blockedByInvincibility: false, damage: actualDamage };
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
        isInvincible: this.invincibility.isInvincible,
        canDash: this.canDash(),
        cooldownRemaining: cdRem,
        cooldownTotal: cdTotal,
        cooldownRatio
      };
    }
  }

  PO.DASH_CONFIG = DASH_CONFIG;
  PO.Player = Player;
})(window);
