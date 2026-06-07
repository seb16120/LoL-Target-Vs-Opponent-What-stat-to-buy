const $ = id => document.getElementById(id);
const inputs = Array.from(document.querySelectorAll('input'));

function n(id) {
  const el = $(id);
  const v = el ? parseFloat(el.value) : 0;
  return Number.isFinite(v) ? v : 0;
}
function pct(id) { return n(id) / 100; }
function clamp(x, a, b) { return Math.min(Math.max(x, a), b); }
function fmt(x, d = 0) {
  return Number.isFinite(x)
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(x)
    : '—';
}
function flex(x, d = 4) {
  return Number.isFinite(x)
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d }).format(x)
    : '—';
}

function combinePercentMultiplicative(...values) {
  return 1 - values.map(v => clamp(v, 0, 0.99)).reduce((acc, v) => acc * (1 - v), 1);
}

function effectiveResist(raw, flatPre, shredPct, penPct, flatPost) {
  const afterFlatPre = raw - Math.max(0, flatPre);
  const afterShred = afterFlatPre * (1 - clamp(shredPct, 0, 0.99));
  const afterPctPen = afterShred * (1 - clamp(penPct, 0, 0.99));
  return afterPctPen - Math.max(0, flatPost);
}

function dmgMult(resist) {
  return resist >= 0 ? 100 / (100 + resist) : 2 - (100 / (100 - resist));
}

function ldrDamageAmp(bonusHp) {
  if (!$('ldrEnabled')?.checked) return 1;
  const bonus = clamp(Math.max(0, bonusHp) / 100, 0, 15);
  return 1 + bonus / 100;
}

function readProfile(overrides = {}) {
  const hp = Math.max(1, overrides.hp ?? n('hp'));
  const armor = overrides.armor ?? n('armor');
  const mr = overrides.mr ?? n('mr');
  const bonusHp = Math.max(0, overrides.bonusHp ?? n('bonusHp'));

  const physShare = Math.max(0, n('physShare'));
  const magicShare = Math.max(0, n('magicShare'));
  const trueShare = Math.max(0, n('trueShare'));
  const total = physShare + magicShare + trueShare;
  const pPhys = total ? physShare / total : 0;
  const pMagic = total ? magicShare / total : 0;
  const pTrue = total ? trueShare / total : 0;

  const armorPen = combinePercentMultiplicative(
    pct('armorPenPct'),
    pct('bonusArmorPenPct'),
    $('ldrEnabled')?.checked ? pct('ldrArmorPenPct') : 0
  );
  const magicPen = combinePercentMultiplicative(
    pct('magicPenPct'),
    pct('bonusMagicPenPct')
  );

  const armorShred = clamp(pct('armorShredPct') + pct('bcShredPct'), 0, 0.99);
  const magicShred = clamp(pct('magicShredPct'), 0, 0.99);

  const effArmor = effectiveResist(
    armor,
    n('flatArmorPenPre'),
    armorShred,
    armorPen,
    n('lethality')
  );
  const effMR = effectiveResist(
    mr,
    n('flatMagicPenPre'),
    magicShred,
    magicPen,
    n('magicPenFlat')
  );

  const exhaust = $('exhausted')?.checked ? pct('exhaustReduction') : 0;
  const physExtra = pct('physReduction');
  const magicExtra = pct('magicReduction');

  const physTaken = dmgMult(effArmor) * (1 - physExtra) * (1 - exhaust) * ldrDamageAmp(bonusHp);
  const magicTaken = dmgMult(effMR) * (1 - magicExtra) * (1 - exhaust);
  const trueTaken = 1;

  const weighted = pPhys * physTaken + pMagic * magicTaken + pTrue * trueTaken;
  const safeWeighted = Math.max(0.000001, weighted);

  return {
    hp, armor, mr, bonusHp,
    pPhys, pMagic, pTrue, total,
    armorPen, magicPen, armorShred, magicShred,
    effArmor, effMR,
    physTaken, magicTaken, trueTaken,
    weighted: safeWeighted,
    ehp: hp / safeWeighted,
    physicalEhp: hp / Math.max(0.000001, physTaken),
    magicEhp: hp / Math.max(0.000001, magicTaken),
    ldrAmp: ldrDamageAmp(bonusHp)
  };
}

function sumHpPctInputs() {
  return [
    'maxHpPhys', 'maxHpMagic', 'maxHpTrue',
    'curHpPhys', 'curHpMagic', 'curHpTrue',
    'remainingHpPhys', 'remainingHpMagic', 'remainingHpTrue'
  ].map(n).reduce((a, b) => a + Math.max(0, b), 0);
}

function calculate(ev) {
  ev?.preventDefault();

  const base = readProfile();
  const hpGold = Math.max(0.0001, n('hpGold'));
  const armorGold = Math.max(0.0001, n('armorGold'));
  const mrGold = Math.max(0.0001, n('mrGold'));

  // +1 HP is treated as +1 item bonus HP too, because the tool compares bought defensive stats.
  const hpPlus = readProfile({ hp: base.hp + 1, bonusHp: base.bonusHp + 1 });
  const armorPlus = readProfile({ armor: base.armor + 1 });
  const mrPlus = readProfile({ mr: base.mr + 1 });

  const hpGain = hpPlus.ehp - base.ehp;
  const armorGain = armorPlus.ehp - base.ehp;
  const mrGain = mrPlus.ehp - base.ehp;

  const hpRatio = hpGain / hpGold;
  const armorRatio = armorGain / armorGold;
  const mrRatio = mrGain / mrGold;
  const best = [['HP', hpRatio], ['Armor', armorRatio], ['MR', mrRatio]].sort((a, b) => b[1] - a[1]);

  const targetGold = base.hp * hpGold + Math.max(0, base.armor) * armorGold + Math.max(0, base.mr) * mrGold;
  const effectiveGold = base.ehp * hpGold;

  $('damageTotal').textContent = `Damage total: ${fmt(base.total, 1)}%`;
  $('effectiveHealth').textContent = fmt(base.ehp, 0);
  $('physicalEhp').textContent = fmt(base.physicalEhp, 0);
  $('magicEhp').textContent = fmt(base.magicEhp, 0);
  $('physicalReduction').textContent = `${fmt((1 - base.physTaken) * 100, 1)}%`;
  $('magicReductionOut').textContent = `${fmt((1 - base.magicTaken) * 100, 1)}%`;
  $('statGoldValue').textContent = `${fmt(targetGold, 0)}g`;
  $('effectiveGoldValue').textContent = `${fmt(effectiveGold, 0)}g`;

  $('physTaken').textContent = `${fmt(base.physTaken * 100, 1)}%`;
  $('magicTaken').textContent = `${fmt(base.magicTaken * 100, 1)}%`;
  $('trueTaken').textContent = `${fmt(base.trueTaken * 100, 1)}%`;
  $('physBar').style.width = `${clamp(base.physTaken * 100, 0, 100)}%`;
  $('magicBar').style.width = `${clamp(base.magicTaken * 100, 0, 100)}%`;
  $('trueBar').style.width = `${clamp(base.trueTaken * 100, 0, 100)}%`;

  $('hpRatio').textContent = `${flex(hpRatio)} EHP/g`;
  $('armorRatio').textContent = `${flex(armorRatio)} EHP/g`;
  $('mrRatio').textContent = `${flex(mrRatio)} EHP/g`;
  $('hpGain').textContent = `+1 HP = +${flex(hpGain)} EHP`;
  $('armorGain').textContent = `+1 Armor = +${flex(armorGain)} EHP`;
  $('mrGain').textContent = `+1 MR = +${flex(mrGain)} EHP`;

  $('conclusion').textContent = `Acheter : ${best[0][0]}`;
  $('conclusionDetail').textContent = `${best[0][0]} domine en EHP/gold marginal. Écart avec le 2e : ${flex(best[0][1] - best[1][1])} EHP/g.`;

  $('effectiveResists').innerHTML =
    `Armor effective : <b>${flex(base.effArmor, 3)}</b> • ` +
    `MR effective : <b>${flex(base.effMR, 3)}</b> • ` +
    `Armor pen total : <b>${flex(base.armorPen * 100, 2)}%</b> • ` +
    `Magic pen total : <b>${flex(base.magicPen * 100, 2)}%</b> • ` +
    `Armor scale marginal : <b>${flex((1 - base.armorShred) * (1 - base.armorPen), 3)}</b> • ` +
    `MR scale marginal : <b>${flex((1 - base.magicShred) * (1 - base.magicPen), 3)}</b> • ` +
    `LDR physical dmg amp : <b>${flex(base.ldrAmp * 100, 2)}%</b>`;

  if (sumHpPctInputs() > 0) {
    $('conclusionDetail').textContent += ' Attention : des dégâts %HP sont saisis ; la recommandation V0.3 ne remplace pas encore une simulation temporelle complète.';
  }
}

$('calculator').addEventListener('submit', calculate);
inputs.forEach(i => {
  i.addEventListener('input', calculate);
  i.addEventListener('change', calculate);
});
calculate();
