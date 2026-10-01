require('dotenv').config({ quiet: true });

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { runMigrations } = require('./scripts/migrate');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'campuspulseSession';
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 12;
const app = express();

function validateEnvironment() {
  const missing = ['DATABASE_URL', 'SESSION_SECRET'].filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Set them in .env for local development or in your deployment environment.`);
  }
  if (Buffer.byteLength(process.env.SESSION_SECRET, 'utf8') < 32) {
    throw new Error('SESSION_SECRET must be at least 32 bytes. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
  }
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error('PORT must be a valid TCP port between 1 and 65535.');
  }
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signToken(token) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(token).digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

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
  res.cookie(SESSION_COOKIE, `${token}.${signToken(token)}`, cookieOptions());
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

async function findSessionUser(req) {
  const cookieValue = readCookie(req, SESSION_COOKIE);
  const separator = cookieValue.lastIndexOf('.');
  if (separator < 1) return null;
  const token = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!/^[a-f0-9]{64}$/.test(token) || !safeEqual(signature, signToken(token))) return null;

  const result = await pool.query(
    `SELECT users.id, users.name, users.email
       FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1 AND sessions.expires_at > now()`,
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

async function requireApiAuth(req, res, next) {
  try {
    req.user = await findSessionUser(req);
    if (!req.user) {
      clearSessionCookie(res);
      return res.status(401).json({ error: 'Invalid or expired session' });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requirePageAuth(req, res, next) {
  try {
    req.user = await findSessionUser(req);
    if (!req.user) {
      clearSessionCookie(res);
      return res.redirect(302, '/login.html');
    }
    return next();
  } catch (error) {
    return next(error);
  }
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
      || !['Workshop', 'Fest', 'Competition'].includes(event.category)
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

function eventResponse(row) {
  return {
    id: row.id,
    title: row.title,
    organizer: row.organizer,
    category: row.category,
    date: row.date,
    time: row.time,
    venue: row.venue,
    link: row.link,
    image: row.image,
    ...(row.description ? { description: row.description } : {})
  };
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  return next();
});
app.use(express.json({ limit: '32kb', strict: true }));

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ status: 'ok' });
  } catch {
    return res.status(503).json({ status: 'unavailable' });
  }
});

app.post('/signup', async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)
      || !validateEmail(email) || !passwordInputIsValid(password)) {
    return res.status(400).json({ error: 'Enter a name, valid email, and password between 8 and 72 bytes' });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const result = await pool.query(
      'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING name, email',
      [crypto.randomUUID(), name, email, passwordHash]
    );
    return res.status(201).json({ message: 'Account created', user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with that email already exists' });
    throw error;
  }
});

app.post('/login', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!validateEmail(email) || typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Enter a valid email and password' });
  }
  const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: 'Email or password is incorrect' });

  let passwordMatches = false;
  if (/^\$2[aby]\$/.test(user.password_hash)) {
    passwordMatches = await bcrypt.compare(password, user.password_hash);
  } else if (/^[a-f0-9]{64}$/i.test(user.password_hash)) {
    const legacyHash = Buffer.from(user.password_hash, 'hex');
    const candidateHash = crypto.createHash('sha256').update(password).digest();
    passwordMatches = legacyHash.length === candidateHash.length && crypto.timingSafeEqual(legacyHash, candidateHash);
    if (passwordMatches) {
      const upgradedHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [upgradedHash, user.id]);
    }
  }
  if (!passwordMatches) return res.status(401).json({ error: 'Email or password is incorrect' });

  await pool.query('DELETE FROM sessions WHERE expires_at <= now()');
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), user.id, expiresAt]
  );
  setSessionCookie(res, token);
  return res.json({ user: { name: user.name, email: user.email } });
});

app.get('/me', requireApiAuth, (req, res) => res.json({ name: req.user.name, email: req.user.email }));

app.post('/logout', async (req, res, next) => {
  try {
    const cookieValue = readCookie(req, SESSION_COOKIE);
    const separator = cookieValue.lastIndexOf('.');
    if (separator > 0) {
      const token = cookieValue.slice(0, separator);
      const signature = cookieValue.slice(separator + 1);
      if (/^[a-f0-9]{64}$/.test(token) && safeEqual(signature, signToken(token))) {
        await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
      }
    }
    clearSessionCookie(res);
    return res.json({ message: 'Logged out' });
  } catch (error) {
    return next(error);
  }
});

app.get('/events', async (req, res) => {
  const result = await pool.query(
    `SELECT id, title, organizer, category, to_char(event_date, 'YYYY-MM-DD') AS date, time, venue, link, image, description
       FROM events ORDER BY created_at, id`
  );
  return res.json(result.rows.map(eventResponse));
});

app.post('/events', requireApiAuth, async (req, res) => {
  const event = normalizeEvent(req.body);
  if (!event) return res.status(400).json({ error: 'Enter valid event details for every required field' });
  const result = await pool.query(
    `INSERT INTO events (id, title, organizer, category, event_date, time, venue, link, image, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, title, organizer, category, to_char(event_date, 'YYYY-MM-DD') AS date, time, venue, link, image, description`,
    [crypto.randomUUID(), event.title, event.organizer, event.category, event.date, event.time, event.venue, event.link, event.image, event.description]
  );
  return res.status(201).json(eventResponse(result.rows[0]));
});

app.delete('/events/:id', requireApiAuth, async (req, res) => {
  const result = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Event not found' });
  return res.json({ message: 'Event deleted' });
});

app.get('/', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/index.html', requirePageAuth, (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.code === '23505') return res.status(409).json({ error: 'A record with that value already exists' });
  if (error.type === 'entity.parse.failed' || error.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (error.status === 413) return res.status(413).json({ error: 'Request body is too large' });
  console.error('Request failed:', error.message);
  return res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  validateEnvironment();
  await pool.query('SELECT 1');
  await runMigrations(pool);
  const sessionCleanupTimer = setInterval(() => {
    pool.query('DELETE FROM sessions WHERE expires_at <= now()')
      .catch((error) => console.error('Session cleanup failed:', error.message));
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
    pool.end().finally(() => process.exit());
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      server.close(async () => {
        clearInterval(sessionCleanupTimer);
        await pool.end();
        console.log('CampusPulse server stopped.');
        process.exit(0);
      });
    });
  }
}

start().catch(async (error) => {
  console.error(`CampusPulse could not start: ${error.message}`);
  await pool.end();
  process.exitCode = 1;
});
