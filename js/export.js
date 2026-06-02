/**
 * export.js — Génération des exports CSV et PDF
 * TachoReader
 */

'use strict';

/* ============================================================
   EXPORT ACTIVITÉS → CSV
   ============================================================ */

/**
 * Génère et télécharge un fichier CSV des activités.
 * @param {Activity[]} activities
 */
function exportActivitiesToCSV(activities) {
  if (!activities || activities.length === 0) {
    showNotification('warn', 'Export', 'Aucune activité à exporter.');
    return;
  }

  const headers = ['Date début', 'Date fin', 'Durée (min)', 'Type', 'Véhicule', 'Pays', 'Lieu', 'ID Conducteur'];
  const rows = activities.map(a => [
    formatDate(a.start),
    formatDate(a.end),
    getActDurationExport(a),
    ACTIVITY_LABELS[a.type] || a.type,
    a.vehicule || '',
    a.pays     || '',
    a.lieu     || '',
    a.driverId || ''
  ]);

  const csv = buildCSV(headers, rows);
  downloadCSV(csv, `activites_${csvDateStamp()}.csv`);
  showNotification('success', 'Export', `${activities.length} activités exportées.`);
}

/* ============================================================
   EXPORT INFRACTIONS → CSV
   ============================================================ */

/**
 * Génère et télécharge un fichier CSV des infractions.
 * @param {Infraction[]} infractions
 */
function exportInfractionsToCSV(infractions) {
  if (!infractions || infractions.length === 0) {
    showNotification('warn', 'Export', 'Aucune infraction à exporter.');
    return;
  }

  const headers = ['Date', 'Type', 'Gravité', 'Description', 'Référence'];
  const rows = infractions.map(inf => [
    formatDate(inf.date, false),
    inf.type,
    SEVERITY_LABELS[inf.gravite] || inf.gravite,
    inf.description,
    inf.reference || ''
  ]);

  const csv = buildCSV(headers, rows);
  downloadCSV(csv, `infractions_${csvDateStamp()}.csv`);
  showNotification('success', 'Export', `${infractions.length} infractions exportées.`);
}

/* ============================================================
   EXPORT SALAIRE → CSV
   ============================================================ */

/**
 * Génère et télécharge un fichier CSV du récapitulatif salaire.
 * @param {SalarySummary} summary
 * @param {object} config
 */
function exportSalaryToCSV(summary, config) {
  if (!summary || summary.totalHeures === 0) {
    showNotification('warn', 'Export', 'Aucun résumé salaire à exporter. Calculez d\'abord le salaire.');
    return;
  }

  const eur = n => n.toFixed(2);
  const hrs = n => n.toFixed(2);

  const rows = [
    ['Période début',           formatDate(summary.periode.debut, false)],
    ['Période fin',             formatDate(summary.periode.fin,   false)],
    [''],
    ['HEURES TRAVAILLÉES', ''],
    ['Total heures rémunérées', hrs(summary.totalHeures)],
    ['Heures normales',         hrs(summary.heuresNormales)],
    [`Heures sup. (+${config.ot1Percent}%)`, hrs(summary.heuresSup1)],
    [`Heures sup. (+${config.ot2Percent}%)`, hrs(summary.heuresSup2)],
    ['Heures de nuit',          hrs(summary.heuresNuit)],
    ['Heures dimanche',         hrs(summary.heuresDimanche)],
    ['Heures jours fériés',     hrs(summary.heuresFeries)],
    [''],
    ['RÉMUNÉRATION (€)', ''],
    [`Taux horaire (€/h)`,                        eur(summary.tauxNormal)],
    ['Heures normales',                            eur(summary.brut.heuresNormales)],
    [`Heures sup. 1 (+${config.ot1Percent}%)`,    eur(summary.brut.heuresSup1)],
    [`Heures sup. 2 (+${config.ot2Percent}%)`,    eur(summary.brut.heuresSup2)],
    [`Prime nuit (+${config.nightBonus} €/h)`,    eur(summary.brut.primeNuit)],
    [`Prime dimanche (+${config.sundayBonus} €/h)`,eur(summary.brut.primeDimanche)],
    [`Prime jours fériés (+${config.holidayBonus} €/h)`, eur(summary.brut.primeFerie)],
    [''],
    ['TOTAL BRUT ESTIMÉ (€)', eur(summary.brut.total)]
  ];

  // Pour ce CSV, on utilise un format "clé;valeur" à 2 colonnes
  const csv = rows.map(r => r.map(cell => csvEscape(String(cell))).join(';')).join('\r\n');
  const bom = '\uFEFF'; // BOM UTF-8 pour Excel
  downloadCSV(bom + csv, `salaire_${csvDateStamp()}.csv`);
  showNotification('success', 'Export', 'Récapitulatif salaire exporté.');
}

/* ============================================================
   EXPORT PDF / IMPRESSION
   ============================================================ */

/**
 * Prépare le template d'impression et déclenche window.print().
 * Le CSS @media print masque la navigation et formate la page.
 */
function printReport() {
  const driver       = getActiveDriver();
  const activities   = filterActivities({ days: getSettings().defaultPeriod });
  const infractions  = getInfractions();
  const config       = getSalaryConfig();
  const salary       = computeSalary(activities, config);

  // ── Conducteur ──
  const driverInfo = document.getElementById('printDriverInfo');
  if (driverInfo) {
    driverInfo.innerHTML = driver
      ? `<p><strong>${driver.prenom} ${driver.nom}</strong> — Carte : ${driver.numeroCarte}</p>`
      : '<p>Conducteur non spécifié</p>';
  }

  // ── Date ──
  const printDate = document.getElementById('printDate');
  if (printDate) printDate.innerHTML = `<p>Rapport généré le ${formatDate(new Date())}</p>`;

  // ── Activités ──
  const printActs = document.getElementById('printActivities');
  if (printActs && activities.length > 0) {
    let html = `<h2 style="margin:1.5rem 0 .5rem">Activités (${activities.length})</h2>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead><tr style="background:#eee">
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Date début</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Date fin</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Type</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Durée</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Véhicule</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Lieu</th>
      </tr></thead><tbody>`;
    activities.forEach(a => {
      html += `<tr>
        <td style="padding:3px 8px;border:1px solid #ddd">${formatDate(a.start)}</td>
        <td style="padding:3px 8px;border:1px solid #ddd">${formatDate(a.end)}</td>
        <td style="padding:3px 8px;border:1px solid #ddd">${ACTIVITY_LABELS[a.type] || a.type}</td>
        <td style="padding:3px 8px;border:1px solid #ddd">${formatDuration(getActDurationExport(a))}</td>
        <td style="padding:3px 8px;border:1px solid #ddd">${a.vehicule || '—'}</td>
        <td style="padding:3px 8px;border:1px solid #ddd">${a.lieu || '—'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    printActs.innerHTML = html;
  }

  // ── Infractions ──
  const printInf = document.getElementById('printInfractions');
  if (printInf) {
    if (infractions.length > 0) {
      let html = `<h2 style="margin:1.5rem 0 .5rem">Infractions détectées (${infractions.length})</h2>`;
      html += `<table style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#eee">
          <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Date</th>
          <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Gravité</th>
          <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Description</th>
          <th style="padding:4px 8px;text-align:left;border:1px solid #ccc">Référence</th>
        </tr></thead><tbody>`;
      infractions.forEach(inf => {
        html += `<tr>
          <td style="padding:3px 8px;border:1px solid #ddd">${formatDate(inf.date, false)}</td>
          <td style="padding:3px 8px;border:1px solid #ddd">${SEVERITY_LABELS[inf.gravite] || inf.gravite}</td>
          <td style="padding:3px 8px;border:1px solid #ddd;max-width:350px;white-space:normal">${inf.description}</td>
          <td style="padding:3px 8px;border:1px solid #ddd;font-size:10px">${inf.reference || '—'}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
      printInf.innerHTML = html;
    } else {
      printInf.innerHTML = '<p style="margin-top:1rem">Aucune infraction détectée.</p>';
    }
  }

  // ── Salaire ──
  const printSal = document.getElementById('printSalary');
  if (printSal && salary.totalHeures > 0) {
    printSal.innerHTML = `
      <h2 style="margin:1.5rem 0 .5rem">Récapitulatif salaire prévisionnel</h2>
      <table style="width:300px;border-collapse:collapse;font-size:11px">
        <tr><td style="padding:3px 8px;border:1px solid #ddd">Total heures</td><td style="padding:3px 8px;border:1px solid #ddd">${salary.totalHeures.toFixed(2)} h</td></tr>
        <tr><td style="padding:3px 8px;border:1px solid #ddd">Heures normales</td><td style="padding:3px 8px;border:1px solid #ddd">${salary.heuresNormales.toFixed(2)} h</td></tr>
        <tr><td style="padding:3px 8px;border:1px solid #ddd">Heures sup.</td><td style="padding:3px 8px;border:1px solid #ddd">${(salary.heuresSup1 + salary.heuresSup2).toFixed(2)} h</td></tr>
        <tr><td style="padding:3px 8px;border:1px solid #ddd">Heures de nuit</td><td style="padding:3px 8px;border:1px solid #ddd">${salary.heuresNuit.toFixed(2)} h</td></tr>
        <tr style="font-weight:bold;background:#eee">
          <td style="padding:3px 8px;border:1px solid #ccc">TOTAL BRUT ESTIMÉ</td>
          <td style="padding:3px 8px;border:1px solid #ccc">${salary.brut.total.toFixed(2)} €</td>
        </tr>
      </table>
      <p style="font-size:9px;color:#888;margin-top:.5rem">Estimation indicative. Hors cotisations sociales.</p>`;
  }

  // Lancer l'impression
  setTimeout(() => window.print(), 100);
}

/* ============================================================
   UTILITAIRES CSV
   ============================================================ */

/**
 * Construit une chaîne CSV à partir d'en-têtes et de lignes.
 * @param {string[]} headers
 * @param {Array[]}  rows
 * @returns {string}
 */
function buildCSV(headers, rows) {
  const bom  = '\uFEFF'; // BOM UTF-8 pour Excel
  const sep  = ';';
  const lines = [
    headers.map(h => csvEscape(h)).join(sep),
    ...rows.map(row => row.map(cell => csvEscape(String(cell ?? ''))).join(sep))
  ];
  return bom + lines.join('\r\n');
}

/**
 * Échappe une valeur pour CSV (guillemets si nécessaire).
 * @param {string} val
 * @returns {string}
 */
function csvEscape(val) {
  const str = String(val ?? '');
  if (str.includes(';') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Déclenche le téléchargement d'un fichier texte.
 * @param {string} content
 * @param {string} filename
 */
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Horodatage compact pour les noms de fichiers. */
function csvDateStamp() {
  const now = new Date();
  const p   = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Durée d'une activité en minutes (version export). */
function getActDurationExport(act) {
  const s = new Date(act.start);
  const e = new Date(act.end);
  return Math.max(0, Math.round((e - s) / 60000));
}

/* ============================================================
   EXPORT AMPLITUDES JOURNALIÈRES
   Extrait pour chaque jour travaillé :
     - Heure de début de service (1ère activité non-repos)
     - Heure de début de pause méridienne (1er repos ≥ MIN_LUNCH_BREAK en journée)
     - Heure de reprise après pause méridienne
     - Heure de fin de service (dernière activité non-repos)
   ============================================================ */

/** Durée minimale (min) pour qu'un repos soit considéré comme pause du midi. */
const MIN_LUNCH_BREAK = 30;

/** Plage horaire dans laquelle chercher la pause du midi (11h30–15h). */
const LUNCH_WINDOW_START = 11.5;  // 11h30
const LUNCH_WINDOW_END   = 15;    // 15h00

/**
 * Amplitude de service minimale (min) à avoir accumulée AVANT qu'un repos
 * soit reconnu comme pause du midi. Fixée à 2h (120 min) : un quart d'heure
 * tôt le matin (ex. 9h15) ne sera jamais pris comme pause méridienne car
 * l'amplitude de service qui précède est inférieure à ce seuil.
 */
const MIN_SERVICE_BEFORE_LUNCH = 120;

/**
 * Reconstitue les amplitudes journalières à partir des activités.
 *
 * Algorithme pour chaque jour :
 *  1. Début de service  = start de la 1ère activité de type conduite/travail/dispo.
 *  2. Pause du midi     = 1er bloc de repos continu ≥ minLunchBreak dont le début
 *                         tombe dans la fenêtre LUNCH_WINDOW (11h30–15h).
 *  3. Reprise           = end de ce même bloc de repos.
 *  4. Fin de service    = end de la dernière activité conduite/travail/dispo.
 *
 * @param {Activity[]} activities     - triées chronologiquement
 * @param {number}     minLunchBreak  - durée min (min) pour identifier la pause du midi (défaut 30)
 * @returns {DailyAmplitude[]}        - une entrée par jour travaillé
 */
function computeDailyAmplitudes(activities, minLunchBreak = MIN_LUNCH_BREAK) {
  if (!activities || activities.length === 0) return [];

  const pad = n => String(n).padStart(2, '0');

  /** Formate une Date en "HH:MM" ou "—" si null. */
  const hhmm = dt => dt ? `${pad(dt.getHours())}:${pad(dt.getMinutes())}` : '—';

  /** Durée entre deux Date en minutes. */
  const diffMin = (a, b) => b && a ? Math.round((b - a) / 60000) : null;

  /** Formate une durée en minutes → "Xh YYmin" ou "—". */
  const fmtDur = min => (min === null || min < 0) ? '—' : formatDuration(min);

  // Regrouper par jour calendaire (clé YYYY-MM-DD)
  const byDay = {};
  for (const act of activities) {
    const key = new Date(act.start).toISOString().slice(0, 10);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(act);
  }

  const result = [];

  for (const dayKey of Object.keys(byDay).sort()) {
    const dayActs = byDay[dayKey].map(a => ({
      ...a,
      start: new Date(a.start),
      end:   new Date(a.end)
    })).sort((a, b) => a.start - b.start);

    // Activités "actives" (tout sauf repos)
    const activeActs = dayActs.filter(a => a.type !== 'rest');

    // Jour sans activité active (journée de repos complet) → ignoré
    if (activeActs.length === 0) continue;

    // ── 1. Début de service ──
    const debutService = activeActs[0].start;

    // ── 4. Fin de service ──
    const finService = activeActs[activeActs.length - 1].end;

    // ── 2 & 3. Pause du midi ──
    // Chercher parmi les blocs de repos du jour ceux dans la fenêtre méridienne
    let debutPause  = null;
    let repriseService = null;

    const restActs = dayActs.filter(a => a.type === 'rest');

    // Fusionner les repos consécutifs (gap < 2 min = enregistrement continu)
    const mergedRests = [];
    for (const ra of restActs) {
      if (mergedRests.length === 0) {
        mergedRests.push({ start: new Date(ra.start), end: new Date(ra.end) });
      } else {
        const last = mergedRests[mergedRests.length - 1];
        const gapMin = (ra.start - last.end) / 60000;
        if (gapMin < 2) {
          last.end = new Date(ra.end); // fusionner
        } else {
          mergedRests.push({ start: new Date(ra.start), end: new Date(ra.end) });
        }
      }
    }

    for (const rest of mergedRests) {
      const durMin = (rest.end - rest.start) / 60000;
      const startH = rest.start.getHours() + rest.start.getMinutes() / 60;

      // Critère 1 : durée ≥ seuil choisi par l'utilisateur
      if (durMin < minLunchBreak) continue;

      // Critère 2 : début du repos dans la fenêtre méridienne (9h–15h)
      if (startH < LUNCH_WINDOW_START || startH >= LUNCH_WINDOW_END) continue;

      // Critère 3 : amplitude de service AVANT ce repos ≥ 2h
      // → évite qu'un quart d'heure de pause tôt le matin soit pris comme pause du midi.
      // On somme toutes les activités actives (non-repos) entre le début de service
      // et le début de ce bloc de repos.
      const serviceAvantMin = activeActs
        .filter(a => a.end <= rest.start)
        .reduce((s, a) => s + Math.round((a.end - a.start) / 60000), 0);

      if (serviceAvantMin < MIN_SERVICE_BEFORE_LUNCH) continue;

      // Les trois critères sont satisfaits → c'est la pause du midi
      debutPause     = rest.start;
      repriseService = rest.end;
      break;
    }

    // ── Calcul des amplitudes ──
    const amplitudeMatinMin   = debutPause  ? diffMin(debutService,   debutPause)     : null;
    const dureeRepasMin       = debutPause  ? diffMin(debutPause,     repriseService) : null;
    const amplitudeApremMin   = repriseService ? diffMin(repriseService, finService)  : null;
    const amplitudeTotaleMin  = diffMin(debutService, finService);

    // Calcul conduite totale du jour (pour info)
    const conduiteMin = dayActs
      .filter(a => a.type === 'driving')
      .reduce((s, a) => s + Math.round((a.end - a.start) / 60000), 0);

    // Véhicules du jour (dédoublonnés)
    const vehicules = [...new Set(dayActs.filter(a => a.vehicule).map(a => a.vehicule))].join(', ');

    result.push({
      date:            dayKey,
      dateLabel:       new Date(dayKey).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }),
      debutService:    hhmm(debutService),
      debutPause:      hhmm(debutPause),
      repriseService:  hhmm(repriseService),
      finService:      hhmm(finService),
      amplitudeMatin:  fmtDur(amplitudeMatinMin),
      dureeRepas:      fmtDur(dureeRepasMin),
      amplitudeAprem:  fmtDur(amplitudeApremMin),
      amplitudeTotale: fmtDur(amplitudeTotaleMin),
      conduite:        fmtDur(conduiteMin),
      vehicules:       vehicules || '—',
      pauseMidiOk:     debutPause !== null,   // booléen pour repérer les jours sans pause identifiée
    });
  }

  return result;
}

/**
 * Exporte les amplitudes journalières en CSV.
 * @param {Activity[]} activities
 * @param {number}     minLunchBreak - durée min (min) de la pause midi (défaut 30)
 */
function exportAmplitudesToCSV(activities, minLunchBreak = MIN_LUNCH_BREAK) {
  const amplitudes = computeDailyAmplitudes(activities, minLunchBreak);

  if (amplitudes.length === 0) {
    showNotification('warn', 'Export amplitudes', 'Aucune journée travaillée trouvée.');
    return;
  }

  const headers = [
    'Date',
    'Jour',
    'Début service',
    'Début pause midi',
    'Reprise service',
    'Fin service',
    'Amplitude matin',
    'Durée repas',
    'Amplitude après-midi',
    'Amplitude totale',
    'Conduite totale',
    'Véhicule(s)',
    'Pause midi identifiée'
  ];

  const rows = amplitudes.map(a => [
    a.date,
    a.dateLabel,
    a.debutService,
    a.debutPause,
    a.repriseService,
    a.finService,
    a.amplitudeMatin,
    a.dureeRepas,
    a.amplitudeAprem,
    a.amplitudeTotale,
    a.conduite,
    a.vehicules,
    a.pauseMidiOk ? 'Oui' : 'Non détectée'
  ]);

  const csv = buildCSV(headers, rows);
  downloadCSV(csv, `amplitudes_${csvDateStamp()}.csv`);
  showNotification('success', 'Export amplitudes', `${amplitudes.length} journées exportées.`);
}

/**
 * Exporte les amplitudes journalières en JSON.
 * @param {Activity[]} activities
 * @param {number}     minLunchBreak - durée min (min) de la pause midi (défaut 30)
 */
function exportAmplitudesToJSON(activities, minLunchBreak = MIN_LUNCH_BREAK) {
  const amplitudes = computeDailyAmplitudes(activities, minLunchBreak);

  if (amplitudes.length === 0) {
    showNotification('warn', 'Export amplitudes', 'Aucune journée travaillée trouvée.');
    return;
  }

  // JSON lisible, avec les champs principaux en premier
  const output = {
    generatedAt: new Date().toISOString(),
    totalDays:   amplitudes.length,
    amplitudes
  };

  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `amplitudes_${csvDateStamp()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification('success', 'Export amplitudes', `${amplitudes.length} journées exportées en JSON.`);
}
