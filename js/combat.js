(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 무기 밸런스 설정값 (추후 밸런스 조정을 위해 별도 상수 객체로 분리 관리)
   */
  /**
   * Phase 16: 무기 데이터 구조 (무기 정보를 별도 데이터 구조로 분리 관리)
   * 고유 ID, 무기 이름, 종류(melee/ranged), 슬롯(1/2), 공격력, 공격 속도(쿨다운),
   * 공격 범위/투사체 속도, 탄약 여부, 무기 설명, 무기별 특수 효과
   */
  const WEAPON_CONFIGS = {
    // 근접 무기 1: 사무용 커터 (기본 근접 무기, 빠른 공속, 짧은 사거리)
    cutter: {
      id: 'cutter',
      slot: 1,
      name: '사무용 커터',
      attackModeText: '근접 · 고속 베기',
      type: 'melee',
      damage: 22,
      range: 48, // 짧은 공격 범위 (48px)
      arcDegrees: 95, // 95도
      cooldown: 0.30, // 빠른 공격 속도 (0.30초)
      activeDuration: 0.11,
      visualDuration: 0.16,
      usesAmmo: false,
      description: '예리하게 갈아낸 대형 커터칼. 짧은 사거리 대신 매우 빠른 속도로 연속 타격을 가합니다.',
      specialEffect: {
        kind: 'fast_slash',
        desc: '빠른 연타 속도 (0.30초 쿨다운)'
      }
    },

    // 근접 무기 2: 대형 망치 (높은 공격력, 느린 공속, 넓은 사거리, 강한 타격 피드백)
    hammer: {
      id: 'hammer',
      slot: 1,
      name: '대형 망치',
      attackModeText: '근접 · 광역 분쇄',
      type: 'melee',
      damage: 55, // 매우 높은 공격력 (55)
      range: 75, // 넓은 공격 범위 (75px)
      arcDegrees: 140, // 넓은 부채꼴 각도 (140도)
      cooldown: 0.85, // 느린 공격 속도 (0.85초)
      activeDuration: 0.22,
      visualDuration: 0.30,
      usesAmmo: false,
      description: '철거 및 시설 보수용 육중한 오함마. 묵직하고 느리지만 광범위의 적을 분쇄합니다.',
      specialEffect: {
        kind: 'heavy_crush',
        desc: '강력한 타격력 (55 dmg) · 광범위 분쇄 (140°)'
      }
    },

    // 근접 무기 3: 전기 충격봉 (중간 공격력, 빠른 공속, 일반 적 0.6초 경직 - 보스 면역)
    stun_baton: {
      id: 'stun_baton',
      slot: 1,
      name: '전기 충격봉',
      attackModeText: '근접 · 고압 방전',
      type: 'melee',
      damage: 30, // 중간 공격력 (30)
      range: 58,
      arcDegrees: 105,
      cooldown: 0.45, // 준수한 공격 속도
      activeDuration: 0.14,
      visualDuration: 0.20,
      usesAmmo: false,
      description: '방범 순찰용 고압 전기 충격기. 타격 시 일반 적을 0.6초간 마비 경직시킵니다. (보스 면역)',
      specialEffect: {
        kind: 'stun',
        stunDuration: 0.60,
        desc: '적에게 0.6초간 경직 효과 부여 (보스 면역)'
      }
    },

    // 원거리 무기 1: 권총 (기본 원거리 무기, 단일 투사체 안정 사격)
    pistol: {
      id: 'pistol',
      slot: 2,
      name: '사무용 권총',
      attackModeText: '원거리 · 투사체 발사',
      type: 'ranged',
      damage: 16,
      maxAmmo: 24,
      cooldown: 0.25,
      projectileSpeed: 640,
      projectileRadius: 5,
      muzzleOffset: 12,
      usesAmmo: true,
      description: '야간 긴급 호신용 리볼버 권총. 안정적인 사거리와 탄속으로 단일 적을 저격합니다.',
      specialEffect: {
        kind: 'single_shot',
        desc: '안정적인 탄속의 단일 정밀 사격'
      }
    },

    // 원거리 무기 2: 산탄총 (1회 공격 시 5발 산탄 발사, 근접 고피해, 거리별 감쇄, 1회당 1발 소모)
    shotgun: {
      id: 'shotgun',
      slot: 2,
      name: '산탄총',
      attackModeText: '원거리 · 5방향 산탄',
      type: 'ranged',
      damage: 10, // 펠릿당 10 (5발 적중 시 최대 50 데미지)
      pelletCount: 5,
      spreadDegrees: 28,
      maxAmmo: 12,
      cooldown: 0.65,
      projectileSpeed: 580,
      projectileRadius: 4.5,
      muzzleOffset: 14,
      maxRange: 240,
      minDamageRatio: 0.4,
      usesAmmo: true, // 1회 공격 시 1발 소모
      description: '5발의 산탄 펠릿을 부채꼴로 일제 발사합니다. 초근접 시 치명적인 폭딜을 가합니다.',
      specialEffect: {
        kind: 'spread',
        pelletCount: 5,
        desc: '5발 부채꼴 산탄 (초근접 고피해, 거리별 감쇄, 1발 소모)'
      }
    },

    // 원거리 무기 3: 서류 발사기 (초고속 연사, 낮은 개별 피해, 빠른 탄약 소모, 다수 적 견제)
    doc_launcher: {
      id: 'doc_launcher',
      slot: 2,
      name: '서류 발사기',
      attackModeText: '원거리 · 고속 서류 난사',
      type: 'ranged',
      damage: 8,
      maxAmmo: 50,
      cooldown: 0.10, // 초당 10발 초고속 연사
      projectileSpeed: 680,
      projectileRadius: 5,
      muzzleOffset: 12,
      usesAmmo: true,
      description: '압축 공기로 날카로운 결재 서류를 난사하는 기관총형 발사기. 다수의 적을 제압합니다.',
      specialEffect: {
        kind: 'rapid_fire',
        desc: '0.10초 초고속 연사 (다수 적 제압, 빠른 탄약 소모)'
      }
    }
  };

  // 이전 버전 및 별칭 호환
  WEAPON_CONFIGS.melee = WEAPON_CONFIGS.cutter;
  WEAPON_CONFIGS.ranged = WEAPON_CONFIGS.pistol;

  /**
   * 무기 강화 시스템 설정값 (기본 데미지와 분리 관리)
   */
  const WEAPON_UPGRADE_CONFIG = {
    maxLevel: 3, // 최대 강화 단계: 3단계
    damageBonusPerLevel: 0.25 // 단계당 기본 데미지의 +25%
  };

  /**
   * 임시 공격 테스트 타겟 설정값
   */
  const TARGET_CONFIG = {
    maxHp: 100,
    radius: 18,
    hitFlashDuration: 0.13,
    shakeDuration: 0.18
  };

  /**
   * 공격 판정 확인용 임시 테스트 타겟 (추격/공격 AI 없음)
   */
  class TestTarget {
    constructor(config) {
      this.id = config.id;
      this.position = {
        x: config.x,
        y: config.y
      };
      this.maxHp = config.maxHp ?? TARGET_CONFIG.maxHp;
      this.hp = config.hp ?? this.maxHp;
      this.radius = config.radius ?? TARGET_CONFIG.radius;
      this.alive = this.hp > 0;

      // 피격 시각 피드백 타이머
      this.hitFlashTimer = 0;
      this.shakeTimer = 0;
      this.lastHitDirX = 0;
    }

    takeDamage(amount, hitDirX = 0) {
      if (!this.alive || amount <= 0) {
        return 0;
      }

      const actualDamage = Math.min(this.hp, amount);
      this.hp = Math.max(0, this.hp - amount);
      this.hitFlashTimer = TARGET_CONFIG.hitFlashDuration;
      this.shakeTimer = TARGET_CONFIG.shakeDuration;
      this.lastHitDirX = hitDirX;

      if (this.hp <= 0) {
        this.alive = false;
      }

      return actualDamage;
    }

    update(dt) {
      if (this.hitFlashTimer > 0) {
        this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);
      }
      if (this.shakeTimer > 0) {
        this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      }
    }

    getSortY() {
      return this.position.y;
    }
  }

  /**
   * 플레이어 무기 전환, 근접 부채꼴 판정, 원거리 투사체, 쿨다운, 테스트 타겟 피격을 총괄하는 시스템
   */
  class CombatSystem {
    constructor(initialTargets = [], options = {}) {
      this.maxUpgradeLevel = WEAPON_UPGRADE_CONFIG.maxLevel;
      this.damageBonusPerLevel = WEAPON_UPGRADE_CONFIG.damageBonusPerLevel;
      this.upgradeLevel = 0;
      // Phase 12: 영구 공격력 강화 보너스 (모든 무기 기본 데미지에 합산)
      this.permanentAttackBonus = Math.max(0, Number(options.permanentAttackBonus) || 0);
      // Phase 13: 캐릭터 고유 공격력 배율 (퇴마 담당의 근접 +20% 등)
      this.meleeDamageMultiplier = Number(options.meleeDamageMultiplier) || 1.0;
      this.rangedDamageMultiplier = Number(options.rangedDamageMultiplier) || 1.0;
      // Phase 15: 런 중 공격력 강화 보너스 (야근 수당 아이템 획득 시 합연산 누적)
      this.runAttackBonusPercent = 0;

      // 슬롯별 런타임 무기 상태 초기화 (기본 데미지와 강화 단계를 별도 분리 관리)
      this.weapons = {
        1: {
          config: WEAPON_CONFIGS.cutter,
          baseDamage: WEAPON_CONFIGS.cutter.damage,
          upgradeLevel: 0,
          ammo: null,
          maxAmmo: null,
          cooldownRemaining: 0
        },
        2: {
          config: WEAPON_CONFIGS.pistol,
          baseDamage: WEAPON_CONFIGS.pistol.damage,
          upgradeLevel: 0,
          ammo: WEAPON_CONFIGS.pistol.maxAmmo,
          maxAmmo: WEAPON_CONFIGS.pistol.maxAmmo,
          cooldownRemaining: 0
        }
      };

      this.currentSlot = 1; // 기본 장착: 1번 근접 무기(사무용 커터)

      // 활성 근접 공격 판정 목록 (피격 판정 전용, 시각 효과와 분리)
      this.meleeSwings = [];

      // 활성 근접 휘두르기 시각 이펙트 목록 (렌더링 전용, 판정 로직과 분리)
      this.meleeEffects = [];

      // 활성 원거리 투사체 목록
      this.projectiles = [];

      // 피격 데미지 텍스트 및 충돌 스파크 이펙트
      this.damagePopups = [];
      this.impactEffects = [];

      // 임시 테스트 타겟 목록
      this.targets = initialTargets.map((t) => new TestTarget(t));
    }

    /**
     * 기본 사무실 맵 내 테스트 타겟 배치 생성 헬퍼
     */
    static createDefaultTargets(officeMap = null) {
      if (officeMap && Array.isArray(officeMap.targetSpawns)) {
        return officeMap.targetSpawns.map((spawn) => ({ ...spawn }));
      }

      return [{ id: 'target-start-dummy', x: 525, y: 1045 }];
    }

    getCurrentWeaponState() {
      return this.weapons[this.currentSlot];
    }

    /**
     * 기본 데미지와 강화 단계로부터 최종 공격 데미지 계산 (근접·원거리 각각 독립 적용)
     */
    static calculateUpgradedDamage(
      baseDamage,
      upgradeLevel,
      bonusPerLevel = WEAPON_UPGRADE_CONFIG.damageBonusPerLevel
    ) {
      const safeLevel = Math.max(0, upgradeLevel);
      return Math.round(baseDamage * (1 + bonusPerLevel * safeLevel));
    }

    /**
     * 지정 슬롯 무기의 현재 강화 적용 데미지 반환 (기본 데미지는 변경하지 않음)
     */
    getWeaponDamage(slot = this.currentSlot) {
      const ws = this.weapons[slot];
      if (!ws) {
        return 0;
      }
      const rawDmg = CombatSystem.calculateUpgradedDamage(
        ws.baseDamage + (this.permanentAttackBonus || 0),
        ws.upgradeLevel,
        this.damageBonusPerLevel
      );
      // Phase 13: 캐릭터 고유 공격력 배율 (근접/원거리 독립 적용)
      const multiplier = slot === 1
        ? (this.meleeDamageMultiplier || 1.0)
        : (this.rangedDamageMultiplier || 1.0);
      // Phase 15: 런 중 공격력 강화(야근 수당) 기본 공격력 기준 합연산 누적 적용 (+15%p씩 누적)
      const runMultiplier = 1 + (this.runAttackBonusPercent || 0) / 100;
      return Math.round(rawDmg * multiplier * runMultiplier);
    }

    /**
     * 추가 무기 강화 가능 여부 반환 (최대 3단계 제한)
     */
    canUpgradeWeapon() {
      return this.upgradeLevel < this.maxUpgradeLevel;
    }

    /**
     * 무기 강화 단계를 증가시킨다. (근접·원거리 각자의 기본 데미지를 기준으로 독립 계산)
     */
    upgradeWeapon(levels = 1) {
      if (levels <= 0 || !this.canUpgradeWeapon()) {
        return {
          applied: false,
          prevLevel: this.upgradeLevel,
          newLevel: this.upgradeLevel,
          maxLevel: this.maxUpgradeLevel,
          bonusPercent: Math.round(this.upgradeLevel * this.damageBonusPerLevel * 100),
          meleeDamage: this.getWeaponDamage(1),
          rangedDamage: this.getWeaponDamage(2)
        };
      }

      const prevLevel = this.upgradeLevel;
      const nextLevel = Math.min(this.maxUpgradeLevel, prevLevel + levels);
      this.upgradeLevel = nextLevel;
      this.weapons[1].upgradeLevel = nextLevel;
      this.weapons[2].upgradeLevel = nextLevel;

      return {
        applied: nextLevel > prevLevel,
        prevLevel,
        newLevel: nextLevel,
        maxLevel: this.maxUpgradeLevel,
        bonusPercent: Math.round(nextLevel * this.damageBonusPerLevel * 100),
        meleeDamage: this.getWeaponDamage(1),
        rangedDamage: this.getWeaponDamage(2)
      };
    }

    /**
     * 숫자 키(1: 근접, 2: 원거리)로 장착 무기 전환
     */
    switchWeapon(slot) {
      if (slot !== 1 && slot !== 2) {
        return false;
      }
      if (this.currentSlot === slot) {
        return false;
      }
      this.currentSlot = slot;
      return true;
    }

    /**
     * Phase 16: 신규 무기 획득 및 장착 (기존 동일 슬롯 무기 대체, 탄약 및 상태 완전 초기화, 강화 단계 계승)
     * @param {string} weaponId 무기 고유 ID (cutter, hammer, stun_baton, pistol, shotgun, doc_launcher)
     */
    equipWeapon(weaponId) {
      const cfg = WEAPON_CONFIGS[weaponId];
      if (!cfg) {
        return null;
      }

      const slot = cfg.slot; // 1: 근접, 2: 원거리
      const prevWeapon = this.weapons[slot];

      // 새 무기 상태로 완전히 교체 (기존 무기 잔여 탄약 및 쿨다운 오염 원천 차단)
      this.weapons[slot] = {
        config: cfg,
        baseDamage: cfg.damage,
        upgradeLevel: this.upgradeLevel, // 현재 무기 강화 단계 정상 계승
        ammo: cfg.usesAmmo ? cfg.maxAmmo : null,
        maxAmmo: cfg.usesAmmo ? cfg.maxAmmo : null,
        cooldownRemaining: 0
      };

      return {
        slot,
        weapon: this.weapons[slot],
        prevWeapon
      };
    }

    /**
     * 생존 중인 테스트 타겟 목록 반환 (이동 충돌 및 렌더링용)
     */
    getAliveTargets() {
      return this.targets.filter((t) => t.alive);
    }

    /**
     * 현재 공격 시도 (마우스 좌클릭 입력 시 호출)
     */
    tryAttack(player, officeMap, aliveEnemies = [], boss = null) {
      const weaponState = this.getCurrentWeaponState();
      const cfg = weaponState.config;

      // 쿨다운 중이면 공격 불가
      if (weaponState.cooldownRemaining > 0) {
        return false;
      }

      if (cfg.type === 'melee') {
        this._performMeleeAttack(player, weaponState, aliveEnemies, boss);
        return true;
      }

      if (cfg.type === 'ranged') {
        if (weaponState.ammo <= 0) {
          // 탄약 소진 시 발사하지 않고 짧은 텍스트 피드백만 표시 (중복 스팸 방지)
          this._spawnAmmoEmptyFeedback(player);
          weaponState.cooldownRemaining = 0.18;
          return false;
        }

        this._performRangedAttack(player, weaponState, officeMap, aliveEnemies, boss);
        return true;
      }

      return false;
    }

    _performMeleeAttack(player, weaponState, aliveEnemies = [], boss = null) {
      const cfg = weaponState.config;
      weaponState.cooldownRemaining = cfg.cooldown;

      const arcRad = (cfg.arcDegrees * Math.PI) / 180;
      const effectiveDamage = this.getWeaponDamage(cfg.slot);

      // 1. 공격 판정 객체 생성 (데미지, 범위, 각도, 판정 유지 시간만 관리)
      const swing = {
        x: player.position.x,
        y: player.position.y,
        angle: player.direction.angle,
        range: cfg.range,
        arcRad,
        damage: effectiveDamage,
        elapsed: 0,
        activeDuration: cfg.activeDuration,
        isHitboxActive: true,
        hitTargetIds: new Set(),
        weaponId: cfg.id,
        specialEffect: cfg.specialEffect
      };

      this.meleeSwings.push(swing);

      // 2. 단일 부채꼴 휘두르기 시각 이펙트 1개 생성 (공격 판정과 독립)
      this._spawnMeleeSwingEffect(player, cfg, arcRad);

      // 생성 직후 첫 프레임 즉시 판정 수행
      this._checkMeleeSwingHits(swing, aliveEnemies, boss);
    }

    _spawnMeleeSwingEffect(player, cfg, arcRad) {
      this.meleeEffects.push({
        x: player.position.x,
        y: player.position.y,
        aimOffsetY: player.aimOffsetY ?? -18,
        angle: player.direction.angle,
        arcRad,
        maxRadius: cfg.range,
        elapsed: 0,
        duration: cfg.visualDuration,
        weaponId: cfg.id
      });
    }

    _performRangedAttack(player, weaponState, officeMap, aliveEnemies = [], boss = null) {
      const cfg = weaponState.config;
      // 1회 공격 시 1발 소모 (산탄총의 5발 펠릿도 1발 소모)
      weaponState.ammo = Math.max(0, weaponState.ammo - 1);
      weaponState.cooldownRemaining = cfg.cooldown;

      const effectiveDamage = this.getWeaponDamage(cfg.slot);

      if (cfg.id === 'shotgun') {
        // 산탄총: 5발 동시 확산 발사
        const count = cfg.pelletCount || 5;
        const totalSpreadRad = ((cfg.spreadDegrees || 28) * Math.PI) / 180;
        const startSpread = player.direction.angle - totalSpreadRad * 0.5;
        const stepSpread = totalSpreadRad / Math.max(1, count - 1);

        for (let p = 0; p < count; p++) {
          const pelletAngle = startSpread + stepSpread * p;
          const pDirX = Math.cos(pelletAngle);
          const pDirY = Math.sin(pelletAngle);
          const startX = player.position.x + pDirX * cfg.muzzleOffset;
          const startY = player.position.y + pDirY * cfg.muzzleOffset;

          const projectile = {
            x: startX,
            y: startY,
            prevX: startX,
            prevY: startY,
            startX,
            startY,
            vx: pDirX * cfg.projectileSpeed,
            vy: pDirY * cfg.projectileSpeed,
            speed: cfg.projectileSpeed,
            angle: pelletAngle,
            radius: cfg.projectileRadius,
            damage: effectiveDamage,
            baseDamage: effectiveDamage,
            maxRange: cfg.maxRange || 240,
            minDamageRatio: cfg.minDamageRatio || 0.4,
            weaponId: 'shotgun',
            alive: true
          };

          if (!this._checkProjectileCollision(projectile, officeMap, aliveEnemies, boss)) {
            this.projectiles.push(projectile);
          }
        }
      } else {
        // 단일 투사체 발사 (사무용 권총, 서류 발사기)
        const dirX = player.direction.x;
        const dirY = player.direction.y;
        const startX = player.position.x + dirX * cfg.muzzleOffset;
        const startY = player.position.y + dirY * cfg.muzzleOffset;

        const projectile = {
          x: startX,
          y: startY,
          prevX: startX,
          prevY: startY,
          startX,
          startY,
          vx: dirX * cfg.projectileSpeed,
          vy: dirY * cfg.projectileSpeed,
          speed: cfg.projectileSpeed,
          angle: player.direction.angle,
          radius: cfg.projectileRadius,
          damage: effectiveDamage,
          baseDamage: effectiveDamage,
          weaponId: cfg.id,
          alive: true
        };

        if (!this._checkProjectileCollision(projectile, officeMap, aliveEnemies, boss)) {
          this.projectiles.push(projectile);
        }
      }
    }

    _spawnAmmoEmptyFeedback(player) {
      const hasRecentEmptyPopup = this.damagePopups.some(
        (p) => p.isNotice && p.elapsed < 0.35
      );
      if (hasRecentEmptyPopup) {
        return;
      }

      this.damagePopups.push({
        x: player.position.x,
        y: player.position.y - 54,
        text: '탄약 없음!',
        color: '#f87171',
        elapsed: 0,
        duration: 0.65,
        isNotice: true
      });
    }

    /**
     * 매 프레임 공격 시스템 업데이트
     */
    update(dt, player, officeMap, shouldTriggerAttack, aliveEnemies = [], boss = null) {
      // 1. 모든 무기 슬롯 쿨다운 감소
      const slots = [1, 2];
      for (let i = 0; i < slots.length; i++) {
        const ws = this.weapons[slots[i]];
        if (ws.cooldownRemaining > 0) {
          ws.cooldownRemaining = Math.max(0, ws.cooldownRemaining - dt);
        }
      }

      // 2. 공격 입력 처리
      if (shouldTriggerAttack) {
        this.tryAttack(player, officeMap, aliveEnemies, boss);
      }

      // 3. 활성 근접 공격 판정 갱신 (판정 유지 시간 동안만 활성 후 제거)
      for (let i = this.meleeSwings.length - 1; i >= 0; i--) {
        const swing = this.meleeSwings[i];
        swing.elapsed += dt;

        // 근접 판정은 플레이어 위치를 따라가며 활성 시간 동안만 판정 유지
        swing.x = player.position.x;
        swing.y = player.position.y;
        swing.isHitboxActive = swing.elapsed <= swing.activeDuration;

        if (swing.isHitboxActive) {
          this._checkMeleeSwingHits(swing, aliveEnemies, boss);
        } else {
          this.meleeSwings.splice(i, 1);
        }
      }

      // 4. 원거리 투사체 이동 및 충돌(벽, 장애물, 테스트 타겟, 적, 보스) 처리
      this._updateProjectiles(dt, officeMap, aliveEnemies, boss);

      // 5. 테스트 타겟 상태 갱신 (체력 0 이하 타겟 제거)
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const target = this.targets[i];
        if (!target.alive) {
          this.targets.splice(i, 1);
          continue;
        }
        target.update(dt);
      }

      // 6. 근접 휘두르기 시각 이펙트, 피격 데미지 팝업 및 충돌 스파크 갱신
      this._updateEffects(dt, player);
    }

    /**
     * 부채꼴(거리 + 각도) 영역 내 테스트 타겟, 생존 중인 적 및 보스 피격 검사
     */
    _checkMeleeSwingHits(swing, aliveEnemies = [], boss = null) {
      const halfArc = swing.arcRad * 0.5;
      const cosDir = Math.cos(swing.angle);

      this._checkMeleeSwingAgainstList(swing, this.targets, halfArc, cosDir);
      if (aliveEnemies && aliveEnemies.length > 0) {
        this._checkMeleeSwingAgainstList(swing, aliveEnemies, halfArc, cosDir);
      }
      if (boss && boss.alive && !boss.isDead()) {
        this._checkMeleeSwingAgainstList(swing, [boss], halfArc, cosDir);
      }
    }

    _checkMeleeSwingAgainstList(swing, entities, halfArc, cosDir) {
      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        if (!entity.alive || swing.hitTargetIds.has(entity.id)) {
          continue;
        }

        const dx = entity.position.x - swing.x;
        const dy = entity.position.y - swing.y;
        const dist = Math.hypot(dx, dy);

        // 부채꼴 최대 도달 거리(공격 거리 + 대상 반경) 검사
        if (dist > swing.range + entity.radius) {
          continue;
        }

        // 각도 검사 (-PI ~ PI 정규화로 좌측 경계 각도 끊김 방지)
        if (dist > 1e-5) {
          const angleToTarget = Math.atan2(dy, dx);
          const angleDiff = Math.abs(this._normalizeAngle(angleToTarget - swing.angle));
          const radiusAnglePadding = Math.min(0.2, Math.atan2(entity.radius * 0.5, dist));

          if (angleDiff > halfArc + radiusAnglePadding) {
            continue;
          }
        }

        swing.hitTargetIds.add(entity.id);
        this._applyHitToTarget(entity, swing.damage, 'melee', cosDir, swing.specialEffect, swing.weaponId);
      }
    }

    /**
     * 투사체 서브스테핑 이동 및 벽/장애물/타겟/적/보스 충돌 검사
     */
    _updateProjectiles(dt, officeMap, aliveEnemies = [], boss = null) {
      if (dt <= 0) {
        return;
      }

      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const proj = this.projectiles[i];
        proj.prevX = proj.x;
        proj.prevY = proj.y;

        const frameDist = proj.speed * dt;
        const steps = Math.max(1, Math.ceil(frameDist / 6));
        const stepDt = dt / steps;

        for (let s = 0; s < steps; s++) {
          proj.x += proj.vx * stepDt;
          proj.y += proj.vy * stepDt;

          // Phase 16: 산탄총 거리 비례 데미지 감쇄 및 최대 사거리 소멸 판정
          if (proj.weaponId === 'shotgun') {
            const dist = Math.hypot(proj.x - proj.startX, proj.y - proj.startY);
            if (dist >= proj.maxRange) {
              proj.alive = false;
              break;
            }
            // 70px 이하 100%, 70~240px 구간에서 40%까지 선형 감소
            const dropT = Math.max(0, Math.min(1, (dist - 70) / (proj.maxRange - 70)));
            const ratio = 1.0 - (1.0 - (proj.minDamageRatio || 0.4)) * dropT;
            proj.damage = Math.max(1, Math.round(proj.baseDamage * ratio));
          }

          if (this._checkProjectileCollision(proj, officeMap, aliveEnemies, boss)) {
            proj.alive = false;
            break;
          }
        }

        if (!proj.alive) {
          this.projectiles.splice(i, 1);
        }
      }
    }

    /**
     * 단일 투사체의 벽, 장애물, 테스트 타겟, 적, 보스 충돌 판정
     * @returns {boolean} 충돌하여 제거되어야 하면 true
     */
    _checkProjectileCollision(proj, officeMap, aliveEnemies = [], boss = null) {
      const r = proj.radius;
      const floor = officeMap.floorRect;

      // 1. 사무실 외벽 충돌 검사
      if (
        proj.x - r <= floor.x ||
        proj.x + r >= floor.x + floor.width ||
        proj.y - r <= floor.y ||
        proj.y + r >= floor.y + floor.height
      ) {
        const clampedX = Math.max(floor.x, Math.min(proj.x, floor.x + floor.width));
        const clampedY = Math.max(floor.y, Math.min(proj.y, floor.y + floor.height));
        this._spawnImpactEffect(clampedX, clampedY - 18, '#94a3b8', 10);
        return true;
      }

      // 2. 맵 내부 고체 장애물(기둥, 캐비닛, 책상 등) 충돌 검사
      const obstacles = officeMap.getSolidObstacles();
      for (let i = 0; i < obstacles.length; i++) {
        if (this._circleIntersectsRect(proj.x, proj.y, r, obstacles[i])) {
          this._spawnImpactEffect(proj.x, proj.y - 18, '#cbd5e1', 10);
          return true;
        }
      }

      // 투사체별 충돌 불꽃 색상 및 크기
      const sparkColor =
        proj.weaponId === 'shotgun'
          ? '#f97316'
          : proj.weaponId === 'doc_launcher'
            ? '#e2e8f0'
            : '#38bdf8';
      const sparkSize = proj.weaponId === 'shotgun' ? 14 : 12;

      // 3. 임시 테스트 타겟 충돌 검사
      for (let i = 0; i < this.targets.length; i++) {
        const target = this.targets[i];
        if (!target.alive) {
          continue;
        }

        const dist = Math.hypot(proj.x - target.position.x, proj.y - target.position.y);
        if (dist <= r + target.radius) {
          const hitDirX = proj.vx >= 0 ? 1 : -1;
          this._applyHitToTarget(target, proj.damage, 'ranged', hitDirX, null, proj.weaponId);
          this._spawnImpactEffect(proj.x, proj.y - 20, sparkColor, sparkSize);
          return true;
        }
      }

      // 4. 생존 중인 일반 적 충돌 검사 (사망한 적은 판정 제외)
      for (let i = 0; i < aliveEnemies.length; i++) {
        const enemy = aliveEnemies[i];
        if (!enemy.alive) {
          continue;
        }

        const dist = Math.hypot(proj.x - enemy.position.x, proj.y - enemy.position.y);
        if (dist <= r + enemy.radius) {
          const hitDirX = proj.vx >= 0 ? 1 : -1;
          this._applyHitToTarget(enemy, proj.damage, 'ranged', hitDirX, null, proj.weaponId);
          this._spawnImpactEffect(proj.x, proj.y - 22, sparkColor, sparkSize + 2);
          return true;
        }
      }

      // 5. Phase 10: 생존 중인 보스(야근 감독관) 충돌 검사
      if (boss && boss.alive && !boss.isDead()) {
        const bossRad = boss.colliderRadius || boss.radius || 30;
        const dist = Math.hypot(proj.x - boss.position.x, proj.y - boss.position.y);
        if (dist <= r + bossRad) {
          const hitDirX = proj.vx >= 0 ? 1 : -1;
          this._applyHitToTarget(boss, proj.damage, 'ranged', hitDirX, null, proj.weaponId);
          this._spawnImpactEffect(proj.x, proj.y - 25, sparkColor, sparkSize + 5);
          return true;
        }
      }

      return false;
    }

    _applyHitToTarget(target, damage, attackKind, hitDirX, specialEffect = null, weaponId = null) {
      target.takeDamage(damage, hitDirX);

      // Phase 16: 전기 충격봉 스턴 부여 (보스는 면역)
      if (specialEffect && specialEffect.kind === 'stun' && typeof target.applyStun === 'function') {
        const stunApplied = target.applyStun(specialEffect.stunDuration || 0.6);
        if (stunApplied) {
          const stunOffsetY = target.isBoss ? -130 : target.isEnemy ? -110 : -95;
          this.damagePopups.push({
            x: target.position.x,
            y: target.position.y + stunOffsetY,
            text: '⚡ 경직!',
            color: '#38bdf8',
            elapsed: 0,
            duration: 0.65,
            isNotice: true
          });
          this._spawnImpactEffect(target.position.x, target.position.y - 20, '#38bdf8', 20);
        }
      }

      // 피해량 확인용 플로팅 데미지 텍스트 생성 (상단 체력 표시 위쪽에서 떠오름)
      const popupOffsetY = target.isBoss ? -112 : target.isEnemy ? -92 : -82;
      let textColor = attackKind === 'melee' ? '#fbbf24' : '#38bdf8';
      if (weaponId === 'hammer') {
        textColor = '#f59e0b';
      } else if (weaponId === 'shotgun') {
        textColor = '#f97316';
      } else if (weaponId === 'doc_launcher') {
        textColor = '#e0f2fe';
      }

      this.damagePopups.push({
        x: target.position.x + (Math.random() - 0.5) * 10,
        y: target.position.y + popupOffsetY,
        text: `-${damage}`,
        color: textColor,
        elapsed: 0,
        duration: 0.65,
        isNotice: false
      });

      if (attackKind === 'melee') {
        const sparkY = target.isBoss ? target.position.y - 28 : target.position.y - 22;
        const sparkColor =
          weaponId === 'hammer' ? '#f59e0b' : weaponId === 'stun_baton' ? '#38bdf8' : '#fbbf24';
        const sparkRadius =
          weaponId === 'hammer'
            ? (target.isBoss ? 32 : 24)
            : (target.isBoss ? 22 : 16);
        this._spawnImpactEffect(target.position.x, sparkY, sparkColor, sparkRadius);
      }

      // 체력이 0이 되어 처치/제거될 때 연출 이펙트
      if (!target.alive) {
        const burstColor = target.isBoss ? '#f43f5e' : target.isEnemy ? '#c084fc' : '#f43f5e';
        const burstRadius = target.isBoss ? 44 : target.isEnemy ? 30 : 26;
        this._spawnImpactEffect(target.position.x, target.position.y - 20, burstColor, burstRadius);
      }
    }

    _spawnImpactEffect(x, y, color, maxRadius) {
      this.impactEffects.push({
        x,
        y,
        color,
        maxRadius,
        elapsed: 0,
        duration: 0.22
      });
    }

    _updateEffects(dt, player) {
      for (let i = this.meleeEffects.length - 1; i >= 0; i--) {
        const fx = this.meleeEffects[i];
        fx.elapsed += dt;
        if (player) {
          fx.x = player.position.x;
          fx.y = player.position.y;
        }
        if (fx.elapsed >= fx.duration) {
          this.meleeEffects.splice(i, 1);
        }
      }

      for (let i = this.damagePopups.length - 1; i >= 0; i--) {
        const popup = this.damagePopups[i];
        popup.elapsed += dt;
        popup.y -= dt * 28;
        if (popup.elapsed >= popup.duration) {
          this.damagePopups.splice(i, 1);
        }
      }

      for (let i = this.impactEffects.length - 1; i >= 0; i--) {
        const fx = this.impactEffects[i];
        fx.elapsed += dt;
        if (fx.elapsed >= fx.duration) {
          this.impactEffects.splice(i, 1);
        }
      }
    }

    _circleIntersectsRect(cx, cy, radius, rect) {
      const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
      const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));
      const dx = cx - closestX;
      const dy = cy - closestY;
      return dx * dx + dy * dy <= radius * radius;
    }

    _normalizeAngle(rad) {
      let angle = rad % (Math.PI * 2);
      if (angle > Math.PI) angle -= Math.PI * 2;
      if (angle < -Math.PI) angle += Math.PI * 2;
      return angle;
    }

    /**
     * UI 표시용 무기/공격 상태 스냅샷 반환
     */
    getUIState() {
      const ws = this.getCurrentWeaponState();
      const cfg = ws.config;
      const cooldownRatio =
        cfg.cooldown > 0 ? 1 - Math.min(1, ws.cooldownRemaining / cfg.cooldown) : 1;

      return {
        slot: this.currentSlot,
        weaponId: cfg.id,
        weaponName: cfg.name,
        attackModeText: cfg.attackModeText,
        baseDamage: ws.baseDamage + (this.permanentAttackBonus || 0),
        permanentAttackBonus: this.permanentAttackBonus || 0,
        damage: this.getWeaponDamage(this.currentSlot),
        upgradeLevel: ws.upgradeLevel,
        maxUpgradeLevel: this.maxUpgradeLevel,
        upgradeBonusPercent: Math.round(ws.upgradeLevel * this.damageBonusPerLevel * 100),
        usesAmmo: cfg.usesAmmo,
        ammo: ws.ammo,
        maxAmmo: ws.maxAmmo,
        cooldownRemaining: ws.cooldownRemaining,
        cooldownTotal: cfg.cooldown,
        cooldownRatio,
        isReady: ws.cooldownRemaining <= 0 && (!cfg.usesAmmo || ws.ammo > 0),
        description: cfg.description || '',
        specialDesc: cfg.specialEffect?.desc || ''
      };
    }
  }

  PO.WEAPON_CONFIGS = WEAPON_CONFIGS;
  PO.WEAPON_UPGRADE_CONFIG = WEAPON_UPGRADE_CONFIG;
  PO.TARGET_CONFIG = TARGET_CONFIG;
  PO.TestTarget = TestTarget;
  PO.CombatSystem = CombatSystem;
})(window);
