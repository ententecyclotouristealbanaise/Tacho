const menuToggle = document.querySelector('.menu-toggle');
const mainNav = document.querySelector('.main-nav');

if (menuToggle && mainNav) {
  menuToggle.addEventListener('click', () => {
    mainNav.classList.toggle('active');
    menuToggle.setAttribute(
      'aria-label',
      mainNav.classList.contains('active') ? 'Fermer le menu' : 'Ouvrir le menu'
    );
  });
}

const links = document.querySelectorAll('a[href^="#"]');
links.forEach((link) => {
  link.addEventListener('click', (event) => {
    const targetId = link.getAttribute('href');
    if (!targetId || targetId === '#') return;
    const target = document.querySelector(targetId);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (mainNav && mainNav.classList.contains('active')) {
      mainNav.classList.remove('active');
      menuToggle.setAttribute('aria-label', 'Ouvrir le menu');
    }
  });
});

const cardInput = document.querySelector('#card-input');
const chauffeurInput = document.querySelector('#chauffeur-input');
const actionButtons = document.querySelectorAll('[data-action]');
const statusMessage = document.querySelector('#status-message');

function setStatus(message, type = 'info') {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = 'status-message ' + type;
}

if (actionButtons.length > 0) {
  actionButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const carte = cardInput?.value.trim();
      const chauffeur = chauffeurInput?.value.trim();
      const action = button.dataset.action;

      if (!carte) {
        setStatus('Veuillez scanner ou saisir la carte chauffeur.', 'error');
        cardInput?.focus();
        return;
      }

      button.disabled = true;
      setStatus('Enregistrement en cours...', 'info');

      try {
        const response = await fetch('/api/releve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ carte, chauffeur, action }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Erreur serveur');
        }

        setStatus(`Enregistré ${action} à ${data.time}.`, 'success');
      } catch (error) {
        setStatus(error.message || 'Impossible d’enregistrer.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

cardInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    chauffeurInput?.focus();
  }
});

cardInput?.focus();
