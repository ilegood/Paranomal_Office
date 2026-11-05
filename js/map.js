(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 방 종류 상수 정의 (추후 랜덤 방 생성·연결 확장 시 재사용)
   */
  const ROOM_TYPES = Object.freeze({
    START: 'start',
    COMBAT: 'combat',
    SUPPLY: 'supply',
    BOSS: 'boss'
  });

  /**
   * Phase 9: 각 방의 방문 및 전투 진행 상태 상수 정의
   */
  const ROOM_STATES = Object.freeze({
    UNVISITED: 'Unvisited',
    ACTIVE: 'Active',
    CLEARED: 'Cleared'
  });

  /**
   * Phase 7 고정 탐험 맵 레이아웃 데이터 (렌더링 코드와 완전히 분리)
   * - 시작 방 1개, 전투 방 2개, 보급 방 1개
   * - 방 사이를 연결하는 복도 3개 및 통과 가능한 문 6개
   * - 추후 방 연결 그래프 기반 랜덤 생성기로 교체할 수 있도록 공간/연결/배치 데이터를 구조화
   */
  const FIXED_OFFICE_LAYOUT = Object.freeze({
    worldWidth: 2480,
    worldHeight: 1320,
    wallThickness: 24,
    tileWidth: 64,
    tileHeight: 48,

    // 전체 이동 가능 영역을 감싸는 월드 외곽 바운딩 영역
    floorBounds: Object.freeze({
      x: 80,
      y: 80,
      width: 2320,
      height: 1170
    }),

    // 1. 개별 방(Room) 데이터: 위치, 크기, 종류, 연결 복도, 테마 및 북쪽 벽 장식 정보
    rooms: Object.freeze([
      {
        id: 'room-start',
        name: '시작 방',
        subtitle: '당직 대기실',
        type: ROOM_TYPES.START,
        x: 140,
        y: 690,
        width: 520,
        height: 440,
        connections: ['corridor-west'],
        floorPalette: { primary: '#1e2639', secondary: '#1a2132' },
        lightGlows: [
          { x: 290, y: 740, radius: 135, color: 'rgba(90, 140, 230, 0.10)' },
          { x: 275, y: 775, radius: 125, color: 'rgba(255, 200, 110, 0.09)' },
          { x: 400, y: 910, radius: 150, color: 'rgba(148, 163, 184, 0.05)' }
        ],
        wallDecor: [
          { kind: 'window', offsetX: 68, width: 180, showMoon: false },
          { kind: 'clock', offsetX: 292 },
          { kind: 'whiteboard', offsetX: 348, width: 96 }
        ]
      },
      {
        id: 'room-combat-1',
        name: '전투 방 1',
        subtitle: '일반 업무 구역',
        type: ROOM_TYPES.COMBAT,
        x: 860,
        y: 660,
        width: 680,
        height: 500,
        connections: ['corridor-west', 'corridor-north', 'corridor-east'],
        floorPalette: { primary: '#1d2438', secondary: '#191f31' },
        lightGlows: [
          { x: 985, y: 715, radius: 135, color: 'rgba(90, 140, 230, 0.09)' },
          { x: 1410, y: 755, radius: 130, color: 'rgba(255, 200, 110, 0.09)' },
          { x: 1000, y: 1055, radius: 125, color: 'rgba(255, 200, 110, 0.08)' },
          { x: 1200, y: 910, radius: 165, color: 'rgba(244, 63, 94, 0.05)' }
        ],
        wallDecor: [
          { kind: 'window', offsetX: 52, width: 175, showMoon: false },
          { kind: 'whiteboard', offsetX: 448, width: 96 },
          { kind: 'clock', offsetX: 586 }
        ]
      },
      {
        id: 'room-supply',
        name: '보급 방',
        subtitle: '비품·의무 보관실',
        type: ROOM_TYPES.SUPPLY,
        x: 960,
        y: 140,
        width: 480,
        height: 320,
        connections: ['corridor-north'],
        floorPalette: { primary: '#1b2838', secondary: '#172230' },
        lightGlows: [
          { x: 1200, y: 295, radius: 160, color: 'rgba(74, 222, 128, 0.09)' },
          { x: 1090, y: 305, radius: 95, color: 'rgba(74, 222, 128, 0.08)' },
          { x: 1310, y: 305, radius: 95, color: 'rgba(251, 191, 36, 0.08)' }
        ],
        wallDecor: [
          { kind: 'supply_sign', offsetX: 196, width: 88 },
          { kind: 'whiteboard', offsetX: 72, width: 92 },
          { kind: 'clock', offsetX: 330 }
        ]
      },
      {
        id: 'room-combat-2',
        name: '전투 방 2',
        subtitle: '임원 회의실',
        type: ROOM_TYPES.COMBAT,
        x: 1740,
        y: 610,
        width: 600,
        height: 580,
        connections: ['corridor-east'],
        floorPalette: { primary: '#20253a', secondary: '#1b2032' },
        lightGlows: [
          { x: 2045, y: 695, radius: 155, color: 'rgba(255, 200, 110, 0.10)' },
          { x: 1900, y: 660, radius: 145, color: 'rgba(90, 140, 230, 0.10)' },
          { x: 2045, y: 910, radius: 170, color: 'rgba(244, 63, 94, 0.05)' }
        ],
        wallDecor: [
          { kind: 'window', offsetX: 68, width: 210, showMoon: true },
          { kind: 'locked_door', offsetX: 318, width: 92 },
          { kind: 'whiteboard', offsetX: 446, width: 96 }
        ]
      }
    ]),

    // 2. 개별 복도(Corridor) 데이터: 위치, 크기, 양 끝 연결 방 ID
    corridors: Object.freeze([
      {
        id: 'corridor-west',
        name: '서쪽 복도',
        x: 660,
        y: 840,
        width: 200,
        height: 140,
        orientation: 'horizontal',
        fromRoomId: 'room-start',
        toRoomId: 'room-combat-1',
        floorPalette: { primary: '#171e2f', secondary: '#141a29' }
      },
      {
        id: 'corridor-north',
        name: '북쪽 복도',
        x: 1130,
        y: 460,
        width: 140,
        height: 200,
        orientation: 'vertical',
        fromRoomId: 'room-supply',
        toRoomId: 'room-combat-1',
        floorPalette: { primary: '#171e2f', secondary: '#141a29' }
      },
      {
        id: 'corridor-east',
        name: '동쪽 복도',
        x: 1540,
        y: 840,
        width: 200,
        height: 140,
        orientation: 'horizontal',
        fromRoomId: 'room-combat-1',
        toRoomId: 'room-combat-2',
        floorPalette: { primary: '#171e2f', secondary: '#141a29' }
      }
    ]),

    // 3. 방과 복도를 구분하며 통과 가능한 문(Door) 데이터
    doors: Object.freeze([
      {
        id: 'door-start-east',
        orientation: 'vertical',
        x: 652,
        y: 840,
        width: 16,
        height: 140,
        roomId: 'room-start',
        corridorId: 'corridor-west',
        passable: true
      },
      {
        id: 'door-combat1-west',
        orientation: 'vertical',
        x: 852,
        y: 840,
        width: 16,
        height: 140,
        roomId: 'room-combat-1',
        corridorId: 'corridor-west',
        passable: true
      },
      {
        id: 'door-combat1-north',
        orientation: 'horizontal',
        x: 1130,
        y: 652,
        width: 140,
        height: 16,
        roomId: 'room-combat-1',
        corridorId: 'corridor-north',
        passable: true
      },
      {
        id: 'door-supply-south',
        orientation: 'horizontal',
        x: 1130,
        y: 452,
        width: 140,
        height: 16,
        roomId: 'room-supply',
        corridorId: 'corridor-north',
        passable: true
      },
      {
        id: 'door-combat1-east',
        orientation: 'vertical',
        x: 1532,
        y: 840,
        width: 16,
        height: 140,
        roomId: 'room-combat-1',
        corridorId: 'corridor-east',
        passable: true
      },
      {
        id: 'door-combat2-west',
        orientation: 'vertical',
        x: 1732,
        y: 840,
        width: 16,
        height: 140,
        roomId: 'room-combat-2',
        corridorId: 'corridor-east',
        passable: true
      }
    ]),

    // 4. 바닥 러그/매트 장식 (비충돌)
    floorMats: Object.freeze([
      // 시작 방 매트
      { roomId: 'room-start', x: 310, y: 855, width: 170, height: 110, color: '#222b42', border: '#334061' },
      { roomId: 'room-start', x: 586, y: 865, width: 58, height: 90, color: '#25314d', border: '#3b4d75' },
      // 서쪽 복도 러너
      { roomId: 'corridor-west', x: 676, y: 882, width: 168, height: 56, color: '#1f2940', border: '#2f3e5e' },
      // 전투 방 1 중앙 러그
      { roomId: 'room-combat-1', x: 1085, y: 845, width: 230, height: 130, color: '#1f263b', border: '#313c5c' },
      // 북쪽 복도 러너
      { roomId: 'corridor-north', x: 1172, y: 476, width: 56, height: 168, color: '#1f2940', border: '#2f3e5e' },
      // 보급 방 의무/보급 구역 매트
      { roomId: 'room-supply', x: 1040, y: 255, width: 320, height: 110, color: '#1b3137', border: '#2d5459' },
      // 동쪽 복도 러너
      { roomId: 'corridor-east', x: 1556, y: 882, width: 168, height: 56, color: '#1f2940', border: '#2f3e5e' },
      // 전투 방 2 임원실 대형 러그
      { roomId: 'room-combat-2', x: 1915, y: 820, width: 260, height: 175, color: '#26233d', border: '#3d3761' }
    ]),

    // 5. 방별 내부 고정 장애물 데이터 (벽·출입 통로·스폰 좌표와 겹치지 않도록 배치)
    obstacles: Object.freeze([
      // --- 시작 방 (당직 대기실: 책상 1, 캐비닛 1, 복합기 1) ---
      {
        id: 'desk-start-nw',
        roomId: 'room-start',
        type: 'desk',
        x: 188,
        y: 744,
        width: 165,
        height: 54,
        zHeight: 32,
        monitorAlign: 'left',
        hasLamp: true,
        solid: true
      },
      {
        id: 'copier-start-ne',
        roomId: 'room-start',
        type: 'copier',
        x: 522,
        y: 722,
        width: 92,
        height: 48,
        zHeight: 46,
        solid: true
      },
      {
        id: 'cabinet-start-sw',
        roomId: 'room-start',
        type: 'cabinet',
        x: 172,
        y: 1038,
        width: 86,
        height: 46,
        zHeight: 58,
        solid: true
      },

      // --- 전투 방 1 (일반 업무 구역: 4코너 업무 책상·기둥·캐비닛, 십자 중앙 통로 확보) ---
      {
        id: 'desk-c1-nw',
        roomId: 'room-combat-1',
        type: 'desk',
        x: 920,
        y: 726,
        width: 165,
        height: 54,
        zHeight: 32,
        monitorAlign: 'left',
        hasMug: true,
        solid: true
      },
      {
        id: 'desk-c1-ne',
        roomId: 'room-combat-1',
        type: 'desk',
        x: 1315,
        y: 726,
        width: 165,
        height: 54,
        zHeight: 32,
        monitorAlign: 'right',
        hasLamp: true,
        solid: true
      },
      {
        id: 'desk-c1-sw',
        roomId: 'room-combat-1',
        type: 'desk',
        x: 920,
        y: 1042,
        width: 165,
        height: 54,
        zHeight: 32,
        monitorAlign: 'right',
        hasLamp: true,
        solid: true
      },
      {
        id: 'pillar-c1-se',
        roomId: 'room-combat-1',
        type: 'pillar',
        x: 1330,
        y: 1042,
        width: 48,
        height: 42,
        zHeight: 78,
        solid: true
      },
      {
        id: 'cabinet-c1-se',
        roomId: 'room-combat-1',
        type: 'cabinet',
        x: 1415,
        y: 1042,
        width: 86,
        height: 46,
        zHeight: 58,
        solid: true
      },

      // --- 보급 방 (비품·의무 보관실: 좌우 보관 캐비닛과 정수/복합 설비) ---
      {
        id: 'cabinet-supply-nw',
        roomId: 'room-supply',
        type: 'cabinet',
        x: 992,
        y: 174,
        width: 86,
        height: 46,
        zHeight: 58,
        solid: true
      },
      {
        id: 'copier-supply-ne',
        roomId: 'room-supply',
        type: 'copier',
        x: 1318,
        y: 174,
        width: 92,
        height: 48,
        zHeight: 46,
        solid: true
      },

      // --- 전투 방 2 (임원 회의실: 상단 임원 책상, 하단 대형 회의 테이블, 좌측 기둥 2개, 우측 캐비닛) ---
      {
        id: 'desk-c2-manager',
        roomId: 'room-combat-2',
        type: 'manager_desk',
        x: 1950,
        y: 682,
        width: 190,
        height: 58,
        zHeight: 34,
        hasLamp: true,
        solid: true
      },
      {
        id: 'pillar-c2-nw',
        roomId: 'room-combat-2',
        type: 'pillar',
        x: 1815,
        y: 738,
        width: 48,
        height: 42,
        zHeight: 78,
        solid: true
      },
      {
        id: 'pillar-c2-sw',
        roomId: 'room-combat-2',
        type: 'pillar',
        x: 1815,
        y: 1036,
        width: 48,
        height: 42,
        zHeight: 78,
        solid: true
      },
      {
        id: 'table-c2-meeting',
        roomId: 'room-combat-2',
        type: 'meeting_table',
        x: 1925,
        y: 1062,
        width: 240,
        height: 62,
        zHeight: 30,
        solid: true
      },
      {
        id: 'cabinet-c2-east',
        roomId: 'room-combat-2',
        type: 'cabinet',
        x: 2224,
        y: 886,
        width: 86,
        height: 46,
        zHeight: 58,
        solid: true
      }
    ]),

    // 6. 엔티티 초기 배치 데이터 (시작 방: 플레이어 / 전투 방 1·2: 기존 적 / 보급 방: 회복·무기강화 아이템)
    playerSpawn: Object.freeze({
      roomId: 'room-start',
      x: 370,
      y: 910
    }),

    enemySpawns: Object.freeze([
      {
        id: 'enemy-combat-1',
        roomId: 'room-combat-1',
        x: 1200,
        y: 910
      },
      {
        id: 'enemy-combat-2',
        roomId: 'room-combat-2',
        x: 2055,
        y: 910
      }
    ]),

    itemSpawns: Object.freeze([
      {
        id: 'item-medkit-1',
        roomId: 'room-supply',
        configId: 'medkit',
        x: 1095,
        y: 310,
        initialPhase: 0
      },
      {
        id: 'item-upgrade-1',
        roomId: 'room-supply',
        configId: 'weapon_upgrade_module',
        x: 1305,
        y: 310,
        initialPhase: 1.4
      }
    ]),

    targetSpawns: Object.freeze([
      {
        id: 'target-start-dummy',
        roomId: 'room-start',
        x: 525,
        y: 1045
      }
    ]),

    testHazardSpawn: Object.freeze({
      roomId: 'room-start',
      x: 330,
      y: 1055,
      radius: 32
    })
  });

  /**
   * 다중 방(시작/전투/보급) 및 복도 구조의 사무실 탐험 맵 데이터 클래스
   * 방·복도·벽·문·장애물 데이터를 개별 관리하며, 충돌 및 미니맵 조회용 인터페이스를 제공한다.
   */
  class OfficeMap {
    constructor(layoutConfig = FIXED_OFFICE_LAYOUT) {
      this.seed = layoutConfig.seed ?? 'fixed-default';
      this.isRandomGenerated = Boolean(layoutConfig.isRandomGenerated);

      this.width = layoutConfig.worldWidth;
      this.height = layoutConfig.worldHeight;
      this.wallThickness = layoutConfig.wallThickness ?? 24;
      this.tileWidth = layoutConfig.tileWidth ?? 64;
      this.tileHeight = layoutConfig.tileHeight ?? 48;

      // 월드 전체 바닥 바운딩 영역 (기존 경계 계산 호환 유지)
      this.floorRect = { ...layoutConfig.floorBounds };

      // 개별 공간 데이터 복제 (방, 복도, 문, 바닥 매트, 내부 장애물)
      this.rooms = layoutConfig.rooms.map((room) => ({
        ...room,
        kind: 'room',
        state: room.state ?? ROOM_STATES.UNVISITED,
        totalEnemies: 0,
        remainingEnemies: 0,
        enemyIds: [],
        connections: [...(room.connections || [])],
        floorPalette: { ...room.floorPalette },
        lightGlows: (room.lightGlows || []).map((g) => ({ ...g })),
        wallDecor: (room.wallDecor || []).map((d) => ({ ...d }))
      }));

      this.corridors = layoutConfig.corridors.map((corridor) => ({
        ...corridor,
        kind: 'corridor',
        floorPalette: { ...corridor.floorPalette }
      }));

      this.doors = layoutConfig.doors.map((door) => {
        const locked = Boolean(door.locked);
        return {
          ...door,
          locked,
          passable: locked ? false : door.passable !== false,
          solid: locked,
          isLockedDoor: true,
          zHeight: door.zHeight ?? 36
        };
      });
      this.floorMats = layoutConfig.floorMats.map((mat) => ({ ...mat }));
      this.obstacles = layoutConfig.obstacles.map((obs) => ({ ...obs }));

      // 스폰 데이터 분리 보관
      this.spawnPoint = {
        x: layoutConfig.playerSpawn.x,
        y: layoutConfig.playerSpawn.y,
        roomId: layoutConfig.playerSpawn.roomId
      };
      this.enemySpawns = layoutConfig.enemySpawns.map((s) => ({ ...s }));
      this.bossSpawn = layoutConfig.bossSpawn ? { ...layoutConfig.bossSpawn } : null;
      this.itemSpawns = layoutConfig.itemSpawns.map((s) => ({ ...s }));
      this.targetSpawns = layoutConfig.targetSpawns.map((s) => ({ ...s }));
      this.testHazardSpawn = layoutConfig.testHazardSpawn
        ? { ...layoutConfig.testHazardSpawn }
        : null;

      // 방과 복도 외곽 경계에서 연결된 문/통로 구간을 제외한 실제 고체 벽(Wall) 목록 생성
      this.walls = this._buildWallsFromSpaces();

      // 고체 충돌체 캐시 (벽 + 고체 가구/기둥 장애물 + 현재 잠긴 출입문)
      this._lockedDoorColliders = [];
      this._solidColliders = [];
      this._wallsAndLockedDoors = [];
      this._rebuildSolidColliders();
    }

    /**
     * 벽, 내부 고정 장애물, 현재 잠긴 출입문(door.locked === true)을 실제 충돌 배열에 동기화
     */
    _rebuildSolidColliders() {
      this._lockedDoorColliders = this.doors.filter((door) => door.locked && !door.passable);
      this._solidColliders = [
        ...this.walls,
        ...this.obstacles.filter((obs) => obs.solid !== false),
        ...this._lockedDoorColliders
      ];
      this._wallsAndLockedDoors = [...this.walls, ...this._lockedDoorColliders];
    }

    /**
     * 방과 복도의 각 변을 검사하여 인접 공간과 맞닿은 개구부(문/복도 통로)만 열어두고
     * 나머지 모든 외벽·격벽 구간에 고체 벽(Wall) 세그먼트를 생성한다.
     */
    _buildWallsFromSpaces() {
      const T = this.wallThickness;
      const allSpaces = [...this.rooms, ...this.corridors];
      const walls = [];
      let wallSeq = 1;

      for (let i = 0; i < allSpaces.length; i++) {
        const space = allSpaces[i];
        const sx = space.x;
        const sy = space.y;
        const sw = space.width;
        const sh = space.height;
        const sx2 = sx + sw;
        const sy2 = sy + sh;

        // 1. 북쪽 변 (y = sy)
        const northOpenings = [];
        for (let j = 0; j < allSpaces.length; j++) {
          if (i === j) continue;
          const other = allSpaces[j];
          if (Math.abs(other.y + other.height - sy) < 0.5) {
            const oStart = Math.max(sx, other.x);
            const oEnd = Math.min(sx2, other.x + other.width);
            if (oEnd > oStart) {
              northOpenings.push([oStart, oEnd]);
            }
          }
        }
        const northSegments = this._subtractIntervals(sx, sx2, northOpenings);
        for (let k = 0; k < northSegments.length; k++) {
          const [segStart, segEnd] = northSegments[k];
          walls.push({
            id: `wall-${wallSeq++}`,
            type: 'wall',
            isWall: true,
            side: 'north',
            spaceId: space.id,
            spaceKind: space.kind,
            x: segStart,
            y: sy - T,
            width: segEnd - segStart,
            height: T,
            zHeight: space.kind === 'room' ? 58 : 38,
            solid: true
          });
        }

        // 2. 남쪽 변 (y = sy2)
        const southOpenings = [];
        for (let j = 0; j < allSpaces.length; j++) {
          if (i === j) continue;
          const other = allSpaces[j];
          if (Math.abs(other.y - sy2) < 0.5) {
            const oStart = Math.max(sx, other.x);
            const oEnd = Math.min(sx2, other.x + other.width);
            if (oEnd > oStart) {
              southOpenings.push([oStart, oEnd]);
            }
          }
        }
        const southSegments = this._subtractIntervals(sx, sx2, southOpenings);
        for (let k = 0; k < southSegments.length; k++) {
          const [segStart, segEnd] = southSegments[k];
          walls.push({
            id: `wall-${wallSeq++}`,
            type: 'wall',
            isWall: true,
            side: 'south',
            spaceId: space.id,
            spaceKind: space.kind,
            x: segStart,
            y: sy2,
            width: segEnd - segStart,
            height: T,
            zHeight: 22,
            solid: true
          });
        }

        // 3. 서쪽 변 (x = sx)
        const westOpenings = [];
        for (let j = 0; j < allSpaces.length; j++) {
          if (i === j) continue;
          const other = allSpaces[j];
          if (Math.abs(other.x + other.width - sx) < 0.5) {
            const oStart = Math.max(sy, other.y);
            const oEnd = Math.min(sy2, other.y + other.height);
            if (oEnd > oStart) {
              westOpenings.push([oStart, oEnd]);
            }
          }
        }
        const westSegments = this._subtractIntervals(sy, sy2, westOpenings);
        for (let k = 0; k < westSegments.length; k++) {
          const [segStart, segEnd] = westSegments[k];
          walls.push({
            id: `wall-${wallSeq++}`,
            type: 'wall',
            isWall: true,
            side: 'west',
            spaceId: space.id,
            spaceKind: space.kind,
            x: sx - T,
            y: segStart,
            width: T,
            height: segEnd - segStart,
            zHeight: 22,
            solid: true
          });
        }

        // 4. 동쪽 변 (x = sx2)
        const eastOpenings = [];
        for (let j = 0; j < allSpaces.length; j++) {
          if (i === j) continue;
          const other = allSpaces[j];
          if (Math.abs(other.x - sx2) < 0.5) {
            const oStart = Math.max(sy, other.y);
            const oEnd = Math.min(sy2, other.y + other.height);
            if (oEnd > oStart) {
              eastOpenings.push([oStart, oEnd]);
            }
          }
        }
        const eastSegments = this._subtractIntervals(sy, sy2, eastOpenings);
        for (let k = 0; k < eastSegments.length; k++) {
          const [segStart, segEnd] = eastSegments[k];
          walls.push({
            id: `wall-${wallSeq++}`,
            type: 'wall',
            isWall: true,
            side: 'east',
            spaceId: space.id,
            spaceKind: space.kind,
            x: sx2,
            y: segStart,
            width: T,
            height: segEnd - segStart,
            zHeight: 22,
            solid: true
          });
        }

        // 5. 바깥쪽 모서리 캡 (대각선 대시 시 모서리 틈새 완전 차단)
        const cornerCandidates = [
          { x: sx - T, y: sy - T, width: T, height: T, side: 'corner' },
          { x: sx2, y: sy - T, width: T, height: T, side: 'corner' },
          { x: sx - T, y: sy2, width: T, height: T, side: 'corner' },
          { x: sx2, y: sy2, width: T, height: T, side: 'corner' }
        ];

        for (let c = 0; c < cornerCandidates.length; c++) {
          const cap = cornerCandidates[c];
          if (this._rectOverlapsAny(cap, allSpaces)) {
            continue;
          }
          if (this._rectOverlapsAny(cap, walls)) {
            continue;
          }
          walls.push({
            id: `wall-${wallSeq++}`,
            type: 'wall',
            isWall: true,
            side: 'corner',
            spaceId: space.id,
            spaceKind: space.kind,
            x: cap.x,
            y: cap.y,
            width: cap.width,
            height: cap.height,
            zHeight: 22,
            solid: true
          });
        }
      }

      return walls;
    }

    /**
     * [rangeStart, rangeEnd] 구간에서 열린 구간(openings)들을 제외한 닫힌 벽 구간 배열 반환
     */
    _subtractIntervals(rangeStart, rangeEnd, openings) {
      if (!openings || openings.length === 0) {
        return [[rangeStart, rangeEnd]];
      }

      const sorted = openings
        .slice()
        .sort((a, b) => a[0] - b[0]);

      const merged = [sorted[0].slice()];
      for (let i = 1; i < sorted.length; i++) {
        const cur = sorted[i];
        const last = merged[merged.length - 1];
        if (cur[0] <= last[1] + 0.5) {
          last[1] = Math.max(last[1], cur[1]);
        } else {
          merged.push(cur.slice());
        }
      }

      const result = [];
      let cursor = rangeStart;
      for (let i = 0; i < merged.length; i++) {
        const [oStart, oEnd] = merged[i];
        if (oStart > cursor + 0.5) {
          result.push([cursor, oStart]);
        }
        cursor = Math.max(cursor, oEnd);
      }
      if (cursor < rangeEnd - 0.5) {
        result.push([cursor, rangeEnd]);
      }

      return result;
    }

    _rectOverlapsAny(rect, list) {
      for (let i = 0; i < list.length; i++) {
        const other = list[i];
        if (
          rect.x < other.x + other.width - 0.5 &&
          rect.x + rect.width > other.x + 0.5 &&
          rect.y < other.y + other.height - 0.5 &&
          rect.y + rect.height > other.y + 0.5
        ) {
          return true;
        }
      }
      return false;
    }

    /**
     * 엔티티의 바닥 충돌 반경(radius)을 고려한 월드 외곽 이동 경계 반환
     */
    getPlayableBounds(radius = 0) {
      return {
        minX: this.floorRect.x + radius,
        maxX: this.floorRect.x + this.floorRect.width - radius,
        minY: this.floorRect.y + radius,
        maxY: this.floorRect.y + this.floorRect.height - radius
      };
    }

    /**
     * 충돌 판정 대상 고체 장애물 목록(모든 방·복도 벽 + 책상·기둥·캐비닛 + 잠긴 출입문) 반환
     * 열린 문(passable: true, locked: false)은 제외되며, 잠긴 문은 즉시 실제 물리 충돌체로 작동한다.
     */
    getSolidObstacles() {
      return this._solidColliders;
    }

    /**
     * 벽(Wall) 세그먼트 및 잠긴 출입문 목록 반환 (시야 차폐 판정 등에 활용)
     */
    getWalls() {
      return this._wallsAndLockedDoors;
    }

    /**
     * 특정 방 ID로 방 데이터 조회
     */
    getRoomById(roomId) {
      for (let i = 0; i < this.rooms.length; i++) {
        if (this.rooms[i].id === roomId) {
          return this.rooms[i];
        }
      }
      return null;
    }

    /**
     * 특정 방에 연결된 모든 출입문(Door) 목록 반환
     */
    getDoorsForRoom(roomId) {
      return this.doors.filter((door) => door.roomId === roomId);
    }

    /**
     * 특정 방의 모든 출입문 잠금/해제 상태를 변경하고 실제 충돌 데이터를 즉시 갱신
     */
    setRoomDoorsLocked(roomId, locked) {
      const shouldLock = Boolean(locked);
      let changed = false;

      for (let i = 0; i < this.doors.length; i++) {
        const door = this.doors[i];
        if (door.roomId !== roomId) {
          continue;
        }
        if (door.locked !== shouldLock || door.passable === shouldLock) {
          door.locked = shouldLock;
          door.passable = !shouldLock;
          door.solid = shouldLock;
          changed = true;
        }
      }

      if (changed) {
        this._rebuildSolidColliders();
      }
      return changed;
    }

    /**
     * 맵 내 모든 출입문의 잠금을 해제하고 실제 충돌 데이터를 초기화
     */
    unlockAllDoors() {
      let changed = false;
      for (let i = 0; i < this.doors.length; i++) {
        const door = this.doors[i];
        if (door.locked || !door.passable) {
          door.locked = false;
          door.passable = true;
          door.solid = false;
          changed = true;
        }
      }
      if (changed) {
        this._rebuildSolidColliders();
      }
    }

    /**
     * 주어진 월드 좌표가 속한 방(Room) 반환 (방 내부가 아니면 null)
     */
    getRoomAt(x, y) {
      for (let i = 0; i < this.rooms.length; i++) {
        const r = this.rooms[i];
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
          return r;
        }
      }
      return null;
    }

    /**
     * 주어진 월드 좌표가 속한 복도(Corridor) 반환 (복도 내부가 아니면 null)
     */
    getCorridorAt(x, y) {
      for (let i = 0; i < this.corridors.length; i++) {
        const c = this.corridors[i];
        if (x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height) {
          return c;
        }
      }
      return null;
    }

    /**
     * 주어진 월드 좌표가 속한 공간(방 우선, 없으면 복도) 반환
     */
    getSpaceAt(x, y) {
      return this.getRoomAt(x, y) || this.getCorridorAt(x, y);
    }

    /**
     * 원형 엔티티 중심 좌표가 실제 이동 가능한 방 또는 복도 바닥 내부인지 확인
     */
    isInsideWalkableArea(x, y, margin = 0) {
      for (let i = 0; i < this.rooms.length; i++) {
        const r = this.rooms[i];
        if (
          x >= r.x - 1 &&
          x <= r.x + r.width + 1 &&
          y >= r.y - 1 &&
          y <= r.y + r.height + 1
        ) {
          return margin <= 0 || !this._circleHitsWalls(x, y, margin);
        }
      }
      for (let i = 0; i < this.corridors.length; i++) {
        const c = this.corridors[i];
        if (
          x >= c.x - 1 &&
          x <= c.x + c.width + 1 &&
          y >= c.y - 1 &&
          y <= c.y + c.height + 1
        ) {
          return margin <= 0 || !this._circleHitsWalls(x, y, margin);
        }
      }
      return false;
    }

    _circleHitsWalls(cx, cy, radius) {
      const rSq = radius * radius;
      for (let i = 0; i < this.walls.length; i++) {
        const w = this.walls[i];
        const kx = Math.max(w.x, Math.min(cx, w.x + w.width));
        const ky = Math.max(w.y, Math.min(cy, w.y + w.height));
        const dx = cx - kx;
        const dy = cy - ky;
        if (dx * dx + dy * dy < rSq) {
          return true;
        }
      }
      return false;
    }

    /**
     * 시작 방을 기준으로 복도를 통해 도달 가능한 모든 방의 연결 그래프 정보 반환
     */
    getConnectivityInfo() {
      const startRoom =
        this.rooms.find((r) => r.type === ROOM_TYPES.START) || this.rooms[0] || null;
      if (!startRoom) {
        return {
          startRoomId: null,
          totalRooms: 0,
          reachableRoomIds: [],
          reachableCount: 0,
          isFullyConnected: false
        };
      }

      const adj = new Map();
      for (let i = 0; i < this.rooms.length; i++) {
        adj.set(this.rooms[i].id, new Set());
      }
      for (let i = 0; i < this.corridors.length; i++) {
        const c = this.corridors[i];
        if (adj.has(c.fromRoomId) && adj.has(c.toRoomId)) {
          adj.get(c.fromRoomId).add(c.toRoomId);
          adj.get(c.toRoomId).add(c.fromRoomId);
        }
      }

      const visited = new Set([startRoom.id]);
      const queue = [startRoom.id];
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const nxt of adj.get(cur) || []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }

      return {
        startRoomId: startRoom.id,
        totalRooms: this.rooms.length,
        reachableRoomIds: Array.from(visited),
        reachableCount: visited.size,
        isFullyConnected: visited.size === this.rooms.length
      };
    }

    /**
     * 랜덤 맵 생성기(RandomMapGenerator)를 통해 새로운 OfficeMap 인스턴스를 생성 (실패 시 안전 폴백)
     */
    static createRandom(options = {}) {
      if (PO.RandomMapGenerator && typeof PO.RandomMapGenerator.generate === 'function') {
        const layout = PO.RandomMapGenerator.generate(options);
        return new OfficeMap(layout);
      }
      return new OfficeMap(FIXED_OFFICE_LAYOUT);
    }
  }

  PO.ROOM_TYPES = ROOM_TYPES;
  PO.ROOM_STATES = ROOM_STATES;
  PO.FIXED_OFFICE_LAYOUT = FIXED_OFFICE_LAYOUT;
  PO.OfficeMap = OfficeMap;
})(window);
