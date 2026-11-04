(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 플레이어 이동, 방향 갱신, 맵 경계 제한 및 장애물 충돌(슬라이딩) 처리를 담당하는 모듈
   */
  class MovementSystem {
    /**
     * 프레임 단위 이동 업데이트
     * @param {PO.Player} player
     * @param {{x: number, y: number}} inputVector
     * @param {PO.OfficeMap} officeMap
     * @param {number} dt 경과 시간(초)
     */
    update(player, inputVector, officeMap, dt) {
      if (dt <= 0) {
        return;
      }

      const rawLen = Math.hypot(inputVector.x, inputVector.y);

      if (rawLen > 1e-6) {
        // 대각선 이동 속도가 빨라지지 않도록 단위 벡터로 정규화
        const dirX = inputVector.x / rawLen;
        const dirY = inputVector.y / rawLen;

        player.velocity.x = dirX * player.speed;
        player.velocity.y = dirY * player.speed;
        player.isMoving = true;

        // 이동 중 캐릭터 방향 갱신
        player.setDirection(dirX, dirY);
        player.walkPhase += dt * 11.5;
      } else {
        // 키를 놓으면 즉시 정지
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.isMoving = false;
        player.walkPhase = 0;
        return;
      }

      const moveX = player.velocity.x * dt;
      const moveY = player.velocity.y * dt;

      let nextX = player.position.x + moveX;
      let nextY = player.position.y + moveY;

      const radius = player.colliderRadius;
      const bounds = officeMap.getPlayableBounds(radius);
      const obstacles = officeMap.getSolidObstacles();

      // 다중 패스 원형(발)-사각형(장애물 바닥) 충돌 해결 및 맵 경계 클램핑
      // 벽이나 책상 모서리에 비스듬히 부딪혀도 자연스럽게 미끄러지며 절대 관통하지 않음
      for (let iter = 0; iter < 3; iter++) {
        nextX = this._clamp(nextX, bounds.minX, bounds.maxX);
        nextY = this._clamp(nextY, bounds.minY, bounds.maxY);

        for (let i = 0; i < obstacles.length; i++) {
          const resolved = this._resolveCircleRect(nextX, nextY, radius, obstacles[i]);
          nextX = resolved.x;
          nextY = resolved.y;
        }
      }

      // 최종 경계 보정
      player.position.x = this._clamp(nextX, bounds.minX, bounds.maxX);
      player.position.y = this._clamp(nextY, bounds.minY, bounds.maxY);
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

      // 원의 중심이 사각형 외부에 있는 일반적인 충돌 케이스
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        const overlap = radius - dist;
        return {
          x: cx + (distX / dist) * overlap,
          y: cy + (distY / dist) * overlap
        };
      }

      // 원의 중심이 사각형 내부까지 들어간 예외 케이스 (가장 가까운 변으로 밀어냄)
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

