const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'campuspulseSession';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const EVENT_CATEGORIES = [
  'Fest', 'Workshop', 'Music', 'Dance', 'Anime', 'K-Drama', 'Gaming', 'Technology',
  'Quiz', 'Art & Design', 'Academic', 'Sports', 'Cultural', 'Other', 'Competition'
];
const app = express();
const users = [];
const sessions = new Map();
const eventRegistrations = new Map();
let events = [
  {
    id: 'evt-001', title: 'Creative Coding Workshop', organizer: 'Campus Makers Club', category: 'Workshop',
    date: '2026-10-08', time: '15:00', venue: 'Innovation Lab, Room 204',
    link: '', image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4'
  },
  {
    id: 'evt-002', title: 'Autumn Lights Festival', organizer: 'Student Activities Council', category: 'Fest',
    date: '2026-10-16', time: '18:30', venue: 'Central Quad',
    link: '', image: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87'
  },
  {
    id: 'evt-003', title: 'Campus Startup Challenge', organizer: 'Entrepreneurship Society', category: 'Competition',
    date: '2026-10-22', time: '10:00', venue: 'Business School Auditorium',
    link: '', image: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d'
  },
  {
    id: 'evt-004', title: 'Tensor Trails', organizer: 'IEEE Computer Society', category: 'Workshop',
    date: '2026-10-05', time: '11:00 AM', venue: 'AIML Seminar Hall', link: '#',
    description: 'A workshop focused on math and logic building.', image: 'https://images.unsplash.com/photo-1509228468518-180dd4864904'
  },
  {
    id: 'evt-005', title: 'WEB:RECON', organizer: 'IEEE WIE', category: 'Competition',
    date: '2026-09-25', time: '2:00 PM', venue: 'AIML Seminar Hall', link: '#',
    description: 'A web development coding competition.', image: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4'
  },
  {
    id: 'evt-006', title: 'Pragati', organizer: 'BMSCE Dance Club', category: 'Fest',
    date: '2026-10-20', time: '9:00 AM', venue: 'Main Auditorium', link: '#',
    description: 'A dance event.', image: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad'
  },
  {
    id: 'evt-007', title: 'Anime Cosplay', organizer: 'Campus Anime Club', category: 'Anime',
    date: '2026-10-24', time: '16:00', venue: 'Student Activity Center', link: '', image: '/ani1.jpg'
  },
  {
    id: 'evt-008', title: 'Anime Quiz', organizer: 'Campus Anime Club', category: 'Quiz',
    date: '2026-10-25', time: '14:00', venue: 'Student Activity Center', link: '', image: '/ani2.jpg'
  },
  {
    id: 'evt-009', title: 'K-Drama Quiz', organizer: 'Campus Screen Society', category: 'Quiz',
    date: '2026-10-26', time: '17:00', venue: 'Student Activity Center', link: '', image: '/kd.jpg'
  }
];

function readCookie(req, name) {
  const prefix = `${name}=`;
  const entry = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  if (!entry) return '';
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return '';
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS
  };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

function findSessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return users.find((user) => user.id === session.userId) || null;
}

function requireApiAuth(req, res, next) {
  req.user = findSessionUser(req);
  if (!req.user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  return next();
}

function requirePageAuth(req, res, next) {
  req.user = findSessionUser(req);
  if (!req.user) {
    clearSessionCookie(res);
    return res.redirect(302, '/login.html');
  }
  return next();
}

function validateEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordInputIsValid(value) {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') >= 8
    && Buffer.byteLength(value, 'utf8') <= 72;
}

function normalizeEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const event = {
    title: typeof body.title === 'string' ? body.title.trim() : '',
    organizer: typeof body.organizer === 'string' ? body.organizer.trim() : '',
    category: typeof body.category === 'string' ? body.category : '',
    date: typeof body.date === 'string' ? body.date : '',
    time: typeof body.time === 'string' ? body.time.trim() : '',
    venue: typeof body.venue === 'string' ? body.venue.trim() : '',
    link: typeof (body.link ?? body.registrationLink ?? '') === 'string' ? String(body.link ?? body.registrationLink ?? '').trim() : null,
    image: typeof (body.image ?? '') === 'string' ? String(body.image ?? '').trim() : null,
    description: typeof (body.description ?? '') === 'string' ? String(body.description ?? '').trim() : null
  };
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    && !Number.isNaN(Date.parse(`${event.date}T00:00:00Z`))
    && new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10) === event.date;
  const validTime = /^(?:([01]?\d|2[0-3]):[0-5]\d|(?:0?[1-9]|1[0-2]):[0-5]\d\s?(?:AM|PM))$/i.test(event.time);
  if (!event.title || event.title.length > 160
      || !event.organizer || event.organizer.length > 120
      || !EVENT_CATEGORIES.includes(event.category)
      || !validDate || !validTime
      || !event.venue || event.venue.length > 200
      || event.link === null || event.link.length > 2048
      || event.image === null || event.image.length > 2048
      || event.description === null || event.description.length > 2000) return null;

  for (const [value, allowHash] of [[event.link, true], [event.image, false]]) {
    if (!value || (allowHash && value === '#')) continue;
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) return null;
    } catch {
      return null;
    }
  }
  return event;
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  return next();
});
app.use(express.json({ limit: '32kb', strict: true }));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

for (const imageName of ['ani1.jpg', 'ani2.jpg', 'kd.jpg']) {
  app.get(`/${imageName}`, (req, res, next) => {
    res.sendFile(path.join(__dirname, imageName), (error) => {
      if (error) next(error);
    });
  });
}

app.post('/signup', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)
      || !validateEmail(email) || !passwordInputIsValid(password)) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password between 8 and 72 bytes' });
  }

  if (users.some((user) => user.email === email)) {
    return res.status(409).json({ error: 'An account with that email already exists' });
  }
  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS)
  };
  users.push(user);
  return res.status(201).json({ message: 'Account created', user: { name: user.name, email: user.email } });
});

app.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!validateEmail(email) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Enter a valid email and password' });
  }
  const user = users.find((item) => item.email === email);
  if (!user) return res.status(401).json({ error: 'Email or password is incorrect' });

  if (!await bcrypt.compare(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }

  for (const [token, session] of sessions) {
    if (session.expiresAt <= Date.now()) sessions.delete(token);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_DURATION_MS });
  setSessionCookie(res, token);
  return res.json({ user: { name: user.name, email: user.email } });
});

app.get('/me', requireApiAuth, (req, res) => res.json({ name: req.user.name, email: req.user.email }));

app.post('/logout', (req, res) => {
  sessions.delete(readCookie(req, SESSION_COOKIE));
  clearSessionCookie(res);
  return res.json({ message: 'Logged out' });
});

app.get('/events', requireApiAuth, (req, res) => {
  return res.json(events.map((event) => ({
    ...event,
    registered: eventRegistrations.get(event.id)?.has(req.user.id) || false
  })));
});

app.get('/my-registrations', requireApiAuth, (req, res) => {
  const registeredIds = new Set();
  for (const [eventId, userIds] of eventRegistrations) {
    if (userIds.has(req.user.id)) registeredIds.add(eventId);
  }
  const userRegistrations = events
    .filter((event) => registeredIds.has(event.id))
    .map((event) => ({ ...event, registered: true }));
  return res.json(userRegistrations);
});

app.post('/events', requireApiAuth, (req, res) => {
  const event = normalizeEvent(req.body);
  if (!event) return res.status(400).json({ error: 'Enter valid event details for every required field' });
  const createdEvent = { id: crypto.randomUUID(), ...event };
  events.push(createdEvent);
  return res.status(201).json(createdEvent);
});

app.post('/events/:id/register', requireApiAuth, (req, res) => {
  const eventId = req.params.id;
  if (req.body?.eventId !== eventId) {
    return res.status(400).json({ error: 'Event ID is required' });
  }
  if (!events.some((event) => event.id === eventId)) {
    return res.status(404).json({ error: 'Event not found' });
  }

  let registeredUsers = eventRegistrations.get(eventId);
  if (!registeredUsers) {
    registeredUsers = new Set();
    eventRegistrations.set(eventId, registeredUsers);
  }
  if (registeredUsers.has(req.user.id)) {
    return res.status(409).json({ error: 'You are already registered for this event', registered: true });
  }

  registeredUsers.add(req.user.id);
  return res.status(201).json({ message: 'Registration successful', eventId, registered: true });
});

app.delete('/events/:id', requireApiAuth, (req, res) => {
  const originalLength = events.length;
  events = events.filter((event) => event.id !== req.params.id);
  if (events.length === originalLength) return res.status(404).json({ error: 'Event not found' });
  eventRegistrations.delete(req.params.id);
  return res.json({ message: 'Event deleted' });
});

app.get('/', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.parse.failed' || error.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (error.status === 413) return res.status(413).json({ error: 'Request body is too large' });
  console.error('Request failed:', error.message);
  return res.status(500).json({ error: 'Internal server error' });
});

function start() {
  const sessionCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
  }, 60 * 60 * 1000);
  sessionCleanupTimer.unref();
  const server = app.listen(PORT, () => {
    console.log(`CampusPulse server running at http://localhost:${PORT}`);
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to an available port.`);
    } else {
      console.error('Unable to start CampusPulse server:', error.message);
    }
    process.exitCode = 1;
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(async () => {
        clearInterval(sessionCleanupTimer);
        console.log('CampusPulse server stopped.');
        process.exit(0);
      });
    });
  }
}

start();
