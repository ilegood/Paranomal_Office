(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  const OUTLINE_COLOR = '#111420';

  /**
   * 2D 쿼터뷰 카툰 스타일 맵 및 캐릭터 렌더러
   */
  class Renderer {
    constructor(canvas, stageElement, officeMap) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.stageElement = stageElement;
      this.officeMap = officeMap;

      this.scale = 1;
      this.dpr = 1;

      this._onResize = this.resize.bind(this);
      window.addEventListener('resize', this._onResize);
      this.resize();
    }

    /**
     * 브라우저 창 크기에 맞춰 16:10 게임 화면 비율을 유지하며 고해상도(DPR) 스케일링 적용
     */
    resize() {
      const padding = 16;
      const availWidth = Math.max(320, window.innerWidth - padding);
      const availHeight = Math.max(240, window.innerHeight - padding);

      const logicalWidth = this.officeMap.width;
      const logicalHeight = this.officeMap.height;

      this.scale = Math.min(availWidth / logicalWidth, availHeight / logicalHeight);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);

      const displayWidth = Math.floor(logicalWidth * this.scale);
      const displayHeight = Math.floor(logicalHeight * this.scale);

      this.stageElement.style.width = `${displayWidth}px`;
      this.stageElement.style.height = `${displayHeight}px`;

      this.canvas.width = Math.floor(displayWidth * this.dpr);
      this.canvas.height = Math.floor(displayHeight * this.dpr);
    }

    /**
     * 화면 좌표를 게임 월드 좌표로 변환
     * 캔버스의 실제 렌더링 위치(rect.left/top)와 크기(rect.width/height)를 기준으로 계산하여
     * 브라우저 창 크기가 변경되거나 테두리가 있어도 항상 정확한 월드 좌표를 반환한다.
     */
    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return {
          x: this.officeMap.width * 0.5,
          y: this.officeMap.height * 0.5
        };
      }
      return {
        x: ((clientX - rect.left) / rect.width) * this.officeMap.width,
        y: ((clientY - rect.top) / rect.height) * this.officeMap.height
      };
    }

    /**
     * 전체 프레임 렌더링
     */
    render(
      officeMap,
      player,
      combat = null,
      aimWorld = null,
      testHazard = null,
      enemySystem = null,
      playerDamageSystem = null
    ) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);

      // 1. 배경 및 쿼터뷰 사무실 바닥
      this._drawFloor(ctx, officeMap);

      // 2. 북쪽(뒷면) 벽면 및 좌/우 외벽
      this._drawBackAndSideWalls(ctx, officeMap);

      // 3. 임시 무적 테스트 위험 구역, 적 감지/공격 예고 표시, 바닥 그림자 및 조준 방향 표시
      if (testHazard) {
        testHazard.renderFloor(ctx);
      }
      if (enemySystem) {
        this._drawEnemyFloorIndicators(ctx, enemySystem);
      }
      this._drawShadows(ctx, officeMap, player, combat, enemySystem);
      if (!player.isDead) {
        this._drawPlayerDirectionIndicator(ctx, player);
      }

      // 4. 쿼터뷰 Y-정렬 렌더링 (발/바닥 Y좌표 기준으로 앞뒤 원근 순서 결정)
      const renderQueue = [];

      for (let i = 0; i < officeMap.obstacles.length; i++) {
        const obs = officeMap.obstacles[i];
        renderQueue.push({
          kind: 'obstacle',
          sortY: obs.y + obs.height,
          data: obs
        });
      }

      // 대시 잔상도 Y-정렬 큐에 포함하여 책상/기둥 전후 원근 유지
      if (player.dash && player.dash.afterimages.length > 0) {
        for (let i = 0; i < player.dash.afterimages.length; i++) {
          const ghost = player.dash.afterimages[i];
          renderQueue.push({
            kind: 'afterimage',
            sortY: ghost.y - 0.1,
            data: ghost
          });
        }
      }

      if (combat) {
        for (let i = 0; i < combat.targets.length; i++) {
          const target = combat.targets[i];
          if (target.alive) {
            renderQueue.push({
              kind: 'target',
              sortY: target.getSortY(),
              data: target
            });
          }
        }

        for (let i = 0; i < combat.projectiles.length; i++) {
          const proj = combat.projectiles[i];
          if (proj.alive) {
            renderQueue.push({
              kind: 'projectile',
              sortY: proj.y,
              data: proj
            });
          }
        }
      }

      if (enemySystem) {
        const renderableEnemies = enemySystem.getRenderableEnemies();
        for (let i = 0; i < renderableEnemies.length; i++) {
          const enemy = renderableEnemies[i];
          renderQueue.push({
            kind: 'enemy',
            sortY: enemy.getSortY(),
            data: enemy
          });
        }
      }

      const equippedWeaponId = combat ? combat.getCurrentWeaponState().config.id : null;
      const activeMeleeEffect =
        combat && combat.meleeEffects && combat.meleeEffects.length > 0
          ? combat.meleeEffects[combat.meleeEffects.length - 1]
          : null;
      renderQueue.push({
        kind: 'player',
        sortY: player.getSortY(),
        data: player,
        weaponId: equippedWeaponId,
        activeMeleeEffect
      });

      renderQueue.sort((a, b) => a.sortY - b.sortY);

      for (let i = 0; i < renderQueue.length; i++) {
        const item = renderQueue[i];
        switch (item.kind) {
          case 'obstacle':
            this._drawObstacle(ctx, item.data);
            break;
          case 'afterimage':
            this._drawPlayerAfterimage(ctx, item.data);
            break;
          case 'target':
            this._drawTestTarget(ctx, item.data);
            break;
          case 'enemy':
            this._drawEnemy(ctx, item.data);
            break;
          case 'projectile':
            this._drawProjectile(ctx, item.data);
            break;
          case 'player':
            this._drawPlayer(ctx, item.data, item.weaponId, item.activeMeleeEffect);
            break;
          default:
            break;
        }
      }

      // 5. 플레이어/적 근접 휘두르기 궤적, 피격 스파크, 플로팅 피해량 수치
      if (enemySystem) {
        this._drawEnemySlashEffects(ctx, enemySystem);
      }
      if (combat) {
        this._drawMeleeSlashArc(ctx, combat);
        this._drawImpactEffects(ctx, combat);
        this._drawDamagePopups(ctx, combat);
      }
      if (playerDamageSystem) {
        this._drawPlayerDamageFeedback(ctx, playerDamageSystem);
      }
      if (testHazard) {
        testHazard.renderPopups(ctx);
      }

      // 6. 남쪽(전면) 단면 벽 및 야근 조명 비네팅
      this._drawForegroundWall(ctx, officeMap);
      this._drawNightAtmosphere(ctx, officeMap);

      // 7. 마우스 조준선(크로스헤어) 표시 (사망 시 미표시)
      if (aimWorld && !player.isDead) {
        this._drawAimCrosshair(ctx, aimWorld, equippedWeaponId);
      }

      ctx.restore();
    }

    _drawFloor(ctx, officeMap) {
      const { width, height, floorRect, tileWidth, tileHeight, floorMats } = officeMap;

      // 외곽 어두운 구조체 배경
      ctx.fillStyle = '#0d101a';
      ctx.fillRect(0, 0, width, height);

      // 사무실 카펫 바닥 기본색
      ctx.fillStyle = '#1b2234';
      ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);

      // 쿼터뷰 비율(64x48) 카펫 타일 패턴
      const cols = Math.ceil(floorRect.width / tileWidth);
      const rows = Math.ceil(floorRect.height / tileHeight);

      ctx.save();
      ctx.beginPath();
      ctx.rect(floorRect.x, floorRect.y, floorRect.width, floorRect.height);
      ctx.clip();

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tx = floorRect.x + c * tileWidth;
          const ty = floorRect.y + r * tileHeight;
          const isAlt = (r + c) % 2 === 0;

          ctx.fillStyle = isAlt ? '#1e2639' : '#1a2132';
          ctx.fillRect(tx, ty, tileWidth, tileHeight);
        }
      }

      // 타일 그리드 선
      ctx.strokeStyle = 'rgba(12, 15, 26, 0.45)';
      ctx.lineWidth = 1;
      for (let c = 1; c < cols; c++) {
        const x = floorRect.x + c * tileWidth;
        ctx.beginPath();
        ctx.moveTo(x, floorRect.y);
        ctx.lineTo(x, floorRect.y + floorRect.height);
        ctx.stroke();
      }
      for (let r = 1; r < rows; r++) {
        const y = floorRect.y + r * tileHeight;
        ctx.beginPath();
        ctx.moveTo(floorRect.x, y);
        ctx.lineTo(floorRect.x + floorRect.width, y);
        ctx.stroke();
      }

      // 바닥 매트/러그 장식
      for (let i = 0; i < floorMats.length; i++) {
        const mat = floorMats[i];
        this._fillStrokeRoundRect(ctx, mat.x, mat.y, mat.width, mat.height, 6, mat.color, mat.border, 2);
      }

      // 창가 푸른 달빛 & 스탠드 바닥 은은한 조명
      this._drawFloorGlow(ctx, 395, 175, 145, 'rgba(90, 140, 230, 0.10)');
      this._drawFloorGlow(ctx, 985, 175, 155, 'rgba(90, 140, 230, 0.10)');
      this._drawFloorGlow(ctx, 640, 158, 90, 'rgba(72, 220, 150, 0.08)');
      this._drawFloorGlow(ctx, 640, 300, 140, 'rgba(255, 200, 110, 0.09)');
      this._drawFloorGlow(ctx, 275, 535, 130, 'rgba(255, 200, 110, 0.08)');
      this._drawFloorGlow(ctx, 1005, 300, 130, 'rgba(255, 200, 110, 0.08)');

      // 벽 바로 아래 바닥 그림자
      const wallShadow = ctx.createLinearGradient(0, floorRect.y, 0, floorRect.y + 26);
      wallShadow.addColorStop(0, 'rgba(7, 9, 16, 0.55)');
      wallShadow.addColorStop(1, 'rgba(7, 9, 16, 0)');
      ctx.fillStyle = wallShadow;
      ctx.fillRect(floorRect.x, floorRect.y, floorRect.width, 26);

      ctx.restore();
    }

    _drawFloorGlow(ctx, cx, cy, radius, color) {
      const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, radius);
      grad.addColorStop(0, color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius, radius * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawBackAndSideWalls(ctx, officeMap) {
      const { width, floorRect } = officeMap;
      const wallTopY = 20;
      const wallFaceY = 44;
      const wallBottomY = floorRect.y; // 132

      // 북쪽 벽 정면(수직 면)
      this._fillStrokeRect(
        ctx,
        floorRect.x,
        wallFaceY,
        floorRect.width,
        wallBottomY - wallFaceY,
        '#27314a',
        OUTLINE_COLOR,
        2.5
      );

      // 벽 하단 걸레받이 몰딩
      this._fillStrokeRect(
        ctx,
        floorRect.x,
        wallBottomY - 10,
        floorRect.width,
        10,
        '#192033',
        OUTLINE_COLOR,
        2
      );

      // 밤하늘 창문 (좌/우 - 좌측 HUD 패널과 겹치지 않도록 배치)
      this._drawNightWindow(ctx, 298, 54, 200, 58, true);
      this._drawNightWindow(ctx, 875, 54, 210, 58, false);

      // 벽시계 (야근 시간 11:55 표현)
      this._drawWallClock(ctx, 542, 78, 16);

      // 중앙 잠긴 비상구 출입문 (배경 연출용)
      this._drawLockedOfficeDoor(ctx, 592, 58, 96, wallBottomY - 58);

      // 회의용 화이트보드
      this._drawWhiteboard(ctx, 740, 58, 96, 50);

      // 북쪽 벽 상단 단면(쿼터뷰 벽 두께 표현)
      this._fillStrokeRect(ctx, 16, wallTopY, width - 32, wallFaceY - wallTopY, '#141929', OUTLINE_COLOR, 2.5);

      // 좌측 외벽 단면
      this._fillStrokeRect(ctx, 16, wallTopY, floorRect.x - 16, 764 - wallTopY, '#141929', OUTLINE_COLOR, 2.5);
      ctx.fillStyle = '#1f273d';
      ctx.fillRect(floorRect.x - 8, wallFaceY, 8, 760 - wallFaceY);

      // 우측 외벽 단면
      const rightWallX = floorRect.x + floorRect.width;
      this._fillStrokeRect(ctx, rightWallX, wallTopY, width - 16 - rightWallX, 764 - wallTopY, '#141929', OUTLINE_COLOR, 2.5);
      ctx.fillStyle = '#1f273d';
      ctx.fillRect(rightWallX, wallFaceY, 8, 760 - wallFaceY);
    }

    _drawNightWindow(ctx, x, y, w, h, showMoon) {
      // 창틀 및 밤하늘
      this._fillStrokeRect(ctx, x, y, w, h, '#0e172c', OUTLINE_COLOR, 2.5);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, w - 4, h - 4);
      ctx.clip();

      // 야경 빌딩 실루엣
      ctx.fillStyle = '#162340';
      ctx.fillRect(x + 12, y + 24, 34, h - 26);
      ctx.fillRect(x + 54, y + 16, 42, h - 18);
      ctx.fillRect(x + 132, y + 20, 38, h - 22);
      ctx.fillRect(x + 176, y + 28, 30, h - 30);

      // 맞은편 빌딩 야근 불빛
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 62, y + 26, 7, 5);
      ctx.fillRect(x + 75, y + 36, 7, 5);
      ctx.fillRect(x + 142, y + 30, 7, 5);

      if (showMoon) {
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(x + 114, y + 19, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // 창문 세로 프레임 분할
      ctx.strokeStyle = '#1e273d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + w / 3, y);
      ctx.lineTo(x + w / 3, y + h);
      ctx.moveTo(x + (w * 2) / 3, y);
      ctx.lineTo(x + (w * 2) / 3, y + h);
      ctx.stroke();

      // 상단 블라인드
      this._fillStrokeRect(ctx, x + 2, y + 2, w - 4, 10, '#384666', OUTLINE_COLOR, 1.5);
    }

    _drawWallClock(ctx, cx, cy, r) {
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 시침 & 분침 (밤 11시 55분경)
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 3, cy - 7);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 2, cy - 11);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawLockedOfficeDoor(ctx, x, y, w, h) {
      // 비상구 사인
      this._fillStrokeRoundRect(ctx, x + 26, y - 11, 44, 9, 2, '#10b981', OUTLINE_COLOR, 1.8);

      // 양개형 출입문
      this._fillStrokeRect(ctx, x, y, w, h, '#303b57', OUTLINE_COLOR, 2.5);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 문 유리창
      this._fillStrokeRect(ctx, x + 12, y + 10, 24, 28, '#131d33', OUTLINE_COLOR, 2);
      this._fillStrokeRect(ctx, x + w - 36, y + 10, 24, 28, '#131d33', OUTLINE_COLOR, 2);

      // 손잡이
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + w / 2 - 7, y + 44, 4, 10);
      ctx.fillRect(x + w / 2 + 3, y + 44, 4, 10);
    }

    _drawWhiteboard(ctx, x, y, w, h) {
      this._fillStrokeRoundRect(ctx, x, y, w, h, 3, '#dce4f2', OUTLINE_COLOR, 2.2);

      // 간단한 그래프 선과 포스트잇 도형
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + 34);
      ctx.lineTo(x + 28, y + 22);
      ctx.lineTo(x + 44, y + 28);
      ctx.lineTo(x + 60, y + 14);
      ctx.stroke();

      ctx.fillStyle = '#facc15';
      ctx.fillRect(x + 70, y + 12, 14, 14);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(x + 70, y + 29, 14, 12);
    }

    _drawForegroundWall(ctx, officeMap) {
      const { width, floorRect } = officeMap;
      const frontWallY = floorRect.y + floorRect.height; // 760
      this._fillStrokeRect(ctx, 16, frontWallY, width - 32, 24, '#141929', OUTLINE_COLOR, 2.5);

      // 상단 하이라이트 림
      ctx.fillStyle = '#252f4a';
      ctx.fillRect(floorRect.x, frontWallY, floorRect.width, 4);
    }

    _drawNightAtmosphere(ctx, officeMap) {
      const { width, height } = officeMap;
      const vignette = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        height * 0.34,
        width * 0.5,
        height * 0.5,
        width * 0.65
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(6, 8, 15, 0.38)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }

    _drawEnemyFloorIndicators(ctx, enemySystem) {
      const aliveEnemies = enemySystem.getAliveEnemies();
      for (let i = 0; i < aliveEnemies.length; i++) {
        const enemy = aliveEnemies[i];
        const isChasing = enemy.state === 'Chase' || enemy.state === 'Attack';

        ctx.save();
        // 적 감지 범위(250px) 은은한 바닥 점선 링
        ctx.strokeStyle = isChasing
          ? 'rgba(244, 63, 94, 0.24)'
          : 'rgba(167, 139, 250, 0.14)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.arc(enemy.position.x, enemy.position.y, enemy.detectionRange, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 적 근접 공격 준비(Windup 0.35s) 중 바닥 공격 방향·사거리(45px) 예고 부채꼴 표시
        if (enemy.state === 'Attack' && enemy.attack && enemy.attack.phase === 'windup') {
          const windupTotal = Math.max(0.01, enemy.attack.windupDuration);
          const progress = Math.max(0, Math.min(1, 1 - enemy.attack.timer / windupTotal));
          const halfArc = enemy.attackArcRad * 0.5;
          const startAng = enemy.attack.aimAngle - halfArc;
          const endAng = enemy.attack.aimAngle + halfArc;
          const range = enemy.attackRange;

          // 외곽 최대 사거리 영역 테두리
          ctx.beginPath();
          ctx.moveTo(enemy.position.x, enemy.position.y);
          ctx.arc(enemy.position.x, enemy.position.y, range, startAng, endAng);
          ctx.closePath();
          ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(251, 113, 133, 0.72)';
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // 준비 진행률에 따라 차오르는 내부 경고 채움
          ctx.beginPath();
          ctx.moveTo(enemy.position.x, enemy.position.y);
          ctx.arc(enemy.position.x, enemy.position.y, range * progress, startAng, endAng);
          ctx.closePath();
          ctx.fillStyle = `rgba(239, 68, 68, ${(0.25 + progress * 0.32).toFixed(3)})`;
          ctx.fill();
        }

        // 플레이어가 감지 범위를 벗어난 직후 마지막 발견 위치를 추적 중일 때 목표 지점 표시
        if (enemy.state === 'Chase' && !enemy.isPlayerInRange && enemy.lastKnownPlayerPos) {
          const lx = enemy.lastKnownPlayerPos.x;
          const ly = enemy.lastKnownPlayerPos.y;
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.ellipse(lx, ly, 12, 8, 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = 'rgba(251, 191, 36, 0.75)';
          ctx.beginPath();
          ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    _drawShadows(ctx, officeMap, player, combat, enemySystem = null) {
      ctx.fillStyle = 'rgba(7, 9, 16, 0.45)';

      // 장애물 바닥 그림자 (쿼터뷰 입체감을 위해 우하단 오프셋)
      for (let i = 0; i < officeMap.obstacles.length; i++) {
        const obs = officeMap.obstacles[i];
        this._fillRoundRectOnly(ctx, obs.x + 5, obs.y + 5, obs.width, obs.height, 6);
      }

      if (combat) {
        // 테스트 타겟 바닥 그림자
        for (let i = 0; i < combat.targets.length; i++) {
          const target = combat.targets[i];
          if (!target.alive) continue;
          ctx.beginPath();
          ctx.ellipse(target.position.x, target.position.y + 3, 18, 10, 0, 0, Math.PI * 2);
          ctx.fill();
        }

        // 투사체 바닥 그림자
        for (let i = 0; i < combat.projectiles.length; i++) {
          const proj = combat.projectiles[i];
          if (!proj.alive) continue;
          ctx.beginPath();
          ctx.ellipse(proj.x, proj.y + 2, 5, 3, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (enemySystem) {
        const aliveEnemies = enemySystem.getAliveEnemies();
        for (let i = 0; i < aliveEnemies.length; i++) {
          const enemy = aliveEnemies[i];
          ctx.save();
          ctx.fillStyle = 'rgba(24, 12, 42, 0.58)';
          ctx.beginPath();
          ctx.ellipse(enemy.position.x, enemy.position.y + 3, 19, 10.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // 플레이어 발 그림자
      ctx.fillStyle = 'rgba(7, 9, 16, 0.45)';
      ctx.beginPath();
      ctx.ellipse(player.position.x, player.position.y + 3, 16, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /**
     * 플레이어의 현재 방향(direction)을 바닥에 깔끔한 카툰 화살표 호로 표시
     */
    _drawPlayerDirectionIndicator(ctx, player) {
      const { x, y } = player.position;
      const angle = player.direction.angle;

      ctx.save();
      ctx.translate(x, y + 1);

      // 쿼터뷰 원근에 맞춘 타원형 투영(세로 0.72배)
      ctx.scale(1, 0.72);
      ctx.rotate(angle);

      // 방향 화살촉
      ctx.fillStyle = 'rgba(251, 191, 36, 0.88)';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(28, 0);
      ctx.lineTo(19, -6.5);
      ctx.lineTo(21, 0);
      ctx.lineTo(19, 6.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    /**
     * 쿼터뷰 사무실 오브젝트 렌더링 (정면 높이 면 + 상판 면 + 간단한 소품 도형)
     */
    _drawObstacle(ctx, obs) {
      switch (obs.type) {
        case 'desk':
          this._drawOfficeDesk(ctx, obs, '#8b6b4f', '#654b36', '#4a5568');
          break;
        case 'manager_desk':
          this._drawOfficeDesk(ctx, obs, '#754f3a', '#523526', '#384152');
          break;
        case 'meeting_table':
          this._drawMeetingTable(ctx, obs);
          break;
        case 'pillar':
          this._drawPillar(ctx, obs);
          break;
        case 'cabinet':
          this._drawCabinet(ctx, obs);
          break;
        case 'copier':
          this._drawCopier(ctx, obs);
          break;
        default:
          this._drawBox3D(ctx, obs.x, obs.y, obs.width, obs.height, obs.zHeight, '#475569', '#334155');
          break;
      }
    }

    /**
     * 기본 쿼터뷰 직육면체 도형 (전면 수직 면 + 상판 수평 면)
     */
    _drawBox3D(ctx, x, y, w, depth, zHeight, topColor, frontColor) {
      const topY = y - zHeight;
      const frontY = y + depth - zHeight;

      // 전면(수직 두께/높이 면)
      this._fillStrokeRoundRect(ctx, x, frontY, w, zHeight, 3, frontColor, OUTLINE_COLOR, 2.5);

      // 상판(위에서 내려다보이는 면)
      this._fillStrokeRoundRect(ctx, x, topY, w, depth, 4, topColor, OUTLINE_COLOR, 2.5);

      // 상판 앞모서리 하이라이트 선
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + 4, frontY - 1.5);
      ctx.lineTo(x + w - 4, frontY - 1.5);
      ctx.stroke();
    }

    _drawOfficeDesk(ctx, obs, topColor, edgeColor, frontPanelColor) {
      const { x, y, width: w, height: d, zHeight: z } = obs;
      const topY = y - z;
      const frontY = y + d - z;

      // 책상 좌/우 철제 다리
      this._fillStrokeRect(ctx, x + 6, frontY, 10, z, '#262f45', OUTLINE_COLOR, 2);
      this._fillStrokeRect(ctx, x + w - 16, frontY, 10, z, '#262f45', OUTLINE_COLOR, 2);

      // 책상 전면 가림판(Modesty panel) 및 서랍통
      this._fillStrokeRect(ctx, x + 16, frontY, w - 32, z - 5, frontPanelColor, OUTLINE_COLOR, 2);
      this._fillStrokeRect(ctx, x + w - 54, frontY + 2, 38, z - 4, '#333d54', OUTLINE_COLOR, 2);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + w - 40, frontY + 9, 10, 3);
      ctx.fillRect(x + w - 40, frontY + 18, 10, 3);

      // 책상 상판 앞쪽 두께 엣지 + 상판
      this._fillStrokeRoundRect(ctx, x, frontY - 2, w, 8, 2, edgeColor, OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, x, topY, w, d, 4, topColor, OUTLINE_COLOR, 2.5);

      // 모니터 소품 (간단한 카툰 사각형 조합)
      const monX = obs.monitorAlign === 'right' ? x + w - 68 : obs.type === 'manager_desk' ? x + w / 2 - 24 : x + 22;
      const monY = topY + 8;

      // 모니터 받침대 & 본체 화면
      this._fillStrokeRect(ctx, monX + 16, monY + 12, 14, 6, '#1e293b', OUTLINE_COLOR, 1.8);
      this._fillStrokeRoundRect(ctx, monX, monY - 14, 46, 26, 3, '#1e293b', OUTLINE_COLOR, 2.2);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(monX + 4, monY - 10, 38, 18);

      // 키보드 도형
      this._fillStrokeRoundRect(ctx, monX + 5, monY + 22, 36, 10, 2, '#334155', OUTLINE_COLOR, 1.6);

      // 서류 더미
      const paperX = obs.monitorAlign === 'right' ? x + 22 : x + w - 52;
      this._fillStrokeRect(ctx, paperX, topY + 18, 24, 18, '#e2e8f0', OUTLINE_COLOR, 1.6);

      // 스탠드 조명 또는 머그컵
      if (obs.hasLamp) {
        const lampX = obs.monitorAlign === 'right' ? x + 58 : x + w - 22;
        const lampY = topY + 14;
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lampX, lampY - 10, 7, Math.PI, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(lampX, lampY - 10);
        ctx.lineTo(lampX + 4, lampY + 4);
        ctx.stroke();
      } else if (obs.hasMug) {
        const mugX = obs.monitorAlign === 'right' ? x + 60 : x + w - 20;
        const mugY = topY + 28;
        this._fillStrokeRoundRect(ctx, mugX - 5, mugY - 6, 10, 11, 2, '#f8fafc', OUTLINE_COLOR, 1.8);
        ctx.fillStyle = '#78350f';
        ctx.fillRect(mugX - 3, mugY - 4, 6, 3);
      }
    }

    _drawMeetingTable(ctx, obs) {
      const { x, y, width: w, height: d, zHeight: z } = obs;
      const topY = y - z;
      const frontY = y + d - z;

      // 테이블 기둥 다리
      this._fillStrokeRect(ctx, x + 36, frontY, 16, z, '#242c40', OUTLINE_COLOR, 2);
      this._fillStrokeRect(ctx, x + w - 52, frontY, 16, z, '#242c40', OUTLINE_COLOR, 2);

      // 상판 두께 + 상판
      this._fillStrokeRoundRect(ctx, x, frontY - 2, w, 9, 4, '#4e5d78', OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, x, topY, w, d, 10, '#64748b', OUTLINE_COLOR, 2.5);

      // 회의 자료 도형
      this._fillStrokeRect(ctx, x + 48, topY + 18, 28, 20, '#f1f5f9', OUTLINE_COLOR, 1.6);
      this._fillStrokeRect(ctx, x + 115, topY + 16, 34, 22, '#cbd5e1', OUTLINE_COLOR, 1.6);
      this._fillStrokeRoundRect(ctx, x + 175, topY + 22, 16, 12, 2, '#fef08a', OUTLINE_COLOR, 1.5);
    }

    _drawPillar(ctx, obs) {
      const { x, y, width: w, height: d, zHeight: z } = obs;
      this._drawBox3D(ctx, x, y, w, d, z, '#1e263b', '#2e3a59');

      // 기둥 하단 몰딩 띠
      const baseTop = y + d - 10;
      this._fillStrokeRect(ctx, x - 1, baseTop, w + 2, 10, '#1c2336', OUTLINE_COLOR, 2);
    }

    _drawCabinet(ctx, obs) {
      const { x, y, width: w, height: d, zHeight: z } = obs;
      this._drawBox3D(ctx, x, y, w, d, z, '#52607a', '#3d4961');

      const frontY = y + d - z;
      const halfW = w / 2;

      // 좌우 캐비닛 구분선 및 서랍 칸막이
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + halfW, frontY);
      ctx.lineTo(x + halfW, frontY + z);
      ctx.moveTo(x + 4, frontY + z * 0.34);
      ctx.lineTo(x + w - 4, frontY + z * 0.34);
      ctx.moveTo(x + 4, frontY + z * 0.67);
      ctx.lineTo(x + w - 4, frontY + z * 0.67);
      ctx.stroke();

      // 손잡이
      ctx.fillStyle = '#cbd5e1';
      for (let row = 0; row < 3; row++) {
        const hy = frontY + row * (z * 0.33) + 8;
        ctx.fillRect(x + halfW / 2 - 7, hy, 14, 3);
        ctx.fillRect(x + halfW + halfW / 2 - 7, hy, 14, 3);
      }
    }

    _drawCopier(ctx, obs) {
      const { x, y, width: w, height: d, zHeight: z } = obs;
      this._drawBox3D(ctx, x, y, w, d, z, '#cbd5e1', '#94a3b8');

      const topY = y - z;
      const frontY = y + d - z;

      // 복합기 스캐너 상판 커버 & 조작 패널
      this._fillStrokeRoundRect(ctx, x + 6, topY + 5, w - 28, d - 12, 3, '#e2e8f0', OUTLINE_COLOR, 2);
      this._fillStrokeRect(ctx, x + w - 18, topY + 10, 12, 22, '#334155', OUTLINE_COLOR, 1.6);

      // 대기 상태 초록 LED
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(x + w - 12, topY + 16, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // 전면 용지함 구분선
      this._fillStrokeRect(ctx, x + 10, frontY + 12, w - 20, 14, '#cbd5e1', OUTLINE_COLOR, 1.8);
      this._fillStrokeRect(ctx, x + 10, frontY + 29, w - 20, 12, '#cbd5e1', OUTLINE_COLOR, 1.8);
    }

    /**
     * 대시 중 생성되는 카툰 실루엣 잔상 렌더링
     */
    _drawPlayerAfterimage(ctx, ghost) {
      const progress = Math.min(1, ghost.elapsed / ghost.duration);
      const alpha = (1 - progress) * 0.42;

      ctx.save();
      ctx.translate(ghost.x, ghost.y);
      ctx.globalAlpha = Math.max(0, alpha);

      // 발과 몸통, 머리 실루엣을 민트/하늘색 잔상으로 표현
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 1.5;

      this._traceRoundRect(ctx, -12, -30, 24, 23, 6);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, -42, 12.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    /**
     * 카툰 스타일 회사원 플레이어 및 장착 무기 렌더링 (단순 도형 조합)
     * 대시 중 속도선 효과 및 무적 시간 동안 투명도·색상 변경 표현 포함
     */
    _drawPlayer(ctx, player, weaponId = null, activeMeleeEffect = null) {
      const px = player.position.x;
      const py = player.position.y;

      // 플레이어 사망 상태: 바닥에 쓰러진 카툰 회사원 연출
      if (player.isDead) {
        ctx.save();
        ctx.translate(px, py - 4);
        ctx.rotate(Math.PI * 0.5);
        this._fillStrokeRoundRect(ctx, -11, -12, 22, 22, 6, '#cbd5e1', OUTLINE_COLOR, 2.4);
        this._fillStrokeRect(ctx, -10, 4, 20, 7, '#1e293b', OUTLINE_COLOR, 2);
        ctx.fillStyle = '#fbd3b6';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(0, -22, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 기절 눈(X X) 표현
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-5, -24);
        ctx.lineTo(-2, -21);
        ctx.moveTo(-2, -24);
        ctx.lineTo(-5, -21);
        ctx.moveTo(2, -24);
        ctx.lineTo(5, -21);
        ctx.moveTo(5, -24);
        ctx.lineTo(2, -21);
        ctx.stroke();
        ctx.restore();
        return;
      }

      const dirX = player.direction.x;
      const dirY = player.direction.y;

      const isDashing = Boolean(player.dash && player.dash.isDashing);
      const isDashInvinc = Boolean(player.isDashInvulnerable && player.isDashInvulnerable());
      const isHitInvinc = Boolean(player.isHitInvulnerable && player.isHitInvulnerable());
      const isHurt = player.hurtFlashTimer > 0;

      const isMoving = player.isMoving;
      const bounce = isDashing ? 2 : isMoving ? Math.abs(Math.sin(player.walkPhase)) * 2.5 : 0;
      const stride = isMoving ? Math.sin(player.walkPhase) * 3.5 : 0;
      const facingBack = dirY < -0.55;

      ctx.save();
      ctx.translate(px, py);

      // 대시 중 속도선(Speed lines) 도형 표시
      if (isDashing) {
        const backX = -player.dash.dirX;
        const backY = -player.dash.dirY;
        const perpX = -backY;
        const perpY = backX;

        ctx.strokeStyle = 'rgba(186, 230, 253, 0.85)';
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        const offsets = [-12, 0, 11];
        const lengths = [22, 30, 20];

        for (let i = 0; i < offsets.length; i++) {
          const ox = perpX * offsets[i] + backX * 12;
          const oy = -22 + perpY * offsets[i] * 0.7 + backY * 12;
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + backX * lengths[i], oy + backY * lengths[i]);
          ctx.stroke();
        }
      }

      // 1) 대시 무적(0.25s): 청록색 실드 링 및 반투명 외형
      // 2) 피격 후 무적(0.6s): 빠른 깜빡임(Blink) 및 붉은 경고 색조 변화
      if (isDashInvinc) {
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.85)';
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(0, -24 - bounce, 21, 29, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.globalAlpha = 0.66;
      } else if (isHitInvinc) {
        const blinkOn = Math.floor(player.hitInvincibility.timer * 18) % 2 === 0;
        ctx.globalAlpha = blinkOn ? 0.4 : 0.88;
      }

      const outlineColor = isDashInvinc
        ? '#0ea5e9'
        : isHurt || isHitInvinc
          ? '#e11d48'
          : OUTLINE_COLOR;
      const shirtColor = isDashInvinc
        ? '#bae6fd'
        : isHurt
          ? '#fda4af'
          : isHitInvinc
            ? '#ffe4e6'
            : '#f1f5f9';
      const sleeveColor = isDashInvinc
        ? '#7dd3fc'
        : isHurt
          ? '#fb7185'
          : isHitInvinc
            ? '#fecdd3'
            : '#e2e8f0';
      const isInvincible = isDashInvinc;

      // 위쪽을 조준할 때는 무기가 몸통 뒤쪽에 자연스럽게 위치하도록 먼저 렌더링
      if (weaponId && facingBack) {
        this._drawEquippedWeapon(ctx, player, weaponId, bounce, activeMeleeEffect);
      }

      // 1. 다리 / 구두 (검은 정장 바지 & 구두 도형)
      this._fillStrokeRoundRect(ctx, -9, -9 + stride * 0.5, 7, 10, 3, '#1e2436', outlineColor, 2.2);
      this._fillStrokeRoundRect(ctx, 2, -9 - stride * 0.5, 7, 10, 3, '#1e2436', outlineColor, 2.2);

      // 2. 몸통 (와이셔츠 + 정장 바지 허리선)
      const bodyTop = -30 - bounce;
      this._fillStrokeRoundRect(ctx, -12, bodyTop, 24, 23, 6, shirtColor, outlineColor, 2.5);

      // 바지 상단 벨트라인
      this._fillStrokeRect(ctx, -11, bodyTop + 16, 22, 7, '#283147', outlineColor, 2);

      // 3. 정면/측면일 때 붉은 넥타이 및 사원증 표시 (방향에 따라 수평 오프셋)
      if (!facingBack) {
        const tieOffsetX = dirX * 4.5;

        // 붉은 넥타이
        ctx.fillStyle = isInvincible ? '#38bdf8' : '#e11d48';
        ctx.strokeStyle = outlineColor;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tieOffsetX, bodyTop + 2);
        ctx.lineTo(tieOffsetX + 3.2, bodyTop + 11);
        ctx.lineTo(tieOffsetX, bodyTop + 15);
        ctx.lineTo(tieOffsetX - 3.2, bodyTop + 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 사원증 배지
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(tieOffsetX + 4.5, bodyTop + 6, 4.5, 5.5);
      } else {
        // 뒷모습 셔츠 칼라 선
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-7, bodyTop + 3);
        ctx.lineTo(7, bodyTop + 3);
        ctx.stroke();
      }

      // 4. 양팔 (간단한 둥근 캡슐 소매)
      const armSwing = isMoving ? Math.sin(player.walkPhase) * 2.5 : 0;
      this._fillStrokeRoundRect(ctx, -16, bodyTop + 3 - armSwing * 0.6, 6, 13, 3, sleeveColor, outlineColor, 2.2);
      this._fillStrokeRoundRect(ctx, 10, bodyTop + 3 + armSwing * 0.6, 6, 13, 3, sleeveColor, outlineColor, 2.2);

      // 5. 머리 (둥근 카툰 헤드)
      const headY = -42 - bounce;
      const headRadius = 13;

      ctx.fillStyle = isInvincible ? '#e0f2fe' : '#fbd3b6';
      ctx.strokeStyle = outlineColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, headY, headRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (facingBack) {
        // 뒷모습 머리카락 덮개
        ctx.fillStyle = '#1f2437';
        ctx.beginPath();
        ctx.arc(0, headY - 1, headRadius - 0.5, Math.PI * 0.88, Math.PI * 2.12);
        ctx.quadraticCurveTo(0, headY + 11, -headRadius + 1, headY + 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // 윗머리(야근으로 살짝 흐트러진 직장인 헤어)
        ctx.fillStyle = '#1f2437';
        ctx.beginPath();
        ctx.arc(0, headY - 2, headRadius, Math.PI * 1.05, Math.PI * 1.95);
        ctx.quadraticCurveTo(4, headY - 7, -12, headY - 3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 눈 및 야근 다크서클 (바라보는 방향으로 시선 이동)
        const eyeShiftX = dirX * 4.2;
        const eyeShiftY = Math.max(-1.5, dirY * 2.0);

        const leftEyeX = -4.2 + eyeShiftX;
        const rightEyeX = 4.2 + eyeShiftX;
        const eyeY = headY + 1 + eyeShiftY;

        ctx.fillStyle = OUTLINE_COLOR;
        ctx.beginPath();
        ctx.arc(leftEyeX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.arc(rightEyeX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.fill();

        // 옅은 다크서클 라인
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(leftEyeX - 2, eyeY + 3.2);
        ctx.lineTo(leftEyeX + 2, eyeY + 3.2);
        ctx.moveTo(rightEyeX - 2, eyeY + 3.2);
        ctx.lineTo(rightEyeX + 2, eyeY + 3.2);
        ctx.stroke();
      }

      // 정수리 삐죽 솟은 머리카락 한 가닥 (카툰 포인트)
      ctx.strokeStyle = '#1f2437';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, headY - headRadius);
      ctx.quadraticCurveTo(4, headY - headRadius - 6, 8, headY - headRadius - 3);
      ctx.stroke();

      // 정면/측면 조준 시 무기를 몸통 앞쪽에 렌더링
      if (weaponId && !facingBack) {
        this._drawEquippedWeapon(ctx, player, weaponId, bounce, activeMeleeEffect);
      }

      ctx.restore();
    }

    /**
     * 현재 장착 무기(대형 사무용 스테이플러 / 사무용 권총) 도형 렌더링
     */
    _drawEquippedWeapon(ctx, player, weaponId, bounce, activeMeleeEffect = null) {
      const aimAngle = player.direction.angle;
      const meleePose =
        weaponId === 'melee' && activeMeleeEffect
          ? this._computeMeleeSwingPose(activeMeleeEffect)
          : null;
      const weaponAngle = meleePose ? meleePose.headAngle : aimAngle;
      const anchorY = player.aimOffsetY - bounce;

      ctx.save();
      ctx.translate(0, anchorY);
      ctx.rotate(weaponAngle);

      // 좌측을 조준할 때 무기가 뒤집히지 않도록 기준 조준각 기준으로 상하 반전
      if (Math.cos(aimAngle) < 0) {
        ctx.scale(1, -1);
      }

      if (weaponId === 'melee') {
        // 대형 사무용 스테이플러 (붉은 상단 레버 + 금속 하단 받침대)
        this._fillStrokeRoundRect(ctx, 10, 1, 16, 4.5, 1.5, '#64748b', OUTLINE_COLOR, 1.8);
        this._fillStrokeRoundRect(ctx, 9, -5.5, 17, 6.5, 2, '#e11d48', OUTLINE_COLOR, 2);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(21, -1, 4, 2.5);
      } else if (weaponId === 'ranged') {
        // 사무용 권총 (권총 손잡이 + 메탈 슬라이드 총열)
        this._fillStrokeRoundRect(ctx, 10, 0, 5.5, 7.5, 1.5, '#334155', OUTLINE_COLOR, 1.8);
        this._fillStrokeRoundRect(ctx, 9, -5, 17, 6, 1.8, '#94a3b8', OUTLINE_COLOR, 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(12, -3.2, 6, 2);
      }

      ctx.restore();
    }

    /**
     * 임시 공격 테스트 타겟(훈련용 표적 더미) 렌더링
     */
    _drawTestTarget(ctx, target) {
      const tx = target.position.x;
      const ty = target.position.y;
      const isFlashing = target.hitFlashTimer > 0;
      const wobbleX =
        target.shakeTimer > 0
          ? Math.sin(target.shakeTimer * 55) * 3.5 * (target.lastHitDirX || 1)
          : 0;

      ctx.save();
      ctx.translate(tx + wobbleX, ty);

      // 1. 철제 받침대 베이스 (바닥 접지면)
      this._fillStrokeRoundRect(ctx, -15, -6, 30, 10, 4, '#334155', OUTLINE_COLOR, 2.2);
      this._fillStrokeRect(ctx, -4, -18, 8, 13, '#475569', OUTLINE_COLOR, 2);

      // 2. 더미 몸통 (피격 시 흰색/밝은 붉은색 플래시)
      const bodyFill = isFlashing ? '#ffffff' : '#6d597a';
      this._fillStrokeRoundRect(ctx, -15, -44, 30, 29, 8, bodyFill, OUTLINE_COLOR, 2.5);

      // 3. 과녁(Bullseye) 마크
      const bullY = -29;
      ctx.fillStyle = isFlashing ? '#fca5a5' : '#f8fafc';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, bullY, 9.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(0, bullY, 5.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(0, bullY, 2.4, 0, Math.PI * 2);
      ctx.fill();

      // 4. 더미 헤드 및 포스트잇 장식
      this._fillStrokeRoundRect(ctx, -10, -59, 20, 16, 6, isFlashing ? '#ffffff' : '#8d779c', OUTLINE_COLOR, 2.4);
      this._fillStrokeRect(ctx, -4, -55, 9, 8, '#fef08a', OUTLINE_COLOR, 1.4);

      // 5. 타겟 상단 체력 바 표시
      const barW = 38;
      const barH = 6;
      const barX = -barW * 0.5;
      const barY = -71;
      const hpRatio = Math.max(0, Math.min(1, target.hp / target.maxHp));

      this._fillStrokeRoundRect(ctx, barX, barY, barW, barH, 3, '#0f172a', OUTLINE_COLOR, 1.6);
      if (hpRatio > 0) {
        ctx.fillStyle = hpRatio > 0.4 ? '#fb7185' : '#f43f5e';
        ctx.fillRect(barX + 1.5, barY + 1.5, (barW - 3) * hpRatio, barH - 3);
      }

      ctx.font = 'bold 10px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.5;
      const hpLabel = `${target.hp}`;
      ctx.strokeText(hpLabel, 0, barY - 3);
      ctx.fillText(hpLabel, 0, barY - 3);

      ctx.restore();
    }

    /**
     * 카툰풍 괴이 야근 사원(기본 적) 렌더링 (테스트 타깃 및 플레이어와 구분되는 도형 그래픽)
     * - 생존 시: 부유/보행 모션, 상태별 안광 색상, 피격 점멸, 머리 위 체력 바 및 상태 표시
     * - 사망(Dead) 시: 보랏빛 영체 붕괴 애니메이션 재생 후 제거
     */
    _drawEnemy(ctx, enemy) {
      const ex = enemy.position.x;
      const ey = enemy.position.y;

      // 사망(Dead) 상태: 간단한 소멸 애니메이션 렌더링 (체력 바 미표시)
      if (enemy.state === 'Dead' || !enemy.alive) {
        const p = Math.max(0, Math.min(1, enemy.deathTimer / Math.max(0.01, enemy.deathDuration)));
        const fade = 1 - p;

        ctx.save();
        ctx.translate(ex, ey);
        ctx.globalAlpha = fade;

        // 바닥으로 꺼지는 어두운 영체 소용돌이 원
        ctx.strokeStyle = '#c084fc';
        ctx.fillStyle = 'rgba(88, 28, 135, 0.45)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(0, -4, 18 + p * 18, 9 + p * 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 사방으로 흩어지는 괴이 입자 도형
        ctx.fillStyle = '#e879f9';
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + p * 1.4;
          const dist = 10 + p * 28;
          const px = Math.cos(ang) * dist;
          const py = -20 + Math.sin(ang) * dist * 0.65 - p * 14;
          ctx.beginPath();
          ctx.arc(px, py, Math.max(1.2, 4.2 * (1 - p)), 0, Math.PI * 2);
          ctx.fill();
        }

        // 수축하며 가라앉는 몸통 실루엣
        ctx.scale(1 + p * 0.25, Math.max(0.15, 1 - p * 0.78));
        this._fillStrokeRoundRect(ctx, -14, -44, 28, 36, 9, '#3b0764', OUTLINE_COLOR, 2.2);
        ctx.restore();
        return;
      }

      const isFlashing = enemy.hitFlashTimer > 0;
      const isAttacking = enemy.state === 'Attack';
      const isWindup = isAttacking && enemy.attack && enemy.attack.phase === 'windup';
      const windupProgress = isWindup
        ? Math.max(0, Math.min(1, 1 - enemy.attack.timer / Math.max(0.01, enemy.attack.windupDuration)))
        : 0;
      const isChasing = enemy.state === 'Chase' || isAttacking;
      const dirX = enemy.direction.x;
      const dirY = enemy.direction.y;
      const facingBack = dirY < -0.55;

      const bob = enemy.isMoving
        ? Math.abs(Math.sin(enemy.walkPhase)) * 3.2
        : Math.sin(performance.now() * 0.004) * 1.6;
      const wobbleX =
        enemy.shakeTimer > 0
          ? Math.sin(enemy.shakeTimer * 58) * 4 * (enemy.lastHitDirX || 1)
          : isWindup
            ? Math.sin(windupProgress * 28) * 1.8
            : 0;

      // 공격 타격 직후 짧은 전진 반동 오프셋
      const lungeOffset =
        isAttacking && enemy.attack && enemy.attack.phase === 'recovery' ? 5 : 0;

      ctx.save();
      ctx.translate(
        ex + wobbleX + dirX * lungeOffset,
        ey + dirY * lungeOffset * 0.65
      );

      // 공격 준비(Windup) 중 몸체가 부풀어 오르는 크기 변화 표현
      if (isWindup) {
        ctx.scale(1 + windupProgress * 0.14, 1 - windupProgress * 0.08);
      }

      // 1. 괴이 오라(Aura) 후광 (공격 준비 시 강렬한 주홍빛 경계 오라)
      ctx.fillStyle = isWindup
        ? `rgba(249, 115, 22, ${(0.22 + windupProgress * 0.25).toFixed(3)})`
        : isChasing
          ? 'rgba(225, 29, 72, 0.16)'
          : 'rgba(139, 92, 246, 0.14)';
      ctx.beginPath();
      ctx.ellipse(0, -25 - bob, 21 + windupProgress * 4, 27 + windupProgress * 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. 하단 그림자 촉수/해진 정장 자락
      const coatFill = isFlashing
        ? '#ffffff'
        : isWindup
          ? '#991b1b'
          : isChasing
            ? '#3b0764'
            : '#2e1065';
      const sleeveFill = isFlashing ? '#fecdd3' : isWindup ? '#dc2626' : '#4c1d95';
      const sway = enemy.isMoving ? Math.sin(enemy.walkPhase) * 3 : 0;

      ctx.fillStyle = isFlashing ? '#f8fafc' : '#1e1b4b';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-12, -12 - bob);
      ctx.lineTo(-14 + sway * 0.5, -1 - bob * 0.3);
      ctx.lineTo(-5, -6 - bob * 0.5);
      ctx.lineTo(0 + sway * 0.4, 0);
      ctx.lineTo(6, -6 - bob * 0.5);
      ctx.lineTo(14 - sway * 0.5, -1 - bob * 0.3);
      ctx.lineTo(12, -12 - bob);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 3. 구부정한 괴이 사원 상체 코트
      const bodyTop = -34 - bob;
      this._fillStrokeRoundRect(ctx, -14, bodyTop, 28, 25, 7, coatFill, OUTLINE_COLOR, 2.5);

      // 삐뚤어진 붉은 사원 넥타이 & 오염된 명찰
      if (!facingBack) {
        const tieX = dirX * 4;
        ctx.fillStyle = isFlashing ? '#fda4af' : '#fb7185';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tieX, bodyTop + 3);
        ctx.lineTo(tieX + 4, bodyTop + 13);
        ctx.lineTo(tieX - 1, bodyTop + 18);
        ctx.lineTo(tieX - 3.5, bodyTop + 11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#a78bfa';
        ctx.fillRect(tieX - 9, bodyTop + 6, 5, 4);
      }

      // 4. 앞으로 뻗은 괴이 양팔 (공격 준비 중 치켜드는 동작)
      const armReachY = isWindup ? -6 - windupProgress * 4 : isChasing ? -2.5 : 0;
      this._fillStrokeRoundRect(
        ctx,
        -18 + dirX * 2,
        bodyTop + 3 + armReachY - sway * 0.4,
        6.5,
        14,
        3,
        sleeveFill,
        OUTLINE_COLOR,
        2.2
      );
      this._fillStrokeRoundRect(
        ctx,
        11.5 + dirX * 2,
        bodyTop + 3 + armReachY + sway * 0.4,
        6.5,
        14,
        3,
        sleeveFill,
        OUTLINE_COLOR,
        2.2
      );

      // 5. 창백한 괴이 헤드 & 뿔 모양 그림자 머리카락
      const headY = -46 - bob;
      const headR = 13.5;
      ctx.fillStyle = isFlashing ? '#ffffff' : '#ddd6fe';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 삐죽 솟은 어두운 괴이 뿔/머리카락 장식
      ctx.fillStyle = '#1e1b4b';
      ctx.beginPath();
      ctx.moveTo(-12, headY - 4);
      ctx.lineTo(-15, headY - 17);
      ctx.lineTo(-5, headY - 12);
      ctx.lineTo(0, headY - 18);
      ctx.lineTo(6, headY - 12);
      ctx.lineTo(15, headY - 17);
      ctx.lineTo(12, headY - 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 번뜩이는 안광 (추적 시 붉은 안광, 대기/순찰 시 노란 안광)
      if (!facingBack) {
        const eyeShiftX = dirX * 4.4;
        const eyeShiftY = Math.max(-1.5, dirY * 2.0);
        const eyeY = headY + 1.5 + eyeShiftY;
        const eyeColor = isChasing ? '#ef4444' : '#facc15';

        ctx.fillStyle = OUTLINE_COLOR;
        ctx.beginPath();
        ctx.ellipse(-4.6 + eyeShiftX, eyeY, 3.3, 2.5, -0.2, 0, Math.PI * 2);
        ctx.ellipse(4.6 + eyeShiftX, eyeY, 3.3, 2.5, 0.2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = eyeColor;
        ctx.beginPath();
        ctx.arc(-4.6 + eyeShiftX, eyeY, 1.9, 0, Math.PI * 2);
        ctx.arc(4.6 + eyeShiftX, eyeY, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // 6. 머리 위 적 체력 바 및 상태 표시
      const barW = 44;
      const barH = 6.5;
      const barX = -barW * 0.5;
      const barY = -75 - bob * 0.35;
      const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));

      this._fillStrokeRoundRect(ctx, barX, barY, barW, barH, 3, '#0f172a', OUTLINE_COLOR, 1.8);
      if (hpRatio > 0) {
        ctx.fillStyle = isChasing ? '#e11d48' : '#a855f7';
        ctx.fillRect(barX + 1.5, barY + 1.5, (barW - 3) * hpRatio, barH - 3);
      }

      // 체력 수치 및 AI 상태 텍스트 (대기 / 순찰 / 추적 / 공격 준비)
      const stateBadge = isAttacking
        ? isWindup
          ? '공격 준비!'
          : '공격!'
        : enemy.state === 'Chase'
          ? enemy.isPlayerInRange
            ? '추적!'
            : '수색?'
          : enemy.state === 'Patrol'
            ? '순찰'
            : '대기';
      const topLabel = `${stateBadge} · ${enemy.hp}`;

      ctx.font = 'bold 10px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.8;
      ctx.strokeText(topLabel, 0, barY - 3.5);
      ctx.fillStyle = isWindup ? '#fde047' : isChasing ? '#fda4af' : '#e9d5ff';
      ctx.fillText(topLabel, 0, barY - 3.5);

      // 플레이어 최초 감지 직후 짧은 느낌표(!) 팝업 강조
      if (enemy.alertTimer > 0) {
        ctx.font = '900 15px "Malgun Gothic", sans-serif';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3.5;
        ctx.strokeText('!', 0, barY - 16);
        ctx.fillStyle = '#fde047';
        ctx.fillText('!', 0, barY - 16);
      }

      ctx.restore();
    }

    /**
     * 원거리 무기 투사체 렌더링 (상체 높이로 비행)
     */
    _drawProjectile(ctx, proj) {
      const visualY = proj.y - 18;
      const prevVisualY = proj.prevY - 18;

      ctx.save();

      // 짧은 잔상 궤적
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(proj.prevX - Math.cos(proj.angle) * 8, prevVisualY - Math.sin(proj.angle) * 8);
      ctx.lineTo(proj.x, visualY);
      ctx.stroke();

      // 탄환 본체
      ctx.translate(proj.x, visualY);
      ctx.rotate(proj.angle);
      this._fillStrokeRoundRect(ctx, -6, -3.5, 12, 7, 3.5, '#fde047', OUTLINE_COLOR, 2);

      ctx.restore();
    }

    /**
     * 근접 휘두르기 이펙트의 시간 진행률(0~1)에 따른 회전 각도, 반경 크기, 투명도 계산
     * - 초반: 작고 반투명하게 시작
     * - 중반: 공격 방향으로 빠르게 휘둘러지며 크게 펼쳐짐
     * - 후반: 반경이 줄어들고 투명도가 빠르게 감소하며 자연스럽게 소멸
     */
    _computeMeleeSwingPose(fx) {
      const t = Math.max(0, Math.min(1, fx.elapsed / fx.duration));
      const sweepDir = Math.cos(fx.angle) < 0 ? -1 : 1;
      const totalSweep = fx.arcRad * 1.12;
      const startBase = fx.angle - sweepDir * (totalSweep * 0.5);

      // 선두 각도는 초반~중반에 빠르게 회전하고, 후미 각도는 중후반에 빠르게 따라붙음
      const headProgress = Math.min(1, t / 0.68);
      const headNorm = 0.16 + 0.84 * (1 - Math.pow(1 - headProgress, 2.5));
      const tailNorm = 0.86 * Math.pow(t, 2.0);

      const tailAngle = startBase + sweepDir * totalSweep * tailNorm;
      const headAngle = startBase + sweepDir * totalSweep * headNorm;

      // 반경 크기 변화: 초반 작게 시작(0.42x) -> 중반 크게 확장(1.04x) -> 후반 축소(0.72x)
      let radiusScale;
      if (t < 0.38) {
        const u = t / 0.38;
        radiusScale = 0.42 + 0.62 * (1 - Math.pow(1 - u, 1.85));
      } else if (t <= 0.56) {
        const m = (t - 0.38) / 0.18;
        radiusScale = 1.04 - 0.04 * m;
      } else {
        const v = (t - 0.56) / 0.44;
        radiusScale = 1.0 - 0.28 * Math.pow(v, 1.3);
      }

      // 투명도 변화: 초반 반투명 시작 -> 중반 선명 -> 후반 빠르게 감쇠하여 소멸
      let alpha;
      if (t < 0.26) {
        const u = t / 0.26;
        alpha = 0.18 + 0.76 * (u * (2 - u));
      } else if (t <= 0.52) {
        const m = (t - 0.26) / 0.26;
        alpha = 0.94 - 0.06 * m;
      } else {
        const w = (t - 0.52) / 0.48;
        alpha = 0.88 * Math.pow(1 - w, 2.4);
      }

      return {
        t,
        sweepDir,
        tailAngle,
        headAngle,
        outerRadius: fx.maxRadius * radiusScale,
        alpha
      };
    }

    /**
     * 선두(휘두르는 방향)는 두껍고 후미 끝단으로 갈수록 매끄럽게 좁아지는 카툰풍 단일 부채꼴 경로 생성
     */
    _traceTaperedFanPath(ctx, tailAngle, headAngle, sweepDir, outerR, innerHeadRatio = 0.16) {
      const anticlockwise = sweepDir < 0;
      const innerHeadR = outerR * innerHeadRatio;

      ctx.beginPath();
      ctx.arc(0, 0, outerR, tailAngle, headAngle, anticlockwise);
      ctx.lineTo(Math.cos(headAngle) * innerHeadR, Math.sin(headAngle) * innerHeadR);

      const segments = 10;
      for (let s = 1; s <= segments; s++) {
        const u = s / segments;
        const ang = headAngle + (tailAngle - headAngle) * u;
        const r = innerHeadR + (outerR - innerHeadR) * Math.pow(u, 1.7);
        ctx.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }

      ctx.closePath();
    }

    /**
     * 대형 사무용 스테이플러 단일 부채꼴 휘두르기 시각 효과 (공격 판정과 분리된 meleeEffects 렌더링)
     */
    _drawMeleeSlashArc(ctx, combat) {
      if (!combat.meleeEffects || combat.meleeEffects.length === 0) {
        return;
      }

      for (let i = 0; i < combat.meleeEffects.length; i++) {
        const fx = combat.meleeEffects[i];
        const pose = this._computeMeleeSwingPose(fx);
        if (pose.alpha <= 0.005 || pose.outerRadius <= 2) {
          continue;
        }

        const originY = fx.y + (fx.aimOffsetY ?? -18);
        const { sweepDir, tailAngle, headAngle, outerRadius, alpha } = pose;
        const anticlockwise = sweepDir < 0;

        ctx.save();
        ctx.translate(fx.x, originY);

        // 단일 황금색/노란색 카툰 부채꼴 본체 (후미는 옅은 잔상처럼 투명하고 선두로 갈수록 선명한 황금빛)
        this._traceTaperedFanPath(ctx, tailAngle, headAngle, sweepDir, outerRadius, 0.16);
        const gradR = outerRadius * 0.72;
        const tailX = Math.cos(tailAngle) * gradR;
        const tailY = Math.sin(tailAngle) * gradR;
        const headX = Math.cos(headAngle) * gradR;
        const headY = Math.sin(headAngle) * gradR;

        const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);
        grad.addColorStop(0, `rgba(245, 158, 11, ${(alpha * 0.14).toFixed(3)})`);
        grad.addColorStop(0.52, `rgba(251, 191, 36, ${(alpha * 0.68).toFixed(3)})`);
        grad.addColorStop(1, `rgba(253, 224, 71, ${(alpha * 0.94).toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fill();

        // 카툰풍 윤곽을 살리는 부드러운 황금빛 테두리
        ctx.strokeStyle = `rgba(217, 119, 6, ${(alpha * 0.52).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // 바깥 칼날 원호 및 선두 타격선 밝은 노란색 하이라이트
        const innerHeadR = outerRadius * 0.18;
        const edgeGrad = ctx.createLinearGradient(tailX, tailY, headX, headY);
        edgeGrad.addColorStop(0, `rgba(254, 240, 138, ${(alpha * 0.18).toFixed(3)})`);
        edgeGrad.addColorStop(0.45, `rgba(254, 240, 138, ${(alpha * 0.78).toFixed(3)})`);
        edgeGrad.addColorStop(1, `rgba(254, 249, 195, ${(alpha * 0.98).toFixed(3)})`);
        ctx.strokeStyle = edgeGrad;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, outerRadius - 1.4), tailAngle, headAngle, anticlockwise);
        ctx.lineTo(Math.cos(headAngle) * innerHeadR, Math.sin(headAngle) * innerHeadR);
        ctx.stroke();

        ctx.restore();
      }
    }

    /**
     * 적 근접 공격 타격 순간의 붉은 할퀴기 부채꼴 이펙트
     */
    _drawEnemySlashEffects(ctx, enemySystem) {
      const aliveEnemies = enemySystem.getAliveEnemies();
      for (let i = 0; i < aliveEnemies.length; i++) {
        const enemy = aliveEnemies[i];
        if (!enemy.attack || enemy.attack.slashTimer <= 0) {
          continue;
        }

        const t = Math.max(
          0,
          Math.min(1, 1 - enemy.attack.slashTimer / Math.max(0.01, enemy.attack.slashDuration))
        );
        const alpha = Math.pow(1 - t, 1.8);
        const sweepDir = Math.cos(enemy.attack.aimAngle) < 0 ? -1 : 1;
        const halfArc = enemy.attackArcRad * 0.5;
        const tailAngle = enemy.attack.aimAngle - sweepDir * halfArc * (1 - t * 0.45);
        const headAngle = enemy.attack.aimAngle + sweepDir * halfArc;
        const radius = enemy.attackRange * (0.92 + 0.1 * (1 - t));

        ctx.save();
        ctx.translate(enemy.position.x, enemy.position.y - 20);
        this._traceTaperedFanPath(ctx, tailAngle, headAngle, sweepDir, radius, 0.22);
        ctx.fillStyle = `rgba(244, 63, 94, ${(alpha * 0.65).toFixed(3)})`;
        ctx.fill();

        ctx.strokeStyle = `rgba(254, 205, 211, ${(alpha * 0.92).toFixed(3)})`;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(1, radius - 1), tailAngle, headAngle, sweepDir < 0);
        ctx.stroke();
        ctx.restore();
      }
    }

    /**
     * 플레이어 피격 링 및 피해량(-15) / 대시 회피 텍스트 렌더링
     */
    _drawPlayerDamageFeedback(ctx, playerDamageSystem) {
      for (let i = 0; i < playerDamageSystem.hitRings.length; i++) {
        const ring = playerDamageSystem.hitRings[i];
        const t = Math.min(1, ring.elapsed / ring.duration);
        const radius = 5 + (ring.maxRadius - 5) * t;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 3 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (playerDamageSystem.popups.length > 0) {
        ctx.save();
        ctx.font = '800 15px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < playerDamageSystem.popups.length; i++) {
          const p = playerDamageSystem.popups[i];
          const t = Math.min(1, p.elapsed / p.duration);
          const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.strokeStyle = OUTLINE_COLOR;
          ctx.lineWidth = 3.5;
          ctx.strokeText(p.text, p.x, p.y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, p.x, p.y);
        }
        ctx.restore();
      }
    }

    /**
     * 타겟 피격 및 벽 충돌 스파크 이펙트
     */
    _drawImpactEffects(ctx, combat) {
      for (let i = 0; i < combat.impactEffects.length; i++) {
        const fx = combat.impactEffects[i];
        const t = Math.min(1, fx.elapsed / fx.duration);
        const radius = 4 + (fx.maxRadius - 4) * t;
        const alpha = 1 - t;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 2.8 * (1 - t * 0.5);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    /**
     * 피해량(-25, -15 등) 플로팅 텍스트 표시
     */
    _drawDamagePopups(ctx, combat) {
      ctx.save();
      ctx.font = '800 15px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';

      for (let i = 0; i < combat.damagePopups.length; i++) {
        const popup = combat.damagePopups[i];
        const t = Math.min(1, popup.elapsed / popup.duration);
        const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;

        ctx.globalAlpha = Math.max(0, alpha);
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3.5;
        ctx.strokeText(popup.text, popup.x, popup.y);

        ctx.fillStyle = popup.color;
        ctx.fillText(popup.text, popup.x, popup.y);
      }

      ctx.restore();
    }

    /**
     * 마우스 조준 위치 크로스헤어 렌더링
     */
    _drawAimCrosshair(ctx, aimWorld, weaponId) {
      const { x, y } = aimWorld;
      const color = weaponId === 'ranged' ? '#38bdf8' : '#fbbf24';

      ctx.save();
      ctx.translate(x, y);

      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.moveTo(-12, 0);
      ctx.lineTo(-5, 0);
      ctx.moveTo(5, 0);
      ctx.lineTo(12, 0);
      ctx.moveTo(0, -12);
      ctx.lineTo(0, -5);
      ctx.moveTo(0, 5);
      ctx.lineTo(0, 12);
      ctx.stroke();

      ctx.restore();
    }

    _fillStrokeRect(ctx, x, y, w, h, fill, stroke, lineWidth) {
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.strokeRect(x, y, w, h);
    }

    _fillRoundRectOnly(ctx, x, y, w, h, r) {
      this._traceRoundRect(ctx, x, y, w, h, r);
      ctx.fill();
    }

    _fillStrokeRoundRect(ctx, x, y, w, h, r, fill, stroke, lineWidth) {
      this._traceRoundRect(ctx, x, y, w, h, r);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    _traceRoundRect(ctx, x, y, w, h, r) {
      const radius = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + w - radius, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
      ctx.lineTo(x + w, y + h - radius);
      ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      ctx.lineTo(x + radius, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
    }
  }

  PO.Renderer = Renderer;
})(window);
