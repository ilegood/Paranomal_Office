/**
 * @file character.js
 * Paranormal Office - Phase 13: 캐릭터 데이터 구조, 해금 및 선택 시스템, 고유 능력치 관리 모듈
 */
(function (global) {
  'use strict';

  global.PO = global.PO || {};
  const PO = global.PO;

  /**
   * 캐릭터 데이터 정의 (기본 캐릭터 1명 + 추가 캐릭터 2명)
   */
  const CHARACTER_CONFIGS = {
    rookie: {
      id: 'rookie',
      name: '야근 신입',
      role: '일반 사무직',
      desc: '매일 쏟아지는 과중한 야근에 시달리며 단련된 평범한 신입 사원입니다.',
      icon: '👔',
      themeColor: '#38bdf8',
      unlockCost: 0,
      isDefaultUnlocked: true,
      perkName: '야근 정신',
      perkDesc: '고유 능력 없음 (기본 능력치 유지)',
      baseStats: {
        hp: 100,
        speed: 260,
        dashCooldown: 1.20
      },
      modifiers: {
        meleeDamageMultiplier: 1.0,
        rangedDamageMultiplier: 1.0,
        dashCooldownMultiplier: 1.0
      }
    },
    exorcist: {
      id: 'exorcist',
      name: '퇴마 담당',
      role: '특수 퇴마직',
      desc: '사내 괴담과 잔재를 물리적으로 제령하는 퇴마 전문 계약 사원입니다.',
      icon: '📿',
      themeColor: '#f59e0b',
      unlockCost: 150, // 해금 비용 ₩150
      isDefaultUnlocked: false,
      perkName: '물리 제령술',
      perkDesc: '근접 공격력 +20% 증가 (원거리 무기 영향 없음)',
      baseStats: {
        hp: 100,
        speed: 260,
        dashCooldown: 1.20
      },
      modifiers: {
        meleeDamageMultiplier: 1.20, // 근접 공격력 20% 증가
        rangedDamageMultiplier: 1.0,  // 원거리는 기본값 유지
        dashCooldownMultiplier: 1.0
      }
    },
    guard: {
      id: 'guard',
      name: '야간 경비',
      role: '시설 방호직',
      desc: '심야 순찰과 돌발 위험 회피 훈련을 완수한 베테랑 야간 경비원입니다.',
      icon: '🛡️',
      themeColor: '#10b981',
      unlockCost: 250, // 해금 비용 ₩250
      isDefaultUnlocked: false,
      perkName: '신속 순찰보',
      perkDesc: '대시 쿨다운 -20% 감소 (긴급 회피 주기 단축)',
      baseStats: {
        hp: 100,
        speed: 260,
        dashCooldown: 1.20
      },
      modifiers: {
        meleeDamageMultiplier: 1.0,
        rangedDamageMultiplier: 1.0,
        dashCooldownMultiplier: 0.80 // 대시 쿨다운 20% 감소
      }
    }
  };

  /**
   * 캐릭터 관리 및 저장 시스템 클래스
   */
  class CharacterSystem {
    constructor(options = {}) {
      this.storageKey = options.storageKey || 'PARANORMAL_OFFICE_CHARACTER_SAVE_V1';
      this.listeners = new Set();

      this.data = this._createDefaultData();
      this.load();
    }

    _createDefaultData() {
      return {
        version: 1,
        selectedCharacterId: 'rookie',
        unlockedCharacters: ['rookie']
      };
    }

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
          throw new Error('Invalid character save structure');
        }

        const defaults = this._createDefaultData();
        const unlocked = Array.isArray(parsed.unlockedCharacters)
          ? parsed.unlockedCharacters.filter((id) => CHARACTER_CONFIGS[id])
          : defaults.unlockedCharacters;

        if (!unlocked.includes('rookie')) {
          unlocked.push('rookie');
        }

        let selected = parsed.selectedCharacterId;
        if (!selected || !CHARACTER_CONFIGS[selected] || !unlocked.includes(selected)) {
          selected = 'rookie';
        }

        this.data = {
          version: parsed.version || defaults.version,
          selectedCharacterId: selected,
          unlockedCharacters: unlocked
        };

        return this.data;
      } catch (err) {
        console.warn('[CharacterSystem] Failed to load character data, resetting to defaults:', err);
        this.data = this._createDefaultData();
        this.save();
        return this.data;
      }
    }

    save() {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        }
      } catch (err) {
        console.warn('[CharacterSystem] Failed to save character data:', err);
      }
      this._notifyChange();
    }

    reset() {
      this.data = this._createDefaultData();
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.removeItem(this.storageKey);
        }
      } catch (_) {}
      this.save();
    }

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
          console.error('[CharacterSystem] Listener error:', e);
        }
      }
    }

    // =========================================================================
    // 캐릭터 조회 및 상태
    // =========================================================================

    getCharacter(id) {
      return CHARACTER_CONFIGS[id] || null;
    }

    getAllCharacters() {
      return Object.values(CHARACTER_CONFIGS);
    }

    isUnlocked(id) {
      if (!CHARACTER_CONFIGS[id]) return false;
      if (CHARACTER_CONFIGS[id].isDefaultUnlocked) return true;
      return this.data.unlockedCharacters.includes(id);
    }

    getSelectedCharacterId() {
      return this.data.selectedCharacterId || 'rookie';
    }

    getSelectedCharacter() {
      return this.getCharacter(this.getSelectedCharacterId()) || CHARACTER_CONFIGS.rookie;
    }

    // =========================================================================
    // 캐릭터 해금 및 선택
    // =========================================================================

    canUnlock(id, metaProgression = null) {
      const cfg = this.getCharacter(id);
      if (!cfg) return false;
      if (this.isUnlocked(id)) return false;

      const meta = metaProgression || PO.metaProgression;
      if (!meta) return false;

      return meta.getCurrency() >= cfg.unlockCost;
    }

    unlockCharacter(id, metaProgression = null) {
      const cfg = this.getCharacter(id);
      if (!cfg) {
        return { success: false, reason: 'unknown_character' };
      }
      if (this.isUnlocked(id)) {
        return { success: false, reason: 'already_unlocked' };
      }

      const meta = metaProgression || PO.metaProgression;
      if (!meta) {
        return { success: false, reason: 'meta_system_missing' };
      }

      const currentBalance = meta.getCurrency();
      if (currentBalance < cfg.unlockCost) {
        return {
          success: false,
          reason: 'insufficient_currency',
          required: cfg.unlockCost,
          current: currentBalance
        };
      }

      // 1. 메타 재화 차감
      meta.data.currency -= cfg.unlockCost;
      meta.save();

      // 2. 캐릭터 해금 등록 및 저장
      if (!this.data.unlockedCharacters.includes(id)) {
        this.data.unlockedCharacters.push(id);
      }
      this.save();

      return {
        success: true,
        id,
        character: cfg,
        remainingCurrency: meta.getCurrency()
      };
    }

    selectCharacter(id) {
      const cfg = this.getCharacter(id);
      if (!cfg) {
        return { success: false, reason: 'unknown_character' };
      }
      if (!this.isUnlocked(id)) {
        return { success: false, reason: 'character_locked' };
      }

      this.data.selectedCharacterId = id;
      this.save();

      return {
        success: true,
        id,
        character: cfg
      };
    }

    /**
     * 현재 선택된 캐릭터의 고유 능력 보너스 반환
     */
    getEffectiveModifiers() {
      const char = this.getSelectedCharacter();
      return {
        characterId: char.id,
        characterName: char.name,
        meleeDamageMultiplier: char.modifiers.meleeDamageMultiplier || 1.0,
        rangedDamageMultiplier: char.modifiers.rangedDamageMultiplier || 1.0,
        dashCooldownMultiplier: char.modifiers.dashCooldownMultiplier || 1.0
      };
    }
  }

  PO.CHARACTER_CONFIGS = CHARACTER_CONFIGS;
  PO.CharacterSystem = CharacterSystem;
  PO.characterSystem = new CharacterSystem();
})(window);
