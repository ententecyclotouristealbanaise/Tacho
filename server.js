const path = require('path');
const fs = require('fs');
const express = require('express');
const ExcelJS = require('exceljs');
const analyzer = require('./tools/analyzeCardToXlsx');

const app = express();
const PORT = process.env.PORT || 3000;
const FILE_NAME = path.resolve(__dirname, 'releveur.xlsx');
const HEADERS = ['Date', 'Carte chauffeur', 'Chauffeur', 'Début poste', 'Pause midi', 'Fin poste'];

app.use(express.json());
app.use(express.static(path.join(__dirname)));

async function initWorkbook() {
  const workbook = new ExcelJS.Workbook();
  if (fs.existsSync(FILE_NAME)) {
    await workbook.xlsx.readFile(FILE_NAME);
  } else {
    const sheet = workbook.addWorksheet('Relevés');
    sheet.addRow(HEADERS);
    await workbook.xlsx.writeFile(FILE_NAME);
  }
  return workbook;
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function findRow(sheet, date, carte) {
  let found = null;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const rowDate = row.getCell(1).value;
    const rowCarte = row.getCell(2).value;
    if (rowDate === date && rowCarte === carte) {
      found = row;
    }
  });
  return found;
}

app.post('/api/releve', async (req, res) => {
  const { carte, chauffeur, action } = req.body;
  if (!carte || !action) {
    return res.status(400).json({ error: 'Carte chauffeur et action obligatoires.' });
  }

  try {
    const workbook = await initWorkbook();
    const sheet = workbook.getWorksheet('Relevés');
    const today = new Date().toLocaleDateString('fr-FR');
    let row = findRow(sheet, today, carte);

    if (!row) {
      row = sheet.addRow([today, carte, chauffeur || '', '', '', '']);
    } else if (chauffeur && !row.getCell(3).value) {
      row.getCell(3).value = chauffeur;
    }

    const time = formatTime();
    if (action === 'debut') {
      row.getCell(4).value = time;
    } else if (action === 'pause') {
      row.getCell(5).value = time;
    } else if (action === 'fin') {
      row.getCell(6).value = time;
    } else {
      return res.status(400).json({ error: 'Action non reconnue.' });
    }

    await workbook.xlsx.writeFile(FILE_NAME);
    return res.json({ success: true, date: today, action, time });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Impossible de mettre à jour le fichier Excel.' });
  }
});

// === TACHYGRAPHE ===

function isEvenWeekWednesday(date) {
  const dayOfWeek = date.getDay(); // 0 = dimanche, 3 = mercredi
  if (dayOfWeek !== 3) return false; // Pas mercredi
  
  // Trouver le lundi de la semaine
  const monday = new Date(date);
  monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
  
  // Calculer le numéro de semaine
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((monday - yearStart) / (7 * 24 * 3600000));
  
  return weekNumber % 2 === 0;
}

function hoursToString(totalHours) {
  const h = Math.floor(totalHours);
  const m = Math.round((totalHours - h) * 60);
  return `${h}h${String(m).padStart(2, '0')}`;
}

function dateToString(date) {
  const d = new Date(date);
  return d.toLocaleDateString('fr-FR');
}

app.post('/api/export-tacho', async (req, res) => {
  const { keyTimes, hours, activities, extraHours, driverInfo } = req.body;

  if (!keyTimes || !hours) {
    return res.status(400).json({ error: 'Données incomplètes' });
  }

  try {
    // Créer un nouveau workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Relevé Tachygraphe');

    // En-têtes
    const headers = [
      'Date',
      'Carte',
      'Chauffeur',
      'Début poste',
      'Fin poste (midi)',
      'Reprise après-midi',
      'Fin poste (soir)',
      'Heures matin',
      'Heures après-midi',
      'Total heures',
      'Quota du jour',
      'Heures sup'
    ];
    sheet.addRow(headers);

    // Styles en-têtes
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0066CC' } };

    // Données
    const today = new Date();
    const quota = isEvenWeekWednesday(today) ? -7 : 7;
    
    const startMorningStr = keyTimes.startMorning ? timeToString(keyTimes.startMorning.getHours(), keyTimes.startMorning.getMinutes()) : '-';
    const endMorningStr = keyTimes.endMorning ? timeToString(keyTimes.endMorning.getHours(), keyTimes.endMorning.getMinutes()) : '-';
    const startAfternoonStr = keyTimes.startAfternoon ? timeToString(keyTimes.startAfternoon.getHours(), keyTimes.startAfternoon.getMinutes()) : '-';
    const endAfternoonStr = keyTimes.endAfternoon ? timeToString(keyTimes.endAfternoon.getHours(), keyTimes.endAfternoon.getMinutes()) : '-';

    const row = [
      dateToString(today),
      driverInfo?.id || '-',
      driverInfo?.name || '-',
      startMorningStr,
      endMorningStr,
      startAfternoonStr,
      endAfternoonStr,
      hoursToString(hours.morningHours),
      hoursToString(hours.afternoonHours),
      hoursToString(hours.totalHours),
      `${quota}h`,
      hoursToString(extraHours)
    ];

    sheet.addRow(row);

    // Largeur des colonnes
    sheet.columns.forEach((col, idx) => {
      col.width = [12, 15, 15, 15, 15, 18, 15, 15, 18, 14, 12, 12][idx] || 15;
    });

    // Formater les lignes de données
    const dataRow = sheet.getRow(2);
    dataRow.alignment = { horizontal: 'center', vertical: 'center' };

    // Fichier temporaire
    const fileName = `releve_tacho_${new Date().getTime()}.xlsx`;
    const filePath = path.join(__dirname, fileName);

    await workbook.xlsx.writeFile(filePath);

    // Envoyer le fichier
    res.download(filePath, `releve_tachygraphe_${dateToString(today)}.xlsx`, (err) => {
      // Supprimer le fichier après envoi
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      if (err) console.error('Erreur téléchargement:', err);
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Impossible de générer le fichier Excel.' });
  }
});

// Endpoint pour analyser un JSON de carte et générer le Suivi Excel
app.post('/api/analyze-card', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) return res.status(400).json({ error: 'Données manquantes' });

    const tmpJson = path.join(__dirname, `card_input_${Date.now()}.json`);
    const outXlsx = path.join(__dirname, `Suivi_Heures_${Date.now()}_generated.xlsx`);

    fs.writeFileSync(tmpJson, JSON.stringify(payload, null, 2), 'utf8');

    const resFiles = await analyzer.analyzeAndFill({ inputJson: tmpJson, templateXlsx: path.join(__dirname, 'Suivi_Heures_2026_Final.xlsx'), outXlsx });

    // Choisir le format demandé
    const fmt = req.query.format || 'xlsx';
    let fileToSend = resFiles.outXlsx;
    if (fmt === 'csv' && resFiles.outCsv) fileToSend = resFiles.outCsv;
    if (fmt === 'json' && resFiles.outJson) fileToSend = resFiles.outJson;

    // Envoyer le fichier généré
    res.download(fileToSend, path.basename(fileToSend), (err) => {
      // cleanup
      if (fs.existsSync(tmpJson)) fs.unlinkSync(tmpJson);
      if (fs.existsSync(resFiles.outXlsx)) fs.unlinkSync(resFiles.outXlsx);
      if (resFiles.outJson && fs.existsSync(resFiles.outJson)) fs.unlinkSync(resFiles.outJson);
      if (resFiles.outCsv && fs.existsSync(resFiles.outCsv)) fs.unlinkSync(resFiles.outCsv);
      if (err) console.error('Erreur envoi fichier analyse:', err);
    });

  } catch (err) {
    console.error('Erreur /api/analyze-card:', err);
    return res.status(500).json({ error: err.message });
  }
});

function timeToString(hours, minutes) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
  console.log('Lecture et écriture dans releveur.xlsx');
});
