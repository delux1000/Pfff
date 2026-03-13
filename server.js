// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const multer = require('multer');
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== CONFIGURATION =====
const PORT = process.env.PORT || 10000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || '338989';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'recruit_chat';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || 'https://perfections-recruitment.onrender.com';

// JSONBin.io URL
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// Store admin chat IDs
let adminChatIds = [];
let bot = null;
let isBotRunning = false;

// ===== VALIDATE CONFIG =====
if (!TELEGRAM_BOT_TOKEN) {
  console.error('\n❌ FATAL ERROR: TELEGRAM_BOT_TOKEN is not set');
  process.exit(1);
}

if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
  console.error('\n❌ FATAL ERROR: JSONBIN_API_KEY and JSONBIN_BIN_ID must be set');
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('🚀 PERFECTIONS RECRUITMENT - RENDER DEPLOYMENT');
console.log('='.repeat(60));
console.log(`Environment: ${NODE_ENV}`);
console.log(`Port: ${PORT}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Bot Token: ${TELEGRAM_BOT_TOKEN ? '✅ Configured' : '❌ Missing'}`);
console.log('='.repeat(60) + '\n');

// ===== JSONBin.io FUNCTIONS =====
async function jsonbinGet() {
  try {
    const response = await fetch(JSONBIN_URL, {
      method: 'GET',
      headers: {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Meta': 'false'
      }
    });
    if (!response.ok) throw new Error(`JSONBin GET failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('❌ JSONBin GET error:', error.message);
    return null;
  }
}

async function jsonbinPut(data) {
  try {
    const response = await fetch(JSONBIN_URL, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Meta': 'false'
      },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error(`JSONBin PUT failed: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('❌ JSONBin PUT error:', error.message);
    return null;
  }
}

// ===== DATA ACCESS FUNCTIONS =====
async function getJobs() {
  const data = await jsonbinGet();
  if (data?.jobs) {
    if (Array.isArray(data.jobs)) return data.jobs;
    if (data.jobs.jobs && Array.isArray(data.jobs.jobs)) return data.jobs.jobs;
    return [data.jobs];
  }
  return [];
}

async function saveJobs(jobsArray) {
  const data = await jsonbinGet() || {};
  data.jobs = jobsArray;
  return await jsonbinPut(data);
}

async function getMessages() {
  const data = await jsonbinGet();
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function saveMessages(messages) {
  const data = await jsonbinGet() || {};
  data.messages = messages;
  return await jsonbinPut(data);
}

async function getUsers() {
  const data = await jsonbinGet();
  return Array.isArray(data?.users) ? data.users : [];
}

async function saveUsers(users) {
  const data = await jsonbinGet() || {};
  data.users = users;
  return await jsonbinPut(data);
}

async function findUserByEmail(email) {
  const users = await getUsers();
  return users.find(u => u.email?.toLowerCase() === email?.toLowerCase());
}

async function getApplications() {
  const data = await jsonbinGet();
  return Array.isArray(data?.applications) ? data.applications : [];
}

async function saveApplications(apps) {
  const data = await jsonbinGet() || {};
  data.applications = apps;
  return await jsonbinPut(data);
}

async function getTelegramChats() {
  const data = await jsonbinGet();
  return Array.isArray(data?.telegram) ? data.telegram : [];
}

async function saveTelegramChats(chats) {
  const data = await jsonbinGet() || {};
  data.telegram = chats;
  return await jsonbinPut(data);
}

// ===== MIDDLEWARE =====
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] }));
app.use(compression());
app.use(morgan('combined'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('Invalid file type'));
  }
});

// ===== NTFY NOTIFICATION =====
async function sendNtfyNotification(title, message, priority = 3, tags = []) {
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: JSON.stringify({ topic: NTFY_TOPIC, title, message, priority, tags, click: BASE_URL }),
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) { 
    console.error('Failed to send ntfy notification:', error); 
  }
}

// ===== NOTIFY ADMINS =====
async function notifyAllAdmins(message, options = {}) {
  for (const chatId of adminChatIds) {
    try {
      if (bot) await bot.sendMessage(chatId, message, options);
    } catch (error) {
      console.error(`Failed to notify admin ${chatId}:`, error.message);
    }
  }
}

// ===== JOB ALERTS =====
async function sendJobAlertsToAllUsers() {
  try {
    const users = await getUsers();
    const jobsArray = await getJobs();
    const activeJobs = jobsArray.filter(j => j?.status === 'active').slice(0, 5);
    if (activeJobs.length === 0) return;

    let jobsMessage = '📢 *Latest Job Opportunities*\n\n';
    activeJobs.forEach((job, index) => {
      jobsMessage += `${index+1}. ${job.title || 'Job'}\n   🏢 ${job.company || 'Company'} - ${job.location || 'UK'}\n   💷 ${job.salary || 'Competitive'}\n   ⏰ ${job.type || 'Full Time'} | ${job.payment_type || 'yearly'}\n\n`;
    });
    jobsMessage += `🔗 [Apply Now](${BASE_URL}/jobs)`;

    const telegramChats = await getTelegramChats();
    for (const chat of telegramChats) {
      if (chat.isAdmin) continue;
      try {
        if (bot) {
          await bot.sendMessage(chat.chatId, jobsMessage, { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 View All Jobs', url: `${BASE_URL}/jobs` }],
                [{ text: '💬 Chat with Us', url: `${BASE_URL}/chat` }]
              ]
            }
          });
        }
      } catch (e) {}
    }

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId) {
        client.send(JSON.stringify({ type: 'job_alert', jobs: activeJobs, message: 'New job opportunities!' }));
      }
    });

    console.log('📢 Job alerts sent');
    await sendNtfyNotification('📢 Job Alerts', `Sent ${activeJobs.length} jobs`, 3, ['megaphone']);
  } catch (error) {
    console.error('Error sending job alerts:', error);
  }
}

// Schedule job alerts
cron.schedule('0 */2 * * *', () => {
  console.log('🕐 Running scheduled job alerts...');
  sendJobAlertsToAllUsers();
});

// ===== TELEGRAM BOT SETUP =====
async function setupTelegramBot() {
  if (isBotRunning) {
    console.log('🤖 Bot already running, skipping initialization');
    return;
  }

  try {
    // Ensure no existing bot instance
    if (bot) {
      try {
        await bot.stopPolling();
      } catch (e) {}
    }

    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
      polling: true,
      onlyFirstMatch: true,
      request: {
        url: 'https://api.telegram.org',
        agent: null,
        timeout: 30000
      }
    });
    
    isBotRunning = true;
    console.log('✅ Telegram bot initialized successfully');

    // Handle /start
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name || 'User';

      const jobs = await getJobs();
      const activeJobs = jobs.filter(j => j?.status === 'active').slice(0, 3);

      let jobsPreview = '';
      activeJobs.forEach((job, i) => {
        jobsPreview += `${i+1}. ${job.title || 'Job'}\n   🏢 ${job.company || 'Company'} - 💷 ${job.salary || 'Competitive'}\n`;
      });

      const welcomeMessage = 
        `👋 *Welcome ${firstName} to Perfections Recruitment!* 🇬🇧\n\n` +
        `🌟 *Your Trusted Recruitment Partner*\n\n` +
        `🔍 *Today's Featured Jobs:*\n${jobsPreview || 'No jobs available'}\n\n` +
        `📧 *To get started, please enter your email address:*`;

      await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Browse All Jobs', url: `${BASE_URL}/jobs` }],
            [{ text: '💬 Live Chat', url: `${BASE_URL}/chat` }]
          ]
        }
      });
    });

    // Handle messages
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'User';
      const username = msg.from.username || 'No username';

      if (!text || text.startsWith('/')) return;

      // Admin code check
      if (text === ADMIN_ACCESS_CODE) {
        if (!adminChatIds.includes(chatId)) adminChatIds.push(chatId);
        
        const telegramChats = await getTelegramChats();
        if (!telegramChats.find(c => c.chatId === chatId.toString())) {
          telegramChats.push({
            chatId: chatId.toString(),
            telegramId,
            username,
            firstName,
            isAdmin: true,
            registeredAt: new Date().toISOString()
          });
          await saveTelegramChats(telegramChats);
        }

        const users = await getUsers();
        const jobs = await getJobs();
        const applications = await getApplications();
        const messages = await getMessages();

        const stats = {
          users: users.length,
          jobs: jobs.filter(j => j?.status === 'active').length,
          applications: applications.length,
          unread: messages.filter(m => !m.read && !m.isAdmin).length
        };

        const adminMessage = 
          `👑 *Admin Dashboard*\n\n` +
          `📊 *Statistics:*\n` +
          `• 👥 Users: ${stats.users}\n` +
          `• 📋 Active Jobs: ${stats.jobs}\n` +
          `• 📝 Applications: ${stats.applications}\n` +
          `• 💬 Unread: ${stats.unread}\n\n` +
          `🛠️ *Commands:* /users /broadcast /sendalerts /stats`;

        await bot.sendMessage(chatId, adminMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📱 Open Admin Web', url: `${BASE_URL}/admin` }]
            ]
          }
        });

        await notifyAllAdmins(
          `👑 *New Admin Logged In*\n\n• Name: ${firstName}\n• Telegram: @${username}`,
          { parse_mode: 'Markdown' }
        );
        
        return;
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(text)) {
        let user = await findUserByEmail(text);

        if (!user) {
          const userId = uuidv4();
          user = {
            userId,
            email: text.toLowerCase(),
            userName: firstName,
            telegramId,
            telegramChatId: chatId.toString(),
            username,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            unreadCount: 0,
            preferences: { jobAlerts: true }
          };
          
          const users = await getUsers();
          users.push(user);
          await saveUsers(users);

          const telegramChats = await getTelegramChats();
          telegramChats.push({
            chatId: chatId.toString(),
            telegramId,
            userId,
            email: text.toLowerCase(),
            firstName,
            username,
            isAdmin: false,
            registeredAt: new Date().toISOString()
          });
          await saveTelegramChats(telegramChats);

          const jobs = await getJobs();
          const recommendedJobs = jobs.filter(j => j?.status === 'active').slice(0, 3);

          let jobsList = '';
          recommendedJobs.forEach((job, i) => {
            jobsList += `${i+1}. ${job.title || 'Job'} - ${job.salary || 'Competitive'}\n`;
          });

          await bot.sendMessage(chatId, 
            `✅ *Welcome ${firstName}!* 🎉\n\nYour account has been created.\n\n🎯 *Recommended Jobs:*\n${jobsList || 'No jobs available'}\n\nUse /help for commands.`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 Browse Jobs', url: `${BASE_URL}/jobs` }]] } }
          );

          await notifyAllAdmins(
            `👤 *New User*\n\n• Name: ${firstName}\n• Email: ${text}\n• Telegram: @${username}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          user.lastSeen = new Date().toISOString();
          user.telegramId = telegramId;
          user.telegramChatId = chatId.toString();
          
          const users = await getUsers();
          const index = users.findIndex(u => u.email === text.toLowerCase());
          if (index !== -1) {
            users[index] = user;
            await saveUsers(users);
          }

          const messages = await getMessages();
          const unreadCount = messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length;

          await bot.sendMessage(chatId,
            `👋 *Welcome back ${firstName}!*\n\n📨 You have *${unreadCount}* unread messages.\n\nEmail: ${user.email}`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 View Jobs', url: `${BASE_URL}/jobs` }]] } }
          );
        }
      } else {
        await bot.sendMessage(chatId, 
          `❌ *Invalid Email*\n\nPlease enter a valid email address (e.g., name@example.com)`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Help command
    bot.onText(/\/help/, async (msg) => {
      await bot.sendMessage(msg.chat.id, 
        `🤖 *Bot Commands*\n\n• /start - Register\n• /jobs - Browse jobs\n• /help - This menu\n\n💬 [Live Chat](${BASE_URL}/chat)`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '💬 Live Chat', url: `${BASE_URL}/chat` }]] } }
      );
    });

    // Jobs command
    bot.onText(/\/jobs/, async (msg) => {
      const jobs = await getJobs();
      const activeJobs = jobs.filter(j => j?.status === 'active').slice(0, 5);
      let message = '📋 *Latest Jobs*\n\n';
      if (activeJobs.length === 0) {
        message += 'No jobs available.';
      } else {
        activeJobs.forEach((job, i) => {
          message += `${i+1}. *${job.title || 'Job'}*\n   🏢 ${job.company || 'Company'} - ${job.location || 'UK'}\n   💷 ${job.salary || 'Competitive'}\n\n`;
        });
      }
      message += `\n🔗 [See all jobs](${BASE_URL}/jobs)`;
      await bot.sendMessage(msg.chat.id, message, { parse_mode: 'Markdown' });
    });

    // Users command (admin)
    bot.onText(/\/users/, async (msg) => {
      if (!adminChatIds.includes(msg.chat.id)) return;
      const users = await getUsers();
      let response = '👥 *Users:*\n\n';
      users.slice(0, 10).forEach((u, i) => {
        response += `${i+1}. *${u.userName || 'Unknown'}*\n   📧 ${u.email || 'No email'}\n   📨 Unread: ${u.unreadCount || 0}\n\n`;
      });
      await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
    });

    // Broadcast (admin)
    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
      if (!adminChatIds.includes(msg.chat.id)) return;
      const broadcastMsg = match[1];
      const users = await getUsers();
      let sent = 0;
      for (const user of users) {
        if (user.telegramChatId) {
          try {
            await bot.sendMessage(user.telegramChatId, `📢 *Announcement:*\n\n${broadcastMsg}`, { parse_mode: 'Markdown' });
            sent++;
          } catch (e) {}
        }
      }
      await bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${sent} users`);
    });

    // Send alerts (admin)
    bot.onText(/\/sendalerts/, async (msg) => {
      if (!adminChatIds.includes(msg.chat.id)) return;
      await sendJobAlertsToAllUsers();
      await bot.sendMessage(msg.chat.id, '✅ Job alerts sent');
    });

    // Stats (admin)
    bot.onText(/\/stats/, async (msg) => {
      if (!adminChatIds.includes(msg.chat.id)) return;
      const users = await getUsers();
      const jobs = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();
      await bot.sendMessage(msg.chat.id,
        `📊 *Statistics*\n\n👥 Users: ${users.length}\n📋 Active Jobs: ${jobs.filter(j => j?.status === 'active').length}\n📝 Applications: ${applications.length}\n💬 Messages: ${messages.length}\n📨 Unread: ${messages.filter(m => !m.read && !m.isAdmin).length}`,
        { parse_mode: 'Markdown' }
      );
    });

    console.log('🤖 Telegram bot fully configured');

  } catch (error) {
    console.error('❌ Telegram bot error:', error);
    isBotRunning = false;
  }
}

// Start bot
setupTelegramBot();

// ===== WEB SOCKET =====
wss.on('connection', (ws) => {
  ws.clientId = uuidv4();

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      if (message.type === 'register') {
        ws.userId = message.userId;
        ws.userName = message.userName;
        ws.email = message.email?.toLowerCase();
        ws.isAdmin = message.isAdmin || false;

        const users = await getUsers();
        let user = users.find(u => u.email === ws.email);
        if (!user) {
          user = { userId: uuidv4(), email: ws.email, userName: ws.userName, createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), unreadCount: 0 };
          users.push(user);
          await saveUsers(users);
          ws.userId = user.userId;
        } else {
          user.lastSeen = new Date().toISOString();
          await saveUsers(users);
          ws.userId = user.userId;
        }

        const messages = await getMessages();
        ws.send(JSON.stringify({ type: 'history', messages: messages.filter(m => m.userId === ws.userId) }));
      }

      if (message.type === 'chat') {
        const users = await getUsers();
        const user = users.find(u => u.email === message.email?.toLowerCase());
        const newMessage = {
          id: Date.now(),
          userId: user?.userId || message.userId,
          userEmail: message.email?.toLowerCase(),
          userName: message.userName,
          message: message.text,
          isAdmin: message.isAdmin || false,
          timestamp: new Date().toISOString(),
          read: false
        };

        const messages = await getMessages();
        messages.push(newMessage);
        await saveMessages(messages);

        if (user && !message.isAdmin) {
          user.unreadCount = (user.unreadCount || 0) + 1;
          await saveUsers(users);
        }

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
          }
        });

        if (!message.isAdmin) {
          await notifyAllAdmins(
            `💬 *New Message*\n\n👤 From: ${message.userName} (${message.email})\n📝 ${message.text}\n\n[Reply](${BASE_URL}/admin)`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    } catch (error) {
      console.error('WebSocket error:', error);
    }
  });
});

// ===== API ROUTES =====
app.get('/api/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString() }));

app.get('/api/jobs', async (req, res) => {
  try {
    const jobsArray = await getJobs();
    res.json({ jobs: Array.isArray(jobsArray) ? jobsArray : [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

app.post('/api/user/check', async (req, res) => {
  try {
    const user = await findUserByEmail(req.body.email);
    res.json(user ? { exists: true, userId: user.userId, userName: user.userName } : { exists: false });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/user/create', async (req, res) => {
  try {
    const { email, userName } = req.body;
    const normalizedEmail = email.toLowerCase();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) return res.json({ success: true, userId: existing.userId, userName: existing.userName });

    const users = await getUsers();
    const newUser = { userId: uuidv4(), email: normalizedEmail, userName: userName || normalizedEmail.split('@')[0], createdAt: new Date().toISOString(), lastSeen: new Date().toISOString(), unreadCount: 0 };
    users.push(newUser);
    await saveUsers(users);
    res.json({ success: true, userId: newUser.userId, userName: newUser.userName });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await getUsers();
    const messages = await getMessages();
    res.json(users.map(u => ({ ...u, unread: messages.filter(m => m.userId === u.userId && !m.read && !m.isAdmin).length })));
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/send', async (req, res) => {
  try {
    const { email, message } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newMessage = { id: Date.now(), userId: user.userId, userEmail: email.toLowerCase(), userName: 'Admin', message, isAdmin: true, timestamp: new Date().toISOString(), read: true };
    const messages = await getMessages();
    messages.push(newMessage);
    await saveMessages(messages);

    wss.clients.forEach(client => {
      if (client.userId === user.userId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
      }
    });

    if (user.telegramChatId && bot) {
      try { await bot.sendMessage(user.telegramChatId, `💬 *Admin Message:*\n\n${message}`); } catch (e) {}
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/mark-read/:email', async (req, res) => {
  try {
    const user = await findUserByEmail(req.params.email);
    if (!user) return res.json({ success: true });

    const messages = await getMessages();
    messages.forEach(m => { if (m.userId === user.userId && !m.isAdmin) m.read = true; });
    await saveMessages(messages);

    const users = await getUsers();
    const idx = users.findIndex(u => u.email === req.params.email.toLowerCase());
    if (idx !== -1) { users[idx].unreadCount = 0; await saveUsers(users); }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/unread', async (req, res) => {
  try {
    const messages = await getMessages();
    res.json({ unread: messages.filter(m => !m.read && !m.isAdmin).length });
  } catch (error) {
    res.json({ unread: 0 });
  }
});

// ===== SERVE HTML PAGES =====
const pages = ['index.html', 'about.html', 'services.html', 'candidates.html', 'employers.html', 'jobs.html', 'testimonials.html', 'contact.html', 'careers.html', 'blog.html', 'funding.html', 'chat.html', 'admin.html', '404.html'];
pages.forEach(page => {
  const route = page === 'index.html' ? '/' : `/${page.replace('.html', '')}`;
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', page)));
});

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

// ===== START SERVER =====
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PERFECTIONS RECRUITMENT - RUNNING ON RENDER');
  console.log('='.repeat(60));
  console.log(`\n📡 Server: ${BASE_URL}`);
  console.log(`💬 Chat:   ${BASE_URL}/chat`);
  console.log(`👑 Admin:  ${BASE_URL}/admin`);
  console.log(`📋 Jobs:   ${BASE_URL}/jobs`);
  console.log(`🤖 Bot: ✅ Active`);
  console.log(`👑 Admin Code: ${ADMIN_ACCESS_CODE}`);
  console.log(`📢 Ntfy: ${NTFY_TOPIC}`);
  console.log('='.repeat(60) + '\n');
});
