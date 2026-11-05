(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * Phase 8 랜덤 맵 생성 기본 설정값 (별도 상수 객체로 분리 관리)
   */
  const RANDOM_MAP_CONFIG = Object.freeze({
    // 방 개수 범위 (6 ~ 10개)
    minRooms: 6,
    maxRooms: 10,

    // 방 종류별 기본 배정 수
    startRoomCount: 1,
    minSupplyRooms: 1,
    maxSupplyRooms: 2,
    extraSupplyRoomThreshold: 8, // 총 방 개수가 8개 이상일 때 추가 보급 방 생성 가능
    extraSupplyRoomChance: 0.55,

    // 방 최소 / 최대 크기 (이동·대시·전투 공간 및 쿼터뷰 화면 비율에 적합한 크기)
    minRoomWidth: 440,
    maxRoomWidth: 640,
    minRoomHeight: 340,
    maxRoomHeight: 500,
    sizeStep: 16,

    // 복도 및 벽 두께 수치
    corridorWidth: 140,
    wallThickness: 24,
    doorDepth: 16,

    // 안정적인 비겹침 배치 및 복도 정렬을 위한 매크로 그리드 간격·지터 설정
    gridCols: 4,
    gridRows: 4,
    cellPitchX: 880,
    cellPitchY: 740,
    maxJitterX: 52,
    maxJitterY: 42,
    worldPadding: 140,

    // 스패닝 트리 외 추가 순환 복도 생성 확률
    extraCorridorChance: 0.35,
    maxExtraCorridors: 2,

    // 시작 방 안전 반경 및 내부 통로 확보 수치
    playerSafeRadius: 115,
    aisleHalfWidth: 76, // 문에서 방 중심까지 최소 152px 폭의 무장애 통로 보장
    doorKeepoutPadding: 96,
    obstacleWallMargin: 34,
    obstacleGap: 48,

    // 전투 방 적 배치 설정 (맵 크기 및 전투 방 면적에 비례)
    minEnemiesPerCombatRoom: 1,
    maxEnemiesPerCombatRoom: 2,
    largeCombatRoomArea: 245000,
    secondEnemyChanceInLargeRoom: 0.55,
    minEnemyDistFromPlayer: 320,
    minEnemySeparation: 88,

    // 안전 재생성 최대 시도 횟수
    maxGenerationAttempts: 16
  });

  /**
   * 시드(문자열 또는 숫자) 기반 결정론적 의사 난수 생성기 (동일 시드 -> 동일 맵 100% 재현)
   */
  class SeededRandom {
    constructor(seedInput) {
      this.seedString =
        seedInput !== undefined && seedInput !== null && String(seedInput).trim() !== ''
          ? String(seedInput).trim()
          : SeededRandom.createRandomSeedString();
      this._state = SeededRandom.hashSeed(this.seedString);
    }

    static createRandomSeedString() {
      const timePart = Date.now().toString(36).slice(-5);
      const randPart = Math.floor(Math.random() * 0xffffff)
        .toString(36)
        .padStart(5, '0');
      return `op-${timePart}-${randPart}`;
    }

    static hashSeed(str) {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      // 0 상태 방지
      return (h >>> 0) || 0x9e3779b9;
    }

    /**
     * [0, 1) 범위 부동소수 난수 반환 (Mulberry32)
     */
    next() {
      let t = (this._state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    float(min, max) {
      return min + (max - min) * this.next();
    }

    int(min, max) {
      const lo = Math.ceil(min);
      const hi = Math.floor(max);
      if (hi <= lo) return lo;
      return lo + Math.floor(this.next() * (hi - lo + 1));
    }

    steppedInt(min, max, step = 16) {
      const steps = Math.max(0, Math.floor((max - min) / step));
      return min + this.int(0, steps) * step;
    }

    chance(probability) {
      return this.next() < probability;
    }

    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[this.int(0, array.length - 1)];
    }

    shuffle(array) {
      const copy = array.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = this.int(0, i);
        const tmp = copy[i];
        copy[i] = copy[j];
        copy[j] = tmp;
      }
      return copy;
    }
  }

  /**
   * 다중 방·복도·문·장애물·적·아이템 랜덤 맵 레이아웃 생성기
   * OfficeMap이 사용하는 레이아웃 데이터 스키마를 생성하여 기존 렌더링·충돌·미니맵 시스템과 직결된다.
   */
  class RandomMapGenerator {
    static generate(options = {}) {
      const cfg = { ...RANDOM_MAP_CONFIG, ...(options.config || {}) };
      const baseSeed =
        options.seed !== undefined && options.seed !== null && String(options.seed).trim() !== ''
          ? String(options.seed).trim()
          : SeededRandom.createRandomSeedString();

      let lastError = null;

      for (let attempt = 0; attempt < cfg.maxGenerationAttempts; attempt++) {
        const attemptSeed = attempt === 0 ? baseSeed : `${baseSeed}#retry${attempt}`;
        const rng = new SeededRandom(attemptSeed);

        try {
          const layout = this._generateSingleAttempt(rng, baseSeed, cfg);
          if (this.validateLayout(layout, cfg)) {
            return layout;
          }
        } catch (err) {
          lastError = err;
        }
      }

      // 모든 재시도가 실패할 경우 안전한 기본 레이아웃으로 폴백하여 게임 중단 방지
      if (PO.FIXED_OFFICE_LAYOUT) {
        return {
          ...PO.FIXED_OFFICE_LAYOUT,
          seed: `${baseSeed}-fallback`,
          isRandomGenerated: false,
          fallbackError: lastError ? String(lastError.message || lastError) : null
        };
      }

      throw lastError || new Error('랜덤 맵 생성에 실패했습니다.');
    }

    static _generateSingleAttempt(rng, displaySeed, cfg) {
      const roomTypes = PO.ROOM_TYPES || {
        START: 'start',
        COMBAT: 'combat',
        SUPPLY: 'supply',
        BOSS: 'boss'
      };

      const targetRoomCount = rng.int(cfg.minRooms, cfg.maxRooms);

      // 1. 매크로 그리드에서 연결성이 보장된 방 셀 클러스터 선택
      const cluster = this._pickConnectedGridCluster(rng, targetRoomCount, cfg);

      // 2. 시작 셀(root)을 기준으로 모든 방을 연결하는 스패닝 트리 + 선택적 추가 복도 간선 구성
      const graph = this._buildConnectedRoomGraph(rng, cluster.cells, cluster.startKey, cfg);

      // 3. 시작 방(1개), 보급 방(최소 1개), 전투 방(나머지) 역할 배정
      const roleAssignment = this._assignRoomRoles(rng, cluster.cells, graph, cfg, roomTypes);

      // 4. 각 방의 실제 크기·위치를 랜덤 결정 (인접 방과의 복도 정렬 여유폭 보장)
      const rawRooms = this._createRoomGeometries(rng, cluster.cells, roleAssignment, cfg, roomTypes);

      // 5. 연결 간선마다 복도(Corridor)와 양 끝 통과 문(Door) 생성
      const { corridors: rawCorridors, doors: rawDoors, roomDoorMap } =
        this._createCorridorsAndDoors(rng, rawRooms, graph.edges, cfg);

      // 6. 월드 원점 기준 정규화(여백 적용)하여 맵 경계 이탈 원천 방지
      const normalized = this._normalizeWorldCoordinates(
        rawRooms,
        rawCorridors,
        rawDoors,
        roomDoorMap,
        cfg
      );

      // 7. 방별 바닥 러그/매트, 북쪽 벽 장식(문 개구부 회피), 내부 가구 장애물(통로 확보) 배치
      const floorMats = [];
      const obstacles = [];

      // 시작 방 플레이어 스폰 지점 확정 (시작 방 중심 부근 안전 구역)
      const startRoom = normalized.rooms.find((r) => r.type === roomTypes.START);
      const playerSpawn = {
        roomId: startRoom.id,
        x: Math.round(startRoom.x + startRoom.width * 0.5),
        y: Math.round(startRoom.y + startRoom.height * 0.5)
      };

      for (let i = 0; i < normalized.rooms.length; i++) {
        const room = normalized.rooms[i];
        const attachedDoors = normalized.roomDoorMap.get(room.id) || [];

        // 북쪽 벽 장식 생성 (북쪽 문 개구부와 절대 겹치지 않도록 고체 벽 구간에만 배치)
        room.wallDecor = this._buildSafeNorthWallDecor(rng, room, attachedDoors, roomTypes);

        // 방별 조명 광원 생성
        room.lightGlows = this._buildRoomLightGlows(room, roomTypes);

        // 방 중앙 바닥 러그 장식 추가
        const mat = this._buildRoomFloorMat(room, roomTypes);
        if (mat) {
          floorMats.push(mat);
        }

        // 방 내부 가구 장애물 배치 (출입문~중앙 통로 및 플레이어 시작 주변 비움)
        const roomObstacles = this._placeRoomObstacles(
          rng,
          room,
          attachedDoors,
          room.id === startRoom.id ? playerSpawn : null,
          cfg,
          roomTypes
        );
        obstacles.push(...roomObstacles);
      }

      // 복도 중앙 러너 매트 추가
      for (let i = 0; i < normalized.corridors.length; i++) {
        const c = normalized.corridors[i];
        if (c.orientation === 'horizontal' && c.width >= 96) {
          floorMats.push({
            roomId: c.id,
            x: Math.round(c.x + 18),
            y: Math.round(c.y + (c.height - 54) * 0.5),
            width: Math.round(c.width - 36),
            height: 54,
            color: '#1f2940',
            border: '#2f3e5e'
          });
        } else if (c.orientation === 'vertical' && c.height >= 96) {
          floorMats.push({
            roomId: c.id,
            x: Math.round(c.x + (c.width - 54) * 0.5),
            y: Math.round(c.y + 18),
            width: 54,
            height: Math.round(c.height - 36),
            color: '#1f2940',
            border: '#2f3e5e'
          });
        }
      }

      // 8. 보급 방(및 대형 맵 추가 방)에 회복 아이템·무기 강화 아이템 비겹침 배치
      const itemSpawns = this._placeItems(
        rng,
        normalized.rooms,
        obstacles,
        playerSpawn,
        cfg,
        roomTypes
      );

      // 9. 전투 방에만 기존 적을 맵 크기에 비례하여 비겹침 랜덤 배치 (시작 방 제외)
      const enemySpawns = this._placeEnemies(
        rng,
        normalized.rooms,
        obstacles,
        normalized.roomDoorMap,
        playerSpawn,
        itemSpawns,
        cfg,
        roomTypes
      );

      // 10. Phase 10: 보스 방 중심에 보스 엔티티(야근 감독관) 스폰 좌표 설정
      const bossRoom = normalized.rooms.find((r) => r.type === roomTypes.BOSS);
      const bossSpawn = bossRoom
        ? {
            id: 'boss-overtime-director',
            roomId: bossRoom.id,
            name: '야근 감독관',
            x: Math.round(bossRoom.x + bossRoom.width * 0.5),
            y: Math.round(bossRoom.y + bossRoom.height * 0.5),
            maxHp: 500,
            hp: 500,
            speed: 120,
            colliderRadius: 30
          }
        : null;

      // 11. Phase 11: 보스 방 북쪽 안전 벽면에 비상 탈출 엘리베이터 스폰 좌표 설정
      let escapeX = bossRoom ? Math.round(bossRoom.x + bossRoom.width * 0.5) : 1200;
      let escapeY = bossRoom ? Math.round(bossRoom.y + 68) : 400;

      if (bossRoom) {
        const bossDoors = normalized.doors.filter((d) => d.roomId === bossRoom.id);
        for (let i = 0; i < bossDoors.length; i++) {
          const d = bossDoors[i];
          if (d.sideOnRoom === 'north') {
            const doorCenterX = d.x + d.width * 0.5;
            if (Math.abs(escapeX - doorCenterX) < 90) {
              escapeX = Math.round(bossRoom.x + bossRoom.width * 0.26);
            }
          }
        }
      }

      const escapeDeviceSpawn = bossRoom
        ? {
            id: 'escape-device-elevator',
            roomId: bossRoom.id,
            name: '비상 탈출 엘리베이터',
            x: escapeX,
            y: escapeY,
            width: 92,
            height: 52,
            zHeight: 70
          }
        : null;

      return {
        seed: displaySeed,
        isRandomGenerated: true,
        worldWidth: normalized.worldWidth,
        worldHeight: normalized.worldHeight,
        wallThickness: cfg.wallThickness,
        tileWidth: 64,
        tileHeight: 48,
        floorBounds: normalized.floorBounds,
        rooms: normalized.rooms,
        corridors: normalized.corridors,
        doors: normalized.doors,
        floorMats,
        obstacles,
        playerSpawn,
        enemySpawns,
        bossSpawn,
        escapeDeviceSpawn,
        itemSpawns,
        targetSpawns: [],
        testHazardSpawn: null
      };
    }

    /**
     * 4x4 그리드 위에서 무작위 시작점으로부터 인접 셀을 확장하여 targetCount개의 연결된 셀 집합 생성
     */
    static _pickConnectedGridCluster(rng, targetCount, cfg) {
      const cols = cfg.gridCols;
      const rows = cfg.gridRows;
      const startCol = rng.int(0, cols - 1);
      const startRow = rng.int(0, rows - 1);
      const startKey = `${startCol},${startRow}`;

      const selectedMap = new Map();
      selectedMap.set(startKey, { key: startKey, col: startCol, row: startRow });

      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ];

      let lastAdded = { col: startCol, row: startRow };

      while (selectedMap.size < targetCount) {
        // 55% 확률로 직전 셀에서 뻗어나가 복도 분기/선형감을 살리고, 45% 확률로 전체 경계에서 분기
        const candidates = [];
        const preferChain = rng.chance(0.55);

        if (preferChain) {
          for (let d = 0; d < dirs.length; d++) {
            const nc = lastAdded.col + dirs[d][0];
            const nr = lastAdded.row + dirs[d][1];
            const nk = `${nc},${nr}`;
            if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !selectedMap.has(nk)) {
              candidates.push({ key: nk, col: nc, row: nr });
            }
          }
        }

        if (candidates.length === 0) {
          const existing = Array.from(selectedMap.values());
          for (let i = 0; i < existing.length; i++) {
            const cell = existing[i];
            for (let d = 0; d < dirs.length; d++) {
              const nc = cell.col + dirs[d][0];
              const nr = cell.row + dirs[d][1];
              const nk = `${nc},${nr}`;
              if (nc >= 0 && nc < cols && nr >= 0 && nr < rows && !selectedMap.has(nk)) {
                candidates.push({ key: nk, col: nc, row: nr });
              }
            }
          }
        }

        if (candidates.length === 0) {
          break;
        }

        const chosen = rng.pick(candidates);
        selectedMap.set(chosen.key, chosen);
        lastAdded = chosen;
      }

      return {
        startKey,
        cells: Array.from(selectedMap.values())
      };
    }

    /**
     * 선택된 셀들 사이에 시작 방으로부터 100% 도달 가능한 스패닝 트리를 구성하고,
     * 일부 인접 간선을 추가 복도로 연결
     */
    static _buildConnectedRoomGraph(rng, cells, startKey, cfg) {
      const cellMap = new Map();
      for (let i = 0; i < cells.length; i++) {
        cellMap.set(cells[i].key, cells[i]);
      }

      const visited = new Set([startKey]);
      const treeEdges = [];
      const edgeKeySet = new Set();

      const makeEdgeKey = (k1, k2) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ];

      // 무작위 프림(Randomized Prim) 방식으로 스패닝 트리 구성
      while (visited.size < cells.length) {
        const frontierEdges = [];
        for (const vk of visited) {
          const vCell = cellMap.get(vk);
          for (let d = 0; d < dirs.length; d++) {
            const nk = `${vCell.col + dirs[d][0]},${vCell.row + dirs[d][1]}`;
            if (cellMap.has(nk) && !visited.has(nk)) {
              frontierEdges.push({ fromKey: vk, toKey: nk });
            }
          }
        }

        if (frontierEdges.length === 0) {
          break;
        }

        const chosen = rng.pick(frontierEdges);
        visited.add(chosen.toKey);
        treeEdges.push(chosen);
        edgeKeySet.add(makeEdgeKey(chosen.fromKey, chosen.toKey));
      }

      // 트리 외 인접 셀 쌍 중 일부를 순환 복도로 추가
      const nonTreePairs = [];
      for (let i = 0; i < cells.length; i++) {
        const a = cells[i];
        const neighbors = [
          `${a.col + 1},${a.row}`,
          `${a.col},${a.row + 1}`
        ];
        for (let n = 0; n < neighbors.length; n++) {
          const bk = neighbors[n];
          if (!cellMap.has(bk)) continue;
          const ek = makeEdgeKey(a.key, bk);
          if (!edgeKeySet.has(ek)) {
            nonTreePairs.push({ fromKey: a.key, toKey: bk, edgeKey: ek });
          }
        }
      }

      const shuffledExtras = rng.shuffle(nonTreePairs);
      let addedExtras = 0;
      const allEdges = treeEdges.slice();

      for (let i = 0; i < shuffledExtras.length && addedExtras < cfg.maxExtraCorridors; i++) {
        if (rng.chance(cfg.extraCorridorChance)) {
          allEdges.push({
            fromKey: shuffledExtras[i].fromKey,
            toKey: shuffledExtras[i].toKey
          });
          edgeKeySet.add(shuffledExtras[i].edgeKey);
          addedExtras++;
        }
      }

      // 시작 방으로부터 각 셀까지의 그래프 최단 거리(depth)와 차수(degree) 계산
      const adj = new Map();
      for (let i = 0; i < cells.length; i++) {
        adj.set(cells[i].key, []);
      }
      for (let i = 0; i < allEdges.length; i++) {
        const e = allEdges[i];
        adj.get(e.fromKey).push(e.toKey);
        adj.get(e.toKey).push(e.fromKey);
      }

      const depthMap = new Map([[startKey, 0]]);
      const queue = [startKey];
      while (queue.length > 0) {
        const cur = queue.shift();
        const curDepth = depthMap.get(cur);
        const nexts = adj.get(cur) || [];
        for (let i = 0; i < nexts.length; i++) {
          const nxt = nexts[i];
          if (!depthMap.has(nxt)) {
            depthMap.set(nxt, curDepth + 1);
            queue.push(nxt);
          }
        }
      }

      return {
        edges: allEdges,
        adj,
        depthMap
      };
    }

    /**
     * Phase 10: 시작 방(1개), 보스 방(1개), 보급 방(1~2개), 전투 방(나머지) 역할 지정
     */
    static _assignRoomRoles(rng, cells, graph, cfg, roomTypes) {
      const roles = new Map();
      let startKey = null;

      for (const [k, d] of graph.depthMap.entries()) {
        if (d === 0) {
          startKey = k;
          break;
        }
      }
      roles.set(startKey, roomTypes.START);

      const otherCells = cells.filter((c) => c.key !== startKey);

      // 1. 보스 방(1개): 시작 방에서 그래프 최단 거리(depth)가 가장 먼 후보 중 선택 (동률 시 리프 우선)
      const bossCandidates = rng.shuffle(otherCells).sort((a, b) => {
        const depthA = graph.depthMap.get(a.key) || 1;
        const depthB = graph.depthMap.get(b.key) || 1;
        if (depthB !== depthA) {
          return depthB - depthA;
        }
        const degA = (graph.adj.get(a.key) || []).length;
        const degB = (graph.adj.get(b.key) || []).length;
        const leafBonusA = degA === 1 ? 1.5 : 0;
        const leafBonusB = degB === 1 ? 1.5 : 0;
        return (degA === 1 ? 2 : 0) - (degB === 1 ? 2 : 0);
      });

      const bossCell = bossCandidates[0];
      roles.set(bossCell.key, roomTypes.BOSS);

      // 2. 보급 방(1~2개): 보스 방을 제외한 방들 중 막다른 방 또는 거리가 있는 방 위주로 배정
      const remainingCells = otherCells.filter((c) => c.key !== bossCell.key);
      const wantExtraSupply =
        cells.length >= cfg.extraSupplyRoomThreshold &&
        cfg.maxSupplyRooms >= 2 &&
        rng.chance(cfg.extraSupplyRoomChance);
      const targetSupplyCount = Math.min(
        Math.max(1, remainingCells.length - 2),
        wantExtraSupply ? 2 : cfg.minSupplyRooms
      );

      const scored = rng.shuffle(remainingCells).sort((a, b) => {
        const degA = (graph.adj.get(a.key) || []).length;
        const degB = (graph.adj.get(b.key) || []).length;
        const leafBonusA = degA === 1 ? 1.5 : 0;
        const leafBonusB = degB === 1 ? 1.5 : 0;
        const scoreA = (graph.depthMap.get(a.key) || 1) + leafBonusA;
        const scoreB = (graph.depthMap.get(b.key) || 1) + leafBonusB;
        return scoreB - scoreA;
      });

      for (let i = 0; i < scored.length; i++) {
        if (i < targetSupplyCount) {
          roles.set(scored[i].key, roomTypes.SUPPLY);
        } else {
          roles.set(scored[i].key, roomTypes.COMBAT);
        }
      }

      return roles;
    }

    /**
     * 각 셀에 속한 방의 크기(가로/세로)와 위치(지터 포함)를 랜덤 생성
     */
    static _createRoomGeometries(rng, cells, roleAssignment, cfg, roomTypes) {
      const roomsByKey = new Map();
      let combatSeq = 1;
      let supplySeq = 1;

      const combatSubtitles = ['일반 업무 구역', '임원 회의실', '야근 개발실', '문서 자료실', '인사 총무실', '기획 전략실'];
      const combatPalettes = [
        { primary: '#1d2438', secondary: '#191f31' },
        { primary: '#20253a', secondary: '#1b2032' },
        { primary: '#1c253b', secondary: '#171f32' }
      ];

      // 시작 방이 항상 배열 첫 번째에 오도록 정렬
      const orderedCells = cells.slice().sort((a, b) => {
        const ra = roleAssignment.get(a.key);
        const rb = roleAssignment.get(b.key);
        if (ra === roomTypes.START) return -1;
        if (rb === roomTypes.START) return 1;
        return 0;
      });

      for (let i = 0; i < orderedCells.length; i++) {
        const cell = orderedCells[i];
        const type = roleAssignment.get(cell.key);

        let minW = cfg.minRoomWidth;
        let maxW = cfg.maxRoomWidth;
        let minH = cfg.minRoomHeight;
        let maxH = cfg.maxRoomHeight;

        if (type === roomTypes.START) {
          minW = Math.max(cfg.minRoomWidth, 460);
          maxW = Math.min(cfg.maxRoomWidth, 560);
          minH = Math.max(cfg.minRoomHeight, 380);
          maxH = Math.min(cfg.maxRoomHeight, 460);
        } else if (type === roomTypes.SUPPLY) {
          minW = cfg.minRoomWidth;
          maxW = Math.min(cfg.maxRoomWidth, 540);
          minH = cfg.minRoomHeight;
          maxH = Math.min(cfg.maxRoomHeight, 420);
        } else if (type === roomTypes.BOSS) {
          // 보스 방: 일반 전투 방보다 면적이 넓고 보스 행동 반경이 충분한 대형 방 (640~760 x 480~600)
          minW = Math.max(cfg.minRoomWidth, 640);
          maxW = Math.max(cfg.maxRoomWidth, 760);
          minH = Math.max(cfg.minRoomHeight, 480);
          maxH = Math.max(cfg.maxRoomHeight, 600);
        } else {
          minW = Math.max(cfg.minRoomWidth, 460);
          maxW = cfg.maxRoomWidth;
          minH = Math.max(cfg.minRoomHeight, 360);
          maxH = cfg.maxRoomHeight;
        }

        const width = rng.steppedInt(minW, maxW, cfg.sizeStep);
        const height = rng.steppedInt(minH, maxH, cfg.sizeStep);

        const centerX = cell.col * cfg.cellPitchX + cfg.cellPitchX * 0.5;
        const centerY = cell.row * cfg.cellPitchY + cfg.cellPitchY * 0.5;
        const jitterX = rng.int(-cfg.maxJitterX, cfg.maxJitterX);
        const jitterY = rng.int(-cfg.maxJitterY, cfg.maxJitterY);

        const x = Math.round(centerX - width * 0.5 + jitterX);
        const y = Math.round(centerY - height * 0.5 + jitterY);

        let id = 'room-start';
        let name = '시작 방';
        let subtitle = '당직 대기실';
        let floorPalette = { primary: '#1e2639', secondary: '#1a2132' };

        if (type === roomTypes.BOSS) {
          id = 'room-boss';
          name = '보스 방';
          subtitle = '최종 승인실 (야근 감독관)';
          floorPalette = { primary: '#281c2c', secondary: '#201524' };
        } else if (type === roomTypes.COMBAT) {
          const idx = combatSeq++;
          id = `room-combat-${idx}`;
          name = `전투 방 ${idx}`;
          subtitle = combatSubtitles[(idx - 1) % combatSubtitles.length];
          floorPalette = combatPalettes[(idx - 1) % combatPalettes.length];
        } else if (type === roomTypes.SUPPLY) {
          const idx = supplySeq++;
          id = idx === 1 ? 'room-supply' : `room-supply-${idx}`;
          name = idx === 1 ? '보급 방' : `보급 방 ${idx}`;
          subtitle = '비품·의무 보관실';
          floorPalette = { primary: '#1b2838', secondary: '#172230' };
        }

        roomsByKey.set(cell.key, {
          id,
          gridKey: cell.key,
          gridCol: cell.col,
          gridRow: cell.row,
          name,
          subtitle,
          type,
          x,
          y,
          width,
          height,
          connections: [],
          floorPalette
        });
      }

      return roomsByKey;
    }

    /**
     * 인접한 두 방의 공통 투영 구간 내에서 복도와 양 끝 통과 문(Door) 생성
     */
    static _createCorridorsAndDoors(rng, roomsByKey, edges, cfg) {
      const corridors = [];
      const doors = [];
      const roomDoorMap = new Map();

      for (const room of roomsByKey.values()) {
        roomDoorMap.set(room.id, []);
      }

      const cw = cfg.corridorWidth;
      const doorDepth = cfg.doorDepth;
      const jambMargin = 28;

      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const roomA = roomsByKey.get(edge.fromKey);
        const roomB = roomsByKey.get(edge.toKey);
        const corridorId = `corridor-${i + 1}`;

        if (roomA.gridRow === roomB.gridRow) {
          // 좌우 수평 연결
          const westRoom = roomA.gridCol < roomB.gridCol ? roomA : roomB;
          const eastRoom = roomA.gridCol < roomB.gridCol ? roomB : roomA;

          const overlapTop = Math.max(westRoom.y + jambMargin, eastRoom.y + jambMargin);
          const overlapBottom = Math.min(
            westRoom.y + westRoom.height - jambMargin,
            eastRoom.y + eastRoom.height - jambMargin
          );

          const minCy = overlapTop;
          const maxCy = Math.max(minCy, overlapBottom - cw);
          const corridorY = Math.round(rng.int(minCy, maxCy));
          const corridorX = westRoom.x + westRoom.width;
          const corridorW = eastRoom.x - corridorX;

          const corridor = {
            id: corridorId,
            name: `연결 복도 ${i + 1}`,
            x: corridorX,
            y: corridorY,
            width: corridorW,
            height: cw,
            orientation: 'horizontal',
            fromRoomId: westRoom.id,
            toRoomId: eastRoom.id,
            floorPalette: { primary: '#171e2f', secondary: '#141a29' }
          };
          corridors.push(corridor);

          westRoom.connections.push(corridorId);
          eastRoom.connections.push(corridorId);

          const doorWest = {
            id: `door-${corridorId}-west`,
            orientation: 'vertical',
            x: Math.round(corridorX - doorDepth * 0.5),
            y: corridorY,
            width: doorDepth,
            height: cw,
            roomId: westRoom.id,
            corridorId,
            sideOnRoom: 'east',
            passable: true
          };
          const doorEast = {
            id: `door-${corridorId}-east`,
            orientation: 'vertical',
            x: Math.round(corridorX + corridorW - doorDepth * 0.5),
            y: corridorY,
            width: doorDepth,
            height: cw,
            roomId: eastRoom.id,
            corridorId,
            sideOnRoom: 'west',
            passable: true
          };

          doors.push(doorWest, doorEast);
          roomDoorMap.get(westRoom.id).push(doorWest);
          roomDoorMap.get(eastRoom.id).push(doorEast);
        } else {
          // 상하 수직 연결
          const northRoom = roomA.gridRow < roomB.gridRow ? roomA : roomB;
          const southRoom = roomA.gridRow < roomB.gridRow ? roomB : roomA;

          const overlapLeft = Math.max(northRoom.x + jambMargin, southRoom.x + jambMargin);
          const overlapRight = Math.min(
            northRoom.x + northRoom.width - jambMargin,
            southRoom.x + southRoom.width - jambMargin
          );

          const minCx = overlapLeft;
          const maxCx = Math.max(minCx, overlapRight - cw);
          const corridorX = Math.round(rng.int(minCx, maxCx));
          const corridorY = northRoom.y + northRoom.height;
          const corridorH = southRoom.y - corridorY;

          const corridor = {
            id: corridorId,
            name: `연결 복도 ${i + 1}`,
            x: corridorX,
            y: corridorY,
            width: cw,
            height: corridorH,
            orientation: 'vertical',
            fromRoomId: northRoom.id,
            toRoomId: southRoom.id,
            floorPalette: { primary: '#171e2f', secondary: '#141a29' }
          };
          corridors.push(corridor);

          northRoom.connections.push(corridorId);
          southRoom.connections.push(corridorId);

          const doorNorth = {
            id: `door-${corridorId}-north`,
            orientation: 'horizontal',
            x: corridorX,
            y: Math.round(corridorY - doorDepth * 0.5),
            width: cw,
            height: doorDepth,
            roomId: northRoom.id,
            corridorId,
            sideOnRoom: 'south',
            passable: true
          };
          const doorSouth = {
            id: `door-${corridorId}-south`,
            orientation: 'horizontal',
            x: corridorX,
            y: Math.round(corridorY + corridorH - doorDepth * 0.5),
            width: cw,
            height: doorDepth,
            roomId: southRoom.id,
            corridorId,
            sideOnRoom: 'north',
            passable: true
          };

          doors.push(doorNorth, doorSouth);
          roomDoorMap.get(northRoom.id).push(doorNorth);
          roomDoorMap.get(southRoom.id).push(doorSouth);
        }
      }

      return {
        corridors,
        doors,
        roomDoorMap
      };
    }

    /**
     * 생성된 모든 방과 복도를 월드 외곽 여백 안쪽으로 평행이동하여 경계 밖 생성 방지
     */
    static _normalizeWorldCoordinates(roomsByKey, corridors, doors, roomDoorMap, cfg) {
      const rooms = Array.from(roomsByKey.values());
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < rooms.length; i++) {
        const r = rooms[i];
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      }

      const pad = cfg.worldPadding;
      // 타일 그리드(64x48) 정렬감이 유지되도록 오프셋 스냅
      const shiftX = pad - minX;
      const shiftY = pad - minY;

      for (let i = 0; i < rooms.length; i++) {
        rooms[i].x += shiftX;
        rooms[i].y += shiftY;
      }
      for (let i = 0; i < corridors.length; i++) {
        corridors[i].x += shiftX;
        corridors[i].y += shiftY;
      }
      for (let i = 0; i < doors.length; i++) {
        doors[i].x += shiftX;
        doors[i].y += shiftY;
      }

      const spanW = maxX - minX;
      const spanH = maxY - minY;
      const worldWidth = Math.max(1440, Math.ceil(spanW + pad * 2));
      const worldHeight = Math.max(960, Math.ceil(spanH + pad * 2));

      const wallMargin = cfg.wallThickness + 24;
      const floorBounds = {
        x: Math.max(24, pad - wallMargin),
        y: Math.max(24, pad - wallMargin),
        width: spanW + wallMargin * 2,
        height: spanH + wallMargin * 2
      };

      return {
        worldWidth,
        worldHeight,
        floorBounds,
        rooms,
        corridors,
        doors,
        roomDoorMap
      };
    }

    /**
     * 북쪽 문 개구부와 절대 겹치지 않는 고체 북쪽 벽 구간에만 창문·시계·화이트보드·표지판 배치
     */
    static _buildSafeNorthWallDecor(rng, room, attachedDoors, roomTypes) {
      const northDoorOpenings = [];
      for (let i = 0; i < attachedDoors.length; i++) {
        const d = attachedDoors[i];
        if (d.sideOnRoom === 'north') {
          northDoorOpenings.push([
            d.x - room.x - 16,
            d.x - room.x + d.width + 16
          ]);
        }
      }

      // [24, room.width - 24] 범위에서 북쪽 문 개구부 제외
      const segments = this._subtract1D(24, room.width - 24, northDoorOpenings);
      const decor = [];

      for (let s = 0; s < segments.length; s++) {
        const [segStart, segEnd] = segments[s];
        const segLen = segEnd - segStart;

        if (room.type === roomTypes.SUPPLY) {
          if (segLen >= 220) {
            decor.push({ kind: 'supply_sign', offsetX: Math.round(segStart + 18), width: 88 });
            decor.push({ kind: 'whiteboard', offsetX: Math.round(segEnd - 108), width: 92 });
          } else if (segLen >= 104) {
            decor.push({
              kind: 'supply_sign',
              offsetX: Math.round(segStart + (segLen - 88) * 0.5),
              width: 88
            });
          }
          continue;
        }

        if (segLen >= 340) {
          const winW = 176;
          decor.push({
            kind: 'window',
            offsetX: Math.round(segStart + 18),
            width: winW,
            showMoon: rng.chance(0.35)
          });
          decor.push({
            kind: 'clock',
            offsetX: Math.round(segStart + winW + 44)
          });
          if (segEnd - (segStart + winW + 76) >= 106) {
            decor.push({
              kind: rng.chance(0.3) ? 'locked_door' : 'whiteboard',
              offsetX: Math.round(segEnd - 106),
              width: 92
            });
          }
        } else if (segLen >= 195) {
          decor.push({
            kind: 'window',
            offsetX: Math.round(segStart + (segLen - 170) * 0.5),
            width: 170,
            showMoon: rng.chance(0.25)
          });
        } else if (segLen >= 112) {
          decor.push({
            kind: 'whiteboard',
            offsetX: Math.round(segStart + (segLen - 92) * 0.5),
            width: 92
          });
        } else if (segLen >= 52) {
          decor.push({
            kind: 'clock',
            offsetX: Math.round(segStart + segLen * 0.5)
          });
        }
      }

      return decor;
    }

    static _buildRoomLightGlows(room, roomTypes) {
      const cx = Math.round(room.x + room.width * 0.5);
      const cy = Math.round(room.y + room.height * 0.5);

      if (room.type === roomTypes.BOSS) {
        return [
          { x: cx, y: cy, radius: 195, color: 'rgba(244, 63, 94, 0.12)' },
          { x: room.x + 140, y: room.y + 105, radius: 145, color: 'rgba(168, 85, 247, 0.09)' },
          { x: room.x + room.width - 140, y: room.y + room.height - 105, radius: 145, color: 'rgba(239, 68, 68, 0.08)' }
        ];
      }

      if (room.type === roomTypes.SUPPLY) {
        return [
          { x: cx, y: cy, radius: 155, color: 'rgba(74, 222, 128, 0.09)' },
          { x: cx - 80, y: cy, radius: 95, color: 'rgba(45, 212, 191, 0.07)' },
          { x: cx + 80, y: cy, radius: 95, color: 'rgba(251, 191, 36, 0.07)' }
        ];
      }

      if (room.type === roomTypes.START) {
        return [
          { x: cx, y: cy, radius: 155, color: 'rgba(148, 163, 184, 0.07)' },
          { x: room.x + 130, y: room.y + 90, radius: 130, color: 'rgba(90, 140, 230, 0.09)' }
        ];
      }

      return [
        { x: cx, y: cy, radius: 165, color: 'rgba(244, 63, 94, 0.05)' },
        { x: room.x + 135, y: room.y + 95, radius: 130, color: 'rgba(90, 140, 230, 0.08)' },
        {
          x: room.x + room.width - 135,
          y: room.y + room.height - 95,
          radius: 125,
          color: 'rgba(255, 200, 110, 0.08)'
        }
      ];
    }

    static _buildRoomFloorMat(room, roomTypes) {
      const w = Math.round(Math.min(260, Math.max(140, room.width * 0.42)));
      const h = Math.round(Math.min(150, Math.max(92, room.height * 0.32)));
      const x = Math.round(room.x + (room.width - w) * 0.5);
      const y = Math.round(room.y + (room.height - h) * 0.5);

      if (room.type === roomTypes.BOSS) {
        return { roomId: room.id, x, y, width: w, height: h, color: '#2c182c', border: '#4f244e' };
      }
      if (room.type === roomTypes.SUPPLY) {
        return { roomId: room.id, x, y, width: w, height: h, color: '#1b3137', border: '#2d5459' };
      }
      if (room.type === roomTypes.START) {
        return { roomId: room.id, x, y, width: w, height: h, color: '#222b42', border: '#334061' };
      }
      return { roomId: room.id, x, y, width: w, height: h, color: '#21253c', border: '#343b5e' };
    }

    /**
     * 방 내부 가구 장애물 배치
     * - 모든 문 개구부 앞 구역 및 문~방 중심 십자 통로를 금지 구역(forbiddenRects)으로 보호하여 길 막힘 원천 차단
     * - 보스 방은 보스가 벽이나 장애물에 끼지 않도록 내부 장애물을 비워둔다.
     * - 시작 방은 플레이어 스폰 반경(playerSafeRadius) 내 장애물 배치 금지
     */
    static _placeRoomObstacles(rng, room, attachedDoors, startPlayerSpawn, cfg, roomTypes) {
      if (room.type === roomTypes.BOSS) {
        // 보스가 벽이나 장애물에 끼지 않도록 내부 장애물을 비워둠
        return [];
      }
      const forbiddenRects = [];
      const cx = room.x + room.width * 0.5;
      const cy = room.y + room.height * 0.5;
      const aisleHalf = cfg.aisleHalfWidth;
      const keepout = cfg.doorKeepoutPadding;

      // 1. 각 문 개구부 주변 및 문에서 방 중심까지의 직선 통로를 무장애 구역으로 예약
      for (let i = 0; i < attachedDoors.length; i++) {
        const d = attachedDoors[i];
        const dcx = d.x + d.width * 0.5;
        const dcy = d.y + d.height * 0.5;

        forbiddenRects.push({
          x: d.x - 28,
          y: d.y - 28,
          width: d.width + 56,
          height: d.height + 56
        });

        if (d.sideOnRoom === 'west' || d.sideOnRoom === 'east') {
          const minX = Math.min(dcx, cx) - keepout * 0.4;
          const maxX = Math.max(dcx, cx) + keepout * 0.4;
          forbiddenRects.push({
            x: minX,
            y: Math.min(dcy, cy) - aisleHalf,
            width: maxX - minX,
            height: Math.abs(dcy - cy) + aisleHalf * 2
          });
        } else {
          const minY = Math.min(dcy, cy) - keepout * 0.4;
          const maxY = Math.max(dcy, cy) + keepout * 0.4;
          forbiddenRects.push({
            x: Math.min(dcx, cx) - aisleHalf,
            y: minY,
            width: Math.abs(dcx - cx) + aisleHalf * 2,
            height: maxY - minY
          });
        }
      }

      // 2. 시작 방 플레이어 스폰 주변 보호 구역 및 보급 방 중앙 아이템 구역 보호
      if (startPlayerSpawn) {
        const sr = cfg.playerSafeRadius;
        forbiddenRects.push({
          x: startPlayerSpawn.x - sr,
          y: startPlayerSpawn.y - sr,
          width: sr * 2,
          height: sr * 2
        });
      } else if (room.type === roomTypes.SUPPLY) {
        forbiddenRects.push({
          x: cx - 135,
          y: cy - 68,
          width: 270,
          height: 136
        });
      } else {
        // 전투 방 중앙 최소 교차 여유 구역
        forbiddenRects.push({
          x: cx - 64,
          y: cy - 54,
          width: 128,
          height: 108
        });
      }

      const templates = this._getObstacleTemplatesForRoom(rng, room.type, roomTypes);
      const maxToPlace =
        room.type === roomTypes.SUPPLY
          ? 2
          : room.type === roomTypes.START
            ? rng.int(2, 3)
            : rng.int(2, 5);

      // 방 네 귀퉁이 슬롯과 상하좌우 내벽 슬롯 후보 생성
      const margin = cfg.obstacleWallMargin;
      const anchorFactors = rng.shuffle([
        { fx: 0.0, fy: 0.0 },
        { fx: 1.0, fy: 0.0 },
        { fx: 0.0, fy: 1.0 },
        { fx: 1.0, fy: 1.0 },
        { fx: 0.5, fy: 0.0 },
        { fx: 0.5, fy: 1.0 }
      ]);

      const placed = [];
      let obsSeq = 1;

      for (let a = 0; a < anchorFactors.length && placed.length < maxToPlace; a++) {
        const anchor = anchorFactors[a];
        const tpl = templates[(a + rng.int(0, templates.length - 1)) % templates.length];

        const minX = room.x + margin;
        const maxX = room.x + room.width - margin - tpl.width;
        const minY = room.y + margin + 10;
        const maxY = room.y + room.height - margin - tpl.height;

        if (maxX <= minX || maxY <= minY) {
          continue;
        }

        const baseX = minX + (maxX - minX) * anchor.fx;
        const baseY = minY + (maxY - minY) * anchor.fy;
        const candX = Math.round(
          Math.max(minX, Math.min(maxX, baseX + rng.int(-18, 18)))
        );
        const candY = Math.round(
          Math.max(minY, Math.min(maxY, baseY + rng.int(-14, 14)))
        );

        const candidate = {
          id: `${room.id}-obs-${obsSeq}`,
          roomId: room.id,
          type: tpl.type,
          x: candX,
          y: candY,
          width: tpl.width,
          height: tpl.height,
          zHeight: tpl.zHeight,
          monitorAlign: tpl.monitorAlign,
          hasLamp: tpl.hasLamp,
          hasMug: tpl.hasMug,
          solid: true
        };

        if (this._rectIntersectsAny(candidate, forbiddenRects, 0)) {
          continue;
        }
        if (this._rectIntersectsAny(candidate, placed, cfg.obstacleGap)) {
          continue;
        }

        placed.push(candidate);
        obsSeq++;
      }

      return placed;
    }

    static _getObstacleTemplatesForRoom(rng, type, roomTypes) {
      if (type === roomTypes.SUPPLY) {
        return [
          { type: 'cabinet', width: 86, height: 46, zHeight: 58 },
          { type: 'copier', width: 92, height: 48, zHeight: 46 }
        ];
      }
      if (type === roomTypes.START) {
        return [
          {
            type: 'desk',
            width: 165,
            height: 54,
            zHeight: 32,
            monitorAlign: 'left',
            hasLamp: true
          },
          { type: 'cabinet', width: 86, height: 46, zHeight: 58 },
          { type: 'copier', width: 92, height: 48, zHeight: 46 }
        ];
      }
      return [
        {
          type: 'desk',
          width: 165,
          height: 54,
          zHeight: 32,
          monitorAlign: rng.chance(0.5) ? 'left' : 'right',
          hasLamp: rng.chance(0.5),
          hasMug: rng.chance(0.5)
        },
        {
          type: 'manager_desk',
          width: 186,
          height: 56,
          zHeight: 34,
          hasLamp: true
        },
        { type: 'pillar', width: 48, height: 42, zHeight: 78 },
        { type: 'cabinet', width: 86, height: 46, zHeight: 58 },
        { type: 'meeting_table', width: 220, height: 60, zHeight: 30 },
        { type: 'copier', width: 92, height: 48, zHeight: 46 }
      ];
    }

    /**
     * 회복 아이템 및 무기 강화 아이템을 보급 방(및 대형 맵 추가 구역) 내 안전한 바닥 좌표에 배치
     */
    static _placeItems(rng, rooms, obstacles, playerSpawn, cfg, roomTypes) {
      const supplyRooms = rooms.filter((r) => r.type === roomTypes.SUPPLY);
      const combatRooms = rooms.filter((r) => r.type === roomTypes.COMBAT);
      const primarySupply = supplyRooms[0] || combatRooms[combatRooms.length - 1];

      const itemSpawns = [];
      let medkitSeq = 1;
      let upgradeSeq = 1;

      const addItemInRoom = (room, configId, preferredDx = 0) => {
        const pt = this._findClearFloorPoint(
          rng,
          room,
          obstacles,
          itemSpawns,
          playerSpawn,
          {
            wallMargin: 54,
            obstacleClearance: 34,
            entityClearance: 82,
            minPlayerDist: 95,
            preferredX: room.x + room.width * 0.5 + preferredDx,
            preferredY: room.y + room.height * 0.5
          }
        );

        if (!pt) return;
        const id =
          configId === 'medkit'
            ? `item-medkit-${medkitSeq++}`
            : `item-upgrade-${upgradeSeq++}`;

        itemSpawns.push({
          id,
          roomId: room.id,
          configId,
          x: pt.x,
          y: pt.y,
          radius: 16,
          initialPhase: Number(rng.float(0, Math.PI * 2).toFixed(2))
        });
      };

      // 기본 필수 보급 아이템 2종(응급 구급상자 + 무기 강화 모듈)을 1차 보급 방에 배치
      if (primarySupply) {
        addItemInRoom(primarySupply, 'medkit', -78);
        addItemInRoom(primarySupply, 'weapon_upgrade_module', 78);
      }

      // 2번째 보급 방이 존재하면 추가 보급 아이템 배치
      if (supplyRooms.length >= 2) {
        const secondSupply = supplyRooms[1];
        const extraType = rng.chance(0.5) ? 'medkit' : 'weapon_upgrade_module';
        addItemInRoom(secondSupply, extraType, 0);
      } else if (rooms.length >= 9 && combatRooms.length > 0) {
        // 방이 9~10개로 큰 맵인데 보급 방이 1개인 경우, 깊은 전투 방 한 곳에 보조 회복 아이템 배치
        const deepCombat = combatRooms[combatRooms.length - 1];
        addItemInRoom(deepCombat, 'medkit', 0);
      }

      return itemSpawns;
    }

    /**
     * 전투 방에 기존 적을 랜덤 배치 (시작 방 생성 금지, 장애물/벽/플레이어 겹침 방지, 맵 크기 비례)
     */
    static _placeEnemies(
      rng,
      rooms,
      obstacles,
      roomDoorMap,
      playerSpawn,
      itemSpawns,
      cfg,
      roomTypes
    ) {
      const combatRooms = rooms.filter((r) => r.type === roomTypes.COMBAT);
      const enemySpawns = [];
      let enemySeq = 1;

      for (let i = 0; i < combatRooms.length; i++) {
        const room = combatRooms[i];
        const area = room.width * room.height;
        const doorsInRoom = roomDoorMap.get(room.id) || [];

        let countInRoom = cfg.minEnemiesPerCombatRoom;
        if (
          cfg.maxEnemiesPerCombatRoom >= 2 &&
          area >= cfg.largeCombatRoomArea &&
          rng.chance(cfg.secondEnemyChanceInLargeRoom)
        ) {
          countInRoom = 2;
        }

        for (let k = 0; k < countInRoom; k++) {
          const existingEntities = [...itemSpawns, ...enemySpawns];
          const offsetHintX =
            countInRoom === 1 ? rng.int(-45, 45) : k === 0 ? -90 : 90;
          const offsetHintY = rng.int(-36, 36);

          const pt = this._findClearFloorPoint(
            rng,
            room,
            obstacles,
            existingEntities,
            playerSpawn,
            {
              wallMargin: 62,
              obstacleClearance: 36,
              entityClearance: cfg.minEnemySeparation,
              minPlayerDist: cfg.minEnemyDistFromPlayer,
              doors: doorsInRoom,
              doorClearance: 72,
              preferredX: room.x + room.width * 0.5 + offsetHintX,
              preferredY: room.y + room.height * 0.5 + offsetHintY
            }
          );

          if (pt) {
            // Phase 14: 적 종류별 생성 가중치 (일반 40%, 빠른 20%, 원거리 20%, 탱커 10%, 엘리트 10%)
            const roll = rng.float(0, 100);
            let enemyType = 'ghost';
            if (roll < 40) {
              enemyType = 'ghost';
            } else if (roll < 60) {
              enemyType = 'stalker';
            } else if (roll < 80) {
              enemyType = 'thrower';
            } else if (roll < 90) {
              enemyType = 'cabinet';
            } else {
              enemyType = 'manager';
            }

            const radiusMap = {
              ghost: 17,
              stalker: 15,
              thrower: 16,
              cabinet: 22,
              manager: 19
            };

            enemySpawns.push({
              id: `enemy-combat-${enemySeq++}`,
              roomId: room.id,
              enemyType,
              x: pt.x,
              y: pt.y,
              radius: radiusMap[enemyType] || 17
            });
          }
        }
      }

      return enemySpawns;
    }

    /**
     * 방 내부에서 벽·장애물·문·기존 엔티티·플레이어와 겹치지 않는 유효 바닥 좌표 탐색
     */
    static _findClearFloorPoint(rng, room, obstacles, existingEntities, playerSpawn, opts) {
      const wallMargin = opts.wallMargin ?? 52;
      const obsPad = opts.obstacleClearance ?? 34;
      const entityPad = opts.entityClearance ?? 72;
      const minPlayerDist = opts.minPlayerDist ?? 80;
      const doors = opts.doors || [];
      const doorPad = opts.doorClearance ?? 0;

      const minX = room.x + wallMargin;
      const maxX = room.x + room.width - wallMargin;
      const minY = room.y + wallMargin;
      const maxY = room.y + room.height - wallMargin;

      const isPointValid = (px, py, relaxDoors = false) => {
        if (px < minX || px > maxX || py < minY || py > maxY) {
          return false;
        }

        if (playerSpawn) {
          const dPlayer = Math.hypot(px - playerSpawn.x, py - playerSpawn.y);
          if (dPlayer < minPlayerDist) {
            return false;
          }
        }

        for (let i = 0; i < obstacles.length; i++) {
          const obs = obstacles[i];
          if (obs.roomId && obs.roomId !== room.id) continue;
          const kx = Math.max(obs.x, Math.min(px, obs.x + obs.width));
          const ky = Math.max(obs.y, Math.min(py, obs.y + obs.height));
          if ((px - kx) ** 2 + (py - ky) ** 2 < obsPad * obsPad) {
            return false;
          }
        }

        for (let i = 0; i < existingEntities.length; i++) {
          const ent = existingEntities[i];
          if (Math.hypot(px - ent.x, py - ent.y) < entityPad) {
            return false;
          }
        }

        if (!relaxDoors && doorPad > 0) {
          for (let i = 0; i < doors.length; i++) {
            const d = doors[i];
            const dcx = d.x + d.width * 0.5;
            const dcy = d.y + d.height * 0.5;
            if (Math.hypot(px - dcx, py - dcy) < doorPad) {
              return false;
            }
          }
        }

        return true;
      };

      // 1순위: 선호 위치 및 주변 나선 오프셋 검사
      if (opts.preferredX !== undefined && opts.preferredY !== undefined) {
        const basePx = Math.round(Math.max(minX, Math.min(maxX, opts.preferredX)));
        const basePy = Math.round(Math.max(minY, Math.min(maxY, opts.preferredY)));
        if (isPointValid(basePx, basePy, false)) {
          return { x: basePx, y: basePy };
        }
      }

      // 2순위: 방 내부 랜덤 샘플링 탐색
      for (let attempt = 0; attempt < 48; attempt++) {
        const px = rng.int(minX, maxX);
        const py = rng.int(minY, maxY);
        if (isPointValid(px, py, attempt >= 32)) {
          return { x: px, y: py };
        }
      }

      // 3순위: 격자 스캔 폴백
      for (let gy = minY; gy <= maxY; gy += 28) {
        for (let gx = minX; gx <= maxX; gx += 28) {
          if (isPointValid(Math.round(gx), Math.round(gy), true)) {
            return { x: Math.round(gx), y: Math.round(gy) };
          }
        }
      }

      return null;
    }

    /**
     * 생성된 레이아웃의 구조적 무결성(경계, 비겹침, 전체 방 연결성, 스폰 비충돌) 검증
     */
    static validateLayout(layout, cfg = RANDOM_MAP_CONFIG) {
      if (!layout || !Array.isArray(layout.rooms) || !Array.isArray(layout.corridors)) {
        return false;
      }

      const rooms = layout.rooms;
      const corridors = layout.corridors;

      if (rooms.length < cfg.minRooms || rooms.length > cfg.maxRooms) {
        return false;
      }

      const startRooms = rooms.filter((r) => r.type === 'start');
      const supplyRooms = rooms.filter((r) => r.type === 'supply');
      const combatRooms = rooms.filter((r) => r.type === 'combat');
      const bossRooms = rooms.filter((r) => r.type === 'boss');
      if (
        startRooms.length !== 1 ||
        supplyRooms.length < 1 ||
        combatRooms.length < 1 ||
        bossRooms.length !== 1
      ) {
        return false;
      }

      // 1. 월드 경계 포함 검사 및 방 간 비겹침 검사
      for (let i = 0; i < rooms.length; i++) {
        const a = rooms[i];
        if (
          a.x < cfg.wallThickness ||
          a.y < cfg.wallThickness ||
          a.x + a.width > layout.worldWidth - cfg.wallThickness ||
          a.y + a.height > layout.worldHeight - cfg.wallThickness
        ) {
          return false;
        }

        for (let j = i + 1; j < rooms.length; j++) {
          const b = rooms[j];
          if (
            a.x < b.x + b.width + cfg.wallThickness * 2 &&
            a.x + a.width + cfg.wallThickness * 2 > b.x &&
            a.y < b.y + b.height + cfg.wallThickness * 2 &&
            a.y + a.height + cfg.wallThickness * 2 > b.y
          ) {
            return false;
          }
        }
      }

      // 2. 복도가 연결 대상 외 다른 방과 겹치지 않으며 양 끝 방과 정확히 맞닿는지 검증
      const roomMap = new Map(rooms.map((r) => [r.id, r]));
      const adj = new Map(rooms.map((r) => [r.id, new Set()]));

      for (let i = 0; i < corridors.length; i++) {
        const c = corridors[i];
        const rFrom = roomMap.get(c.fromRoomId);
        const rTo = roomMap.get(c.toRoomId);
        if (!rFrom || !rTo || c.width < 60 || c.height < 60) {
          return false;
        }

        // 연결된 두 방 외 다른 방 내부 침범 여부 확인
        for (let r = 0; r < rooms.length; r++) {
          const other = rooms[r];
          if (other.id === rFrom.id || other.id === rTo.id) continue;
          if (
            c.x < other.x + other.width &&
            c.x + c.width > other.x &&
            c.y < other.y + other.height &&
            c.y + c.height > other.y
          ) {
            return false;
          }
        }

        adj.get(rFrom.id).add(rTo.id);
        adj.get(rTo.id).add(rFrom.id);
      }

      // 3. 시작 방으로부터 모든 방 도달 가능 여부(BFS) 검증
      const startId = startRooms[0].id;
      const visited = new Set([startId]);
      const queue = [startId];

      while (queue.length > 0) {
        const cur = queue.shift();
        for (const nxt of adj.get(cur) || []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }

      if (visited.size !== rooms.length) {
        return false;
      }

      // 4. 임시 OfficeMap 인스턴스를 생성하여 실제 고체 벽·장애물과 스폰 지점 충돌 0건 검증
      if (PO.OfficeMap) {
        const tempMap = new PO.OfficeMap(layout);
        const solids = tempMap.getSolidObstacles();

        const hitsSolid = (cx, cy, rad) => {
          for (let i = 0; i < solids.length; i++) {
            const s = solids[i];
            const kx = Math.max(s.x, Math.min(cx, s.x + s.width));
            const ky = Math.max(s.y, Math.min(cy, s.y + s.height));
            if ((cx - kx) ** 2 + (cy - ky) ** 2 < rad * rad) {
              return true;
            }
          }
          return false;
        };

        const ps = layout.playerSpawn;
        if (!ps || tempMap.getRoomAt(ps.x, ps.y)?.id !== startId || hitsSolid(ps.x, ps.y, 18)) {
          return false;
        }

        for (let i = 0; i < layout.enemySpawns.length; i++) {
          const es = layout.enemySpawns[i];
          const er = tempMap.getRoomAt(es.x, es.y);
          if (!er || er.type === 'start' || hitsSolid(es.x, es.y, 19)) {
            return false;
          }
        }

        if (layout.bossSpawn) {
          const bs = layout.bossSpawn;
          const br = tempMap.getRoomAt(bs.x, bs.y);
          if (!br || br.type !== 'boss' || hitsSolid(bs.x, bs.y, 30)) {
            return false;
          }
        }

        if (layout.escapeDeviceSpawn) {
          const es = layout.escapeDeviceSpawn;
          const er = tempMap.getRoomAt(es.x, es.y);
          if (!er || er.type !== 'boss' || hitsSolid(es.x, es.y, 20)) {
            return false;
          }
        }

        if (!layout.itemSpawns || layout.itemSpawns.length < 2) {
          return false;
        }
        for (let i = 0; i < layout.itemSpawns.length; i++) {
          const is = layout.itemSpawns[i];
          if (!tempMap.getRoomAt(is.x, is.y) || hitsSolid(is.x, is.y, 18)) {
            return false;
          }
        }
      }

      return true;
    }

    static _rectIntersectsAny(rect, list, pad = 0) {
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        if (
          rect.x - pad < o.x + o.width &&
          rect.x + rect.width + pad > o.x &&
          rect.y - pad < o.y + o.height &&
          rect.y + rect.height + pad > o.y
        ) {
          return true;
        }
      }
      return false;
    }

    static _subtract1D(start, end, cuts) {
      if (end <= start) return [];
      if (!cuts || cuts.length === 0) return [[start, end]];

      const sorted = cuts.slice().sort((a, b) => a[0] - b[0]);
      const res = [];
      let cur = start;
      for (let i = 0; i < sorted.length; i++) {
        const [cs, ce] = sorted[i];
        if (cs > cur + 1) {
          res.push([cur, Math.min(end, cs)]);
        }
        cur = Math.max(cur, ce);
      }
      if (cur < end - 1) {
        res.push([cur, end]);
      }
      return res;
    }
  }

  PO.RANDOM_MAP_CONFIG = RANDOM_MAP_CONFIG;
  PO.SeededRandom = SeededRandom;
  PO.RandomMapGenerator = RandomMapGenerator;
})(window);

