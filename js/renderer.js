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
     * 화면 좌표를 게임 월드 좌표로 변환 (추후 마우스 방향 공격 구현 시 활용 가능)
     */
    screenToWorld(clientX, clientY) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) / this.scale,
        y: (clientY - rect.top) / this.scale
      };
    }

    /**
     * 전체 프레임 렌더링
     */
    render(officeMap, player) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.scale * this.dpr, 0, 0, this.scale * this.dpr, 0, 0);

      // 1. 배경 및 쿼터뷰 사무실 바닥
      this._drawFloor(ctx, officeMap);

      // 2. 북쪽(뒷면) 벽면 및 좌/우 외벽
      this._drawBackAndSideWalls(ctx, officeMap);

      // 3. 바닥 그림자 및 플레이어 방향 표시 (오브젝트 본체보다 먼저 그림)
      this._drawShadows(ctx, officeMap, player);
      this._drawPlayerDirectionIndicator(ctx, player);

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

      renderQueue.push({
        kind: 'player',
        sortY: player.getSortY(),
        data: player
      });

      renderQueue.sort((a, b) => a.sortY - b.sortY);

      for (let i = 0; i < renderQueue.length; i++) {
        const item = renderQueue[i];
        if (item.kind === 'obstacle') {
          this._drawObstacle(ctx, item.data);
        } else {
          this._drawPlayer(ctx, item.data);
        }
      }

      // 5. 남쪽(전면) 단면 벽 및 야근 조명 비네팅
      this._drawForegroundWall(ctx, officeMap);
      this._drawNightAtmosphere(ctx, officeMap);

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

    _drawShadows(ctx, officeMap, player) {
      ctx.fillStyle = 'rgba(7, 9, 16, 0.45)';

      // 장애물 바닥 그림자 (쿼터뷰 입체감을 위해 우하단 오프셋)
      for (let i = 0; i < officeMap.obstacles.length; i++) {
        const obs = officeMap.obstacles[i];
        this._fillRoundRectOnly(ctx, obs.x + 5, obs.y + 5, obs.width, obs.height, 6);
      }

      // 플레이어 발 그림자
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
     * 카툰 스타일 회사원 플레이어 렌더링 (단순 도형 조합)
     */
    _drawPlayer(ctx, player) {
      const px = player.position.x;
      const py = player.position.y;
      const dirX = player.direction.x;
      const dirY = player.direction.y;

      const isMoving = player.isMoving;
      const bounce = isMoving ? Math.abs(Math.sin(player.walkPhase)) * 2.5 : 0;
      const stride = isMoving ? Math.sin(player.walkPhase) * 3.5 : 0;
      const facingBack = dirY < -0.55;

      ctx.save();
      ctx.translate(px, py);

      // 1. 다리 / 구두 (검은 정장 바지 & 구두 도형)
      this._fillStrokeRoundRect(ctx, -9, -9 + stride * 0.5, 7, 10, 3, '#1e2436', OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, 2, -9 - stride * 0.5, 7, 10, 3, '#1e2436', OUTLINE_COLOR, 2.2);

      // 2. 몸통 (흰색 와이셔츠 + 정장 바지 허리선)
      const bodyTop = -30 - bounce;
      this._fillStrokeRoundRect(ctx, -12, bodyTop, 24, 23, 6, '#f1f5f9', OUTLINE_COLOR, 2.5);

      // 바지 상단 벨트라인
      this._fillStrokeRect(ctx, -11, bodyTop + 16, 22, 7, '#283147', OUTLINE_COLOR, 2);

      // 3. 정면/측면일 때 붉은 넥타이 및 사원증 표시 (방향에 따라 수평 오프셋)
      if (!facingBack) {
        const tieOffsetX = dirX * 4.5;

        // 붉은 넥타이
        ctx.fillStyle = '#e11d48';
        ctx.strokeStyle = OUTLINE_COLOR;
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
      this._fillStrokeRoundRect(ctx, -16, bodyTop + 3 - armSwing * 0.6, 6, 13, 3, '#e2e8f0', OUTLINE_COLOR, 2.2);
      this._fillStrokeRoundRect(ctx, 10, bodyTop + 3 + armSwing * 0.6, 6, 13, 3, '#e2e8f0', OUTLINE_COLOR, 2.2);

      // 5. 머리 (둥근 카툰 헤드)
      const headY = -42 - bounce;
      const headRadius = 13;

      ctx.fillStyle = '#fbd3b6';
      ctx.strokeStyle = OUTLINE_COLOR;
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
