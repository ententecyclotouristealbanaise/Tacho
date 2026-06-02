const cardInput = document.querySelector('#card-input');
const chauffeurInput = document.querySelector('#chauffeur-input');
const actionButtons = document.querySelectorAll('[data-action]');
const statusMessage = document.querySelector('#status-message');

function setStatus(message, type = 'info') {
  if (!statusMessage) return;
  statusMessage.textContent = message;
  statusMessage.className = type === 'info' ? 'status-message' : `status-message ${type}`;
}

actionButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const carte = cardInput.value.trim();
    const chauffeur = chauffeurInput.value.trim();
    const action = button.dataset.action;

    if (!carte) {
      setStatus('Veuillez scanner ou saisir la carte chauffeur.', 'error');
      cardInput.focus();
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

cardInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    chauffeurInput.focus();
  }
});

cardInput.focus();
