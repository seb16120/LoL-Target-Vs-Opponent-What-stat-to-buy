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

function splitArmorAfterFlatReduction(totalArmor, naturalArmor, flatReduction) {
  const afterFlat = totalArmor - Math.max(0, flatReduction);
  const natural = Math.max(0, Math.min(Math.max(0, naturalArmor), afterFlat));
  const bonus = Math.max(0, afterFlat - natural);
  return { afterFlat, natural, bonus };
}

function effectiveArmor(rawArmor, naturalArmor, flatReduction, shredPct, bonusArmorPenPct, generalPenPct, lethality) {
  const split = splitArmorAfterFlatReduction(rawArmor, naturalArmor, flatReduction);
  const shred = 1 - clamp(shredPct, 0, 0.99);
  const naturalAfterShred = split.natural * shred;
  const bonusAfterShred = split.bonus * shred;

  // Bonus armor penetration, e.g. Yasuo, affects bonus armor only.
  const afterBonusArmorPen = naturalAfterShred + bonusAfterShred * (1 - clamp(bonusArmorPenPct, 0, 0.99));

  // General % armor penetration, e.g. LDR, affects remaining armor.
  const afterGeneralPen = afterBonusArmorPen * (1 - clamp(generalPenPct, 0, 0.99));
  return afterGeneralPen - Math.max(0, lethality);
}

function effectiveMR(raw, flatReduction, shredPct, penPct, flatPost) {
  const afterFlatReduction = raw - Math.max(0, flatReduction);
  const afterShred = afterFlatReduction * (1 - clamp(shredPct, 0, 0.99));
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
  const baseHp = Math.max(0, overrides.hp ?? n('hp'));
  const bonusHp = Math.max(0, overrides.bonusHp ?? n('bonusHp'));
  const totalHp = Math.max(1, baseHp + bonusHp);
  const armor = overrides.armor ?? n('armor');
  const naturalArmor = Math.max(0, overrides.naturalArmor ?? n('naturalArmor'));
  const mr = overrides.mr ?? n('mr');

  const physShare = Math.max(0, n('physShare'));
  const magicShare = Math.max(0, n('magicShare'));
  const trueShare = Math.max(0, n('trueShare'));
  const total = physShare + magicShare + trueShare;
  const pPhys = total ? physShare / total : 0;
  const pMagic = total ? magicShare / total : 0;
  const pTrue = total ? trueShare / total : 0;

  const generalArmorPen = combinePercentMultiplicative(
    pct('armorPenPct'),
    $('ldrEnabled')?.checked ? pct('ldrArmorPenPct') : 0
  );
  const bonusArmorPen = clamp(pct('bonusArmorPenPct'), 0, 0.99);
  const magicPen = combinePercentMultiplicative(
    pct('magicPenPct'),
    pct('bonusMagicPenPct')
  );

  const armorShred = clamp(pct('armorShredPct') + pct('bcShredPct'), 0, 0.99);
  const magicShred = clamp(pct('magicShredPct'), 0, 0.99);

  const effArmor = effectiveArmor(
    armor,
    naturalArmor,
    n('flatArmorPenPre'),
    armorShred,
    bonusArmorPen,
    generalArmorPen,
    n('lethality')
  );
  const effMR = effectiveMR(
    mr,
    n('flatMagicPenPre'),
    magicShred,
    magicPen,
    n('magicPenFlat')
  );

  const exhaust = $('exhausted')?.checked ? pct('exhaustReduction') : 0;
  const physExtra = pct('physReduction');
  const magicExtra = pct('magicReduction');
  const ldrAmp = ldrDamageAmp(bonusHp);

  // V0.6: damage modifiers multiply separately from resistances.
  // EHP_phys = TotalHP / (damage_modifiers * armor_damage_multiplier).
  const physicalPreResistMult = ldrAmp * (1 - exhaust) * (1 - physExtra);
  const magicPreResistMult = (1 - exhaust) * (1 - magicExtra);
  const armorTakenMult = dmgMult(effArmor);
  const mrTakenMult = dmgMult(effMR);
  const physTaken = physicalPreResistMult * armorTakenMult;
  const magicTaken = magicPreResistMult * mrTakenMult;
  const trueTaken = 1;

  const weighted = pPhys * physTaken + pMagic * magicTaken + pTrue * trueTaken;
  const safeWeighted = Math.max(0.000001, weighted);

  const physRawDmg = Math.max(0, n('physRawDmg'));
  const magicRawDmg = Math.max(0, n('magicRawDmg'));
  const trueRawDmg = Math.max(0, n('trueRawDmg'));
  const totalPhysicalRawAfterAmp = physRawDmg * ldrAmp;
  const totalPhysicalAfterMitigation = physRawDmg * physTaken;
  const totalMagicAfterMitigation = magicRawDmg * magicTaken;

  const armorMarginalScale = (1 - armorShred) * (1 - bonusArmorPen) * (1 - generalArmorPen);
  const mrMarginalScale = (1 - magicShred) * (1 - magicPen);
  const bonusArmor = Math.max(0, armor - naturalArmor);

  return {
    hp: baseHp, totalHp, armor, naturalArmor, bonusArmor, mr, bonusHp,
    pPhys, pMagic, pTrue, total,
    generalArmorPen, bonusArmorPen, magicPen, armorShred, magicShred,
    effArmor, effMR,
    physTaken, magicTaken, trueTaken,
    weighted: safeWeighted,
    ehp: totalHp / safeWeighted,
    physicalEhp: totalHp / Math.max(0.000001, physTaken),
    magicEhp: totalHp / Math.max(0.000001, magicTaken),
    trueEhp: totalHp,
    ldrAmp,
    physicalPreResistMult,
    magicPreResistMult,
    armorTakenMult,
    mrTakenMult,
    physRawDmg,
    magicRawDmg,
    trueRawDmg,
    totalPhysicalRawAfterAmp,
    totalPhysicalAfterMitigation,
    totalMagicAfterMitigation,
    armorMarginalScale,
    mrMarginalScale
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

  // +1 HP is treated as +1 bought bonus HP because the tool compares bought defensive stats.
  const hpPlus = readProfile({ hp: base.hp, bonusHp: base.bonusHp + 1 });
  // +1 armor is treated as bought bonus armor; naturalArmor stays unchanged.
  const armorPlus = readProfile({ armor: base.armor + 1, naturalArmor: base.naturalArmor });
  const mrPlus = readProfile({ mr: base.mr + 1 });

  const hpGain = hpPlus.ehp - base.ehp;
  const armorGain = armorPlus.ehp - base.ehp;
  const mrGain = mrPlus.ehp - base.ehp;

  const hpRatio = hpGain / hpGold;
  const armorRatio = armorGain / armorGold;
  const mrRatio = mrGain / mrGold;
  const best = [['HP', hpRatio], ['Armor', armorRatio], ['MR', mrRatio]].sort((a, b) => b[1] - a[1]);

  const targetGold = base.totalHp * hpGold + Math.max(0, base.armor) * armorGold + Math.max(0, base.mr) * mrGold;
  const effectiveGold = base.ehp * hpGold;

  $('damageTotal').textContent = `Damage total: ${fmt(base.total, 1)}%`;
  $('effectiveHealth').textContent = fmt(base.ehp, 0);
  $('totalHpOut').textContent = fmt(base.totalHp, 0);
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
    `Total HP : <b>${flex(base.totalHp, 0)}</b><br>` +
    `Armor total : <b>${flex(base.armor, 2)}</b> • Natural armor : <b>${flex(base.naturalArmor, 2)}</b> • Bonus armor : <b>${flex(base.bonusArmor, 2)}</b><br>` +
    `Armor effective : <b>${flex(base.effArmor, 3)}</b> • ` +
    `MR effective : <b>${flex(base.effMR, 3)}</b><br>` +
    `General armor pen total : <b>${flex(base.generalArmorPen * 100, 2)}%</b> • ` +
    `Bonus armor pen : <b>${flex(base.bonusArmorPen * 100, 2)}%</b><br>` +
    `Magic pen total : <b>${flex(base.magicPen * 100, 2)}%</b><br>` +
    `Bought armor marginal scale : <b>${flex(base.armorMarginalScale, 3)}</b> • ` +
    `MR scale marginal : <b>${flex(base.mrMarginalScale, 3)}</b>`;

  $('effectiveDamageAmp').innerHTML =
    `LDR physical dmg amp : <b>${flex(base.ldrAmp * 100, 2)}%</b> ` +
    `(bonus <b>${flex((base.ldrAmp - 1) * 100, 2)}%</b>)<br>` +
    `Physical raw dmg : <b>${flex(base.physRawDmg, 2)}</b> → ` +
    `Total physical dmg : <b>${flex(base.totalPhysicalRawAfterAmp, 2)}</b><br>` +
    `Magic raw dmg : <b>${flex(base.magicRawDmg, 2)}</b> → ` +
    `Total magic dmg : <b>${flex(base.magicRawDmg, 2)}</b><br>` +
    `Physical pre-resist mult : <b>${flex(base.physicalPreResistMult * 100, 2)}%</b> • ` +
    `Magic pre-resist mult : <b>${flex(base.magicPreResistMult * 100, 2)}%</b><br>` +
    `Armor mitigation mult : <b>${flex(base.armorTakenMult * 100, 2)}%</b> • ` +
    `MR mitigation mult : <b>${flex(base.mrTakenMult * 100, 2)}%</b><br>` +
    `Final physical taken : <b>${flex(base.physTaken * 100, 2)}%</b> • ` +
    `Final magic taken : <b>${flex(base.magicTaken * 100, 2)}%</b><br>` +
    `Physical after mitigation : <b>${flex(base.totalPhysicalAfterMitigation, 2)}</b> • ` +
    `Magic after mitigation : <b>${flex(base.totalMagicAfterMitigation, 2)}</b>`;

  if (sumHpPctInputs() > 0) {
    $('conclusionDetail').textContent += ' Attention : des dégâts %HP sont saisis ; la recommandation V0.6 ne remplace pas encore une simulation temporelle complète.';
  }
}

$('calculator').addEventListener('submit', calculate);
inputs.forEach(i => {
  i.addEventListener('input', calculate);
  i.addEventListener('change', calculate);
});
calculate();