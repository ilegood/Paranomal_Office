(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 플레이어(회사원 캐릭터) 상태 및 속성 데이터 모델
   * 향후 마우스 방향 공격 확장을 위해 위치(position)와 방향(direction) 데이터를 분리하여 관리한다.
   */
  class Player {
    constructor(config = {}) {
      // 위치 (쿼터뷰 바닥 접지면 중심 좌표)
      this.position = {
        x: config.x ?? 640,
        y: config.y ?? 455
      };

      // 이동 속도 (px/sec)
      this.speed = config.speed ?? 260;

      // 체력 (기본값 100)
      this.maxHp = config.maxHp ?? 100;
      this.hp = config.hp ?? 100;

      // 현재 방향 (정규화된 단위 벡터 + 라디안 각도 + 주 방향 레이블)
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
    }

    /**
     * 방향 벡터를 정규화하여 현재 방향 정보를 갱신한다.
     * (Phase 1에서는 이동 방향에 의해 호출되며, 추후 마우스 방향 조준에서도 재사용 가능)
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
  }

  PO.Player = Player;
})(window);

