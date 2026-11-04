(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 플레이어 일반 이동, 대시(Dash) 이동, 맵 경계 제한 및 장애물 충돌(슬라이딩) 처리를 담당하는 모듈
   */
  class MovementSystem {
    /**
     * 대시 실행 시도
     * 방향 결정 우선순위:
     *   1순위: WASD 이동 입력이 존재하면 해당 정규화 방향
     *   2순위: WASD 입력이 없으면 현재 플레이어가 바라보는 방향(player.direction)
     */
    tryStartDash(player, inputVector) {
      if (!player.canDash()) {
        return false;
      }

      let dashDirX = 0;
      let dashDirY = 0;

      const inputLen = Math.hypot(inputVector.x, inputVector.y);
      if (inputLen > 1e-6) {
        // 1순위: WASD 입력 방향 (대각선 포함 단위 벡터 정규화)
        dashDirX = inputVector.x / inputLen;
        dashDirY = inputVector.y / inputLen;
      } else {
        // 2순위: 현재 바라보는 방향
        const faceLen = Math.hypot(player.direction.x, player.direction.y);
        if (faceLen > 1e-6) {
          dashDirX = player.direction.x / faceLen;
          dashDirY = player.direction.y / faceLen;
        } else {
          dashDirX = 0;
          dashDirY = 1;
        }
      }

      const started = player.startDash(dashDirX, dashDirY);
      if (started) {
        // 대시 이동 시작과 별개로 무적 상태를 명시적으로 시작
        player.startInvincibility(player.invincibility.duration);
      }
      return started;
    }

    /**
     * 프레임 단위 이동 업데이트 (대시 이동 및 일반 WASD 이동 통합 처리)
     * @param {PO.Player} player
     * @param {{x: number, y: number}} inputVector
     * @param {PO.OfficeMap} officeMap
     * @param {number} dt 경과 시간(초)
     * @param {{updateDirection?: boolean, circleBlockers?: Array}} [options]
     */
    update(player, inputVector, officeMap, dt, options = {}) {
      if (dt <= 0) {
        return;
      }

      const updateDirection = options.updateDirection !== false;
      const circleBlockers = options.circleBlockers || [];
      let remainingDt = dt;

      // 1. 대시 이동 처리 (활성 대시 시간이 남아 있는 동안 우선 적용)
      if (player.dash.isDashing) {
        const dashDt = Math.min(remainingDt, player.dash.timer);
        const dashSpeed = player.speed * player.dash.speedMultiplier;

        player.velocity.x = player.dash.dirX * dashSpeed;
        player.velocity.y = player.dash.dirY * dashSpeed;
        player.isMoving = true;

        if (updateDirection) {
          player.setDirection(player.dash.dirX, player.dash.dirY);
        }

        const dashMoveX = player.velocity.x * dashDt;
        const dashMoveY = player.velocity.y * dashDt;
        this._applyMovementWithCollisions(player, dashMoveX, dashMoveY, officeMap, circleBlockers);

        // 대시 잔상 주기적 생성
        const afterimageInterval = (PO.DASH_CONFIG && PO.DASH_CONFIG.afterimageInterval) || 0.028;
        player.dash.afterimageSpawnTimer += dashDt;
        while (player.dash.afterimageSpawnTimer >= afterimageInterval) {
          player.dash.afterimageSpawnTimer -= afterimageInterval;
          player.spawnAfterimage();
        }

        player.dash.timer -= dashDt;
        if (player.dash.timer <= 1e-8) {
          player.endDashMovement();
        }

        remainingDt -= dashDt;
        if (remainingDt <= 1e-8) {
          return;
        }
      }

      // 2. 일반 WASD 이동 처리
      const rawLen = Math.hypot(inputVector.x, inputVector.y);

      if (rawLen > 1e-6) {
        // 대각선 이동 속도가 빨라지지 않도록 단위 벡터로 정규화
        const dirX = inputVector.x / rawLen;
        const dirY = inputVector.y / rawLen;

        player.velocity.x = dirX * player.speed;
        player.velocity.y = dirY * player.speed;
        player.isMoving = true;

        if (updateDirection) {
          player.setDirection(dirX, dirY);
        }
        player.walkPhase += remainingDt * 11.5;
      } else {
        // 키를 놓으면 즉시 정지
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.isMoving = false;
        player.walkPhase = 0;
        return;
      }

      const moveX = player.velocity.x * remainingDt;
      const moveY = player.velocity.y * remainingDt;
      this._applyMovementWithCollisions(player, moveX, moveY, officeMap, circleBlockers);
    }

    /**
     * 고속 대시에서도 벽/장애물 터널링이 발생하지 않도록 서브스테핑 및 다중 패스 충돌 해결 적용
     */
    _applyMovementWithCollisions(player, moveX, moveY, officeMap, circleBlockers) {
      const totalDist = Math.hypot(moveX, moveY);
      const steps = Math.max(1, Math.ceil(totalDist / 10));
      const stepX = moveX / steps;
      const stepY = moveY / steps;

      const radius = player.colliderRadius;
      const bounds = officeMap.getPlayableBounds(radius);
      const obstacles = officeMap.getSolidObstacles();

      let nextX = player.position.x;
      let nextY = player.position.y;

      for (let s = 0; s < steps; s++) {
        nextX += stepX;
        nextY += stepY;

        for (let iter = 0; iter < 3; iter++) {
          nextX = this._clamp(nextX, bounds.minX, bounds.maxX);
          nextY = this._clamp(nextY, bounds.minY, bounds.maxY);

          for (let i = 0; i < circleBlockers.length; i++) {
            const blocker = circleBlockers[i];
            if (!blocker.alive) continue;
            const resolvedCircle = this._resolveCircleCircle(
              nextX,
              nextY,
              radius,
              blocker.position.x,
              blocker.position.y,
              blocker.radius
            );
            nextX = resolvedCircle.x;
            nextY = resolvedCircle.y;
          }

          for (let i = 0; i < obstacles.length; i++) {
            const resolved = this._resolveCircleRect(nextX, nextY, radius, obstacles[i]);
            nextX = resolved.x;
            nextY = resolved.y;
          }
        }
      }

      player.position.x = this._clamp(nextX, bounds.minX, bounds.maxX);
      player.position.y = this._clamp(nextY, bounds.minY, bounds.maxY);
    }

    /**
     * 원과 원 간 최소 밀어내기 계산 (생존 중인 테스트 타겟 등)
     */
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

    /**
     * 원(플레이어 발)과 축 정렬 사각형(장애물 바닥 영역) 간 최소 밀어내기 벡터 계산
     */
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

      if (minPen === penLeft) {
        return { x: left - radius, y: cy };
      }
      if (minPen === penRight) {
        return { x: right + radius, y: cy };
      }
      if (minPen === penTop) {
        return { x: cx, y: top - radius };
      }
      return { x: cx, y: bottom + radius };
    }

    _clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    }
  }

  PO.MovementSystem = MovementSystem;
})(window);
