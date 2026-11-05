(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * HUD UI(체력 바, 조작 표시, 대시 상태, 장착 무기/강화 단계/공격 상태, 아이템 획득 안내/결과 알림, 게임 오버) 동기화 모듈
   */
  class UIManager {
    constructor() {
      this.statusPanelEl = document.querySelector('.hud-status-panel');
      this.hpTextEl = document.getElementById('hp-text');
      this.hpBarFillEl = document.getElementById('hp-bar-fill');

      // 게임 오버 UI 요소
      this.gameOverOverlayEl = document.getElementById('game-over-overlay');
      this.restartBtnEl = document.getElementById('restart-btn');

      // 아이템 상호작용 안내 및 획득 결과 배너 요소
      this.interactionPromptEl = document.getElementById('interaction-prompt');
      this.interactionKeyEl = document.getElementById('interaction-key');
      this.interactionTitleEl = document.getElementById('interaction-title');
      this.interactionDetailEl = document.getElementById('interaction-detail');

      this.itemBannerEl = document.getElementById('item-feedback-banner');
      this.itemBannerTitleEl = document.getElementById('item-feedback-title');
      this.itemBannerDetailEl = document.getElementById('item-feedback-detail');

      // 전투 방 상태 및 남은 적 수 안내 요소
      this.combatRoomHudEl = document.getElementById('combat-room-hud');
      this.combatRoomTitleEl = document.getElementById('combat-room-title');
      this.combatRoomCounterEl = document.getElementById('combat-room-counter');
      this.combatRoomDetailEl = document.getElementById('combat-room-detail');

      // Phase 10: 상단 중앙 전용 보스 체력 바 요소
      this.bossBarWrapEl = document.getElementById('boss-bar-wrap');
      this.bossNameEl = document.getElementById('boss-name');
      this.bossHpTextEl = document.getElementById('boss-hp-text');
      this.bossHpFillEl = document.getElementById('boss-hp-bar-fill');

      // Phase 11: 탈출 성공(Victory) 결과 오버레이 요소
      this.victoryOverlayEl = document.getElementById('victory-overlay');
      this.victoryTimeEl = document.getElementById('victory-stat-time');
      this.victoryKillsEl = document.getElementById('victory-stat-kills');
      this.victoryBossEl = document.getElementById('victory-stat-boss');
      this.victoryEquipmentEl = document.getElementById('victory-stat-equipment');
      this.victoryRestartBtnEl = document.getElementById('victory-restart-btn');

      // Phase 12: 영구 재화(야근 수당) 및 영구 강화 상점 관련 요소
      this.hudCurrencyValEl = document.getElementById('hud-currency-val');
      this.hudOpenShopBtnEl = document.getElementById('hud-open-shop-btn');

      this.gameOverKillsEl = document.getElementById('game-over-stat-kills');
      this.gameOverRewardEl = document.getElementById('game-over-stat-reward');
      this.gameOverTotalEl = document.getElementById('game-over-stat-total');
      this.gameOverShopBtnEl = document.getElementById('game-over-shop-btn');

      this.victoryRewardEl = document.getElementById('victory-stat-reward');
      this.victoryTotalEl = document.getElementById('victory-stat-total-currency');
      this.victoryShopBtnEl = document.getElementById('victory-shop-btn');

      this.shopModalEl = document.getElementById('shop-modal');
      this.shopCurrencyValEl = document.getElementById('shop-currency-val');
      this.shopItemsListEl = document.getElementById('shop-items-list');
      this.shopCloseBtnEl = document.getElementById('shop-close-btn');

      // Phase 13: 사원 인사 발령 (캐릭터 선택 및 해금) 관련 요소
      this.hudCharNameEl = document.getElementById('hud-char-name');
      this.hudCharIconEl = document.getElementById('hud-char-icon');
      this.hudOpenCharBtnEl = document.getElementById('hud-open-char-btn');

      this.gameOverCharBtnEl = document.getElementById('game-over-char-btn');
      this.victoryCharBtnEl = document.getElementById('victory-char-btn');

      this.charModalEl = document.getElementById('character-modal');
      this.charCurrencyValEl = document.getElementById('char-currency-val');
      this.charItemsListEl = document.getElementById('char-items-list');
      this.charCloseBtnEl = document.getElementById('char-close-btn');

      this.characterSystem = PO.characterSystem || null;
      this.onCharacterChanged = null;

      this.meta = PO.metaProgression || null;
      this.onUpgradePurchased = null;

      this.keyEls = {
        up: document.getElementById('key-w'),
        left: document.getElementById('key-a'),
        down: document.getElementById('key-s'),
        right: document.getElementById('key-d'),
        dash: document.getElementById('key-space'),
        interact: document.getElementById('key-e')
      };

      // 대시 UI 요소
      this.dashPanelEl = document.getElementById('dash-panel');
      this.dashStatusTextEl = document.getElementById('dash-status-text');
      this.dashFillEl = document.getElementById('dash-cooldown-fill');

      // 공격/무기/강화 UI 요소
      this.slotTab1El = document.getElementById('slot-tab-1');
      this.slotTab2El = document.getElementById('slot-tab-2');
      this.weaponNameEl = document.getElementById('weapon-name');
      this.weaponModeEl = document.getElementById('weapon-mode');
      this.weaponUpgradeTextEl = document.getElementById('weapon-upgrade-text');
      this.weaponDamageTextEl = document.getElementById('weapon-damage-text');
      this.weaponAmmoRowEl = document.getElementById('weapon-ammo-row');
      this.weaponAmmoEl = document.getElementById('weapon-ammo');
      this.cooldownTextEl = document.getElementById('weapon-cooldown-text');
      this.cooldownFillEl = document.getElementById('weapon-cooldown-fill');

      // 디버그 전용 시드 UI 요소 (일반 플레이 시 비표시)
      this.debugSeedBadgeEl = document.getElementById('debug-seed-badge');
      this.debugSeedTextEl = document.getElementById('debug-seed-text');

      this._lastHp = null;
      this._lastMaxHp = null;
      this._lastKeyState = {
        up: false,
        left: false,
        down: false,
        right: false,
        dash: false,
        interact: false
      };

      this._lastDashLabel = null;
      this._lastDashPercent = null;
      this._lastDashMode = null;

      this._lastWeaponSlot = null;
      this._lastUpgradeText = null;
      this._lastDamageText = null;
      this._lastAmmo = null;
      this._lastUsesAmmo = null;
      this._lastCooldownText = null;
      this._lastCooldownPercent = null;
      this._lastHurtState = false;
      this._lastGameOver = false;

      this._lastPromptSig = '';
      this._lastBannerSig = '';
      this._lastCombatRoomSig = '';
      this._lastBossSig = '';
    }

    /**
     * 재시작 버튼 클릭 핸들러 바인딩
     */
    bindRestart(onRestart) {
      if (!this.restartBtnEl || typeof onRestart !== 'function') {
        return;
      }
      this.restartBtnEl.addEventListener('click', () => {
        onRestart();
      });
    }

    /**
     * Phase 11: 탈출 성공 화면 재시작 버튼 클릭 핸들러 바인딩
     */
    bindVictoryRestart(onRestart) {
      if (!this.victoryRestartBtnEl || typeof onRestart !== 'function') {
        return;
      }
      this.victoryRestartBtnEl.addEventListener('click', () => {
        onRestart();
      });
    }

    /**
     * Phase 12: 영구 강화 상점(사내 복지 강화실) 시스템 및 이벤트 바인딩
     */
    initShop(metaProgression = null, onUpgradePurchased = null) {
      this.meta = metaProgression || PO.metaProgression;
      this.onUpgradePurchased = onUpgradePurchased;

      if (this.hudOpenShopBtnEl) {
        this.hudOpenShopBtnEl.addEventListener('click', () => this.openShop());
      }
      if (this.gameOverShopBtnEl) {
        this.gameOverShopBtnEl.addEventListener('click', () => this.openShop());
      }
      if (this.victoryShopBtnEl) {
        this.victoryShopBtnEl.addEventListener('click', () => this.openShop());
      }
      if (this.shopCloseBtnEl) {
        this.shopCloseBtnEl.addEventListener('click', () => this.closeShop());
      }

      // 모달 바깥 어두운 배경 클릭 시 닫기
      if (this.shopModalEl) {
        this.shopModalEl.addEventListener('click', (e) => {
          if (e.target === this.shopModalEl) {
            this.closeShop();
          }
        });
      }

      // ESC 키 입력 시 상점 닫기 지원
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isShopOpen()) {
          this.closeShop();
          e.stopPropagation();
        }
      });

      // 데이터 변경 리스너 등록
      if (this.meta && typeof this.meta.subscribe === 'function') {
        this.meta.subscribe(() => {
          this.updateCurrencyDisplay();
          if (this.isShopOpen()) {
            this.renderShop();
          }
        });
      }

      this.updateCurrencyDisplay();
    }

    /**
     * 현재 보유 야근 수당 화면 갱신
     */
    updateCurrencyDisplay() {
      const balance = this.meta ? this.meta.getCurrency() : 0;
      const formatted = `₩${balance.toLocaleString()}`;

      if (this.hudCurrencyValEl) {
        this.hudCurrencyValEl.textContent = formatted;
      }
      if (this.shopCurrencyValEl) {
        this.shopCurrencyValEl.textContent = formatted;
      }
    }

    /**
     * 상점 모달 열기
     */
    openShop() {
      if (this.shopModalEl) {
        this.shopModalEl.hidden = false;
        this.updateCurrencyDisplay();
        this.renderShop();
      }
    }

    /**
     * 상점 모달 닫기
     */
    closeShop() {
      if (this.shopModalEl) {
        this.shopModalEl.hidden = true;
      }
    }

    /**
     * 상점 모달 열림 여부
     */
    isShopOpen() {
      return Boolean(this.shopModalEl && !this.shopModalEl.hidden);
    }

    /**
     * 상점 항목 목록 DOM 동적 렌더링
     */
    renderShop() {
      if (!this.shopItemsListEl || !this.meta || !PO.META_CONFIG) {
        return;
      }

      const upgradesDef = PO.META_CONFIG.UPGRADES;
      const upgradeIds = Object.keys(upgradesDef);
      const currentBalance = this.meta.getCurrency();

      this.shopItemsListEl.innerHTML = '';

      upgradeIds.forEach((id) => {
        const def = upgradesDef[id];
        const currentLvl = this.meta.getUpgradeLevel(id);
        const maxLvl = def.maxLevel;
        const isMax = currentLvl >= maxLvl;
        const nextCost = this.meta.getUpgradeCost(id);
        const canAfford = !isMax && currentBalance >= nextCost;

        const card = document.createElement('div');
        card.className = `shop-item-card ${isMax ? 'is-max' : ''}`;
        card.setAttribute('data-upgrade-id', id);

        // 5칸 프로그레스 닷 생성
        let dotsHtml = '';
        for (let i = 1; i <= maxLvl; i++) {
          dotsHtml += `<span class="shop-dot ${i <= currentLvl ? 'is-filled' : ''}"></span>`;
        }

        const effectText = def.getEffectText(currentLvl);
        const nextEffectText = def.getNextEffectText(currentLvl);

        let buttonText = '';
        let buttonDisabled = false;
        let buttonClass = 'shop-buy-btn';

        if (isMax) {
          buttonText = 'MAX (완료)';
          buttonDisabled = true;
          buttonClass += ' is-max';
        } else {
          buttonText = `₩${nextCost.toLocaleString()} 구매`;
          buttonDisabled = !canAfford;
        }

        card.innerHTML = `
          <div class="shop-item-icon" aria-hidden="true">${def.icon}</div>
          <div class="shop-item-info">
            <div class="shop-item-title-row">
              <span class="shop-item-name">${def.name}</span>
              <span class="shop-item-level-badge">Lv.${currentLvl} / ${maxLvl}</span>
            </div>
            <div class="shop-item-dots" aria-hidden="true">${dotsHtml}</div>
            <p class="shop-item-desc">${def.desc}</p>
            <div class="shop-item-effect">
              <span>${effectText}</span>
              ${!isMax ? `<span class="shop-item-next-effect">▶ 다음: ${nextEffectText}</span>` : ''}
            </div>
          </div>
          <button type="button" class="${buttonClass}" ${buttonDisabled ? 'disabled' : ''} data-buy-id="${id}">
            ${buttonText}
          </button>
        `;

        const buyBtn = card.querySelector(`[data-buy-id="${id}"]`);
        if (buyBtn && !buttonDisabled) {
          buyBtn.addEventListener('click', () => {
            const res = this.meta.purchaseUpgrade(id);
            if (res.success) {
              this.updateCurrencyDisplay();
              this.renderShop();
              if (typeof this.onUpgradePurchased === 'function') {
                this.onUpgradePurchased(id, res);
              }
            }
          });
        }

        this.shopItemsListEl.appendChild(card);
      });
    }

    /**
     * Phase 13: 사원 인사 발령 (캐릭터 선택 및 해금) 시스템 초기화 및 이벤트 연결
     */
    initCharacterSelect(characterSystem = null, metaProgression = null, onCharacterChanged = null) {
      this.characterSystem = characterSystem || PO.characterSystem;
      this.meta = metaProgression || PO.metaProgression;
      this.onCharacterChanged = onCharacterChanged;

      if (this.hudOpenCharBtnEl) {
        this.hudOpenCharBtnEl.addEventListener('click', () => this.openCharacterModal());
      }
      if (this.gameOverCharBtnEl) {
        this.gameOverCharBtnEl.addEventListener('click', () => this.openCharacterModal());
      }
      if (this.victoryCharBtnEl) {
        this.victoryCharBtnEl.addEventListener('click', () => this.openCharacterModal());
      }
      if (this.charCloseBtnEl) {
        this.charCloseBtnEl.addEventListener('click', () => this.closeCharacterModal());
      }

      if (this.charModalEl) {
        this.charModalEl.addEventListener('click', (e) => {
          if (e.target === this.charModalEl) {
            this.closeCharacterModal();
          }
        });
      }

      // ESC 키로 캐릭터 모달 닫기
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isCharacterModalOpen()) {
          this.closeCharacterModal();
          e.stopPropagation();
        }
      });

      if (this.characterSystem && typeof this.characterSystem.subscribe === 'function') {
        this.characterSystem.subscribe(() => {
          this.updateCharacterDisplay();
          if (this.isCharacterModalOpen()) {
            this.renderCharacters();
          }
        });
      }

      this.updateCharacterDisplay();
    }

    /**
     * HUD 캐릭터 칩 및 모달 내 재화/캐릭터 상태 갱신
     */
    updateCharacterDisplay() {
      if (!this.characterSystem) return;
      const currentChar = this.characterSystem.getSelectedCharacter();

      if (this.hudCharNameEl && currentChar) {
        this.hudCharNameEl.textContent = currentChar.name;
      }
      if (this.hudCharIconEl && currentChar) {
        this.hudCharIconEl.textContent = currentChar.icon || '👔';
      }

      const balance = this.meta ? this.meta.getCurrency() : 0;
      if (this.charCurrencyValEl) {
        this.charCurrencyValEl.textContent = `₩${balance.toLocaleString()}`;
      }
    }

    /**
     * 캐릭터 선택 모달 열기
     */
    openCharacterModal() {
      if (this.charModalEl) {
        this.charModalEl.hidden = false;
        this.updateCharacterDisplay();
        this.renderCharacters();
      }
    }

    /**
     * 캐릭터 선택 모달 닫기
     */
    closeCharacterModal() {
      if (this.charModalEl) {
        this.charModalEl.hidden = true;
      }
    }

    /**
     * 캐릭터 선택 모달 열림 여부
     */
    isCharacterModalOpen() {
      return Boolean(this.charModalEl && !this.charModalEl.hidden);
    }

    /**
     * 캐릭터 목록 동적 렌더링
     */
    renderCharacters() {
      if (!this.charItemsListEl || !this.characterSystem) {
        return;
      }

      const chars = this.characterSystem.getAllCharacters();
      const currentSelectedId = this.characterSystem.getSelectedCharacterId();
      const currentBalance = this.meta ? this.meta.getCurrency() : 0;

      this.charItemsListEl.innerHTML = '';

      chars.forEach((cfg) => {
        const isUnlocked = this.characterSystem.isUnlocked(cfg.id);
        const isSelected = cfg.id === currentSelectedId;
        const canAfford = !isUnlocked && currentBalance >= cfg.unlockCost;

        const card = document.createElement('div');
        let cardClass = 'char-item-card';
        if (isSelected) cardClass += ' is-selected';
        else if (!isUnlocked) cardClass += ' is-locked';
        card.className = cardClass;
        card.setAttribute('data-char-id', cfg.id);

        let statusBadgeHtml = '';
        if (isSelected) {
          statusBadgeHtml = '<span class="char-item-status-badge is-selected">출근 중</span>';
        } else if (isUnlocked) {
          statusBadgeHtml = '<span class="char-item-status-badge is-unlocked">해금 완료</span>';
        } else {
          statusBadgeHtml = `<span class="char-item-status-badge is-locked">🔒 잠김 (₩${cfg.unlockCost})</span>`;
        }

        let buttonHtml = '';
        if (isSelected) {
          buttonHtml = '<button type="button" class="char-action-btn is-active" disabled>출근 중</button>';
        } else if (isUnlocked) {
          buttonHtml = `<button type="button" class="char-action-btn is-select" data-action="select" data-id="${cfg.id}">출근하기</button>`;
        } else {
          const btnDisabled = !canAfford;
          buttonHtml = `<button type="button" class="char-action-btn is-unlock" data-action="unlock" data-id="${cfg.id}" ${btnDisabled ? 'disabled' : ''}>₩${cfg.unlockCost} 해금</button>`;
        }

        card.innerHTML = `
          <div class="char-item-icon" aria-hidden="true">${cfg.icon}</div>
          <div class="char-item-info">
            <div class="char-item-title-row">
              <span class="char-item-name">${cfg.name}</span>
              <span class="char-item-role-badge">${cfg.role}</span>
              ${statusBadgeHtml}
            </div>
            <p class="char-item-desc">${cfg.desc}</p>
            <div class="char-perk-box">
              <span class="char-perk-badge">⚡ ${cfg.perkName}</span>
              <span class="char-perk-desc">${cfg.perkDesc}</span>
            </div>
          </div>
          ${buttonHtml}
        `;

        const actionBtn = card.querySelector('[data-action]');
        if (actionBtn) {
          actionBtn.addEventListener('click', () => {
            const action = actionBtn.getAttribute('data-action');
            if (action === 'unlock') {
              const res = this.characterSystem.unlockCharacter(cfg.id, this.meta);
              if (res.success) {
                this.updateCurrencyDisplay();
                this.updateCharacterDisplay();
                this.renderCharacters();
                if (typeof this.onCharacterChanged === 'function') {
                  this.onCharacterChanged(cfg.id, 'unlock');
                }
              }
            } else if (action === 'select') {
              const res = this.characterSystem.selectCharacter(cfg.id);
              if (res.success) {
                this.updateCharacterDisplay();
                this.renderCharacters();
                if (typeof this.onCharacterChanged === 'function') {
                  this.onCharacterChanged(cfg.id, 'select');
                }
              }
            }
          });
        }

        this.charItemsListEl.appendChild(card);
      });
    }

    /**
     * Phase 11 & 12: 탈출 성공(Victory) 결과 화면 표시
     */
    showVictory(stats = {}) {
      if (this.victoryTimeEl) {
        this.victoryTimeEl.textContent = stats.runTime || '00:00';
      }
      if (this.victoryKillsEl) {
        this.victoryKillsEl.textContent = `${stats.kills ?? 0}마리`;
      }
      if (this.victoryBossEl) {
        this.victoryBossEl.textContent = stats.bossKilled
          ? '야근 감독관 처치 완료'
          : (stats.bossStatus || '야근 감독관 처치 완료');
      }
      if (this.victoryEquipmentEl) {
        this.victoryEquipmentEl.textContent = stats.equipment || '기본 장비';
      }

      // Phase 12: 이번 런 획득 수당 및 총 보유 수당 표시
      if (this.victoryRewardEl) {
        const rewardAmt = stats.earnedCurrency ?? 0;
        this.victoryRewardEl.textContent = `+₩${rewardAmt.toLocaleString()}`;
      }
      if (this.victoryTotalEl) {
        const totalAmt = stats.totalCurrency ?? (this.meta ? this.meta.getCurrency() : 0);
        this.victoryTotalEl.textContent = `₩${totalAmt.toLocaleString()}`;
      }

      if (this.victoryOverlayEl) {
        this.victoryOverlayEl.hidden = false;
      }
      this.updateCurrencyDisplay();
    }

    /**
     * Phase 11: 탈출 성공 결과 화면 숨김
     */
    hideVictory() {
      if (this.victoryOverlayEl) {
        this.victoryOverlayEl.hidden = true;
      }
    }

    /**
     * 게임 오버 오버레이 표시 여부 제어 및 Phase 12 통계 갱신
     */
    setGameOver(isGameOver, stats = {}) {
      const next = Boolean(isGameOver);
      if (next === this._lastGameOver && this.gameOverOverlayEl) {
        return;
      }
      this._lastGameOver = next;
      if (this.gameOverOverlayEl) {
        this.gameOverOverlayEl.hidden = !next;
      }

      if (next) {
        if (this.gameOverKillsEl && stats.kills !== undefined) {
          this.gameOverKillsEl.textContent = `${stats.kills}마리`;
        }
        if (this.gameOverRewardEl && stats.earnedCurrency !== undefined) {
          this.gameOverRewardEl.textContent = `+₩${stats.earnedCurrency.toLocaleString()}`;
        }
        if (this.gameOverTotalEl) {
          const totalAmt = stats.totalCurrency ?? (this.meta ? this.meta.getCurrency() : 0);
          this.gameOverTotalEl.textContent = `₩${totalAmt.toLocaleString()}`;
        }
        this.updateCurrencyDisplay();
      }
    }

    /**
     * 디버그 시드 텍스트 및 배지 노출 여부 제어 (기본값: 일반 플레이 UI 간결화를 위해 숨김)
     */
    setDebugSeed(seedText, visible = false) {
      if (this.debugSeedTextEl) {
        this.debugSeedTextEl.textContent = seedText ? String(seedText) : '-';
      }
      if (this.debugSeedBadgeEl) {
        this.debugSeedBadgeEl.hidden = !visible;
      }
    }

    /**
     * 플레이어의 체력, 입력 상태, 무기/강화 상태, 대시 상태, 아이템 안내, 전투 방 상태, 보스 상태 및 사망 여부를 UI에 반영
     */
    update(
      player,
      inputState,
      combatUIState = null,
      dashUIState = null,
      isGameOver = false,
      itemUIState = null,
      combatRoomUIState = null,
      bossUIState = null,
      escapePrompt = null
    ) {
      this._syncHealth(player.hp, player.maxHp, player.hurtFlashTimer > 0);
      const effectiveGameOver = isGameOver || Boolean(player.isDead);
      this.setGameOver(effectiveGameOver);

      if (inputState) {
        this._syncKeys(inputState);
      }
      if (combatUIState) {
        this._syncCombat(combatUIState);
      }
      const effectiveDashState =
        dashUIState || (player.getDashUIState ? player.getDashUIState() : null);
      if (effectiveDashState) {
        this._syncDash(effectiveDashState);
      }

      this._syncItems(effectiveGameOver ? null : itemUIState, effectiveGameOver ? null : escapePrompt);
      this._syncCombatRoom(effectiveGameOver ? null : combatRoomUIState);
      this._syncBoss(effectiveGameOver ? null : bossUIState);
    }

    _syncHealth(hp, maxHp, isHurt = false) {
      if (isHurt !== this._lastHurtState) {
        this._lastHurtState = isHurt;
        if (this.statusPanelEl) {
          this.statusPanelEl.classList.toggle('is-hurt', isHurt);
        }
      }
      const safeMax = Math.max(1, maxHp);
      const safeHp = Math.max(0, Math.min(safeMax, hp));

      if (safeHp === this._lastHp && safeMax === this._lastMaxHp) {
        return;
      }

      this._lastHp = safeHp;
      this._lastMaxHp = safeMax;

      const percent = (safeHp / safeMax) * 100;

      if (this.hpTextEl) {
        this.hpTextEl.textContent = `${safeHp} / ${safeMax}`;
      }
      if (this.hpBarFillEl) {
        this.hpBarFillEl.style.width = `${percent}%`;
      }
    }

    _syncKeys(state) {
      const keys = ['up', 'left', 'down', 'right', 'dash', 'interact'];
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const pressed = Boolean(state[k]);
        if (pressed !== this._lastKeyState[k]) {
          this._lastKeyState[k] = pressed;
          const el = this.keyEls[k];
          if (el) {
            el.classList.toggle('is-pressed', pressed);
          }
        }
      }
    }

    _syncDash(dashState) {
      let label = '사용 가능';
      let mode = 'ready';
      let percent = 100;

      if (dashState.isDashing) {
        label = '대시 중!';
        mode = 'dashing';
        percent = 100;
      } else if (!dashState.canDash && dashState.cooldownRemaining > 0.005) {
        label = `쿨다운 ${dashState.cooldownRemaining.toFixed(2)}s`;
        mode = 'cooling';
        percent = Math.round(dashState.cooldownRatio * 100);
      }

      if (label !== this._lastDashLabel) {
        this._lastDashLabel = label;
        if (this.dashStatusTextEl) {
          this.dashStatusTextEl.textContent = label;
        }
      }

      if (mode !== this._lastDashMode) {
        this._lastDashMode = mode;
        if (this.dashPanelEl) {
          this.dashPanelEl.classList.toggle('is-dashing', mode === 'dashing');
        }
        if (this.dashStatusTextEl) {
          this.dashStatusTextEl.classList.toggle('is-ready', mode === 'ready');
          this.dashStatusTextEl.classList.toggle('is-dashing', mode === 'dashing');
        }
        if (this.dashFillEl) {
          this.dashFillEl.classList.toggle('is-ready', mode === 'ready');
          this.dashFillEl.classList.toggle('is-dashing', mode === 'dashing');
        }
      }

      if (percent !== this._lastDashPercent) {
        this._lastDashPercent = percent;
        if (this.dashFillEl) {
          this.dashFillEl.style.width = `${percent}%`;
        }
      }
    }

    _syncCombat(combatState) {
      // 1. 장착 무기 슬롯, 이름, 공격 방식 갱신
      if (combatState.slot !== this._lastWeaponSlot) {
        this._lastWeaponSlot = combatState.slot;

        if (this.slotTab1El) {
          this.slotTab1El.classList.toggle('is-active', combatState.slot === 1);
        }
        if (this.slotTab2El) {
          this.slotTab2El.classList.toggle('is-active', combatState.slot === 2);
        }
        if (this.weaponNameEl) {
          this.weaponNameEl.textContent = combatState.weaponName;
        }
        if (this.weaponModeEl) {
          this.weaponModeEl.textContent = combatState.attackModeText;
        }
      }

      // 2. 현재 무기 강화 단계 및 적용 공격 데미지 표시
      const lv = combatState.upgradeLevel ?? 0;
      const maxLv = combatState.maxUpgradeLevel ?? 3;
      const bonusPct = combatState.upgradeBonusPercent ?? 0;
      const upgradeLabel =
        lv >= maxLv
          ? `MAX ${lv} / ${maxLv}단계 (+${bonusPct}%)`
          : lv > 0
            ? `+${lv} / ${maxLv}단계 (+${bonusPct}%)`
            : `${lv} / ${maxLv}단계`;

      if (upgradeLabel !== this._lastUpgradeText) {
        this._lastUpgradeText = upgradeLabel;
        if (this.weaponUpgradeTextEl) {
          this.weaponUpgradeTextEl.textContent = upgradeLabel;
          this.weaponUpgradeTextEl.classList.toggle('is-upgraded', lv > 0 && lv < maxLv);
          this.weaponUpgradeTextEl.classList.toggle('is-max', lv >= maxLv);
        }
      }

      const dmg = combatState.damage ?? combatState.baseDamage ?? 0;
      const baseDmg = combatState.baseDamage ?? dmg;
      const damageLabel = lv > 0 ? `${dmg} (기본 ${baseDmg})` : `${dmg}`;
      if (damageLabel !== this._lastDamageText) {
        this._lastDamageText = damageLabel;
        if (this.weaponDamageTextEl) {
          this.weaponDamageTextEl.textContent = damageLabel;
          this.weaponDamageTextEl.classList.toggle('is-upgraded', lv > 0);
        }
      }

      // 3. 탄약 UI 표시 여부 및 잔탄 수 갱신 (근접 무기는 탄약 UI를 표시하지 않음)
      if (combatState.usesAmmo !== this._lastUsesAmmo) {
        this._lastUsesAmmo = combatState.usesAmmo;
        if (this.weaponAmmoRowEl) {
          this.weaponAmmoRowEl.hidden = !combatState.usesAmmo;
        }
      }

      if (combatState.usesAmmo && combatState.ammo !== this._lastAmmo) {
        this._lastAmmo = combatState.ammo;
        if (this.weaponAmmoEl) {
          this.weaponAmmoEl.textContent = `${combatState.ammo} / ${combatState.maxAmmo}`;
          this.weaponAmmoEl.classList.toggle('is-empty', combatState.ammo <= 0);
        }
      }

      // 4. 공격 쿨다운 상태 텍스트 및 게이지 갱신
      let cooldownLabel = '공격 가능';
      let stateClass = 'ready';

      if (combatState.cooldownRemaining > 0.005) {
        cooldownLabel = `쿨다운 ${combatState.cooldownRemaining.toFixed(2)}s`;
        stateClass = 'cooling';
      } else if (combatState.usesAmmo && combatState.ammo <= 0) {
        cooldownLabel = '탄약 소진';
        stateClass = 'empty';
      }

      if (cooldownLabel !== this._lastCooldownText) {
        this._lastCooldownText = cooldownLabel;
        if (this.cooldownTextEl) {
          this.cooldownTextEl.textContent = cooldownLabel;
          this.cooldownTextEl.classList.toggle('is-ready', stateClass === 'ready');
          this.cooldownTextEl.classList.toggle('is-empty', stateClass === 'empty');
        }
      }

      const percent = Math.round(combatState.cooldownRatio * 100);
      if (percent !== this._lastCooldownPercent) {
        this._lastCooldownPercent = percent;
        if (this.cooldownFillEl) {
          this.cooldownFillEl.style.width = `${percent}%`;
          this.cooldownFillEl.classList.toggle('is-ready', combatState.cooldownRemaining <= 0.005);
        }
      }
    }

    _syncItems(itemUIState, escapePrompt = null) {
      const prompt = escapePrompt || (itemUIState ? itemUIState.prompt : null);
      const promptSig = prompt
        ? `${prompt.itemId}|${prompt.canPickup}|${prompt.title}|${prompt.detail}|${Boolean(prompt.isEscape)}`
        : '';

      if (promptSig !== this._lastPromptSig) {
        this._lastPromptSig = promptSig;
        if (this.interactionPromptEl) {
          if (!prompt) {
            this.interactionPromptEl.hidden = true;
          } else {
            this.interactionPromptEl.hidden = false;
            this.interactionPromptEl.classList.toggle('is-disabled', !prompt.canPickup);
            this.interactionPromptEl.classList.toggle('is-escape', Boolean(prompt.isEscape));
            if (this.interactionKeyEl) {
              this.interactionKeyEl.textContent = prompt.keyLabel || 'E';
            }
            if (this.interactionTitleEl) {
              this.interactionTitleEl.textContent = prompt.title;
            }
            if (this.interactionDetailEl) {
              this.interactionDetailEl.textContent = prompt.detail;
            }
          }
        }
      }

      const banner = itemUIState ? itemUIState.banner : null;
      const bannerSig = banner ? `${banner.kind}|${banner.title}|${banner.detail}` : '';

      if (bannerSig !== this._lastBannerSig) {
        this._lastBannerSig = bannerSig;
        if (this.itemBannerEl) {
          if (!banner) {
            this.itemBannerEl.hidden = true;
          } else {
            this.itemBannerEl.hidden = false;
            this.itemBannerEl.classList.toggle('is-upgrade', banner.kind === 'weapon_upgrade');
            this.itemBannerEl.classList.toggle('is-blocked', banner.kind === 'blocked');
            if (this.itemBannerTitleEl) {
              this.itemBannerTitleEl.textContent = banner.title;
            }
            if (this.itemBannerDetailEl) {
              this.itemBannerDetailEl.textContent = banner.detail;
            }
          }
        }
      }
    }

    _syncCombatRoom(combatRoomState) {
      const visible = Boolean(combatRoomState && combatRoomState.visible);
      const sig = visible
        ? `${combatRoomState.mode}|${combatRoomState.title}|${combatRoomState.counterText}|${combatRoomState.detailText}|${combatRoomState.opacity ?? 1}`
        : '';

      if (sig === this._lastCombatRoomSig) {
        return;
      }
      this._lastCombatRoomSig = sig;

      if (!this.combatRoomHudEl) {
        return;
      }

      if (!visible) {
        this.combatRoomHudEl.hidden = true;
        this.combatRoomHudEl.style.opacity = '';
        this.combatRoomHudEl.classList.remove('is-start', 'is-clear');
        return;
      }

      this.combatRoomHudEl.hidden = false;
      this.combatRoomHudEl.classList.toggle('is-start', combatRoomState.mode === 'start');
      this.combatRoomHudEl.classList.toggle('is-clear', combatRoomState.mode === 'clear');
      this.combatRoomHudEl.style.opacity = String(combatRoomState.opacity ?? 1);

      if (this.combatRoomTitleEl) {
        this.combatRoomTitleEl.textContent = combatRoomState.title;
      }
      if (this.combatRoomCounterEl) {
        this.combatRoomCounterEl.textContent = combatRoomState.counterText;
      }
      if (this.combatRoomDetailEl) {
        this.combatRoomDetailEl.textContent = combatRoomState.detailText || '';
      }
    }

    _syncBoss(bossUIState) {
      if (!this.bossBarWrapEl) {
        return;
      }

      // 보스 상태가 없거나, 각성/전투 개시 전이거나, 사망 후 숨김
      const visible = Boolean(
        bossUIState &&
        (bossUIState.isAwakened || bossUIState.state !== 'Idle') &&
        bossUIState.alive
      );

      const sig = visible
        ? `${bossUIState.name}|${bossUIState.hp}|${bossUIState.maxHp}|${bossUIState.ratio}`
        : 'hidden';

      if (sig === this._lastBossSig) {
        return;
      }
      this._lastBossSig = sig;

      if (!visible) {
        this.bossBarWrapEl.hidden = true;
        return;
      }

      this.bossBarWrapEl.hidden = false;
      if (this.bossNameEl) {
        this.bossNameEl.textContent = bossUIState.name || '야근 감독관';
      }
      if (this.bossHpTextEl) {
        this.bossHpTextEl.textContent = `${Math.round(bossUIState.hp)} / ${bossUIState.maxHp}`;
      }
      if (this.bossHpFillEl) {
        const pct = Math.max(0, Math.min(100, (bossUIState.hp / bossUIState.maxHp) * 100));
        this.bossHpFillEl.style.width = `${pct.toFixed(1)}%`;
      }
    }
  }

  PO.UIManager = UIManager;
})(window);
