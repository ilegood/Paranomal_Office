(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 고정된 테스트용 어두운 사무실 맵 데이터 및 경계/장애물 정의
   * (추후 방 템플릿이나 랜덤 맵 생성 시스템으로 교체/확장 가능하도록 데이터 구조화)
   */
  class OfficeMap {
    constructor() {
      // 논리 게임 월드 크기 (16:10 비율)
      this.width = 1280;
      this.height = 800;

      // 쿼터뷰 바닥 영역 (벽 안쪽 실제 이동 가능 바닥)
      this.floorRect = {
        x: 44,
        y: 132,
        width: 1192,
        height: 628
      };

      // 타일 그리드 크기 (쿼터뷰 원근감을 위해 세로가 약간 짧은 4:3 비율 타일)
      this.tileWidth = 64;
      this.tileHeight = 48;

      // 플레이어 시작 위치 (중앙 복도)
      this.spawnPoint = {
        x: 640,
        y: 455
      };

      // 바닥 장식 요소 (충돌 없음)
      this.floorMats = [
        { x: 565, y: 136, width: 150, height: 52, color: '#232c43', border: '#334061' },
        { x: 495, y: 410, width: 290, height: 110, color: '#1d2438', border: '#2c3754' }
      ];

      // 사무실 고정 장애물 목록
      // x, y, width, height는 바닥에 닿는 실제 충돌 영역(Footprint)이며,
      // zHeight는 쿼터뷰에서 위로 솟아오르는 시각적 높이
      this.obstacles = [
        // 서쪽 벽면 서류 캐비닛
        {
          id: 'cabinet-west',
          type: 'cabinet',
          x: 64,
          y: 384,
          width: 86,
          height: 46,
          zHeight: 58,
          solid: true
        },
        // 북동쪽 사무용 복합기 및 정수기 구역
        {
          id: 'copier-ne',
          type: 'copier',
          x: 1106,
          y: 150,
          width: 94,
          height: 48,
          zHeight: 46,
          solid: true
        },
        // 중앙 상단 팀장 책상
        {
          id: 'desk-manager',
          type: 'manager_desk',
          x: 545,
          y: 258,
          width: 190,
          height: 58,
          zHeight: 34,
          hasLamp: true,
          solid: true
        },
        // 좌측 상단 업무 책상
        {
          id: 'desk-nw',
          type: 'desk',
          x: 185,
          y: 268,
          width: 175,
          height: 56,
          zHeight: 32,
          monitorAlign: 'left',
          hasMug: true,
          solid: true
        },
        // 좌측 하단 업무 책상 (야근 스탠드 조명 켜짐)
        {
          id: 'desk-sw',
          type: 'desk',
          x: 185,
          y: 505,
          width: 175,
          height: 56,
          zHeight: 32,
          monitorAlign: 'right',
          hasLamp: true,
          solid: true
        },
        // 우측 상단 업무 책상
        {
          id: 'desk-ne',
          type: 'desk',
          x: 920,
          y: 268,
          width: 175,
          height: 56,
          zHeight: 32,
          monitorAlign: 'right',
          hasLamp: true,
          solid: true
        },
        // 우측 하단 업무 책상
        {
          id: 'desk-se',
          type: 'desk',
          x: 920,
          y: 505,
          width: 175,
          height: 56,
          zHeight: 32,
          monitorAlign: 'left',
          hasMug: true,
          solid: true
        },
        // 중앙 좌측 기둥 (쿼터뷰 전후 깊이감 및 엄폐물 검증용)
        {
          id: 'pillar-left',
          type: 'pillar',
          x: 452,
          y: 386,
          width: 48,
          height: 42,
          zHeight: 78,
          solid: true
        },
        // 중앙 우측 기둥
        {
          id: 'pillar-right',
          type: 'pillar',
          x: 780,
          y: 386,
          width: 48,
          height: 42,
          zHeight: 78,
          solid: true
        },
        // 중앙 하단 회의 테이블
        {
          id: 'meeting-table',
          type: 'meeting_table',
          x: 520,
          y: 606,
          width: 240,
          height: 62,
          zHeight: 30,
          solid: true
        }
      ];
    }

    /**
     * 엔티티의 바닥 충돌 반경(radius)을 고려한 이동 가능 경계 반환
     */
    getPlayableBounds(radius = 0) {
      const northWallPadding = 8;
      return {
        minX: this.floorRect.x + radius,
        maxX: this.floorRect.x + this.floorRect.width - radius,
        minY: this.floorRect.y + northWallPadding + radius,
        maxY: this.floorRect.y + this.floorRect.height - radius
      };
    }

    /**
     * 충돌 판정 대상 장애물 목록 반환
     */
    getSolidObstacles() {
      return this.obstacles.filter((obs) => obs.solid !== false);
    }
  }

  PO.OfficeMap = OfficeMap;
})(window);
