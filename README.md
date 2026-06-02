# TachoReader — Logiciel de lecture de carte conducteur

Application web locale de lecture et d'analyse de carte conducteur de chronotachygraphe.  
100 % locale, aucune donnée envoyée vers un serveur, fonctionne hors-ligne.

---

## Démarrage rapide

### Sans serveur (Chrome / Edge)
Ouvrir `index.html` directement dans le navigateur.  
⚠️ WebUSB nécessite HTTPS ou `localhost` — pour un lecteur USB réel, utilisez un petit serveur local.

### Avec serveur local (recommandé pour WebUSB)
```bash
# Python 3
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

---

## Fonctionnalités

| Fonctionnalité | Description |
|---|---|
| 📋 Tableau de bord | Résumé rapide : heures semaine/jour, infractions, conducteur actif |
| 🔌 Lecteur USB | Connexion via WebUSB (Chrome/Edge) + mode démonstration |
| 📊 Activités | Tableau + vue chronologique avec filtres période/type/véhicule |
| ⚠️ Infractions | Détection automatique CE 561/2006 (conduite, pauses, repos) |
| 💰 Salaire | Calcul prévisionnel brut (HS, nuit, dimanche, fériés) |
| 👤 Conducteurs | Gestion multi-conducteurs avec conducteur actif |
| 📁 Export | CSV activités, infractions, salaire + impression PDF |
| ⚙️ Paramètres | Thème clair/sombre, seuils réglementaires, taux salariaux |

---

## Structure des fichiers

```
index.html          — Interface principale (SPA)
styles.css          — Styles (thème clair/sombre, responsive)
js/
  data.js           — Modèle de données, localStorage, données mock
  reader.js         — Gestion lecteur USB WebUSB + simulation
  infractions.js    — Détection infractions CE 561/2006
  salary.js         — Calcul salaire prévisionnel
  export.js         — Export CSV et impression PDF
  main.js           — Logique principale, navigation, rendu
```

---

## Données de test

Cliquer sur **"Charger données démo"** pour charger un jeu de 14 jours avec :
- Conducteur : Sébastien MARTIN
- Véhicules : AB-123-CD, EF-456-GH
- Infractions volontaires : pause courte (J-13), conduite > 9h (J-12)

---

## Lecteur USB réel

Compatible avec les lecteurs CCID standard :
- SCM Microsystems (SCR3310, SCR3500…)
- OmniKey (3021, 3121…)
- Gemalto/Thales (GemPC…)

WebUSB requis → Chrome 61+ ou Edge 79+ en HTTPS/localhost.

**Note** : le parsing du format DDD/TGD (Règlement UE 2016/799 Annexe IC) est un squelette extensible dans `reader.js` → fonctions `parseDriverIdent()` et `parseActivities()`.

---

## Règles d'infractions implémentées (CE 561/2006)

| Code | Article | Description |
|---|---|---|
| `DAILY_DRIVE_MAX` | Art. 6 §1 | Conduite journalière > 10h |
| `DAILY_DRIVE_EXT` | Art. 6 §1 | Conduite journalière > 9h (extension) |
| `BREAK_MISSING` | Art. 7 | Pause < 45 min après 4h30 de conduite |
| `DAILY_REST_INSUFFICIENT` | Art. 8 §1 | Repos journalier < 9h |
| `DAILY_REST_REDUCED` | Art. 8 §2 | Repos journalier réduit (9h–11h) |
| `WEEKLY_REST_MISSING` | Art. 8 §6 | Repos hebdo < 24h |
| `WEEKLY_REST_REDUCED` | Art. 8 §6 | Repos hebdo réduit (24h–45h) |
| `WEEKLY_DRIVE_MAX` | Art. 6 §2 | Conduite hebdo > 56h |

Pour ajouter une règle : créer une fonction `checkXxx(acts, settings)` et l'inscrire dans `RULES_REGISTRY` dans `infractions.js`.

---

## Stockage

Toutes les données sont stockées dans `localStorage` du navigateur sous les clés :
- `tacho_drivers` — conducteurs
- `tacho_activities` — activités
- `tacho_infractions` — infractions détectées
- `tacho_settings` — paramètres
- `tacho_salary_config` — configuration salariale

Paramètres → "Effacer toutes les données" pour tout réinitialiser.

---

## Extension Excel : Releveur

Une nouvelle page dédiée permet d’enregistrer les heures de poste dans un fichier Excel `releveur.xlsx`.

- `releveur.html` : interface web de relevé de carte chauffeur.
- `releveur.css` : styles dédiés pour la page de relevé.
- `releveur.js` : envoi des actions `début`, `pause`, `fin` au serveur.
- `server.js` : backend Node.js qui crée et met à jour `releveur.xlsx`.

### Utilisation
1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Démarrer le serveur :
   ```bash
   npm start
   ```
3. Ouvrir dans le navigateur :
   ```bash
   http://localhost:3000/releveur.html
   ```

### Fonctionnement
- Scanne la carte chauffeur dans le champ prévu.
- Clique sur `Début de poste`, `Pause midi` ou `Fin de poste`.
- Le serveur met à jour `releveur.xlsx` avec les colonnes : Date, Carte chauffeur, Chauffeur, Début poste, Pause midi, Fin poste.

### Remarques
- Le serveur doit être lancé avant d’utiliser `releveur.html`.
- Si ton lecteur de carte fonctionne en mode clavier, il suffit de scanner dans le champ `Carte chauffeur`.
