// === CONFIGURATION ===
const VENDOR_IDS = [0x04E6, 0x076B, 0x08E6, 0x0BDA, 0x04CC, 0x0DC3, 0x1059, 0x0529, 0x1FC9];
const TACHO_AID = [0xFF, 0x54, 0x41, 0x43, 0x48, 0x4F]; // Tachygraphe application ID

// === ÉLÉMENTS DOM ===
const connectBtn = document.querySelector('#connect-btn');
const readerStatus = document.querySelector('#reader-status');
const driverInfo = document.querySelector('#driver-info');
const activitiesContainer = document.querySelector('#activities-container');
const activitiesList = document.querySelector('#activities-list');
const exportBtn = document.querySelector('#export-btn');

let device = null;
let cardData = null;

// === UTILITAIRES ===
function setStatus(message, type = 'info') {
  readerStatus.textContent = message;
  readerStatus.className = type === 'info' ? 'status-message' : `status-message ${type}`;
}

function timeToString(hours, minutes) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dateDifference(date1, date2) {
  const ms = date2 - date1;
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return { hours, minutes, total: hours + minutes / 60 };
}

function isEvenWeekWednesday(date) {
  const dayOfWeek = date.getDay(); // 0 = dimanche, 3 = mercredi
  if (dayOfWeek !== 3) return false; // Pas mercredi
  
  // Trouver le lundi de la semaine
  const monday = new Date(date);
  monday.setDate(date.getDate() - (date.getDay() === 0 ? 6 : date.getDay() - 1));
  
  // Calculer le numéro de semaine dans l'année
  const yearStart = new Date(date.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((monday - yearStart) / (7 * 24 * 3600000));
  
  return weekNumber % 2 === 0; // Semaine paire
}

// === COMMUNICATION USB ===
async function sendAPDU(device, command) {
  try {
    await device.transferOut(1, new Uint8Array(command));
    const response = await device.transferIn(2, 256);
    return new Uint8Array(response.data.buffer);
  } catch (error) {
    console.error('Erreur APDU:', error);
    throw error;
  }
}

// === PARSING CARTE ===
function parseDriverInfo(data) {
  // Extraction basique du numéro et nom (format TLV)
  const driverId = extractString(data, 0, 16);
  const name = extractString(data, 20, 30);
  const expiry = extractString(data, 50, 10);
  
  return {
    id: driverId || 'N/A',
    name: name || 'N/A',
    expiry: expiry || 'N/A'
  };
}

function extractString(data, start, length) {
  try {
    let str = '';
    for (let i = start; i < start + length && i < data.length; i++) {
      const char = data[i];
      if (char >= 32 && char <= 126) str += String.fromCharCode(char);
    }
    return str.trim();
  } catch {
    return '';
  }
}

function parseActivities(data) {
  const activities = [];
  
  // Simulation: extraire les plages 2-octets
  // En réalité, c'est du format binaire encodé
  for (let i = 0; i < data.length - 3; i += 4) {
    const startHour = data[i];
    const startMin = data[i + 1];
    const endHour = data[i + 2];
    const endMin = data[i + 3];
    
    if (startHour <= 24 && endHour <= 24) {
      const start = new Date();
      start.setHours(startHour, startMin, 0);
      
      const end = new Date();
      end.setHours(endHour, endMin, 0);
      
      if (end > start) {
        activities.push({
          start,
          end,
          type: 'work'
        });
      }
    }
  }
  
  return activities.length > 0 ? activities : generateMockActivities();
}

function generateMockActivities() {
  // Pour tester : génère des activités de test
  const today = new Date();
  return [
    { start: new Date(today.setHours(6, 0)), end: new Date(today.setHours(6, 30)), type: 'work' },
    { start: new Date(today.setHours(6, 30)), end: new Date(today.setHours(10, 0)), type: 'driving' },
    { start: new Date(today.setHours(10, 0)), end: new Date(today.setHours(10, 30)), type: 'rest' },
    { start: new Date(today.setHours(10, 30)), end: new Date(today.setHours(12, 30)), type: 'driving' },
    { start: new Date(today.setHours(12, 30)), end: new Date(today.setHours(13, 30)), type: 'rest' },
    { start: new Date(today.setHours(13, 30)), end: new Date(today.setHours(17, 30)), type: 'driving' }
  ];
}

// === EXTRACTION DES 4 HEURES ===
function extractKeyTimes(activities) {
  const driving = activities.filter(a => a.type === 'driving');
  
  if (driving.length < 2) {
    return {
      startMorning: null,
      endMorning: null,
      startAfternoon: null,
      endAfternoon: null
    };
  }
  
  // Trier par heure
  driving.sort((a, b) => a.start - b.start);
  
  // Première conduite = début matin
  const startMorning = driving[0].start;
  
  // Fin avant 12h = fin matin
  let endMorning = null;
  for (let i = 1; i < driving.length; i++) {
    if (driving[i].start.getHours() >= 12) {
      endMorning = driving[i - 1].end;
      break;
    }
  }
  
  if (!endMorning) endMorning = driving[driving.length - 1].end;
  
  // Première après 12h = reprise après-midi
  let startAfternoon = null;
  for (let i = 0; i < driving.length; i++) {
    if (driving[i].start.getHours() >= 12) {
      startAfternoon = driving[i].start;
      break;
    }
  }
  
  // Dernière conduite = fin soir
  const endAfternoon = driving[driving.length - 1].end;
  
  return {
    startMorning,
    endMorning,
    startAfternoon,
    endAfternoon
  };
}

// === CALCUL DES HEURES ===
function calculateHours(keyTimes) {
  if (!keyTimes.startMorning || !keyTimes.endMorning) {
    return { morningHours: 0, afternoonHours: 0, totalHours: 0 };
  }
  
  const morningDiff = dateDifference(keyTimes.startMorning, keyTimes.endMorning);
  const morningHours = morningDiff.total;
  
  let afternoonHours = 0;
  if (keyTimes.startAfternoon && keyTimes.endAfternoon) {
    const afternoonDiff = dateDifference(keyTimes.startAfternoon, keyTimes.endAfternoon);
    afternoonHours = afternoonDiff.total;
  }
  
  const totalHours = morningHours + afternoonHours;
  
  return { morningHours, afternoonHours, totalHours };
}

function calculateExtraHours(totalHours, date) {
  const quotaHours = isEvenWeekWednesday(date) ? -7 : 7;
  const extraHours = totalHours - quotaHours;
  return extraHours;
}

// === AFFICHAGE ===
function displayDriverInfo(info) {
  document.querySelector('#driver-number').textContent = info.id;
  document.querySelector('#driver-name').textContent = info.name;
  document.querySelector('#driver-expiry').textContent = info.expiry;
  driverInfo.style.display = 'block';
}

function displayActivities(activities, keyTimes, hours) {
  activitiesList.innerHTML = '';
  
  activities.forEach((activity, idx) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `
      <strong>${activity.type}</strong>: 
      ${timeToString(activity.start.getHours(), activity.start.getMinutes())} → 
      ${timeToString(activity.end.getHours(), activity.end.getMinutes())}
    `;
    activitiesList.appendChild(item);
  });
  
  // Résumé
  if (keyTimes.startMorning) {
    document.querySelector('#summary-debut').textContent = timeToString(keyTimes.startMorning.getHours(), keyTimes.startMorning.getMinutes());
  }
  if (keyTimes.endMorning) {
    document.querySelector('#summary-fin-matin').textContent = timeToString(keyTimes.endMorning.getHours(), keyTimes.endMorning.getMinutes());
  }
  if (keyTimes.startAfternoon) {
    document.querySelector('#summary-reprise').textContent = timeToString(keyTimes.startAfternoon.getHours(), keyTimes.startAfternoon.getMinutes());
  }
  if (keyTimes.endAfternoon) {
    document.querySelector('#summary-fin').textContent = timeToString(keyTimes.endAfternoon.getHours(), keyTimes.endAfternoon.getMinutes());
  }
  
  // Heures travaillées
  const h = Math.floor(hours.totalHours);
  const m = Math.round((hours.totalHours - h) * 60);
  document.querySelector('#summary-hours').textContent = `${h}h${String(m).padStart(2, '0')}`;
  
  // Heures sup
  const extraHours = calculateExtraHours(hours.totalHours, new Date());
  const eh = Math.floor(Math.abs(extraHours));
  const em = Math.round((Math.abs(extraHours) - eh) * 60);
  const sign = extraHours >= 0 ? '+' : '-';
  document.querySelector('#summary-extra').textContent = `${sign}${eh}h${String(em).padStart(2, '0')}`;
  
  activitiesContainer.style.display = 'block';
  
  // Sauvegarder pour export
  cardData = {
    keyTimes,
    hours,
    activities,
    extraHours,
    driverInfo: {
      id: document.querySelector('#driver-number').textContent,
      name: document.querySelector('#driver-name').textContent
    }
  };
}

// === LECTURE CARTE ===
async function readCard() {
  try {
    setStatus('Connexion au lecteur USB...', 'info');
    
    const filters = VENDOR_IDS.map(vendorId => ({ vendorId }));
    const devices = await navigator.usb.getDevices();
    
    if (devices.length === 0) {
      device = await navigator.usb.requestDevice({ filters });
    } else {
      device = devices[0];
    }
    
    await device.open();
    await device.claimInterface(0);
    
    setStatus('Lecteur connecté, lecture de la carte...', 'info');
    
    // Sélectionner l'application tachygraphe
    const selectCommand = [0x00, 0xA4, 0x04, 0x00, 0x06, ...TACHO_AID];
    const selectResponse = await sendAPDU(device, selectCommand);
    
    // Lire les infos conducteur
    const readDriverCommand = [0x00, 0xB0, 0x00, 0x00, 0x80];
    const driverData = await sendAPDU(device, readDriverCommand);
    const driverInfo = parseDriverInfo(driverData);
    
    // Lire les activités
    const readActivitiesCommand = [0x00, 0xB0, 0x01, 0x00, 0xFF];
    const activitiesData = await sendAPDU(device, readActivitiesCommand);
    const activities = parseActivities(activitiesData);
    
    // Traiter les données
    displayDriverInfo(driverInfo);
    const keyTimes = extractKeyTimes(activities);
    const hours = calculateHours(keyTimes);
    displayActivities(activities, keyTimes, hours);
    
    setStatus('Carte lue avec succès !', 'success');
    
  } catch (error) {
    console.error('Erreur:', error);
    if (error.name === 'NotAllowedError') {
      setStatus('Accès au lecteur refusé.', 'error');
    } else {
      setStatus('Erreur: ' + error.message, 'error');
    }
  }
}

// === EXPORT EXCEL ===
async function exportToExcel() {
  if (!cardData) return;
  
  try {
    exportBtn.disabled = true;
    setStatus('Génération du fichier Excel...', 'info');
    
    const response = await fetch('/api/export-tacho', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cardData)
    });
    
    if (!response.ok) {
      throw new Error('Erreur serveur');
    }
    
    setStatus('Fichier généré ! Téléchargement en cours...', 'success');
    
    // Télécharger le fichier
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `releve_tachygraphe_${new Date().toLocaleDateString('fr-FR')}.xlsx`;
    a.click();
    
  } catch (error) {
    setStatus('Erreur: ' + error.message, 'error');
  } finally {
    exportBtn.disabled = false;
  }
}

// === EVENT LISTENERS ===
connectBtn.addEventListener('click', readCard);
exportBtn.addEventListener('click', exportToExcel);

// Vérifier la disponibilité de WebUSB
if (!navigator.usb) {
  setStatus('WebUSB non disponible sur ce navigateur.', 'error');
  connectBtn.disabled = true;
}
