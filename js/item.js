(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 아이템 분류 상수
   */
  const ITEM_TYPES = Object.freeze({
    HEAL: 'heal',
    WEAPON_UPGRADE: 'weapon_upgrade'
  });

  /**
   * 프로토타입 고정 아이템 설정값 (플레이어 데이터와 완전히 분리 관리, 추후 신규 아이템 추가 용이)
   */
  const ITEM_CONFIGS = Object.freeze({
    medkit: Object.freeze({
      typeId: 'medkit',
      category: ITEM_TYPES.HEAL,
      name: '응급 구급상자',
      effectType: 'heal',
      effectParams: Object.freeze({
        healAmount: 30
      }),
      interactionRange: 58,
      radius: 16
    }),
    weapon_upgrade_module: Object.freeze({
      typeId: 'weapon_upgrade_module',
      category: ITEM_TYPES.WEAPON_UPGRADE,
      name: '무기 강화 모듈',
      effectType: 'weapon_upgrade',
      effectParams: Object.freeze({
        upgradeSteps: 1,
        bonusPercentPerStep: 25,
        maxUpgradeLevel: 3
      }),
      interactionRange: 58,
      radius: 16
    })
  });

  /**
   * 월드에 배치된 개별 아이템 데이터 모델 (플레이어와 별도 관리, 중복 획득 방지 상태 보유)
   */
  class WorldItem {
    constructor(spawnConfig) {
      const baseCfg = ITEM_CONFIGS[spawnConfig.configId];
      if (!baseCfg) {
        throw new Error(`알 수 없는 아이템 설정 ID입니다: ${spawnConfig.configId}`);
      }

      this.id = spawnConfig.id;
      this.typeId = baseCfg.typeId;
      this.category = baseCfg.category;
      this.name = spawnConfig.name ?? baseCfg.name;
      this.effectType = baseCfg.effectType;
      this.effectParams = { ...baseCfg.effectParams, ...(spawnConfig.effectParams || {}) };

      this.position = {
        x: spawnConfig.x,
        y: spawnConfig.y
      };
      this.radius = spawnConfig.radius ?? baseCfg.radius;
      this.interactionRange = spawnConfig.interactionRange ?? baseCfg.interactionRange;

      // 동일 아이템 반복 획득 방지 플래그
      this.collected = false;
      this.bobPhase = spawnConfig.initialPhase ?? 0;
    }

    getSortY() {
      return this.position.y;
    }
  }

  /**
   * 아이템 효과 판정 및 적용 전담 모듈 (아이템 맵 상호작용/획득 로직과 완전히 분리)
   * 추후 신규 아이템 종류 추가 시 registerEffect()로 핸들러만 등록하면 확장 가능.
   */
  class ItemEffectApplier {
    constructor() {
      this.handlers = new Map();
      this._registerDefaultEffects();
    }

    registerEffect(effectType, handler) {
      this.handlers.set(effectType, handler);
    }

    _registerDefaultEffects() {
      // 1. 회복 아이템 효과 핸들러 (응급 구급상자: 체력 +30, 최대 체력 100 초과 불가, 만땅 시 획득 불가)
      this.registerEffect('heal', {
        canApply(item, context) {
          const { player } = context;
          if (!player || player.isDead) {
            return { allowed: false, code: 'PLAYER_DEAD', reason: '획득할 수 없는 상태입니다.' };
          }
          if (player.hp >= player.maxHp) {
            return {
              allowed: false,
              code: 'FULL_HP',
              reason: `체력이 이미 최대입니다 (${player.hp} / ${player.maxHp})`
            };
          }
          return { allowed: true, code: null, reason: null };
        },

        apply(item, context) {
          const { player } = context;
          const healAmount = item.effectParams.healAmount ?? 30;
          const res = player.heal(healAmount);

          return {
            applied: res.applied,
            effectType: 'heal',
            itemName: item.name,
            healAmount,
            actualHealed: res.healed,
            prevHp: res.prevHp,
            currentHp: res.currentHp,
            maxHp: res.maxHp,
            bannerTitle: `${item.name} 획득`,
            bannerDetail: `체력 +${res.healed} 회복 (${res.prevHp} → ${res.currentHp})`,
            popupText: `+${res.healed} HP`,
            popupColor: '#4ade80'
          };
        },

        describePrompt(item, context) {
          const { player } = context;
          const healAmount = item.effectParams.healAmount ?? 30;
          if (player && player.hp >= player.maxHp) {
            return {
              canPickup: false,
              keyLabel: 'E',
              title: item.name,
              detail: `체력이 이미 최대입니다 (${player.hp} / ${player.maxHp})`
            };
          }
          return {
            canPickup: true,
            keyLabel: 'E',
            title: `${item.name} 획득`,
            detail: `체력 +${healAmount} 회복`
          };
        }
      });

      // 2. 무기 강화 아이템 효과 핸들러 (무기 강화 모듈: 기본 데미지의 +25%, 최대 3단계)
      this.registerEffect('weapon_upgrade', {
        canApply(item, context) {
          const { player, combat } = context;
          if (!player || player.isDead || !combat) {
            return { allowed: false, code: 'INVALID_STATE', reason: '획득할 수 없는 상태입니다.' };
          }
          if (!combat.canUpgradeWeapon()) {
            return {
              allowed: false,
              code: 'MAX_UPGRADE',
              reason: `최대 강화 단계입니다 (${combat.upgradeLevel} / ${combat.maxUpgradeLevel}단계)`
            };
          }
          return { allowed: true, code: null, reason: null };
        },

        apply(item, context) {
          const { combat } = context;
          const steps = item.effectParams.upgradeSteps ?? 1;
          const res = combat.upgradeWeapon(steps);

          return {
            applied: res.applied,
            effectType: 'weapon_upgrade',
            itemName: item.name,
            prevLevel: res.prevLevel,
            newLevel: res.newLevel,
            maxLevel: res.maxLevel,
            bonusPercent: res.bonusPercent,
            meleeDamage: res.meleeDamage,
            rangedDamage: res.rangedDamage,
            bannerTitle: `${item.name} 획득`,
            bannerDetail: `무기 강화 ${res.prevLevel}단계 → ${res.newLevel}단계 (데미지 +${res.bonusPercent}%)`,
            popupText: `무기 강화 ${res.prevLevel} → ${res.newLevel}단계!`,
            popupColor: '#fbbf24'
          };
        },

        describePrompt(item, context) {
          const { combat } = context;
          const bonusPct = item.effectParams.bonusPercentPerStep ?? 25;
          if (combat && !combat.canUpgradeWeapon()) {
            return {
              canPickup: false,
              keyLabel: 'E',
              title: item.name,
              detail: `최대 강화 단계입니다 (${combat.upgradeLevel} / ${combat.maxUpgradeLevel}단계)`
            };
          }
          const curLv = combat ? combat.upgradeLevel : 0;
          const nextLv = combat ? Math.min(combat.maxUpgradeLevel, curLv + 1) : 1;
          return {
            canPickup: true,
            keyLabel: 'E',
            title: `${item.name} 획득`,
            detail: `무기 데미지 +${bonusPct}% (${curLv} → ${nextLv}단계)`
          };
        }
      });
    }

    canApply(item, context) {
      const handler = this.handlers.get(item.effectType);
      if (!handler) {
        return { allowed: false, code: 'UNKNOWN_EFFECT', reason: '알 수 없는 아이템 효과입니다.' };
      }
      return handler.canApply(item, context);
    }

    apply(item, context) {
      const handler = this.handlers.get(item.effectType);
      if (!handler) {
        return { applied: false };
      }
      return handler.apply(item, context);
    }

    describePrompt(item, context) {
      const handler = this.handlers.get(item.effectType);
      if (!handler || !handler.describePrompt) {
        return {
          canPickup: true,
          keyLabel: 'E',
          title: `${item.name} 획득`,
          detail: '아이템 사용'
        };
      }
      return handler.describePrompt(item, context);
    }
  }

  /**
   * 월드 아이템 배치, 거리·벽 차폐 판정, E 키 획득 상호작용 및 시각 피드백 관리 시스템
   */
  class ItemSystem {
    constructor(initialItems = [], effectApplier = new ItemEffectApplier()) {
      this.effectApplier = effectApplier;
      this.items = initialItems.map((cfg) => (cfg instanceof WorldItem ? cfg : new WorldItem(cfg)));
      this.focusedItem = null;

      // 상단 중앙 HUD 알림 배너 상태 (회복량 / 강화 단계 변화 / 획득 불가 사유 표시)
      this.activeBanner = null;

      // 캔버스 플로팅 텍스트 및 획득 링 이펙트
      this.popups = [];
      this.pickupRings = [];
    }

    /**
     * 탐험 사무실 맵 보급 방 고정 배치 아이템 목록 반환 (회복 아이템 1개, 무기 강화 아이템 1개)
     */
    static createDefaultMapItems(officeMap = null) {
      if (officeMap && Array.isArray(officeMap.itemSpawns)) {
        return officeMap.itemSpawns.map((spawn) => ({ ...spawn }));
      }

      return [
        {
          id: 'item-medkit-1',
          configId: 'medkit',
          x: 1095,
          y: 310,
          initialPhase: 0
        },
        {
          id: 'item-upgrade-1',
          configId: 'weapon_upgrade_module',
          x: 1305,
          y: 310,
          initialPhase: 1.4
        }
      ];
    }

    getActiveItems() {
      return this.items.filter((item) => !item.collected);
    }

    /**
     * 매 프레임 아이템 부유 모션, 근접 상호작용 대상 탐색, 알림/이펙트 타이머 갱신
     */
    update(dt, player, combat, officeMap) {
      if (dt > 0) {
        for (let i = 0; i < this.items.length; i++) {
          this.items[i].bobPhase += dt * 3.4;
        }

        if (this.activeBanner) {
          this.activeBanner.elapsed += dt;
          if (this.activeBanner.elapsed >= this.activeBanner.duration) {
            this.activeBanner = null;
          }
        }

        for (let i = this.popups.length - 1; i >= 0; i--) {
          const p = this.popups[i];
          p.elapsed += dt;
          p.y -= dt * 26;
          if (p.elapsed >= p.duration) {
            this.popups.splice(i, 1);
          }
        }

        for (let i = this.pickupRings.length - 1; i >= 0; i--) {
          const ring = this.pickupRings[i];
          ring.elapsed += dt;
          if (ring.elapsed >= ring.duration) {
            this.pickupRings.splice(i, 1);
          }
        }
      }

      if (!player || player.isDead || !officeMap) {
        this.focusedItem = null;
        return;
      }

      this.focusedItem = this._findInteractableItem(player, officeMap);
    }

    /**
     * 플레이어가 E 키를 눌렀을 때 호출되는 아이템 획득 시도 (자동 획득 없음)
     */
    tryInteract(context) {
      const { player, combat, officeMap } = context;
      if (!player || player.isDead || !officeMap) {
        return { success: false, reason: 'invalid_state' };
      }

      // 최신 위치 기준으로 상호작용 가능 대상 재확인 (거리 + 벽 너머 차폐 확인)
      const targetItem = this._findInteractableItem(player, officeMap);
      this.focusedItem = targetItem;

      if (!targetItem) {
        return { success: false, reason: 'out_of_range_or_blocked' };
      }

      // 중복 획득 원천 차단
      if (targetItem.collected) {
        return { success: false, reason: 'already_collected' };
      }

      // 효과 적용 가능 여부 검사 (체력 최대치, 강화 최대치 등)
      const check = this.effectApplier.canApply(targetItem, { player, combat });
      if (!check.allowed) {
        this.activeBanner = {
          kind: 'blocked',
          title: targetItem.name,
          detail: check.reason || '현재 획득할 수 없습니다.',
          elapsed: 0,
          duration: 1.6
        };
        // 이전 안내용 팝업이 남아 있으면 겹치지 않도록 교체
        this.popups = this.popups.filter((p) => !p.isBlockedNotice);
        this.popups.push({
          x: player.position.x,
          y: player.position.y - 64,
          text: check.reason || '획득 불가',
          color: '#fca5a5',
          elapsed: 0,
          duration: 0.75,
          isBlockedNotice: true
        });
        return {
          success: false,
          blocked: true,
          code: check.code,
          reason: check.reason
        };
      }

      // 1. 먼저 획득 완료 표시 및 맵 목록에서 제거하여 중복 처리 완벽 방지
      targetItem.collected = true;
      const idx = this.items.indexOf(targetItem);
      if (idx !== -1) {
        this.items.splice(idx, 1);
      }
      this.focusedItem = this._findInteractableItem(player, officeMap);

      // 2. 분리된 효과 적용 모듈을 통해 실제 효과 반영
      const effectResult = this.effectApplier.apply(targetItem, { player, combat });

      // 3. UI 배너 및 캔버스 피드백 생성
      this.activeBanner = {
        kind: effectResult.effectType,
        title: effectResult.bannerTitle,
        detail: effectResult.bannerDetail,
        elapsed: 0,
        duration: 2.4
      };

      // 이전 차단 팝업이 남아 있으면 즉시 제거하여 회복/강화 팝업과 텍스트 겹침 방지
      this.popups = this.popups.filter((p) => !p.isBlockedNotice);
      this.popups.push({
        x: player.position.x,
        y: player.position.y - 68,
        text: effectResult.popupText,
        color: effectResult.popupColor || '#4ade80',
        elapsed: 0,
        duration: 0.9
      });

      this.pickupRings.push({
        x: targetItem.position.x,
        y: targetItem.position.y - 8,
        color: effectResult.popupColor || '#4ade80',
        maxRadius: 34,
        elapsed: 0,
        duration: 0.32
      });

      return {
        success: true,
        item: targetItem,
        effect: effectResult
      };
    }

    /**
     * 플레이어와의 거리 및 벽/장애물 차폐(벽 너머 여부)를 검사해 가장 가까운 상호작용 가능 아이템 반환
     */
    _findInteractableItem(player, officeMap) {
      let closest = null;
      let closestDist = Infinity;

      const px = player.position.x;
      const py = player.position.y;

      for (let i = 0; i < this.items.length; i++) {
        const item = this.items[i];
        if (item.collected) {
          continue;
        }

        const dist = Math.hypot(item.position.x - px, item.position.y - py);
        if (dist > item.interactionRange) {
          continue;
        }

        // 벽이나 고체 장애물 너머에 있는 아이템은 획득 안내 및 획득 불가 처리
        if (!this.hasLineOfSight(px, py, item.position.x, item.position.y, officeMap)) {
          continue;
        }

        if (dist < closestDist) {
          closestDist = dist;
          closest = item;
        }
      }

      return closest;
    }

    /**
     * 두 지점 사이에 맵 경계 외벽이나 고체 장애물(벽, 기둥, 책상, 캐비닛)이 가로막고 있는지 확인
     */
    hasLineOfSight(x1, y1, x2, y2, officeMap) {
      if (!officeMap) {
        return true;
      }

      const floor = officeMap.floorRect;
      if (
        x1 < floor.x ||
        x1 > floor.x + floor.width ||
        y1 < floor.y ||
        y1 > floor.y + floor.height ||
        x2 < floor.x ||
        x2 > floor.x + floor.width ||
        y2 < floor.y ||
        y2 > floor.y + floor.height
      ) {
        return false;
      }

      const obstacles = officeMap.getSolidObstacles();
      for (let i = 0; i < obstacles.length; i++) {
        if (this._segmentIntersectsRect(x1, y1, x2, y2, obstacles[i])) {
          return false;
        }
      }

      return true;
    }

    /**
     * 선분 (x1, y1)-(x2, y2)와 직사각형(rect) 교차 판정 (Liang-Barsky 알고리즘)
     */
    _segmentIntersectsRect(x1, y1, x2, y2, rect) {
      const minX = rect.x;
      const maxX = rect.x + rect.width;
      const minY = rect.y;
      const maxY = rect.y + rect.height;

      const dx = x2 - x1;
      const dy = y2 - y1;

      const p = [-dx, dx, -dy, dy];
      const q = [x1 - minX, maxX - x1, y1 - minY, maxY - y1];

      let t0 = 0;
      let t1 = 1;

      for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-8) {
          if (q[i] < 0) {
            return false;
          }
        } else {
          const r = q[i] / p[i];
          if (p[i] < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
          } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
          }
        }
      }

      return t0 <= t1;
    }

    /**
     * UI 표시용 아이템 안내 및 피드백 배너 상태 스냅샷 반환
     */
    getUIState(player, combat) {
      let prompt = null;
      if (this.focusedItem && !this.focusedItem.collected && player && !player.isDead) {
        const desc = this.effectApplier.describePrompt(this.focusedItem, { player, combat });
        prompt = {
          itemId: this.focusedItem.id,
          category: this.focusedItem.category,
          canPickup: desc.canPickup,
          keyLabel: desc.keyLabel,
          title: desc.title,
          detail: desc.detail
        };
      }

      let banner = null;
      if (this.activeBanner) {
        banner = {
          kind: this.activeBanner.kind,
          title: this.activeBanner.title,
          detail: this.activeBanner.detail
        };
      }

      return {
        prompt,
        banner
      };
    }
  }

  PO.ITEM_TYPES = ITEM_TYPES;
  PO.ITEM_CONFIGS = ITEM_CONFIGS;
  PO.WorldItem = WorldItem;
  PO.ItemEffectApplier = ItemEffectApplier;
  PO.ItemSystem = ItemSystem;
})(window);
