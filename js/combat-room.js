(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * Phase 9 전투 방 시스템 기본 설정값
   */
  const COMBAT_ROOM_CONFIG = Object.freeze({
    // 플레이어 충돌 반경(16px)과 문턱 깊이(8px)를 모두 통과해 방 내부로 완전히 진입한 기준 여백(px)
    entryMargin: 30,
    // 문 잠금 직전 방 경계/복도에 걸쳐 있던 소속 적을 방 안쪽으로 안전 복귀시키는 여백(px)
    enemyLockInMargin: 38,
    // "전투 시작!" 강조 표시 지속 시간(초) — 이후에도 전투 종료 전까지 "남은 적: N" 상시 표시
    startNoticeDuration: 1.6,
    // "방 클리어!" 완료 알림 표시 지속 시간(초)
    clearNoticeDuration: 2.0
  });

  /**
   * 전투 방 상태(Unvisited / Active / Cleared), 출입문 잠금/해제, 방별 독립 적 수 추적 및 전투 UI 상태를 총괄하는 시스템
   */
  class CombatRoomSystem {
    constructor(officeMap, enemySystem, config = {}, boss = null) {
      this.config = { ...COMBAT_ROOM_CONFIG, ...config };
      this.roomRecords = new Map();
      this.activeRoomId = null;
      this.boss = boss;

      // 전투 시작 / 방 클리어 배너 타이머 상태
      this.notice = null;

      this.init(officeMap, enemySystem, boss);
    }

    get activeRoom() {
      if (!this.activeRoomId) return null;
      const rec = this.roomRecords.get(this.activeRoomId);
      if (!rec) return null;
      return {
        id: rec.roomId,
        state: rec.room.state,
        isBossRoom: rec.isBossRoom,
        room: rec.room
      };
    }

    /**
     * Phase 11: 보스 방 클리어 완료 여부 확인
     */
    isBossRoomCleared() {
      for (const rec of this.roomRecords.values()) {
        if (rec.isBossRoom) {
          const clearedState = (PO.ROOM_STATES && PO.ROOM_STATES.CLEARED) || 'Cleared';
          return rec.hasCleared || rec.room.state === clearedState;
        }
      }
      return Boolean(this.boss && (this.boss.isDead() || this.boss.hp <= 0));
    }

    /**
     * Phase 11: 전체 전투 방에서 처치된 일반 적 총합 산출
     */
    getTotalDefeatedEnemies() {
      let count = 0;
      for (const rec of this.roomRecords.values()) {
        if (!rec.isBossRoom && rec.defeatedEnemyIds) {
          count += rec.defeatedEnemyIds.size;
        }
      }
      return count;
    }

    /**
     * 현재 맵과 적 목록 및 보스를 기준으로 방별 전투 상태 및 소속 적 로스터를 초기화
     * (시작 및 재시작 시 호출되어 이전 전투 데이터를 완전히 제거)
     */
    init(officeMap, enemySystem, boss = null) {
      this.roomRecords.clear();
      this.activeRoomId = null;
      this.notice = null;
      if (boss !== null && boss !== undefined) {
        this.boss = boss;
      }

      if (!officeMap || !Array.isArray(officeMap.rooms)) {
        return;
      }

      const roomStates = PO.ROOM_STATES || {
        UNVISITED: 'Unvisited',
        ACTIVE: 'Active',
        CLEARED: 'Cleared'
      };
      const roomTypes = PO.ROOM_TYPES || {
        START: 'start',
        COMBAT: 'combat',
        SUPPLY: 'supply',
        BOSS: 'boss'
      };

      // 모든 출입문 잠금 해제 상태로 초기화
      if (typeof officeMap.unlockAllDoors === 'function') {
        officeMap.unlockAllDoors();
      }

      // 1. 모든 방 데이터를 Unvisited 초기 상태로 설정하고 전투 방/보스 방 레코드 분리 생성
      for (let i = 0; i < officeMap.rooms.length; i++) {
        const room = officeMap.rooms[i];
        room.state = roomStates.UNVISITED;
        room.totalEnemies = 0;
        room.remainingEnemies = 0;
        room.enemyIds = [];

        const isCombat = room.type === roomTypes.COMBAT;
        const isBoss = room.type === roomTypes.BOSS;

        this.roomRecords.set(room.id, {
          roomId: room.id,
          room,
          isCombatRoom: isCombat || isBoss,
          isBossRoom: isBoss,
          assignedEnemyIds: new Set(),
          defeatedEnemyIds: new Set(),
          totalEnemies: 0,
          remainingEnemies: 0,
          hasStarted: false,
          hasCleared: false
        });
      }

      // 2. 생성된 적들을 각 일반 전투 방의 독립 적 목록에 귀속
      const enemies =
        enemySystem && Array.isArray(enemySystem.enemies) ? enemySystem.enemies : [];

      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        let ownerRoomId = enemy.roomId || null;

        if (!ownerRoomId && typeof officeMap.getRoomAt === 'function') {
          const foundRoom = officeMap.getRoomAt(enemy.position.x, enemy.position.y);
          ownerRoomId = foundRoom ? foundRoom.id : null;
          enemy.roomId = ownerRoomId;
        }

        if (!ownerRoomId || !this.roomRecords.has(ownerRoomId)) {
          continue;
        }

        const record = this.roomRecords.get(ownerRoomId);
        // 보스 방에는 일반 적을 귀속하지 않음
        if (!record.isCombatRoom || record.isBossRoom) {
          continue;
        }

        record.assignedEnemyIds.add(enemy.id);
        if (enemy.isDead() || !enemy.alive) {
          record.defeatedEnemyIds.add(enemy.id);
        }
      }

      // 3. 각 방 데이터에 초기 적 목록 및 남은 적 수 반영
      for (const record of this.roomRecords.values()) {
        if (record.isBossRoom) {
          record.totalEnemies = 1;
          record.remainingEnemies = this.boss && !this.boss.isDead() ? 1 : 0;
          record.room.totalEnemies = 1;
          record.room.remainingEnemies = record.remainingEnemies;
          record.room.enemyIds = this.boss ? [this.boss.id] : [];
          continue;
        }

        record.totalEnemies = record.assignedEnemyIds.size;
        record.remainingEnemies = Math.max(
          0,
          record.totalEnemies - record.defeatedEnemyIds.size
        );
        record.room.totalEnemies = record.totalEnemies;
        record.room.remainingEnemies = record.remainingEnemies;
        record.room.enemyIds = Array.from(record.assignedEnemyIds);
      }
    }

    /**
     * 플레이어 이동 직후 전투 방 진입 여부를 즉시 검사하여 문 잠금 지연(1프레임 틈)을 방지
     */
    checkPlayerEntry(player, officeMap, enemySystem, isGameOver = false, boss = null) {
      if (boss !== null && boss !== undefined) {
        this.boss = boss;
      }
      if (isGameOver || !player || player.isDead || !officeMap) {
        return false;
      }

      // 먼저 최신 적 생존 상태를 동기화하여 이미 적이 모두 처치된 방인지 정확히 판단
      this._syncAllRoomEnemyCounts(enemySystem, this.boss);

      if (this.activeRoomId) {
        return false;
      }

      const enteredRoom = this._findEnteredRoomWithMargin(
        player.position.x,
        player.position.y,
        officeMap,
        this.config.entryMargin
      );

      if (!enteredRoom) {
        return false;
      }

      const record = this.roomRecords.get(enteredRoom.id);
      if (!record || !record.isCombatRoom) {
        // 시작 방(start) 및 보급 방(supply)은 전투 방으로 처리하지 않고 자유 이동 보장
        return false;
      }

      const roomStates = PO.ROOM_STATES || {
        UNVISITED: 'Unvisited',
        ACTIVE: 'Active',
        CLEARED: 'Cleared'
      };

      // 이미 클리어했거나 진행 완료된 방은 재진입 시 절대 재시작하지 않음
      if (
        record.hasStarted ||
        record.hasCleared ||
        record.room.state === roomStates.CLEARED ||
        record.room.state === roomStates.ACTIVE
      ) {
        return false;
      }

      // 방에 생존 중인 적이 존재하는 경우에만 전투 시작 및 출입문 잠금 수행
      if (record.remainingEnemies > 0) {
        this._startCombatInRoom(record, player, officeMap, enemySystem);
        return true;
      }

      // 적이 존재하지 않는 방(사전 처치 등)은 문을 잠그지 않고 즉시 Cleared 전환
      record.hasStarted = true;
      record.hasCleared = true;
      record.room.state = roomStates.CLEARED;
      return false;
    }

    /**
     * 매 프레임 적/보스 사망 집계, 전투 완료(문 개방) 판정, 전투 진입 확인 및 알림 타이머 갱신
     */
    update(dt, player, officeMap, enemySystem, isGameOver = false, boss = null) {
      if (boss !== null && boss !== undefined) {
        this.boss = boss;
      }
      if (dt > 0 && this.notice) {
        this.notice.elapsed += dt;
        if (this.notice.elapsed >= this.notice.duration) {
          this.notice = null;
        }
      }

      if (!officeMap) {
        return;
      }

      // 1. 모든 전투 방 및 보스 방의 독립 적/보스 목록을 기준으로 사망 여부 갱신
      this._syncAllRoomEnemyCounts(enemySystem, this.boss);

      // 2. 진행 중인 전투 방(Active)의 남은 적 수가 0이 되면 즉시 클리어 및 출입문 잠금 해제
      if (this.activeRoomId) {
        const activeRecord = this.roomRecords.get(this.activeRoomId);
        if (activeRecord && activeRecord.remainingEnemies === 0 && !activeRecord.hasCleared) {
          this._completeCombatInRoom(activeRecord, officeMap);
        }
      }

      // 3. 활성 전투가 없을 때 플레이어가 새로운 전투 방에 진입했는지 확인
      if (!this.activeRoomId && !isGameOver && player && !player.isDead) {
        this.checkPlayerEntry(player, officeMap, enemySystem, isGameOver, this.boss);
      }
    }

    /**
     * 각 전투 방의 고유 적 ID 집합 및 보스 상태를 조회하여 사망 이벤트를 단 1회만 반영
     * (적이 방 밖으로 이동했거나 사망 후 배열에서 제거된 경우에도 정확히 반영)
     */
    _syncAllRoomEnemyCounts(enemySystem, boss = null) {
      if (boss !== null && boss !== undefined) {
        this.boss = boss;
      }
      const liveMap = new Map();
      if (enemySystem && Array.isArray(enemySystem.enemies)) {
        for (let i = 0; i < enemySystem.enemies.length; i++) {
          const e = enemySystem.enemies[i];
          liveMap.set(e.id, e);
        }
      }

      for (const record of this.roomRecords.values()) {
        if (!record.isCombatRoom) {
          continue;
        }

        if (record.isBossRoom) {
          const bossAlive = Boolean(this.boss && !this.boss.isDead() && this.boss.alive);
          record.remainingEnemies = bossAlive ? 1 : 0;
          record.room.remainingEnemies = record.remainingEnemies;
          continue;
        }

        for (const enemyId of record.assignedEnemyIds) {
          if (record.defeatedEnemyIds.has(enemyId)) {
            continue;
          }
          const enemy = liveMap.get(enemyId);
          if (!enemy || enemy.isDead() || !enemy.alive) {
            record.defeatedEnemyIds.add(enemyId);
          }
        }

        const remaining = Math.max(
          0,
          record.assignedEnemyIds.size - record.defeatedEnemyIds.size
        );
        record.remainingEnemies = remaining;
        record.room.remainingEnemies = remaining;
      }
    }

    /**
     * 전투 방 진입 확정 시 Active 상태 전환, 소속 적 경계 정렬, 출입문 물리 잠금 및 UI 알림 트리거
     */
    _startCombatInRoom(record, player, officeMap, enemySystem) {
      const roomStates = PO.ROOM_STATES || {
        UNVISITED: 'Unvisited',
        ACTIVE: 'Active',
        CLEARED: 'Cleared'
      };

      record.hasStarted = true;
      record.room.state = roomStates.ACTIVE;
      this.activeRoomId = record.roomId;

      if (record.isBossRoom) {
        if (this.boss && typeof this.boss.awaken === 'function') {
          this.boss.awaken();
        }
        if (typeof officeMap.setRoomDoorsLocked === 'function') {
          officeMap.setRoomDoorsLocked(record.roomId, true);
        }
        this.notice = {
          kind: 'start',
          roomId: record.roomId,
          roomName: record.room.name,
          title: '보스 출현!',
          elapsed: 0,
          duration: this.config.startNoticeDuration
        };
        return;
      }

      // 소속 적 중 문턱이나 복도 쪽으로 나와 있던 생존 적이 있다면 문 잠금 직전 방 안쪽으로 안전 배치
      this._ensureAssignedEnemiesInsideRoom(record, player, officeMap, enemySystem);

      // 해당 전투 방의 모든 출입문을 실제로 잠금 (충돌체 즉시 반영)
      if (typeof officeMap.setRoomDoorsLocked === 'function') {
        officeMap.setRoomDoorsLocked(record.roomId, true);
      }

      this.notice = {
        kind: 'start',
        roomId: record.roomId,
        roomName: record.room.name,
        title: '전투 시작!',
        elapsed: 0,
        duration: this.config.startNoticeDuration
      };
    }

    /**
     * 전투 방의 남은 적 수가 0이 되었을 때 단 1회 Cleared 전환, 출입문 잠금 해제 및 완료 UI 표시
     */
    _completeCombatInRoom(record, officeMap) {
      if (record.hasCleared) {
        return;
      }

      const roomStates = PO.ROOM_STATES || {
        UNVISITED: 'Unvisited',
        ACTIVE: 'Active',
        CLEARED: 'Cleared'
      };

      record.hasCleared = true;
      record.remainingEnemies = 0;
      record.room.remainingEnemies = 0;
      record.room.state = roomStates.CLEARED;

      if (this.activeRoomId === record.roomId) {
        this.activeRoomId = null;
      }

      // 해당 전투 방의 출입문 잠금 해제 (실제 충돌체 즉시 제거)
      if (typeof officeMap.setRoomDoorsLocked === 'function') {
        officeMap.setRoomDoorsLocked(record.roomId, false);
      }

      this.notice = {
        kind: 'clear',
        roomId: record.roomId,
        roomName: record.room.name,
        title: record.isBossRoom ? '보스 처치 완료!' : '방 클리어!',
        elapsed: 0,
        duration: this.config.clearNoticeDuration
      };
    }

    /**
     * 문이 잠기는 순간 소속 적이 문 충돌체와 겹치거나 복도 바깥에 고립되지 않도록 방 내부 유효 지점으로 보정
     */
    _ensureAssignedEnemiesInsideRoom(record, player, officeMap, enemySystem) {
      if (!enemySystem || !Array.isArray(enemySystem.enemies)) {
        return;
      }

      const room = record.room;
      const margin = this.config.enemyLockInMargin;
      const minX = room.x + margin;
      const maxX = room.x + room.width - margin;
      const minY = room.y + margin;
      const maxY = room.y + room.height - margin;
      const obstacles = (officeMap.obstacles || []).filter(
        (obs) => obs.solid !== false && (!obs.roomId || obs.roomId === room.id)
      );

      const hitsObstacle = (cx, cy, r) => {
        for (let i = 0; i < obstacles.length; i++) {
          const o = obstacles[i];
          const kx = Math.max(o.x, Math.min(cx, o.x + o.width));
          const ky = Math.max(o.y, Math.min(cy, o.y + o.height));
          if ((cx - kx) ** 2 + (cy - ky) ** 2 < (r + 4) ** 2) {
            return true;
          }
        }
        return false;
      };

      for (let i = 0; i < enemySystem.enemies.length; i++) {
        const enemy = enemySystem.enemies[i];
        if (
          !record.assignedEnemyIds.has(enemy.id) ||
          enemy.isDead() ||
          !enemy.alive
        ) {
          continue;
        }

        const ex = enemy.position.x;
        const ey = enemy.position.y;
        const alreadyInside = ex >= minX && ex <= maxX && ey >= minY && ey <= maxY;
        if (alreadyInside) {
          continue;
        }

        let targetX = Math.max(minX, Math.min(maxX, ex));
        let targetY = Math.max(minY, Math.min(maxY, ey));

        if (
          hitsObstacle(targetX, targetY, enemy.colliderRadius) ||
          (player && Math.hypot(targetX - player.position.x, targetY - player.position.y) < 42)
        ) {
          // 방 중심 부근 안전 구역으로 이동
          targetX = room.x + room.width * 0.5;
          targetY = room.y + room.height * 0.5;
        }

        enemy.position.x = targetX;
        enemy.position.y = targetY;
      }
    }

    _findEnteredRoomWithMargin(px, py, officeMap, margin) {
      for (let i = 0; i < officeMap.rooms.length; i++) {
        const r = officeMap.rooms[i];
        const safeMarginX = Math.min(margin, r.width * 0.25);
        const safeMarginY = Math.min(margin, r.height * 0.25);
        if (
          px >= r.x + safeMarginX &&
          px <= r.x + r.width - safeMarginX &&
          py >= r.y + safeMarginY &&
          py <= r.y + r.height - safeMarginY
        ) {
          return r;
        }
      }
      return null;
    }

    /**
     * 특정 방의 현재 전투 요약 정보 조회 헬퍼
     */
    getRoomStatus(roomId) {
      const record = this.roomRecords.get(roomId);
      if (!record) {
        return null;
      }
      return {
        roomId: record.roomId,
        state: record.room.state,
        isCombatRoom: record.isCombatRoom,
        isBossRoom: Boolean(record.isBossRoom),
        totalEnemies: record.totalEnemies,
        remainingEnemies: record.remainingEnemies,
        hasStarted: record.hasStarted,
        hasCleared: record.hasCleared
      };
    }

    /**
     * HUD 전투 상태 패널 동기화용 데이터 반환
     */
    getUIState() {
      if (this.activeRoomId) {
        const activeRecord = this.roomRecords.get(this.activeRoomId);
        if (activeRecord) {
          const isStartPhase =
            Boolean(this.notice) &&
            this.notice.kind === 'start' &&
            this.notice.roomId === activeRecord.roomId;

          if (activeRecord.isBossRoom) {
            return {
              visible: true,
              isBoss: true,
              mode: isStartPhase ? 'start' : 'active',
              title: isStartPhase ? '보스 출현!' : '보스 전투 진행 중',
              counterText: '야근 감독관',
              remainingEnemies: activeRecord.remainingEnemies,
              totalEnemies: 1,
              roomName: activeRecord.room.name,
              detailText: `${activeRecord.room.name} · 출입문 잠김`,
              opacity: 1
            };
          }

          return {
            visible: true,
            isBoss: false,
            mode: isStartPhase ? 'start' : 'active',
            title: isStartPhase ? '전투 시작!' : '전투 진행 중',
            counterText: `남은 적: ${activeRecord.remainingEnemies}`,
            remainingEnemies: activeRecord.remainingEnemies,
            totalEnemies: activeRecord.totalEnemies,
            roomName: activeRecord.room.name,
            detailText: `${activeRecord.room.name} · 출입문 잠김`,
            opacity: 1
          };
        }
      }

      if (this.notice && this.notice.kind === 'clear') {
        const remainingTime = Math.max(0, this.notice.duration - this.notice.elapsed);
        const fadeOutWindow = 0.38;
        const opacity =
          remainingTime < fadeOutWindow ? Math.max(0, remainingTime / fadeOutWindow) : 1;

        return {
          visible: true,
          mode: 'clear',
          title: this.notice.title || '방 클리어!',
          counterText: '남은 적: 0',
          remainingEnemies: 0,
          totalEnemies: 0,
          roomName: this.notice.roomName,
          detailText: `${this.notice.roomName} · 출입문 개방`,
          opacity: Number(opacity.toFixed(3))
        };
      }

      return {
        visible: false,
        mode: 'idle',
        title: '',
        counterText: '',
        remainingEnemies: 0,
        totalEnemies: 0,
        roomName: '',
        detailText: '',
        opacity: 0
      };
    }
  }

  PO.COMBAT_ROOM_CONFIG = COMBAT_ROOM_CONFIG;
  PO.CombatRoomSystem = CombatRoomSystem;
})(window);
