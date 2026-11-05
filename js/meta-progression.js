/**
 * @file meta-progression.js
 * Paranormal Office - Phase 12: 영구 재화(야근 수당) 획득, 로컬 저장소 저장 및 영구 강화 시스템
 */
(function (global) {
  'use strict';

  global.PO = global.PO || {};
  const PO = global.PO;

  /**
   * 영구 메타 프로그레션 설정 상수
   */
  const META_CONFIG = {
    STORAGE_KEY: 'PARANORMAL_OFFICE_META_SAVE_V1',

    // 런 보상 수치
    REWARD: {
      PER_KILL: 10,       // 일반 적 1마리 처치당 야근 수당
      BOSS_KILL: 100      // 보스(야근 감독관) 처치 시 야근 수당
    },

    // 영구 강화 항목 정의
    UPGRADES: {
      maxHp: {
        id: 'maxHp',
        name: '최대 체력 증진',
        icon: '❤️',
        desc: '강인한 야근 체력을 길러 기본 및 최대 체력을 증가시킵니다.',
        maxLevel: 5,
        costs: [50, 100, 180, 280, 420],
        bonusPerLevel: 15, // 단계당 +15 HP
        getEffectText: (lvl) => `최대 체력 +${lvl * 15} HP (기본 100 → ${100 + lvl * 15})`,
        getNextEffectText: (lvl) => lvl >= 5 ? '최고 단계 도달' : `최대 체력 +${(lvl + 1) * 15} HP (다음: ${100 + (lvl + 1) * 15})`
      },
      attackPower: {
        id: 'attackPower',
        name: '공격력 인상',
        icon: '⚔️',
        desc: '사내 업무 도구의 살상력을 영구 개조하여 모든 무기 공격력을 증가시킵니다.',
        maxLevel: 5,
        costs: [60, 120, 200, 320, 480],
        bonusPerLevel: 4, // 단계당 +4 공격력
        getEffectText: (lvl) => `모든 공격 피해량 +${lvl * 4}`,
        getNextEffectText: (lvl) => lvl >= 5 ? '최고 단계 도달' : `모든 공격 피해량 +${(lvl + 1) * 4} (다음: +${(lvl + 1) * 4})`
      },
      dashCooldown: {
        id: 'dashCooldown',
        name: '신속 대시 연마',
        icon: '⚡',
        desc: '위기 순간 긴급 회피 동작을 최적화하여 대시 쿨다운을 감소시킵니다.',
        maxLevel: 5,
        costs: [50, 110, 190, 300, 450],
        bonusPerLevel: 0.12, // 단계당 -0.12초
        getEffectText: (lvl) => `대시 쿨다운 -${(lvl * 0.12).toFixed(2)}s (기본 1.20s → ${(1.20 - lvl * 0.12).toFixed(2)}s)`,
        getNextEffectText: (lvl) => lvl >= 5 ? '최고 단계 도달' : `대시 쿨다운 -${((lvl + 1) * 0.12).toFixed(2)}s (다음: ${(1.20 - (lvl + 1) * 0.12).toFixed(2)}s)`
      }
    }
  };

  /**
   * 영구 메타 프로그레션 매니저 클래스
   */
  class MetaProgressionSystem {
    constructor(options = {}) {
      this.storageKey = options.storageKey || META_CONFIG.STORAGE_KEY;
      this.listeners = new Set();

      this.data = this._createDefaultData();
      this.load();
    }

    /**
     * 안전한 기본 저장 데이터 생성
     */
    _createDefaultData() {
      return {
        version: 1,
        currency: 0, // 보유 야근 수당
        upgrades: {
          maxHp: 0,
          attackPower: 0,
          dashCooldown: 0
        },
        stats: {
          totalRuns: 0,
          totalKills: 0,
          bossKills: 0,
          escapes: 0,
          totalEarned: 0
        }
      };
    }

    /**
     * 로컬 저장소로부터 데이터 로드 (오류 및 손상 시 안전 복구)
     */
    load() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) {
          return this.data;
        }

        const raw = window.localStorage.getItem(this.storageKey);
        if (!raw) {
          this.data = this._createDefaultData();
          this.save();
          return this.data;
        }

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Invalid save structure');
        }

        const defaults = this._createDefaultData();
        this.data = {
          version: parsed.version || defaults.version,
          currency: Math.max(0, Number(parsed.currency) || 0),
          upgrades: {
            maxHp: Math.min(META_CONFIG.UPGRADES.maxHp.maxLevel, Math.max(0, Number(parsed.upgrades?.maxHp) || 0)),
            attackPower: Math.min(META_CONFIG.UPGRADES.attackPower.maxLevel, Math.max(0, Number(parsed.upgrades?.attackPower) || 0)),
            dashCooldown: Math.min(META_CONFIG.UPGRADES.dashCooldown.maxLevel, Math.max(0, Number(parsed.upgrades?.dashCooldown) || 0))
          },
          stats: {
            ...defaults.stats,
            ...(parsed.stats || {})
          }
        };

        return this.data;
      } catch (err) {
        console.warn('[MetaProgression] Failed to load data, resetting to defaults:', err);
        this.data = this._createDefaultData();
        this.save();
        return this.data;
      }
    }

    /**
     * 로컬 저장소에 현재 데이터 저장
     */
    save() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        }
      } catch (err) {
        console.warn('[MetaProgression] Failed to save data to localStorage:', err);
      }
      this._notifyChange();
    }

    /**
     * 저장 데이터 완전 초기화 (테스트 및 디버그용)
     */
    reset() {
      this.data = this._createDefaultData();
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(this.storageKey);
        }
      } catch (_) {}
      this.save();
    }

    /**
     * 변경 리스너 등록
     */
    subscribe(listener) {
      if (typeof listener === 'function') {
        this.listeners.add(listener);
      }
      return () => this.listeners.delete(listener);
    }

    _notifyChange() {
      for (const listener of this.listeners) {
        try {
          listener(this.data);
        } catch (e) {
          console.error('[MetaProgression] Listener error:', e);
        }
      }
    }

    // =========================================================================
    // 재화(야근 수당) 관리 및 보상 계산
    // =========================================================================

    /**
     * 현재 보유 야근 수당 반환
     */
    getCurrency() {
      return this.data.currency || 0;
    }

    /**
     * 런 결과에 따른 획득 야근 수당 계산
     * 공식: (처치한 적 수 * 10) + (보스 처치 여부 ? 100 : 0)
     */
    calculateRunReward(kills = 0, bossKilled = false) {
      const safeKills = Math.max(0, Math.floor(Number(kills) || 0));
      const killReward = safeKills * META_CONFIG.REWARD.PER_KILL;
      const bossReward = bossKilled ? META_CONFIG.REWARD.BOSS_KILL : 0;
      const totalReward = killReward + bossReward;

      return {
        kills: safeKills,
        killReward,
        bossKilled: Boolean(bossKilled),
        bossReward,
        totalReward
      };
    }

    /**
     * 런 종료 시 영구 재화 지급 및 통계 갱신 (런당 1회 호출용)
     */
    awardRunReward(kills = 0, bossKilled = false, isVictory = false) {
      const reward = this.calculateRunReward(kills, bossKilled);
      this.data.currency += reward.totalReward;

      // 누적 통계 기록
      this.data.stats.totalRuns += 1;
      this.data.stats.totalKills += reward.kills;
      if (bossKilled) this.data.stats.bossKills += 1;
      if (isVictory) this.data.stats.escapes += 1;
      this.data.stats.totalEarned += reward.totalReward;

      this.save();
      return {
        ...reward,
        newBalance: this.data.currency
      };
    }

    /**
     * 임의 재화 지급 (디버그/테스트 편의용)
     */
    addCurrency(amount = 0) {
      const safeAmt = Math.max(0, Math.floor(Number(amount) || 0));
      this.data.currency += safeAmt;
      this.data.stats.totalEarned += safeAmt;
      this.save();
      return this.data.currency;
    }

    // =========================================================================
    // 영구 강화 구매 및 상태 관리
    // =========================================================================

    /**
     * 특정 강화 항목의 현재 레벨 반환
     */
    getUpgradeLevel(id) {
      return this.data.upgrades[id] || 0;
    }

    /**
     * 특정 강화 항목의 다음 구매 비용 반환 (최대 레벨일 경우 null)
     */
    getUpgradeCost(id) {
      const def = META_CONFIG.UPGRADES[id];
      if (!def) return null;
      const currentLevel = this.getUpgradeLevel(id);
      if (currentLevel >= def.maxLevel) return null;
      return def.costs[currentLevel];
    }

    /**
     * 특정 강화 항목 구매 가능 여부
     */
    canAfford(id) {
      const cost = this.getUpgradeCost(id);
      if (cost === null) return false;
      return this.data.currency >= cost;
    }

    /**
     * 특정 강화 항목 구매 시도
     */
    purchaseUpgrade(id) {
      const def = META_CONFIG.UPGRADES[id];
      if (!def) {
        return { success: false, reason: 'unknown_upgrade' };
      }

      const currentLevel = this.getUpgradeLevel(id);
      if (currentLevel >= def.maxLevel) {
        return { success: false, reason: 'max_level_reached' };
      }

      const cost = def.costs[currentLevel];
      if (this.data.currency < cost) {
        return { success: false, reason: 'insufficient_currency', required: cost, current: this.data.currency };
      }

      // 재화 차감 및 레벨 증가
      this.data.currency -= cost;
      this.data.upgrades[id] = currentLevel + 1;
      this.save();

      return {
        success: true,
        id,
        newLevel: this.data.upgrades[id],
        newBalance: this.data.currency
      };
    }

    /**
     * 현재 영구 강화로 인해 게임플레이(새 런)에 적용할 능력치 보너스 객체 반환
     */
    getModifiers() {
      const hpLevel = this.getUpgradeLevel('maxHp');
      const atkLevel = this.getUpgradeLevel('attackPower');
      const dashLevel = this.getUpgradeLevel('dashCooldown');

      return {
        maxHpBonus: hpLevel * META_CONFIG.UPGRADES.maxHp.bonusPerLevel,
        attackBonus: atkLevel * META_CONFIG.UPGRADES.attackPower.bonusPerLevel,
        dashCooldownReduction: dashLevel * META_CONFIG.UPGRADES.dashCooldown.bonusPerLevel,
        levels: {
          maxHp: hpLevel,
          attackPower: atkLevel,
          dashCooldown: dashLevel
        }
      };
    }
  }

  PO.META_CONFIG = META_CONFIG;
  PO.MetaProgressionSystem = MetaProgressionSystem;
  PO.metaProgression = new MetaProgressionSystem();
})(window);
