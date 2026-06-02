/**
 * main.js — Logique principale de l'application TachoReader
 *
 * Responsabilités :
 *  - Navigation SPA (Single Page Application)
 *  - Initialisation de l'application
 *  - Orchestration de la lecture de carte
 *  - Rendu des vues : tableau de bord, activités, conducteurs, paramètres
 *  - Système de notifications
 */

'use strict';

/* ============================================================
   ÉTAT GLOBAL DE L'APPLICATION
   ============================================================ */
const App = {
  currentPage:    'dashboard',
  currentView:    'table',      // 'table' | 'timeline'
  filteredActs:   [],
  infractions:    [],
  salarySummary:  null,
  loading:        false
};

/* ============================================================
   INITIALISATION
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initSidebar();
  initSettings();
  initReaderButtons();
  initActivitiesPage();
  initSalaryPage();
  initExportPage();
  initDriversPage();
  initSettingsPage();
  loadAndRender();
  updateActiveDriverBadge();
});

/** Charge les données et met à jour toutes les vues. */
function loadAndRender() {
  const settings = getSettings();
  const acts     = filterActivities({ days: settings.defaultPeriod });
  App.filteredActs = acts;

  // Mettre à jour la période du filtre actif par défaut
  const periodSelect = document.getElementById('activityPeriod');
  if (periodSelect) periodSelect.value = settings.defaultPeriod;

  // Détecter les infractions
  App.infractions = detectInfractions(acts, settings);
  saveInfractions(App.infractions);

  // Rendu
  renderDashboard(acts, App.infractions);
  renderActivities(acts);
  renderInfractions(App.infractions);
  renderDriversList();
}

/* ============================================================
   NAVIGATION SPA
   ============================================================ */

function initNavigation() {
  // Liens de navigation dans la sidebar
  document.querySelectorAll('[data-page]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });
}

/**
 * Navigue vers une page.
 * @param {string} pageId
 */
function navigateTo(pageId) {
  // Désactiver tous les liens / pages
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Activer la page cible
  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  // Activer le lien correspondant
  document.querySelectorAll(`[data-page="${pageId}"]`).forEach(l => l.classList.add('active'));

  // Mettre à jour le titre
  const titles = {
    dashboard:   'Tableau de bord',
    activities:  'Activités',
    infractions: 'Infractions',
    salary:      'Salaire prévisionnel',
    drivers:     'Conducteurs',
    export:      'Export',
    settings:    'Paramètres'
  };
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = titles[pageId] || pageId;

  App.currentPage = pageId;
  window.scrollTo(0, 0);
}

/* ============================================================
   SIDEBAR
   ============================================================ */

function initSidebar() {
  const sidebar    = document.getElementById('sidebar');
  const toggleBtn  = document.getElementById('sidebarToggle');
  const main       = document.getElementById('mainContent');
  const mobileBtn  = document.getElementById('mobileMenuBtn');

  toggleBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    main.classList.toggle('sidebar-collapsed');
  });

  mobileBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}

/* ============================================================
   BOUTONS DU LECTEUR
   ============================================================ */

function initReaderButtons() {
  // Bouton "Lire carte" dans la topbar
  document.getElementById('readCardBtn')?.addEventListener('click', () => {
    handleReadCard();
  });

  // Bouton "Connecter USB"
  document.getElementById('connectUsbBtn')?.addEventListener('click', async () => {
    const state = getReaderState();
    if (state.connected) {
      await disconnectReader();
      showNotification('info', 'Lecteur', 'Lecteur déconnecté.');
    } else {
      const result = await connectReader();
      showNotification(result.success ? 'success' : 'error', 'Lecteur USB', result.message);
    }
  });

  // Bouton "Charger données démo" (dashboard)
  document.getElementById('loadMockBtn')?.addEventListener('click', () => handleLoadMock());

  // Bouton "Charger données démo" (page activités)
  document.getElementById('loadMockBtn2')?.addEventListener('click', () => {
    handleLoadMock();
    navigateTo('activities');
  });
}

/**
 * Déclenche la lecture d'une carte (USB réel ou mock selon l'état).
 */
async function handleReadCard() {
  if (App.loading) return;

  const state = getReaderState();
  if (state.connected && !state.isMock) {
    // Lecture USB réelle
    await handleRealRead();
  } else {
    // Pas de lecteur connecté : proposer le mode démo
    showNotification('info', 'Lecteur', 'Aucun lecteur USB connecté — chargement des données de démo.');
    await handleLoadMock();
  }
}

/** Lecture USB réelle. */
async function handleRealRead() {
  App.loading = true;
  try {
    const { driver, activities } = await readDriverCard();
    processReadData(driver, activities, false);
  } catch (err) {
    showNotification('error', 'Lecture carte', err.message);
  }
  App.loading = false;
}

/** Chargement des données mock. */
async function handleLoadMock() {
  App.loading = true;
  try {
    const { driver, activities } = await readDriverCardMock();
    processReadData(driver, activities, true);
  } catch (err) {
    showNotification('error', 'Données démo', err.message);
  }
  App.loading = false;
}

/**
 * Traite les données lues (réelles ou mock) :
 * enregistre le conducteur, fusionne les activités, relance les analyses.
 * @param {Driver}     driver
 * @param {Activity[]} activities
 * @param {boolean}    isMock
 */
function processReadData(driver, activities, isMock) {
  // Enregistrer le conducteur
  addOrUpdateDriver(driver);
  setActiveDriver(driver.id);

  // Fusionner les activités
  const added = mergeActivities(activities);

  // Relancer l'analyse complète
  loadAndRender();
  updateActiveDriverBadge();

  showNotification(
    'success',
    isMock ? 'Données démo chargées' : 'Carte lue',
    `${activities.length} activités sur 14 jours — ${added} nouvelles.`
  );

  // Stocker la date de dernière lecture
  lsSet(STORAGE_KEYS.LAST_READ, { date: new Date().toISOString(), driverName: `${driver.prenom} ${driver.nom}` });

  // Naviguer vers le dashboard pour voir les résultats
  navigateTo('dashboard');
}

/* ============================================================
   RENDU — TABLEAU DE BORD
   ============================================================ */

/**
 * Met à jour tous les widgets du tableau de bord.
 * @param {Activity[]} acts
 * @param {Infraction[]} infractions
 */
function renderDashboard(acts, infractions) {
  const settings = getSettings();

  // ── Stats de conduite ──
  renderDriveStats(acts, settings);

  // ── Infractions ──
  const statInfVal = document.getElementById('statInfractionsVal');
  const statInfSub = document.getElementById('statInfractionsSub');
  if (statInfVal) statInfVal.textContent = infractions.length;
  if (statInfSub) {
    const high = infractions.filter(i => i.gravite === 'high').length;
    statInfSub.textContent = high > 0 ? `dont ${high} grave${high > 1 ? 's' : ''}` : 'Sur la période analysée';
  }

  // ── Dernière lecture ──
  const lastRead = lsGet(STORAGE_KEYS.LAST_READ);
  const statLRVal = document.getElementById('statLastReadVal');
  const statLRSub = document.getElementById('statLastReadSub');
  if (lastRead && statLRVal) {
    const d = new Date(lastRead.date);
    statLRVal.textContent = formatDate(d, false);
    if (statLRSub) statLRSub.textContent = lastRead.driverName || 'Carte conducteur';
  } else if (statLRVal) {
    statLRVal.textContent = '—';
  }

  // ── Activités récentes ──
  const recent = acts.slice(-8).reverse();
  const recentContainer = document.getElementById('recentActivities');
  if (recentContainer) {
    if (recent.length === 0) {
      recentContainer.innerHTML = `<div class="empty-state"><svg viewBox="0 0 48 48" fill="none" width="40"><rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="2"/><line x1="6" y1="18" x2="42" y2="18" stroke="currentColor" stroke-width="2"/></svg><p>Aucune activité chargée</p></div>`;
    } else {
      recentContainer.innerHTML = recent.map(a => `
        <div class="timeline-entry ${a.type}">
          <span class="timeline-time">${formatDate(a.start)}</span>
          <span class="activity-pill ${a.type}">${ACTIVITY_LABELS[a.type] || a.type}</span>
          <span class="timeline-desc">${escHtml(a.lieu || a.vehicule || '—')}</span>
          <span class="timeline-dur">${formatDuration(Math.round((new Date(a.end) - new Date(a.start)) / 60000))}</span>
        </div>
      `).join('');
    }
  }

  // ── Conducteur actif ──
  renderActiveDriverInfo();
}

/**
 * Calcule et affiche les stats de conduite (semaine / jour).
 */
function renderDriveStats(acts, settings) {
  // Semaine courante (lundi → dimanche)
  const now       = new Date();
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=lundi, 7=dimanche
  const monday    = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  monday.setHours(0, 0, 0, 0);

  const weekActs = acts.filter(a => new Date(a.start) >= monday && a.type === 'driving');
  const weekMin  = weekActs.reduce((s, a) => s + Math.round((new Date(a.end) - new Date(a.start)) / 60000), 0);
  const weekHrs  = weekMin / 60;
  const maxWeek  = settings.maxWeeklyDrive || 56;

  const statWeekVal = document.getElementById('statDriveWeekVal');
  const statWeekBar = document.getElementById('statDriveWeekBar');
  if (statWeekVal) statWeekVal.textContent = formatDuration(weekMin);
  if (statWeekBar) {
    const pct = Math.min(100, (weekHrs / maxWeek) * 100);
    statWeekBar.style.width = `${pct}%`;
    statWeekBar.style.background = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warn)' : 'var(--accent)';
  }

  // Jour courant
  const today   = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayActs = acts.filter(a => {
    const s = new Date(a.start);
    return a.type === 'driving' && s >= today && s < tomorrow;
  });
  const dayMin = dayActs.reduce((s, a) => s + Math.round((new Date(a.end) - new Date(a.start)) / 60000), 0);
  const dayHrs = dayMin / 60;
  const maxDay = settings.maxDailyDrive || 9;

  const statDayVal = document.getElementById('statDriveDayVal');
  const statDayBar = document.getElementById('statDriveDayBar');
  if (statDayVal) statDayVal.textContent = dayMin > 0 ? formatDuration(dayMin) : '0h';
  if (statDayBar) {
    const pct = Math.min(100, (dayHrs / maxDay) * 100);
    statDayBar.style.width = `${pct}%`;
    statDayBar.style.background = pct > 90 ? 'var(--danger)' : pct > 70 ? 'var(--warn)' : 'var(--accent)';
  }
}

/** Affiche les infos du conducteur actif dans le dashboard. */
function renderActiveDriverInfo() {
  const driver  = getActiveDriver();
  const panel   = document.getElementById('driverInfoPanel');
  const badge   = document.getElementById('activeDriverName');

  if (badge) badge.textContent = driver ? `${driver.prenom} ${driver.nom}` : 'Aucun conducteur';

  if (!panel) return;
  if (!driver) {
    panel.innerHTML = `<div class="empty-state"><svg viewBox="0 0 48 48" fill="none" width="40"><circle cx="24" cy="16" r="8" stroke="currentColor" stroke-width="2"/><path d="M8 44c0-8.837 7.163-16 16-16s16 7.163 16 16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p>Aucun conducteur sélectionné</p></div>`;
    return;
  }

  const expiry = driver.dateExpiration ? formatDate(new Date(driver.dateExpiration), false) : '—';
  const isExpired = driver.dateExpiration && new Date(driver.dateExpiration) < new Date();

  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.9rem">
      <div class="driver-avatar">${escHtml(driver.prenom[0] || '?')}${escHtml(driver.nom[0] || '')}</div>
      <div>
        <div style="font-weight:600;font-size:.9rem">${escHtml(driver.prenom)} ${escHtml(driver.nom)}</div>
        <div style="font-size:.75rem;color:var(--text-muted)">${escHtml(driver.entreprise || '—')}</div>
      </div>
    </div>
    <div class="driver-detail-item"><span class="k">N° carte</span><span class="v">${escHtml(driver.numeroCarte || '—')}</span></div>
    <div class="driver-detail-item"><span class="k">Pays</span><span class="v">${escHtml(driver.pays || '—')}</span></div>
    <div class="driver-detail-item"><span class="k">Permis</span><span class="v">${escHtml(driver.permis || '—')}</span></div>
    <div class="driver-detail-item">
      <span class="k">Expiration</span>
      <span class="v" style="${isExpired ? 'color:var(--danger)' : ''}">${expiry}${isExpired ? ' ⚠' : ''}</span>
    </div>
  `;
}

/** Met à jour le badge du conducteur actif dans la topbar. */
function updateActiveDriverBadge() {
  const driver = getActiveDriver();
  const badge  = document.getElementById('activeDriverName');
  if (badge) badge.textContent = driver ? `${driver.prenom} ${driver.nom}` : 'Aucun conducteur';
}

/* ============================================================
   RENDU — ACTIVITÉS
   ============================================================ */

function initActivitiesPage() {
  document.getElementById('applyFilters')?.addEventListener('click', applyActivityFilters);
  document.getElementById('resetFilters')?.addEventListener('click', resetActivityFilters);
  document.getElementById('viewTable')?.addEventListener('click', () => switchView('table'));
  document.getElementById('viewTimeline')?.addEventListener('click', () => switchView('timeline'));
}

function applyActivityFilters() {
  const period  = parseInt(document.getElementById('activityPeriod')?.value || '28', 10);
  const type    = document.getElementById('activityType')?.value || '';
  const vehicle = document.getElementById('activityVehicle')?.value || '';
  const driver  = getActiveDriver();

  const criteria = { days: period };
  if (type)    criteria.type     = type;
  if (vehicle) criteria.vehicule = vehicle;
  if (driver)  criteria.driverId = driver.id;

  App.filteredActs = filterActivities(criteria);
  renderActivities(App.filteredActs);
  showNotification('info', 'Filtres', `${App.filteredActs.length} activités affichées.`);
}

function resetActivityFilters() {
  document.getElementById('activityType').value    = '';
  document.getElementById('activityVehicle').value = '';
  const settings = getSettings();
  document.getElementById('activityPeriod').value  = settings.defaultPeriod;
  App.filteredActs = filterActivities({ days: settings.defaultPeriod });
  renderActivities(App.filteredActs);
}

function switchView(view) {
  App.currentView = view;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`)?.classList.add('active');

  if (view === 'table') {
    document.getElementById('activitiesTableView').style.display = '';
    document.getElementById('activitiesTimelineView').style.display = 'none';
  } else {
    document.getElementById('activitiesTableView').style.display = 'none';
    document.getElementById('activitiesTimelineView').style.display = '';
    renderTimelineView(App.filteredActs);
  }
}

/**
 * Génère le tableau HTML des activités.
 * @param {Activity[]} activities
 */
function renderActivities(activities) {
  const container = document.getElementById('activitiesTableContainer');
  if (!container) return;

  if (!activities || activities.length === 0) {
    container.innerHTML = `
      <div class="empty-state large">
        <svg viewBox="0 0 64 64" fill="none" width="56"><rect x="8" y="14" width="48" height="36" rx="4" stroke="currentColor" stroke-width="2"/><line x1="8" y1="24" x2="56" y2="24" stroke="currentColor" stroke-width="2"/></svg>
        <p>Aucune activité pour cette période et ces filtres.</p>
        <button class="btn btn-primary" onclick="handleLoadMock().then(()=>navigateTo('activities'))">Charger données démo</button>
      </div>`;
    return;
  }

  // Calcul des totaux par type
  const totals = { driving: 0, work: 0, availability: 0, rest: 0 };
  activities.forEach(a => {
    const min = Math.round((new Date(a.end) - new Date(a.start)) / 60000);
    if (totals[a.type] !== undefined) totals[a.type] += min;
  });

  let html = `
    <div style="display:flex;gap:.75rem;flex-wrap:wrap;padding:.9rem 1rem;border-bottom:1px solid var(--border)">
      <span class="activity-pill driving">Conduite : ${formatDuration(totals.driving)}</span>
      <span class="activity-pill work">Travail : ${formatDuration(totals.work)}</span>
      <span class="activity-pill availability">Dispo : ${formatDuration(totals.availability)}</span>
      <span class="activity-pill rest">Repos : ${formatDuration(totals.rest)}</span>
      <span style="margin-left:auto;font-size:.75rem;color:var(--text-muted);align-self:center">${activities.length} enregistrements</span>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Date début</th>
          <th>Date fin</th>
          <th>Durée</th>
          <th>Type</th>
          <th>Véhicule</th>
          <th>Pays</th>
          <th>Lieu</th>
        </tr>
      </thead>
      <tbody>`;

  for (const act of activities) {
    const durMin = Math.round((new Date(act.end) - new Date(act.start)) / 60000);
    html += `
      <tr>
        <td class="mono">${escHtml(formatDate(act.start))}</td>
        <td class="mono">${escHtml(formatDate(act.end))}</td>
        <td class="mono">${formatDuration(durMin)}</td>
        <td><span class="activity-pill ${escHtml(act.type)}">${ACTIVITY_LABELS[act.type] || act.type}</span></td>
        <td class="mono">${escHtml(act.vehicule || '—')}</td>
        <td style="font-size:.72rem">${escHtml(act.pays || '—')}</td>
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(act.lieu || '—')}</td>
      </tr>`;
  }

  html += `</tbody></table>`;
  container.innerHTML = html;

  // Si la vue timeline est active, la mettre à jour aussi
  if (App.currentView === 'timeline') renderTimelineView(activities);
}

/**
 * Vue chronologique par jour avec barres de couleur proportionnelles.
 * @param {Activity[]} activities
 */
function renderTimelineView(activities) {
  const container = document.getElementById('timelineContainer');
  if (!container) return;

  if (!activities || activities.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Aucune activité à afficher</p></div>';
    return;
  }

  // Regrouper par jour
  const byDay = {};
  activities.forEach(a => {
    const key = new Date(a.start).toISOString().slice(0, 10);
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(a);
  });

  const days = Object.keys(byDay).sort();
  const DAY_START = 4;   // 04:00 début journée affichée
  const DAY_END   = 24;  // minuit
  const TOTAL_MIN = (DAY_END - DAY_START) * 60;

  let html = '';
  for (const day of days) {
    const dayActs = byDay[day];
    const label   = new Date(day).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });

    let bars = '';
    for (const act of dayActs) {
      const start   = new Date(act.start);
      const end     = new Date(act.end);
      const startH  = start.getHours() + start.getMinutes() / 60;
      const endH    = Math.min(end.getHours() + end.getMinutes() / 60, DAY_END);
      const leftPct = Math.max(0, ((startH - DAY_START) / (DAY_END - DAY_START)) * 100);
      const widthPct= Math.max(0.3, ((Math.min(endH, DAY_END) - Math.max(startH, DAY_START)) / (DAY_END - DAY_START)) * 100);
      const durMin  = Math.round((end - start) / 60000);
      const tip     = `${ACTIVITY_LABELS[act.type] || act.type} — ${formatDate(start)} → ${formatDate(end)} (${formatDuration(durMin)})`;

      bars += `<div class="timeline-bar-seg ${escHtml(act.type)}" style="left:${leftPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%" title="${escHtml(tip)}"></div>`;
    }

    // Légende horaire (toutes les 4h)
    let ticks = '';
    for (let h = DAY_START; h <= DAY_END; h += 4) {
      const pct = ((h - DAY_START) / (DAY_END - DAY_START)) * 100;
      ticks += `<div style="position:absolute;left:${pct.toFixed(1)}%;bottom:-16px;font-size:.6rem;color:var(--text-muted);transform:translateX(-50%)">${String(h % 24).padStart(2,'0')}h</div>`;
    }

    html += `
      <div class="timeline-day">
        <div class="timeline-day-label">${escHtml(label)}</div>
        <div class="timeline-day-bars">
          <div class="timeline-bar-row" style="position:relative">${bars}${ticks}</div>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

/* ============================================================
   RENDU — CONDUCTEURS
   ============================================================ */

function initDriversPage() {
  document.getElementById('addDriverManualBtn')?.addEventListener('click', openDriverModal);
  document.getElementById('closeDriverModal')?.addEventListener('click', closeDriverModal);
  document.getElementById('cancelDriverModal')?.addEventListener('click', closeDriverModal);
  document.getElementById('saveDriverBtn')?.addEventListener('click', saveDriverForm);

  // Fermer le modal en cliquant à l'extérieur
  document.getElementById('driverModal')?.addEventListener('click', e => {
    if (e.target.id === 'driverModal') closeDriverModal();
  });
}

function renderDriversList() {
  const container = document.getElementById('driversContainer');
  if (!container) return;

  const drivers      = getDrivers();
  const activeDriver = getActiveDriver();

  if (drivers.length === 0) {
    container.innerHTML = `
      <div class="empty-state large">
        <svg viewBox="0 0 64 64" fill="none" width="56"><circle cx="32" cy="22" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 58c0-11.046 8.954-20 20-20s20 8.954 20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <p>Aucun conducteur enregistré</p>
        <button class="btn btn-primary" onclick="openDriverModal()">Ajouter manuellement</button>
      </div>`;
    return;
  }

  const isActive = d => activeDriver && d.id === activeDriver.id;

  let html = `
    <div style="padding:.7rem 1rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:.8rem;font-weight:600">${drivers.length} conducteur${drivers.length > 1 ? 's' : ''}</span>
      <button class="btn btn-sm btn-outline" onclick="openDriverModal()">+ Ajouter</button>
    </div>`;

  for (const d of drivers) {
    const initials = `${(d.prenom || '?')[0]}${(d.nom || '?')[0]}`.toUpperCase();
    const active   = isActive(d);
    const expiry   = d.dateExpiration ? formatDate(new Date(d.dateExpiration), false) : '—';
    const expired  = d.dateExpiration && new Date(d.dateExpiration) < new Date();

    html += `
      <div class="driver-card" style="${active ? 'background:var(--accent-light);' : ''}">
        <div class="driver-avatar" style="${active ? 'background:var(--accent);color:white' : ''}">${escHtml(initials)}</div>
        <div class="driver-info">
          <div class="driver-name">${escHtml(d.prenom)} ${escHtml(d.nom)} ${active ? '<span class="tag success" style="font-size:.65rem">Actif</span>' : ''}</div>
          <div class="driver-meta">${escHtml(d.numeroCarte || '—')} · Exp. : ${expiry}${expired ? ' ⚠' : ''}</div>
          <div class="driver-meta" style="margin-top:2px">${escHtml(d.entreprise || '—')}</div>
        </div>
        <div class="driver-actions">
          ${!active ? `<button class="btn btn-sm btn-outline" onclick="selectDriver('${escHtml(d.id)}')">Sélectionner</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="deleteDriver('${escHtml(d.id)}')" title="Supprimer">
            <svg viewBox="0 0 16 16" fill="none" width="12"><path d="M3 4h10M6 4V2h4v2M5 7l.5 7h5L11 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>`;
  }

  container.innerHTML = html;
}

function openDriverModal(driverId = null) {
  document.getElementById('driverModal').style.display = 'flex';
  if (driverId) {
    const driver = getDrivers().find(d => d.id === driverId);
    if (driver) {
      document.getElementById('driverLastname').value    = driver.nom || '';
      document.getElementById('driverFirstname').value  = driver.prenom || '';
      document.getElementById('driverCardNumber').value = driver.numeroCarte || '';
      document.getElementById('driverExpiry').value     = driver.dateExpiration || '';
      document.getElementById('driverCompany').value    = driver.entreprise || '';
    }
  }
}

function closeDriverModal() {
  document.getElementById('driverModal').style.display = 'none';
  ['driverLastname','driverFirstname','driverCardNumber','driverExpiry','driverCompany'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function saveDriverForm() {
  const nom       = document.getElementById('driverLastname')?.value.trim();
  const prenom    = document.getElementById('driverFirstname')?.value.trim();
  const carte     = document.getElementById('driverCardNumber')?.value.trim();
  const expiry    = document.getElementById('driverExpiry')?.value;
  const company   = document.getElementById('driverCompany')?.value.trim();

  if (!nom || !prenom) {
    showNotification('warn', 'Formulaire', 'Veuillez saisir au moins le nom et le prénom.');
    return;
  }

  const driver = addOrUpdateDriver({
    nom, prenom,
    numeroCarte:    carte,
    dateExpiration: expiry,
    entreprise:     company,
    pays:           'FR'
  });

  closeDriverModal();
  renderDriversList();
  showNotification('success', 'Conducteur', `${prenom} ${nom} enregistré.`);
}

function selectDriver(id) {
  setActiveDriver(id);
  renderDriversList();
  updateActiveDriverBadge();
  renderActiveDriverInfo();
  showNotification('success', 'Conducteur', 'Conducteur actif mis à jour.');
}

function deleteDriver(id) {
  if (!confirm('Supprimer ce conducteur ? Ses activités ne seront pas supprimées.')) return;
  removeDriver(id);
  renderDriversList();
  updateActiveDriverBadge();
}

/* ============================================================
   RENDU — SALAIRE
   ============================================================ */

function initSalaryPage() {
  // Pré-remplir avec la config sauvegardée
  const config = getSalaryConfig();
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('salaryRate',         config.rate);
  setVal('salaryOt1',          config.ot1Percent);
  setVal('salaryOt2',          config.ot2Percent);
  setVal('salaryOtThreshold1', config.ot1Threshold);
  setVal('salaryOtThreshold2', config.ot2Threshold);
  setVal('salaryNight',        config.nightBonus);
  setVal('salarySunday',       config.sundayBonus);
  setVal('salaryHoliday',      config.holidayBonus);

  document.getElementById('computeSalaryBtn')?.addEventListener('click', () => {
    const config = readSalaryConfig();
    saveSalaryConfig(config);
    const acts = App.filteredActs.length > 0 ? App.filteredActs : filterActivities({ days: getSettings().defaultPeriod });
    App.salarySummary = computeSalary(acts, config);
    renderSalarySummary(App.salarySummary, config);
    showNotification('success', 'Salaire', 'Calcul effectué.');
  });
}

/** Lit la configuration salariale depuis les champs du formulaire. */
function readSalaryConfig() {
  return {
    rate:          parseFloat(document.getElementById('salaryRate')?.value)         || 13.50,
    ot1Percent:    parseFloat(document.getElementById('salaryOt1')?.value)          || 25,
    ot2Percent:    parseFloat(document.getElementById('salaryOt2')?.value)          || 50,
    ot1Threshold:  parseFloat(document.getElementById('salaryOtThreshold1')?.value) || 151.67,
    ot2Threshold:  parseFloat(document.getElementById('salaryOtThreshold2')?.value) || 200,
    nightBonus:    parseFloat(document.getElementById('salaryNight')?.value)        || 2.50,
    sundayBonus:   parseFloat(document.getElementById('salarySunday')?.value)       || 3.00,
    holidayBonus:  parseFloat(document.getElementById('salaryHoliday')?.value)     || 5.00,
    nightStart:    parseInt((document.getElementById('salaryNightStart')?.value || '21:00').split(':')[0], 10) || 21,
    nightEnd:      parseInt((document.getElementById('salaryNightEnd')?.value   || '06:00').split(':')[0], 10) || 6
  };
}

/* ============================================================
   RENDU — EXPORT
   ============================================================ */

function initExportPage() {
  document.getElementById('exportActivitiesBtn')?.addEventListener('click', () => {
    exportActivitiesToCSV(App.filteredActs);
  });
  document.getElementById('exportInfractionsBtn')?.addEventListener('click', () => {
    exportInfractionsToCSV(App.infractions);
  });
  document.getElementById('exportSalaryBtn')?.addEventListener('click', () => {
    if (!App.salarySummary) {
      showNotification('warn', 'Export', 'Calculez d\'abord le salaire dans l\'onglet Salaire.');
      return;
    }
    exportSalaryToCSV(App.salarySummary, readSalaryConfig());
  });
  document.getElementById('printReportBtn')?.addEventListener('click', () => printReport());

  // ── Amplitudes journalières ──
  document.getElementById('exportAmplitudesCSVBtn')?.addEventListener('click', () => {
    // Lire le seuil de pause méridienne sélectionné dans le select
    const minBreak = parseInt(document.getElementById('lunchBreakMin')?.value || '30', 10);
    exportAmplitudesToCSV(App.filteredActs, minBreak);
  });
  document.getElementById('exportAmplitudesJSONBtn')?.addEventListener('click', () => {
    const minBreak = parseInt(document.getElementById('lunchBreakMin')?.value || '30', 10);
    exportAmplitudesToJSON(App.filteredActs, minBreak);
  });
}

/* ============================================================
   PARAMÈTRES
   ============================================================ */

function initSettings() {
  const settings = getSettings();
  if (settings.theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    const toggle = document.getElementById('darkModeToggle');
    if (toggle) toggle.checked = true;
  }
}

function initSettingsPage() {
  const settings = getSettings();

  // Pré-remplir les champs
  const fields = {
    defaultPeriod:    settings.defaultPeriod,
    dateFormat:       settings.dateFormat,
    regulationSelect: settings.regulation,
    maxDailyDrive:    settings.maxDailyDrive,
    maxWeeklyDrive:   settings.maxWeeklyDrive,
    breakAfter:       settings.breakAfter,
    minBreakDuration: settings.minBreakDuration,
    minDailyRest:     settings.minDailyRest,
    minWeeklyRest:    settings.minWeeklyRest
  };

  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val !== null && val !== undefined) el.value = val;
  });

  // Thème sombre
  const darkToggle = document.getElementById('darkModeToggle');
  if (darkToggle) darkToggle.checked = settings.theme === 'dark';

  // Toggle thème
  document.getElementById('darkModeToggle')?.addEventListener('change', e => {
    const theme = e.target.checked ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    const s = getSettings();
    saveSettings({ ...s, theme });
  });

  // Sauvegarder
  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => {
    const s = {
      theme:            document.documentElement.getAttribute('data-theme') || 'light',
      defaultPeriod:    parseInt(document.getElementById('defaultPeriod')?.value) || 28,
      dateFormat:       document.getElementById('dateFormat')?.value || 'fr',
      regulation:       document.getElementById('regulationSelect')?.value || 'CE561',
      maxDailyDrive:    parseFloat(document.getElementById('maxDailyDrive')?.value) || 9,
      maxWeeklyDrive:   parseFloat(document.getElementById('maxWeeklyDrive')?.value) || 56,
      breakAfter:       parseFloat(document.getElementById('breakAfter')?.value) || 4.5,
      minBreakDuration: parseInt(document.getElementById('minBreakDuration')?.value) || 45,
      minDailyRest:     parseFloat(document.getElementById('minDailyRest')?.value) || 11,
      minWeeklyRest:    parseFloat(document.getElementById('minWeeklyRest')?.value) || 45
    };
    saveSettings(s);
    showNotification('success', 'Paramètres', 'Paramètres sauvegardés.');
    // Relancer l'analyse avec les nouveaux paramètres
    loadAndRender();
  });

  // Effacer les données
  document.getElementById('clearDataBtn')?.addEventListener('click', () => {
    if (!confirm('Effacer TOUTES les données (conducteurs, activités, infractions) ? Cette action est irréversible.')) return;
    clearAllData();
    App.filteredActs  = [];
    App.infractions   = [];
    App.salarySummary = null;
    loadAndRender();
    showNotification('success', 'Données', 'Toutes les données ont été effacées.');
  });

  // Export paramètres JSON
  document.getElementById('exportSettingsBtn')?.addEventListener('click', () => {
    const data = {
      settings:      getSettings(),
      salaryConfig:  getSalaryConfig(),
      drivers:       getDrivers()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `tacho_config_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import paramètres JSON
  document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
    document.getElementById('importSettingsFile')?.click();
  });
  document.getElementById('importSettingsFile')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.settings)     saveSettings(data.settings);
        if (data.salaryConfig) saveSalaryConfig(data.salaryConfig);
        if (data.drivers)      data.drivers.forEach(d => addOrUpdateDriver(d));
        loadAndRender();
        initSettingsPage();
        showNotification('success', 'Import', 'Paramètres importés avec succès.');
      } catch {
        showNotification('error', 'Import', 'Fichier JSON invalide.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

/* ============================================================
   SYSTÈME DE NOTIFICATIONS
   ============================================================ */

/**
 * Affiche une notification temporaire.
 * @param {'success'|'error'|'warn'|'info'} type
 * @param {string} title
 * @param {string} message
 * @param {number} duration - ms avant disparition
 */
function showNotification(type, title, message, duration = 4000) {
  const container = document.getElementById('notifications');
  if (!container) return;

  const icons = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
  const el    = document.createElement('div');
  el.className = `notification ${type}`;
  el.innerHTML = `
    <span class="notification-icon">${icons[type] || 'ℹ'}</span>
    <div class="notification-body">
      <div class="notification-title">${escHtml(title)}</div>
      <div class="notification-msg">${escHtml(message)}</div>
    </div>`;

  container.appendChild(el);

  // Auto-suppression
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(20px)';
    setTimeout(() => el.remove(), 300);
  }, duration);

  // Clic pour fermer
  el.addEventListener('click', () => el.remove());
}

// escHtml() est définie dans data.js (chargé en premier).
