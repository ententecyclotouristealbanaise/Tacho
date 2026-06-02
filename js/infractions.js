/**
 * infractions.js — Détection automatique des infractions
 * TachoReader
 *
 * Implémente les règles de base du règlement CE 561/2006 :
 *  - Article 6  : Durées de conduite journalières
 *  - Article 7  : Pauses obligatoires
 *  - Article 8  : Repos journalier
 *  - Article 8  : Repos hebdomadaire
 *
 * Architecture extensible : chaque règle est une fonction indépendante
 * retournant un tableau d'Infraction[]. Ajouter une règle = ajouter
 * une fonction et l'inscrire dans RULES_REGISTRY.
 */

'use strict';

/* ============================================================
   REGISTRE DES RÈGLES
   Chaque règle est { id, label, fn(activities, settings) → Infraction[] }
   Ajouter ici pour étendre la détection sans toucher au reste.
   ============================================================ */
const RULES_REGISTRY = [
  {
    id:    'DAILY_DRIVE_MAX',
    label: 'Durée max. conduite journalière',
    fn:    checkDailyDriveMax
  },
  {
    id:    'BREAK_AFTER_4H30',
    label: 'Pause obligatoire après 4h30 de conduite',
    fn:    checkMandatoryBreak
  },
  {
    id:    'DAILY_REST_MIN',
    label: 'Repos journalier insuffisant',
    fn:    checkDailyRest
  },
  {
    id:    'WEEKLY_REST_MIN',
    label: 'Repos hebdomadaire insuffisant',
    fn:    checkWeeklyRest
  },
  {
    id:    'WEEKLY_DRIVE_MAX',
    label: 'Durée max. conduite hebdomadaire',
    fn:    checkWeeklyDriveMax
  },
  // ── Point d'extension : ajouter de nouvelles règles ici ──
  // {
  //   id:    'FORTNIGHTLY_DRIVE_MAX',
  //   label: 'Conduite max. sur 2 semaines',
  //   fn:    checkFortnightlyDriveMax
  // },
];

/* ============================================================
   FONCTION PRINCIPALE
   ============================================================ */

/**
 * Analyse les activités et retourne toutes les infractions détectées.
 * @param {Activity[]} activities - triées chronologiquement
 * @param {object} settings - paramètres issus de getSettings()
 * @returns {Infraction[]}
 */
function detectInfractions(activities, settings) {
  if (!activities || activities.length === 0) return [];

  // S'assurer que les dates sont des objets Date
  const acts = activities.map(a => ({
    ...a,
    start: new Date(a.start),
    end:   new Date(a.end)
  })).sort((a, b) => a.start - b.start);

  const infractions = [];

  // Exécuter chaque règle enregistrée
  for (const rule of RULES_REGISTRY) {
    try {
      const found = rule.fn(acts, settings);
      infractions.push(...found);
    } catch (err) {
      console.error(`[Infractions] Erreur règle ${rule.id}:`, err);
    }
  }

  // Trier par date décroissante puis gravité
  infractions.sort((a, b) => {
    const sevOrder = { high: 0, medium: 1, low: 2 };
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    if (dateA.toDateString() !== dateB.toDateString()) return dateB - dateA;
    return (sevOrder[a.gravite] || 2) - (sevOrder[b.gravite] || 2);
  });

  return infractions;
}

/* ============================================================
   RÈGLE 1 — Article 6 CE 561/2006
   Durée de conduite journalière maximale
   Limite normale : 9h | Extension autorisée : 10h (max 2×/semaine)
   ============================================================ */

/**
 * Vérifie que la conduite journalière ne dépasse pas 9h (ou 10h en ext.).
 * @param {Activity[]} acts
 * @param {object} settings
 * @returns {Infraction[]}
 */
function checkDailyDriveMax(acts, settings) {
  const infractions = [];
  const maxNormal   = (settings.maxDailyDrive || 9) * 60;      // en minutes
  const maxExtended = maxNormal + 60;                           // +1h (10h max)

  const byDay = groupByCalendarDay(acts);

  for (const [dayKey, dayActs] of Object.entries(byDay)) {
    const driveMin = sumDuration(dayActs, 'driving');

    if (driveMin > maxExtended) {
      infractions.push(mkInfraction({
        date:        dayKey,
        type:        'DAILY_DRIVE_MAX',
        gravite:     'high',
        description: `Conduite journalière de ${fmt(driveMin)} dépassant la limite étendue de ${fmt(maxExtended)} (art. 6§1 CE 561/2006).`,
        detail:      { conduite: driveMin, limiteNormale: maxNormal, limiteEtendue: maxExtended },
        reference:   'Art. 6 §1 CE 561/2006'
      }));
    } else if (driveMin > maxNormal) {
      infractions.push(mkInfraction({
        date:        dayKey,
        type:        'DAILY_DRIVE_EXT',
        gravite:     'low',
        description: `Conduite journalière de ${fmt(driveMin)} dépassant la limite normale de ${fmt(maxNormal)} (extension utilisée).`,
        detail:      { conduite: driveMin, limiteNormale: maxNormal },
        reference:   'Art. 6 §1 CE 561/2006'
      }));
    }
  }

  return infractions;
}

/* ============================================================
   RÈGLE 2 — Article 7 CE 561/2006
   Pause obligatoire de 45 min (ou 2×15+30) après 4h30 de conduite
   ============================================================ */

/**
 * Vérifie les pauses obligatoires après accumulation de conduite.
 * La pause peut être fractionnée : 15 min + 30 min.
 * @param {Activity[]} acts
 * @param {object} settings
 * @returns {Infraction[]}
 */
function checkMandatoryBreak(acts, settings) {
  const infractions    = [];
  const maxDriveNoBreak = (settings.breakAfter || 4.5) * 60;     // 270 min par défaut
  const minBreak        = settings.minBreakDuration || 45;        // min obligatoire

  // Algorithme : parcourir les activités en accumulant la conduite.
  // Une "interruption" (repos ou dispo ≥ 15 min) réinitialise ou réduit le compteur.
  let accumulatedDrive = 0;   // minutes de conduite depuis la dernière pause valide
  let partialBreak     = 0;   // minutes de pause partielle (≥15 min) déjà prises
  let lastBreakIdx     = -1;

  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    const durMin = getActDuration(act);

    if (act.type === 'driving') {
      accumulatedDrive += durMin;

      // Vérification : dépasse la limite sans pause suffisante ?
      if (accumulatedDrive > maxDriveNoBreak) {
        infractions.push(mkInfraction({
          date:        act.start,
          type:        'BREAK_MISSING',
          gravite:     'high',
          description: `${fmt(accumulatedDrive)} de conduite accumulée sans pause réglementaire de ${minBreak} min (art. 7 CE 561/2006).`,
          detail:      { accumulee: accumulatedDrive, limite: maxDriveNoBreak, pausePartielle: partialBreak },
          reference:   'Art. 7 CE 561/2006'
        }));
        // Éviter de générer plusieurs infractions consécutives pour le même bloc
        accumulatedDrive = 0;
        partialBreak     = 0;
      }

    } else if (act.type === 'rest' || act.type === 'availability') {
      // Pause d'au moins 15 min interrompt l'accumulation (fractionnement 15+30)
      if (durMin >= 15 && durMin < minBreak) {
        // Première fraction (≥15 min)
        if (partialBreak === 0) {
          partialBreak = durMin;
        } else {
          // Deuxième fraction : si total ≥ 45 min → pause valide
          partialBreak += durMin;
          if (partialBreak >= minBreak) {
            accumulatedDrive = 0;
            partialBreak     = 0;
          }
        }
      } else if (durMin >= minBreak) {
        // Pause complète de 45 min → reset
        accumulatedDrive = 0;
        partialBreak     = 0;
        lastBreakIdx     = i;
      }
      // Pause < 15 min : ignorée (ne compte pas)
    }
  }

  return infractions;
}

/* ============================================================
   RÈGLE 3 — Article 8 CE 561/2006
   Repos journalier minimum (11h normales, 9h réduites max 3×/semaine)
   ============================================================ */

/**
 * Vérifie que le repos entre deux journées de travail est suffisant.
 * @param {Activity[]} acts
 * @param {object} settings
 * @returns {Infraction[]}
 */
function checkDailyRest(acts, settings) {
  const infractions = [];
  const minNormal   = (settings.minDailyRest || 11) * 60;  // 660 min
  const minReduced  = 9 * 60;                               // 540 min (repos réduit)

  // Regrouper les activités par "journée de travail" :
  // une journée se termine quand une période de repos commence.
  // Chercher les blocs de repos successifs et mesurer leur durée.
  const restBlocks = getRestBlocks(acts);

  for (const block of restBlocks) {
    const durMin = getActDuration(block);

    if (durMin < minReduced) {
      infractions.push(mkInfraction({
        date:        block.start,
        type:        'DAILY_REST_INSUFFICIENT',
        gravite:     'high',
        description: `Repos journalier de ${fmt(durMin)} inférieur à la limite réduite de ${fmt(minReduced)} (art. 8 CE 561/2006).`,
        detail:      { repos: durMin, limiteNormale: minNormal, limiteReduite: minReduced },
        reference:   'Art. 8 §1 CE 561/2006'
      }));
    } else if (durMin < minNormal) {
      // Repos réduit (9h à 11h) — autorisé mais compté
      infractions.push(mkInfraction({
        date:        block.start,
        type:        'DAILY_REST_REDUCED',
        gravite:     'low',
        description: `Repos journalier réduit à ${fmt(durMin)} (min. 11h normales, 9h réduites autorisées max 3×/semaine, art. 8 CE 561/2006).`,
        detail:      { repos: durMin, limiteNormale: minNormal },
        reference:   'Art. 8 §2 CE 561/2006'
      }));
    }
  }

  return infractions;
}

/* ============================================================
   RÈGLE 4 — Article 8 §6 CE 561/2006
   Repos hebdomadaire minimum (45h normales, 24h réduites)
   ============================================================ */

/**
 * Vérifie que le repos hebdomadaire est suffisant.
 * @param {Activity[]} acts
 * @param {object} settings
 * @returns {Infraction[]}
 */
function checkWeeklyRest(acts, settings) {
  const infractions    = [];
  const minWeeklyNormal  = (settings.minWeeklyRest || 45) * 60;   // 2700 min
  const minWeeklyReduced = 24 * 60;                                // 1440 min

  // Regrouper par semaine ISO
  const byWeek = groupByWeek(acts);

  for (const [weekKey, weekActs] of Object.entries(byWeek)) {
    // Trouver la plus longue période de repos continue dans la semaine
    const restBlocks = getRestBlocks(weekActs);
    const maxRestMin = restBlocks.reduce((max, b) => Math.max(max, getActDuration(b)), 0);

    if (maxRestMin < minWeeklyReduced) {
      infractions.push(mkInfraction({
        date:        weekActs[0].start,
        type:        'WEEKLY_REST_MISSING',
        gravite:     'high',
        description: `Repos hebdomadaire de ${fmt(maxRestMin)} insuffisant (min. ${fmt(minWeeklyReduced)} requis, semaine ${weekKey}).`,
        detail:      { maxRepos: maxRestMin, limiteNormale: minWeeklyNormal, limiteReduite: minWeeklyReduced },
        reference:   'Art. 8 §6 CE 561/2006'
      }));
    } else if (maxRestMin < minWeeklyNormal) {
      infractions.push(mkInfraction({
        date:        weekActs[0].start,
        type:        'WEEKLY_REST_REDUCED',
        gravite:     'medium',
        description: `Repos hebdomadaire réduit à ${fmt(maxRestMin)} (45h normales requises, semaine ${weekKey}).`,
        detail:      { maxRepos: maxRestMin, limiteNormale: minWeeklyNormal },
        reference:   'Art. 8 §6 CE 561/2006'
      }));
    }
  }

  return infractions;
}

/* ============================================================
   RÈGLE 5 — Article 6 §2 CE 561/2006
   Conduite hebdomadaire maximale (56h/semaine)
   ============================================================ */

/**
 * Vérifie que la conduite hebdomadaire ne dépasse pas 56h.
 * @param {Activity[]} acts
 * @param {object} settings
 * @returns {Infraction[]}
 */
function checkWeeklyDriveMax(acts, settings) {
  const infractions  = [];
  const maxWeekly    = (settings.maxWeeklyDrive || 56) * 60;  // minutes

  const byWeek = groupByWeek(acts);

  for (const [weekKey, weekActs] of Object.entries(byWeek)) {
    const driveMin = sumDuration(weekActs, 'driving');
    if (driveMin > maxWeekly) {
      infractions.push(mkInfraction({
        date:        weekActs[0].start,
        type:        'WEEKLY_DRIVE_MAX',
        gravite:     'high',
        description: `Conduite hebdomadaire de ${fmt(driveMin)} dépassant la limite de ${fmt(maxWeekly)} (semaine ${weekKey}).`,
        detail:      { conduite: driveMin, limite: maxWeekly },
        reference:   'Art. 6 §2 CE 561/2006'
      }));
    }
  }

  return infractions;
}

/* ============================================================
   RENDU DES INFRACTIONS
   ============================================================ */

/**
 * Génère et insère le tableau HTML des infractions dans le DOM.
 * @param {Infraction[]} infractions
 */
function renderInfractions(infractions) {
  const container  = document.getElementById('infractionsTableContainer');
  const highCount  = document.getElementById('infHighCount');
  const medCount   = document.getElementById('infMedCount');
  const lowCount   = document.getElementById('infLowCount');
  const badge      = document.getElementById('infractionBadge');

  if (!container) return;

  // Compteurs par gravité
  const counts = { high: 0, medium: 0, low: 0 };
  infractions.forEach(inf => { if (counts[inf.gravite] !== undefined) counts[inf.gravite]++; });

  if (highCount) highCount.textContent = counts.high;
  if (medCount)  medCount.textContent  = counts.medium;
  if (lowCount)  lowCount.textContent  = counts.low;

  const total = infractions.length;
  if (badge) {
    badge.textContent   = total > 0 ? total : '';
    badge.style.display = total > 0 ? 'inline' : 'none';
  }

  // Tableau vide
  if (total === 0) {
    container.innerHTML = `
      <div class="empty-state large">
        <svg viewBox="0 0 64 64" fill="none" width="56">
          <circle cx="32" cy="32" r="26" stroke="currentColor" stroke-width="2"/>
          <path d="M21 32l7 7 15-15" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <p>Aucune infraction détectée sur la période analysée ✓</p>
      </div>`;
    return;
  }

  // Construction du tableau
  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Gravité</th>
          <th>Type</th>
          <th>Description</th>
          <th>Référence</th>
        </tr>
      </thead>
      <tbody>`;

  for (const inf of infractions) {
    const dateStr = formatDate(inf.date, false);
    const sevLabel = SEVERITY_LABELS[inf.gravite] || inf.gravite;
    html += `
      <tr>
        <td class="mono">${escHtml(dateStr)}</td>
        <td><span class="severity-pill ${escHtml(inf.gravite)}">${escHtml(sevLabel)}</span></td>
        <td class="mono" style="font-size:.7rem">${escHtml(inf.type)}</td>
        <td style="max-width:380px;white-space:normal;line-height:1.4">${escHtml(inf.description)}</td>
        <td class="mono" style="font-size:.72rem;color:var(--text-muted)">${escHtml(inf.reference || '—')}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  container.innerHTML = html;

  // Mini-liste sur le dashboard
  renderInfractionsMini(infractions.slice(0, 5));
}

/**
 * Affiche les 5 premières infractions dans la zone mini du dashboard.
 * @param {Infraction[]} infractions
 */
function renderInfractionsMini(infractions) {
  const container = document.getElementById('recentInfractions');
  if (!container) return;

  if (infractions.length === 0) {
    container.innerHTML = `<div class="empty-state"><svg viewBox="0 0 48 48" fill="none" width="40"><path d="M24 6L4 42h40L24 6z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><line x1="24" y1="20" x2="24" y2="30" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="35" r="1.5" fill="currentColor"/></svg><p>Aucune infraction détectée</p></div>`;
    return;
  }

  container.innerHTML = infractions.map(inf => `
    <div class="infraction-mini-item ${escHtml(inf.gravite)}">
      <span class="infraction-mini-date">${escHtml(formatDate(inf.date, false))}</span>
      <span class="infraction-mini-desc">${escHtml(inf.description.slice(0, 90))}${inf.description.length > 90 ? '…' : ''}</span>
    </div>
  `).join('');
}

/* ============================================================
   UTILITAIRES INTERNES
   ============================================================ */

/** Crée un objet Infraction standardisé. */
function mkInfraction({ date, type, gravite, description, detail = {}, reference = '' }) {
  return {
    id:          `INF_${type}_${new Date(date).getTime()}`,
    date:        new Date(date),
    type,
    gravite,     // 'high' | 'medium' | 'low'
    description,
    detail,
    reference
  };
}

/** Durée d'une activité en minutes. */
function getActDuration(act) {
  const s = new Date(act.start);
  const e = new Date(act.end);
  return Math.max(0, Math.round((e - s) / 60000));
}

/** Somme la durée des activités d'un type donné. */
function sumDuration(acts, type) {
  return acts
    .filter(a => a.type === type)
    .reduce((sum, a) => sum + getActDuration(a), 0);
}

/**
 * Regroupe les activités par jour calendaire (YYYY-MM-DD).
 * @param {Activity[]} acts
 * @returns {Object.<string, Activity[]>}
 */
function groupByCalendarDay(acts) {
  const result = {};
  for (const act of acts) {
    const key = new Date(act.start).toISOString().slice(0, 10);
    if (!result[key]) result[key] = [];
    result[key].push(act);
  }
  return result;
}

/**
 * Regroupe les activités par semaine ISO (YYYY-Www).
 * @param {Activity[]} acts
 * @returns {Object.<string, Activity[]>}
 */
function groupByWeek(acts) {
  const result = {};
  for (const act of acts) {
    const key = getISOWeek(new Date(act.start));
    if (!result[key]) result[key] = [];
    result[key].push(act);
  }
  return result;
}

/**
 * Retourne l'identifiant semaine ISO (ex: "2025-W22").
 * @param {Date} date
 * @returns {string}
 */
function getISOWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Extrait les blocs de repos consécutifs (activités de type 'rest' contiguës).
 * Fusionne les blocs de repos séparés par < 1 min (changement d'enregistrement).
 * @param {Activity[]} acts
 * @returns {Array<{start: Date, end: Date, type: 'rest'}>}
 */
function getRestBlocks(acts) {
  const restActs = acts.filter(a => a.type === 'rest').sort((a, b) => new Date(a.start) - new Date(b.start));
  if (restActs.length === 0) return [];

  const blocks = [];
  let current = { ...restActs[0], start: new Date(restActs[0].start), end: new Date(restActs[0].end) };

  for (let i = 1; i < restActs.length; i++) {
    const act = restActs[i];
    const gap = (new Date(act.start) - current.end) / 60000;

    // Fusionner si gap < 15 min (enregistrement continu)
    if (gap < 15) {
      current.end = new Date(act.end);
    } else {
      blocks.push(current);
      current = { ...act, start: new Date(act.start), end: new Date(act.end) };
    }
  }
  blocks.push(current);
  return blocks;
}

/** Formate des minutes en "Xh YYmin" (utilise la fonction globale de data.js) */
function fmt(minutes) {
  return formatDuration(Math.round(minutes));
}

// escHtml() est définie dans main.js (chargé après), disponible globalement.
