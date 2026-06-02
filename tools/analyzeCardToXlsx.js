#!/usr/bin/env node
// tools/analyzeCardToXlsx.js
// Lit un fichier JSON (driver+activities) et remplit le modèle Excel

const fs = require('fs');
const path = require('path');
const Excel = require('exceljs');

function toDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  return new Date(d);
}

function formatTime(dt) {
  if (!dt) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function formatMinutesToHHMM(minutes) {
  if (minutes == null) return '';
  const sign = minutes < 0 ? '-' : '';
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${sign}${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
}

function formatDateFr(dt) {
  if (!dt) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`;
}

function minutesBetween(a, b) {
  return Math.round((b - a) / 60000);
}

function overlapMinutes(a1, a2, b1, b2) {
  const s = Math.max(a1, b1);
  const e = Math.min(a2, b2);
  return Math.max(0, Math.round((e - s) / 60000));
}

function colLetter(col) {
  let c = col;
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

async function analyzeAndFill({ inputJson, templateXlsx, outXlsx }) {
  if (!fs.existsSync(inputJson)) throw new Error(`Fichier JSON introuvable: ${inputJson}`);
  if (!fs.existsSync(templateXlsx)) throw new Error(`Modèle Excel introuvable: ${templateXlsx}`);

  const raw = JSON.parse(fs.readFileSync(inputJson, 'utf8'));
  let activities = [];
  let driver = null;
  if (Array.isArray(raw)) {
    activities = raw;
  } else if (raw.activities) {
    activities = raw.activities;
    driver = raw.driver || null;
  } else if (raw.data && Array.isArray(raw.data.activities)) {
    activities = raw.data.activities;
    driver = raw.data.driver || null;
  } else {
    throw new Error('Format JSON inconnu — attendu Array ou {driver, activities}');
  }

  // Normaliser les dates
  activities = activities.map(a => ({
    ...a,
    start: toDate(a.start),
    end:   toDate(a.end)
  })).filter(a => a.start && a.end);

  // Grouper par jour (date locale)
  const days = new Map();
  for (const a of activities) {
    const d = new Date(a.start);
    d.setHours(0,0,0,0);
    const key = d.toISOString().slice(0,10);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(a);
  }

  // Pour chaque jour, déterminer prise de poste, pause midi (11:30-14:00 >=45min), fin de poste
  const resultRows = [];
  for (const [dayKey, acts] of Array.from(days.entries()).sort()) {
    // Skip weekends
    const dayDate = new Date(dayKey + 'T00:00:00');
    const dow = dayDate.getDay();
    if (dow === 0 || dow === 6) {
      // ne pas noter les week-ends
      continue;
    }
    // trier
    acts.sort((x,y) => x.start - y.start);
    const windowStart = new Date(dayDate); windowStart.setHours(11,30,0,0);
    const windowEnd   = new Date(dayDate); windowEnd.setHours(14,0,0,0);

    // Prise de poste : premier start d'une activity non-rest
    const firstNonRest = acts.find(a => (a.type || '').toLowerCase() !== 'rest');
    const prise = firstNonRest ? firstNonRest.start : acts[0].start;

    // Fin de poste : dernier end d'activité non-rest; sinon dernier end
    const rev = [...acts].reverse();
    const lastNonRest = rev.find(a => (a.type || '').toLowerCase() !== 'rest');
    const finPoste = lastNonRest ? lastNonRest.end : acts[acts.length-1].end;

    // Pause midi : rechercher une activité de type 'rest' qui intersecte 11:30-14:00
    const restActs = acts.filter(a => (a.type || '').toLowerCase() === 'rest');
    let pause = null;
    for (const r of restActs) {
      const totalRestMin = minutesBetween(r.start, r.end);
      const overlapMin = overlapMinutes(r.start, r.end, windowStart, windowEnd);
      // Critère : durée totale >=45 AND intersects window (we accept overlap)
      if (totalRestMin >= 45 && overlapMin > 0) {
        pause = { start: r.start, end: r.end, durationMin: totalRestMin };
        break;
      }
    }

    resultRows.push({
      date: dayDate,
      prise,
      pauseStart: pause ? pause.start : null,
      pauseEnd:   pause ? pause.end : null,
      finPoste,
      driverId: (driver && driver.id) || (acts[0] && acts[0].driverId) || ''
    });
  }

  // Calculs complémentaires: matin/apres-midi/total/quota/heures sup
  function isEvenWeekWednesday(date) {
    const d = new Date(date);
    if (d.getDay() !== 3) return false;
    // calculer numéro de semaine (ISO-like Monday start)
    const monday = new Date(d);
    monday.setDate(d.getDate() - (d.getDay() === 0 ? 6 : d.getDay() - 1));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNumber = Math.ceil(((monday - yearStart) / (7 * 24 * 3600000)) + 1);
    return weekNumber % 2 === 0;
  }

  const enhancedRows = resultRows.map(r => {
    // activities for the day
    const acts = days.get(r.date.toISOString().slice(0,10)) || [];
    // recompute window for this day
    const windowStart = new Date(r.date); windowStart.setHours(11,30,0,0);
    const windowEnd = new Date(r.date); windowEnd.setHours(14,0,0,0);
    // find pause again
    const pauseAct = acts.filter(a => (a.type || '').toLowerCase() === 'rest').find(a => Math.round((a.end - a.start)/60000) >= 45 && overlapMinutes(a.start, a.end, windowStart, windowEnd) > 0);

    // helper overlap
    const dayStart = new Date(r.date);
    dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(r.date);
    dayEnd.setHours(23,59,59,999);

    let morningMin = 0;
    let afternoonMin = 0;

    if (pauseAct) {
      const pStart = pauseAct.start;
      const pEnd = pauseAct.end;
      for (const a of acts) {
        if ((a.type || '').toLowerCase() === 'rest') continue;
        morningMin += overlapMinutes(a.start, a.end, dayStart, pStart);
        afternoonMin += overlapMinutes(a.start, a.end, pEnd, dayEnd);
      }
    } else {
      // première reprise après la fenêtre midi (première activité non-rest commençant >= windowStart)
      const reprise = acts.find(a => (a.type || '').toLowerCase() !== 'rest' && a.start >= windowStart);
      let split;
      if (reprise) {
        split = reprise.start;
      } else {
        // fallback split at 12:45
        split = new Date(r.date); split.setHours(12,45,0,0);
      }
      for (const a of acts) {
        if ((a.type || '').toLowerCase() === 'rest') continue;
        morningMin += overlapMinutes(a.start, a.end, dayStart, split);
        afternoonMin += overlapMinutes(a.start, a.end, split, dayEnd);
      }
    }

    const totalMin = morningMin + afternoonMin;
    const totalHours = +(totalMin/60).toFixed(2);
    const morningHours = +(morningMin/60).toFixed(2);
    const afternoonHours = +(afternoonMin/60).toFixed(2);
    const overtime = Math.max(0, +((totalMin/60) - 7).toFixed(2));
    const morningStr = formatMinutesToHHMM(morningMin);
    const afternoonStr = formatMinutesToHHMM(afternoonMin);
    const totalStr = formatMinutesToHHMM(totalMin);
    const quota = isEvenWeekWednesday(r.date) ? -7 : 7;

    return { ...r, morningHours, afternoonHours, totalHours, overtime, quota, morningMin, afternoonMin, totalMin, morningStr, afternoonStr, totalStr };
  });

  // Charger le modèle Excel et remplir
  const wb = new Excel.Workbook();
  await wb.xlsx.readFile(templateXlsx);
  const ws = wb.worksheets[0];

  // Repérer la ligne d'en-tête (chercher des mots-clés)
  const headerCandidates = ['date','jour','prise','pause','fin','poste','service'];
  let headerRow = 1;
  let foundHeader = null;
  for (let r = 1; r <= 8; r++) {
    const row = ws.getRow(r);
    const texts = row.values.map(v => (v || '').toString().toLowerCase());
    if (texts.some(t => headerCandidates.some(h => t.includes(h)))) {
      headerRow = r;
      foundHeader = texts;
      break;
    }
  }

  // Construire un mapping colonne -> field en essayant d'associer par mot clé
  const colMap = {}; // field -> colNumber
  const headerTexts = ws.getRow(headerRow).values.map(v => (v||'').toString());

  function findColByKeywords(keywords) {
    const low = headerTexts.map(h => h.toLowerCase());
    for (let i = 0; i < low.length; i++) {
      if (!low[i]) continue;
      for (const kw of keywords) {
        if (low[i].includes(kw)) return i; // index in values array
      }
    }
    return -1;
  }

  // Targets: date, prise de poste, debut pause, fin pause, fin de poste
  const tryFind = (field, keywords) => {
    const idx = findColByKeywords(keywords);
    if (idx >= 0) colMap[field] = idx;
  };

  tryFind('date', ['date','jour']);
  tryFind('prise', ['prise','début de poste','heure de prise','prise de poste']);
  tryFind('pauseStart', ['pause','début pause','début de pause','pause midi','pause_début']);
  tryFind('pauseEnd', ['fin pause','fin de pause','pause fin','pause_fin']);
  tryFind('finPoste', ['fin','fin de poste','fin de service','fin_poste']);
  tryFind('morning', ['matin','heures matin','morning']);
  tryFind('afternoon', ['après-midi','apres-midi','apres midi','after','afternoon']);
  tryFind('total', ['total','total heures','heures total']);
  tryFind('quota', ['quota','rtt','quota du jour']);
  tryFind('overtime', ['heures sup','overtime','heures supplémentaires','heures supérieures']);

  // Si colonnes non trouvées, ajouter après la dernière colonne
  const lastCol = ws.columnCount + 1;
  const ensureCol = (field, defaultHeader) => {
    if (colMap[field] == null) {
      const c = ws.columnCount + 1;
      ws.getRow(headerRow).getCell(c).value = defaultHeader;
      colMap[field] = c;
    }
  };

  ensureCol('date', 'Date');
  ensureCol('prise', 'Prise de poste');
  ensureCol('pauseStart', 'Début pause midi');
  ensureCol('pauseEnd', 'Fin pause midi');
  ensureCol('finPoste', 'Fin de poste');
  ensureCol('morning', 'Heures matin');
  ensureCol('afternoon', 'Heures après-midi');
  ensureCol('total', 'Total heures');
  ensureCol('quota', 'Quota du jour');
  ensureCol('overtime', 'Heures sup');

  // Déterminer à quelle ligne commencer l'écriture (juste après headerRow)
  let writeRow = headerRow + 1;
  // Option: trouver la première ligne vide après header
  while (ws.getRow(writeRow).values.some(v => v !== undefined && v !== null && v !== '')) {
    writeRow++;
  }

  for (const r of enhancedRows) {
    const row = ws.getRow(writeRow);
    row.getCell(colMap['date']).value = formatDateFr(r.date);
    row.getCell(colMap['prise']).value = r.prise ? formatTime(r.prise) : '';
    row.getCell(colMap['pauseStart']).value = r.pauseStart ? formatTime(r.pauseStart) : '—';
    row.getCell(colMap['pauseEnd']).value = r.pauseEnd ? formatTime(r.pauseEnd) : '—';
    row.getCell(colMap['finPoste']).value = r.finPoste ? formatTime(r.finPoste) : '';
    // Écrire valeurs temps numériques pour permettre formules (Excel fraction of day)
    const morningCell = row.getCell(colMap['morning']);
    const afternoonCell = row.getCell(colMap['afternoon']);
    const totalCell = row.getCell(colMap['total']);
    morningCell.value = r.morningMin / (24 * 60);
    morningCell.numFmt = 'hh:mm';
    afternoonCell.value = r.afternoonMin / (24 * 60);
    afternoonCell.numFmt = 'hh:mm';
    // total as formula = morning + afternoon
    const morningColLetter = colLetter(colMap['morning']);
    const afternoonColLetter = colLetter(colMap['afternoon']);
    const totalColLetter = colLetter(colMap['total']);
    const quotaColLetter = colLetter(colMap['quota']);
    const overtimeColLetter = colLetter(colMap['overtime']);
    // set formula for total (sum of two time cells)
    totalCell.value = { formula: `=${morningColLetter}${writeRow}+${afternoonColLetter}${writeRow}`, result: r.totalMin / (24*60) };
    totalCell.numFmt = '[h]:mm';
    // Quota and overtime
    row.getCell(colMap['quota']).value = r.quota;
    // Overtime formula: MAX(0, Total*24 - 7)
    const overtimeCell = row.getCell(colMap['overtime']);
    overtimeCell.value = { formula: `=MAX(0,(${totalColLetter}${writeRow}*24)-7)`, result: r.overtime };
    row.commit();
    writeRow++;
  }

  // Mise en forme générale : en-tête, colonnes, bordures, zebra et highlight overtime
  const dataStart = headerRow + 1;
  const dataEnd = writeRow - 1;

  // Header styling
  const header = ws.getRow(headerRow);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F75B5' } };
  header.height = 18;

  // Column widths (approx)
  const widths = [12, 18, 15, 15, 15, 14, 16, 14, 12, 12];
  ws.columns.forEach((col, idx) => {
    col.width = widths[idx] || 15;
  });

  // Borders and zebra + overtime highlight
  for (let r = dataStart; r <= dataEnd; r++) {
    const row = ws.getRow(r);
    // zebra
    if (r % 2 === 0) {
      row.eachCell(cell => {
        if (!cell.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F7' } };
      });
    }

    // apply borders
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    // highlight overtime
    const otCell = row.getCell(colMap['overtime']);
    let otValue = otCell && otCell.result !== undefined ? otCell.result : (typeof otCell.value === 'number' ? otCell.value : (otCell.value && otCell.value.result ? otCell.value.result : null));
    if (otValue == null) {
      // try reading enhancedRows
      const rowDate = ws.getRow(r).getCell(colMap['date']).value;
      const enh = enhancedRows.find(er => formatDateFr(er.date) === rowDate);
      otValue = enh ? enh.overtime : 0;
    }
    if (otValue > 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE6E6' } };
      });
    }
  }

  await wb.xlsx.writeFile(outXlsx);
  // Écrire aussi un JSON et un CSV des résultats
  try {
    const outJson = outXlsx.replace(/\.xlsx$/i, '.json');
    const outCsv = outXlsx.replace(/\.xlsx$/i, '.csv');
    fs.writeFileSync(outJson, JSON.stringify(enhancedRows, null, 2), 'utf8');

    // CSV header
    const headers = ['Date', 'Prise de poste', 'Début pause midi', 'Fin pause midi', 'Fin de poste', 'Heures matin', 'Heures après-midi', 'Total heures', 'Quota du jour', 'Heures sup', 'DriverId'];
    const lines = [headers.join(';')];
    for (const r of resultRows) {
      const enh = enhancedRows.find(er => er.date.toISOString().slice(0,10) === r.date.toISOString().slice(0,10));
        const row = [
          formatDateFr(r.date),
          r.prise ? formatTime(r.prise) : '',
          r.pauseStart ? formatTime(r.pauseStart) : '',
          r.pauseEnd ? formatTime(r.pauseEnd) : '',
          r.finPoste ? formatTime(r.finPoste) : '',
          enh ? enh.morningStr : '',
          enh ? enh.afternoonStr : '',
          enh ? enh.totalStr : '',
          enh ? enh.quota : '',
          enh ? enh.overtime : '',
          r.driverId || ''
        ];
      lines.push(row.join(';'));
    }
    fs.writeFileSync(outCsv, lines.join('\n'), 'utf8');

    return { rows: resultRows.length, outXlsx, outJson, outCsv };
  } catch (e) {
    return { rows: resultRows.length, outXlsx };
  }
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const inputJson = argv[0] || path.join(process.cwd(), 'card_data.json');
  const template = argv[1] || path.join(process.cwd(), 'Suivi_Heures_2026_Final.xlsx');
  const out = argv[2] || path.join(process.cwd(), 'Suivi_Heures_2026_Output.xlsx');

  analyzeAndFill({ inputJson, templateXlsx: template, outXlsx: out })
    .then(res => {
      console.log(`OK: ${res.rows} lignes écrites dans ${res.outXlsx}`);
    })
    .catch(err => {
      console.error('Erreur:', err.message);
      process.exit(1);
    });
}

module.exports = { analyzeAndFill };