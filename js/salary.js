/**
 * salary.js — Calcul du salaire prévisionnel
 * TachoReader
 *
 * Calcule à partir des activités tachygraphe :
 *  - Heures de travail rémunérées (conduite + travail)
 *  - Distinction heures normales / heures supplémentaires
 *  - Majoration heures de nuit, dimanches, jours fériés
 *  - Total brut estimé
 */

'use strict';

/* ============================================================
   JOURS FÉRIÉS FRANCE (année courante + année précédente)
   Calcul algorithmique pour ne pas dépendre d'une base statique.
   ============================================================ */

/**
 * Retourne les jours fériés français pour une année donnée.
 * @param {number} year
 * @returns {Set<string>} set de chaînes YYYY-MM-DD
 */
function getFrenchHolidays(year) {
  // Calcul de Pâques (algorithme de Meeus/Jones/Butcher)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);

  const addDays = (d, n) => {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
  };

  const toKey = d => d.toISOString().slice(0, 10);

  return new Set([
    `${year}-01-01`,  // Jour de l'An
    toKey(addDays(easter, 1)),  // Lundi de Pâques
    `${year}-05-01`,  // Fête du Travail
    `${year}-05-08`,  // Victoire 1945
    toKey(addDays(easter, 39)), // Ascension
    toKey(addDays(easter, 50)), // Lundi de Pentecôte
    `${year}-07-14`,  // Fête Nationale
    `${year}-08-15`,  // Assomption
    `${year}-11-01`,  // Toussaint
    `${year}-11-11`,  // Armistice
    `${year}-12-25`,  // Noël
  ]);
}

/* ============================================================
   FONCTION PRINCIPALE DE CALCUL
   ============================================================ */

/**
 * Calcule le salaire prévisionnel à partir des activités.
 *
 * @param {Activity[]} activities - activités filtrées sur la période
 * @param {object}     config     - configuration salariale (voir DEFAULT_SALARY_CONFIG)
 * @returns {SalarySummary}
 */
function computeSalary(activities, config) {
  if (!activities || activities.length === 0) {
    return emptySummary(config);
  }

  // Constantes de configuration
  const rate          = parseFloat(config.rate)          || 13.50;
  const ot1Pct        = parseFloat(config.ot1Percent)    || 25;
  const ot2Pct        = parseFloat(config.ot2Percent)    || 50;
  const ot1Threshold  = parseFloat(config.ot1Threshold)  || 151.67;  // heures
  const ot2Threshold  = parseFloat(config.ot2Threshold)  || 200;     // heures
  const nightBonus    = parseFloat(config.nightBonus)    || 2.50;    // €/h
  const sundayBonus   = parseFloat(config.sundayBonus)   || 3.00;    // €/h
  const holidayBonus  = parseFloat(config.holidayBonus)  || 5.00;    // €/h
  const nightStartH   = parseInt(config.nightStart, 10)  || 21;      // heure
  const nightEndH     = parseInt(config.nightEnd,   10)  || 6;       // heure

  // Jours fériés pour les années couvertes par les activités
  const years = [...new Set(activities.map(a => new Date(a.start).getFullYear()))];
  const holidays = new Set();
  years.forEach(y => getFrenchHolidays(y).forEach(d => holidays.add(d)));

  // Déterminer la période
  const starts  = activities.map(a => new Date(a.start));
  const ends    = activities.map(a => new Date(a.end));
  const minDate = new Date(Math.min(...starts));
  const maxDate = new Date(Math.max(...ends));

  // Activités rémunérées = conduite + travail
  const paidActs = activities.filter(a => a.type === 'driving' || a.type === 'work');

  // ── Calcul minute par minute des types d'heures ──
  let totalMinutes        = 0;
  let nightMinutes        = 0;
  let sundayMinutes       = 0;
  let holidayMinutes      = 0;

  for (const act of paidActs) {
    const start = new Date(act.start);
    const end   = new Date(act.end);
    const durMin = Math.max(0, Math.round((end - start) / 60000));
    totalMinutes += durMin;

    // Découper l'activité par tranches de 1 minute pour classer précisément
    // (optimisation : découper par heure entière plutôt que minute par minute)
    const segments = splitByHour(start, end);

    for (const seg of segments) {
      const segMin   = Math.round((seg.end - seg.start) / 60000);
      const isNight   = isNightHour(seg.start, nightStartH, nightEndH);
      const isSunday  = seg.start.getDay() === 0;
      const dayKey    = seg.start.toISOString().slice(0, 10);
      const isHoliday = holidays.has(dayKey);

      if (isHoliday)     holidayMinutes  += segMin;
      else if (isSunday) sundayMinutes   += segMin;
      else if (isNight)  nightMinutes    += segMin;
    }
  }

  // ── Conversion en heures ──
  const totalHours   = totalMinutes / 60;
  const nightHours   = nightMinutes / 60;
  const sundayHours  = sundayMinutes / 60;
  const holidayHours = holidayMinutes / 60;

  // ── Classification heures normales / heures sup ──
  let normalHours = 0, ot1Hours = 0, ot2Hours = 0;

  if (totalHours <= ot1Threshold) {
    normalHours = totalHours;
  } else if (totalHours <= ot2Threshold) {
    normalHours = ot1Threshold;
    ot1Hours    = totalHours - ot1Threshold;
  } else {
    normalHours = ot1Threshold;
    ot1Hours    = ot2Threshold - ot1Threshold;
    ot2Hours    = totalHours   - ot2Threshold;
  }

  // ── Calcul brut ──
  const normalPay   = normalHours * rate;
  const ot1Pay      = ot1Hours    * rate * (1 + ot1Pct / 100);
  const ot2Pay      = ot2Hours    * rate * (1 + ot2Pct / 100);
  const nightPay    = nightHours   * nightBonus;
  const sundayPay   = sundayHours  * sundayBonus;
  const holidayPay  = holidayHours * holidayBonus;
  const totalBrut   = normalPay + ot1Pay + ot2Pay + nightPay + sundayPay + holidayPay;

  return {
    periode:        { debut: minDate, fin: maxDate },
    totalHeures:    round2(totalHours),
    heuresNormales: round2(normalHours),
    heuresSup1:     round2(ot1Hours),
    heuresSup2:     round2(ot2Hours),
    heuresNuit:     round2(nightHours),
    heuresDimanche: round2(sundayHours),
    heuresFeries:   round2(holidayHours),
    tauxNormal:     rate,
    brut: {
      heuresNormales: round2(normalPay),
      heuresSup1:     round2(ot1Pay),
      heuresSup2:     round2(ot2Pay),
      primeNuit:      round2(nightPay),
      primeDimanche:  round2(sundayPay),
      primeFerie:     round2(holidayPay),
      total:          round2(totalBrut)
    }
  };
}

/* ============================================================
   RENDU HTML
   ============================================================ */

/**
 * Affiche le récapitulatif du salaire dans le DOM.
 * @param {SalarySummary} summary
 * @param {object} config
 */
function renderSalarySummary(summary, config) {
  const container = document.getElementById('salaryResultContent');
  const periodTag = document.getElementById('salaryPeriodTag');

  if (!container) return;

  if (!summary || summary.totalHeures === 0) {
    container.innerHTML = `<div class="empty-state"><p>Aucune activité rémunérée trouvée sur la période.</p></div>`;
    return;
  }

  if (periodTag) {
    const debut = formatDate(summary.periode.debut, false);
    const fin   = formatDate(summary.periode.fin, false);
    periodTag.textContent = `${debut} → ${fin}`;
  }

  const eur = n => `${n.toFixed(2)} €`;
  const hrs = n => `${n.toFixed(2)} h`;

  container.innerHTML = `
    <div class="salary-section-title">Heures travaillées</div>
    <div class="salary-row"><span class="label">Total heures rémunérées</span><span class="value">${hrs(summary.totalHeures)}</span></div>
    <div class="salary-row"><span class="label">Heures normales (≤ ${config.ot1Threshold || 151.67}h)</span><span class="value">${hrs(summary.heuresNormales)}</span></div>
    <div class="salary-row"><span class="label">Heures sup. (+${config.ot1Percent || 25}%)</span><span class="value">${hrs(summary.heuresSup1)}</span></div>
    <div class="salary-row"><span class="label">Heures sup. (+${config.ot2Percent || 50}%)</span><span class="value">${hrs(summary.heuresSup2)}</span></div>
    <div class="salary-row"><span class="label">Heures de nuit</span><span class="value">${hrs(summary.heuresNuit)}</span></div>
    <div class="salary-row"><span class="label">Heures dimanche</span><span class="value">${hrs(summary.heuresDimanche)}</span></div>
    <div class="salary-row"><span class="label">Heures jours fériés</span><span class="value">${hrs(summary.heuresFeries)}</span></div>

    <div class="salary-section-title" style="margin-top:1.2rem">Rémunération</div>
    <div class="salary-row"><span class="label">Heures normales (${eur(summary.tauxNormal)}/h)</span><span class="value">${eur(summary.brut.heuresNormales)}</span></div>
    <div class="salary-row"><span class="label">Heures sup. 1 (taux +${config.ot1Percent || 25}%)</span><span class="value">${eur(summary.brut.heuresSup1)}</span></div>
    <div class="salary-row"><span class="label">Heures sup. 2 (taux +${config.ot2Percent || 50}%)</span><span class="value">${eur(summary.brut.heuresSup2)}</span></div>
    <div class="salary-row"><span class="label">Prime de nuit (+${config.nightBonus || 2.50} €/h)</span><span class="value">${eur(summary.brut.primeNuit)}</span></div>
    <div class="salary-row"><span class="label">Prime dimanche (+${config.sundayBonus || 3.00} €/h)</span><span class="value">${eur(summary.brut.primeDimanche)}</span></div>
    <div class="salary-row"><span class="label">Prime jours fériés (+${config.holidayBonus || 5.00} €/h)</span><span class="value">${eur(summary.brut.primeFerie)}</span></div>
    <div class="salary-row" style="margin-top:.5rem;padding-top:.8rem;border-top:2px solid var(--border)">
      <span class="label" style="font-weight:700;font-size:.9rem">TOTAL BRUT ESTIMÉ</span>
      <span class="value total">${eur(summary.brut.total)}</span>
    </div>
    <p style="font-size:.68rem;color:var(--text-muted);margin-top:.75rem;line-height:1.5">
      * Estimation indicative. Ne tient pas compte des cotisations sociales, avantages en nature, 
      primes conventionnelles, ou spécificités de la convention collective applicable.
    </p>
  `;
}

/* ============================================================
   UTILITAIRES
   ============================================================ */

/**
 * Découpe une période en segments par heure (pour classifier nuit/dimanche).
 * @param {Date} start
 * @param {Date} end
 * @returns {Array<{start: Date, end: Date}>}
 */
function splitByHour(start, end) {
  const segs = [];
  let cur = new Date(start);

  while (cur < end) {
    const next = new Date(cur);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);

    segs.push({
      start: new Date(cur),
      end:   next < end ? new Date(next) : new Date(end)
    });
    cur = next;
  }
  return segs;
}

/**
 * Détermine si une heure de début de tranche est "de nuit".
 * @param {Date} date
 * @param {number} nightStartH - ex: 21
 * @param {number} nightEndH   - ex: 6
 * @returns {boolean}
 */
function isNightHour(date, nightStartH, nightEndH) {
  const h = date.getHours();
  if (nightStartH > nightEndH) {
    // Période qui chevauche minuit (ex: 21h–6h)
    return h >= nightStartH || h < nightEndH;
  }
  // Période dans la même journée (ex: 0h–6h)
  return h >= nightStartH && h < nightEndH;
}

/** Retourne un résumé vide (aucune activité). */
function emptySummary(config) {
  return {
    periode:        { debut: null, fin: null },
    totalHeures:    0,
    heuresNormales: 0,
    heuresSup1:     0,
    heuresSup2:     0,
    heuresNuit:     0,
    heuresDimanche: 0,
    heuresFeries:   0,
    tauxNormal:     parseFloat(config.rate) || 13.50,
    brut: {
      heuresNormales: 0, heuresSup1: 0, heuresSup2: 0,
      primeNuit: 0, primeDimanche: 0, primeFerie: 0, total: 0
    }
  };
}

/** Arrondit à 2 décimales. */
function round2(n) { return Math.round(n * 100) / 100; }
