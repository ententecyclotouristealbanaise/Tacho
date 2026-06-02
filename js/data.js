/**
 * data.js — Modèle de données, stockage local, données de test
 * TachoReader — Application de lecture de carte conducteur
 *
 * Gère :
 *  - Les structures de données (Driver, Activity, Infraction, SalarySummary)
 *  - Le stockage/lecture via localStorage
 *  - Le jeu de données mock pour les tests sans carte réelle
 */

'use strict';

/* ============================================================
   CONSTANTES DE TYPES D'ACTIVITÉ
   ============================================================ */
const ACTIVITY_TYPES = {
  DRIVING:      'driving',      // Conduite
  WORK:         'work',         // Autre travail
  AVAILABILITY: 'availability', // Disponibilité
  REST:         'rest'          // Repos
};

const ACTIVITY_LABELS = {
  driving:      'Conduite',
  work:         'Travail',
  availability: 'Disponibilité',
  rest:         'Repos'
};

const SEVERITY_LABELS = {
  high:   'Grave',
  medium: 'Modérée',
  low:    'Mineure'
};

/* ============================================================
   CLÉS DE STOCKAGE
   ============================================================ */
const STORAGE_KEYS = {
  DRIVERS:     'tacho_drivers',
  ACTIVITIES:  'tacho_activities',
  INFRACTIONS: 'tacho_infractions',
  SETTINGS:    'tacho_settings',
  ACTIVE_DRV:  'tacho_active_driver',
  SALARY_CONF: 'tacho_salary_config',
  LAST_READ:   'tacho_last_read'
};

/* ============================================================
   PARAMÈTRES PAR DÉFAUT
   ============================================================ */
const DEFAULT_SETTINGS = {
  theme:           'light',   // 'light' | 'dark'
  defaultPeriod:   28,        // jours
  dateFormat:      'fr',      // 'fr' | 'iso'
  regulation:      'CE561',
  maxDailyDrive:   9,         // heures
  maxWeeklyDrive:  56,        // heures
  breakAfter:      4.5,       // heures de conduite avant pause obligatoire
  minBreakDuration:45,        // minutes
  minDailyRest:    11,        // heures
  minWeeklyRest:   45         // heures
};

const DEFAULT_SALARY_CONFIG = {
  rate:          13.50,   // €/h normal
  ot1Percent:    25,      // % majoration HS1
  ot2Percent:    50,      // % majoration HS2
  ot1Threshold:  151.67,  // h/mois seuil HS1
  ot2Threshold:  200,     // h/mois seuil HS2
  nightBonus:    2.50,    // €/h nuit
  sundayBonus:   3.00,    // €/h dimanche
  holidayBonus:  5.00,    // €/h jour férié
  nightStart:    21,      // heure début nuit
  nightEnd:      6        // heure fin nuit
};

/* ============================================================
   STOCKAGE LOCAL (localStorage)
   Toutes les fonctions sont synchrones pour la simplicité.
   On peut migrer vers IndexedDB pour de grands volumes.
   ============================================================ */

/** Sauvegarde un objet JS dans localStorage */
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error(`[Storage] Erreur écriture ${key}:`, e);
    return false;
  }
}

/** Lit et parse un objet depuis localStorage */
function lsGet(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[Storage] Erreur lecture ${key}:`, e);
    return fallback;
  }
}

/** Efface une clé du localStorage */
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

/* ============================================================
   API DE DONNÉES — CONDUCTEURS
   ============================================================ */

/**
 * Retourne la liste de tous les conducteurs enregistrés.
 * @returns {Driver[]}
 */
function getDrivers() {
  return lsGet(STORAGE_KEYS.DRIVERS, []);
}

/**
 * Ajoute ou met à jour un conducteur (identifié par numeroCarte).
 * @param {Driver} driver
 */
function addOrUpdateDriver(driver) {
  const drivers = getDrivers();
  // Chaque conducteur est identifié par son numéro de carte
  driver.id = driver.id || driver.numeroCarte || `drv_${Date.now()}`;
  const idx = drivers.findIndex(d => d.id === driver.id);
  if (idx >= 0) {
    drivers[idx] = { ...drivers[idx], ...driver };
  } else {
    drivers.push(driver);
  }
  lsSet(STORAGE_KEYS.DRIVERS, drivers);
  return driver;
}

/**
 * Supprime un conducteur par son id.
 * @param {string} driverId
 */
function removeDriver(driverId) {
  const drivers = getDrivers().filter(d => d.id !== driverId);
  lsSet(STORAGE_KEYS.DRIVERS, drivers);
}

/**
 * Retourne le conducteur actif (id stocké en localStorage).
 * @returns {Driver|null}
 */
function getActiveDriver() {
  const id = lsGet(STORAGE_KEYS.ACTIVE_DRV);
  if (!id) return null;
  return getDrivers().find(d => d.id === id) || null;
}

/**
 * Définit le conducteur actif.
 * @param {string} driverId
 */
function setActiveDriver(driverId) {
  lsSet(STORAGE_KEYS.ACTIVE_DRV, driverId);
}

/* ============================================================
   API DE DONNÉES — ACTIVITÉS
   ============================================================ */

/**
 * Retourne toutes les activités stockées.
 * @returns {Activity[]}
 */
function getActivities() {
  const raw = lsGet(STORAGE_KEYS.ACTIVITIES, []);
  // Conversion des dates string → Date si nécessaire
  return raw.map(a => ({
    ...a,
    start: new Date(a.start),
    end:   new Date(a.end)
  }));
}

/**
 * Sauvegarde un tableau d'activités (remplace tout).
 * @param {Activity[]} activities
 */
function saveActivities(activities) {
  // On sérialise les dates en ISO string pour JSON
  const serialized = activities.map(a => ({
    ...a,
    start: a.start instanceof Date ? a.start.toISOString() : a.start,
    end:   a.end   instanceof Date ? a.end.toISOString()   : a.end
  }));
  lsSet(STORAGE_KEYS.ACTIVITIES, serialized);
}

/**
 * Fusionne de nouvelles activités avec celles existantes
 * (dédoublonnage par start+type+conducteur).
 * @param {Activity[]} newActivities
 */
function mergeActivities(newActivities) {
  const existing = getActivities();
  const makeKey = a => `${a.driverId}_${new Date(a.start).getTime()}_${a.type}`;
  const existingKeys = new Set(existing.map(makeKey));
  const toAdd = newActivities.filter(a => !existingKeys.has(makeKey(a)));
  saveActivities([...existing, ...toAdd]);
  return toAdd.length;
}

/**
 * Filtre les activités selon des critères.
 * @param {object} criteria - { driverId, type, vehicule, fromDate, toDate }
 * @returns {Activity[]}
 */
function filterActivities(criteria = {}) {
  let acts = getActivities();

  if (criteria.driverId) {
    acts = acts.filter(a => a.driverId === criteria.driverId);
  }
  if (criteria.type) {
    acts = acts.filter(a => a.type === criteria.type);
  }
  if (criteria.vehicule) {
    const v = criteria.vehicule.toLowerCase();
    acts = acts.filter(a => a.vehicule && a.vehicule.toLowerCase().includes(v));
  }
  if (criteria.fromDate) {
    const from = new Date(criteria.fromDate);
    acts = acts.filter(a => new Date(a.start) >= from);
  }
  if (criteria.toDate) {
    const to = new Date(criteria.toDate);
    acts = acts.filter(a => new Date(a.end) <= to);
  }
  if (criteria.days) {
    const from = new Date();
    from.setDate(from.getDate() - criteria.days);
    from.setHours(0, 0, 0, 0);
    acts = acts.filter(a => new Date(a.start) >= from);
  }

  // Tri chronologique
  acts.sort((a, b) => new Date(a.start) - new Date(b.start));
  return acts;
}

/* ============================================================
   API DE DONNÉES — INFRACTIONS
   ============================================================ */

/**
 * Sauvegarde les infractions détectées.
 * @param {Infraction[]} infractions
 */
function saveInfractions(infractions) {
  const serialized = infractions.map(inf => ({
    ...inf,
    date: inf.date instanceof Date ? inf.date.toISOString() : inf.date
  }));
  lsSet(STORAGE_KEYS.INFRACTIONS, serialized);
}

/**
 * Retourne les infractions stockées.
 * @returns {Infraction[]}
 */
function getInfractions() {
  const raw = lsGet(STORAGE_KEYS.INFRACTIONS, []);
  return raw.map(inf => ({ ...inf, date: new Date(inf.date) }));
}

/* ============================================================
   API DE DONNÉES — PARAMÈTRES
   ============================================================ */

function getSettings() {
  return { ...DEFAULT_SETTINGS, ...lsGet(STORAGE_KEYS.SETTINGS, {}) };
}

function saveSettings(settings) {
  lsSet(STORAGE_KEYS.SETTINGS, settings);
}

function getSalaryConfig() {
  return { ...DEFAULT_SALARY_CONFIG, ...lsGet(STORAGE_KEYS.SALARY_CONF, {}) };
}

function saveSalaryConfig(config) {
  lsSet(STORAGE_KEYS.SALARY_CONF, config);
}

/** Efface toutes les données (reset complet) */
function clearAllData() {
  Object.values(STORAGE_KEYS).forEach(key => lsRemove(key));
}

/* ============================================================
   DONNÉES MOCK — Jeu de test sur 14 jours
   Simule la lecture d'une carte conducteur réelle.
   ============================================================ */

/**
 * Génère des activités mock réalistes sur les 14 derniers jours.
 * Inclut des infractions volontaires pour tester la détection.
 * @returns {object} { driver, activities }
 */
function getMockData() {
  const driver = {
    id:             'DRV_FR001',
    nom:            'MARTIN',
    prenom:         'Sébastien',
    numeroCarte:    'FR1234567890ABCD',
    dateNaissance:  '1985-03-14',
    dateExpiration: '2029-11-30',
    pays:           'FR',
    entreprise:     'Transports Martin SARL',
    permis:         'CE'
  };

  // Date de référence : aujourd'hui à minuit
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Helper : crée une date relative à aujourd'hui
  const d = (daysAgo, h, m = 0) => {
    const dt = new Date(now);
    dt.setDate(dt.getDate() - daysAgo);
    dt.setHours(h, m, 0, 0);
    return dt;
  };

  // Helper : durée en minutes entre deux dates
  const durMin = (start, end) => Math.round((end - start) / 60000);

  const activities = [];
  let id = 1;
  const mkId = () => `ACT_${String(id++).padStart(4, '0')}`;

  // ── JOUR J-14 : journée normale ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(14, 0),    end: d(14, 6),    vehicule: '',           pays: 'FR', lieu: 'Dépôt' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(14, 6),    end: d(14, 6, 30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Dépôt' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(14, 6, 30),end: d(14, 10),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Lyon' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(14, 10),   end: d(14, 10,45),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Lyon' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(14, 10,45),end: d(14, 13,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Marseille' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(14, 13,30),end: d(14, 14,15),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Aire A7' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(14, 14,15),end: d(14, 17,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Montpellier' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(14, 17,30),end: d(14, 18),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Entrepôt Montpellier' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(14, 18),   end: d(13, 6),    vehicule: '',           pays: 'FR', lieu: 'Hôtel Montpellier' });

  // ── JOUR J-13 : pause courte (INFRACTION : pause < 45 min après 4h30) ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(13, 6),    end: d(13, 6,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Montpellier' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(13, 6,30), end: d(13, 11),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Toulouse' }); // 4h30 de conduite
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(13, 11),   end: d(13, 11,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Aire Toulouse' }); // Pause 30 min seulement → INFRACTION
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(13, 11,30),end: d(13, 14),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Bordeaux' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(13, 14),   end: d(13, 14,45),vehicule: '',           pays: 'FR', lieu: 'Bordeaux' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(13, 14,45),end: d(13, 18),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nantes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(13, 18),   end: d(13, 18,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Entrepôt Nantes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(13, 18,30),end: d(12, 6),    vehicule: '',           pays: 'FR', lieu: 'Hôtel Nantes' });

  // ── JOUR J-12 : journée longue (INFRACTION : conduite > 9h) ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(12, 6),    end: d(12, 6,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nantes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(12, 6,30), end: d(12, 10,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Rennes' }); // 4h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(12, 10,30),end: d(12, 11,15),vehicule: '',           pays: 'FR', lieu: 'Aire Rennes' }); // 45 min OK
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(12, 11,15),end: d(12, 16,15),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Paris' }); // 5h → total 9h, OK mais...
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(12, 16,15),end: d(12, 16,45),vehicule: '',           pays: 'FR', lieu: 'Aire A11' }); // petite pause
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(12, 16,45),end: d(12, 18),   vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Paris' }); // 1h15 → total 10h15 → INFRACTION > 9h (et > 10h ext.)
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(12, 18),   end: d(12, 18,30),vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Paris' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(12, 18,30),end: d(11, 5,30), vehicule: '',           pays: 'FR', lieu: 'Hôtel Paris' }); // seulement 11h → repos journalier réduit

  // ── JOUR J-11 : journée normale ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(11, 5,30), end: d(11, 6),    vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Paris' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(11, 6),    end: d(11, 9),    vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Reims' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(11, 9),    end: d(11, 9,45), vehicule: '',           pays: 'FR', lieu: 'Reims' }); // 45 min OK
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(11, 9,45), end: d(11, 13,15),vehicule: 'EF-456-GH',  pays: 'BE', lieu: 'Bruxelles' }); // 3h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(11, 13,15),end: d(11, 14),   vehicule: 'EF-456-GH',  pays: 'BE', lieu: 'Bruxelles' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(11, 14),   end: d(11, 16,30),vehicule: 'EF-456-GH',  pays: 'BE', lieu: 'Liège' }); // 2h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(11, 16,30),end: d(11, 17),   vehicule: 'EF-456-GH',  pays: 'BE', lieu: 'Entrepôt Liège' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(11, 17),   end: d(10, 6),    vehicule: '',           pays: 'BE', lieu: 'Hôtel Liège' }); // 13h de repos OK

  // ── JOUR J-10 : journée tranquille ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(10, 6),    end: d(10, 6,30), vehicule: 'EF-456-GH',  pays: 'BE', lieu: 'Liège' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(10, 6,30), end: d(10, 9,30), vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Metz' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(10, 9,30), end: d(10, 10,15),vehicule: '',           pays: 'FR', lieu: 'Metz' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(10, 10,15),end: d(10, 13,45),vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Strasbourg' }); // 3h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(10, 13,45),end: d(10, 14,15),vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Strasbourg' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(10, 14,15),end: d(9, 6),     vehicule: '',           pays: 'FR', lieu: 'Strasbourg' }); // longue nuit OK

  // ── JOUR J-9 : repos journalier (week-end) ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(9, 6),     end: d(8, 8),     vehicule: '',           pays: 'FR', lieu: 'Domicile' }); // repos étendu

  // ── JOUR J-8 : reprise ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(8, 8),     end: d(8, 8,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Dépôt' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(8, 8,30),  end: d(8, 12),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Lyon' }); // 3h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(8, 12),    end: d(8, 12,45), vehicule: '',           pays: 'FR', lieu: 'Aire A6' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(8, 12,45), end: d(8, 15,45), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Valence' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(8, 15,45), end: d(8, 16,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Valence' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(8, 16,30), end: d(8, 18),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Grenoble' }); // 1h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(8, 18),    end: d(8, 18,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Grenoble' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(8, 18,30), end: d(7, 6),     vehicule: '',           pays: 'FR', lieu: 'Hôtel Grenoble' }); // 11h30

  // ── JOUR J-7 : journée normale ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(7, 6),     end: d(7, 6,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Grenoble' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(7, 6,30),  end: d(7, 10),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nice' }); // 3h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(7, 10),    end: d(7, 10,45), vehicule: '',           pays: 'FR', lieu: 'Aire A8' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(7, 10,45), end: d(7, 14),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Monaco' }); // 3h15
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(7, 14),    end: d(7, 15),    vehicule: 'AB-123-CD',  pays: 'MC', lieu: 'Monaco' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(7, 15),    end: d(7, 17),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Cannes' }); // 2h
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(7, 17),    end: d(7, 17,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Cannes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(7, 17,30), end: d(6, 6),     vehicule: '',           pays: 'FR', lieu: 'Hôtel Cannes' }); // 12h30

  // ── JOUR J-6 : repos complet (INFRACTION repos hebdo à vérifier) ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(6, 6),     end: d(5, 6),     vehicule: '',           pays: 'FR', lieu: 'Domicile' }); // 24h repos

  // ── JOUR J-5 : reprise normale ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(5, 6),     end: d(5, 6,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Dépôt' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(5, 6,30),  end: d(5, 10,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Clermont' }); // 4h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(5, 10,30), end: d(5, 11,15), vehicule: '',           pays: 'FR', lieu: 'Clermont' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(5, 11,15), end: d(5, 14,15), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Limoges' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(5, 14,15), end: d(5, 15),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Limoges' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(5, 15),    end: d(5, 17),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Poitiers' }); // 2h
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(5, 17),    end: d(5, 17,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Poitiers' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(5, 17,30), end: d(4, 6),     vehicule: '',           pays: 'FR', lieu: 'Hôtel Poitiers' }); // 12h30

  // ── JOUR J-4 ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(4, 6),     end: d(4, 6,30),  vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Poitiers' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(4, 6,30),  end: d(4, 9,30),  vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Tours' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(4, 9,30),  end: d(4, 10,15), vehicule: '',           pays: 'FR', lieu: 'Tours' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(4, 10,15), end: d(4, 14,15), vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Le Mans' }); // 4h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(4, 14,15), end: d(4, 15),    vehicule: '',           pays: 'FR', lieu: 'Le Mans' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(4, 15),    end: d(4, 17,30), vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Rouen' }); // 2h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(4, 17,30), end: d(4, 18),    vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Rouen' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(4, 18),    end: d(3, 6),     vehicule: '',           pays: 'FR', lieu: 'Hôtel Rouen' }); // 12h

  // ── JOUR J-3 ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(3, 6),     end: d(3, 6,30),  vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Rouen' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(3, 6,30),  end: d(3, 9),     vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Caen' }); // 2h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(3, 9),     end: d(3, 9,45),  vehicule: '',           pays: 'FR', lieu: 'Caen' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(3, 9,45),  end: d(3, 13),    vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Rennes' }); // 3h15
  activities.push({ id: mkId(), driverId: driver.id, type: 'availability', start: d(3, 13),    end: d(3, 13,30), vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Rennes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(3, 13,30), end: d(3, 16),    vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Brest' }); // 2h30
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(3, 16),    end: d(3, 16,30), vehicule: 'EF-456-GH',  pays: 'FR', lieu: 'Brest' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(3, 16,30), end: d(2, 6),     vehicule: '',           pays: 'FR', lieu: 'Hôtel Brest' }); // 13h30

  // ── JOUR J-2 ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(2, 6),     end: d(2, 6,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Brest' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(2, 6,30),  end: d(2, 10,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Quimper' }); // 4h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(2, 10,30), end: d(2, 11,15), vehicule: '',           pays: 'FR', lieu: 'Quimper' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(2, 11,15), end: d(2, 14,15), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nantes' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(2, 14,15), end: d(2, 15),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nantes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(2, 15),    end: d(1, 6),     vehicule: '',           pays: 'FR', lieu: 'Nantes' }); // 15h

  // ── JOUR J-1 ──
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(1, 6),     end: d(1, 6,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Nantes' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(1, 6,30),  end: d(1, 9,30),  vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Angers' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(1, 9,30),  end: d(1, 10,15), vehicule: '',           pays: 'FR', lieu: 'Angers' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(1, 10,15), end: d(1, 13,15), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Le Mans' }); // 3h
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(1, 13,15), end: d(1, 14),    vehicule: '',           pays: 'FR', lieu: 'Le Mans' }); // 45 min
  activities.push({ id: mkId(), driverId: driver.id, type: 'driving',      start: d(1, 14),    end: d(1, 16),    vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Dépôt' }); // 2h
  activities.push({ id: mkId(), driverId: driver.id, type: 'work',         start: d(1, 16),    end: d(1, 16,30), vehicule: 'AB-123-CD',  pays: 'FR', lieu: 'Dépôt' });
  activities.push({ id: mkId(), driverId: driver.id, type: 'rest',         start: d(1, 16,30), end: d(0, 6),     vehicule: '',           pays: 'FR', lieu: 'Domicile' }); // 13h30

  // Ajouter durée calculée
  activities.forEach(a => {
    a.durationMin = Math.round((new Date(a.end) - new Date(a.start)) / 60000);
  });

  return { driver, activities };
}

/* ============================================================
   UTILITAIRES DE FORMATAGE DES DATES
   ============================================================ */

/**
 * Formate une Date selon le format configuré.
 * @param {Date|string} date
 * @param {boolean} withTime - inclure l'heure
 * @returns {string}
 */
function formatDate(date, withTime = true) {
  const dt = date instanceof Date ? date : new Date(date);
  if (isNaN(dt)) return '—';
  const settings = getSettings();
  if (settings.dateFormat === 'iso') {
    return withTime
      ? dt.toISOString().slice(0, 16).replace('T', ' ')
      : dt.toISOString().slice(0, 10);
  }
  // Format français
  const pad = n => String(n).padStart(2, '0');
  const datePart = `${pad(dt.getDate())}/${pad(dt.getMonth()+1)}/${dt.getFullYear()}`;
  if (!withTime) return datePart;
  return `${datePart} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

/**
 * Formate une durée en minutes en "Xh YYmin".
 * @param {number} minutes
 * @returns {string}
 */
function formatDuration(minutes) {
  if (minutes < 0) minutes = 0;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}min`;
}

/**
 * Retourne le nom du jour de la semaine.
 * @param {Date} date
 * @returns {string}
 */
function getDayName(date) {
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

/**
 * Échappe le HTML pour prévenir les XSS.
 * Définie ici (data.js, chargé en premier) pour être disponible dans tous les modules.
 * @param {*} str
 * @returns {string}
 */
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
