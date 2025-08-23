

import express from 'express';
import dotenv from 'dotenv';
// Load .env and set defaults if missing
dotenv.config();
if (!process.env.ADMIN_EMAIL) process.env.ADMIN_EMAIL = 'faiqsajjad652@gmail.com';
if (!process.env.ADMIN_PASSWORD) process.env.ADMIN_PASSWORD = 'faiq1032';
import { db } from './db.js';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { readdir, writeFile } from 'fs/promises';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import cors from 'cors';
import { z } from 'zod';

dotenv.config();


const PORT = process.env.PORT || 3026;
const app = express();

// PayPal defaults - ensure these are defined to avoid runtime ReferenceErrors when env vars are missing
let CLIENT_ID = process.env.PAYPAL_CLIENT_ID || process.env.CLIENT_ID || '';
let CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || process.env.CLIENT_SECRET || '';
const PAYPAL_ENV = process.env.PAYPAL_ENV || 'sandbox';
// BASE is used for PayPal API calls; sandbox by default
const BASE = PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
// PayPal webhook id (optional) - prefer environment variable; DB value may override when admin updates config
let WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID || '';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'damascus-secret', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};



// ...existing code...
app.get('/api/admin/domain-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  await db.read();
  res.json({ domain: db.data.domain || '' });
});

app.post('/api/admin/domain-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { domain } = req.body;
  // Allow empty domain to clear typo
  await db.read();
  db.data.domain = domain || '';
  await db.write();
  res.json({ success: true });
});
// Admin API: get/set sender email config
app.get('/api/admin/email-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  await db.read();
  res.json({ emailUser: db.data.emailUser || EMAIL_USER });
});

app.post('/api/admin/email-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { emailUser, emailPass } = req.body;
  if (!emailUser || !emailPass) return res.status(400).json({ error: 'Email and password required' });
  await db.read();
  db.data.emailUser = emailUser;
  db.data.emailPass = emailPass;
  await db.write();
  res.json({ success: true });
});


// Store PayPal config in DB (admin configurable)
async function getPaypalConfig() {
  await db.read();
  return {
    paypalEmail: db.data.paypalEmail || 'sajjadsagarq8@gmail.com',
    clientId: db.data.paypalClientId || CLIENT_ID,
    clientSecret: db.data.paypalClientSecret || CLIENT_SECRET,
    env: db.data.paypalEnv || PAYPAL_ENV,
    payoutPaypal: db.data.payoutPaypal || '',
    payoutBank: db.data.payoutBank || '',
    payoutCard: db.data.payoutCard || '',
    payoutOption: db.data.payoutOption || 'paypal'
  };
}

// Final error handler: ensure API errors return JSON rather than HTML
app.use((err, req, res, next) => {
  try {
    if (req && req.path && String(req.path).startsWith('/api/')) {
      const code = (err && err.status) ? err.status : 500;
      res.status(code).json({ error: err && (err.message || 'Server error') });
      return;
    }
  } catch (e) { /* ignore */ }
  // fallback to default Express handler
  next(err);
});

async function setPaypalConfig({ paypalEmail, clientId, clientSecret, env, payoutPaypal, payoutBank, payoutCard, payoutOption }) {
  await db.read();
  if (paypalEmail) db.data.paypalEmail = paypalEmail;
  if (clientId) db.data.paypalClientId = clientId;
  if (clientSecret) db.data.paypalClientSecret = clientSecret;
  if (env) db.data.paypalEnv = env;
  if (payoutPaypal !== undefined) db.data.payoutPaypal = payoutPaypal;
  if (payoutBank !== undefined) db.data.payoutBank = payoutBank;
  if (payoutCard !== undefined) db.data.payoutCard = payoutCard;
  if (payoutOption !== undefined) db.data.payoutOption = payoutOption;
  await db.write();
  CLIENT_ID = db.data.paypalClientId || CLIENT_ID;
  CLIENT_SECRET = db.data.paypalClientSecret || CLIENT_SECRET;
}

// Email configuration
const EMAIL_USER = process.env.EMAIL_USER || 'dmdamascusmaster@gmail.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'ckmw cnnk ybxj nqiv';

// Configure nodemailer with better Gmail settings (default)
let transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false, // Use TLS
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
  tls: { rejectUnauthorized: false }
});

// Helper to send email using DB-stored SMTP credentials when present.
// Always return an object { ok: boolean, error?: string }
async function sendEmail({ to, subject, html, text }){
  try {
    await db.read();
    const dbUser = db.data.emailUser || '';
    const dbPass = db.data.emailPass || '';
    // If DB creds differ from current transporter config, recreate transporter
    const currentUser = (transporter && transporter.options && transporter.options.auth && transporter.options.auth.user) ? transporter.options.auth.user : EMAIL_USER;
    const currentPass = (transporter && transporter.options && transporter.options.auth && transporter.options.auth.pass) ? transporter.options.auth.pass : EMAIL_PASS;
    if (dbUser && dbPass && (dbUser !== currentUser || dbPass !== currentPass)) {
      transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: dbUser, pass: dbPass }, tls: { rejectUnauthorized: false } });
    }

    const mailOptions = { from: `"Damascus Master" <${db.data.emailUser || EMAIL_USER}>`, to, subject, html, text };
    const info = await transporter.sendMail(mailOptions);
    return { ok: true, info };
  } catch (e) {
    console.error('sendEmail failed:', e && (e.message || e));
    return { ok: false, error: e && (e.message || String(e)) };
  }
}

// In-memory store for verification codes (in production, use Redis or database)
const verificationCodes = new Map();

// Lightweight in-memory rate limiter (per-IP counters). This is intentionally
// simple: it prevents abusive repeated requests from the same IP. For
// production use, replace with redis or a robust middleware.
const rateLimits = new Map();
function checkRateLimit(ip, limit = 60, windowMs = 60 * 1000) {
  const now = Date.now();
  const entry = rateLimits.get(ip) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  rateLimits.set(ip, entry);
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count), reset: entry.reset };
}

// Optional IP -> geo lookup. Uses ip-api.com (no key) by default. Will not throw on error.
async function lookupIpGeo(ip) {
  try {
    if (!ip) return null;
    // strip IPv6 prefix if present
    ip = String(ip).replace(/^::ffff:/, '');
    // honor env var to disable
    if (String(process.env.DISABLE_IP_GEO || '').toLowerCase() === 'true') return null;
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city,query`);
    const j = await res.json();
    if (j && j.status === 'success') return { country: j.country, region: j.regionName, city: j.city, ip: j.query };
  } catch (e) {
    console.warn('IP geo lookup failed', e && e.message || e);
  }
  return null;
}

// Only apply JSON body parser to non-webhook routes so we can keep raw body for verification
app.use((req, res, next) => {
  if (req.path === '/webhooks/paypal') return next();
  return express.json({ limit: '1mb' })(req, res, next);
});

// CORS for local files and localhost
app.use(cors({ origin: true }));

// Ensure API routes always return JSON for error statuses to avoid HTML responses
app.use((req, res, next) => {
  // Only enforce for API namespace
  if (req.path && req.path.startsWith('/api/')) {
    // Wrap res.status to ensure JSON body on common error codes when no body was written
    const origStatus = res.status.bind(res);
    res.status = function(code) {
      // If caller sets status but later sends without a body, ensure content-type is application/json
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return origStatus(code);
    };
  }
  next();
});



// Validation schemas
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1),
  username: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  country: z.string().optional(),
  logo: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const preferencesSchema = z.object({
  compactLayout: z.boolean().optional(),
  orderEmails: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
  newsletter: z.boolean().optional(),
  twoFactorAuth: z.boolean().optional(),
  loginNotifications: z.boolean().optional(),
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));
// Alias for health checks
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// API health endpoint (used by smoke tests)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || process.env.NODE_ENV || 'sandbox', pid: process.pid, ts: Date.now() });
});

// ========== EMAIL VERIFICATION ENDPOINTS ==========

// Send verification code
app.post('/api/auth/send-code', async (req, res) => {
  try {
    const { email, password: _password } = req.body || {};
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

  // Simple per-IP rate-limit check (soft guard)
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rl = checkRateLimit(clientIp, 30, 60 * 1000); // 30 requests per minute
    if (!rl.ok) return res.status(429).json({ error: 'Too many requests, slow down' });

    // Check if user already exists
    await db.read();
    const existingUser = db.data.users.find(user => user.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }

  // mark potential unused var to satisfy linters when present
  void _password;

    // Prevent re-sending if a valid code already exists for this email
    const emailKey = email.toLowerCase();
    const existingCode = verificationCodes.get(emailKey);
    if (existingCode && Date.now() < existingCode.expires) {
      return res.status(429).json({ error: 'Verification code already sent. Please wait before requesting another.' });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with 10-minute expiration
    verificationCodes.set(emailKey, {
      code,
      expires: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    // Send email
    const mailOptions = {
      from: `"Damascus Master" <${EMAIL_USER}>`,
      to: email,
      subject: 'Verify Your Email - Damascus Master',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #1a1a1a; color: #f5f6fa;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4AF37; margin: 0;">Damascus Master</h1>
            <p style="color: #999; margin: 5px 0;">Premium Damascus Steel Knives</p>
          </div>
          
          <div style="background: #23262f; padding: 30px; border-radius: 10px; text-align: center;">
            <h2 style="color: #D4AF37; margin-bottom: 20px;">Email Verification</h2>
            <p style="margin-bottom: 30px; color: #f5f6fa;">Please use the following code to verify your email address:</p>
            
            <div style="background: #D4AF37; color: #1a1a1a; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
              ${code}
            </div>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              This code will expire in 10 minutes.<br>
              If you didn't request this verification, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
            <p>© 2025 Damascus Master. All rights reserved.</p>
          </div>
        </div>
      `
    };

    try {
      // Send real email with verification code
      console.log(`Sending verification email to: ${email}`);
      const sent = await sendEmail({ to: email, subject: 'Verify Your Email - Damascus Master', html: mailOptions.html });
      if (sent.ok) console.log('✅ Verification email queued/sent'); else console.warn('⚠️ Verification email send failed (non-fatal):', sent.error);

      res.json({ message: 'Verification code sent successfully', email: email });

    } catch (emailError) {
      console.error('❌ Email sending failed during verification flow:', emailError);
      // Persisted code exists; return success to avoid blocking user creation flow
      return res.json({ message: 'Verification code generated (email attempted).' });
    }

  } catch (error) {
    console.error('Send code error:', error);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// Verify code
app.post('/api/auth/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }

    const emailLower = email.toLowerCase();
    const storedData = verificationCodes.get(emailLower);
    
    if (!storedData) {
      return res.status(400).json({ error: 'No verification code found for this email' });
    }

    if (Date.now() > storedData.expires) {
      verificationCodes.delete(emailLower);
      return res.status(400).json({ error: 'Verification code has expired' });
    }

    if (storedData.code !== code.toString()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Code is valid - remove it from store
    verificationCodes.delete(emailLower);

    res.json({ 
      message: 'Email verified successfully',
      verified: true 
    });

  } catch (error) {
    console.error('Verify code error:', error);
    res.status(500).json({ error: 'Failed to verify code' });
  }
});

// ========== USER AUTHENTICATION ENDPOINTS ==========

// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const validatedData = registerSchema.parse(req.body);
  const { email, password, name, username } = validatedData;

    await db.read();
    
    // Normalize and validate username: lowercase, no spaces, only letters/numbers/dot/underscore
    let cleanUsername = (username || name || '').toString().trim().toLowerCase();
    cleanUsername = cleanUsername.replace(/\s+/g, ''); // remove spaces
    if (!/^[a-z0-9._]+$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Username may only contain lowercase letters, numbers, dot and underscore, and no spaces' });
    }

    // Check if user/email/username already exists
    const existingUser = db.data.users.find(user => user.email === email);
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists with this email' });
    }
    const existingUsername = db.data.users.find(user => (user.username||'').toLowerCase() === cleanUsername);
    if (existingUsername) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create new user
  // Record canonical IP if available and initialize knownIps
  const clientIp = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '')?.toString();
  function canonicalIp(ip){ if(!ip) return ''; return String(ip).split(',')[0].trim(); }
  const createdIp = canonicalIp(clientIp) || '';

  const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      name,
      username: cleanUsername,
      phone: '',
      address: '',
      city: '',
      state: '',
      zip: '',
      country: '',
      logo: '',
  preferences: {
  // darkMode removed
        compactLayout: false,
        orderEmails: true,
        marketingEmails: false,
        newsletter: false,
        twoFactorAuth: false,
        loginNotifications: true,
      },
  // Track known IPs (populate created IP at registration)
  knownIps: createdIp ? [createdIp] : [],
      orders: [],
      wishlist: [],
      totalSpent: 0,
      memberSince: new Date().getFullYear(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.data.users.push(newUser);
    await db.write();

    // Generate JWT token
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email },
      process.env.JWT_SECRET || 'damascus-secret',
      { expiresIn: '24h' }
    );

  // Return user data without password
  const userWithoutPassword = Object.assign({}, newUser);
  delete userWithoutPassword.password;
  res.status(201).json({ message: 'User registered successfully', user: userWithoutPassword, token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const validatedData = loginSchema.parse(req.body);
  const { email, password } = validatedData;

    await db.read();
    
    // Find user
    const user = db.data.users.find(user => user.email === email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if 2FA is enabled
    if (user.preferences?.twoFactorAuth) {
      // Generate and send 2FA code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const codeKey = `2fa_${email.toLowerCase()}`;
      
      verificationCodes.set(codeKey, {
        code,
        expires: Date.now() + 10 * 60 * 1000, // 10 minutes
        userId: user.id
      });
      
      // Send 2FA email
      try {
        // Notify user of login attempt (best-effort)
        (async ()=>{
          try {
            const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString();
            const ua = (req.headers['user-agent'] || '').toString();
            const geo = await lookupIpGeo(ip);
            const location = geo ? `${geo.city || ''} ${geo.region || ''} ${geo.country || ''}`.trim() : '';
            const note = `<p><strong>IP:</strong> ${ip}</p><p><strong>Location:</strong> ${location}</p><p><strong>User Agent:</strong> ${ua}</p>`;
            const mailOptionsNotice = { from: `"Damascus Master" <${EMAIL_USER}>`, to: email, subject: 'Login attempt on your account', html: `<div style="font-family: Arial, sans-serif;"><h3>Login attempt detected</h3>${note}<p>If this wasn't you, please secure your account.</p></div>` };
            sendEmail({ to: email, subject: 'Login attempt on your account', html: mailOptionsNotice.html }).then(r=>{ if(!r.ok) console.error('Login attempt notify failed', r.error); }).catch(()=>{});
          } catch(e){}
        })();
        const mailOptions = {
          from: `"Damascus Master Security" <${EMAIL_USER}>`,
          to: email,
          subject: 'Your 2FA Code - Damascus Master',
          html: `
            <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #2c1810 0%, #8b4513 50%, #daa520 100%); color: #f5f5dc; border-radius: 10px; overflow: hidden;">
              <div style="padding: 40px 30px; text-align: center; background: rgba(0,0,0,0.3);">
                <h1 style="color: #daa520; font-size: 28px; margin: 0 0 20px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                  🛡️ Two-Factor Authentication
                </h1>
                
                <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 8px; margin: 20px 0;">
                  <h2 style="color: #f5f5dc; margin: 0 0 15px 0;">Your Login Code</h2>
                  <div style="background: rgba(212,175,55,0.3); padding: 20px; border-radius: 8px; margin: 15px 0;">
                    <h1 style="color: #daa520; font-size: 36px; margin: 0; letter-spacing: 8px; font-family: monospace;">
                      ${code}
                    </h1>
                  </div>
                  <p style="line-height: 1.6; margin: 15px 0; font-size: 14px; color: #ccc;">
                    This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
                  </p>
                </div>
                
                <div style="background: rgba(255,165,0,0.2); padding: 15px; border-radius: 6px; margin: 20px 0;">
                  <p style="margin: 0; font-size: 14px;">
                    ⚠️ <strong>Security Tip:</strong> Never share this code with anyone. Damascus Master will never ask for your 2FA code.
                  </p>
                </div>
              </div>
            </div>
          `
        };
        
  await sendEmail({ to: email, subject: 'Your 2FA Code - Damascus Master', html: mailOptions.html });
        // Also send a lightweight notification about the login attempt (non-blocking)
        (async () => {
          try {
            const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString();
            const ua = (req.headers['user-agent'] || '').toString();
            const notify = {
              from: `"Damascus Master" <${EMAIL_USER}>`,
              to: email,
              subject: 'Login attempt detected',
              html: `<div style="font-family: Arial, sans-serif;"><p>A login attempt triggered a 2FA code for your account.</p><p><strong>IP:</strong> ${ip}</p><p><strong>User Agent:</strong> ${ua}</p></div>`
            };
            sendEmail({ to: email, subject: notify.subject, html: notify.html }).then(()=>{}).catch(()=>{});
          } catch(e){}
        })();
      } catch (emailError) {
        console.error('2FA email failed:', emailError);
        return res.status(500).json({ error: 'Failed to send 2FA code' });
      }
      
      return res.json({
        message: '2FA code sent to your email',
        requires2FA: true,
        email: email
      });
    }

    // No 2FA required, complete login
    user.lastLogin = new Date().toISOString();
    await db.write();

    // Send login notification email only when IP is new (best-effort, non-blocking)
    (async () => {
      try {
        const rawIp = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString();
        const ip = String(rawIp).split(',')[0].trim();
        const ua = (req.headers['user-agent'] || '').toString();

        // Initialize knownIps array if missing
        if (!Array.isArray(user.knownIps)) user.knownIps = [];
        const knownLower = user.knownIps.map(i => String(i || '').trim()).filter(Boolean);
        if (!knownLower.includes(ip)) {
          // New IP: send notification and add to knownIps
          const mailOptions = {
            from: `"Damascus Master" <${EMAIL_USER}>`,
            to: user.email,
            subject: 'New login to your Damascus Master account',
            html: `
              <div style="font-family: Arial, sans-serif;">
                <h2>New login to your account</h2>
                <p>We detected a login to your account from a new IP address.</p>
                <p><strong>IP:</strong> ${ip}</p>
                <p><strong>User Agent:</strong> ${ua}</p>
                <p>If this wasn't you, please change your password immediately.</p>
              </div>
            `
          };
          sendEmail({ to: user.email, subject: 'New login to your Damascus Master account', html: mailOptions.html }).then(r=>{ if(!r.ok) console.error('Login notification failed', r.error); }).catch(()=>{});
          try { user.knownIps.push(ip); await db.write(); } catch(e){ console.warn('Failed to persist known IP', e); }
        }
      } catch (e) { console.error('Login notify error', e); }
    })();

    // Generate JWT token
    const token = jwt.sign(
  { userId: user.id, email: user.email, role: user.role || 'user' },
  process.env.JWT_SECRET || 'damascus-secret',
  { expiresIn: '24h' }
    );

  // Return user data without password
  const userWithoutPassword = Object.assign({}, user);
  delete userWithoutPassword.password;
  res.json({ message: 'Login successful', user: userWithoutPassword, token });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    await db.read();
    
    const user = db.data.users.find(user => user.id === req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

  // Return user data without password
  const userWithoutPassword = Object.assign({}, user);
  delete userWithoutPassword.password;
  res.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user profile
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const validatedData = updateProfileSchema.parse(req.body);

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update user data
    const user = db.data.users[userIndex];
    Object.keys(validatedData).forEach(key => {
      if (validatedData[key] !== undefined) {
        user[key] = validatedData[key];
      }
    });
    user.updatedAt = new Date().toISOString();

    await db.write();

  // Return updated user data without password
  const userWithoutPassword2 = Object.assign({}, user);
  delete userWithoutPassword2.password;
  res.json({ message: 'Profile updated successfully', user: userWithoutPassword2 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Change password
app.put('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const validatedData = changePasswordSchema.parse(req.body);
    const { currentPassword, newPassword } = validatedData;

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.data.users[userIndex];

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    
    user.password = hashedNewPassword;
    user.updatedAt = new Date().toISOString();

    await db.write();

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Password change error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password - send reset code
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Soft rate-limit per IP
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rl = checkRateLimit(clientIp, 30, 60 * 1000); // 30 requests per minute
    if (!rl.ok) return res.status(429).json({ error: 'Too many requests, slow down' });

    await db.read();
    
    const user = db.data.users.find(user => user.email === email.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'No account found with this email address' });
    }

    // Prevent re-sending if a valid reset code already exists
    if (user.resetCode && user.resetCodeExpiry && new Date() < new Date(user.resetCodeExpiry)) {
      return res.status(429).json({ error: 'Reset code already sent. Please wait before requesting another.' });
    }

    // Generate 6-digit reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store reset code in user record
    user.resetCode = resetCode;
    user.resetCodeExpiry = resetCodeExpiry.toISOString();
    user.updatedAt = new Date().toISOString();

    await db.write();

    // Send reset code email
    const mailOptions = {
      from: `"Damascus Master" <${EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Code - Damascus Master',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #1a1a1a; color: #f5f6fa;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #D4AF37; margin: 0;">Damascus Master</h1>
            <p style="color: #999; margin: 5px 0;">Premium Damascus Steel Knives</p>
          </div>
          
          <div style="background: #23262f; padding: 30px; border-radius: 10px; text-align: center;">
            <h2 style="color: #D4AF37; margin-bottom: 20px;">Password Reset</h2>
            <p style="margin-bottom: 30px; color: #f5f6fa;">You requested a password reset. Please use the following code:</p>
            
            <div style="background: #D4AF37; color: #1a1a1a; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: bold; letter-spacing: 4px; margin: 20px 0;">
              ${resetCode}
            </div>
            
            <p style="color: #999; font-size: 14px; margin-top: 30px;">
              This code will expire in 10 minutes.<br>
              If you didn't request a password reset, please ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; color: #666; font-size: 12px;">
            <p>© 2025 Damascus Master. All rights reserved.</p>
          </div>
        </div>
      `
    };

    try {
  console.log(`Sending password reset email to: ${email}`);
  // Use configured sender (db-stored or env fallback)
  await db.read();
  const toEmail = db.data.emailUser || EMAIL_USER;
  const info = await sendEmail({ to: toEmail, subject: mailOptions.subject, html: mailOptions.html });
  console.log(`✅ Password reset email sent successfully`, info && info.info ? info.info.messageId || info.info : info);

      res.json({ 
        message: 'Password reset code sent successfully',
        email: email
      });

    } catch (emailError) {
      console.error('❌ Password reset email sending failed:', emailError);
      
      if (emailError.code === 'EAUTH') {
        console.error('Gmail authentication failed. Check App Password.');
        return res.status(500).json({ 
          error: 'Email authentication failed. Please check Gmail settings.' 
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to send password reset email. Please try again.' 
      });
    }

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password with code
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    
    if (!email || !code || !newPassword) {
      return res.status(400).json({ error: 'Email, code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.email === email.toLowerCase());
    if (userIndex === -1) {
      return res.status(404).json({ error: 'No account found with this email address' });
    }

    const user = db.data.users[userIndex];

    // Check if reset code exists and is valid
    if (!user.resetCode || !user.resetCodeExpiry) {
      return res.status(400).json({ error: 'No password reset request found. Please request a new reset code.' });
    }

    // Check if code matches
    if (user.resetCode !== code) {
      return res.status(400).json({ error: 'Invalid reset code' });
    }

    // Check if code is expired
    if (new Date() > new Date(user.resetCodeExpiry)) {
      return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
    }

    // Hash new password
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);
    
    // Update password and clear reset code
    user.password = hashedNewPassword;
    user.resetCode = undefined;
    user.resetCodeExpiry = undefined;
    user.updatedAt = new Date().toISOString();

    await db.write();

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update user preferences
app.put('/api/auth/preferences', authenticateToken, async (req, res) => {
  try {
    const validatedData = preferencesSchema.parse(req.body);

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.data.users[userIndex];
    
    // Update preferences
    user.preferences = { ...user.preferences, ...validatedData };
    user.updatedAt = new Date().toISOString();

    await db.write();

    res.json({
      message: 'Preferences updated successfully',
      preferences: user.preferences
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    console.error('Preferences update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== WISHLIST ENDPOINTS ==========

// Get user wishlist
app.get('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    await db.read();
    
    const user = db.data.users.find(user => user.id === req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ wishlist: user.wishlist || [] });
  } catch (error) {
    console.error('Wishlist fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add item to wishlist
app.post('/api/wishlist', authenticateToken, async (req, res) => {
  try {
    const { productId, title, price, img, album } = req.body;

    if (!productId || !title) {
      return res.status(400).json({ error: 'Product ID and title are required' });
    }

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.data.users[userIndex];
    
    // Check if item already in wishlist
    const existingItem = user.wishlist.find(item => item.id === productId);
    if (existingItem) {
      return res.status(409).json({ error: 'Item already in wishlist' });
    }

    // Add to wishlist
    const wishlistItem = {
      id: productId,
      title,
      price,
      img,
      album,
      addedAt: new Date().toISOString()
    };

    user.wishlist.push(wishlistItem);
    user.updatedAt = new Date().toISOString();

    await db.write();

    res.status(201).json({
      message: 'Item added to wishlist',
      wishlist: user.wishlist
    });
  } catch (error) {
    console.error('Wishlist add error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove item from wishlist
app.delete('/api/wishlist/:productId', authenticateToken, async (req, res) => {
  try {
    const { productId } = req.params;

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.data.users[userIndex];
    
    // Remove from wishlist
    user.wishlist = user.wishlist.filter(item => item.id !== productId);
    user.updatedAt = new Date().toISOString();

    await db.write();

    res.json({
      message: 'Item removed from wishlist',
      wishlist: user.wishlist
    });
  } catch (error) {
    console.error('Wishlist remove error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== ORDER MANAGEMENT ==========

// Get user orders
app.get('/api/user/orders', authenticateToken, async (req, res) => {
  try {
    await db.read();
    
    const user = db.data.users.find(user => user.id === req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ orders: user.orders || [] });
  } catch (error) {
    console.error('Orders fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add order to user history (called after successful payment)
app.post('/api/user/orders', authenticateToken, async (req, res) => {
  try {
    const { orderId, items, total, status = 'completed' } = req.body;

    if (!orderId || !items || !total) {
      return res.status(400).json({ error: 'Order ID, items, and total are required' });
    }

    await db.read();
    
    const userIndex = db.data.users.findIndex(user => user.id === req.user.userId);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = db.data.users[userIndex];

    // Add order to history
    const order = {
      id: orderId,
      items,
      total: Number(total),
      status,
      createdAt: new Date().toISOString()
    };

    user.orders.push(order);
    user.totalSpent = (user.totalSpent || 0) + Number(total);
    user.updatedAt = new Date().toISOString();

    await db.write();

    // Fire-and-forget: notify site admin about the new order
    try {
      const adminMail = {
        from: `"Damascus Master System" <${EMAIL_USER}>`,
        to: EMAIL_USER,
        subject: `New Order Received - ${order.id || 'Order'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width:700px; margin:0 auto;">
            <h2 style="color:#d4af37;">🔔 New Order Received</h2>
            <p><strong>Order ID:</strong> ${order.id || ''}</p>
            <p><strong>Customer:</strong> ${escapeHtml(user.name || '')} &lt;${escapeHtml(user.email || '')}&gt;</p>
            <p><strong>Total:</strong> $${Number(order.total || 0).toFixed(2)}</p>
            <p><strong>Status:</strong> ${escapeHtml(order.status || 'completed')}</p>
            <h3>Items</h3>
            <ul>
              ${(Array.isArray(order.items) ? order.items.map(i => `<li>${escapeHtml(String(i.title || i.name || i.id || 'item'))} — $${Number(i.price || 0).toFixed(2)} x ${Number(i.quantity || 1)}</li>`).join('') : '')}
            </ul>
            <p>Received at: ${new Date(order.createdAt).toLocaleString()}</p>
          </div>
        `
      };
  sendEmail({ to: db.data.adminNotifyEmail || process.env.ADMIN_EMAIL, subject: adminMail.subject, html: adminMail.html }).then(r=>{ if(!r.ok) console.error('Admin order notification failed:', r.error); }).catch(()=>{});
    } catch (e) {
      console.error('Failed to prepare admin order email:', e);
    }

    // Optionally send confirmation email to the customer if they allow order emails
    try {
      const wantsOrderEmails = !!(user.preferences && user.preferences.orderEmails);
      if (wantsOrderEmails && user.email) {
        const customerMail = {
          from: `"Damascus Master" <${EMAIL_USER}>`,
          to: user.email,
          subject: `Order Confirmation - ${order.id || ''}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width:700px; margin:0 auto;">
              <h2 style="color:#d4af37;">Thank you for your purchase${user.name ? ', ' + escapeHtml(user.name) : ''}!</h2>
              <p>Your order <strong>${order.id || ''}</strong> has been recorded.</p>
              <p><strong>Total:</strong> $${Number(order.total || 0).toFixed(2)}</p>
              <h3>Items</h3>
              <ul>
                ${(Array.isArray(order.items) ? order.items.map(i => `<li>${escapeHtml(String(i.title || i.name || i.id || 'item'))} — $${Number(i.price || 0).toFixed(2)} x ${Number(i.quantity || 1)}</li>`).join('') : '')}
              </ul>
              <p>If you have any questions, reply to this email or use the support form.</p>
            </div>
          `
        };
  sendEmail({ to: customerMail.to, subject: customerMail.subject, html: customerMail.html }).then(r=>{ if(!r.ok) console.error('Customer order confirmation failed:', r.error); }).catch(()=>{});
      }
    } catch (e) {
      console.error('Failed to prepare customer order email:', e);
    }

    res.status(201).json({
      message: 'Order added to history',
      order
    });
  } catch (error) {
    console.error('Order add error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ========== USER STATISTICS ==========

// Get user statistics
app.get('/api/user/stats', authenticateToken, async (req, res) => {
  try {
    await db.read();
    
    const user = db.data.users.find(user => user.id === req.user.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const stats = {
      totalOrders: user.orders?.length || 0,
      totalSpent: user.totalSpent || 0,
      wishlistCount: user.wishlist?.length || 0,
      memberSince: user.memberSince || new Date().getFullYear(),
      achievements: [
        {
          id: 'first_purchase',
          name: 'First Purchase',
          description: 'Made your first order',
          unlocked: (user.orders?.length || 0) > 0
        },
        {
          id: 'premium_collector',
          name: 'Premium Collector',
          description: 'Spent over $500',
          unlocked: (user.totalSpent || 0) >= 500
        },
        {
          id: 'wishlist_enthusiast',
          name: 'Wishlist Enthusiast',
          description: 'Added 10+ items to wishlist',
          unlocked: (user.wishlist?.length || 0) >= 10
        }
      ]
    };

    res.json({ stats });
  } catch (error) {
    console.error('Stats fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/config/paypal', async (req, res) => {
  const cfg = await getPaypalConfig();
  return res.json({ clientId: cfg.clientId, currency: 'USD', intent: 'CAPTURE', env: cfg.env, paypalEmail: cfg.paypalEmail });
});

// Admin API: get/set PayPal config
app.get('/api/admin/paypal-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const cfg = await getPaypalConfig();
  res.json(cfg);
});

app.post('/api/admin/paypal-config', authenticateToken, async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { paypalEmail, clientId, clientSecret, env, payoutPaypal, payoutBank, payoutCard, payoutOption } = req.body;
  if (paypalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(paypalEmail)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  await setPaypalConfig({ paypalEmail, clientId, clientSecret, env, payoutPaypal, payoutBank, payoutCard, payoutOption });
  res.json({ success: true });
});

async function getAccessToken() {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const resp = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`PayPal token error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.access_token;
}

function amountFromItems(items = []) {
  try {
    const total = (items || []).reduce((sum, it) => {
      const price = Number(it.price) || 0;
      const qty = Number(it.quantity || 1);
      return sum + price * qty;
    }, 0);
    return Number(total.toFixed(2));
  } catch (e) { return 0; }
}

app.post('/api/orders', async (req, res) => {
  try {
  const { items = [], shipping = {}, note: _note = '' } = req.body || {};
    // reference optional _note to avoid linter unused warnings; will be stored with order when needed
  const _maybeNote = (_note || '').toString();
  void _maybeNote;
    const total = amountFromItems(items);
    if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).json({ error: 'Server missing PayPal credentials' });
    if (!total || total <= 0) return res.status(400).json({ error: 'Total must be greater than 0' });

    const accessToken = await getAccessToken();

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          description: 'Damascus Master Order',
          amount: {
            currency_code: 'USD',
            value: total.toFixed(2),
          },
          shipping: shipping?.name ? {
            name: { full_name: shipping.name },
            address: {
              address_line_1: shipping.address || '',
              admin_area_2: shipping.city || '',
              admin_area_1: shipping.state || '',
              postal_code: shipping.zip || '',
              country_code: (shipping.country || 'US').slice(0,2).toUpperCase(),
            },
          } : undefined,
        },
      ],
      application_context: {
        shipping_preference: 'SET_PROVIDED_ADDRESS',
        user_action: 'PAY_NOW',
      },
    };

    const resp = await fetch(`${BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    return res.json({ id: data.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Order creation failed' });
  }
});

app.post('/api/orders/:orderId/capture', async (req, res) => {
  try {
    const { orderId } = req.params;
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' });
    const accessToken = await getAccessToken();
    const resp = await fetch(`${BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Capture failed' });
  }
});

// Webhook: must use raw body for verification
app.post('/webhooks/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    if (!WEBHOOK_ID) {
      console.warn('PAYPAL_WEBHOOK_ID is not set');
      return res.status(200).end();
    }

    const transmissionId = req.header('paypal-transmission-id');
    const transmissionTime = req.header('paypal-transmission-time');
    const transmissionSig = req.header('paypal-transmission-sig');
    const certUrl = req.header('paypal-cert-url');
    const authAlgo = req.header('paypal-auth-algo');

    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : req.body;
    const webhookEvent = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;

    const accessToken = await getAccessToken();
    const verifyResp = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        auth_algo: authAlgo,
        cert_url: certUrl,
        transmission_id: transmissionId,
        transmission_sig: transmissionSig,
        transmission_time: transmissionTime,
        webhook_id: WEBHOOK_ID,
        webhook_event: webhookEvent,
      }),
    });

    const verifyData = await verifyResp.json();
    const ok = verifyData?.verification_status === 'SUCCESS';
    if (!ok) {
      console.warn('Webhook verification failed', verifyData);
      return res.status(400).json({ received: true });
    }

    // Handle specific events if desired
    const eventType = webhookEvent?.event_type;
    if (eventType === 'CHECKOUT.ORDER.APPROVED' || eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      // TODO: record order/payment in database
      console.log('Webhook event:', eventType, webhookEvent?.resource?.id);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook error', err);
    return res.status(200).json({ received: true });
  }
});

// Simple health endpoint used for smoke tests
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: PAYPAL_ENV || 'sandbox', pid: process.pid, ts: Date.now() });
});

// Serve static site from parent folder (project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const uploadsDir = path.join(webRoot, 'uploads');
// Ensure avatars subfolder exists so avatars can be served from /uploads/avatars
try {
  const avatarsDirStartup = path.join(uploadsDir, 'avatars');
  if (!fs.existsSync(avatarsDirStartup)) {
    fs.mkdirSync(avatarsDirStartup, { recursive: true });
    console.log('Created uploads/avatars directory:', avatarsDirStartup);
  }
} catch (e) {
  console.warn('Failed to ensure uploads/avatars directory exists:', e && e.message || e);
}
// Middleware: ensure favicon and precise album titles/descriptions are present
// This intercepts HTML GET requests and injects a favicon link into <head>
// and standardizes album titles using product data when available. It avoids
// editing files on disk and guarantees the favicon appears across the site.
app.use(async (req, res, next) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    // normalize to an HTML path (root -> index.html)
    const reqPath = req.path === '/' ? '/index.html' : req.path;
    if (!reqPath.toLowerCase().endsWith('.html')) return next();

    const fullPath = path.join(webRoot, reqPath);
    if (!fs.existsSync(fullPath)) return next();

    let content = await fs.promises.readFile(fullPath, 'utf8');
    let modified = false;

    // helper to escape HTML attribute values
    const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeRegExp = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // avoid unused variable complaint in some lint setups
  void escapeRegExp('test');

    // Ensure favicon link exists in <head>
    if (!/rel=["']icon["']/i.test(content)) {
      content = content.replace(/<head([^>]*)>/i, `<head$1>\n  <link rel="icon" type="image/svg+xml" href="/favicon.svg">`);
      modified = true;
    }

    // Try to map this HTML to a product so we can set a precise title/description
    const fname = path.basename(fullPath);
    await db.read();
    const products = Array.isArray(db.data.products) ? db.data.products : [];
    const prod = products.find(p => {
      if (p.page && String(p.page).toLowerCase() === fname.toLowerCase()) return true;
      // fallback: sanitized title match (generate_albums uses sanitized title as filename)
      const safe = String(p.title || '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() + '.html';
      if (safe === fname.toLowerCase()) return true;
      return false;
    });

    if (prod) {
      const displayId = (prod.details && prod.details.displayId) ? prod.details.displayId : '';
      const titleText = `${displayId ? displayId + ' - ' : ''}${prod.title} | Damascus Master`;

      // Replace or insert <title>
      if (/<title>[\s\S]*?<\/title>/i.test(content)) {
        content = content.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(titleText)}</title>`);
      } else {
        content = content.replace(/<head([^>]*)>/i, `<head$1>\n  <title>${escapeHtml(titleText)}</title>`);
      }
      modified = true;

      // Ensure meta description exists and is product-aware
      const desc = String(prod.desc || (prod.details && prod.details.description) || '').slice(0, 160);
      if (/name=["']description["']/i.test(content)) {
        content = content.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${escapeHtml(desc)}">`);
      } else {
        content = content.replace(/<head([^>]*)>/i, `<head$1>\n  <meta name="description" content="${escapeHtml(desc)}">`);
      }
    }

    if (modified) {
      res.type('html').send(content);
      return;
    }
  } catch (e) {
    console.warn('HTML injection middleware error:', e && e.message ? e.message : e);
    // fallthrough to static serving on error
  }
  return next();
});

// Serve static files and uploads
// Do not serve '.regen.html' files directly. If a request targets a filename containing
// '.regen' but the canonical '.html' exists, redirect to the canonical path. This is a
// conservative, non-destructive safeguard against stale/generated '.regen.html' files
// being accidentally viewed.
app.use(function (req, res, next) {
  try {
    if (req.method === 'GET' && req.path && req.path.toLowerCase().endsWith('.html') && req.path.toLowerCase().includes('.regen')) {
      const canonical = req.path.replace(/\.regen(\.html)?/gi, '.html');
      const fullCanon = path.join(webRoot, canonical);
      if (fs.existsSync(fullCanon)) {
        // Permanent redirect to canonical filename
        return res.redirect(301, canonical);
      }
    }
  } catch (e) {
    // swallow errors and continue to static serving
  }
  next();
});

app.use(express.static(webRoot));
// Always serve uploads folder explicitly (in case webRoot static fails or is restricted)
app.use('/uploads', express.static(uploadsDir));
app.get('/', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));

// List HTML pages to help admin pick exact product pages
app.get('/api/pages', async (req, res) => {
  try {
    const files = await readdir(webRoot);
    const html = files.filter(f => f.toLowerCase().endsWith('.html'));
    const { prefix } = req.query || {};
    const filtered = prefix ? html.filter(f => f.toLowerCase().startsWith(String(prefix).toLowerCase())) : html;
    res.json({ files: filtered });
  } catch (e) { res.status(500).json({ error: 'Failed to list pages' }); }
});

// Save page content (admin only)
app.post('/api/pages/save', authRequired('admin'), async (req, res) => {
  try {
    const { path: pagePath, content } = req.body;
    if (!pagePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'Path and content are required' });
    }
    
    // Security: only allow HTML files and prevent path traversal
    if (!pagePath.endsWith('.html') || pagePath.includes('..') || pagePath.includes('/')) {
      return res.status(400).json({ error: 'Invalid page path' });
    }
    
    const fullPath = path.join(webRoot, pagePath);
    await writeFile(fullPath, content, 'utf8');
    
    res.json({ success: true, message: 'Page saved successfully' });
  } catch (e) {
    console.error('Failed to save page:', e);
    res.status(500).json({ error: 'Failed to save page' });
  }
});

// Update page content via PUT (visual editor)
app.put('/api/pages/:filename', authRequired('admin'), async (req, res) => {
  try {
    const { filename } = req.params;
    const { content } = req.body;
    
    if (!filename || typeof content !== 'string') {
      return res.status(400).json({ error: 'Filename and content are required' });
    }
    
    // Security: only allow HTML files and prevent path traversal
    if (!filename.endsWith('.html') || filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Invalid filename' });
    }
    
    const fullPath = path.join(webRoot, filename);
    await writeFile(fullPath, content, 'utf8');
    
    res.json({ success: true, message: 'Page updated successfully' });
  } catch (e) {
    console.error('Failed to update page:', e);
    res.status(500).json({ error: 'Failed to update page' });
  }
});

// Get all images for the visual editor
app.get('/api/images', async (req, res) => {
  try {
    const uploadsPath = path.join(webRoot, 'uploads');
    let images = [];
    
    try {
      const files = await readdir(uploadsPath);
      images = files
        .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
        .map(f => `uploads/${f}`);
    } catch (e) {
      // uploads directory might not exist yet
      console.log('No uploads directory found or error reading it');
    }
    
    res.json({ images });
  } catch (e) {
    console.error('Failed to list images:', e);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

// --------- Admin & Auth ---------
// Remove duplicate JWT_SECRET - using the one defined earlier
async function ensureAdmin() {
  // Create an admin account only when environment variables explicitly provide credentials.
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  await db.read();

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn('ADMIN_EMAIL and/or ADMIN_PASSWORD not set; skipping automatic admin provisioning.');
    return;
  }

  // Do not remove existing admin accounts. Instead, check if an admin with this email exists.
  // Try to find a matching user by email first. If not found, try to match by
  // username derived from the ADMIN_EMAIL local-part or any existing admin-like username.
  let existing = db.data.users.find(u => u.email && u.email.toLowerCase() === ADMIN_EMAIL.toLowerCase());
  if (!existing) {
    const derivedUsername = (ADMIN_EMAIL.split('@')[0] || '').replace(/[^a-zA-Z0-9_.-]/g, '');
    existing = db.data.users.find(u => (u.username && u.username.toLowerCase() === derivedUsername.toLowerCase()) || (u.username && u.username.toLowerCase() === 'faiqsajjad652') || (u.role && u.role === 'admin'));
  }

  if (existing) {
    // Update existing user to use the provided admin email/username and role.
    existing.email = ADMIN_EMAIL;
    existing.username = (ADMIN_EMAIL.split('@')[0] || existing.username || 'admin').replace(/[^a-zA-Z0-9_.-]/g, '');
    existing.role = 'admin';
    // Hash and update password only when ADMIN_PASSWORD is provided
    try {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      existing.password = passwordHash;
      existing.updatedAt = new Date().toISOString();
      await db.write();
      console.log(`Updated existing user to admin and set credentials: ${ADMIN_EMAIL}`);
    } catch (e) {
      console.error('Failed to hash/update admin password:', e?.message || e);
    }
    return;
  }

  // Hash password and create admin user
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const adminUser = {
    id: uuidv4(),
    email: ADMIN_EMAIL,
    name: 'Admin',
    username: (ADMIN_EMAIL.split('@')[0] || 'admin').replace(/[^a-zA-Z0-9_.-]/g, ''),
    role: 'admin',
    password: passwordHash,
    phone: '', address: '', city: '', state: '', zip: '', country: '', logo: '',
    preferences: { compactLayout: false, orderEmails: true, marketingEmails: true, newsletter: true, twoFactorAuth: false, loginNotifications: true },
    orders: [], wishlist: [], totalSpent: 0, memberSince: new Date().getFullYear(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLogin: null
  };
  db.data.users.push(adminUser);
  await db.write();
  console.log(`Created admin user: ${ADMIN_EMAIL}`);
}
// Only attempt provisioning when env vars are set
ensureAdmin();

// Remove this duplicate - the main auth endpoints are defined earlier in the file

// Admin auth middleware (simplified version)
function authRequired(role) {
  return async (req, res, next) => {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!token) return res.status(401).json({ error: 'Access token required' });

      const payload = jwt.verify(token, process.env.JWT_SECRET || 'damascus-secret');
      req.user = payload;

      if (role === 'admin') {
        // If token itself contains role=admin that's sufficient
        if (payload.role && String(payload.role).toLowerCase() === 'admin') {
          return next();
        }

        // Otherwise, verify against database (backwards compatibility)
        try {
          await db.read();
          const u = db.data.users.find(x => x.id === payload.userId || (x.email && x.email.toLowerCase() === String(payload.email || '').toLowerCase()));
          if (u && u.role === 'admin') {
            // attach canonical role
            req.user.role = 'admin';
            return next();
          }
        } catch (e) {
          console.warn('authRequired DB read failed', e?.message || e);
        }

        return res.status(403).json({ error: 'Admin access required' });
      }

      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

// --------- Uploads ---------
import { mkdir } from 'fs/promises';
await mkdir(uploadsDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_')),
});
const upload = multer({ storage });

// --------- Products & Albums CRUD ---------
// Batch product upsert (create or update by id)
app.post('/api/products/batch', authRequired('admin'), async (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Payload must be an array' });
    await db.read();
    let changed = false;
    const changedProducts = [];
    // Build per-category counters so new displayIds are sequential within each category
    const countByPrefix = {};
    for (const p of db.data.products) {
      const cfg = resolveCategoryConfig(p.category);
      if (!cfg) continue;
      countByPrefix[cfg.idPrefix] = (countByPrefix[cfg.idPrefix] || 0) + 1;
    }
    for (const prod of req.body) {
      // Validate and normalize
      let data;
      try {
        data = productSchema.partial().parse({ ...prod, price: prod.price !== undefined ? Number(prod.price) : undefined });
      } catch {
        continue; // skip invalid
      }
      let existing = data.id && db.data.products.find(x => x.id === data.id);
      if (existing) {
  Object.assign(existing, data, { updatedAt: Date.now() });
  if (data.topSeller !== undefined) existing.topSeller = Boolean(data.topSeller);
        changed = true;
        changedProducts.push(existing);
      } else {
        // Assign new id if missing
        const productId = data.id || uuidv4();
        const nextPos = (db.data.products.reduce((max, p) => Math.max(max, Number(p.position||0)), 0) + 1);
        let displayId = '';
        const cfg = resolveCategoryConfig(data.category);
        if (cfg) {
          // Per-category sequential index
          const nextIndex = (countByPrefix[cfg.idPrefix] || 0) + 1;
          countByPrefix[cfg.idPrefix] = nextIndex;
          displayId = cfg.idPrefix + nextIndex;
        } else {
          displayId = (data.title?.replace(/[^a-zA-Z0-9]/g,'').slice(0,2) || 'pr') + nextPos;
        }
        const safeTitle = (data.title || '').replace(/[^a-zA-Z0-9_-]/g,'_').toLowerCase();
  const newProduct = {
          ...data,
          id: productId,
          position: nextPos,
          createdAt: Date.now(),
          details: { ...(data.details||{}), displayId },
          page: `${safeTitle}.html`,
          createdBy: req.user?.sub
        };
  newProduct.topSeller = Boolean(newProduct.topSeller);
        db.data.products.push(newProduct);
        changedProducts.push(newProduct);
        changed = true;
      }
    }
    if (changed) {
      db.data.products = db.data.products
        .sort((a,b)=>Number(a.position)-Number(b.position))
        .map((p,i)=>({...p, position: i+1}));
      await db.write();
      // Immediately (re)generate album pages for the changed products
      try {
        for (const cp of changedProducts) {
          await rewriteAlbumPage(cp, { webRoot });
        }
      } catch (e) { console.warn('Immediate album regen (batch) failed:', e?.message || e); }
      regenerateAllAlbums();
    }
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Invalid payload' });
  }
});
const productSchema = z.object({
  title: z.string().min(1),
  price: z.number().min(0),
  desc: z.string().optional(),
  album: z.string().optional(), // legacy
  category: z.string().optional(), // gallery identifier e.g., 'axes'
  page: z.string().optional(), // exact page path e.g., 'aalbum3.html'
  position: z.number().optional(), // for ordering in gallery
  details: z.any().optional(),
  images: z.array(z.string()).optional(),
  topSeller: z.boolean().optional(),
  sale: z.object({ active: z.boolean().optional(), price: z.number().min(0).optional(), prevPrice: z.number().min(0).optional() }).optional(),
});

app.get('/api/products', async (req, res) => {
  await db.read();
  let products = db.data.products || [];
  try {
    const { topSeller } = req.query || {};
    if (typeof topSeller !== 'undefined') {
      const v = String(topSeller).toLowerCase();
      const want = v === '1' || v === 'true' || v === 'yes' || v === 'y';
      products = products.filter(p => Boolean(p.topSeller) === want);
    }
  } catch {}
  try {
    // Sort by sale percent (highest discount first), then by position
    products = products.slice().sort((a, b) => {
      const aSale = a.sale && a.sale.active && a.sale.price && a.sale.prevPrice ? ((Number(a.sale.prevPrice) - Number(a.sale.price)) / Number(a.sale.prevPrice)) : 0;
      const bSale = b.sale && b.sale.active && b.sale.price && b.sale.prevPrice ? ((Number(b.sale.prevPrice) - Number(b.sale.price)) / Number(b.sale.prevPrice)) : 0;
      if (aSale !== bSale) return bSale - aSale;
      return (Number(a.position||0) - Number(b.position||0));
    });
  } catch (e) {
    // fallback to original order on error
  }
  res.json(products);
});
// Convenience endpoint
app.get('/api/products/top-sellers', async (_req, res) => {
  await db.read();
  const products = (db.data.products || []).filter(p => Boolean(p.topSeller));
  res.json(products);
});
app.get('/api/products/:id', async (req, res) => { await db.read(); const p = db.data.products.find(x => x.id === req.params.id); return p ? res.json(p) : res.status(404).end(); });
// --- Reviews API ---
// Get reviews for a product by product id, displayId, or page filename
app.get('/api/products/:id/reviews', async (req, res) => {
  try {
    await db.read();
    const key = String(req.params.id || '').toLowerCase();
    const p = db.data.products.find(x => (x.id && String(x.id).toLowerCase() === key) || (x.details && x.details.displayId && String(x.details.displayId).toLowerCase() === key) || (x.page && String(x.page).toLowerCase() === key));
    if (!p) return res.json({ reviews: [] });
    return res.json({ reviews: Array.isArray(p.reviews) ? p.reviews : [] });
  } catch (e) {
    console.error('Failed to fetch reviews:', e);
    return res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Post a new review for a product (anonymous allowed)
app.post('/api/products/:id/reviews', async (req, res) => {
  try {
    const { name, rating, comment } = req.body || {};
    if (!comment && (rating === undefined || rating === null)) {
      return res.status(400).json({ error: 'Rating or comment is required' });
    }

    // Basic anti-spam: honeypot field and simple IP rate-limiting
    try {
      const hp = req.body && req.body.honeypot;
      if (hp && String(hp).trim() !== '') return res.status(400).json({ error: 'Spam detected' });
    } catch(e){}

    await db.read();
    // Rate-limit: allow max 5 reviews per IP per 10 minutes
    try {
      const ip = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
      const now = Date.now();
      if (!global.__review_rate) global.__review_rate = {};
      const record = global.__review_rate[ip] || { times: [] };
      // remove older than 10 minutes
      record.times = (record.times || []).filter(t => (now - t) < (10 * 60 * 1000));
      if (record.times.length >= 5) return res.status(429).json({ error: 'Too many reviews from this IP, please wait' });
      record.times.push(now);
      global.__review_rate[ip] = record;
    } catch (e) { console.warn('rate-limit check failed', e); }
    const key = String(req.params.id || '').toLowerCase();
    const p = db.data.products.find(x => (x.id && String(x.id).toLowerCase() === key) || (x.details && x.details.displayId && String(x.details.displayId).toLowerCase() === key) || (x.page && String(x.page).toLowerCase() === key));
    if (!p) return res.status(404).json({ error: 'Product not found' });

    // Profanity detection: quick configurable list. If REJECT_PROFANE=true => reject requests, otherwise accept but flag.
    const profanityList = (process.env.PROFANITY_WORDS && String(process.env.PROFANITY_WORDS).trim())
      ? String(process.env.PROFANITY_WORDS).split(',').map(s => s.trim()).filter(Boolean)
      : [
        'fuck','shit','bitch','asshole','bastard','damn','dick','piss','slut','whore','motherfucker'
      ];
    const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const profanityRx = new RegExp('\\b(' + profanityList.map(escapeRegExp).join('|') + ')\\b', 'i');
    const combined = (String(name || '') + ' ' + String(comment || '')).toLowerCase();
    const hasProfanity = profanityRx.test(combined);

    p.reviews = Array.isArray(p.reviews) ? p.reviews : [];
    const review = {
      id: uuidv4(),
      name: (name && String(name).trim()) || 'Anonymous',
      rating: Number(rating) || 0,
      comment: String(comment || ''),
      createdAt: new Date().toISOString()
    };

    if (hasProfanity) {
      // If env REJECT_PROFANE is set to 'true', reject submission outright
      const rejectMode = String(process.env.REJECT_PROFANE || '').toLowerCase() === 'true';
      review.flagged = true;
      review.flaggedReason = 'profanity';
      review.status = 'flagged';
      if (rejectMode) {
        // Do not persist the review
        return res.status(400).json({ error: 'Review contains inappropriate language' });
      }
      // Persist flagged review so admins can review it
    }

    p.reviews.push(review);
    await db.write();

    // Return created review (includes flagged=true if content matched profanity)
    return res.status(201).json({ review });
  } catch (e) {
    console.error('Failed to save review:', e);
    return res.status(500).json({ error: 'Failed to save review' });
  }
});

// Admin: list all reviews (grouped by product)
app.get('/api/admin/reviews', authRequired('admin'), async (req, res) => {
  try {
    await db.read();
    const out = (db.data.products || []).map(p => ({ productId: p.id, title: p.title, page: p.page, reviews: Array.isArray(p.reviews) ? p.reviews : [] }));
    res.json(out);
  } catch (e) {
    console.error('Failed to list reviews:', e);
    res.status(500).json({ error: 'Failed to list reviews' });
  }
});

// Admin: delete a review by id
app.delete('/api/admin/reviews/:reviewId', authRequired('admin'), async (req, res) => {
  try {
    const { reviewId } = req.params;
    if (!reviewId) return res.status(400).json({ error: 'reviewId required' });
    await db.read();
    let found = null;
    for (const p of db.data.products || []) {
      if (!Array.isArray(p.reviews)) continue;
      const idx = p.reviews.findIndex(r => r.id === reviewId);
      if (idx !== -1) {
        found = { productId: p.id, title: p.title, removed: p.reviews[idx] };
        p.reviews.splice(idx, 1);
        break;
      }
    }
    if (!found) return res.status(404).json({ error: 'Review not found' });
    await db.write();
    res.json({ success: true, removed: found.removed });
  } catch (e) {
    console.error('Failed to delete review:', e);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Admin: update a review (e.g., approve/unflag)
app.put('/api/admin/reviews/:reviewId', authRequired('admin'), async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { action, status } = req.body || {};
    if (!reviewId) return res.status(400).json({ error: 'reviewId required' });
    await db.read();
    let found = null;
    for (const p of db.data.products || []) {
      if (!Array.isArray(p.reviews)) continue;
      const idx = p.reviews.findIndex(r => r.id === reviewId);
      if (idx !== -1) {
        found = { product: p, review: p.reviews[idx], index: idx };
        break;
      }
    }
    if (!found) return res.status(404).json({ error: 'Review not found' });

    const r = found.review;
    // Support actions: approve (clear flagged), flag, set status
    if (action === 'approve' || (status && String(status).toLowerCase() === 'approved')) {
      r.flagged = false;
      r.flaggedReason = undefined;
      r.status = 'approved';
    } else if (action === 'flag' || (status && String(status).toLowerCase() === 'flagged')) {
      r.flagged = true;
      r.flaggedReason = r.flaggedReason || 'manual';
      r.status = 'flagged';
    } else if (status) {
      r.status = String(status);
    }

    await db.write();
    res.json({ success: true, review: r });
  } catch (e) {
    console.error('Failed to update review:', e);
    res.status(500).json({ error: 'Failed to update review' });
  }
});
import { exec } from 'child_process';
function regenerateAllAlbums() {
  exec('node generate_albums.js', { cwd: webRoot }, (err, stdout, stderr) => {
    if (err) console.warn('Album regeneration failed:', err.message);
    if (stdout) console.log(stdout);
    if (stderr) console.warn(stderr);
  });
}

app.post('/api/products', authRequired('admin'), async (req, res) => {
  try {
    const data = productSchema.parse({ ...req.body, price: Number(req.body.price) });
    await db.read();
    const nextPos = (db.data.products.reduce((max, p) => Math.max(max, Number(p.position||0)), 0) + 1);
    const productId = uuidv4();
  const product = { id: productId, ...data, position: nextPos, createdAt: Date.now(), createdBy: req.user?.sub };
    let displayId = '';
    const cfg = resolveCategoryConfig(product.category);
  if (cfg) {
      // Per-category sequence: count existing products of this category
      let count = 0;
      for (const p of db.data.products) {
        const c = resolveCategoryConfig(p.category);
        if (c && c.idPrefix === cfg.idPrefix) count++;
      }
      displayId = cfg.idPrefix + (count + 1);
    } else {
      displayId = (product.title.replace(/[^a-zA-Z0-9]/g,'').slice(0,2) || 'pr') + nextPos;
    }
    product.details = { ...(product.details||{}), displayId };
  // Always set album page to sanitized product title only (all categories)
  const safeTitle = (product.title || '').replace(/[^a-zA-Z0-9_-]/g,'_').toLowerCase();
  product.page = `${safeTitle}.html`;
  // Ensure boolean defaults
  product.topSeller = Boolean(product.topSeller);
    db.data.products.push(product);
    db.data.products = db.data.products
      .sort((a,b)=>Number(a.position)-Number(b.position))
      .map((p,i)=>({...p, position: i+1}));
    await db.write();
  // Generate this product's album page immediately for fast availability
  try { await rewriteAlbumPage(product, { webRoot }); } catch (e) { console.warn('Immediate album gen failed:', e?.message || e); }
    regenerateAllAlbums();
    res.json(product);
  } catch { res.status(400).json({ error: 'Invalid payload' }); }
});
app.put('/api/products/:id', authRequired('admin'), async (req, res) => {
  try {
    // Treat empty-string or null price as "no update" so clients that submit '' don't inadvertently set price to 0
    let priceVal = undefined;
    if (req.body.price !== undefined && req.body.price !== null && req.body.price !== '') {
      const n = Number(req.body.price);
      if (Number.isFinite(n)) priceVal = n;
      else priceVal = undefined;
    }
    const data = productSchema.partial().parse({ ...req.body, price: priceVal });
    await db.read();
    const p = db.data.products.find(x => x.id === req.params.id);
    if (!p) return res.status(404).end();
  // Special handling for sale updates to avoid overwriting product.price unintentionally
  // If client provided sale with active:true and prevPrice, keep p.price unchanged and store sale.prevPrice
  if (data.sale !== undefined) {
    const incomingSale = data.sale || {};
    if (incomingSale.active) {
      // Validate incoming sale price: ignore updates without a positive sale price
      const incomingPrice = (incomingSale.price !== undefined && incomingSale.price !== null) ? Number(incomingSale.price) : NaN;
      if (!Number.isFinite(incomingPrice) || incomingPrice <= 0) {
        // Reject invalid sale price to avoid accidentally setting 0
        return res.status(400).json({ error: 'Invalid sale price' });
      }
      // Determine prevPrice: prefer explicit positive prevPrice, otherwise fall back to existing p.price when valid
      const explicitPrev = (incomingSale.prevPrice !== undefined && incomingSale.prevPrice !== null) ? Number(incomingSale.prevPrice) : NaN;
      const prev = (Number.isFinite(explicitPrev) && explicitPrev > 0) ? explicitPrev : (Number.isFinite(Number(p.price)) && Number(p.price) > 0 ? Number(p.price) : undefined);
      // Store sale object; do not touch p.price here
        p.sale = { active: true, price: incomingPrice };
        if (prev !== undefined) p.sale.prevPrice = prev;
        // If the product lacks a numeric top-level price, populate it from prev so removal can restore correctly
        if ((!Number.isFinite(Number(p.price)) || Number(p.price) <= 0) && Number.isFinite(prev) && prev > 0) {
          // Write directly into db.data.products to ensure persistence
          try {
            const idx = db.data.products.findIndex(x => x.id === p.id);
            if (idx !== -1) {
              db.data.products[idx].price = prev;
              // reflect on local ref too
              p.price = prev;
              console.log('[SALE-SET] Wrote top-level price into db for product', p.id, 'price=', prev);
            }
          } catch (e) {
            console.warn('[SALE-SET] Failed to write top-level price into db for product', p.id, e?.message || e);
          }
        }
    } else {
      // Removing sale: restore price from prevPrice if available and positive.
      // Be robust: prefer existing product.sale.prevPrice, fall back to incomingSale.prevPrice if present.
      const existingPrev = (p && p.sale && p.sale.prevPrice !== undefined) ? Number(p.sale.prevPrice) : NaN;
      const incomingPrev = (incomingSale && incomingSale.prevPrice !== undefined) ? Number(incomingSale.prevPrice) : NaN;
      const chosenPrev = (Number.isFinite(existingPrev) && existingPrev > 0) ? existingPrev : ((Number.isFinite(incomingPrev) && incomingPrev > 0) ? incomingPrev : NaN);
      if (Number.isFinite(chosenPrev) && chosenPrev > 0) {
        console.log('[SALE-REMOVE] Restoring price for product', p.id, 'chosenPrev=', chosenPrev, 'existing price before=', p.price);
        p.price = chosenPrev;
        console.log('[SALE-REMOVE] Restored price for product', p.id, 'new price=', p.price);
      } else if (p && p.sale && Number.isFinite(Number(p.sale.prevPrice)) && Number(p.sale.prevPrice) > 0) {
        // As a final fallback, use p.sale.prevPrice if present
        p.price = Number(p.sale.prevPrice);
        console.log('[SALE-REMOVE] Fallback restore for product', p.id, 'from p.sale.prevPrice=', p.sale.prevPrice);
      } else {
        console.log('[SALE-REMOVE] No prevPrice available to restore for product', p.id);
      }
      // Always mark sale inactive (use minimal shape)
      p.sale = { active: false };
    }
  // Remove sale (and any placeholder price) from data copy so we don't later overwrite p.sale or p.price via the merge
  delete data.sale;
  if (Object.prototype.hasOwnProperty.call(data, 'price')) delete data.price;
  }
  // Merge only explicit fields from data to avoid clearing arrays/objects when not provided
  // Validate keys by checking productSchema shape (defensive)
  Object.keys(data || {}).forEach(k => {
  try {
  if (k === 'price') p.price = data.price;
      else if (k === 'title') p.title = data.title;
      else if (k === 'desc') p.desc = data.desc;
      else if (k === 'album') p.album = data.album;
      else if (k === 'category') p.category = data.category;
      else if (k === 'page') p.page = data.page;
      else if (k === 'position') p.position = data.position;
      else if (k === 'details') p.details = data.details;
      else if (k === 'images') p.images = data.images;
      else if (k === 'topSeller') p.topSeller = Boolean(data.topSeller);
      // sale handled earlier
    } catch (e) {}
  });
  p.updatedAt = Date.now();
    await db.write();
    // Keep existing album page in sync after updates
    try { await rewriteAlbumPage(p, { webRoot }); } catch (e) { console.warn('Rewrite album on update failed:', e?.message || e); }
    regenerateAllAlbums();
    res.json(p);
  } catch { res.status(400).json({ error: 'Invalid payload' }); }
});
app.delete('/api/products/:id', authRequired('admin'), async (req, res) => {
  await db.read();
  const i = db.data.products.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).end();
  const removed = db.data.products.splice(i, 1)[0];
  // Delete album HTML files when product is removed (can be disabled by setting ALLOW_ALBUM_DELETE=false)
  const allowDelete = String(process.env.ALLOW_ALBUM_DELETE || 'true').toLowerCase() === 'true';
  if (removed && allowDelete) {
    const fs = await import('fs/promises');
    const safeTitle = (removed.title || '').replace(/[^a-zA-Z0-9]/g,'_').toLowerCase().slice(0,32);
    const displayId = removed.details && removed.details.displayId ? removed.details.displayId : '';
    const possibleFiles = [];
    if (removed.page) possibleFiles.push(removed.page);
    if (safeTitle && displayId) possibleFiles.push(`${safeTitle}_${displayId}.html`);
    if (safeTitle) possibleFiles.push(`${safeTitle}.html`);
    // Also try capitalized version (legacy)
    if (removed.title) {
      const legacy = removed.title.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'');
      possibleFiles.push(`${legacy}.html`);
    }
    // Remove duplicates
    const uniqueFiles = [...new Set(possibleFiles)];
    // Soft-delete: move album files to a timestamped trash folder instead of unlinking
    const trashRoot = path.join(webRoot, '.deleted_albums');
    const ts = Date.now();
    const trashDir = path.join(trashRoot, String(ts));
    try {
      await fs.mkdir(trashDir, { recursive: true });
    } catch (e) {
      console.warn('Failed to ensure trash directory:', trashDir, e.message);
    }
    for (const file of uniqueFiles) {
      const src = path.join(webRoot, file);
      const dest = path.join(trashDir, file);
      try {
        // Try to rename (fast move) first
        await fs.rename(src, dest);
        console.log('Moved album file to trash:', file);
      } catch (err) {
        if (err.code === 'ENOENT') {
          // file doesn't exist; ignore
          continue;
        }
        // If rename failed for other reasons, try copy-and-unlink as fallback
        try {
          await fs.copyFile(src, dest);
          await fs.unlink(src);
          console.log('Copied and removed album file to trash:', file);
        } catch (err2) {
          if (err2.code !== 'ENOENT') console.warn('Failed to remove album file:', file, err2.message);
        }
      }
    }
  }
  await db.write();
  regenerateAllAlbums();
  res.json(removed);
});

// Upload images
app.post('/api/uploads', authRequired('admin'), upload.array('files', 8), (req, res) => {
  const files = (req.files || []).map(f => ({ name: f.originalname, url: '/uploads/' + path.basename(f.path) }));
  res.json({ files });
});

// Upload avatar (for regular users)
app.post('/api/uploads/avatar', authenticateToken, upload.single('avatar'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Move file to avatars subfolder
    const originalPath = req.file.path;
    const avatarPath = path.join(uploadsDir, 'avatars', req.file.filename);
    
    // Ensure avatars directory exists
    const avatarsDir = path.join(uploadsDir, 'avatars');
    if (!fs.existsSync(avatarsDir)) {
      fs.mkdirSync(avatarsDir, { recursive: true });
    }

    // Move file (synchronous rename is fine here)
    fs.renameSync(originalPath, avatarPath);
    
    const avatarUrl = '/uploads/avatars/' + req.file.filename;
    res.json({ 
      success: true,
      file: { 
        name: req.file.originalname, 
        url: avatarUrl 
      } 
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// ========== NEWSLETTER ENDPOINTS ==========

// Newsletter subscription
app.post('/api/newsletter/subscribe', async (req, res) => {
  try {
    const { email, preferences = {}, password } = req.body;
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    await db.read();
    
    // Check if already subscribed
    const existingSubscription = db.data.newsletters?.find(
      sub => sub.email.toLowerCase() === email.toLowerCase()
    );
    
    if (existingSubscription) {
      // Update existing subscription
      existingSubscription.preferences = preferences;
      existingSubscription.updatedAt = new Date().toISOString();
    } else {
      // Initialize newsletters array if it doesn't exist
      if (!db.data.newsletters) {
        db.data.newsletters = [];
      }
      
      // Add new subscription
      db.data.newsletters.push({
        id: uuidv4(),
        email: email.toLowerCase(),
        preferences,
        subscribedAt: new Date().toISOString(),
        active: true
      });
    }
    
    await db.write();
    
    // Send welcome email
    try {
      const mailOptions = {
        from: `"Damascus Master" <${EMAIL_USER}>`,
        to: email,
        subject: 'Welcome to Damascus Master Newsletter 🗡️',
        html: `
          <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #2c1810 0%, #8b4513 50%, #daa520 100%); color: #f5f5dc; border-radius: 10px; overflow: hidden;">
            <div style="padding: 40px 30px; text-align: center; background: rgba(0,0,0,0.3);">
              <h1 style="color: #daa520; font-size: 28px; margin: 0 0 20px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                🗡️ Welcome to Damascus Master Newsletter
              </h1>
              
              <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 8px; margin: 20px 0; text-align: left;">
                <h2 style="color: #f5f5dc; margin: 0 0 15px 0; text-align: center;">Thank you for subscribing!</h2>
                <p style="line-height: 1.6; margin: 0; font-size: 16px;">
                  You're now part of an exclusive community that appreciates the finest Damascus steel craftsmanship.
                </p>
              </div>
              
              <div style="text-align: left; margin: 20px 0;">
                <h3 style="color: #daa520; margin: 0 0 15px 0;">What to expect:</h3>
                <div style="padding-left: 20px;">
                  ${preferences.offers ? '<p style="margin: 8px 0;">🎯 <strong>Exclusive Offers</strong> - Special discounts and early access to new collections</p>' : ''}
                  ${preferences.craftsmanship ? '<p style="margin: 8px 0;">⚒️ <strong>Craftsmanship Insights</strong> - Behind-the-scenes forging processes and techniques</p>' : ''}
                  <p style="margin: 8px 0;">📰 <strong>Premium Updates</strong> - Latest Damascus steel news and product launches</p>
                  <p style="margin: 8px 0;">🏆 <strong>Master Artisan Features</strong> - Stories from our skilled craftsmen</p>
                </div>
              </div>
              
              <div style="margin: 30px 0;">
                <p style="font-style: italic; color: #daa520; margin: 0;">
                  "Excellence in every fold, perfection in every blade"
                </p>
              </div>
              
              <div style="background: rgba(218,165,32,0.2); padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #90EE90;">
                  Follow us on social media for daily updates and craftsmanship videos!
                </p>
              </div>
            </div>
          </div>
        `
      };
      
  await sendEmail({ to: email, subject: mailOptions.subject, html: mailOptions.html });
    } catch (emailError) {
      console.error('Welcome email failed:', emailError);
      // Don't fail the subscription if email fails
    }
    
    res.json({ 
      success: true, 
      message: 'Successfully subscribed to Damascus Master newsletter!' 
    });
    
  } catch (error) {
    console.error('Newsletter subscription error:', error);
    res.status(500).json({ error: 'Failed to subscribe to newsletter' });
  }
});

// Unsubscribe from newsletter
app.post('/api/newsletter/unsubscribe', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    await db.read();
    
    const subscriptionIndex = db.data.newsletters?.findIndex(
      sub => sub.email.toLowerCase() === email.toLowerCase()
    );
    
    if (subscriptionIndex === -1) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    // Mark as inactive instead of deleting
    db.data.newsletters[subscriptionIndex].active = false;
    db.data.newsletters[subscriptionIndex].unsubscribedAt = new Date().toISOString();
    
    await db.write();
    
    res.json({ success: true, message: 'Successfully unsubscribed' });
    
  } catch (error) {
    console.error('Newsletter unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// ========== SUPPORT/CONTACT ENDPOINTS ==========

// Handle support/contact form submissions
app.post('/api/support/contact', async (req, res) => {
  try {
    const { name, email, country, phone, inquiryType, message, newsletter } = req.body;
    
    // Validation
    if (!name || !email || !country || !phone || !message) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
    if (message.length < 10) {
      return res.status(400).json({ error: 'Message must be at least 10 characters long' });
    }
    
    await db.read();
    
    // Initialize support messages array if it doesn't exist
    if (!db.data.supportMessages) {
      db.data.supportMessages = [];
    }
    
    // Create support message record
    const supportMessage = {
      id: uuidv4(),
      name: name.trim(),
      email: email.toLowerCase().trim(),
      country,
      phone: phone.trim(),
      inquiryType: inquiryType || 'general',
      message: message.trim(),
      newsletter: newsletter || false,
      submittedAt: new Date().toISOString(),
      status: 'new',
      priority: inquiryType === 'bulk' ? 'high' : 'normal'
    };
    
    db.data.supportMessages.push(supportMessage);
    await db.write();
    
    // If user wants newsletter subscription
    if (newsletter) {
      const existingSubscription = db.data.newsletters?.find(
        sub => sub.email.toLowerCase() === email.toLowerCase()
      );
      
      if (!existingSubscription) {
        if (!db.data.newsletters) {
          db.data.newsletters = [];
        }
        
        db.data.newsletters.push({
          id: uuidv4(),
          email: email.toLowerCase(),
          preferences: { offers: true, craftsmanship: true },
          subscribedAt: new Date().toISOString(),
          active: true,
          source: 'support_form'
        });
        await db.write();
      }
    }
    
    // Send confirmation email to customer
    // Respond quickly to the client before sending any emails
    res.json({ 
      success: true, 
      message: 'Support request submitted successfully!',
      ticketId: supportMessage.id 
    });

    // Send confirmation email to customer (fire-and-forget)
    try {
      const confirmationEmail = {
        from: `"Damascus Master Support" <${EMAIL_USER}>`,
        to: email,
        subject: 'We Received Your Message - Damascus Master',
        html: `
          <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #2c1810 0%, #8b4513 50%, #daa520 100%); color: #f5f5dc; border-radius: 10px; overflow: hidden;">
            <div style="padding: 40px 30px; text-align: center; background: rgba(0,0,0,0.3);">
              <h1 style="color: #daa520; font-size: 26px; margin: 0 0 20px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
                📧 Message Received!
              </h1>
              
              <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 8px; margin: 20px 0; text-align: left;">
                <h2 style="color: #f5f5dc; margin: 0 0 15px 0; text-align: center;">Hi ${name},</h2>
                <p style="line-height: 1.6; margin: 0 0 15px 0; font-size: 16px;">
                  Thank you for contacting Damascus Master! We've successfully received your ${inquiryType} inquiry and our team will review it shortly.
                </p>
                
                <div style="background: rgba(212,175,55,0.2); padding: 15px; border-radius: 6px; margin: 15px 0;">
                  <h3 style="color: #daa520; margin: 0 0 10px 0; font-size: 16px;">Your Message Details:</h3>
                  <p style="margin: 5px 0; font-size: 14px;"><strong>Inquiry Type:</strong> ${inquiryType}</p>
                  <p style="margin: 5px 0; font-size: 14px;"><strong>Country:</strong> ${country}</p>
                  <p style="margin: 5px 0; font-size: 14px;"><strong>Phone:</strong> ${phone}</p>
                </div>
                
                <p style="line-height: 1.6; margin: 15px 0 0 0; font-size: 16px;">
                  <strong>What's Next?</strong><br>
                  • Our support team will review your message within 24 hours<br>
                  • You'll receive a detailed response via email<br>
                  • For urgent matters, feel free to call us at +1 713-985-0457
                </p>
              </div>
              
              <div style="margin: 30px 0;">
                <p style="font-style: italic; color: #daa520; margin: 0; font-size: 14px;">
                  "Your satisfaction is our priority"
                </p>
              </div>
              
              ${newsletter ? `
              <div style="background: rgba(0,255,0,0.2); padding: 15px; border-radius: 6px; margin: 20px 0;">
                <p style="margin: 0; font-size: 14px; color: #90EE90;">
                  ✅ You've also been subscribed to our newsletter for exclusive updates and offers!
                </p>
              </div>
              ` : ''}
            </div>
          </div>
        `
      };
  sendEmail({ to: confirmationEmail.to, subject: confirmationEmail.subject, html: confirmationEmail.html }).then(r=>{ if(!r.ok) console.error('Confirmation email failed:', r.error); }).catch(()=>{});
    } catch (emailError) {
      console.error('Confirmation email setup failed:', emailError);
    }
    
    // Send notification email to admin (fire-and-forget)
    try {
      const adminNotification = {
        from: `"Damascus Master System" <${EMAIL_USER}>`,
        to: EMAIL_USER,
        subject: `New ${inquiryType} Support Request - ${name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
            <h2 style="color: #d4af37; border-bottom: 2px solid #d4af37; padding-bottom: 10px;">
              🔔 New Support Request
            </h2>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Contact Information:</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Country:</strong> ${country}</p>
              <p><strong>Inquiry Type:</strong> ${inquiryType}</p>
              <p><strong>Newsletter Signup:</strong> ${newsletter ? 'Yes' : 'No'}</p>
              <p><strong>Priority:</strong> ${supportMessage.priority.toUpperCase()}</p>
              <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
            </div>
            
            <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3>Message:</h3>
              <p style="line-height: 1.6; white-space: pre-wrap;">${message}</p>
            </div>
            
            <div style="background: #e8f5e8; padding: 15px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px;">
                <strong>Action Required:</strong> Please respond to this ${inquiryType} inquiry within 24 hours.
              </p>
            </div>
          </div>
        `
      };
      transporter.sendMail(adminNotification).catch(e => console.error('Admin notification failed:', e));
    } catch (emailError) {
      console.error('Admin notification setup failed:', emailError);
    }
    
  } catch (error) {
    console.error('Support form error:', error);
    res.status(500).json({ error: 'Failed to submit support request' });
  }
});

// ========== TWO-FACTOR AUTHENTICATION ENDPOINTS ==========

// Send 2FA code for login
app.post('/api/auth/2fa/send-code', async (req, res) => {
  try {
  const { email, password } = req.body || {};
    
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    
  // Soft rate limit per IP
  const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
  const rl = checkRateLimit(clientIp, 30, 60 * 1000); // 30 requests per minute
  if (!rl.ok) return res.status(429).json({ error: 'Too many requests, slow down' });

  await db.read();
    const user = db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Allow sending 2FA code even when twoFactorAuth is disabled for account deletion
    let bypassAllowed = false;
    try {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'];
      if (authHeader && String(authHeader).startsWith('Bearer ')) {
        const token = String(authHeader).slice(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'damascus-secret');
        if (decoded && decoded.email && decoded.email.toLowerCase() === email.toLowerCase()) bypassAllowed = true;
      }
    } catch (e) {
      // ignore token errors; bypassAllowed stays false
    }

    // If 2FA is disabled for this account, allow sending only when bypassAllowed (token) OR when correct password is provided
    if (!user.preferences?.twoFactorAuth && !bypassAllowed) {
      if (!password) return res.status(400).json({ error: '2FA is not enabled for this account' });
      const validPwd = await bcrypt.compare(String(password), user.password);
      if (!validPwd) return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Prevent re-sending if a valid 2FA code already exists
    const codeKey = `2fa_${email.toLowerCase()}`;
    const existing = verificationCodes.get(codeKey);
    if (existing && Date.now() < existing.expires) {
      return res.status(429).json({ error: '2FA code already sent. Please wait before requesting another.' });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store code with 10-minute expiration
    verificationCodes.set(codeKey, {
      code,
      expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      userId: user.id
    });
    
  // Send 2FA email (attempt, but don't fail the whole request if mail can't be sent)
  const mailOptions = {
      from: `"Damascus Master Security" <${EMAIL_USER}>`,
      to: email,
      subject: 'Your 2FA Code - Damascus Master',
      html: `
        <div style="font-family: 'Georgia', serif; max-width: 600px; margin: 0 auto; background: linear-gradient(135deg, #2c1810 0%, #8b4513 50%, #daa520 100%); color: #f5f5dc; border-radius: 10px; overflow: hidden;">
          <div style="padding: 40px 30px; text-align: center; background: rgba(0,0,0,0.3);">
            <h1 style="color: #daa520; font-size: 28px; margin: 0 0 20px 0; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
              🛡️ Two-Factor Authentication
            </h1>
            
            <div style="background: rgba(255,255,255,0.1); padding: 25px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #f5f5dc; margin: 0 0 15px 0;">Your Login Code</h2>
              <div style="background: rgba(212,175,55,0.3); padding: 20px; border-radius: 8px; margin: 15px 0;">
                <h1 style="color: #daa520; font-size: 36px; margin: 0; letter-spacing: 8px; font-family: monospace;">
                  ${code}
                </h1>
              </div>
              <p style="line-height: 1.6; margin: 15px 0; font-size: 14px; color: #ccc;">
                This code will expire in 10 minutes. If you didn't request this code, please ignore this email.
              </p>
            </div>
            
            <div style="background: rgba(255,165,0,0.2); padding: 15px; border-radius: 6px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px;">
                ⚠️ <strong>Security Tip:</strong> Never share this code with anyone. Damascus Master will never ask for your 2FA code.
              </p>
            </div>
          </div>
        </div>
      `
    };
    
    try {
      await transporter.sendMail(mailOptions);
    } catch (mailErr) {
      console.error('2FA email send failed (non-fatal):', mailErr && mailErr.message || mailErr);
      // continue - we still return success because the code is stored server-side
    }

    res.json({ 
      success: true, 
      message: '2FA code generated and (attempted) to be sent to your email' 
    });
    
  } catch (error) {
    console.error('2FA send code error:', error);
    res.status(500).json({ error: 'Failed to send 2FA code' });
  }
});

// Verify 2FA code and complete login
app.post('/api/auth/2fa/verify-code', async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }
    
    const codeKey = `2fa_${email.toLowerCase()}`;
    const storedCodeData = verificationCodes.get(codeKey);
    
    if (!storedCodeData) {
      return res.status(400).json({ error: 'No 2FA code found. Please request a new code.' });
    }
    
    if (Date.now() > storedCodeData.expires) {
      verificationCodes.delete(codeKey);
      return res.status(400).json({ error: '2FA code has expired. Please request a new code.' });
    }
    
    if (storedCodeData.code !== code) {
      return res.status(400).json({ error: 'Invalid 2FA code' });
    }
    
    // Code is valid, remove it and complete login
    verificationCodes.delete(codeKey);
    
    await db.read();
    const user = db.data.users.find(u => u.id === storedCodeData.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        role: user.role || 'user'
      },
  process.env.JWT_SECRET || 'damascus-secret',
      { expiresIn: '7d' }
    );
    
    // Update last login
    user.lastLogin = new Date().toISOString();
    await db.write();
    // Notify user of successful login only when IP is new (best-effort)
    (async () => {
      try {
        const rawIp = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || '').toString();
        const ip = String(rawIp).split(',')[0].trim();
        const ua = (req.headers['user-agent'] || '').toString();
        if (!Array.isArray(user.knownIps)) user.knownIps = [];
        const known = user.knownIps.map(i => String(i||'').trim()).filter(Boolean);
        if (!known.includes(ip)) {
          const mailOptions = {
            from: `"Damascus Master" <${EMAIL_USER}>`,
            to: user.email,
            subject: 'New login to your Damascus Master account',
            html: `<div style="font-family: Arial, sans-serif;"><h2>New login to your account</h2><p>We detected a login to your account from a new IP.</p><p><strong>IP:</strong> ${ip}</p><p><strong>User Agent:</strong> ${ua}</p><p>If this wasn't you, please change your password immediately.</p></div>`
          };
          transporter.sendMail(mailOptions).catch(e => console.error('2FA login notification failed', e));
          try { user.knownIps.push(ip); await db.write(); } catch(e){ console.warn('Failed to persist known IP', e); }
        }
      } catch (e) { console.error('2FA login notify error', e); }
    })();
    
    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || 'user',
        logo: user.logo,
        preferences: user.preferences || {}
      }
    });
    
  } catch (error) {
    console.error('2FA verify code error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA code' });
  }
});

// Validate password (used by client before sensitive actions)
app.post('/api/auth/validate-password', authenticateToken, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required' });
    await db.read();
    const user = db.data.users.find(u => u.id === req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid password' });
    res.json({ success: true, email: user.email });
  } catch (e) {
    console.error('Validate password error:', e);
    res.status(500).json({ error: 'Failed to validate password' });
  }
});

// Delete account: requires authentication, password, and 2FA code (if provided)
app.delete('/api/auth/delete-account', authenticateToken, async (req, res) => {
  try {
    const { password, code } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Password is required' });

    await db.read();
    const userIndex = db.data.users.findIndex(u => u.id === req.user.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    const user = db.data.users[userIndex];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid password' });

    // If user has 2FA enabled, verify provided code
    if (user.preferences && user.preferences.twoFactorAuth) {
      if (!code) return res.status(400).json({ error: '2FA code required' });
      const codeKey = `2fa_${user.email.toLowerCase()}`;
      const stored = verificationCodes.get(codeKey);
      if (!stored) return res.status(400).json({ error: 'No 2FA code found. Please request a new code.' });
      if (Date.now() > stored.expires) { verificationCodes.delete(codeKey); return res.status(400).json({ error: '2FA code has expired' }); }
      if (stored.code !== String(code)) return res.status(400).json({ error: 'Invalid 2FA code' });
      // remove used code
      verificationCodes.delete(codeKey);
    }

    // Remove user and related data: newsletters and support messages by email
    const userEmail = (user.email || '').toLowerCase();
    const removedUser = db.data.users.splice(userIndex, 1)[0];

    if (Array.isArray(db.data.newsletters)) {
      db.data.newsletters = db.data.newsletters.filter(n => String(n.email||'').toLowerCase() !== userEmail);
    }
    if (Array.isArray(db.data.supportMessages)) {
      db.data.supportMessages = db.data.supportMessages.filter(s => String(s.email||'').toLowerCase() !== userEmail);
    }

    // Remove top-level orders that reference this user's email or id
    if (Array.isArray(db.data.orders)) {
      db.data.orders = db.data.orders.filter(o => {
        const oe = String(o.email || '').toLowerCase();
        const ou = String(o.userId || '').toLowerCase();
        return oe !== userEmail && ou !== String(removedUser.id).toLowerCase();
      });
    }

    // Remove wishlist references from other users
    if (Array.isArray(db.data.users)) {
      for (const u of db.data.users) {
        if (Array.isArray(u.wishlist)) {
          u.wishlist = u.wishlist.filter(item => String(item.ownerEmail || '').toLowerCase() !== userEmail);
        }
      }
    }

    // Remove reviews referencing this user (if reviews exist at top-level)
    if (Array.isArray(db.data.reviews)) {
      db.data.reviews = db.data.reviews.filter(r => String(r.userEmail || '').toLowerCase() !== userEmail && String(r.userId || '').toLowerCase() !== String(removedUser.id).toLowerCase());
    }

    // Optionally remove uploads associated with this user (metadata-based). We won't delete files from disk automatically here,
    // but we will remove DB references to uploaded files that list the user's email or id.
    if (Array.isArray(db.data.uploads)) {
      db.data.uploads = db.data.uploads.filter(u => String(u.uploaderEmail||'').toLowerCase() !== userEmail && String(u.uploaderId||'').toLowerCase() !== String(removedUser.id).toLowerCase());
    }

    await db.write();

    res.json({ success: true, message: 'Account and associated data deleted' });
  } catch (e) {
    console.error('Delete account error:', e);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// List uploaded images
app.get('/api/uploads', authRequired('admin'), async (req, res) => {
  try {
    const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
    let fileData = [];
    try {
      const files = await readdir(uploadsDir);
      const imageFiles = files.filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f));
      fileData = fileData.concat(imageFiles.map(f => ({ name: f, url: '/uploads/' + f })));
    } catch(e) {
      // ignore root uploads read errors
    }

    // Also include avatars subfolder if present
    try {
      const avatarsDir = path.join(uploadsDir, 'avatars');
      const avs = await readdir(avatarsDir);
      const avatarFiles = avs.filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f));
      fileData = fileData.concat(avatarFiles.map(f => ({ name: f, url: '/uploads/avatars/' + f })));
    } catch(e) {
      // ignore avatars read errors
    }

    res.json({ files: fileData });
  } catch (e) {
    res.json({ files: [] }); // Return empty array if uploads directory doesn't exist
  }
});

// Public: list only avatars in uploads/avatars (no auth required)
app.get('/api/uploads/avatars', async (req, res) => {
  try {
    const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
    const avatarsDir = path.join(uploadsDir, 'avatars');
    let fileData = [];
    try {
      const avs = await readdir(avatarsDir);
      const avatarFiles = avs.filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f));
      fileData = avatarFiles.map(f => ({ name: f, url: '/uploads/avatars/' + f }));
    } catch (e) {
      // ignore avatars read errors
    }
    res.json({ files: fileData });
  } catch (e) {
    res.json({ files: [] });
  }
});

// Albums minimal CRUD
const albumSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
app.get('/api/albums', async (_req, res) => { await db.read(); res.json(db.data.albums); });
app.post('/api/albums', authRequired('admin'), async (req, res) => {
  try {
    const data = albumSchema.parse(req.body);
    await db.read();
    const album = { id: uuidv4(), ...data, createdAt: Date.now() };
    db.data.albums.push(album);
    await db.write();
    res.json(album);
  } catch { res.status(400).json({ error: 'Invalid payload' }); }
});
app.put('/api/albums/:id', authRequired('admin'), async (req, res) => {
  try {
    const data = albumSchema.partial().parse(req.body);
    await db.read();
    const a = db.data.albums.find(x => x.id === req.params.id);
    if (!a) return res.status(404).end();
    Object.assign(a, data, { updatedAt: Date.now() });
    await db.write();
    res.json(a);
  } catch { res.status(400).json({ error: 'Invalid payload' }); }
});
app.delete('/api/albums/:id', authRequired('admin'), async (req, res) => {
  await db.read();
  const i = db.data.albums.findIndex(x => x.id === req.params.id);
  if (i === -1) return res.status(404).end();
  const removed = db.data.albums.splice(i, 1)[0];
  await db.write();
  res.json(removed);
});

// Admin endpoints for dashboard
app.get('/api/admin/orders', authRequired('admin'), async (req, res) => {
  try {
    await db.read();
    // Collect top-level orders and per-user orders
    const topOrders = Array.isArray(db.data.orders) ? db.data.orders.slice() : [];
    const userOrders = [];
    for (const u of (db.data.users || [])) {
      if (Array.isArray(u.orders)) {
        for (const o of u.orders) {
          // enrich with user reference (sanitized)
          userOrders.push({ ...o, userId: u.id, userEmail: u.email, userName: u.name });
        }
      }
    }

    const all = topOrders.concat(userOrders);
    all.sort((a, b) => new Date(b.createdAt || b.createdAt || 0) - new Date(a.createdAt || a.createdAt || 0));
    res.json(all);
  } catch (error) {
    console.error('Error fetching admin orders:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

app.get('/api/admin/inquiries', async (req, res) => {
  try {
    await db.read();
    // Support messages historically live under `supportMessages` while newer code used `inquiries`.
    // Merge both so admin dashboard shows all customer messages.
    const legacy = Array.isArray(db.data.inquiries) ? db.data.inquiries.slice() : [];
    const support = Array.isArray(db.data.supportMessages) ? db.data.supportMessages.slice() : [];

    // Normalize timestamps: some entries use `createdAt`, others `submittedAt`.
    const merged = legacy.concat(support).map(item => ({
      ...item,
      _created: item.createdAt || item.submittedAt || item.created || null
    }));

    merged.sort((a, b) => new Date(b._created || 0) - new Date(a._created || 0));

    // Strip helper field before returning
    const out = merged.map(({ _created, ...rest }) => rest);
    res.json(out);
  } catch (error) {
    console.error('Error fetching inquiries:', error);
    res.status(500).json({ error: 'Failed to fetch inquiries' });
  }
});

// Admin: list support messages (support requests submitted via /api/support/contact)
app.get('/api/admin/support-messages', authRequired('admin'), async (req, res) => {
  try {
    await db.read();
    const msgs = db.data.supportMessages || [];
    // newest first
    msgs.sort((a,b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0));
    res.json(msgs);
  } catch (e) {
    console.error('Failed to load support messages', e);
    res.status(500).json({ error: 'Failed to load support messages' });
  }
});

// Admin: list customers (sanitized)
app.get('/api/admin/customers', authRequired('admin'), async (req, res) => {
  try {
    await db.read();
    const customers = (db.data.users || []).map(u => {
      const rest = Object.assign({}, u);
      delete rest.password;
      return {
        id: rest.id,
        email: rest.email,
        name: rest.name,
        username: rest.username,
        phone: rest.phone || '',
        totalSpent: rest.totalSpent || 0,
        ordersCount: (rest.orders || []).length,
        memberSince: rest.memberSince || rest.createdAt || null,
        role: rest.role || 'user'
      };
    });
    res.json(customers);
  } catch (e) {
    console.error('Failed to fetch customers', e);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// Optional endpoint: allow admin-origin or authenticated requests to fetch support messages
app.get('/api/support/messages', authRequired('admin'), async (req, res) => {
  try {
    await db.read();
    res.json(db.data.supportMessages || []);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// ======= DEV-ONLY: Issue a token for testing (disabled by default) =======
// Usage: set ALLOW_DEV_LOGIN=true and DEV_AUTH_KEY in environment, then POST { email, key } to this endpoint.
app.post('/__dev/auth/dev-login', async (req, res) => {
  try {
    if (String(process.env.ALLOW_DEV_LOGIN || '').toLowerCase() !== 'true') {
      return res.status(404).json({ error: 'Not found' });
    }
    const { email, key } = req.body || {};
    if (!email || !key) return res.status(400).json({ error: 'email and key required' });
    if (!process.env.DEV_AUTH_KEY || String(process.env.DEV_AUTH_KEY) !== String(key)) {
      return res.status(403).json({ error: 'Invalid dev key' });
    }
    await db.read();
    const user = db.data.users.find(u => String(u.email || '').toLowerCase() === String(email).toLowerCase());
    if (!user) return res.status(404).json({ error: 'User not found' });
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role || 'user' }, process.env.JWT_SECRET || 'damascus-secret', { expiresIn: '24h' });
    return res.json({ token });
  } catch (e) {
    console.error('Dev login error', e);
    return res.status(500).json({ error: 'Dev login failed' });
  }
});

// Bind to 0.0.0.0 to improve localhost reachability on some Windows setups
const serverInstance = app.listen(PORT, '0.0.0.0', () => {
  const addr = serverInstance.address();
  let host = 'localhost';
  let port = PORT;
  if (typeof addr === 'string') {
    host = addr;
  } else if (addr && typeof addr === 'object') {
    host = (addr.address === '::' || addr.address === '0.0.0.0') ? 'localhost' : addr.address;
    port = addr.port;
  }
  console.log(`Server listening on http://${host}:${port} (env=${PAYPAL_ENV})`);
});

// Log unexpected errors to help diagnose silent exits
process.on('uncaughtException', (err) => {
  try { console.error('uncaughtException:', err && err.stack || err); } catch {}
});
process.on('unhandledRejection', (reason) => {
  try { console.error('unhandledRejection:', reason); } catch {}
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down...');
  try { serverInstance.close(() => process.exit(0)); } catch { process.exit(0); }
});
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down...');
  try { serverInstance.close(() => process.exit(0)); } catch { process.exit(0); }
});

// ------------------ Helpers: Album page auto-generation ------------------
const CATEGORY_CONFIG = [
  { keys: ['axes'],                             filePrefix: 'aalbum', idPrefix: 'ax', backPage: 'Axes.html',             fallbackImg: 'axes.png' },
  { keys: ['hunting-knives','huntingknife'],    filePrefix: 'hnalbum', idPrefix: 'hn', backPage: 'hunting-knives.html',   fallbackImg: 'knives.png' },
  { keys: ['kitchen-knives','kitchenknife'],    filePrefix: 'knalbum', idPrefix: 'kn', backPage: 'kitchen-knives.html',   fallbackImg: 'kn1.png' },
  { keys: ['rings','ring'],                     filePrefix: 'ralbum', idPrefix: 'ri', backPage: 'Rings.html',            fallbackImg: 'rings.png' },
  { keys: ['others','other'],                   filePrefix: 'oalbum', idPrefix: 'ot', backPage: 'Others.html',           fallbackImg: 'custom.png' },
  { keys: ['pocket-knives','pocket','pocketknife','pocket-knife'], filePrefix: 'pkalbum', idPrefix: 'pn', backPage: 'pocket-knives.html', fallbackImg: 'pic1.png' },
  { keys: ['swords','sword'],                   filePrefix: 'swalbum', idPrefix: 'sw', backPage: 'Swords.html',           fallbackImg: 'knives.png' },
];

function resolveCategoryConfig(categoryRaw) {
  const key = String(categoryRaw||'').toLowerCase().trim();
  return CATEGORY_CONFIG.find(c => c.keys.some(k => key === k)) || null;
}

async function nextIndexForPrefix(webRoot, prefix) {
  try {
    const files = await readdir(webRoot);
    const rx = new RegExp(`^${prefix}(\\d+)\\.html$`, 'i');
    let max = 0;
    for (const f of files) {
      const m = f.match(rx);
      if (m) {
        const n = Number(m[1]);
        if (!Number.isNaN(n)) max = Math.max(max, n);
      }
    }
    return max + 1;
  } catch {
    return 1;
  }
}

function sanitizeText(s, fallback='') {
  // Normalize whitespace and strip excessive length
  const text = String(s ?? fallback).replace(/[\r\n]+/g, ' ').slice(0, 800);
  return text;
}

function escapeHtml(s) {
  // Prevent unintended HTML rendering/symbols
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function jsStringLiteral(s) {
  // Safely embed arbitrary strings inside JS inlined in HTML
  return JSON.stringify(String(s ?? ''));
}

function buildAlbumHtml({
  backPage, title, desc, price, mainImage, thumbImages, displayId, selfFile, sale
}) {
  const toRel = (s) => String(s||'').replace(/^\/+/, '');
  // Keep structure consistent with existing album pages while injecting product data
  const rawTitle = sanitizeText(title, 'Product');
  const rawDesc = sanitizeText(desc, '');
  const safeTitle = escapeHtml(rawTitle);
  const safeDesc = escapeHtml(rawDesc);
  const jsTitle = jsStringLiteral(rawTitle);
  const jsDesc = jsStringLiteral(rawDesc);
  const unitPrice = Number(price||0).toFixed(2);
  // If product has sale info, it may be provided via product.sale in the calling context.
  // We will render sale ribbon and sale price client-side when run-time data includes it.
  // Show all provided thumbnails (no hard cap)
  const thumbs = (thumbImages && thumbImages.length ? thumbImages : [mainImage]).map(toRel);
  const thumbsHtml = thumbs.map((src, i) => `<img src="${src}" alt="Image ${i+1}" class="album-thumb${i===0?' selected':''}" data-img="${src}">`).join('\n        ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <style>
    .wishlist-heart { position: absolute; top: 0.7em; right: 0.7em; z-index: 2; background: rgba(24,28,35,0.85); border-radius: 50%; padding: 0.18em; cursor: pointer; transition: background 0.2s; box-shadow: 0 2px 8px #0005; display: flex; align-items: center; justify-content: center; }
    .wishlist-heart:hover { background: #ff4d6d22; }
    .wishlist-heart svg.heart-filled path { fill: #ff4d6d; stroke: #ff4d6d; }
  </style>
  <meta charset="UTF-8">
  <title>${escapeHtml(String(displayId || ''))} - ${safeTitle} | Damascus Master</title>
  <meta name="description" content="${safeDesc}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
  <style>
    body { font-family: 'Poppins', Arial, sans-serif; background: linear-gradient(135deg, #232526 0%, #23262f 100%); color: #f7f7f7; margin: 0; padding: 0; min-height: 100vh; }
    .album-container { max-width: 900px; margin: 2.5rem auto; background: rgba(24,28,35,0.98); border-radius: 1.5rem; box-shadow: 0 8px 40px 0 #0007, 0 1.5px 4px #0002; padding: 2.5rem 2.2rem 2.2rem 2.2rem; display: flex; flex-direction: row; flex-wrap: nowrap; gap: 2.5rem; position: relative; min-height: 520px; border: 1.5px solid #31343b; }
    .album-gallery { flex: 1 1 340px; min-width: 320px; max-width: 420px; display: flex; flex-direction: column; align-items: center; margin-left: 1.5rem; }
    .main-img-wrap { position: relative; width: 100%; max-width: 420px; margin: 0 auto; transition: box-shadow 0.2s, transform 0.2s; }
    .main-img-wrap:hover { box-shadow: 0 8px 32px #0288d199, 0 2px 8px #0003; transform: scale(1.025); }
    .album-main-img { width: 100%; max-width: 100%; height: auto; border-radius: 1.1rem; box-shadow: 0 0.25rem 1rem #0006; display: block; object-fit: contain; background: #232526; }
    .magnifier-lens { position: absolute; border: 2px solid #fff; border-radius: 50%; width: 120px; height: 120px; pointer-events: none; display: none; box-shadow: 0 0 10px #000a; z-index: 2; }
  .album-thumbs { display: flex; gap: 0.5rem; margin-top: 1rem; justify-content: center; flex-wrap: wrap; z-index: 3; }
    .album-thumb { width: 60px; height: 60px; object-fit: cover; border-radius: 0.5rem; cursor: pointer; border: 2px solid transparent; transition: border 0.2s; }
    .album-thumb.selected { border: 2px solid #4fc3f7; }
    .album-info { flex: 1 1 260px; min-width: 260px; display: flex; flex-direction: column; justify-content: flex-start; }
    .album-title { font-size: 2.2rem; font-weight: 700; margin-bottom: 1.1rem; color: #ffb347; letter-spacing: 0.03em; text-shadow: 0 2px 8px #0003; }
  .album-desc { font-size: 1.18rem; line-height: 1.7; margin-bottom: 1.5rem; color: #f7f7f7; background: rgba(255,255,255,0.03); border-radius: 0.7rem; padding: 0.7em 1em; box-shadow: 0 1px 8px #0001; white-space: pre-line; }
  .album-details { font-size: 1.05rem; color: #b0b8c1; margin-bottom: 1.5rem; background: #23262f; border-radius: 0.6rem; padding: 0.7em 1em; box-shadow: 0 1px 8px #0001; white-space: pre-line; }
    .quantity-row { display: flex; align-items: center; gap: 1.2rem; margin-bottom: 1.5rem; }
    .quantity-label { font-weight: 600; color: #4fc3f7; }
    .quantity-input { width: 80px; padding: 0.3rem 0.5rem; border-radius: 0.4rem; border: 1px solid #b0b8c1; font-size: 1rem; background: #fff; color: #181c23; text-align: center; }
    .quantity-value { min-width: 2ch; display: inline-block; text-align: center; }
  .add-btn { background: linear-gradient(90deg, #4fc3f7 0%, #0288d1 100%); color: #fff; border: none; border-radius: 0.5rem; padding: 0.85rem 2.2rem; font-size: 1.15rem; font-weight: 700; cursor: pointer; box-shadow: 0 4px 16px #0288d155, 0 1.5px 4px #0002; letter-spacing: 0.03em; position: relative; overflow: visible; transition: background 0.3s, transform 0.15s, box-shadow 0.3s; z-index: 2; }
    .add-btn::after { content: ''; position: absolute; left: -75%; top: 0; width: 50%; height: 100%; background: rgba(255,255,255,0.18); transform: skewX(-20deg); transition: left 0.4s; }
    .add-btn:hover { background: linear-gradient(90deg, #0288d1 0%, #4fc3f7 100%); color: #fff; transform: translateY(-2px) scale(1.03); box-shadow: 0 8px 24px #0288d199, 0 2px 8px #0003; }
    .add-btn:hover::after { left: 120%; }
    .back-link { position: absolute; top: 1rem; left: 1rem; color: #4fc3f7; text-decoration: none; font-weight: 600; background: #232526; padding: 0.5rem 1rem; border-radius: 0.5rem; box-shadow: 0 2px 8px #0002; z-index: 10; }
    .back-link-space { height: 2.5rem; min-width: 1.5rem; display: block; }
    .back-link:hover { color: #0288d1; background: #181c23; }
    @media (max-width: 700px) { .album-container { flex-direction: column; gap: 0.5rem; padding: 0.3rem; min-height: unset; } .album-gallery, .album-info { max-width: 100%; min-width: 0; } .album-title { font-size: 1.1rem; } .album-desc, .album-details { font-size: 0.95rem; } .back-link { top: 0.3rem; left: 0.3rem; padding: 0.35rem 0.6rem; font-size: 0.95rem; } .main-img-wrap { max-width: 100vw; } .album-main-img { max-width: 100vw; height: auto; object-fit: contain; } .back-link-space { height: 2rem; min-width: 0; } .album-gallery { margin-top: 0.5rem; margin-left: 0; align-items: center; } }
  </style>
</head>
<body data-back="${backPage}">
  <div class="album-container">
    <a href="#" class="back-link" onclick="handleBack(event)">&larr; Back</a>
    <div class="back-link-space"></div>
    <div class="album-gallery">
    <div class="main-img-wrap" style="position:relative;">
  <div class="wishlist-heart" data-id="${displayId}" data-wishlist-title="${safeTitle}" data-wishlist-album="${selfFile}" data-album="${selfFile}" title="Wishlist">
          <svg width="28" height="28" viewBox="0 0 24 24" class="" stroke="#ff4d6d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6.5-4.35-9-7.5C1.5 10.5 2.5 7 6 7c2.1 0 3.5 1.5 4 2.5C10.5 8.5 11.9 7 14 7c3.5 0 4.5 3.5 3 6.5-2.5 3.15-9 7.5-9 7.5z"/></svg>
        </div>
  <img src="${toRel(mainImage)}" alt="${safeTitle}" class="album-main-img" id="mainImg">
        <div class="magnifier-lens" id="magnifierLens"></div>
      </div>
      <div class="album-thumbs">
        ${thumbsHtml}
      </div>
    </div>
    <div class="album-info">
      <div class="album-title">${safeTitle}</div>
      <div class="album-desc">${safeDesc}</div>
  <div class="album-details" id="albumDetails" data-details='${escapeHtml(JSON.stringify({displayId}))}'></div>
      <div class="quantity-row">
        <span class="quantity-label">Quantity:</span>
        <input type="number" min="1" max="99" value="1" class="quantity-input" id="qtyInput">
        <span id="qtyValue" class="quantity-value">1</span>
      </div>
      <div class="price-row" style="display:flex;align-items:center;gap:1.2em;margin-bottom:1.5rem;">
        <span class="price-label" style="font-weight:600;color:#ffb347;">Price per item:</span>
        <span id="unitPrice" style="font-size:1.15rem; background:#fff;color:#000;padding:0.25rem 0.6rem;border-radius:8px;font-weight:800;">$${unitPrice}</span>
        <span class="price-label" style="font-weight:600;color:#4fc3f7;margin-left:2em;">Total:</span>
        <span id="totalPrice" style="font-size:1.25rem;font-weight:700;background:#fff;color:#000;padding:0.25rem 0.6rem;border-radius:8px;">$${unitPrice}</span>
      </div>
      <button class="add-btn" id="addToCatalogue" title="Add to Cart" style="display:flex;align-items:center;gap:0.5em;justify-content:center;">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ffb347" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;"><circle cx="9" cy="21" r="1.5"/><circle cx="18" cy="21" r="1.5"/><path d="M2.5 4h2l2.2 13.2a1 1 0 0 0 1 .8h9.6a1 1 0 0 0 1-.8l1.7-8.7H6.1"/></svg>
        <span style="margin-left:6px;font-weight:700;color:#fff;">Add to cart</span>
      </button>
    </div>
  </div>
<script>
function handleBack(e){
  try{ if(e) e.preventDefault(); }catch{}
  try{
    var params = new URLSearchParams(window.location.search || '');
    var from = String(params.get('from')||'').toLowerCase();
    var cat = String(params.get('cat')||params.get('category')||'').toLowerCase();
    var dataBack = (document.body && document.body.dataset ? document.body.dataset.back : '') || '';
    // Explicit sources first
    if (from === 'order') { window.location.href = 'order.html'; return; }
    if (from === 'wishlist' || from === 'catalogue') { window.location.href = 'index.html'; return; }
    if (from === 'gallery') {
      if (cat) { var pg = cat.replace(/[^a-z0-9-]+/g,'-') + '.html'; window.location.href = pg; return; }
      if (dataBack) { window.location.href = dataBack; return; }
    }
    // Referrer-based fallbacks
    var ref = (document.referrer||'').toLowerCase();
    if (ref.includes('order.html')) { window.location.href = 'order.html'; return; }
    if (ref.includes('wishlist') || ref.includes('catalogue')) { window.location.href = 'index.html'; return; }
    // Category pages
    var cats = ['kitchen-knives','hunting-knives','pocket-knives','swords','axes','rings','others'];
    for (var i=0;i<cats.length;i++){ var c = cats[i]; if (ref.includes(c)) { window.location.href = c + '.html'; return; } }
    if (dataBack) { window.location.href = dataBack; return; }
    if (window.history && window.history.length > 1 && ref) { window.history.back(); return; }
  }catch{}
  try{ window.location.href = 'index.html'; }catch{}
}
// Product constants for inline JS logic
const PROD_ID = '${displayId}';
const PROD_TITLE = ${jsTitle};
const PROD_DESC = ${jsDesc};
const PROD_PRICE = ${unitPrice};
const PROD_ALBUM = '${selfFile}';
// Wishlist logic is centralized in site.js; generated pages provide data-* attributes on .wishlist-heart elements
// If site.js is not present, fall back to a small local helper (to preserve compatibility)
if (typeof window.addToWishlist !== 'function') {
  window.addToWishlist = function(id, title, desc, price, img, album, e){
    try { if(e) e.stopPropagation(); } catch {}
    try {
      // Normalize title/desc to avoid storing objects accidentally
      title = (typeof title === 'string') ? title : (title && typeof title === 'object' ? (title.title || title.name || '') : String(title || ''));
      desc = (typeof desc === 'string') ? desc : (desc && typeof desc === 'object' ? (desc.description || '') : String(desc || ''));
      img = img ? String(img) : '';
      price = (price === undefined || price === null) ? 0 : Number(price) || 0;
      album = album ? String(album) : '';
      // Prefer centralized per-user helpers when available (pages may include site.js later)
      let wishlist = (typeof getWishlist === 'function') ? getWishlist() : JSON.parse(localStorage.getItem('wishlist') || '[]');
      const idx = wishlist.findIndex(item => item.id === id);
      if (idx === -1) wishlist.push({ id, title, desc, price, img, album }); else wishlist.splice(idx, 1);
      if (typeof setWishlist === 'function') setWishlist(wishlist); else localStorage.setItem('wishlist', JSON.stringify(wishlist));
      try { if (typeof window.renderAlbumWishlistHeart === 'function') window.renderAlbumWishlistHeart(); } catch {}
      try { if (typeof window.updateHeaderWishlist === 'function') window.updateHeaderWishlist(); } catch {}
    } catch {}
  }
}
const mainImg = document.getElementById('mainImg');
const lens = document.getElementById('magnifierLens');
if (mainImg && lens) {
  mainImg.addEventListener('mousemove', moveLens);
  mainImg.addEventListener('mouseenter', showLens);
  mainImg.addEventListener('mouseleave', hideLens);
  function showLens(e) { lens.style.display = 'block'; }
  function hideLens(e) { lens.style.display = 'none'; }
  function moveLens(e) {
    const rect = mainImg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const lensSize = lens.offsetWidth / 2;
    let left = x - lensSize;
    let top = y - lensSize;
    left = Math.max(0, Math.min(left, mainImg.width - lens.offsetWidth));
    top = Math.max(0, Math.min(top, mainImg.height - lens.offsetHeight));
    lens.style.left = left + 'px';
    lens.style.top = top + 'px';
    lens.style.background = 'url(' + mainImg.src + ') no-repeat';
    lens.style.backgroundSize = mainImg.width * 2 + 'px ' + mainImg.height * 2 + 'px';
    lens.style.backgroundPosition = '-' + (x * 2 - lensSize) + 'px -' + (y * 2 - lensSize) + 'px';
  }
}
document.addEventListener('DOMContentLoaded', function(){
document.querySelectorAll('.album-thumb').forEach(thumb => {
  thumb.addEventListener('click', function() {
    document.querySelectorAll('.album-thumb').forEach(t => t.classList.remove('selected'));
    this.classList.add('selected');
    if (mainImg) mainImg.src = this.dataset.img || this.getAttribute('data-img');
  });
});
});
const qtyInput = document.getElementById('qtyInput');
const qtyValue = document.getElementById('qtyValue');
const totalPrice = document.getElementById('totalPrice');
function updateQtyDisplay() {
  const qty = parseInt(qtyInput && qtyInput.value, 10) || 1;
  if (qtyValue) qtyValue.textContent = qty;
  var upEl = document.getElementById('unitPrice');
  const unit = upEl ? parseFloat(upEl.textContent.replace(/[^\d.]/g, '')) : 0;
  if (totalPrice) totalPrice.textContent = '$' + (qty * unit).toFixed(2);
}
if (qtyInput) { qtyInput.addEventListener('input', updateQtyDisplay); }
updateQtyDisplay();
var addBtn = document.getElementById('addToCatalogue');
if (addBtn) addBtn.addEventListener('click', function() {
  const gallery = Array.from(document.querySelectorAll('.album-thumb')).map(t => t.getAttribute('data-img'));
  const selectedThumb = document.querySelector('.album-thumb.selected');
  const mainImgSrc = selectedThumb ? (selectedThumb.dataset.img || selectedThumb.getAttribute('data-img')) : (gallery[0] || '${mainImage}');
  const product = {
    // Required identifiers
    id: '${displayId}',
    title: ${jsTitle},
    name: ${jsTitle},
    desc: ${jsDesc},
    album: '${selfFile}',
    // Media
    mainImage: mainImgSrc,
    gallery: gallery,
    galleryImages: gallery,
  // Pricing/qty
  price: ${unitPrice},
  // If album generator provided sale, pass it along so client-side add-to-catalogue keeps sale data
  sale: ${sale ? JSON.stringify(sale) : 'null'},
    quantity: parseInt(qtyInput.value, 10) || 1,
    // Extra details for order payloads
    details: { displayId: '${displayId}' }
  };
  let catalogue = [];
  try { catalogue = JSON.parse(localStorage.getItem('catalogue') || '[]'); } catch (e) { catalogue = []; }
  const idx = catalogue.findIndex(p => p.id === product.id && p.mainImage === product.mainImage);
  if (idx > -1) { catalogue[idx].quantity += product.quantity; } else { catalogue.push(product); }
  localStorage.setItem('catalogue', JSON.stringify(catalogue));
  try { alert('Added to catalogue'); } catch {}
  try { if (typeof window.renderCatalogue === 'function') window.renderCatalogue(); } catch {}
});

// Render details cleanly from data-details (avoid showing raw JSON). Server path only has displayId unless product provided more.
try {
  var detEl = document.getElementById('albumDetails');
  if (detEl) {
    var raw = detEl.getAttribute('data-details');
    var obj = {};
    try { obj = raw ? JSON.parse(raw) : {}; } catch(e) { obj = {}; }
    var parts = [];
    if (obj.blade) parts.push('<strong>Blade:</strong> ' + String(obj.blade));
    if (obj.handle) parts.push('<strong>Handle:</strong> ' + String(obj.handle));
    if (obj.length) parts.push('<strong>Length:</strong> ' + String(obj.length));
    if (obj.weight) parts.push('<strong>Weight:</strong> ' + String(obj.weight));
    if (obj.features) parts.push('<strong>Features:</strong> ' + String(obj.features));
    if (parts.length) {
      detEl.innerHTML = parts.join('<br>');
    } else {
      var vals = []; try {
        var keys = Object.keys(obj).filter(k => /^\d+$/.test(k)).sort((a,b)=>Number(a)-Number(b));
        if (keys.length) keys.forEach(k => vals.push(String(obj[k])));
      } catch {}
      detEl.textContent = vals.length ? vals.join('') : '';
    }
  }
} catch {}

// Wire wishlist heart click using datasets and current selection
document.addEventListener('DOMContentLoaded', function(){
  document.querySelectorAll('.wishlist-heart').forEach(function(heart){
    heart.addEventListener('click', function(e){
      const id = heart.dataset.id || PROD_ID;
      const album = heart.dataset.album || PROD_ALBUM;
      const gallery = Array.from(document.querySelectorAll('.album-thumb')).map(t => t.getAttribute('data-img'));
      const selectedThumb = document.querySelector('.album-thumb.selected');
      const mainImgSrc = selectedThumb ? (selectedThumb.dataset.img || selectedThumb.getAttribute('data-img')) : (gallery[0] || '${mainImage}');
      addToWishlist(id, PROD_TITLE, PROD_DESC, PROD_PRICE, mainImgSrc, album, e);
    });
  });
});
</script>
  // Render sale ribbon and price override when sale info is provided
  (function(){
    try{
      const sale = ${sale ? JSON.stringify(sale) : 'null'};
      if (!sale || !sale.active) return;
      // Compute percent off
      const prev = (sale.prevPrice && Number(sale.prevPrice) > 0) ? Number(sale.prevPrice) : ${Number(price||0)};
      const sp = Number(sale.price || 0);
      const pct = prev > 0 ? Math.round(((prev - sp)/prev)*100) : 0;
      // Add ribbon inside main image wrap
      const mainWrap = document.querySelector('.main-img-wrap');
      if (mainWrap) {
        const ribbon = document.createElement('div');
        ribbon.style.position = 'absolute';
        ribbon.style.top = '12px';
        ribbon.style.left = '-42px';
        ribbon.style.transform = 'rotate(-45deg)';
        ribbon.style.width = '160px';
        ribbon.style.padding = '6px 0';
        ribbon.style.background = '#fff';
        ribbon.style.color = '#000';
        ribbon.style.fontWeight = '800';
        ribbon.style.fontSize = '0.9rem';
        ribbon.style.textAlign = 'center';
        ribbon.style.boxShadow = '0 2px 8px rgba(0,0,0,0.38)';
        ribbon.style.zIndex = '12';
        ribbon.textContent = '-' + pct + '%';
        mainWrap.style.overflow = 'hidden';
        mainWrap.appendChild(ribbon);
      }
      // Update price elements: prefer client-side runtime when placeholders are present.
      try{
        // If the generator/runtime placeholders were emitted to the page, let the client re-render
        // to avoid race conditions with other scripts. If runtime re-render is available, call it
        // after load. Otherwise fall back to writing the DOM now.
        if (typeof window !== 'undefined' && window.__ALBUM_PLACEHOLDERS && window.__ALBUM_PLACEHOLDERS.sale) {
          if (typeof window.__renderAlbumSale === 'function') {
            window.addEventListener('load', function(){ try{ window.__renderAlbumSale(); }catch(e){} });
          } else {
            // runtime not present yet — still attempt a safe write now
            const unitEl = document.getElementById('unitPrice');
            const totalEl = document.getElementById('totalPrice');
            if (unitEl) unitEl.innerHTML = '<span style="text-decoration:line-through;color:#999;margin-right:0.6rem">$' + prev.toFixed(2) + '</span><span style="background:#fff;color:#000;padding:0.2em 0.6em;border-radius:0.4em;font-weight:800">$' + sp.toFixed(2) + '</span>';
            if (totalEl) totalEl.innerHTML = '<span style="background:#fff;color:#000;padding:0.2em 0.6em;border-radius:0.4em;font-weight:800">$' + sp.toFixed(2) + '</span>';
          }
        } else {
          // No placeholders: safe to write directly
          const unitEl = document.getElementById('unitPrice');
          const totalEl = document.getElementById('totalPrice');
          if (unitEl) unitEl.innerHTML = '<span style="text-decoration:line-through;color:#999;margin-right:0.6rem">$' + prev.toFixed(2) + '</span><span style="background:#fff;color:#000;padding:0.2em 0.6em;border-radius:0.4em;font-weight:800">$' + sp.toFixed(2) + '</span>';
          if (totalEl) totalEl.innerHTML = '<span style="background:#fff;color:#000;padding:0.2em 0.6em;border-radius:0.4em;font-weight:800">$' + sp.toFixed(2) + '</span>';
        }
      }catch(e){ /* ignore */ }
    }catch(e){/* ignore */}
  })();
</body>
</html>`;
}

async function maybeGenerateAlbumPage(product, { webRoot }) {
  // Only when no explicit page is provided and we have a category we recognize
  const category = product.category || '';
  if (product.page) return null;
  const cfg = resolveCategoryConfig(category);
  if (!cfg) return null;
  const index = await nextIndexForPrefix(webRoot, cfg.filePrefix);
  const fileName = `${cfg.filePrefix}${index}.html`;
  const displayId = `${cfg.idPrefix}${index}`;
  const images = Array.isArray(product.images) && product.images.length ? product.images : [cfg.fallbackImg];
  const mainImage = images[0];
  const backPage = cfg.backPage;
  const html = buildAlbumHtml({
    backPage,
    title: product.title,
    desc: product.desc || '',
    price: product.price,
    mainImage,
    thumbImages: images,
    displayId,
    selfFile: fileName,
  sale: product.sale || null,
  });
  await writeFile(path.join(webRoot, fileName), html, 'utf8');
  return { page: fileName, displayId };
}

// export for tools / tests that may call it directly
if (typeof module !== 'undefined' && module.exports) module.exports.maybeGenerateAlbumPage = maybeGenerateAlbumPage;

// Rebuild an existing album page when product is updated (e.g., images/title/price changed)
async function rewriteAlbumPage(product, { webRoot }) {
  try {
    if (!product) return;
    let fileName = product.page;
    let addedPage = false;
    if (!fileName) {
      const safeTitle = (product.title || '').replace(/[^a-zA-Z0-9_-]/g,'_').toLowerCase();
      fileName = `${safeTitle}.html`;
      product.page = fileName;
      addedPage = true;
    }
    // Try to preserve displayId; if missing, compute from filename using category mapping
    let displayId = product.details && product.details.displayId;
    let migratedId = false;
    if (!displayId) {
      const base = path.basename(fileName, '.html');
      // Find mapping whose filePrefix matches the page filename
      const cfg = CATEGORY_CONFIG.find(c => base.toLowerCase().startsWith(String(c.filePrefix).toLowerCase()));
      const idx = Number(base.replace(/[^0-9]/g, '')) || 1;
      displayId = cfg ? `${cfg.idPrefix}${idx}` : base;
      product.details = { ...(product.details||{}), displayId };
    } else {
      // Migrate legacy pocket-knives ids from 'pk' to 'pn'
      try {
        const catCfg = resolveCategoryConfig(product.category);
        if (catCfg && catCfg.idPrefix === 'pn' && /^pk\d+$/i.test(String(displayId))) {
          displayId = 'pn' + String(displayId).slice(2);
          product.details = { ...(product.details||{}), displayId };
          migratedId = true;
        }
      } catch {}
    }
    const images = Array.isArray(product.images) && product.images.length ? product.images : [ (resolveCategoryConfig(product.category)?.fallbackImg || product.mainImage || '') ].filter(Boolean);
    const mainImage = images[0];
    const backPage = resolveCategoryConfig(product.category)?.backPage || 'index.html';
    const html = buildAlbumHtml({
      backPage,
      title: product.title,
      desc: product.desc || '',
  price: product.price,
      mainImage,
      thumbImages: images,
      displayId,
      selfFile: fileName,
  sale: product.sale || null,
    });
    await writeFile(path.join(webRoot, fileName), html, 'utf8');
    // Persist newly added page reference if we generated it
    if ((addedPage || migratedId) && product.id) {
      try {
        await db.read();
        const idx = db.data.products.findIndex(x => x.id === product.id);
        if (idx !== -1) {
          db.data.products[idx].page = fileName;
          if (migratedId) {
            db.data.products[idx].details = { ...(db.data.products[idx].details||{}), displayId };
          }
          await db.write();
        }
      } catch (e) {
        console.warn('Failed to persist page for product:', product.id, e?.message || e);
      }
    }
  } catch (e) {
    console.warn('rewriteAlbumPage failed:', e?.message || e);
  }
}
