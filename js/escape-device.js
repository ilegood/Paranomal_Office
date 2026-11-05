(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * Phase 11: 탈출 장치 기본 설정값
   * - 비상 탈출 엘리베이터 (Emergency Escape Elevator)
   * - 보스 처치 전: 붉은 경고등 및 보안 잠금(비활성화)
   * - 보스 처치 후: 에메랄드 그린 비상 조명 가동 및 도어 개방(활성화)
   */
  const ESCAPE_DEVICE_CONFIG = Object.freeze({
    id: 'escape-device-elevator',
    name: '비상 탈출 엘리베이터',
    subName: '야근 탈출용 비상 게이트',
    width: 92,
    height: 52,
    zHeight: 70,
    interactionRange: 72,
    colliderRadius: 36
  });

  /**
   * 탈출 장치 엔티티 클래스
   * - 보스 방 클리어/보스 사망 상태와 연동하여 활성화 상태 전환
   * - 플레이어 접근 시 [E] 키 탈출 상호작용 안내 제공
   * - 런 1회당 1회만 탈출 처리
   */
  class EscapeDevice {
    constructor(config = {}) {
      this.id = config.id || ESCAPE_DEVICE_CONFIG.id;
      this.name = config.name || ESCAPE_DEVICE_CONFIG.name;
      this.subName = config.subName || ESCAPE_DEVICE_CONFIG.subName;
      this.roomId = config.roomId || 'room-boss';

      // 쿼터뷰 바닥 접지면 중심 좌표
      this.position = {
        x: config.x ?? 1200,
        y: config.y ?? 400
      };

      this.width = config.width || ESCAPE_DEVICE_CONFIG.width;
      this.height = config.height || ESCAPE_DEVICE_CONFIG.height;
      this.zHeight = config.zHeight || ESCAPE_DEVICE_CONFIG.zHeight;
      this.interactionRange = config.interactionRange || ESCAPE_DEVICE_CONFIG.interactionRange;
      this.colliderRadius = config.colliderRadius || ESCAPE_DEVICE_CONFIG.colliderRadius;

      // 활성화 및 상호작용 상태
      this.isActive = false;
      this.isFocused = false;
      this.hasEscaped = false;

      // 시각 애니메이션 타이머 (펄스 링, 조명 깜빡임)
      this.animPhase = 0;
      this.pulseTimer = 0;
    }

    get x() {
      return this.position.x;
    }

    set x(val) {
      this.position.x = val;
    }

    get y() {
      return this.position.y;
    }

    set y(val) {
      this.position.y = val;
    }

    getSortY() {
      return this.position.y;
    }

    /**
     * 보스 사망 여부 또는 전투 방 클리어 여부와 실시간 연동
     */
    update(dt, player, boss = null, combatRoomSystem = null) {
      this.animPhase += dt;
      this.pulseTimer = (this.pulseTimer + dt) % 2.0;

      // 1. 활성화 상태 동기화: 보스가 사망했거나 보스 방이 Cleared 상태이면 활성화
      const bossDead = Boolean(boss && (boss.isDead() || boss.hp <= 0));
      const roomCleared = Boolean(
        combatRoomSystem &&
          typeof combatRoomSystem.isBossRoomCleared === 'function' &&
          combatRoomSystem.isBossRoomCleared()
      );

      this.isActive = bossDead || roomCleared;

      // 2. 플레이어와의 거리 및 상호작용 가능 여부 판정
      if (!player || player.isDead) {
        this.isFocused = false;
        return;
      }

      const dx = player.position.x - this.position.x;
      const dy = player.position.y - this.position.y;
      const dist = Math.hypot(dx, dy);

      this.isFocused = dist <= this.interactionRange;
    }

    /**
     * 플레이어가 활성화된 탈출 장치와 상호작용 가능한 상태인지 확인
     */
    canInteract(player) {
      return (
        this.isActive &&
        !this.hasEscaped &&
        this.isFocused &&
        player &&
        !player.isDead &&
        player.hp > 0
      );
    }

    /**
     * 상호작용 안내 프롬프트 UI 데이터 반환
     */
    getPrompt() {
      if (!this.isFocused || this.hasEscaped) {
        return null;
      }

      if (this.isActive) {
        return {
          itemId: this.id,
          keyLabel: 'E',
          title: `${this.name} 탑승`,
          detail: 'E 키를 눌러 야근 탈출 (런 성공 종료)',
          canPickup: true,
          isEscape: true
        };
      }

      return {
        itemId: this.id,
        keyLabel: '잠김',
        title: `${this.name} (보안 잠금)`,
        detail: '야근 감독관을 처치해야 비상 전원이 가동됩니다',
        canPickup: false,
        isEscape: true
      };
    }

    /**
     * 탈출 시도 실행 (성공 시 1회만 처리)
     */
    tryInteract(player) {
      if (!this.canInteract(player)) {
        return false;
      }

      this.hasEscaped = true;
      return true;
    }

    /**
     * 새 런 시작 시 상태 초기화
     */
    reset(newConfig = null) {
      if (newConfig) {
        if (newConfig.x !== undefined) this.position.x = newConfig.x;
        if (newConfig.y !== undefined) this.position.y = newConfig.y;
        if (newConfig.roomId !== undefined) this.roomId = newConfig.roomId;
      }
      this.isActive = false;
      this.isFocused = false;
      this.hasEscaped = false;
      this.animPhase = 0;
      this.pulseTimer = 0;
    }
  }

  PO.ESCAPE_DEVICE_CONFIG = ESCAPE_DEVICE_CONFIG;
  PO.EscapeDevice = EscapeDevice;
})(window);

