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

      // 논리 뷰포트 해상도 (16:10 고정, 월드 크기와 독립적인 카메라 뷰포트)
      this.viewWidth = 1280;
      this.viewHeight = 800;

      // 플레이어를 추적하는 월드 카메라 상태
      this.camera = {
        x: 0,
        y: 0,
        width: this.viewWidth,
        height: this.viewHeight
      };

      this.scale = 1;
      this.dpr = 1;

      this._onResize = this.resize.bind(this);
      window.addEventListener('resize', this._onResize);
      this.resize();
    }

    /**
     * 브라우저 창 크기에 맞춰 16:10 게임 뷰포트 비율을 유지하며 고해상도(DPR) 스케일링 적용
     */
    resize() {
      const padding = 16;
      const availWidth = Math.max(320, window.innerWidth - padding);
      const availHeight = Math.max(240, window.innerHeight - padding);

      const logicalWidth = this.viewWidth;
      const logicalHeight = this.viewHeight;

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
     * 플레이어 월드 좌표를 중심으로 카메라 뷰포트를 갱신하고 맵 경계 내로 클램핑
     */
    updateCamera(player, officeMap = this.officeMap) {
      if (!player || !officeMap) {
        return this.camera;
      }

      const maxCamX = Math.max(0, officeMap.width - this.viewWidth);
      const maxCamY = Math.max(0, officeMap.height - this.viewHeight);

      const targetX = player.position.x - this.viewWidth * 0.5;
      const targetY = player.position.y - this.viewHeight * 0.5;

      this.camera.x = Math.max(0, Math.min(maxCamX, targetX));
      this.camera.y = Math.max(0, Math.min(maxCamY, targetY));
      this.camera.width = this.viewWidth;
      this.camera.height = this.viewHeight;

      return this.camera;
    }

    /**
     * 화면 좌표를 카메라 오프셋이 반영된 실제 게임 월드 좌표로 변환
     */
    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return {
          x: this.camera.x + this.viewWidth * 0.5,
          y: this.camera.y + this.viewHeight * 0.5
        };
      }
      return {
        x: this.camera.x + ((clientX - rect.left) / rect.width) * this.viewWidth,
        y: this.camera.y + ((clientY - rect.top) / rect.height) * this.viewHeight
      };
    }

    /**
     * 전체 프레임 렌더링 (다중 방·복도·문·벽 월드 카메라 투영 + 뷰포트 조명 연출)
     */
    render(
      officeMap,
      player,
      combat = null,
      aimWorld = null,
      testHazard = null,
      enemySystem = null,
      playerDamageSystem = null,
      itemSystem = null,
      boss = null,
      escapeDevice = null
    ) {
      if (player && officeMap) {
        this.updateCamera(player, officeMap);
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);

      // 0. 뷰포트 외곽 암흑 배경 초기화
      ctx.fillStyle = '#090c15';
      ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

      // 월드 좌표계 카메라 변환 시작
      ctx.save();
      ctx.translate(-this.camera.x, -this.camera.y);

      // 1. 다중 방·복도 카펫 바닥 및 열린 문(Door) 문턱 렌더링
      this._drawFloor(ctx, officeMap);

      // 2. 방·복도 북쪽(뒷면) 벽면 및 창문/시계/표지판 장식
      this._drawBackAndSideWalls(ctx, officeMap);

      // 3. 위험 구역, 아이템 바닥 표시, 적 감지/공격 예고 표시, 그림자 및 플레이어 방향 화살표
      if (testHazard) {
        testHazard.renderFloor(ctx);
      }
      if (itemSystem) {
        this._drawItemFloorIndicators(ctx, itemSystem);
      }
      if (enemySystem) {
        this._drawEnemyFloorIndicators(ctx, enemySystem);
      }
      if (boss) {
        this._drawBossTelegraphs(ctx, boss);
      }
      if (escapeDevice) {
        this._drawEscapeDeviceFloor(ctx, escapeDevice);
      }
      this._drawShadows(ctx, officeMap, player, combat, enemySystem, itemSystem, boss);
      if (!player.isDead) {
        this._drawPlayerDirectionIndicator(ctx, player);
      }

      // 4. 쿼터뷰 Y-정렬 렌더링 (측면·남쪽 격벽 + 책상/기둥 장애물 + 아이템 + 적 + 플레이어)
      const renderQueue = [];

      if (Array.isArray(officeMap.walls)) {
        for (let i = 0; i < officeMap.walls.length; i++) {
          const wall = officeMap.walls[i];
          if (wall.side === 'north') {
            continue;
          }
          renderQueue.push({
            kind: 'wall',
            sortY: wall.y + wall.height,
            data: wall
          });
        }
      }

      for (let i = 0; i < officeMap.obstacles.length; i++) {
        const obs = officeMap.obstacles[i];
        renderQueue.push({
          kind: 'obstacle',
          sortY: obs.y + obs.height,
          data: obs
        });
      }

      if (Array.isArray(officeMap.doors)) {
        for (let i = 0; i < officeMap.doors.length; i++) {
          const door = officeMap.doors[i];
          if (door.locked) {
            renderQueue.push({
              kind: 'locked_door',
              sortY: door.y + door.height,
              data: door
            });
          }
        }
      }

      if (itemSystem) {
        const activeItems = itemSystem.getActiveItems();
        for (let i = 0; i < activeItems.length; i++) {
          const worldItem = activeItems[i];
          renderQueue.push({
            kind: 'item',
            sortY: worldItem.getSortY(),
            data: worldItem,
            isFocused: itemSystem.focusedItem === worldItem
          });
        }
      }

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

        // Phase 14: 원거리 적(서류 투척자) 서류 투사체 깊이 정렬 렌더링
        if (Array.isArray(enemySystem.enemyProjectiles)) {
          for (let i = 0; i < enemySystem.enemyProjectiles.length; i++) {
            const proj = enemySystem.enemyProjectiles[i];
            if (proj.alive) {
              renderQueue.push({
                kind: 'enemy_projectile',
                sortY: proj.y,
                data: proj
              });
            }
          }
        }
      }

      if (boss && (boss.alive || boss.deathTimer > 0)) {
        renderQueue.push({
          kind: 'boss',
          sortY: boss.getSortY(),
          data: boss
        });
      }

      if (escapeDevice) {
        renderQueue.push({
          kind: 'escape_device',
          sortY: escapeDevice.getSortY(),
          data: escapeDevice,
          isFocused: escapeDevice.isFocused
        });
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
          case 'wall':
            this._drawStructuralWall(ctx, item.data);
            break;
          case 'obstacle':
            this._drawObstacle(ctx, item.data);
            break;
          case 'locked_door':
            this._drawLockedDoorShutter(ctx, item.data);
            break;
          case 'item':
            this._drawWorldItem(ctx, item.data, item.isFocused);
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
          case 'enemy_projectile':
            this._drawEnemyProjectile(ctx, item.data);
            break;
          case 'projectile':
            this._drawProjectile(ctx, item.data);
            break;
          case 'player':
            this._drawPlayer(ctx, item.data, item.weaponId, item.activeMeleeEffect);
            break;
          case 'boss':
            this._drawBoss(ctx, item.data);
            break;
          case 'escape_device':
            this._drawEscapeDevice(ctx, item.data, item.isFocused);
            break;
          default:
            break;
        }
      }

      // 5. 플레이어/적/보스 근접 휘두르기 궤적, 피격 스파크, 플로팅 피해량 및 아이템 피드백
      if (enemySystem) {
        this._drawEnemySlashEffects(ctx, enemySystem);
      }
      if (boss) {
        this._drawBossAttackEffects(ctx, boss);
      }
      if (combat) {
        this._drawMeleeSlashArc(ctx, combat);
        this._drawImpactEffects(ctx, combat);
        this._drawDamagePopups(ctx, combat);
      }
      if (playerDamageSystem) {
        this._drawPlayerDamageFeedback(ctx, playerDamageSystem);
      }
      if (itemSystem) {
        this._drawItemFeedbackEffects(ctx, itemSystem);
      }
      if (testHazard) {
        testHazard.renderPopups(ctx);
      }

      // 월드 좌표계 종료
      ctx.restore();

      // 6. 뷰포트 기준 야근 조명 비네팅 연출
      this._drawNightAtmosphere(ctx);

      // 7. 마우스 조준선(크로스헤어) 표시 (카메라 보정 후 뷰포트 최상단에 선명하게 표시)
      if (aimWorld && !player.isDead) {
        this._drawAimCrosshair(
          ctx,
          {
            x: aimWorld.x - this.camera.x,
            y: aimWorld.y - this.camera.y
          },
          equippedWeaponId
        );
      }

      ctx.restore();
    }

    /**
     * 모든 복도와 방의 타일 바닥, 러그 매트, 조명 광원, 열린 문턱(Door)을 맵 데이터 기반으로 렌더링
     */
    _drawFloor(ctx, officeMap) {
      const { tileWidth, tileHeight, floorMats } = officeMap;
      const corridors = Array.isArray(officeMap.corridors) ? officeMap.corridors : [];
      const rooms = Array.isArray(officeMap.rooms) ? officeMap.rooms : [];
      const doors = Array.isArray(officeMap.doors) ? officeMap.doors : [];

      // 1. 복도 바닥 먼저 렌더링 후 방 바닥 렌더링
      for (let i = 0; i < corridors.length; i++) {
        this._drawTiledSpaceFloor(ctx, corridors[i], tileWidth, tileHeight, true);
      }
      for (let i = 0; i < rooms.length; i++) {
        this._drawTiledSpaceFloor(ctx, rooms[i], tileWidth, tileHeight, false);
      }

      // 2. 방/복도 바닥 매트 및 러그 장식
      if (Array.isArray(floorMats)) {
        for (let i = 0; i < floorMats.length; i++) {
          const mat = floorMats[i];
          this._fillStrokeRoundRect(
            ctx,
            mat.x,
            mat.y,
            mat.width,
            mat.height,
            6,
            mat.color,
            mat.border,
            2
          );
        }
      }

      // 3. 방별 은은한 바닥 조명 및 복도 천장등 광원
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        if (!Array.isArray(room.lightGlows)) continue;
        for (let g = 0; g < room.lightGlows.length; g++) {
          const glow = room.lightGlows[g];
          this._drawFloorGlow(ctx, glow.x, glow.y, glow.radius, glow.color);
        }
      }
      for (let i = 0; i < corridors.length; i++) {
        const c = corridors[i];
        this._drawFloorGlow(
          ctx,
          c.x + c.width * 0.5,
          c.y + c.height * 0.5,
          Math.max(c.width, c.height) * 0.55,
          'rgba(148, 163, 184, 0.08)'
        );
      }

      // 4. 전투 중(Active) 또는 클리어(Cleared) 전투 방 바닥 테두리 상태 피드백
      const roomStateMap = new Map();
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        roomStateMap.set(room.id, room.state || 'Unvisited');
        if (room.type === 'combat' && room.state === 'Active') {
          ctx.save();
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.42)';
          ctx.lineWidth = 4;
          ctx.strokeRect(room.x + 4, room.y + 4, room.width - 8, room.height - 8);
          ctx.restore();
        } else if (room.type === 'combat' && room.state === 'Cleared') {
          ctx.save();
          ctx.strokeStyle = 'rgba(74, 222, 128, 0.22)';
          ctx.lineWidth = 3;
          ctx.strokeRect(room.x + 4, room.y + 4, room.width - 8, room.height - 8);
          ctx.restore();
        }
      }

      // 5. 방과 복도를 연결하는 문(Door) 문턱 및 문틀 프레임 표시
      for (let i = 0; i < doors.length; i++) {
        const door = doors[i];
        this._drawDoorThreshold(ctx, door, roomStateMap.get(door.roomId) || 'Unvisited');
      }
    }

    _drawTiledSpaceFloor(ctx, space, tileWidth, tileHeight, isCorridor) {
      const palette = space.floorPalette || {
        primary: isCorridor ? '#171e2f' : '#1e2639',
        secondary: isCorridor ? '#141a29' : '#1a2132'
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(space.x, space.y, space.width, space.height);
      ctx.clip();

      ctx.fillStyle = palette.secondary;
      ctx.fillRect(space.x, space.y, space.width, space.height);

      // 월드 좌표에 정렬된 타일 그리드 (방과 복도 경계에서 타일이 자연스럽게 이어짐)
      const startCol = Math.floor(space.x / tileWidth);
      const endCol = Math.ceil((space.x + space.width) / tileWidth);
      const startRow = Math.floor(space.y / tileHeight);
      const endRow = Math.ceil((space.y + space.height) / tileHeight);

      for (let r = startRow; r < endRow; r++) {
        for (let c = startCol; c < endCol; c++) {
          const tx = c * tileWidth;
          const ty = r * tileHeight;
          const isAlt = Math.abs(r + c) % 2 === 0;
          ctx.fillStyle = isAlt ? palette.primary : palette.secondary;
          ctx.fillRect(tx, ty, tileWidth, tileHeight);
        }
      }

      ctx.strokeStyle = 'rgba(10, 13, 23, 0.46)';
      ctx.lineWidth = 1;
      for (let c = startCol + 1; c < endCol; c++) {
        const gx = c * tileWidth;
        ctx.beginPath();
        ctx.moveTo(gx, space.y);
        ctx.lineTo(gx, space.y + space.height);
        ctx.stroke();
      }
      for (let r = startRow + 1; r < endRow; r++) {
        const gy = r * tileHeight;
        ctx.beginPath();
        ctx.moveTo(space.x, gy);
        ctx.lineTo(space.x + space.width, gy);
        ctx.stroke();
      }

      // 북쪽 벽 바로 아래 바닥 그림자 그라데이션
      const shadowDepth = isCorridor ? 18 : 24;
      const wallShadow = ctx.createLinearGradient(0, space.y, 0, space.y + shadowDepth);
      wallShadow.addColorStop(0, 'rgba(7, 9, 16, 0.52)');
      wallShadow.addColorStop(1, 'rgba(7, 9, 16, 0)');
      ctx.fillStyle = wallShadow;
      ctx.fillRect(space.x, space.y, space.width, shadowDepth);

      ctx.restore();
    }

    /**
     * 방과 복도 사이의 문(Door) 바닥 문턱과 좌우/상하 문설주 도형 렌더링
     */
    _drawDoorThreshold(ctx, door, roomState = 'Unvisited') {
      ctx.save();
      const isLocked = Boolean(door.locked);
      const isCleared = !isLocked && roomState === 'Cleared';
      const plateColor = isLocked ? '#3f1d2b' : '#2b3752';
      const railColor = isLocked
        ? 'rgba(251, 113, 133, 0.72)'
        : isCleared
          ? 'rgba(74, 222, 128, 0.52)'
          : 'rgba(148, 163, 184, 0.42)';
      const postColor = isLocked ? '#64263b' : '#475569';

      if (door.orientation === 'vertical') {
        // 바닥 금속/슬레이트 문턱 플레이트
        this._fillStrokeRect(
          ctx,
          door.x,
          door.y + 2,
          door.width,
          door.height - 4,
          plateColor,
          OUTLINE_COLOR,
          1.8
        );

        // 중앙 레일 홈
        ctx.strokeStyle = railColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(door.x + door.width * 0.5, door.y + 8);
        ctx.lineTo(door.x + door.width * 0.5, door.y + door.height - 8);
        ctx.stroke();
        ctx.setLineDash([]);

        // 상/하 문틀 포스트(문설주)
        this._fillStrokeRect(ctx, door.x - 3, door.y - 4, door.width + 6, 8, postColor, OUTLINE_COLOR, 2);
        this._fillStrokeRect(
          ctx,
          door.x - 3,
          door.y + door.height - 4,
          door.width + 6,
          8,
          postColor,
          OUTLINE_COLOR,
          2
        );
      } else {
        // 수평 문 바닥 문턱 플레이트
        this._fillStrokeRect(
          ctx,
          door.x + 2,
          door.y,
          door.width - 4,
          door.height,
          plateColor,
          OUTLINE_COLOR,
          1.8
        );

        ctx.strokeStyle = railColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(door.x + 8, door.y + door.height * 0.5);
        ctx.lineTo(door.x + door.width - 8, door.y + door.height * 0.5);
        ctx.stroke();
        ctx.setLineDash([]);

        // 좌/우 문틀 포스트(문설주)
        this._fillStrokeRect(ctx, door.x - 4, door.y - 3, 8, door.height + 6, postColor, OUTLINE_COLOR, 2);
        this._fillStrokeRect(
          ctx,
          door.x + door.width - 4,
          door.y - 3,
          8,
          door.height + 6,
          postColor,
          OUTLINE_COLOR,
          2
        );
      }

      ctx.restore();
    }

    /**
     * 전투 진행 중 잠긴 출입문(door.locked === true)의 2.5D 철제 방화 셔터 및 경고등 렌더링
     */
    _drawLockedDoorShutter(ctx, door) {
      ctx.save();
      const z = door.zHeight ?? 36;
      const topY = door.y - z;

      // 1. 정면/측면 입체 철제 셔터 기둥 몸체
      this._fillStrokeRect(
        ctx,
        door.x,
        door.y,
        door.width,
        door.height,
        '#2b1929',
        OUTLINE_COLOR,
        2.2
      );

      // 2. 상단 셔터 단면 캡
      this._fillStrokeRect(
        ctx,
        door.x,
        topY,
        door.width,
        door.height,
        '#382238',
        OUTLINE_COLOR,
        2.2
      );

      // 3. 전면 수직 장갑판 면 (남쪽 하단 두께 면)
      this._fillStrokeRect(
        ctx,
        door.x,
        door.y + door.height - z,
        door.width,
        z,
        '#241524',
        OUTLINE_COLOR,
        2.2
      );

      // 4. 붉은 봉쇄 에너지 라인 및 잠금 경고등 표시
      if (door.orientation === 'vertical') {
        const midX = door.x + door.width * 0.5;
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(midX, topY + 6);
        ctx.lineTo(midX, topY + door.height - 6);
        ctx.stroke();

        // 중앙 잠금 코어 인디케이터
        const cy = topY + door.height * 0.5;
        this._fillStrokeRoundRect(ctx, door.x - 2, cy - 10, door.width + 4, 20, 4, '#4c1d2e', OUTLINE_COLOR, 1.8);
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(midX, cy, 4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const midY = topY + door.height * 0.5;
        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(door.x + 6, midY);
        ctx.lineTo(door.x + door.width - 6, midY);
        ctx.stroke();

        // 정면 경고 스트라이프 바
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(door.x + 6, door.y + door.height - z * 0.62, door.width - 12, 5);

        // 중앙 잠금 코어 인디케이터
        const cx = door.x + door.width * 0.5;
        this._fillStrokeRoundRect(ctx, cx - 12, topY - 2, 24, door.height + 4, 4, '#4c1d2e', OUTLINE_COLOR, 1.8);
        ctx.fillStyle = '#f43f5e';
        ctx.beginPath();
        ctx.arc(cx, midY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

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

    /**
     * 각 방과 복도의 북쪽(뒷면) 수직 벽면, 상단 단면 캡, 창문·시계·화이트보드·표지판 렌더링
     */
    _drawBackAndSideWalls(ctx, officeMap) {
      const walls = Array.isArray(officeMap.walls) ? officeMap.walls : [];
      const rooms = Array.isArray(officeMap.rooms) ? officeMap.rooms : [];
      const roomMap = new Map();
      for (let i = 0; i < rooms.length; i++) {
        roomMap.set(rooms[i].id, rooms[i]);
      }

      // 1. 북쪽 벽 세그먼트(수직 실내 벽면 + 걸레받이 몰딩 + 상단 벽 두께 캡) 렌더링
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        if (wall.side !== 'north') {
          continue;
        }

        const isRoomWall = wall.spaceKind === 'room';
        const room = roomMap.get(wall.spaceId);
        const isSupply = room && room.type === 'supply';

        const floorTopY = wall.y + wall.height;
        const faceHeight = isRoomWall ? 68 : 42;
        const capHeight = isRoomWall ? 18 : 14;
        const faceTopY = floorTopY - faceHeight;
        const capTopY = faceTopY - capHeight;

        const wallFaceColor = isSupply
          ? '#243542'
          : isRoomWall
            ? '#27314a'
            : '#212a40';

        // 수직 벽 정면
        this._fillStrokeRect(
          ctx,
          wall.x,
          faceTopY,
          wall.width,
          faceHeight,
          wallFaceColor,
          OUTLINE_COLOR,
          2.4
        );

        // 하단 걸레받이 몰딩
        this._fillStrokeRect(
          ctx,
          wall.x,
          floorTopY - 9,
          wall.width,
          9,
          '#181f32',
          OUTLINE_COLOR,
          1.8
        );

        // 복도 북쪽 벽에는 소형 비상 유도등 장식 추가
        if (!isRoomWall && wall.width >= 90) {
          const lampX = wall.x + wall.width * 0.5;
          const lampY = faceTopY + 15;
          this._fillStrokeRoundRect(
            ctx,
            lampX - 11,
            lampY - 4,
            22,
            8,
            3,
            '#334155',
            OUTLINE_COLOR,
            1.6
          );
          ctx.fillStyle = '#fde68a';
          ctx.fillRect(lampX - 7, lampY - 1.5, 14, 3);
        }

        // 벽 상단 단면 캡
        this._fillStrokeRect(
          ctx,
          wall.x,
          capTopY,
          wall.width,
          capHeight,
          '#141929',
          OUTLINE_COLOR,
          2.4
        );
      }

      // 2. 각 방 북쪽 벽 장식(밤하늘 창문, 벽시계, 화이트보드, 보급실 표지판 등) 렌더링
      for (let i = 0; i < rooms.length; i++) {
        const room = rooms[i];
        if (!Array.isArray(room.wallDecor)) continue;

        const faceTopY = room.y - 68;
        for (let d = 0; d < room.wallDecor.length; d++) {
          const decor = room.wallDecor[d];
          const dx = room.x + (decor.offsetX || 0);
          switch (decor.kind) {
            case 'window':
              this._drawNightWindow(ctx, dx, faceTopY + 7, decor.width || 180, 48, Boolean(decor.showMoon));
              break;
            case 'clock':
              this._drawWallClock(ctx, dx, faceTopY + 26, 15);
              break;
            case 'whiteboard':
              this._drawWhiteboard(ctx, dx, faceTopY + 9, decor.width || 96, 44);
              break;
            case 'locked_door':
              this._drawLockedOfficeDoor(ctx, dx, faceTopY + 12, decor.width || 92, 56);
              break;
            case 'supply_sign':
              this._drawSupplyWallSign(ctx, dx, faceTopY + 12, decor.width || 88, 38);
              break;
            default:
              break;
          }
        }
      }
    }

    /**
     * 보급 방 북쪽 벽면 의무·보급 구역 표지판 도형 렌더링
     */
    _drawSupplyWallSign(ctx, x, y, w, h) {
      this._fillStrokeRoundRect(ctx, x, y, w, h, 4, '#13262f', OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, x + 4, y + 4, w - 8, h - 8, 3, '#1b3844', '#2dd4bf', 1.5);

      // 십자 마크 + 보급 모듈 바 아이콘
      const cx = x + 22;
      const cy = y + h * 0.5;
      ctx.fillStyle = '#4ade80';
      ctx.fillRect(cx - 3, cy - 8, 6, 16);
      ctx.fillRect(cx - 8, cy - 3, 16, 6);

      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 40, cy - 6, w - 52, 4);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + 40, cy + 2, w - 58, 3);
    }

    /**
     * 측면·남쪽·모서리 컷어웨이 구조 벽(Wall) 쿼터뷰 입체 렌더링
     */
    _drawStructuralWall(ctx, wall) {
      const z = wall.zHeight ?? 22;
      const topY = wall.y - z;
      const frontY = wall.y + wall.height - z;

      // 벽 전면(높이 두께 면)
      this._fillStrokeRect(
        ctx,
        wall.x,
        frontY,
        wall.width,
        z,
        '#222c45',
        OUTLINE_COLOR,
        2.2
      );

      // 벽 상단 단면 캡
      this._fillStrokeRect(
        ctx,
        wall.x,
        topY,
        wall.width,
        wall.height,
        '#141929',
        OUTLINE_COLOR,
        2.2
      );

      // 상단 단면 안쪽 하이라이트 림
      if (wall.width > 8 && wall.height > 8) {
        ctx.strokeStyle = 'rgba(71, 91, 135, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(wall.x + 2, topY + 2, wall.width - 4, wall.height - 4);
      }
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
      ctx.fillRect(x + 12, y + 18, 30, h - 20);
      ctx.fillRect(x + 50, y + 12, 38, h - 14);
      ctx.fillRect(x + 120, y + 16, 34, h - 18);
      ctx.fillRect(x + 162, y + 22, 28, h - 24);

      // 맞은편 빌딩 야근 불빛
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 58, y + 20, 6, 4);
      ctx.fillRect(x + 70, y + 29, 6, 4);
      ctx.fillRect(x + 128, y + 24, 6, 4);

      if (showMoon) {
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        ctx.arc(x + 104, y + 17, 6.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // 창문 세로 프레임 분할
      ctx.strokeStyle = '#1e273d';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x + w / 3, y);
      ctx.lineTo(x + w / 3, y + h);
      ctx.moveTo(x + (w * 2) / 3, y);
      ctx.lineTo(x + (w * 2) / 3, y + h);
      ctx.stroke();

      // 상단 블라인드
      this._fillStrokeRect(ctx, x + 2, y + 2, w - 4, 9, '#384666', OUTLINE_COLOR, 1.5);
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
      ctx.lineTo(cx - 3, cy - 6);
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx - 1.8, cy - 10);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawLockedOfficeDoor(ctx, x, y, w, h) {
      // 비상구 사인
      this._fillStrokeRoundRect(ctx, x + w * 0.5 - 20, y - 10, 40, 8, 2, '#10b981', OUTLINE_COLOR, 1.6);

      // 양개형 출입문 (벽면 배경 장식)
      this._fillStrokeRect(ctx, x, y, w, h, '#303b57', OUTLINE_COLOR, 2.4);
      ctx.beginPath();
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w / 2, y + h);
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 문 유리창
      this._fillStrokeRect(ctx, x + 10, y + 8, 22, 22, '#131d33', OUTLINE_COLOR, 1.8);
      this._fillStrokeRect(ctx, x + w - 32, y + 8, 22, 22, '#131d33', OUTLINE_COLOR, 1.8);

      // 손잡이
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(x + w / 2 - 7, y + 34, 4, 9);
      ctx.fillRect(x + w / 2 + 3, y + 34, 4, 9);
    }

    _drawWhiteboard(ctx, x, y, w, h) {
      this._fillStrokeRoundRect(ctx, x, y, w, h, 3, '#dce4f2', OUTLINE_COLOR, 2.2);

      // 간단한 그래프 선과 포스트잇 도형
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 12, y + h - 12);
      ctx.lineTo(x + 28, y + h - 22);
      ctx.lineTo(x + 44, y + h - 17);
      ctx.lineTo(x + 60, y + 12);
      ctx.stroke();

      ctx.fillStyle = '#facc15';
      ctx.fillRect(x + w - 24, y + 9, 13, 12);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(x + w - 24, y + 24, 13, 11);
    }

    _drawNightAtmosphere(ctx) {
      const width = this.viewWidth;
      const height = this.viewHeight;
      const vignette = ctx.createRadialGradient(
        width * 0.5,
        height * 0.5,
        height * 0.34,
        width * 0.5,
        height * 0.5,
        width * 0.68
      );
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(5, 7, 14, 0.42)');
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

        // 적 공격 준비(Windup) 중 바닥 공격 예고 텔레그래프 표시
        if (enemy.state === 'Attack' && enemy.attack && enemy.attack.phase === 'windup') {
          const windupTotal = Math.max(0.01, enemy.attack.windupDuration);
          const progress = Math.max(0, Math.min(1, 1 - enemy.attack.timer / windupTotal));

          if (enemy.attackType === 'ranged') {
            // 원거리 적(서류 투척자) 투척 조준 궤적 레이저 라인 텔레그래프
            const range = enemy.attackRange;
            const aimAng = enemy.attack.aimAngle;
            const targetX = enemy.position.x + Math.cos(aimAng) * range;
            const targetY = enemy.position.y + Math.sin(aimAng) * range;

            ctx.save();
            ctx.strokeStyle = `rgba(251, 146, 60, ${(0.45 + progress * 0.45).toFixed(2)})`;
            ctx.lineWidth = 2.4;
            ctx.setLineDash([8, 5]);
            ctx.beginPath();
            ctx.moveTo(enemy.position.x, enemy.position.y);
            ctx.lineTo(targetX, targetY);
            ctx.stroke();
            ctx.setLineDash([]);

            // 충전 진행 조준 링
            ctx.fillStyle = `rgba(239, 68, 68, ${(0.35 + progress * 0.5).toFixed(2)})`;
            ctx.beginPath();
            ctx.arc(
              enemy.position.x + Math.cos(aimAng) * range * progress,
              enemy.position.y + Math.sin(aimAng) * range * progress,
              4 + progress * 3,
              0,
              Math.PI * 2
            );
            ctx.fill();
            ctx.restore();
          } else {
            // 근접 적 부채꼴 방향·사거리 예고 표시
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

    _drawItemFloorIndicators(ctx, itemSystem) {
      const activeItems = itemSystem.getActiveItems();
      for (let i = 0; i < activeItems.length; i++) {
        const item = activeItems[i];
        const isFocused = itemSystem.focusedItem === item;
        const isHeal = item.category === 'heal';
        const pulse = 0.5 + 0.5 * Math.sin(item.bobPhase);

        ctx.save();
        ctx.translate(item.position.x, item.position.y);

        // 아이템 발밑 은은한 발광 패드
        ctx.fillStyle = isHeal
          ? `rgba(74, 222, 128, ${(0.12 + pulse * 0.08).toFixed(3)})`
          : `rgba(251, 191, 36, ${(0.12 + pulse * 0.08).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 13, 0, 0, Math.PI * 2);
        ctx.fill();

        // 근접 상호작용 가능 범위 안에 들어왔을 때 점선 강조 링 표시
        if (isFocused) {
          ctx.strokeStyle = isHeal ? 'rgba(74, 222, 128, 0.72)' : 'rgba(251, 191, 36, 0.78)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.ellipse(0, 0, 27, 18, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        ctx.restore();
      }
    }

    _drawShadows(ctx, officeMap, player, combat, enemySystem = null, itemSystem = null, boss = null) {
      ctx.fillStyle = 'rgba(7, 9, 16, 0.45)';

      // 장애물 바닥 그림자 (쿼터뷰 입체감을 위해 우하단 오프셋)
      for (let i = 0; i < officeMap.obstacles.length; i++) {
        const obs = officeMap.obstacles[i];
        this._fillRoundRectOnly(ctx, obs.x + 5, obs.y + 5, obs.width, obs.height, 6);
      }

      if (itemSystem) {
        const activeItems = itemSystem.getActiveItems();
        for (let i = 0; i < activeItems.length; i++) {
          const item = activeItems[i];
          ctx.beginPath();
          ctx.ellipse(item.position.x, item.position.y + 3, 14, 7.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
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
          const shadowR = enemy.enemyType === 'cabinet' ? 24 : enemy.enemyType === 'stalker' ? 15 : enemy.colliderRadius || 17;
          ctx.save();
          ctx.fillStyle = 'rgba(24, 12, 42, 0.58)';
          ctx.beginPath();
          ctx.ellipse(enemy.position.x, enemy.position.y + 3, shadowR * 1.1, shadowR * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        // Phase 14: 서류 투사체 바닥 그림자
        if (Array.isArray(enemySystem.enemyProjectiles)) {
          for (let i = 0; i < enemySystem.enemyProjectiles.length; i++) {
            const proj = enemySystem.enemyProjectiles[i];
            if (!proj.alive) continue;
            ctx.beginPath();
            ctx.ellipse(proj.x, proj.y + 3, 6, 3.5, 0, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 보스 발 그림자
      if (boss && (boss.alive || boss.deathTimer > 0)) {
        ctx.save();
        ctx.fillStyle = 'rgba(20, 8, 30, 0.65)';
        ctx.beginPath();
        ctx.ellipse(boss.position.x, boss.position.y + 4, 30, 15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
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
     * 현재 장착 무기(사무용 커터, 대형 망치, 전기 충격봉, 권총, 산탄총, 서류 발사기) 도형 렌더링
     */
    _drawEquippedWeapon(ctx, player, weaponId, bounce, activeMeleeEffect = null) {
      const aimAngle = player.direction.angle;
      const isMelee =
        weaponId === 'melee' ||
        weaponId === 'cutter' ||
        weaponId === 'hammer' ||
        weaponId === 'stun_baton';
      const meleePose =
        isMelee && activeMeleeEffect
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

      if (weaponId === 'hammer') {
        // 대형 망치 (묵직한 오함마)
        this._fillStrokeRoundRect(ctx, 6, -2.5, 16, 5, 1.5, '#92400e', OUTLINE_COLOR, 1.8);
        this._fillStrokeRoundRect(ctx, 20, -8, 10, 16, 2.5, '#475569', OUTLINE_COLOR, 2.2);
      } else if (weaponId === 'stun_baton') {
        // 전기 충격봉
        this._fillStrokeRoundRect(ctx, 7, -2.5, 7, 5, 1.5, '#0f172a', OUTLINE_COLOR, 1.6);
        this._fillStrokeRoundRect(ctx, 14, -3, 15, 6, 2, '#0284c7', OUTLINE_COLOR, 2);
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(17, -1.5, 9, 3);
      } else if (weaponId === 'shotgun') {
        // 산탄총
        this._fillStrokeRoundRect(ctx, 5, -1, 9, 6, 1.5, '#78350f', OUTLINE_COLOR, 1.6);
        this._fillStrokeRoundRect(ctx, 13, -4.5, 18, 5.5, 1.8, '#475569', OUTLINE_COLOR, 2);
      } else if (weaponId === 'doc_launcher') {
        // 서류 발사기
        this._fillStrokeRoundRect(ctx, 8, -6, 17, 12, 2.5, '#1e293b', OUTLINE_COLOR, 2);
        this._fillStrokeRoundRect(ctx, 12, -4.5, 9, 9, 1.5, '#f8fafc', OUTLINE_COLOR, 1.2);
      } else if (weaponId === 'pistol' || weaponId === 'ranged') {
        // 사무용 권총
        this._fillStrokeRoundRect(ctx, 10, 0, 5.5, 7.5, 1.5, '#334155', OUTLINE_COLOR, 1.8);
        this._fillStrokeRoundRect(ctx, 9, -5, 17, 6, 1.8, '#94a3b8', OUTLINE_COLOR, 2);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(12, -3.2, 6, 2);
      } else {
        // 사무용 커터 (기본 근접 무기)
        this._fillStrokeRoundRect(ctx, 9, -4.5, 14, 7, 2, '#eab308', OUTLINE_COLOR, 1.8);
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(19, -3.5, 6, 4);
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
     * Phase 14: 카툰풍 괴이 적 렌더링 (5종 적별 외형·실루엣·장식·체력바 차별화)
     * - ghost (사무실 망령): 보랏빛 반투명 직장인 망령
     * - stalker (야근 추적자): 날렵한 적색 실루엣과 날카로운 손톱
     * - thrower (서류 투척자): 청록 셔츠와 결재 서류 뭉치 무장
     * - cabinet (철제 캐비닛): 육중한 2.5D 메탈 캐비닛 괴이
     * - manager (야근 팀장): 짙은 네이비 정장, 골드 넥타이, 엘리트 오라
     */
    _drawEnemy(ctx, enemy) {
      const ex = enemy.position.x;
      const ey = enemy.position.y;
      const type = enemy.enemyType || 'ghost';

      // 사망(Dead) 상태: 소멸 애니메이션 렌더링 (체력 바 미표시)
      if (enemy.state === 'Dead' || !enemy.alive) {
        const p = Math.max(0, Math.min(1, enemy.deathTimer / Math.max(0.01, enemy.deathDuration)));
        const fade = 1 - p;

        ctx.save();
        ctx.translate(ex, ey);
        ctx.globalAlpha = fade;

        // 바닥으로 꺼지는 어두운 영체 소용돌이 원
        ctx.strokeStyle = type === 'cabinet' ? '#94a3b8' : type === 'stalker' ? '#f43f5e' : '#c084fc';
        ctx.fillStyle = type === 'stalker' ? 'rgba(159, 18, 57, 0.45)' : 'rgba(88, 28, 135, 0.45)';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.ellipse(0, -4, 18 + p * 18, 9 + p * 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 사방으로 흩어지는 괴이 입자 도형
        ctx.fillStyle = type === 'manager' ? '#facc15' : type === 'stalker' ? '#fb7185' : '#e879f9';
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
        ? Math.abs(Math.sin(enemy.walkPhase)) * (type === 'stalker' ? 4.2 : type === 'cabinet' ? 1.5 : 3.2)
        : Math.sin(performance.now() * 0.004) * 1.6;
      const wobbleX =
        enemy.shakeTimer > 0
          ? Math.sin(enemy.shakeTimer * 58) * 4 * (enemy.lastHitDirX || 1)
          : isWindup
            ? Math.sin(windupProgress * 28) * 1.8
            : 0;

      // 공격 타격 직후 짧은 전진 반동 오프셋
      const lungeOffset =
        isAttacking && enemy.attack && enemy.attack.phase === 'recovery'
          ? (type === 'cabinet' ? 8 : 5)
          : 0;

      ctx.save();
      ctx.translate(
        ex + wobbleX + dirX * lungeOffset,
        ey + dirY * lungeOffset * 0.65
      );

      // 공격 준비(Windup) 중 몸체 부풀림 / 팽창 효과
      if (isWindup) {
        ctx.scale(1 + windupProgress * 0.14, 1 - windupProgress * 0.08);
      }

      // =======================================================================
      // 적 종류별 고유 그래픽 렌더링 분기
      // =======================================================================
      if (type === 'cabinet') {
        this._drawCabinetEnemyBody(ctx, enemy, {
          bob,
          isFlashing,
          isWindup,
          windupProgress,
          isChasing,
          dirX,
          dirY
        });
      } else if (type === 'stalker') {
        this._drawStalkerEnemyBody(ctx, enemy, {
          bob,
          isFlashing,
          isWindup,
          windupProgress,
          isChasing,
          dirX,
          dirY,
          facingBack
        });
      } else if (type === 'thrower') {
        this._drawThrowerEnemyBody(ctx, enemy, {
          bob,
          isFlashing,
          isWindup,
          windupProgress,
          isChasing,
          dirX,
          dirY,
          facingBack
        });
      } else if (type === 'manager') {
        this._drawManagerEnemyBody(ctx, enemy, {
          bob,
          isFlashing,
          isWindup,
          windupProgress,
          isChasing,
          dirX,
          dirY,
          facingBack
        });
      } else {
        this._drawGhostEnemyBody(ctx, enemy, {
          bob,
          isFlashing,
          isWindup,
          windupProgress,
          isChasing,
          dirX,
          dirY,
          facingBack
        });
      }

      // =======================================================================
      // 머리 위 체력 바 및 상태 라벨 표시 (모든 적 공통 + 엘리트/탱커 차별화)
      // =======================================================================
      const barW = type === 'cabinet' ? 56 : type === 'manager' ? 52 : type === 'stalker' ? 40 : 44;
      const barH = 6.5;
      const barX = -barW * 0.5;
      const barY = (type === 'cabinet' ? -68 : type === 'manager' ? -80 : -75) - bob * 0.35;
      const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));

      // 체력 바 배경 (엘리트는 금색 테두리)
      const barBorder = type === 'manager' ? '#facc15' : OUTLINE_COLOR;
      this._fillStrokeRoundRect(ctx, barX, barY, barW, barH, 3, '#0f172a', barBorder, type === 'manager' ? 2.2 : 1.8);
      if (hpRatio > 0) {
        ctx.fillStyle =
          type === 'manager'
            ? '#eab308'
            : isChasing
              ? '#e11d48'
              : type === 'cabinet'
                ? '#38bdf8'
                : '#a855f7';
        ctx.fillRect(barX + 1.5, barY + 1.5, (barW - 3) * hpRatio, barH - 3);
      }

      // 상태 및 이름 뱃지
      const stateBadge = enemy.stunTimer > 0
        ? '⚡ 경직!'
        : isAttacking
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

      const enemyName = enemy.name || '적';
      const elitePrefix = enemy.isElite ? '★ ' : '';
      const eliteSuffix = enemy.isElite ? ' ★' : '';
      const topLabel = `${elitePrefix}${enemyName} [${stateBadge}] · ${enemy.hp}${eliteSuffix}`;

      ctx.font = 'bold 9.5px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.8;
      ctx.strokeText(topLabel, 0, barY - 3.5);
      ctx.fillStyle =
        enemy.stunTimer > 0
          ? '#38bdf8'
          : type === 'manager'
            ? '#fef08a'
            : isWindup
              ? '#fde047'
              : isChasing
                ? '#fda4af'
                : '#e9d5ff';
      ctx.fillText(topLabel, 0, barY - 3.5);

      // Phase 16: 전기 충격봉 피격 시 머리 위 번개 및 감전 방전 스파크 연출
      if (enemy.stunTimer > 0) {
        ctx.save();
        ctx.font = '900 15px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3.2;
        ctx.strokeText('⚡', 0, barY - 14);
        ctx.fillStyle = '#38bdf8';
        ctx.fillText('⚡', 0, barY - 14);

        // 방전 스파크 라인 4가닥
        ctx.strokeStyle = '#7dd3fc';
        ctx.lineWidth = 1.8;
        const sparkTime = performance.now() * 0.02;
        for (let s = 0; s < 4; s++) {
          const sa = (s / 4) * Math.PI * 2 + sparkTime;
          const sx = Math.cos(sa) * 16;
          const sy = -28 + Math.sin(sa) * 14;
          ctx.beginPath();
          ctx.moveTo(sx * 0.3, sy);
          ctx.lineTo(sx * 0.7, sy + 3);
          ctx.lineTo(sx, sy);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 플레이어 감지 직후 느낌표(!) 팝업
      if (enemy.alertTimer > 0) {
        ctx.font = '900 15px "Malgun Gothic", sans-serif';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3.5;
        ctx.strokeText('!', 0, barY - 16);
        ctx.fillStyle = type === 'stalker' ? '#ef4444' : '#fde047';
        ctx.fillText('!', 0, barY - 16);
      }

      ctx.restore();
    }

    /**
     * 1. 사무실 망령 (ghost) 본체 그래픽
     */
    _drawGhostEnemyBody(ctx, enemy, { bob, isFlashing, isWindup, windupProgress, isChasing, dirX, dirY, facingBack }) {
      // 괴이 오라
      ctx.fillStyle = isWindup
        ? `rgba(249, 115, 22, ${(0.22 + windupProgress * 0.25).toFixed(3)})`
        : isChasing
          ? 'rgba(225, 29, 72, 0.16)'
          : 'rgba(139, 92, 246, 0.14)';
      ctx.beginPath();
      ctx.ellipse(0, -25 - bob, 21 + windupProgress * 4, 27 + windupProgress * 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 해진 정장 하단 자락
      const coatFill = isFlashing ? '#ffffff' : isWindup ? '#991b1b' : isChasing ? '#3b0764' : '#2e1065';
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

      // 구부정한 상체 코트
      const bodyTop = -34 - bob;
      this._fillStrokeRoundRect(ctx, -14, bodyTop, 28, 25, 7, coatFill, OUTLINE_COLOR, 2.5);

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

      // 양팔
      const armReachY = isWindup ? -6 - windupProgress * 4 : isChasing ? -2.5 : 0;
      this._fillStrokeRoundRect(ctx, -18 + dirX * 2, bodyTop + 3 + armReachY - sway * 0.4, 6.5, 14, 3, sleeveFill, OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, 11.5 + dirX * 2, bodyTop + 3 + armReachY + sway * 0.4, 6.5, 14, 3, sleeveFill, OUTLINE_COLOR, 2.2);

      // 헤드 & 뿔
      const headY = -46 - bob;
      const headR = 13.5;
      ctx.fillStyle = isFlashing ? '#ffffff' : '#ddd6fe';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

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
    }

    /**
     * 2. 야근 추적자 (stalker) 본체 그래픽 - 날렵하고 날카로운 핏빛 암살자 실루엣
     */
    _drawStalkerEnemyBody(ctx, enemy, { bob, isFlashing, isWindup, windupProgress, isChasing, dirX, dirY, facingBack }) {
      // 붉은 스피드 오라
      ctx.fillStyle = isWindup
        ? `rgba(239, 68, 68, ${(0.3 + windupProgress * 0.35).toFixed(3)})`
        : 'rgba(225, 29, 72, 0.22)';
      ctx.beginPath();
      ctx.ellipse(0, -22 - bob, 16 + windupProgress * 3, 24 + windupProgress * 2, 0, 0, Math.PI * 2);
      ctx.fill();

      const coatFill = isFlashing ? '#ffffff' : isWindup ? '#b91c1c' : '#7f1d1d';
      const armFill = isFlashing ? '#fecdd3' : '#991b1b';
      const sway = enemy.isMoving ? Math.sin(enemy.walkPhase * 1.3) * 4 : 0;

      // 하단 빠른 발걸음 실루엣
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.moveTo(-9, -10 - bob);
      ctx.lineTo(-12 + sway, 0);
      ctx.lineTo(0, -5);
      ctx.lineTo(12 - sway, 0);
      ctx.lineTo(9, -10 - bob);
      ctx.closePath();
      ctx.fill();

      // 날렵하고 좁은 상체 코트
      const bodyTop = -32 - bob;
      this._fillStrokeRoundRect(ctx, -10, bodyTop, 20, 24, 5, coatFill, OUTLINE_COLOR, 2.2);

      // 날카로운 긴 손톱/칼날 팔 (공격 시 전방으로 뻗침)
      const reach = isWindup ? -8 - windupProgress * 6 : isChasing ? 4 : 0;
      this._fillStrokeRoundRect(ctx, -15 + dirX * reach, bodyTop + 4, 5, 15, 2, armFill, OUTLINE_COLOR, 2);
      this._fillStrokeRoundRect(ctx, 10 + dirX * reach, bodyTop + 4, 5, 15, 2, armFill, OUTLINE_COLOR, 2);

      // 칼날 손가락 포인트
      ctx.fillStyle = '#fca5a5';
      ctx.fillRect(-16 + dirX * reach, bodyTop + 16, 3, 5);
      ctx.fillRect(13 + dirX * reach, bodyTop + 16, 3, 5);

      // 뾰족한 헤드 실루엣
      const headY = -43 - bob;
      ctx.fillStyle = isFlashing ? '#ffffff' : '#fecdd3';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, headY, 10, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 뒤로 뻗은 뾰족한 헤어/가시
      ctx.fillStyle = '#450a0a';
      ctx.beginPath();
      ctx.moveTo(-8, headY - 3);
      ctx.lineTo(-14, headY - 14);
      ctx.lineTo(0, headY - 10);
      ctx.lineTo(14, headY - 14);
      ctx.lineTo(8, headY - 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 날카로운 황색/주홍빛 맹수 안광
      if (!facingBack) {
        const eyeY = headY + dirY * 1.5;
        const eyeShiftX = dirX * 3.5;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(-3.5 + eyeShiftX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.arc(3.5 + eyeShiftX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /**
     * 3. 서류 투척자 (thrower) 본체 그래픽 - 청록색 셔츠 + 결재 서류 뭉치 투척 모션
     */
    _drawThrowerEnemyBody(ctx, enemy, { bob, isFlashing, isWindup, windupProgress, isChasing, dirX, dirY, facingBack }) {
      // 투척자 은은한 오렌지/시안 오라
      ctx.fillStyle = isWindup
        ? `rgba(249, 115, 22, ${(0.25 + windupProgress * 0.3).toFixed(3)})`
        : 'rgba(20, 184, 166, 0.16)';
      ctx.beginPath();
      ctx.ellipse(0, -24 - bob, 20 + windupProgress * 3, 26 + windupProgress * 2, 0, 0, Math.PI * 2);
      ctx.fill();

      const shirtFill = isFlashing ? '#ffffff' : isWindup ? '#c2410c' : '#0f766e';
      const bodyTop = -33 - bob;

      // 하단 바지
      this._fillStrokeRoundRect(ctx, -10, -12 - bob, 20, 14, 4, '#1e293b', OUTLINE_COLOR, 2);

      // 청록색 셔츠 상체
      this._fillStrokeRoundRect(ctx, -13, bodyTop, 26, 24, 6, shirtFill, OUTLINE_COLOR, 2.3);

      // 노란 사원증 목걸이
      if (!facingBack) {
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-4, bodyTop + 1);
        ctx.lineTo(0, bodyTop + 11);
        ctx.lineTo(4, bodyTop + 1);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-3, bodyTop + 11, 6, 5);
      }

      // 왼손 & 오른손(결재 서류 뭉치 들고 있음)
      const armFill = isFlashing ? '#ccfbf1' : '#115e59';
      this._fillStrokeRoundRect(ctx, -17, bodyTop + 4, 5.5, 13, 2.5, armFill, OUTLINE_COLOR, 2);

      // 서류철 투척 모션 (Windup 중 뒤로 젖혔다가 앞으로 전진)
      const throwArmAngle = isWindup ? -0.8 + windupProgress * 1.6 : 0.2;
      ctx.save();
      ctx.translate(12, bodyTop + 6);
      ctx.rotate(throwArmAngle);
      this._fillStrokeRoundRect(ctx, -2, 0, 5.5, 12, 2.5, armFill, OUTLINE_COLOR, 2);

      // 한 손에 든 두꺼운 결재 서류 뭉치
      this._fillStrokeRoundRect(ctx, -4, 9, 13, 10, 2, '#ffffff', OUTLINE_COLOR, 1.8);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-1, 11, 7, 2);
      ctx.restore();

      // 창백한 헤드 및 지적인 뿔테 안경
      const headY = -45 - bob;
      ctx.fillStyle = isFlashing ? '#ffffff' : '#ccfbf1';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, headY, 12.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 단정한 흑발 헤어
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(0, headY - 2, 12.5, Math.PI * 0.9, Math.PI * 2.1);
      ctx.closePath();
      ctx.fill();

      if (!facingBack) {
        const eyeY = headY + 1.5 + dirY * 1.5;
        const eyeX = dirX * 3.5;

        // 사각 뿔테 안경
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.6;
        ctx.strokeRect(-6.5 + eyeX, eyeY - 2.5, 5, 5);
        ctx.strokeRect(1.5 + eyeX, eyeY - 2.5, 5, 5);
        ctx.beginPath();
        ctx.moveTo(-1.5 + eyeX, eyeY);
        ctx.lineTo(1.5 + eyeX, eyeY);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.fillRect(-4.5 + eyeX, eyeY - 1, 2, 2);
        ctx.fillRect(3.5 + eyeX, eyeY - 1, 2, 2);
      }
    }

    /**
     * 4. 철제 캐비닛 (cabinet) 본체 그래픽 - 육중한 2.5D 메탈 캐비닛 괴이
     */
    _drawCabinetEnemyBody(ctx, enemy, { bob, isFlashing, isWindup, windupProgress, isChasing, dirX }) {
      // 쿵쾅거리는 묵직한 지진파 바닥 오라
      ctx.fillStyle = isWindup
        ? `rgba(244, 63, 94, ${(0.28 + windupProgress * 0.35).toFixed(3)})`
        : 'rgba(71, 85, 105, 0.25)';
      ctx.beginPath();
      ctx.ellipse(0, -18 - bob * 0.5, 26 + windupProgress * 5, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      // 준비(Windup) 시 캐비닛이 뒤로 살짝 젖혀지며 서랍이 벌어짐
      if (isWindup) {
        ctx.rotate(dirX * -0.15 * windupProgress);
      }

      const bodyFill = isFlashing ? '#ffffff' : '#475569';
      const sideFill = isFlashing ? '#e2e8f0' : '#334155';
      const w = 34;
      const h = 46;
      const topY = -h - bob * 0.5;

      // 2.5D 메탈 캐비닛 박스 몸통
      this._fillStrokeRoundRect(ctx, -w * 0.5, topY, w, h, 4, bodyFill, OUTLINE_COLOR, 2.5);

      // 3단 서랍 칸막이 선
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w * 0.5 + 3, topY + h * 0.34);
      ctx.lineTo(w * 0.5 - 3, topY + h * 0.34);
      ctx.moveTo(-w * 0.5 + 3, topY + h * 0.67);
      ctx.lineTo(w * 0.5 - 3, topY + h * 0.67);
      ctx.stroke();

      // 서랍 메탈 손잡이
      ctx.fillStyle = '#cbd5e1';
      for (let r = 0; r < 3; r++) {
        const hy = topY + r * (h * 0.33) + 5;
        this._fillStrokeRect(ctx, -7, hy, 14, 3.5, '#cbd5e1', OUTLINE_COLOR, 1.2);
      }

      // 서랍 틈새에서 번뜩이는 붉은/보랏빛 괴이 안광 눈 슬릿
      const eyeDrawerY = topY + h * 0.34 + (isWindup ? 4 : 0);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-9 + dirX * 3, eyeDrawerY - 2, 6, 3);
      ctx.fillRect(3 + dirX * 3, eyeDrawerY - 2, 6, 3);

      // 윗단 서랍 라벨 명찰
      this._fillStrokeRect(ctx, 4, topY + 4, 9, 6, '#fef08a', OUTLINE_COLOR, 1);
    }

    /**
     * 5. 야근 팀장 (manager) 본체 그래픽 - 엘리트 전용 네이비 정장, 골드 넥타이 및 엘리트 뱃지
     */
    _drawManagerEnemyBody(ctx, enemy, { bob, isFlashing, isWindup, windupProgress, isChasing, dirX, dirY, facingBack }) {
      // 찬란한 엘리트 골드/퍼플 오라
      const auraPulse = Math.sin(performance.now() * 0.006) * 0.08;
      ctx.fillStyle = isWindup
        ? `rgba(234, 179, 8, ${(0.32 + windupProgress * 0.35).toFixed(3)})`
        : `rgba(234, 179, 8, ${(0.18 + auraPulse).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, -28 - bob, 26 + windupProgress * 4, 32 + windupProgress * 3, 0, 0, Math.PI * 2);
      ctx.fill();

      // 위엄 있는 넓은 네이비 더블버튼 정장 코트
      const suitFill = isFlashing ? '#ffffff' : isWindup ? '#7c2d12' : '#172554';
      const lapelFill = isFlashing ? '#fed7aa' : '#1e3a8a';
      const bodyTop = -38 - bob;

      // 하단 슬랙스 바지
      this._fillStrokeRoundRect(ctx, -14, -14 - bob, 28, 16, 4, '#0f172a', OUTLINE_COLOR, 2.2);

      // 넓은 더블 브레스티드 정장 몸통
      this._fillStrokeRoundRect(ctx, -17, bodyTop, 34, 28, 7, suitFill, OUTLINE_COLOR, 2.6);

      // 황금색 럭셔리 넥타이 & 셔츠 라펠
      if (!facingBack) {
        const tieX = dirX * 4;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(tieX - 6, bodyTop + 2);
        ctx.lineTo(tieX + 6, bodyTop + 2);
        ctx.lineTo(tieX, bodyTop + 14);
        ctx.closePath();
        ctx.fill();

        // 번뜩이는 골드 넥타이
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#a16207';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(tieX - 2.5, bodyTop + 5);
        ctx.lineTo(tieX + 2.5, bodyTop + 5);
        ctx.lineTo(tieX + 3.5, bodyTop + 18);
        ctx.lineTo(tieX, bodyTop + 23);
        ctx.lineTo(tieX - 3.5, bodyTop + 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 황금 사원증 & 행커치프
        ctx.fillStyle = '#fde047';
        ctx.fillRect(tieX - 13, bodyTop + 7, 5, 4);
      }

      // 묵직한 양팔 & 골드 손목시계
      const armFill = isFlashing ? '#fed7aa' : lapelFill;
      this._fillStrokeRoundRect(ctx, -21 + dirX * 2, bodyTop + 4, 7, 16, 3, armFill, OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, 14 + dirX * 2, bodyTop + 4, 7, 16, 3, armFill, OUTLINE_COLOR, 2.2);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(14 + dirX * 2, bodyTop + 16, 7, 2.5);

      // 위압감 있는 팀장 헤드
      const headY = -51 - bob;
      ctx.fillStyle = isFlashing ? '#ffffff' : '#fef08a';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, headY, 14.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 올백 포마드 헤어
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(0, headY - 3, 14.5, Math.PI * 1.0, Math.PI * 2.0);
      ctx.closePath();
      ctx.fill();

      // 날카로운 금색 안광
      if (!facingBack) {
        const eyeY = headY + 1.5 + dirY * 2.0;
        const eyeX = dirX * 4.5;
        ctx.fillStyle = '#eab308';
        ctx.beginPath();
        ctx.arc(-4.5 + eyeX, eyeY, 2.4, 0, Math.PI * 2);
        ctx.arc(4.5 + eyeX, eyeY, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // 머리 위 둥둥 뜨는 골드 엘리트 별 뱃지
      const starY = headY - 22;
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2;
      ctx.font = '900 13px "Malgun Gothic", sans-serif';
      ctx.strokeText('★', 0, starY);
      ctx.fillText('★', 0, starY);
    }

    /**
     * Phase 14: 원거리 적(서류 투척자) 서류 투사체 렌더링
     */
    _drawEnemyProjectile(ctx, proj) {
      if (!proj.alive) return;
      const visualY = proj.y - 18;
      const prevVisualY = proj.prevY - 18;

      ctx.save();

      // 1. 날아가는 궤적 잔상
      ctx.strokeStyle = 'rgba(251, 146, 60, 0.45)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(proj.prevX, prevVisualY);
      ctx.lineTo(proj.x, visualY);
      ctx.stroke();

      // 뒤따라 흩날리는 낱장 서류 2장
      const trail1X = proj.x - proj.dirX * 14 - proj.dirY * 5;
      const trail1Y = visualY - proj.dirY * 14 + proj.dirX * 5;
      this._fillStrokeRoundRect(ctx, trail1X - 4, trail1Y - 3, 8, 6, 1, '#f1f5f9', OUTLINE_COLOR, 1.2);

      // 2. 주 결재 서류 뭉치 본체 (회전하며 비행)
      ctx.translate(proj.x, visualY);
      ctx.rotate(proj.angle + proj.spinPhase * 0.4);

      // 결재 서류철 폴더
      this._fillStrokeRoundRect(ctx, -8, -6, 16, 12, 2, '#ffffff', OUTLINE_COLOR, 2);

      // 서류철 상단 붉은 '반려' 도장 마크
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(-4, -4, 8, 3);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-5, 0, 10, 1.8);
      ctx.fillRect(-5, 3, 7, 1.8);

      ctx.restore();
    }

    /**
     * 원거리 무기 투사체 렌더링 (상체 높이로 비행)
     * Phase 16: 권총(단일 탄환), 산탄총(오렌지 확산 펠릿), 서류 발사기(날아가는 A4 서류)
     */
    _drawProjectile(ctx, proj) {
      const visualY = proj.y - 18;
      const prevVisualY = proj.prevY - 18;
      const wId = proj.weaponId || 'pistol';

      ctx.save();

      if (wId === 'shotgun') {
        // 산탄총 펠릿: 불꽃 오렌지 궤적 및 둥근 산탄 펠릿
        ctx.strokeStyle = 'rgba(249, 115, 22, 0.65)';
        ctx.lineWidth = 3.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(proj.prevX - Math.cos(proj.angle) * 7, prevVisualY - Math.sin(proj.angle) * 7);
        ctx.lineTo(proj.x, visualY);
        ctx.stroke();

        ctx.translate(proj.x, visualY);
        ctx.rotate(proj.angle);
        ctx.fillStyle = '#fb923c';
        ctx.strokeStyle = '#c2410c';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 펠릿 중심 백열 하이라이트
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(-1, -1, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (wId === 'doc_launcher') {
        // 서류 발사기: 날아가는 결재 서류(A4 문서)
        ctx.strokeStyle = 'rgba(241, 245, 249, 0.55)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(proj.prevX - Math.cos(proj.angle) * 6, prevVisualY - Math.sin(proj.angle) * 6);
        ctx.lineTo(proj.x, visualY);
        ctx.stroke();

        ctx.translate(proj.x, visualY);
        ctx.rotate(proj.angle);

        // 흰색 A4 서류 직사각형
        this._fillStrokeRoundRect(ctx, -7, -4.5, 14, 9, 1.5, '#ffffff', OUTLINE_COLOR, 1.6);

        // 서류 내 결재 줄무늬
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-4, -1.8);
        ctx.lineTo(4, -1.8);
        ctx.moveTo(-4, 0.2);
        ctx.lineTo(3, 0.2);
        ctx.moveTo(-4, 2.2);
        ctx.lineTo(1, 2.2);
        ctx.stroke();

        // 우측 상단 결재 도장 인감(붉은 점)
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(2, -3.5, 2.5, 2.5);
      } else {
        // 기본 사무용 권총 탄환
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
      }

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
     * 근접 무기 단일 부채꼴 휘두르기 시각 효과
     * Phase 16: 사무용 커터(예리한 은청색), 대형 망치(육중한 호박색 분쇄 충격파), 전기 충격봉(고압 방전 스파크)
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
        const wId = fx.weaponId || 'cutter';

        ctx.save();
        ctx.translate(fx.x, originY);

        this._traceTaperedFanPath(ctx, tailAngle, headAngle, sweepDir, outerRadius, wId === 'hammer' ? 0.22 : 0.16);
        const gradR = outerRadius * 0.72;
        const tailX = Math.cos(tailAngle) * gradR;
        const tailY = Math.sin(tailAngle) * gradR;
        const headX = Math.cos(headAngle) * gradR;
        const headY = Math.sin(headAngle) * gradR;

        const grad = ctx.createLinearGradient(tailX, tailY, headX, headY);

        if (wId === 'hammer') {
          // 대형 망치: 육중한 주황/호박색 파쇄 호
          grad.addColorStop(0, `rgba(180, 83, 9, ${(alpha * 0.20).toFixed(3)})`);
          grad.addColorStop(0.52, `rgba(245, 158, 11, ${(alpha * 0.78).toFixed(3)})`);
          grad.addColorStop(1, `rgba(254, 215, 170, ${(alpha * 0.98).toFixed(3)})`);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.strokeStyle = `rgba(180, 83, 9, ${(alpha * 0.75).toFixed(3)})`;
          ctx.lineWidth = 2.4;
          ctx.stroke();

          // 바깥쪽 파쇄 충격파 림
          const innerHeadR = outerRadius * 0.22;
          ctx.strokeStyle = `rgba(254, 243, 199, ${(alpha * 0.96).toFixed(3)})`;
          ctx.lineWidth = 4.0;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(1, outerRadius - 1.4), tailAngle, headAngle, anticlockwise);
          ctx.lineTo(Math.cos(headAngle) * innerHeadR, Math.sin(headAngle) * innerHeadR);
          ctx.stroke();
        } else if (wId === 'stun_baton') {
          // 전기 충격봉: 고압 방전 네온 블루/시안 스파크 호
          grad.addColorStop(0, `rgba(2, 132, 199, ${(alpha * 0.20).toFixed(3)})`);
          grad.addColorStop(0.52, `rgba(56, 189, 248, ${(alpha * 0.80).toFixed(3)})`);
          grad.addColorStop(1, `rgba(224, 242, 254, ${(alpha * 0.98).toFixed(3)})`);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.strokeStyle = `rgba(2, 132, 199, ${(alpha * 0.65).toFixed(3)})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // 바깥 원호 네온 라이트
          const innerHeadR = outerRadius * 0.16;
          ctx.strokeStyle = `rgba(240, 249, 255, ${(alpha * 0.98).toFixed(3)})`;
          ctx.lineWidth = 3.2;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(0, 0, Math.max(1, outerRadius - 1.4), tailAngle, headAngle, anticlockwise);
          ctx.lineTo(Math.cos(headAngle) * innerHeadR, Math.sin(headAngle) * innerHeadR);
          ctx.stroke();

          // 방전 지그재그 스파크 3개
          ctx.strokeStyle = `rgba(125, 211, 252, ${(alpha * 0.90).toFixed(3)})`;
          ctx.lineWidth = 1.8;
          for (let k = 1; k <= 3; k++) {
            const frac = k / 4;
            const spAngle = tailAngle + (headAngle - tailAngle) * frac;
            const sx1 = Math.cos(spAngle) * (outerRadius * 0.85);
            const sy1 = Math.sin(spAngle) * (outerRadius * 0.85);
            const sx2 = Math.cos(spAngle) * (outerRadius * 1.12);
            const sy2 = Math.sin(spAngle) * (outerRadius * 1.12);
            ctx.beginPath();
            ctx.moveTo(sx1, sy1);
            ctx.lineTo((sx1 + sx2) * 0.5 + (Math.random() - 0.5) * 5, (sy1 + sy2) * 0.5 + (Math.random() - 0.5) * 5);
            ctx.lineTo(sx2, sy2);
            ctx.stroke();
          }
        } else {
          // 사무용 커터: 날렵한 은청색/황금빛 베기 호
          grad.addColorStop(0, `rgba(245, 158, 11, ${(alpha * 0.14).toFixed(3)})`);
          grad.addColorStop(0.52, `rgba(251, 191, 36, ${(alpha * 0.68).toFixed(3)})`);
          grad.addColorStop(1, `rgba(253, 224, 71, ${(alpha * 0.94).toFixed(3)})`);
          ctx.fillStyle = grad;
          ctx.fill();

          ctx.strokeStyle = `rgba(217, 119, 6, ${(alpha * 0.52).toFixed(3)})`;
          ctx.lineWidth = 1.5;
          ctx.lineJoin = 'round';
          ctx.stroke();

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
        }

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
     * Phase 15: 바닥 드롭 아이템 카툰 렌더링 (구급 키트, 야근 수당 봉투, 잔업용 운동화, 방탄 서류철, 무기 모듈)
     */
    _drawWorldItem(ctx, item, isFocused = false) {
      const hoverY = Math.sin(item.bobPhase) * 2.4;

      ctx.save();
      ctx.translate(item.position.x, item.position.y + hoverY);

      if (item.typeId === 'emergency_kit' || item.typeId === 'medkit' || item.category === 'heal') {
        // 1. 응급 키트 / 구급상자: 상단 빨간 손잡이 + 흰색 케이스 + 초록/빨간 십자(+) 도형
        this._fillStrokeRoundRect(ctx, -6, -24, 12, 6, 2.5, '#ef4444', OUTLINE_COLOR, 2);
        this._fillStrokeRoundRect(ctx, -14, -19, 28, 19, 5, '#f8fafc', OUTLINE_COLOR, 2.4);

        // 측면 음영 하단 띠
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-12, -5, 24, 3.5);

        // 중앙 응급 십자 마크
        ctx.fillStyle = '#16a34a';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(-2.5, -15.5);
        ctx.lineTo(2.5, -15.5);
        ctx.lineTo(2.5, -12);
        ctx.lineTo(6, -12);
        ctx.lineTo(6, -7);
        ctx.lineTo(2.5, -7);
        ctx.lineTo(2.5, -3.5);
        ctx.lineTo(-2.5, -3.5);
        ctx.lineTo(-2.5, -7);
        ctx.lineTo(-6, -7);
        ctx.lineTo(-6, -12);
        ctx.lineTo(-2.5, -12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (item.typeId === 'overtime_pay') {
        // 2. 야근 수당: 황금빛 급여 봉투 + 붉은 왁스 씰 & 황금 ₩ 기호
        this._fillStrokeRoundRect(ctx, -13, -20, 26, 20, 4, '#fbbf24', OUTLINE_COLOR, 2.4);

        // 봉투 덮개 삼각 라인
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(-13, -20);
        ctx.lineTo(0, -9);
        ctx.lineTo(13, -20);
        ctx.stroke();

        // 중앙 붉은 보너스 씰
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(0, -8.5, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // 씰 안 ₩ 텍스트
        ctx.font = '900 8.5px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fef08a';
        ctx.fillText('₩', 0, -8);
      } else if (item.typeId === 'overtime_sneakers') {
        // 3. 잔업용 운동화: 날렵한 시안/블루 스니커즈 + 번개(⚡) 대시 심볼
        // 밑창
        this._fillStrokeRoundRect(ctx, -14, -6, 28, 6, 2.5, '#f8fafc', OUTLINE_COLOR, 2);
        // 신발 본체
        this._fillStrokeRoundRect(ctx, -13, -19, 25, 14, 5, '#0284c7', OUTLINE_COLOR, 2.3);
        // 앞코 라인
        ctx.fillStyle = '#38bdf8';
        ctx.beginPath();
        ctx.arc(9, -11, 4.5, 0, Math.PI * 2);
        ctx.fill();
        // 발목 입구
        ctx.fillStyle = '#0369a1';
        ctx.fillRect(-10, -21, 10, 4);

        // 번개 심볼
        ctx.fillStyle = '#fde047';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-1, -17);
        ctx.lineTo(3, -17);
        ctx.lineTo(0.5, -12);
        ctx.lineTo(4, -12);
        ctx.lineTo(-3, -7);
        ctx.lineTo(-1, -11);
        ctx.lineTo(-4, -11);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (item.typeId === 'bulletproof_folder') {
        // 4. 방탄 서류철: 단단한 강철 바인더 + 방패(🛡️) 리벳 엠블럼
        this._fillStrokeRoundRect(ctx, -12, -22, 24, 22, 4, '#334155', OUTLINE_COLOR, 2.4);
        // 좌측 바인더 링 힌지
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-13, -20, 3, 18);
        ctx.strokeRect(-13, -20, 3, 18);

        // 중앙 방패 엠블럼
        ctx.fillStyle = '#a855f7';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, -17);
        ctx.lineTo(5.5, -14);
        ctx.lineTo(5.5, -8);
        ctx.lineTo(0, -4.5);
        ctx.lineTo(-5.5, -8);
        ctx.lineTo(-5.5, -14);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 방패 중심 하이라이트 코어
        ctx.fillStyle = '#f3e8ff';
        ctx.beginPath();
        ctx.arc(0, -10.5, 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (item.typeId === 'weapon_cutter') {
        // Phase 16: 사무용 커터 - 노란색 대형 커터칼 본체 + 날카로운 은색 칼날
        this._fillStrokeRoundRect(ctx, -13, -15, 20, 9, 3, '#eab308', OUTLINE_COLOR, 2);
        // 칼날 슬라이더 홈
        ctx.fillStyle = '#713f12';
        ctx.fillRect(-10, -12, 12, 2.5);
        // 돌출된 은색 커터 칼날
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(7, -14);
        ctx.lineTo(15, -14);
        ctx.lineTo(11, -7);
        ctx.lineTo(7, -7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (item.typeId === 'weapon_hammer') {
        // Phase 16: 대형 망치 - 묵직한 오함마 철재 헤드 + 목재 손잡이
        ctx.save();
        ctx.rotate(-0.35);
        // 긴 나무 자루
        this._fillStrokeRoundRect(ctx, -3, -26, 6, 26, 2, '#92400e', OUTLINE_COLOR, 1.8);
        // 철제 둔기 헤드
        this._fillStrokeRoundRect(ctx, -11, -29, 22, 12, 3, '#475569', OUTLINE_COLOR, 2.4);
        // 헤드 측면 충격판
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(-9, -27, 18, 8);
        ctx.restore();
      } else if (item.typeId === 'weapon_stun_baton') {
        // Phase 16: 전기 충격봉 - 고압 방전봉 본체 + 네온 블루 방전 링
        ctx.save();
        ctx.rotate(0.35);
        // 절연 고무 손잡이
        this._fillStrokeRoundRect(ctx, -3, -12, 6, 14, 2, '#0f172a', OUTLINE_COLOR, 1.8);
        // 고압 방전 코어 바디
        this._fillStrokeRoundRect(ctx, -3.5, -28, 7, 16, 2.5, '#0284c7', OUTLINE_COLOR, 2.2);
        // 번개 네온 하이라이트
        ctx.fillStyle = '#7dd3fc';
        ctx.fillRect(-2, -26, 4, 12);
        ctx.restore();
      } else if (item.typeId === 'weapon_pistol') {
        // Phase 16: 사무용 권총 - 스틸 리볼버 바디 + 목재 그립
        // 총열 및 몸체
        this._fillStrokeRoundRect(ctx, -10, -18, 20, 8, 2.5, '#334155', OUTLINE_COLOR, 2);
        // 회전 탄창 실린더
        this._fillStrokeRoundRect(ctx, -5, -19, 8, 10, 2, '#64748b', OUTLINE_COLOR, 1.5);
        // 손잡이 그립
        ctx.save();
        ctx.rotate(0.3);
        this._fillStrokeRoundRect(ctx, -10, -11, 7, 11, 2, '#78350f', OUTLINE_COLOR, 1.8);
        ctx.restore();
      } else if (item.typeId === 'weapon_shotgun') {
        // Phase 16: 산탄총 - 긴 이중 총열 + 개머리판
        // 이중 총열
        this._fillStrokeRoundRect(ctx, -6, -17, 20, 6, 2, '#475569', OUTLINE_COLOR, 2);
        // 펌프 장전 손잡이
        this._fillStrokeRoundRect(ctx, 2, -15, 7, 5, 1.5, '#92400e', OUTLINE_COLOR, 1.4);
        // 목재 개머리판
        this._fillStrokeRoundRect(ctx, -16, -15, 11, 8, 2.5, '#78350f', OUTLINE_COLOR, 1.8);
      } else if (item.typeId === 'weapon_doc_launcher') {
        // Phase 16: 서류 발사기 - 서류 급지통 + 압축 공기 배럴
        this._fillStrokeRoundRect(ctx, -12, -20, 24, 18, 4, '#1e293b', OUTLINE_COLOR, 2.4);
        // 전면 급지 슬릿
        this._fillStrokeRoundRect(ctx, 6, -15, 7, 8, 2, '#38bdf8', OUTLINE_COLOR, 1.6);
        // 적재된 A4 서류 묶음
        this._fillStrokeRoundRect(ctx, -8, -17, 12, 12, 1.5, '#f8fafc', OUTLINE_COLOR, 1.5);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-5, -13);
        ctx.lineTo(1, -13);
        ctx.moveTo(-5, -9);
        ctx.lineTo(0, -9);
        ctx.stroke();
      } else {
        // 5. 무기 강화 모듈: 전술 금속 모듈 케이스 + 황금빛 강화 코어 & 상승 화살표(▲) 도형
        this._fillStrokeRoundRect(ctx, -14, -20, 28, 20, 5, '#1e293b', OUTLINE_COLOR, 2.4);
        this._fillStrokeRoundRect(ctx, -10.5, -16.5, 21, 13, 3, '#0f172a', '#475569', 1.5);

        // 좌우 에너지 단자 포인트
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(-13, -13, 2.5, 6);
        ctx.fillRect(10.5, -13, 2.5, 6);

        // 중앙 황금 강화 엠블럼 (위쪽 화살표 셰브론)
        ctx.fillStyle = '#fbbf24';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -15.5);
        ctx.lineTo(6.5, -6.5);
        ctx.lineTo(2.5, -6.5);
        ctx.lineTo(2.5, -4.5);
        ctx.lineTo(-2.5, -4.5);
        ctx.lineTo(-2.5, -6.5);
        ctx.lineTo(-6.5, -6.5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // 비포커스 상태에서는 도형 바로 위에 기본 이름 표시 (포커스 시에는 캐릭터에 가리지 않도록 상단 레이어에 [E] 표시)
      if (!isFocused) {
        let labelColor = '#bbf7d0';
        if (item.typeId === 'overtime_pay') labelColor = '#fde047';
        else if (item.typeId === 'overtime_sneakers') labelColor = '#7dd3fc';
        else if (item.typeId === 'bulletproof_folder') labelColor = '#d8b4fe';
        else if (item.typeId === 'weapon_upgrade_module') labelColor = '#fed7aa';
        else if (item.category === 'weapon') labelColor = item.weaponId === 'hammer' ? '#f59e0b' : item.weaponId === 'stun_baton' ? '#38bdf8' : '#fde047';

        ctx.font = '700 10px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3;
        ctx.strokeText(item.name, 0, -29);
        ctx.fillStyle = labelColor;
        ctx.fillText(item.name, 0, -29);
      }

      ctx.restore();
    }

    /**
     * 아이템 획득 순간의 파동 링, 포커스 [E] 라벨 및 회복량/강화 단계 플로팅 텍스트 렌더링
     */
    _drawItemFeedbackEffects(ctx, itemSystem) {
      if (itemSystem.focusedItem && !itemSystem.focusedItem.collected) {
        const fItem = itemSystem.focusedItem;
        const hoverY = Math.sin(fItem.bobPhase) * 2.4;
        const labelText = `[E] ${fItem.name}`;
        ctx.save();
        ctx.font = '800 11.5px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3.2;
        ctx.strokeText(labelText, fItem.position.x, fItem.position.y + hoverY - 31);
        ctx.fillStyle = '#fde047';
        ctx.fillText(labelText, fItem.position.x, fItem.position.y + hoverY - 31);
        ctx.restore();
      }
      for (let i = 0; i < itemSystem.pickupRings.length; i++) {
        const ring = itemSystem.pickupRings[i];
        const t = Math.min(1, ring.elapsed / ring.duration);
        const radius = 6 + (ring.maxRadius - 6) * t;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = ring.color;
        ctx.lineWidth = 3 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      if (itemSystem.popups.length > 0) {
        ctx.save();
        ctx.font = '800 14.5px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < itemSystem.popups.length; i++) {
          const p = itemSystem.popups[i];
          const t = Math.min(1, p.elapsed / p.duration);
          const alpha = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
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

    /**
     * Phase 10: 보스 공격 예고 바닥 표시 (패턴 A: 전방 부채꼴 예고, 패턴 B: 바닥 원형 장판 예고)
     */
    _drawBossTelegraphs(ctx, boss) {
      if (!boss || !boss.alive || boss.state !== 'Telegraph') {
        return;
      }

      const att = boss.currentAttack;
      if (!att || att.phase !== 'telegraph') {
        return;
      }

      const progress = Math.max(0, Math.min(1, att.timer / (att.totalTelegraph || 1)));

      ctx.save();

      if (att.pattern === 'melee_swing') {
        // 패턴 A: 전방 부채꼴 예고 영역 (거리 ~96px, 각도 130도)
        const halfArc = att.arcRad * 0.5;
        const startAngle = att.aimAngle - halfArc;
        const endAngle = att.aimAngle + halfArc;

        // 1. 반투명 붉은 경고 부채꼴 기본 영역
        ctx.fillStyle = 'rgba(244, 63, 94, 0.16)';
        ctx.beginPath();
        ctx.moveTo(boss.position.x, boss.position.y);
        ctx.arc(boss.position.x, boss.position.y, att.range, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();

        // 2. 시간에 따라 바깥쪽으로 채워지는 강렬한 진행률 부채꼴
        const fillRadius = att.range * progress;
        ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
        ctx.beginPath();
        ctx.moveTo(boss.position.x, boss.position.y);
        ctx.arc(boss.position.x, boss.position.y, fillRadius, startAngle, endAngle);
        ctx.closePath();
        ctx.fill();

        // 3. 점멸하는 붉은 외곽선
        ctx.strokeStyle = `rgba(251, 113, 133, ${(0.6 + Math.sin(progress * Math.PI * 4) * 0.35).toFixed(2)})`;
        ctx.lineWidth = 2.4;
        ctx.stroke();

        // 조준 중심선
        ctx.strokeStyle = 'rgba(254, 205, 211, 0.6)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(boss.position.x, boss.position.y);
        ctx.lineTo(
          boss.position.x + Math.cos(att.aimAngle) * att.range,
          boss.position.y + Math.sin(att.aimAngle) * att.range
        );
        ctx.stroke();
      } else if (att.pattern === 'floor_slam') {
        // 패턴 B: 플레이어 발밑 바닥 원형 경고 장판 (반경 ~72px)
        const cx = att.targetX;
        const cy = att.targetY;
        const rad = att.slamRadius;

        // 1. 기본 원형 위험 영역
        ctx.fillStyle = 'rgba(225, 29, 72, 0.18)';
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();

        // 2. 중심에서 바깥쪽으로 확장되는 진행률 원
        const currR = rad * progress;
        ctx.fillStyle = 'rgba(244, 63, 94, 0.32)';
        ctx.beginPath();
        ctx.arc(cx, cy, currR, 0, Math.PI * 2);
        ctx.fill();

        // 3. 맥동하는 경고 외곽 링
        ctx.strokeStyle = `rgba(251, 113, 133, ${(0.65 + Math.sin(progress * Math.PI * 5) * 0.3).toFixed(2)})`;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        // 4. 중앙 경고 마크 (!)
        ctx.font = '900 18px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3.5;
        ctx.strokeText('!', cx, cy);
        ctx.fillStyle = '#fde047';
        ctx.fillText('!', cx, cy);
      }

      ctx.restore();
    }

    /**
     * Phase 10: 보스 공격 시각 효과 (패턴 A 휘두르기 궤적 및 패턴 B 바닥 충격파 링)
     */
    _drawBossAttackEffects(ctx, boss) {
      if (!boss) return;

      // 1. 패턴 A: 근접 휘두르기 붉은 궤적
      for (let i = 0; i < boss.activeSlashArcs.length; i++) {
        const arc = boss.activeSlashArcs[i];
        const t = Math.min(1, arc.elapsed / arc.duration);
        const alpha = Math.max(0, 1 - t * 1.2);
        const halfArc = arc.arcRad * 0.5;

        ctx.save();
        ctx.translate(arc.x, arc.y);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 6 * (1 - t * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, arc.range * (0.85 + t * 0.25), arc.aimAngle - halfArc, arc.aimAngle + halfArc);
        ctx.stroke();

        ctx.strokeStyle = '#fecdd3';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }

      // 2. 패턴 B: 바닥 강타 충격파 링
      for (let i = 0; i < boss.activeSlamRings.length; i++) {
        const ring = boss.activeSlamRings[i];
        const t = Math.min(1, ring.elapsed / ring.duration);
        const alpha = Math.max(0, 1 - t);
        const currentRadius = ring.radius * (0.4 + t * 0.7);

        ctx.save();
        ctx.translate(ring.x, ring.y);
        ctx.globalAlpha = alpha;

        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 4 * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
      }
    }

    /**
     * Phase 10: 보스 엔티티(야근 감독관) 카툰 그래픽 렌더링
     */
    _drawBoss(ctx, boss) {
      const bx = boss.position.x;
      const by = boss.position.y;
      const isDead = boss.isDead();
      const isFlashing = boss.hitFlashTimer > 0;
      const shakeOffset = boss.shakeTimer > 0 ? (Math.random() - 0.5) * 5 : 0;

      const isTelegraph = boss.state === 'Telegraph';
      const isAttacking = boss.state === 'Attack';
      const isRecovery = boss.state === 'Recovery';
      const facingBack = boss.direction.facing === 'up';
      const dirX = boss.direction.x;
      const dirY = boss.direction.y;

      const walkBob = boss.isMoving ? Math.abs(Math.sin(boss.walkPhase)) * 3 : 0;

      ctx.save();
      ctx.translate(bx + shakeOffset, by);

      // 사망 연출 중 투명도 감쇠
      if (isDead) {
        const fade = Math.max(0, boss.deathTimer / 1.5);
        ctx.globalAlpha = fade;
      }

      // 위압감 있는 대형 체구 스케일 적용 (약 1.38배)
      ctx.scale(1.38, 1.38);

      // 1. 배후 암흑 오라 (야근의 원혼 기운)
      ctx.fillStyle = isTelegraph
        ? 'rgba(239, 68, 68, 0.28)'
        : isAttacking
          ? 'rgba(244, 63, 94, 0.35)'
          : 'rgba(88, 28, 135, 0.22)';
      ctx.beginPath();
      ctx.ellipse(0, -32 - walkBob, 28, 36, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. 다리 및 고급 가죽 구두
      const legColor = isFlashing ? '#ffffff' : '#1e1b2e';
      const shoeColor = isFlashing ? '#ffffff' : '#0f0e17';
      this._fillStrokeRoundRect(ctx, -14, -12, 10, 14, 4, legColor, OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, 4, -12, 10, 14, 4, legColor, OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, -16, -2, 13, 5, 2.5, shoeColor, OUTLINE_COLOR, 2);
      this._fillStrokeRoundRect(ctx, 3, -2, 13, 5, 2.5, shoeColor, OUTLINE_COLOR, 2);

      // 3. 육중한 정장 코트 상체
      const bodyTop = -46 - walkBob;
      const coatColor = isFlashing
        ? '#ffffff'
        : isTelegraph
          ? '#581c2f'
          : '#23182b';

      // 코트 본체
      this._fillStrokeRoundRect(ctx, -21, bodyTop, 42, 38, 9, coatColor, OUTLINE_COLOR, 2.8);

      // 4. 셔츠 칼라 및 붉은 넥타이 & 금색 타이핀 (정면/측면 시)
      if (!facingBack) {
        const tieX = dirX * 5;
        // 와이셔츠 깃
        ctx.fillStyle = isFlashing ? '#ffffff' : '#e2e8f0';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(tieX - 8, bodyTop + 2);
        ctx.lineTo(tieX, bodyTop + 13);
        ctx.lineTo(tieX + 8, bodyTop + 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 붉은 임원 넥타이
        ctx.fillStyle = isFlashing ? '#fda4af' : '#e11d48';
        ctx.beginPath();
        ctx.moveTo(tieX - 1, bodyTop + 5);
        ctx.lineTo(tieX + 4.5, bodyTop + 18);
        ctx.lineTo(tieX, bodyTop + 27);
        ctx.lineTo(tieX - 4.5, bodyTop + 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 골드 타이 핀
        ctx.fillStyle = '#fbbf24';
        ctx.fillRect(tieX - 3.5, bodyTop + 15, 7, 2.5);
      }

      // 5. 양팔 (공격 준비 시 치켜들기 동작)
      const armLift = isTelegraph ? -10 : isAttacking ? 6 : 0;
      const armColor = isFlashing ? '#ffffff' : '#1f1627';
      this._fillStrokeRoundRect(ctx, -27 + dirX * 2, bodyTop + 6 + armLift, 8.5, 22, 4, armColor, OUTLINE_COLOR, 2.4);
      this._fillStrokeRoundRect(ctx, 18.5 + dirX * 2, bodyTop + 6 + armLift, 8.5, 22, 4, armColor, OUTLINE_COLOR, 2.4);

      // 날카로운 그림자 손톱/손
      const handColor = isFlashing ? '#ffffff' : '#3b0764';
      ctx.fillStyle = handColor;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(-23 + dirX * 2, bodyTop + 28 + armLift, 4.5, 0, Math.PI * 2);
      ctx.arc(23 + dirX * 2, bodyTop + 28 + armLift, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 6. 거대한 위압적 헤드 & 뿔 달린 어둠의 실루엣
      const headY = -62 - walkBob;
      const headR = 17;
      const skinColor = isFlashing ? '#ffffff' : '#e9d5ff';

      ctx.fillStyle = skinColor;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.8;
      ctx.beginPath();
      ctx.arc(0, headY, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // 어둠의 임원 뿔 머리장식
      ctx.fillStyle = isFlashing ? '#ffffff' : '#160d24';
      ctx.beginPath();
      ctx.moveTo(-16, headY - 4);
      ctx.lineTo(-22, headY - 24);
      ctx.lineTo(-8, headY - 16);
      ctx.lineTo(0, headY - 25);
      ctx.lineTo(8, headY - 16);
      ctx.lineTo(22, headY - 24);
      ctx.lineTo(16, headY - 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // 번뜩이는 악마적 붉은 안광
      if (!facingBack && !isDead) {
        const eyeX = dirX * 5.5;
        const eyeY = headY + 2 + Math.max(-2, dirY * 2.5);

        ctx.fillStyle = '#f43f5e';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(-6 + eyeX, eyeY, 4, 2.6, -0.2, 0, Math.PI * 2);
        ctx.ellipse(6 + eyeX, eyeY, 4, 2.6, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(-6 + eyeX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.arc(6 + eyeX, eyeY, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      // 7. 머리 위 보스 명판 및 미니 체력 바
      if (!isDead) {
        const barW = 56;
        const barH = 7.5;
        const barX = -barW * 0.5;
        const barY = -96 - walkBob;
        const hpRatio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));

        this._fillStrokeRoundRect(ctx, barX, barY, barW, barH, 3.5, '#0f0b18', OUTLINE_COLOR, 2);
        if (hpRatio > 0) {
          ctx.fillStyle = '#e11d48';
          ctx.fillRect(barX + 1.5, barY + 1.5, (barW - 3) * hpRatio, barH - 3);
        }

        // 보스 라벨 텍스트
        const stateText = isTelegraph
          ? '공격 준비!'
          : isAttacking
            ? '공격!'
            : isRecovery
              ? '후열'
              : '추적';
        const label = `야근 감독관 [${stateText}]`;

        ctx.font = 'bold 10px "Malgun Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = OUTLINE_COLOR;
        ctx.lineWidth = 3;
        ctx.strokeText(label, 0, barY - 4);
        ctx.fillStyle = isTelegraph ? '#fde047' : '#fda4af';
        ctx.fillText(label, 0, barY - 4);
      }

      ctx.restore();
    }

    /**
     * Phase 11: 탈출 장치 바닥 영역 및 활성화/비활성화 가동 이펙트 렌더링
     */
    _drawEscapeDeviceFloor(ctx, device) {
      if (!device) return;
      const x = device.position.x;
      const y = device.position.y;
      const isActive = device.isActive;
      const isFocused = device.isFocused;
      const animPhase = device.animPhase || 0;

      ctx.save();
      ctx.translate(x, y);

      if (isActive) {
        // 활성화 상태: 에메랄드 그린 발광 패드 및 바닥 진입 펄스 링
        const pulse = 0.5 + 0.5 * Math.sin(animPhase * 3.5);
        const ringScale = (animPhase * 0.9) % 1.0;

        // 1. 바닥 은은한 그린 방사형 그라데이션
        const grad = ctx.createRadialGradient(0, 8, 10, 0, 8, 56);
        grad.addColorStop(0, `rgba(52, 211, 153, ${(0.32 + pulse * 0.15).toFixed(3)})`);
        grad.addColorStop(0.65, `rgba(16, 185, 129, ${(0.14 + pulse * 0.08).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(5, 150, 105, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(0, 8, 62, 32, 0, 0, Math.PI * 2);
        ctx.fill();

        // 2. 바닥 탑승 카펫/발판
        ctx.fillStyle = '#0f291e';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2;
        this._fillRoundRectOnly(ctx, -38, -6, 76, 28, 6);
        ctx.beginPath();
        this._traceRoundRect(ctx, -38, -6, 76, 28, 6);
        ctx.stroke();

        // 3. 외부로 확산되는 비상 탈출 가동 링
        ctx.strokeStyle = `rgba(52, 211, 153, ${(1 - ringScale) * 0.65})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(0, 8, 38 + ringScale * 26, 18 + ringScale * 14, 0, 0, Math.PI * 2);
        ctx.stroke();

        // 4. 엘리베이터 입구 방향 쉐브론 화살표 (▲▲)
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▲  ▲', 0, 12);

        // 5. 근접 포커스 시 점선 강조 링
        if (isFocused) {
          ctx.strokeStyle = '#6ee7b7';
          ctx.lineWidth = 2.2;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.ellipse(0, 8, 54, 28, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else {
        // 비활성화 상태: 어둡고 붉은 보안 잠금 표시
        ctx.fillStyle = 'rgba(239, 68, 68, 0.08)';
        ctx.beginPath();
        ctx.ellipse(0, 6, 46, 22, 0, 0, Math.PI * 2);
        ctx.fill();

        // 바닥 금지 발판
        ctx.fillStyle = '#1c151c';
        ctx.strokeStyle = '#4a1d2e';
        ctx.lineWidth = 1.6;
        this._fillRoundRectOnly(ctx, -34, -4, 68, 22, 5);
        ctx.beginPath();
        this._traceRoundRect(ctx, -34, -4, 68, 22, 5);
        ctx.stroke();

        // 잠금 표시선
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(-16, 7);
        ctx.lineTo(16, 7);
        ctx.stroke();

        if (isFocused) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.6)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.ellipse(0, 6, 48, 24, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      ctx.restore();
    }

    /**
     * Phase 11: 탈출 장치 본체(엘리베이터 하우징, 도어, 상단 전광판 및 상태 램프) 렌더링
     */
    _drawEscapeDevice(ctx, device, isFocused = false) {
      if (!device) return;
      const x = device.position.x;
      const y = device.position.y;
      const w = device.width;
      const h = device.height;
      const zh = device.zHeight;
      const isActive = device.isActive;
      const animPhase = device.animPhase || 0;

      ctx.save();
      ctx.translate(x, y);

      const hw = w * 0.5;
      const hh = h * 0.5;

      // 1. 바닥 그림자 (쿼터뷰 우하단 드롭)
      ctx.fillStyle = 'rgba(7, 9, 16, 0.55)';
      ctx.beginPath();
      ctx.ellipse(3, 4, hw + 4, hh + 2, 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. 엘리베이터 외곽 강철 프레임 하우징 (2.5D 입체 박스)
      ctx.fillStyle = '#1e2433';
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.lineWidth = 2.5;
      this._fillRoundRectOnly(ctx, -hw, -hh - zh, w, zh + hh * 2, 8);
      ctx.beginPath();
      this._traceRoundRect(ctx, -hw, -hh - zh, w, zh + hh * 2, 8);
      ctx.stroke();

      // 프레임 상단 지붕면 (밝은 하이라이트)
      ctx.fillStyle = '#2d374d';
      this._fillRoundRectOnly(ctx, -hw + 2, -hh - zh + 2, w - 4, 18, 6);

      // 3. 엘리베이터 내부 개구부 / 도어 영역
      const doorW = w - 24;
      const doorH = zh - 6;
      const doorX = -doorW * 0.5;
      const doorY = -doorH;

      if (isActive) {
        // 활성화 상태: 엘리베이터 내부 오픈 및 밝은 조명 연출
        const innerGrad = ctx.createLinearGradient(0, doorY, 0, 0);
        innerGrad.addColorStop(0, '#042f2e');
        innerGrad.addColorStop(0.7, '#0f766e');
        innerGrad.addColorStop(1, '#14b8a6');
        ctx.fillStyle = innerGrad;
        ctx.fillRect(doorX, doorY, doorW, doorH);

        // 내부 바닥 카펫
        ctx.fillStyle = '#065f46';
        ctx.fillRect(doorX + 2, -12, doorW - 4, 12);

        // 내부 측면 벽선 및 버튼 패널
        ctx.fillStyle = '#2dd4bf';
        ctx.fillRect(doorX + 6, doorY + 16, 4, 14);

        // 개방되어 양쪽 벽으로 수납된 슬라이딩 도어
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.fillRect(doorX, doorY, 8, doorH);
        ctx.strokeRect(doorX, doorY, 8, doorH);
        ctx.fillRect(doorX + doorW - 8, doorY, 8, doorH);
        ctx.strokeRect(doorX + doorW - 8, doorY, 8, doorH);

        // 내부 상단 다운라이트 광원 효과
        const lampPulse = 0.8 + 0.2 * Math.sin(animPhase * 5);
        ctx.fillStyle = `rgba(204, 251, 241, ${(lampPulse * 0.8).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(0, doorY + 4, 7, 0, Math.PI);
        ctx.fill();
      } else {
        // 비활성화 상태: 굳게 닫힌 강철 이중 도어 및 보안 잠금
        ctx.fillStyle = '#151926';
        ctx.fillRect(doorX, doorY, doorW, doorH);

        const halfDoorW = doorW * 0.5;
        ctx.fillStyle = '#1f2537';
        ctx.strokeStyle = '#0b0f19';
        ctx.lineWidth = 1.5;
        ctx.fillRect(doorX, doorY, halfDoorW - 1, doorH);
        ctx.strokeRect(doorX, doorY, halfDoorW - 1, doorH);
        ctx.fillRect(0, doorY, halfDoorW, doorH);
        ctx.strokeRect(0, doorY, halfDoorW, doorH);

        ctx.strokeStyle = '#0b0f19';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, doorY);
        ctx.lineTo(0, 0);
        ctx.stroke();

        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
        for (let sx = doorX + 6; sx < doorX + doorW - 8; sx += 14) {
          ctx.beginPath();
          ctx.moveTo(sx, -26);
          ctx.lineTo(sx + 7, -26);
          ctx.lineTo(sx - 2, -10);
          ctx.lineTo(sx - 9, -10);
          ctx.fill();
        }

        ctx.fillStyle = '#450a0a';
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.5;
        this._fillRoundRectOnly(ctx, -10, -32, 20, 16, 3);
        ctx.beginPath();
        this._traceRoundRect(ctx, -10, -32, 20, 16, 3);
        ctx.stroke();

        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🔒', 0, -20);
      }

      // 4. 엘리베이터 상단 디지털 안내 전광판
      const signY = -hh - zh + 6;
      ctx.fillStyle = '#0b0f19';
      ctx.strokeStyle = isActive ? '#059669' : '#7f1d1d';
      ctx.lineWidth = 1.5;
      this._fillRoundRectOnly(ctx, -hw + 10, signY, w - 20, 16, 3);
      ctx.beginPath();
      this._traceRoundRect(ctx, -hw + 10, signY, w - 20, 16, 3);
      ctx.stroke();

      ctx.textAlign = 'center';
      if (isActive) {
        ctx.font = 'bold 9.5px "Malgun Gothic", sans-serif';
        ctx.fillStyle = '#34d399';
        ctx.fillText('EXIT ▲ 탈출구', 0, signY + 11.5);

        const lampFlash = Math.sin(animPhase * 6) > 0;
        ctx.fillStyle = lampFlash ? '#6ee7b7' : '#059669';
        ctx.beginPath();
        ctx.arc(-hw + 15, signY + 8, 3, 0, Math.PI * 2);
        ctx.arc(hw - 15, signY + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.font = 'bold 9px "Malgun Gothic", sans-serif';
        ctx.fillStyle = '#f87171';
        ctx.fillText('RESTRICTED', 0, signY + 11);

        const lampFlash = Math.sin(animPhase * 3) > 0;
        ctx.fillStyle = lampFlash ? '#ef4444' : '#7f1d1d';
        ctx.beginPath();
        ctx.arc(-hw + 15, signY + 8, 3, 0, Math.PI * 2);
        ctx.arc(hw - 15, signY + 8, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. 플레이어가 상호작용 가능 범위 내에 진입(isFocused) 시 상단 플로팅 뱃지 표시
      if (isFocused) {
        const badgeY = -hh - zh - 14 + Math.sin(animPhase * 5) * 3;
        ctx.save();
        ctx.font = 'bold 11px "Malgun Gothic", sans-serif';
        const label = isActive ? '[E] 탈출' : '[잠김]';
        const textW = ctx.measureText(label).width;

        ctx.fillStyle = isActive ? 'rgba(6, 78, 59, 0.95)' : 'rgba(69, 10, 10, 0.92)';
        ctx.strokeStyle = isActive ? '#34d399' : '#ef4444';
        ctx.lineWidth = 1.8;
        this._fillRoundRectOnly(ctx, -textW * 0.5 - 7, badgeY - 11, textW + 14, 18, 5);
        ctx.beginPath();
        this._traceRoundRect(ctx, -textW * 0.5 - 7, badgeY - 11, textW + 14, 18, 5);
        ctx.stroke();

        ctx.fillStyle = isActive ? '#ecfdf5' : '#fee2e2';
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, badgeY + 2);
        ctx.restore();
      }

      ctx.restore();
    }

  }

  PO.Renderer = Renderer;
})(window);
