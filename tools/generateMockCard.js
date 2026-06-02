#!/usr/bin/env node
// tools/generateMockCard.js
// Génère un fichier JSON d'exemple (driver + activities) pour tester l'analyse

const fs = require('fs');
const path = require('path');

function d(base, daysAgo, h, m = 0) {
  const dt = new Date(base);
  dt.setDate(dt.getDate() - daysAgo);
  dt.setHours(h, m, 0, 0);
  return dt;
}

function generate(days = 7) {
  const now = new Date();
  now.setHours(0,0,0,0);
  const driver = {
    id: 'DRV_FR001', nom: 'MARTIN', prenom: 'Sébastien', numeroCarte: 'FR1234567890ABCD'
  };
  const activities = [];
  let id = 1;
  for (let day = days; day >= 1; day--) {
    // repos nuit until 6
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'rest', start: d(now, day, 0), end: d(now, day, 6) });
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'work', start: d(now, day, 6), end: d(now, day, 6, 30) });
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'driving', start: d(now, day, 6,30), end: d(now, day, 11) });
    // pause midi 12:00-12:45 (satisfaisant)
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'rest', start: d(now, day, 12), end: d(now, day, 12,45) });
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'driving', start: d(now, day, 12,45), end: d(now, day, 17) });
    activities.push({ id: `ACT_${id++}`, driverId: driver.id, type: 'rest', start: d(now, day, 17), end: d(now, day-1, 6) });
  }
  return { driver, activities };
}

if (require.main === module) {
  const out = path.join(process.cwd(), 'card_data.json');
  const data = generate(14);
  fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log('Fichier généré:', out);
}
