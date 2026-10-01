const API_URL = '/events';
const eventList = document.querySelector('#event-list');
const registrationList = document.querySelector('#registration-list');
const registrationCount = document.querySelector('#registration-count');
const eventForm = document.querySelector('#event-form');
const filterButtons = document.querySelectorAll('.filter-button');
const searchInput = document.querySelector('#event-search');
const sortSelect = document.querySelector('#event-sort');
const eventCount = document.querySelector('#event-count');
const eventDialog = document.querySelector('#event-dialog');
const dialogImage = document.querySelector('#dialog-image');
const dialogCategory = document.querySelector('#dialog-category');
const dialogRegister = document.querySelector('#dialog-register');
const formStatus = document.querySelector('#form-status');
document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await fetch('/logout', { method: 'POST' });
  } catch {
    // Continue clearing the local legacy token and return to the login page.
  }
  localStorage.removeItem('campuspulseToken');
  location.replace('/login.html');
});

localStorage.removeItem('campuspulseToken');
fetch('/me')
  .then((response) => {
    if (!response.ok) throw new Error('Session expired');
    return response.json();
  })
  .then((user) => { document.querySelector('#user-name').textContent = `Hi, ${user.name}`; })
  .catch(() => {
    localStorage.removeItem('campuspulseToken');
    location.replace('/login.html');
  });

let events = [];
let myRegistrations = [];
let activeCategory = 'All';
let activeSort = 'default';
let eventsLoaded = false;
let registrationsLoaded = false;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function parseEventDate(date, time) {
  if (!date) return null;
  const timeValue = String(time || '00:00').trim();
  const twelveHourTime = timeValue.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  let normalizedTime = timeValue;
  if (twelveHourTime) {
    let hour = Number(twelveHourTime[1]) % 12;
    if (twelveHourTime[3].toUpperCase() === 'PM') hour += 12;
    normalizedTime = `${String(hour).padStart(2, '0')}:${twelveHourTime[2]}`;
  }
  const parsed = new Date(`${date}T${normalizedTime}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTime(date, originalTime) {
  if (!originalTime) return '';
  const parsed = parseEventDate(date, originalTime);
  if (!parsed) return String(originalTime);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(parsed);
}

function safeImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function eventMatchesSearch(event, query) {
  if (!query) return true;
  const searchable = [event.title, event.organizer, event.category, event.venue, event.date, event.time]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  return searchable.includes(query);
}

function renderEvents() {
  if (!eventsLoaded) return;

  if (events.length === 0) {
    eventCount.textContent = 'NO MOMENTS YET';
    eventList.innerHTML = '<div class="empty-state"><strong>A little room for something new.</strong>Be the first to share what’s happening on campus.</div>';
    return;
  }

  const query = searchInput.value.trim().toLocaleLowerCase();
  const visibleEvents = events.filter((event) => (
    (activeCategory === 'All' || event.category === activeCategory)
      && eventMatchesSearch(event, query)
  ));
  if (activeSort !== 'default') {
    visibleEvents.sort((a, b) => {
      const aDate = parseEventDate(a.date, a.time)?.getTime() ?? 0;
      const bDate = parseEventDate(b.date, b.time)?.getTime() ?? 0;
      if (activeSort === 'recent') return bDate - aDate;
      const now = Date.now();
      const aUpcoming = aDate >= now;
      const bUpcoming = bDate >= now;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      return aUpcoming ? aDate - bDate : bDate - aDate;
    });
  }

  eventCount.textContent = `${String(visibleEvents.length).padStart(2, '0')} ${visibleEvents.length === 1 ? 'MOMENT' : 'MOMENTS'} / ${String(events.length).padStart(2, '0')} LISTED`;

  if (visibleEvents.length === 0) {
    eventList.innerHTML = '<div class="empty-state"><strong>No moments found.</strong>Try another search or category.</div>';
    return;
  }

  eventList.innerHTML = visibleEvents.map((event, index) => {
    const imageUrl = safeImageUrl(event.image);
    const title = escapeHtml(event.title);
    const organizer = escapeHtml(event.organizer);
    const category = escapeHtml(event.category);
    const venue = escapeHtml(event.venue);
    const eventId = escapeHtml(event.id);
    const parsedDate = parseEventDate(event.date, event.time);
    const day = parsedDate ? new Intl.DateTimeFormat(undefined, { day: '2-digit' }).format(parsedDate) : '—';
    const month = parsedDate ? new Intl.DateTimeFormat(undefined, { month: 'short' }).format(parsedDate) : 'DATE';
    const year = parsedDate ? new Intl.DateTimeFormat(undefined, { year: 'numeric' }).format(parsedDate) : '';
    const displayTime = escapeHtml(formatTime(event.date, event.time));
    const isoDate = escapeHtml(`${event.date || ''}${event.time && /^\d{2}:\d{2}$/.test(event.time) ? `T${event.time}` : ''}`);
    const imageMarkup = imageUrl
      ? `<div class="event-image-wrap"><img class="event-image" src="${escapeHtml(imageUrl)}" alt="${title}" loading="lazy"><span class="image-index">Nº ${String(index + 1).padStart(2, '0')}</span><span class="category-badge">${category}</span></div>`
      : `<div class="event-image-wrap image-placeholder"><span class="image-index">Nº ${String(index + 1).padStart(2, '0')}</span><span class="category-badge">${category}</span></div>`;

    return `
      <article class="event-card" data-event-id="${eventId}" style="animation-delay:${Math.min(index, 5) * 70}ms">
        ${imageMarkup}
        <div class="event-card-body">
          <div class="event-card-top">
            <time class="event-date-block" datetime="${isoDate}"><span class="date-day">${day}</span><span class="date-month">${month}</span><span class="date-year">${year}</span></time>
            ${displayTime ? `<span class="date-time">${displayTime}</span>` : ''}
          </div>
          <h3>${title}</h3>
          <p class="event-organizer">Hosted by ${organizer}</p>
          <div class="event-meta"><span class="venue-mark" aria-hidden="true">⌖</span><span>${venue}</span></div>
          <div class="event-card-actions">
            <button class="details-button" type="button" data-details-id="${eventId}">Details <span aria-hidden="true">↗</span></button>
            <button class="register-button" type="button" data-register-id="${eventId}" ${event.registered ? 'disabled' : ''}>
              <span>${event.registered ? 'Registered' : 'Register'}</span>${event.registered ? '' : '<span aria-hidden="true">&#8599;</span>'}
            </button>
            <button class="delete-button" type="button" data-delete-id="${eventId}" aria-label="Delete ${title}">Remove</button>
          </div>
        </div>
      </article>`;
  }).join('');
}

async function loadEvents() {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error(`Could not load events (${response.status})`);
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('The events response was not a list');
    events = result;
    eventsLoaded = true;
    renderEvents();
  } catch (error) {
    eventCount.textContent = 'CONNECTION INTERRUPTED';
    eventList.innerHTML = `<div class="load-error" role="alert">Events couldn’t load: ${escapeHtml(error.message)}. Please try again shortly.</div>`;
  }
}

function renderMyRegistrations() {
  if (!registrationsLoaded) return;
  registrationCount.textContent = `${String(myRegistrations.length).padStart(2, '0')} REGISTERED`;

  if (!myRegistrations.length) {
    registrationList.innerHTML = '<div class="registration-empty"><p>You haven\'t registered for any events yet.</p><a class="register-button" href="#events">Browse events <span aria-hidden="true">&#8599;</span></a></div>';
    return;
  }

  registrationList.innerHTML = myRegistrations.map((event) => {
    const title = escapeHtml(event.title || 'Untitled event');
    const imageUrl = safeImageUrl(event.image);
    const date = parseEventDate(event.date, event.time);
    const dateText = date
      ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
      : escapeHtml(event.date || 'Date to be announced');
    const timeText = escapeHtml(formatTime(event.date, event.time) || event.time || 'Time to be announced');
    const category = escapeHtml(event.category || 'Event');
    const venue = escapeHtml(event.venue || 'Venue to be announced');
    return `
      <article class="registration-card">
        ${imageUrl
          ? `<img class="registration-image" src="${escapeHtml(imageUrl)}" alt="${title} event" loading="lazy">`
          : '<div class="registration-image registration-image-placeholder" aria-hidden="true"></div>'}
        <div class="registration-card-content">
          <div class="registration-card-labels"><span class="registration-category">${category}</span><span class="registration-status">Registered</span></div>
          <h3>${title}</h3>
          <p class="registration-when">${dateText} <span aria-hidden="true">·</span> ${timeText}</p>
          <p class="registration-venue"><span aria-hidden="true">⌖</span> ${venue}</p>
        </div>
      </article>`;
  }).join('');
}

async function loadMyRegistrations() {
  try {
    const response = await fetch('/my-registrations');
    if (response.status === 401) {
      location.replace('/login.html');
      return;
    }
    if (!response.ok) throw new Error(`Could not load registrations (${response.status})`);
    const result = await response.json();
    if (!Array.isArray(result)) throw new Error('The registrations response was not a list');
    myRegistrations = result;
    registrationsLoaded = true;
    renderMyRegistrations();
  } catch (error) {
    registrationCount.textContent = 'REGISTRATIONS UNAVAILABLE';
    registrationList.innerHTML = `<div class="load-error" role="alert">Registrations couldn’t load: ${escapeHtml(error.message)}.</div>`;
  }
}

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeCategory = button.dataset.category;
    filterButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-pressed', String(selected));
    });
    renderEvents();
  });
});

searchInput.addEventListener('input', renderEvents);
sortSelect.addEventListener('change', () => {
  activeSort = sortSelect.value;
  renderEvents();
});

function openEventDetails(eventId) {
  const selectedEvent = events.find((item) => String(item.id) === eventId);
  if (!selectedEvent) return;
  const parsedDate = parseEventDate(selectedEvent.date, selectedEvent.time);
  const dateText = parsedDate
    ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(parsedDate)
    : (selectedEvent.date || 'Date to be announced');
  const timeText = formatTime(selectedEvent.date, selectedEvent.time);
  const imageUrl = safeImageUrl(selectedEvent.image);
  document.querySelector('#dialog-title').textContent = selectedEvent.title || 'Untitled event';
  document.querySelector('#dialog-organizer').textContent = `Hosted by ${selectedEvent.organizer || 'Campus community'}`;
  document.querySelector('#dialog-date').textContent = timeText ? `${dateText} · ${timeText}` : dateText;
  document.querySelector('#dialog-venue').textContent = selectedEvent.venue || 'Venue to be announced';
  dialogCategory.textContent = selectedEvent.category || 'Event';
  dialogImage.src = imageUrl;
  dialogImage.alt = selectedEvent.title ? `${selectedEvent.title} event` : 'Event image';
  dialogImage.parentElement.hidden = !imageUrl;
  eventDialog.classList.toggle('no-image', !imageUrl);
  dialogRegister.dataset.registerId = String(selectedEvent.id);
  dialogRegister.disabled = Boolean(selectedEvent.registered);
  dialogRegister.innerHTML = selectedEvent.registered ? 'Registered' : 'Register <span aria-hidden="true">&#8599;</span>';
  eventDialog.showModal();
}

async function registerForEvent(eventId, button) {
  if (!eventId || button.disabled) return;
  button.disabled = true;
  try {
    const response = await fetch(`/events/${encodeURIComponent(eventId)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId })
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace('/login.html');
      return;
    }
    if (response.status === 409 && result.registered) {
      const registeredEvent = events.find((item) => String(item.id) === String(eventId));
      if (registeredEvent) {
        registeredEvent.registered = true;
        renderEvents();
        if (eventDialog.open) {
          dialogRegister.disabled = true;
          dialogRegister.textContent = 'Registered';
        }
      }
      await loadMyRegistrations();
      return;
    }
    if (!response.ok) throw new Error(result.error || `Could not register (${response.status})`);

    const registeredEvent = events.find((item) => String(item.id) === String(eventId));
    if (registeredEvent) registeredEvent.registered = true;
    renderEvents();
    if (eventDialog.open) {
      dialogRegister.disabled = true;
      dialogRegister.textContent = 'Registered';
    }
    await loadMyRegistrations();
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
}

document.querySelector('.dialog-close').addEventListener('click', () => eventDialog.close());
eventDialog.addEventListener('click', (event) => {
  if (event.target === eventDialog) eventDialog.close();
});
dialogRegister.addEventListener('click', () => {
  registerForEvent(dialogRegister.dataset.registerId, dialogRegister);
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    renderEvents();
    searchInput.blur();
  }
});

eventForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = eventForm.querySelector('[type="submit"]');
  const formData = new FormData(eventForm);
  const payload = {
    title: String(formData.get('title')).trim(),
    organizer: String(formData.get('organizer')).trim(),
    category: String(formData.get('category')),
    date: String(formData.get('date')),
    time: String(formData.get('time')),
    venue: String(formData.get('venue')).trim(),
    link: String(formData.get('registrationLink') || '').trim(),
    image: String(formData.get('image') || '').trim()
  };

  submitButton.disabled = true;
  formStatus.textContent = 'Sharing your event…';
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || `Could not add event (${response.status})`);
    }

    eventForm.reset();
    formStatus.textContent = 'Your event is on the calendar.';
    activeCategory = 'All';
    filterButtons.forEach((button) => {
      const selected = button.dataset.category === 'All';
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    await loadEvents();
  } catch (error) {
    formStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

eventList.addEventListener('click', async (event) => {
  const detailsButton = event.target.closest('[data-details-id]');
  if (detailsButton) {
    openEventDetails(detailsButton.dataset.detailsId);
    return;
  }
  const registerButton = event.target.closest('[data-register-id]');
  if (registerButton) {
    await registerForEvent(registerButton.dataset.registerId, registerButton);
    return;
  }
  const deleteButton = event.target.closest('[data-delete-id]');
  if (!deleteButton) return;

  const eventId = deleteButton.dataset.deleteId;
  deleteButton.disabled = true;
  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || `Could not delete event (${response.status})`);
    }
    events = events.filter((item) => String(item.id) !== eventId);
    renderEvents();
    await loadMyRegistrations();
  } catch (error) {
    deleteButton.disabled = false;
    window.alert(error.message);
  }
});

loadEvents();
loadMyRegistrations();
