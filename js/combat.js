(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * 무기 밸런스 설정값 (추후 밸런스 조정을 위해 별도 상수 객체로 분리 관리)
   */
  const WEAPON_CONFIGS = {
    melee: {
      id: 'melee',
      slot: 1,
      name: '대형 사무용 스테이플러',
      attackModeText: '근접 · 부채꼴 타격',
      type: 'melee',
      damage: 25,
      range: 55, // 공격 거리: 약 55px
      arcDegrees: 100, // 공격 각도: 약 100도
      cooldown: 0.5, // 공격 쿨다운: 0.5초
      activeDuration: 0.14, // 공격 판정 유지 시간(초)
      visualDuration: 0.2, // 시각 이펙트 표시 시간(초)
      usesAmmo: false
    },
    ranged: {
      id: 'ranged',
      slot: 2,
      name: '사무용 권총',
      attackModeText: '원거리 · 투사체 발사',
      type: 'ranged',
      damage: 15,
      maxAmmo: 20, // 기본 탄약: 20발
      cooldown: 0.25, // 발사 간격: 0.25초
      projectileSpeed: 620, // 투사체 이동 속도 (px/sec)
      projectileRadius: 5, // 투사체 충돌 반경 (px)
      muzzleOffset: 12, // 플레이어 중심으로부터 발사 시작 거리 (벽 끼임 방지)
      usesAmmo: true
    }
  };

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
    constructor(initialTargets = []) {
      this.maxUpgradeLevel = WEAPON_UPGRADE_CONFIG.maxLevel;
      this.damageBonusPerLevel = WEAPON_UPGRADE_CONFIG.damageBonusPerLevel;
      this.upgradeLevel = 0;

      // 슬롯별 런타임 무기 상태 초기화 (기본 데미지와 강화 단계를 별도 분리 관리)
      this.weapons = {
        1: {
          config: WEAPON_CONFIGS.melee,
          baseDamage: WEAPON_CONFIGS.melee.damage,
          upgradeLevel: 0,
          ammo: null,
          maxAmmo: null,
          cooldownRemaining: 0
        },
        2: {
          config: WEAPON_CONFIGS.ranged,
          baseDamage: WEAPON_CONFIGS.ranged.damage,
          upgradeLevel: 0,
          ammo: WEAPON_CONFIGS.ranged.maxAmmo,
          maxAmmo: WEAPON_CONFIGS.ranged.maxAmmo,
          cooldownRemaining: 0
        }
      };

      this.currentSlot = 1; // 기본 장착: 1번 근접 무기(대형 사무용 스테이플러)

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
      return CombatSystem.calculateUpgradedDamage(
        ws.baseDamage,
        ws.upgradeLevel,
        this.damageBonusPerLevel
      );
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
        hitTargetIds: new Set()
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
        duration: cfg.visualDuration
      });
    }

    _performRangedAttack(player, weaponState, officeMap, aliveEnemies = [], boss = null) {
      const cfg = weaponState.config;
      weaponState.ammo = Math.max(0, weaponState.ammo - 1);
      weaponState.cooldownRemaining = cfg.cooldown;

      const dirX = player.direction.x;
      const dirY = player.direction.y;

      const startX = player.position.x + dirX * cfg.muzzleOffset;
      const startY = player.position.y + dirY * cfg.muzzleOffset;
      const effectiveDamage = this.getWeaponDamage(cfg.slot);

      const projectile = {
        x: startX,
        y: startY,
        prevX: startX,
        prevY: startY,
        vx: dirX * cfg.projectileSpeed,
        vy: dirY * cfg.projectileSpeed,
        speed: cfg.projectileSpeed,
        angle: player.direction.angle,
        radius: cfg.projectileRadius,
        damage: effectiveDamage,
        alive: true
      };

      // 발사 위치가 이미 벽/장애물/타겟/적/보스에 닿아 있는 초근접 상태인지 즉시 검사
      if (!this._checkProjectileCollision(projectile, officeMap, aliveEnemies, boss)) {
        this.projectiles.push(projectile);
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
        this._applyHitToTarget(entity, swing.damage, 'melee', cosDir);
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

      // 3. 임시 테스트 타겟 충돌 검사
      for (let i = 0; i < this.targets.length; i++) {
        const target = this.targets[i];
        if (!target.alive) {
          continue;
        }

        const dist = Math.hypot(proj.x - target.position.x, proj.y - target.position.y);
        if (dist <= r + target.radius) {
          const hitDirX = proj.vx >= 0 ? 1 : -1;
          this._applyHitToTarget(target, proj.damage, 'ranged', hitDirX);
          this._spawnImpactEffect(proj.x, proj.y - 20, '#38bdf8', 13);
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
          this._applyHitToTarget(enemy, proj.damage, 'ranged', hitDirX);
          this._spawnImpactEffect(proj.x, proj.y - 22, '#38bdf8', 15);
          return true;
        }
      }

      // 5. Phase 10: 생존 중인 보스(야근 감독관) 충돌 검사
      if (boss && boss.alive && !boss.isDead()) {
        const bossRad = boss.colliderRadius || boss.radius || 30;
        const dist = Math.hypot(proj.x - boss.position.x, proj.y - boss.position.y);
        if (dist <= r + bossRad) {
          const hitDirX = proj.vx >= 0 ? 1 : -1;
          this._applyHitToTarget(boss, proj.damage, 'ranged', hitDirX);
          this._spawnImpactEffect(proj.x, proj.y - 25, '#38bdf8', 18);
          return true;
        }
      }

      return false;
    }

    _applyHitToTarget(target, damage, attackKind, hitDirX) {
      target.takeDamage(damage, hitDirX);

      // 피해량 확인용 플로팅 데미지 텍스트 생성 (상단 체력 표시 위쪽에서 떠오름)
      const popupOffsetY = target.isBoss ? -112 : target.isEnemy ? -92 : -82;
      this.damagePopups.push({
        x: target.position.x + (Math.random() - 0.5) * 10,
        y: target.position.y + popupOffsetY,
        text: `-${damage}`,
        color: attackKind === 'melee' ? '#fbbf24' : '#38bdf8',
        elapsed: 0,
        duration: 0.65,
        isNotice: false
      });

      if (attackKind === 'melee') {
        const sparkY = target.isBoss ? target.position.y - 28 : target.position.y - 22;
        this._spawnImpactEffect(target.position.x, sparkY, '#fbbf24', target.isBoss ? 22 : 16);
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
        baseDamage: ws.baseDamage,
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
        isReady: ws.cooldownRemaining <= 0 && (!cfg.usesAmmo || ws.ammo > 0)
      };
    }
  }

  PO.WEAPON_CONFIGS = WEAPON_CONFIGS;
  PO.WEAPON_UPGRADE_CONFIG = WEAPON_UPGRADE_CONFIG;
  PO.TARGET_CONFIG = TARGET_CONFIG;
  PO.TestTarget = TestTarget;
  PO.CombatSystem = CombatSystem;
})(window);
