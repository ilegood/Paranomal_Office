(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 전체 방·복도·문 구조 및 플레이어·생존 적·보급 아이템 위치를 실시간 표시하는 미니맵 모듈
   * - 별도 하드코딩 없이 OfficeMap, Player, EnemySystem, ItemSystem 데이터를 직접 참조하여 렌더링한다.
   * - 이번 단계에서는 미탐험 지역 숨김(안개)이나 확대/축소 없이 전체 고정 탐험 맵을 한눈에 표시한다.
   */
  class Minimap {
    constructor(canvas, zoneTextElement = null) {
      this.canvas = canvas || document.getElementById('minimap-canvas');
      this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
      this.zoneTextEl = zoneTextElement || document.getElementById('minimap-zone-text');

      this.cssWidth = 214;
      this.cssHeight = 118;
      this.padding = 10;
      this.dpr = 1;

      this._lastZoneLabel = '';
      this._pulseTime = 0;

      // 최근 렌더링 스냅샷 (실시간 좌표 연동 상태 조회용)
      this.lastRenderState = null;

      this.resize();
      this._onResize = this.resize.bind(this);
      window.addEventListener('resize', this._onResize);
    }

    /**
     * 미니맵 캔버스 고해상도(DPR) 버퍼 동기화
     */
    resize() {
      if (!this.canvas || !this.ctx) {
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      if (rect.width > 20 && rect.height > 20) {
        this.cssWidth = Math.round(rect.width);
        this.cssHeight = Math.round(rect.height);
      }

      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.cssWidth * this.dpr);
      this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    }

    /**
     * 맵 재생성 또는 게임 재시작 시 이전 맵의 투영 상태·구역 텍스트·캔버스 잔상을 완전히 초기화
     */
    reset() {
      this.lastRenderState = null;
      this._lastZoneLabel = '';
      if (this.zoneTextEl) {
        this.zoneTextEl.textContent = '-';
      }
      if (this.canvas && this.ctx) {
        this.ctx.save();
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        this.ctx.restore();
      }
    }

    /**
     * 실제 OfficeMap의 방·복도 데이터로부터 미니맵 투영 변환 정보 계산 (하드코딩 없음)
     */
    _computeProjection(officeMap) {
      const rooms = Array.isArray(officeMap.rooms) ? officeMap.rooms : [];
      const corridors = Array.isArray(officeMap.corridors) ? officeMap.corridors : [];
      const spaces = [...rooms, ...corridors];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < spaces.length; i++) {
        const s = spaces[i];
        minX = Math.min(minX, s.x);
        minY = Math.min(minY, s.y);
        maxX = Math.max(maxX, s.x + s.width);
        maxY = Math.max(maxY, s.y + s.height);
      }

      if (!Number.isFinite(minX)) {
        minX = 0;
        minY = 0;
        maxX = officeMap.width || 1280;
        maxY = officeMap.height || 800;
      }

      const wallPad = officeMap.wallThickness || 24;
      minX -= wallPad;
      minY -= wallPad;
      maxX += wallPad;
      maxY += wallPad;

      const worldSpanW = Math.max(1, maxX - minX);
      const worldSpanH = Math.max(1, maxY - minY);

      const availW = Math.max(20, this.cssWidth - this.padding * 2);
      const availH = Math.max(20, this.cssHeight - this.padding * 2);
      const scale = Math.min(availW / worldSpanW, availH / worldSpanH);

      const offsetX = (this.cssWidth - worldSpanW * scale) * 0.5 - minX * scale;
      const offsetY = (this.cssHeight - worldSpanH * scale) * 0.5 - minY * scale;

      return {
        scale,
        offsetX,
        offsetY,
        worldToMini(wx, wy) {
          return {
            x: wx * scale + offsetX,
            y: wy * scale + offsetY
          };
        }
      };
    }

    /**
     * 매 프레임 실제 맵·플레이어·적·아이템·보스 데이터를 읽어 미니맵을 갱신
     */
    render(
      officeMap,
      player,
      enemySystem = null,
      itemSystem = null,
      camera = null,
      boss = null,
      escapeDevice = null
    ) {
      if (!this.canvas || !this.ctx || !officeMap || !player) {
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      if (
        rect.width > 20 &&
        rect.height > 20 &&
        (Math.round(rect.width) !== this.cssWidth || Math.round(rect.height) !== this.cssHeight)
      ) {
        this.resize();
      }

      this._pulseTime = performance.now() * 0.0045;
      const proj = this._computeProjection(officeMap);
      const activeSpace =
        typeof officeMap.getSpaceAt === 'function'
          ? officeMap.getSpaceAt(player.position.x, player.position.y)
          : null;

      // 상단 현재 구역 텍스트 실시간 갱신
      const zoneLabel = activeSpace ? activeSpace.name : '탐험 구역';
      if (zoneLabel !== this._lastZoneLabel) {
        this._lastZoneLabel = zoneLabel;
        if (this.zoneTextEl) {
          this.zoneTextEl.textContent = zoneLabel;
        }
      }

      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      // 1. 미니맵 배경 및 미세 격자선
      ctx.fillStyle = '#0a0f1c';
      ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

      ctx.strokeStyle = 'rgba(51, 65, 85, 0.22)';
      ctx.lineWidth = 1;
      const gridStep = 18;
      for (let gx = gridStep; gx < this.cssWidth; gx += gridStep) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, this.cssHeight);
        ctx.stroke();
      }
      for (let gy = gridStep; gy < this.cssHeight; gy += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(this.cssWidth, gy);
        ctx.stroke();
      }

      const corridors = Array.isArray(officeMap.corridors) ? officeMap.corridors : [];
      const rooms = Array.isArray(officeMap.rooms) ? officeMap.rooms : [];
      const doors = Array.isArray(officeMap.doors) ? officeMap.doors : [];
      const obstacles = Array.isArray(officeMap.obstacles) ? officeMap.obstacles : [];

      // 2. 복도(Corridor) 구조 표시
      for (let i = 0; i < corridors.length; i++) {
        const c = corridors[i];
        const isCurrent = Boolean(activeSpace && activeSpace.id === c.id);
        const tl = proj.worldToMini(c.x, c.y);
        const w = c.width * proj.scale;
        const h = c.height * proj.scale;

        ctx.fillStyle = isCurrent ? '#2b4266' : '#1e2940';
        ctx.fillRect(tl.x, tl.y, w, h);

        ctx.strokeStyle = isCurrent ? '#7dd3fc' : '#47597e';
        ctx.lineWidth = isCurrent ? 1.6 : 1.1;
        ctx.strokeRect(tl.x, tl.y, w, h);
      }

      // 3. 방(Room) 구조 및 방 종류·전투 상태(Unvisited / Active / Cleared)별 구분 색상 표시
      const roomStates = [];
      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        const isCurrent = Boolean(activeSpace && activeSpace.id === r.id);
        const roomState = r.state || 'Unvisited';
        const tl = proj.worldToMini(r.x, r.y);
        const w = r.width * proj.scale;
        const h = r.height * proj.scale;

        let fillColor = '#22314d';
        let strokeColor = '#566d99';
        let strokeWidth = isCurrent ? 1.9 : 1.3;

        if (r.type === 'boss') {
          if (roomState === 'Active') {
            fillColor = '#6b1126';
            strokeColor = '#f43f5e';
            strokeWidth = 2.4;
          } else if (roomState === 'Cleared') {
            fillColor = isCurrent ? '#234735' : '#1b3729';
            strokeColor = isCurrent ? '#86efac' : '#4ade80';
          } else {
            // 미방문 보스 방: 어둡고 불길한 심홍/보라색
            fillColor = isCurrent ? '#42163b' : '#2e0f29';
            strokeColor = isCurrent ? '#f472b6' : '#9d226a';
            strokeWidth = 1.7;
          }
        } else if (r.type === 'combat') {
          if (roomState === 'Active') {
            // 전투 진행 중인 방: 별도의 붉은 봉쇄 색상으로 표시
            fillColor = '#5c1d2e';
            strokeColor = '#fb7185';
            strokeWidth = 2.2;
          } else if (roomState === 'Cleared') {
            // 클리어된 전투 방: 구분되는 에메랄드 그린 계열 색상으로 표시
            fillColor = isCurrent ? '#234735' : '#1b3729';
            strokeColor = isCurrent ? '#86efac' : '#4ade80';
          } else {
            // 아직 방문하지 않은 전투 방(Unvisited): 기존 표시 방식 유지
            fillColor = isCurrent ? '#352d54' : '#26223e';
            strokeColor = isCurrent ? '#93c5fd' : '#635b8c';
          }
        } else if (r.type === 'supply') {
          fillColor = isCurrent ? '#1f4547' : '#193538';
          strokeColor = isCurrent ? '#5eead4' : '#3d7a7d';
        } else if (r.type === 'start') {
          fillColor = isCurrent ? '#2a4166' : '#1f304d';
          strokeColor = isCurrent ? '#7dd3fc' : '#526d9c';
        }

        ctx.fillStyle = fillColor;
        ctx.fillRect(tl.x, tl.y, w, h);

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.strokeRect(tl.x, tl.y, w, h);

        roomStates.push({
          id: r.id,
          type: r.type,
          state: roomState,
          fillColor,
          strokeColor
        });
      }

      // 4. 방 내부 장애물(책상·기둥 등) 미니 실루엣 표시
      ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
      for (let i = 0; i < obstacles.length; i++) {
        const obs = obstacles[i];
        const tl = proj.worldToMini(obs.x, obs.y);
        const w = Math.max(1.5, obs.width * proj.scale);
        const h = Math.max(1.5, obs.height * proj.scale);
        ctx.fillRect(tl.x, tl.y, w, h);
      }

      // 5. 방과 복도를 잇는 문(Door) 개구부 표시 (잠긴 문은 붉은 봉쇄 색상으로 표시)
      let lockedDoorCount = 0;
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        const tl = proj.worldToMini(d.x, d.y);
        const w = Math.max(2.2, d.width * proj.scale);
        const h = Math.max(2.2, d.height * proj.scale);

        if (d.locked) {
          lockedDoorCount++;
          ctx.fillStyle = '#f43f5e';
        } else {
          ctx.fillStyle = '#93c5fd';
        }
        ctx.fillRect(tl.x, tl.y, w, h);
      }

      // 6. 현재 화면 카메라 영역 점선 테두리 표시
      if (camera) {
        const camTL = proj.worldToMini(camera.x, camera.y);
        const camW = camera.width * proj.scale;
        const camH = camera.height * proj.scale;
        ctx.save();
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(camTL.x, camTL.y, camW, camH);
        ctx.restore();
      }

      // 맵 크기에 비례하여 마커 반경을 소폭 자동 조절 (대형 10개 방 맵에서도 선명하고 겹치지 않게 유지)
      const markerScale = Math.max(0.82, Math.min(1.05, proj.scale / 0.068));

      // 7. 미획득 보급 아이템(응급 구급상자 / 무기 강화 모듈) 실시간 위치 표시
      const itemMarkers = [];
      if (itemSystem && typeof itemSystem.getActiveItems === 'function') {
        const activeItems = itemSystem.getActiveItems();
        const itemHalf = 3.1 * markerScale;
        for (let i = 0; i < activeItems.length; i++) {
          const item = activeItems[i];
          const mp = proj.worldToMini(item.position.x, item.position.y);
          itemMarkers.push({ id: item.id, category: item.category, x: mp.x, y: mp.y });

          ctx.save();
          ctx.translate(mp.x, mp.y);
          if (item.category === 'heal') {
            // 회복 아이템: 에메랄드 사각 마커
            ctx.fillStyle = '#4ade80';
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.rect(-itemHalf, -itemHalf, itemHalf * 2, itemHalf * 2);
            ctx.fill();
            ctx.stroke();
          } else if (item.category === 'run_buff') {
            // Phase 15: 런 버프 아이템 (수당/운동화/서류철) 마커
            ctx.rotate(Math.PI * 0.25);
            ctx.fillStyle =
              item.typeId === 'overtime_pay'
                ? '#f59e0b'
                : item.typeId === 'overtime_sneakers'
                  ? '#38bdf8'
                  : '#c084fc';
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.rect(-itemHalf, -itemHalf, itemHalf * 2, itemHalf * 2);
            ctx.fill();
            ctx.stroke();
          } else {
            // 무기 강화 모듈: 황금 다이아몬드 마커
            ctx.rotate(Math.PI * 0.25);
            ctx.fillStyle = '#fbbf24';
            ctx.strokeStyle = '#090d16';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.rect(-itemHalf, -itemHalf, itemHalf * 2, itemHalf * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 8. 생존 중인 적 실시간 위치 표시
      const enemyMarkers = [];
      if (enemySystem && typeof enemySystem.getAliveEnemies === 'function') {
        const aliveEnemies = enemySystem.getAliveEnemies();
        const enemyRadius = 3.6 * markerScale;
        for (let i = 0; i < aliveEnemies.length; i++) {
          const enemy = aliveEnemies[i];
          const mp = proj.worldToMini(enemy.position.x, enemy.position.y);
          const isAggro = enemy.state === 'Chase' || enemy.state === 'Attack';
          enemyMarkers.push({ id: enemy.id, state: enemy.state, x: mp.x, y: mp.y });

          if (isAggro) {
            ctx.beginPath();
            ctx.arc(mp.x, mp.y, enemyRadius + 2.4, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(244, 63, 94, 0.34)';
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(mp.x, mp.y, enemyRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#f43f5e';
          ctx.fill();
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = '#090d16';
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(mp.x, mp.y, Math.max(1.0, 1.25 * markerScale), 0, Math.PI * 2);
          ctx.fillStyle = '#ffe4e6';
          ctx.fill();
        }
      }

      // 8-2. Phase 10: 생존 중인 보스(야근 감독관) 전용 대형 마커 표시
      let bossMarker = null;
      if (boss && boss.alive && !boss.isDead()) {
        const bmp = proj.worldToMini(boss.position.x, boss.position.y);
        const bossMarkerR = 5.2 * markerScale;
        bossMarker = { id: boss.id, x: bmp.x, y: bmp.y };

        ctx.save();
        ctx.translate(bmp.x, bmp.y);

        // 보스 외곽 붉은 펄스 링
        const bossPulse = 0.5 + 0.5 * Math.sin(this._pulseTime * 3);
        ctx.beginPath();
        ctx.arc(0, 0, bossMarkerR + 2.5 + bossPulse * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.35)';
        ctx.fill();

        // 보스 본체 원형 마커
        ctx.beginPath();
        ctx.arc(0, 0, bossMarkerR, 0, Math.PI * 2);
        ctx.fillStyle = '#e11d48';
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#090d16';
        ctx.stroke();

        // 보스 중심 골드 다이아몬드 마커
        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.moveTo(0, -bossMarkerR * 0.55);
        ctx.lineTo(bossMarkerR * 0.55, 0);
        ctx.lineTo(0, bossMarkerR * 0.55);
        ctx.lineTo(-bossMarkerR * 0.55, 0);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
      }

      // 8-3. Phase 11: 탈출 장치(비상 탈출 엘리베이터) 마커 표시
      let escapeMarker = null;
      if (escapeDevice) {
        const emp = proj.worldToMini(escapeDevice.position.x, escapeDevice.position.y);
        escapeMarker = {
          x: emp.x,
          y: emp.y,
          isActive: Boolean(escapeDevice.isActive)
        };

        ctx.save();
        ctx.translate(emp.x, emp.y);

        if (escapeDevice.isActive) {
          // 활성화 상태: 에메랄드 그린 빛나는 펄스 별/다이아몬드 마커
          const escPulse = 0.5 + 0.5 * Math.sin(this._pulseTime * 4);
          const escR = 4.8 * markerScale;

          ctx.beginPath();
          ctx.arc(0, 0, escR + 2.0 + escPulse * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(52, 211, 153, 0.42)';
          ctx.fill();

          ctx.fillStyle = '#10b981';
          ctx.strokeStyle = '#022c22';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.rect(-escR, -escR, escR * 2, escR * 2);
          ctx.fill();
          ctx.stroke();

          // 화이트 코어
          ctx.fillStyle = '#ecfdf5';
          ctx.beginPath();
          ctx.arc(0, 0, escR * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // 비활성화 상태: 작은 딤드 스퀘어 마커
          const escR = 3.2 * markerScale;
          ctx.fillStyle = '#64748b';
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.rect(-escR, -escR, escR * 2, escR * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      }

      // 9. 플레이어 현재 위치 표시 (가장 명확하게 구분되는 시안 펄스 링 + 시선 방향 + 화이트 코어)
      const playerMini = proj.worldToMini(player.position.x, player.position.y);
      const pulse = 0.5 + 0.5 * Math.sin(this._pulseTime * 2.2);
      const playerRadius = Math.max(4.1, 4.6 * markerScale);

      ctx.save();
      ctx.translate(playerMini.x, playerMini.y);

      // 외곽 맥동 링
      ctx.beginPath();
      ctx.arc(0, 0, playerRadius + 1.8 + pulse * 2.2, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(56, 189, 248, ${(0.62 - pulse * 0.25).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 바라보는 방향 삼각 포인터
      if (!player.isDead && player.direction) {
        ctx.save();
        ctx.rotate(player.direction.angle || 0);
        ctx.beginPath();
        ctx.moveTo(playerRadius + 3.6, 0);
        ctx.lineTo(playerRadius - 1.2, -3.0);
        ctx.lineTo(playerRadius - 1.2, 3.0);
        ctx.closePath();
        ctx.fillStyle = '#38bdf8';
        ctx.fill();
        ctx.restore();
      }

      // 중심 이중 마커 (시안 링 + 화이트 중심점)
      ctx.beginPath();
      ctx.arc(0, 0, playerRadius, 0, Math.PI * 2);
      ctx.fillStyle = player.isDead ? '#94a3b8' : '#38bdf8';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#090d16';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1.7, 2.0 * markerScale), 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      ctx.restore();
      ctx.restore();

      // 최신 투영 결과 기록
      this.lastRenderState = {
        mapSeed: officeMap.seed ?? null,
        activeSpaceId: activeSpace ? activeSpace.id : null,
        activeSpaceName: zoneLabel,
        roomCount: rooms.length,
        corridorCount: corridors.length,
        doorCount: doors.length,
        lockedDoorCount,
        roomStates,
        playerMiniPos: { x: playerMini.x, y: playerMini.y },
        playerWorldPos: { x: player.position.x, y: player.position.y },
        enemyMarkers,
        bossMarker,
        escapeMarker,
        itemMarkers
      };
    }
  }

  PO.Minimap = Minimap;
})(window);
