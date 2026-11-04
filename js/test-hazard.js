(function (global) {
  'use strict';

  const PO = (global.PO = global.PO || {});

  /**
   * [임시 무적 판정 검증용 모듈]
   * 적 AI 구현 전 대시 무적 시간(0.25초) 동안 피해 무효화 및 무적 종료 후 정상 피격을
   * 확인하기 위한 바닥 누전 위험 구역.
   * 실제 전투/이동 코어 로직과 완전히 분리되어 있어 추후 스크립트 제거만으로 손쉽게 삭제 가능.
   */
  class TestDamageZone {
    constructor(config = {}) {
      this.x = config.x ?? 425;
      this.y = config.y ?? 638;
      this.radius = config.radius ?? 34;
      this.damage = config.damage ?? 10;
      this.damageInterval = config.damageInterval ?? 0.45;

      this.pulsePhase = 0;
      this.tickCooldown = 0;
      this.popups = [];
    }

    update(dt, player) {
      if (dt <= 0) {
        return;
      }

      this.pulsePhase += dt * 5;
      if (this.tickCooldown > 0) {
        this.tickCooldown = Math.max(0, this.tickCooldown - dt);
      }

      // 팝업 갱신
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.elapsed += dt;
        p.y -= dt * 26;
        if (p.elapsed >= p.duration) {
          this.popups.splice(i, 1);
        }
      }

      // 플레이어와 위험 구역 바닥 원형 충돌 검사
      const dx = player.position.x - this.x;
      const dy = player.position.y - this.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= this.radius + player.colliderRadius && this.tickCooldown <= 0) {
        const res = player.takeDamage(this.damage);

        if (res.blockedByInvincibility) {
          this.popups.push({
            x: player.position.x,
            y: player.position.y - 60,
            text: '무적 회피!',
            color: '#67e8f9',
            elapsed: 0,
            duration: 0.6
          });
          // 무적 종료 직후 구역 내부에 머물러 있으면 정상 피격되는지 곧바로 확인할 수 있도록 짧은 간격 적용
          this.tickCooldown = 0.12;
        } else if (res.applied) {
          this.popups.push({
            x: player.position.x,
            y: player.position.y - 60,
            text: `-${res.damage}`,
            color: '#fb7185',
            elapsed: 0,
            duration: 0.65
          });
          this.tickCooldown = this.damageInterval;
        }
      }
    }

    /**
     * 바닥 레이어에 위험 구역 도형 렌더링
     */
    renderFloor(ctx) {
      const pulse = 0.5 + 0.5 * Math.sin(this.pulsePhase);

      ctx.save();
      ctx.translate(this.x, this.y);

      // 외곽 경고 원 (쿼터뷰 타원 비율)
      ctx.save();
      ctx.scale(1, 0.78);

      ctx.fillStyle = `rgba(244, 63, 94, ${(0.16 + pulse * 0.1).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `rgba(251, 113, 133, ${(0.65 + pulse * 0.25).toFixed(3)})`;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 내부 번개/누전 기호 도형
      ctx.fillStyle = '#fde047';
      ctx.strokeStyle = '#111420';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(3, -13);
      ctx.lineTo(-7, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-4, 13);
      ctx.lineTo(8, -2);
      ctx.lineTo(1, -2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // 안내 라벨
      ctx.font = '700 10.5px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = '#111420';
      ctx.lineWidth = 3;
      const label = '무적 테스트 구역 (-10)';
      ctx.strokeText(label, 0, this.radius * 0.78 + 14);
      ctx.fillStyle = '#fda4af';
      ctx.fillText(label, 0, this.radius * 0.78 + 14);

      ctx.restore();
    }

    /**
     * 상단 이펙트 레이어에 피격/무적 회피 팝업 렌더링
     */
    renderPopups(ctx) {
      if (this.popups.length === 0) {
        return;
      }

      ctx.save();
      ctx.font = '800 14px "Malgun Gothic", sans-serif';
      ctx.textAlign = 'center';

      for (let i = 0; i < this.popups.length; i++) {
        const p = this.popups[i];
        const t = Math.min(1, p.elapsed / p.duration);
        const alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;

        ctx.globalAlpha = Math.max(0, alpha);
        ctx.strokeStyle = '#111420';
        ctx.lineWidth = 3.5;
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      }

      ctx.restore();
    }
  }

  PO.TestDamageZone = TestDamageZone;
})(window);
