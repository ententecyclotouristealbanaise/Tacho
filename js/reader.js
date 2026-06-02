/**
 * reader.js — Gestion du lecteur USB de carte tachygraphe
 * TachoReader
 *
 * Deux modes :
 *  1. WebUSB réel  : communication avec un lecteur CCID/USB via navigator.usb
 *  2. Mode mock    : retourne des données de démonstration (sans matériel)
 *
 * Architecture APDU :
 *  - ISO 7816-4 : SELECT, READ BINARY, GET RESPONSE
 *  - Les lecteurs de carte tachygraphe utilisent le standard DDD/TC Regulation
 *    (Règlement CE 3821/85 / UE 165/2014)
 *  - Pour la démo, toutes les commandes APDU sont simulées.
 */

'use strict';

/* ============================================================
   CONSTANTES USB / APDU
   Vendor IDs courants des lecteurs de cartes CCID compatibles.
   ============================================================ */
const KNOWN_READERS = [
  { vendorId: 0x04E6, name: 'SCM Microsystems' },       // SCR3310, SCR3500, etc.
  { vendorId: 0x076B, name: 'OmniKey' },                // OmniKey 3021, 3121
  { vendorId: 0x08E6, name: 'Gemalto/Thales' },         // GemPC series
  { vendorId: 0x0BDA, name: 'Realtek' },                // Lecteurs intégrés
  { vendorId: 0x04CC, name: 'Philips' },
  { vendorId: 0x0DC3, name: 'Athena Smartcard' },
  { vendorId: 0x1059, name: 'Giesecke+Devrient' },
  { vendorId: 0x0529, name: 'Axalto' },
  { vendorId: 0x1FC9, name: 'NXP Semiconductors' },
];

// APDU de base pour carte tachygraphe
const APDU = {
  SELECT_MF:         [0x00, 0xA4, 0x00, 0x00, 0x00],
  SELECT_TACHO:      [0x00, 0xA4, 0x04, 0x00, 0x06, 0xFF, 0x54, 0x41, 0x43, 0x48, 0x4F],
  READ_CARD_ID:      [0x00, 0xB0, 0x00, 0x00, 0x00],
  READ_DRIVER_IDENT: [0x00, 0xB0, 0x01, 0x00, 0x00],
  READ_ACTIVITIES:   [0x00, 0xB0, 0x02, 0x00, 0x00],
  GET_RESPONSE:      [0x00, 0xC0, 0x00, 0x00, 0xFF],
};

/* ============================================================
   ÉTAT DU LECTEUR
   ============================================================ */
let readerState = {
  device:       null,   // USBDevice WebUSB
  connected:    false,
  cardPresent:  false,
  reading:      false,
  isMock:       false,
  lastError:    null
};

/**
 * Retourne l'état courant du lecteur.
 * @returns {object}
 */
function getReaderState() {
  return { ...readerState };
}

/* ============================================================
   CONNEXION USB (WebUSB)
   ============================================================ */

/**
 * Tente de connecter un lecteur USB via WebUSB.
 * Affiche un sélecteur de périphériques à l'utilisateur.
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function connectReader() {
  // Vérification de la disponibilité de l'API
  if (!navigator.usb) {
    return {
      success: false,
      message: 'WebUSB non disponible dans ce navigateur. Utilisez Chrome ou Edge en HTTPS.'
    };
  }

  try {
    // Construire les filtres de périphériques à partir des vendors connus
    const filters = KNOWN_READERS.map(r => ({ vendorId: r.vendorId }));
    // Filtres vides = afficher tous les périphériques USB (fallback)
    const allFilters = filters.length ? filters : [];

    // Demande l'autorisation à l'utilisateur
    const device = await navigator.usb.requestDevice({ filters: allFilters });

    if (!device) {
      return { success: false, message: 'Aucun périphérique sélectionné.' };
    }

    // Ouverture du périphérique
    await device.open();

    // Sélection de la configuration (généralement la première)
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }

    // Revendication de l'interface CCID (interface 0 en général)
    await device.claimInterface(0);

    readerState.device    = device;
    readerState.connected = true;
    readerState.isMock    = false;
    readerState.lastError = null;

    updateReaderUI('connected');
    return {
      success: true,
      message: `Lecteur connecté : ${device.productName || 'Inconnu'} (${device.manufacturerName || ''})`
    };

  } catch (err) {
    readerState.lastError = err.message;

    if (err.name === 'NotFoundError') {
      return { success: false, message: 'Aucun lecteur compatible trouvé.' };
    }
    if (err.name === 'SecurityError') {
      return { success: false, message: 'Accès refusé. Vérifiez les permissions du navigateur.' };
    }
    if (err.name === 'NetworkError') {
      return { success: false, message: 'Erreur de communication avec le lecteur.' };
    }
    return { success: false, message: `Erreur : ${err.message}` };
  }
}

/**
 * Déconnecte le lecteur USB.
 */
async function disconnectReader() {
  if (readerState.device) {
    try {
      await readerState.device.close();
    } catch (e) { /* ignore */ }
  }
  readerState.device    = null;
  readerState.connected = false;
  readerState.cardPresent = false;
  readerState.isMock    = false;
  updateReaderUI('disconnected');
}

/* ============================================================
   ENVOI D'APDU (USB réel)
   ============================================================ */

/**
 * Envoie une commande APDU au lecteur et retourne la réponse.
 * Point d'extension : adapter selon le protocole du lecteur (bulk/control).
 * @param {number[]} apdu - tableau d'octets de la commande APDU
 * @returns {Promise<Uint8Array>} - réponse brute
 */
async function sendAPDU(apdu) {
  if (!readerState.device || !readerState.connected) {
    throw new Error('Lecteur non connecté');
  }

  const data = new Uint8Array(apdu);

  // Transfert en mode bulk OUT (endpoint 0x02 typique pour CCID)
  // Note : selon le lecteur, l'endpoint peut varier (0x01, 0x02, 0x03)
  const endpointOut = 0x02;
  const endpointIn  = 0x82;

  try {
    await readerState.device.transferOut(endpointOut, data);
    const result = await readerState.device.transferIn(endpointIn, 64);
    return new Uint8Array(result.data.buffer);
  } catch (err) {
    throw new Error(`Erreur APDU : ${err.message}`);
  }
}

/* ============================================================
   LECTURE CARTE RÉELLE
   Point d'extension principal pour les données réelles.
   ============================================================ */

/**
 * Lit une carte conducteur via le lecteur USB réel.
 * Cette fonction est un squelette — à compléter avec le parsing
 * du format DDD/TGD spécifique aux cartes tachygraphe numériques.
 *
 * Spécification de référence :
 *  - Règlement UE 2016/799 Annex IC (génération 2)
 *  - Règlement CE 3821/85 Annex IB (génération 1)
 *
 * @returns {Promise<{driver: Driver, activities: Activity[]}>}
 */
async function readDriverCard() {
  if (!readerState.connected || !readerState.device) {
    throw new Error('Lecteur non connecté.');
  }

  readerState.reading = true;
  updateReaderUI('reading');

  try {
    // ── ÉTAPE 1 : SELECT Master File ──
    await sendAPDU(APDU.SELECT_MF);
    await sleep(100);

    // ── ÉTAPE 2 : SELECT Application Tachygraphe ──
    await sendAPDU(APDU.SELECT_TACHO);
    await sleep(100);

    // ── ÉTAPE 3 : Lire l'identification conducteur ──
    const identData = await sendAPDU(APDU.READ_DRIVER_IDENT);
    const driver = parseDriverIdent(identData);
    await sleep(100);

    // ── ÉTAPE 4 : Lire les activités ──
    const actData = await sendAPDU(APDU.READ_ACTIVITIES);
    const activities = parseActivities(actData, driver.id);

    readerState.reading     = false;
    readerState.cardPresent = true;
    updateReaderUI('card_read');

    return { driver, activities };

  } catch (err) {
    readerState.reading   = false;
    readerState.lastError = err.message;
    updateReaderUI('error');
    throw err;
  }
}

/**
 * Parse les octets d'identification conducteur (format simplifié).
 * Format réel : TLV (Tag-Length-Value) selon spécification CE.
 * @param {Uint8Array} data
 * @returns {Driver}
 */
function parseDriverIdent(data) {
  // Point d'extension : implémenter le parsing TLV réel ici
  // Pour l'instant, retourne une structure vide à compléter
  console.warn('[Reader] parseDriverIdent: parsing réel non implémenté, données brutes:', data);
  return {
    id:             'DRV_REAL_001',
    nom:            'INCONNU',
    prenom:         '',
    numeroCarte:    '??????????????',
    dateExpiration: '',
    pays:           'FR'
  };
}

/**
 * Parse les octets d'activités tachygraphe.
 * Format réel : blocs de 2 octets par activité (encodage compact CE 561/2006).
 * @param {Uint8Array} data
 * @param {string} driverId
 * @returns {Activity[]}
 */
function parseActivities(data, driverId) {
  // Point d'extension : implémenter le décodage réel ici
  // Chaque activité est encodée sur 2 octets dans le fichier CardActivityDailyRecord
  console.warn('[Reader] parseActivities: parsing réel non implémenté, données brutes:', data);
  return [];
}

/* ============================================================
   LECTURE MOCK (sans matériel)
   ============================================================ */

/**
 * Simule la lecture d'une carte conducteur.
 * Retourne le jeu de données de test défini dans data.js.
 * Inclut un délai artificiel pour simuler la communication USB.
 * @returns {Promise<{driver: Driver, activities: Activity[]}>}
 */
async function readDriverCardMock() {
  readerState.reading = true;
  readerState.isMock  = true;
  updateReaderUI('reading');

  // Simulation d'une lecture USB avec progression
  const steps = [
    { msg: 'Connexion au lecteur...', delay: 400 },
    { msg: 'Sélection de la carte...', delay: 500 },
    { msg: 'Lecture identité conducteur...', delay: 600 },
    { msg: 'Lecture activités (bloc 1/3)...', delay: 700 },
    { msg: 'Lecture activités (bloc 2/3)...', delay: 600 },
    { msg: 'Lecture activités (bloc 3/3)...', delay: 500 },
    { msg: 'Vérification des données...', delay: 400 },
  ];

  for (const step of steps) {
    updateReadingProgress(step.msg);
    await sleep(step.delay);
  }

  // Données de test provenant de data.js
  const mockData = getMockData();

  readerState.reading     = false;
  readerState.cardPresent = true;
  updateReaderUI('card_read');

  return mockData;
}

/* ============================================================
   MISES À JOUR UI LIÉES AU LECTEUR
   ============================================================ */

/**
 * Met à jour les éléments visuels du lecteur selon l'état.
 * @param {'disconnected'|'connected'|'reading'|'card_read'|'error'} state
 */
function updateReaderUI(state) {
  const light      = document.getElementById('readerLight');
  const tag        = document.getElementById('readerTag');
  const desc       = document.getElementById('readerDesc');
  const statusDot  = document.querySelector('.status-dot');
  const statusText = document.querySelector('.status-text');
  const cardSlot   = document.getElementById('cardInSlot');
  const connectBtn = document.getElementById('connectUsbBtn');

  if (!light) return; // Page pas encore chargée

  switch (state) {
    case 'disconnected':
      light.className      = 'reader-light';
      tag.textContent      = 'Non connecté';
      tag.className        = 'tag';
      desc.textContent     = 'Connectez un lecteur USB ou utilisez les données de démonstration.';
      statusDot.className  = 'status-dot offline';
      statusText.textContent = 'Lecteur non connecté';
      if (cardSlot) { cardSlot.style.display = 'none'; cardSlot.classList.remove('inserted'); }
      break;

    case 'connected':
      light.className      = 'reader-light active';
      tag.textContent      = 'Connecté';
      tag.className        = 'tag success';
      desc.textContent     = 'Lecteur USB connecté. Insérez une carte conducteur puis cliquez sur "Lire carte".';
      statusDot.className  = 'status-dot online';
      statusText.textContent = 'Lecteur connecté';
      if (connectBtn) connectBtn.textContent = 'Déconnecter';
      break;

    case 'reading':
      light.className      = 'reader-light reading';
      tag.textContent      = 'Lecture en cours…';
      tag.className        = 'tag warn';
      statusDot.className  = 'status-dot reading';
      statusText.textContent = 'Lecture en cours…';
      if (cardSlot) { cardSlot.style.display = 'block'; setTimeout(() => cardSlot.classList.add('inserted'), 50); }
      break;

    case 'card_read':
      light.className      = 'reader-light active';
      tag.textContent      = readerState.isMock ? 'Données démo' : 'Carte lue';
      tag.className        = 'tag success';
      desc.textContent     = 'Carte lue avec succès. Données disponibles dans les onglets.';
      statusDot.className  = 'status-dot online';
      statusText.textContent = 'Carte lue';
      break;

    case 'error':
      light.className      = 'reader-light';
      tag.textContent      = 'Erreur';
      tag.className        = 'tag danger';
      desc.textContent     = `Erreur : ${readerState.lastError || 'Problème de communication.'}`;
      statusDot.className  = 'status-dot offline';
      break;
  }
}

/**
 * Met à jour le texte de progression de lecture.
 * @param {string} message
 */
function updateReadingProgress(message) {
  const desc = document.getElementById('readerDesc');
  if (desc) desc.textContent = message;
}

/* ============================================================
   UTILITAIRES
   ============================================================ */

/** Pause asynchrone. @param {number} ms */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
