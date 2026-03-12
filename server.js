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
let adminSessions = {}; // Store admin session data (selected user, etc.)

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

async function findUserById(userId) {
  const users = await getUsers();
  return users.find(u => u.userId === userId);
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

async function notifyNewJob(job) {
  try {
    const message = `🎉 *NEW JOB ADDED!*\n\n${job.title || 'New Job'}\n🏢 ${job.company || 'Company'} - ${job.location || 'UK'}\n💷 ${job.salary || 'Competitive'}\n⏰ ${job.type || 'Full Time'} | ${job.payment_type || 'yearly'}\n\n🔗 [Apply Now](${BASE_URL}/jobs)`;

    const telegramChats = await getTelegramChats();
    for (const chat of telegramChats) {
      if (chat.isAdmin) continue;
      try {
        if (bot) await bot.sendMessage(chat.chatId, message, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📋 View Job', url: `${BASE_URL}/jobs` }]] } });
      } catch (e) {}
    }

    await notifyAllAdmins(`👑 *New Job Added*\n\n${job.title}\n🏢 ${job.company}\n💷 ${job.salary}`, { parse_mode: 'Markdown' });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId) {
        client.send(JSON.stringify({ type: 'new_job_alert', job, message: 'New job just posted!' }));
      }
    });

    await sendNtfyNotification('📢 New Job Added', `${job.title} at ${job.company}`, 4, ['new', 'briefcase']);
  } catch (error) {
    console.error('Error notifying new job:', error);
  }
}

// Schedule job alerts
cron.schedule('0 */2 * * *', () => {
  console.log('🕐 Running scheduled job alerts...');
  sendJobAlertsToAllUsers();
});

// ===== TELEGRAM BOT SETUP WITH FULL ADMIN PANEL =====
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

    // ===== USER COMMANDS =====
    
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
        `📧 *To get started, please enter your email address:*\n\n` +
        `_Admins: Enter the admin code to access the admin panel_`;

      await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Browse All Jobs', url: `${BASE_URL}/jobs` }],
            [{ text: '💬 Live Chat', url: `${BASE_URL}/chat` }],
            [{ text: '🔍 Search Jobs', callback_data: 'search_jobs' }]
          ]
        }
      });
    });

    // Handle email input or admin code
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'User';
      const username = msg.from.username || 'No username';

      if (!text || text.startsWith('/')) return;

      // Check for admin code
      if (text === ADMIN_ACCESS_CODE) {
        // Add to admin list if not already
        if (!adminChatIds.includes(chatId)) {
          adminChatIds.push(chatId);
        }
        
        // Store admin in telegram collection
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

        // Initialize admin session
        adminSessions[chatId] = { step: 'main_menu' };

        // Show main admin panel
        await showAdminMainMenu(chatId);
        
        // Notify other admins
        await notifyAllAdmins(
          `👑 *New Admin Logged In*\n\n• Name: ${firstName}\n• Telegram: @${username}`,
          { parse_mode: 'Markdown' }
        );

        await sendNtfyNotification('👑 Admin Login', `${firstName} logged in as admin`, 4, ['locked']);
        
        return;
      }

      // Email validation for regular users
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(text)) {
        let user = await findUserByEmail(text);

        if (!user) {
          // Create new user
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
            `✅ *Welcome ${firstName}!* 🎉\n\nYour account has been created with email: ${text}\n\n🎯 *Recommended Jobs:*\n${jobsList || 'No jobs available'}\n\nUse the buttons below to explore:`,
            { 
              parse_mode: 'Markdown', 
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 Browse Jobs', url: `${BASE_URL}/jobs` }],
                  [{ text: '💬 Chat with Us', url: `${BASE_URL}/chat` }],
                  [{ text: '🔔 Job Alerts', callback_data: 'user_alerts' }]
                ]
              }
            }
          );

          await notifyAllAdmins(
            `👤 *New User Registered*\n\n• Name: ${firstName}\n• Email: ${text}\n• Telegram: @${username}`,
            { parse_mode: 'Markdown' }
          );

          await sendNtfyNotification('👤 New User', `${firstName} (${text}) registered`, 3, ['bust_in_silhouette']);

        } else {
          // Existing user
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
            { 
              parse_mode: 'Markdown', 
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📋 View Jobs', url: `${BASE_URL}/jobs` }],
                  [{ text: '💬 Open Chat', url: `${BASE_URL}/chat` }],
                  [{ text: '📊 My Applications', callback_data: 'my_applications' }]
                ]
              }
            }
          );
        }
      } else {
        await bot.sendMessage(chatId, 
          `❌ *Invalid Email*\n\nPlease enter a valid email address (e.g., name@example.com)`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // ===== ADMIN PANEL FUNCTIONS =====
    
    async function showAdminMainMenu(chatId) {
      const users = await getUsers();
      const jobs = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();
      const telegramChats = await getTelegramChats();

      const stats = {
        users: users.length,
        activeJobs: jobs.filter(j => j?.status === 'active').length,
        totalJobs: jobs.length,
        applications: applications.length,
        unread: messages.filter(m => !m.read && !m.isAdmin).length,
        telegramUsers: telegramChats.filter(c => !c.isAdmin).length,
        admins: adminChatIds.length
      };

      const adminMessage = 
        `👑 *Admin Dashboard*\n\n` +
        `📊 *System Statistics:*\n` +
        `• 👥 Total Users: ${stats.users}\n` +
        `• 📋 Active Jobs: ${stats.activeJobs}\n` +
        `• 📝 Applications: ${stats.applications}\n` +
        `• 💬 Unread Messages: ${stats.unread}\n` +
        `• 🤖 Telegram Users: ${stats.telegramUsers}\n` +
        `• 👑 Active Admins: ${stats.admins}\n\n` +
        `🛠️ *Select an option below:*`;

      await bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '👥 Manage Users', callback_data: 'admin_users' }],
            [{ text: '📋 Manage Jobs', callback_data: 'admin_jobs' }],
            [{ text: '💬 Messages', callback_data: 'admin_messages' }],
            [{ text: '📊 Applications', callback_data: 'admin_applications' }],
            [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
            [{ text: '📈 Statistics', callback_data: 'admin_stats' }],
            [{ text: '🔄 Refresh', callback_data: 'admin_refresh' }]
          ]
        }
      });
    }

    async function showUserList(chatId, page = 0) {
      const users = await getUsers();
      const messages = await getMessages();
      const pageSize = 5;
      const start = page * pageSize;
      const end = start + pageSize;
      const paginatedUsers = users.slice(start, end);
      
      let message = `👥 *Users List (Page ${page+1}/${Math.ceil(users.length/pageSize)})*\n\n`;
      
      for (const user of paginatedUsers) {
        const unread = messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length;
        const status = user.telegramId ? '🤖' : '🌐';
        message += `${status} *${user.userName || 'Unknown'}*\n`;
        message += `   📧 ${user.email || 'No email'}\n`;
        message += `   📨 Unread: ${unread}\n`;
        message += `   🕐 Last: ${user.lastSeen ? new Date(user.lastSeen).toLocaleDateString() : 'Never'}\n\n`;
      }

      const keyboard = [];
      const row = [];
      
      if (page > 0) {
        row.push({ text: '⬅️ Previous', callback_data: `users_page_${page-1}` });
      }
      if (end < users.length) {
        row.push({ text: 'Next ➡️', callback_data: `users_page_${page+1}` });
      }
      if (row.length > 0) {
        keyboard.push(row);
      }
      
      keyboard.push([{ text: '🔍 Search User', callback_data: 'admin_search_user' }]);
      keyboard.push([{ text: '« Back to Main Menu', callback_data: 'admin_back_main' }]);

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    async function showUserDetail(chatId, userEmail) {
      const user = await findUserByEmail(userEmail);
      if (!user) {
        await bot.sendMessage(chatId, '❌ User not found');
        return;
      }

      const messages = await getMessages();
      const userMessages = messages.filter(m => m.userId === user.userId);
      const unread = userMessages.filter(m => !m.read && !m.isAdmin).length;
      const applications = await getApplications();
      const userApps = applications.filter(a => a.userId === user.userId);

      const message = 
        `👤 *User Details*\n\n` +
        `• Name: ${user.userName}\n` +
        `• Email: ${user.email}\n` +
        `• Registered: ${new Date(user.createdAt).toLocaleDateString()}\n` +
        `• Last Seen: ${user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'Never'}\n` +
        `• Total Messages: ${userMessages.length}\n` +
        `• Unread: ${unread}\n` +
        `• Applications: ${userApps.length}\n` +
        `• Telegram: ${user.telegramId ? '✅ Connected' : '❌ Not Connected'}`;

      adminSessions[chatId] = { step: 'user_detail', userEmail: user.email };

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 View Messages', callback_data: `user_messages_${user.email}` }],
            [{ text: '✉️ Send Message', callback_data: `user_send_${user.email}` }],
            [{ text: '📋 Applications', callback_data: `user_apps_${user.email}` }],
            [{ text: '🔙 Back to Users', callback_data: 'admin_users' }],
            [{ text: '« Main Menu', callback_data: 'admin_back_main' }]
          ]
        }
      });
    }

    async function showUserMessages(chatId, userEmail) {
      const user = await findUserByEmail(userEmail);
      if (!user) {
        await bot.sendMessage(chatId, '❌ User not found');
        return;
      }

      const messages = await getMessages();
      const userMessages = messages.filter(m => m.userId === user.userId).slice(-10);

      let message = `💬 *Messages with ${user.userName}*\n\n`;
      
      if (userMessages.length === 0) {
        message += 'No messages yet.';
      } else {
        userMessages.forEach((msg, i) => {
          const sender = msg.isAdmin ? '👑 Admin' : '👤 User';
          const date = new Date(msg.timestamp).toLocaleString();
          message += `${sender} [${date}]:\n${msg.message}\n\n`;
        });
      }

      adminSessions[chatId] = { step: 'viewing_messages', userEmail: user.email };

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '✉️ Reply to User', callback_data: `user_send_${user.email}` }],
            [{ text: '🔙 Back to User', callback_data: `user_detail_${user.email}` }],
            [{ text: '« Main Menu', callback_data: 'admin_back_main' }]
          ]
        }
      });
    }

    async function promptForUserMessage(chatId, userEmail) {
      const user = await findUserByEmail(userEmail);
      adminSessions[chatId] = { step: 'awaiting_reply', userEmail: user.email };
      
      await bot.sendMessage(chatId, 
        `✉️ *Send Message to ${user.userName}*\n\nPlease type your message below:`,
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
      );
    }

    async function sendMessageToUser(chatId, userEmail, messageText) {
      const user = await findUserByEmail(userEmail);
      if (!user) {
        await bot.sendMessage(chatId, '❌ User not found');
        return;
      }

      const newMessage = {
        id: Date.now(),
        userId: user.userId,
        userEmail: user.email,
        userName: 'Admin',
        message: messageText,
        isAdmin: true,
        timestamp: new Date().toISOString(),
        read: true
      };

      const messages = await getMessages();
      messages.push(newMessage);
      await saveMessages(messages);

      // Send via WebSocket if user is online
      let sent = false;
      wss.clients.forEach((client) => {
        if (client.userId === user.userId && client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
          sent = true;
        }
      });

      // Send via Telegram if user has telegram
      if (user.telegramChatId) {
        try {
          await bot.sendMessage(user.telegramChatId, 
            `💬 *Admin Message:*\n\n${messageText}\n\n[Reply in Web Chat](${BASE_URL}/chat)`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {}
      }

      await bot.sendMessage(chatId, 
        `✅ Message sent to ${user.userName}${sent ? ' (User was online)' : ''}`,
        { parse_mode: 'Markdown' }
      );

      // Return to user detail
      await showUserDetail(chatId, user.email);
    }

    async function showJobList(chatId, page = 0) {
      const jobs = await getJobs();
      const activeJobs = jobs.filter(j => j?.status === 'active');
      const pageSize = 5;
      const start = page * pageSize;
      const end = start + pageSize;
      const paginatedJobs = activeJobs.slice(start, end);
      
      let message = `📋 *Jobs List (Page ${page+1}/${Math.ceil(activeJobs.length/pageSize)})*\n\n`;
      
      paginatedJobs.forEach((job, i) => {
        message += `${start + i + 1}. *${job.title || 'Untitled'}*\n`;
        message += `   🏢 ${job.company || 'N/A'} - ${job.location || 'N/A'}\n`;
        message += `   💷 ${job.salary || 'N/A'}\n`;
        message += `   📊 Status: ${job.status}\n\n`;
      });

      const keyboard = [];
      const navRow = [];
      
      if (page > 0) {
        navRow.push({ text: '⬅️ Previous', callback_data: `jobs_page_${page-1}` });
      }
      if (end < activeJobs.length) {
        navRow.push({ text: 'Next ➡️', callback_data: `jobs_page_${page+1}` });
      }
      if (navRow.length > 0) {
        keyboard.push(navRow);
      }
      
      keyboard.push([{ text: '➕ Add New Job', callback_data: 'admin_add_job' }]);
      keyboard.push([{ text: '🗑️ Delete Job', callback_data: 'admin_delete_job' }]);
      keyboard.push([{ text: '« Back to Main Menu', callback_data: 'admin_back_main' }]);

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    async function promptForNewJob(chatId) {
      adminSessions[chatId] = { step: 'awaiting_job_title' };
      await bot.sendMessage(chatId, 
        `➕ *Add New Job - Step 1/7*\n\nPlease enter the job title:`,
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
      );
    }

    async function showApplicationsList(chatId, page = 0) {
      const applications = await getApplications();
      const pageSize = 5;
      const start = page * pageSize;
      const end = start + pageSize;
      const paginatedApps = applications.slice(start, end).reverse();
      
      let message = `📝 *Applications List (Page ${page+1}/${Math.ceil(applications.length/pageSize)})*\n\n`;
      
      for (const app of paginatedApps) {
        message += `📋 *${app.jobTitle || 'Job'}*\n`;
        message += `   👤 Name: ${app.fullName}\n`;
        message += `   📧 Email: ${app.email}\n`;
        message += `   📞 Phone: ${app.phone}\n`;
        message += `   📅 Date: ${new Date(app.timestamp).toLocaleDateString()}\n`;
        message += `   📊 Status: ${app.status}\n\n`;
      }

      const keyboard = [];
      const navRow = [];
      
      if (page > 0) {
        navRow.push({ text: '⬅️ Previous', callback_data: `apps_page_${page-1}` });
      }
      if (end < applications.length) {
        navRow.push({ text: 'Next ➡️', callback_data: `apps_page_${page+1}` });
      }
      if (navRow.length > 0) {
        keyboard.push(navRow);
      }
      
      keyboard.push([{ text: '« Back to Main Menu', callback_data: 'admin_back_main' }]);

      await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    }

    // ===== CALLBACK QUERY HANDLER =====
    bot.on('callback_query', async (callbackQuery) => {
      const msg = callbackQuery.message;
      const chatId = msg.chat.id;
      const data = callbackQuery.data;

      await bot.answerCallbackQuery(callbackQuery.id);

      // Check if admin
      if (!adminChatIds.includes(chatId)) {
        // Handle user callbacks
        if (data === 'search_jobs') {
          await bot.sendMessage(chatId, `🔍 Search jobs on our website: ${BASE_URL}/jobs`);
        } else if (data === 'user_alerts') {
          const user = await findUserByTelegramChatId(chatId);
          if (user) {
            user.preferences = user.preferences || {};
            user.preferences.jobAlerts = !user.preferences.jobAlerts;
            const users = await getUsers();
            const idx = users.findIndex(u => u.userId === user.userId);
            users[idx] = user;
            await saveUsers(users);
            await bot.sendMessage(chatId, `✅ Job alerts turned ${user.preferences.jobAlerts ? 'ON' : 'OFF'}`);
          }
        } else if (data === 'my_applications') {
          const user = await findUserByTelegramChatId(chatId);
          if (!user) return;
          const apps = await getApplications();
          const userApps = apps.filter(a => a.userId === user.userId);
          if (userApps.length === 0) {
            await bot.sendMessage(chatId, '📭 You have no applications yet.');
          } else {
            let msg = '📋 *Your Applications*\n\n';
            userApps.slice(0, 5).forEach((app, i) => {
              msg += `${i+1}. *${app.jobTitle}*\n   Status: ${app.status}\n   Date: ${new Date(app.timestamp).toLocaleDateString()}\n\n`;
            });
            await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
          }
        }
        return;
      }

      // Admin callbacks
      if (data === 'admin_back_main') {
        delete adminSessions[chatId];
        await showAdminMainMenu(chatId);
      }
      else if (data === 'admin_refresh') {
        await showAdminMainMenu(chatId);
      }
      else if (data === 'admin_users') {
        await showUserList(chatId);
      }
      else if (data === 'admin_jobs') {
        await showJobList(chatId);
      }
      else if (data === 'admin_messages') {
        const messages = await getMessages();
        const unread = messages.filter(m => !m.read && !m.isAdmin);
        if (unread.length === 0) {
          await bot.sendMessage(chatId, '✅ No unread messages.');
        } else {
          let msg = '💬 *Unread Messages*\n\n';
          unread.slice(0, 5).forEach((m, i) => {
            msg += `${i+1}. From: ${m.userName}\n   ${m.message.substring(0, 50)}...\n   [Reply](${BASE_URL}/admin)\n\n`;
          });
          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
      }
      else if (data === 'admin_applications') {
        await showApplicationsList(chatId);
      }
      else if (data === 'admin_broadcast') {
        adminSessions[chatId] = { step: 'awaiting_broadcast' };
        await bot.sendMessage(chatId, 
          `📢 *Broadcast Message*\n\nPlease type the message you want to send to ALL users:`,
          { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
        );
      }
      else if (data === 'admin_stats') {
        const users = await getUsers();
        const jobs = await getJobs();
        const applications = await getApplications();
        const messages = await getMessages();
        
        const stats = {
          users: users.length,
          activeJobs: jobs.filter(j => j?.status === 'active').length,
          totalJobs: jobs.length,
          applications: applications.length,
          totalMessages: messages.length,
          unread: messages.filter(m => !m.read && !m.isAdmin).length
        };

        await bot.sendMessage(chatId,
          `📊 *Detailed Statistics*\n\n` +
          `👥 Total Users: ${stats.users}\n` +
          `📋 Active Jobs: ${stats.activeJobs}\n` +
          `📋 Total Jobs: ${stats.totalJobs}\n` +
          `📝 Applications: ${stats.applications}\n` +
          `💬 Total Messages: ${stats.totalMessages}\n` +
          `📨 Unread Messages: ${stats.unread}`,
          { parse_mode: 'Markdown' }
        );
      }
      else if (data === 'admin_add_job') {
        await promptForNewJob(chatId);
      }
      else if (data === 'admin_delete_job') {
        adminSessions[chatId] = { step: 'awaiting_job_id_delete' };
        await bot.sendMessage(chatId, 
          `🗑️ *Delete Job*\n\nPlease enter the Job ID to delete:`,
          { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
        );
      }
      else if (data === 'admin_search_user') {
        adminSessions[chatId] = { step: 'awaiting_user_email' };
        await bot.sendMessage(chatId, 
          `🔍 *Search User*\n\nPlease enter the user's email address:`,
          { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
        );
      }
      else if (data.startsWith('users_page_')) {
        const page = parseInt(data.split('_')[2]);
        await showUserList(chatId, page);
      }
      else if (data.startsWith('jobs_page_')) {
        const page = parseInt(data.split('_')[2]);
        await showJobList(chatId, page);
      }
      else if (data.startsWith('apps_page_')) {
        const page = parseInt(data.split('_')[2]);
        await showApplicationsList(chatId, page);
      }
      else if (data.startsWith('user_detail_')) {
        const email = data.replace('user_detail_', '');
        await showUserDetail(chatId, email);
      }
      else if (data.startsWith('user_messages_')) {
        const email = data.replace('user_messages_', '');
        await showUserMessages(chatId, email);
      }
      else if (data.startsWith('user_send_')) {
        const email = data.replace('user_send_', '');
        await promptForUserMessage(chatId, email);
      }
      else if (data.startsWith('user_apps_')) {
        const email = data.replace('user_apps_', '');
        const user = await findUserByEmail(email);
        const apps = await getApplications();
        const userApps = apps.filter(a => a.userId === user.userId);
        
        if (userApps.length === 0) {
          await bot.sendMessage(chatId, `📭 No applications from ${user.userName}`);
        } else {
          let msg = `📋 *Applications from ${user.userName}*\n\n`;
          userApps.forEach((app, i) => {
            msg += `${i+1}. *${app.jobTitle}*\n   Status: ${app.status}\n   Date: ${new Date(app.timestamp).toLocaleDateString()}\n\n`;
          });
          await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
        }
      }
    });

    // Handle replies (for multi-step wizards)
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      
      if (!text || text.startsWith('/')) return;

      // Check if this is part of an admin session
      const session = adminSessions[chatId];
      if (!session) return;

      if (session.step === 'awaiting_broadcast') {
        delete adminSessions[chatId];
        
        const users = await getUsers();
        let sent = 0;
        for (const user of users) {
          if (user.telegramChatId) {
            try {
              await bot.sendMessage(user.telegramChatId, 
                `📢 *Admin Broadcast*\n\n${text}`,
                { parse_mode: 'Markdown' }
              );
              sent++;
            } catch (e) {}
          }
        }
        
        await bot.sendMessage(chatId, `✅ Broadcast sent to ${sent} users`);
        await showAdminMainMenu(chatId);
      }
      else if (session.step === 'awaiting_user_email') {
        delete adminSessions[chatId];
        const user = await findUserByEmail(text);
        if (user) {
          await showUserDetail(chatId, user.email);
        } else {
          await bot.sendMessage(chatId, '❌ User not found');
          await showAdminMainMenu(chatId);
        }
      }
      else if (session.step === 'awaiting_reply') {
        const userEmail = session.userEmail;
        delete adminSessions[chatId];
        await sendMessageToUser(chatId, userEmail, text);
      }
      else if (session.step === 'awaiting_job_title') {
        adminSessions[chatId] = { step: 'awaiting_job_company', jobData: { title: text } };
        await bot.sendMessage(chatId, `➕ *Step 2/7*\n\nEnter company name:`, { reply_markup: { force_reply: true } });
      }
      else if (session.step === 'awaiting_job_company') {
        session.jobData.company = text;
        session.step = 'awaiting_job_location';
        await bot.sendMessage(chatId, `➕ *Step 3/7*\n\nEnter location:`, { reply_markup: { force_reply: true } });
      }
      else if (session.step === 'awaiting_job_location') {
        session.jobData.location = text;
        session.step = 'awaiting_job_type';
        await bot.sendMessage(chatId, 
          `➕ *Step 4/7*\n\nSelect job type:`,
          { 
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Full Time', callback_data: 'job_type_Full Time' }],
                [{ text: 'Part Time', callback_data: 'job_type_Part Time' }],
                [{ text: 'Contract', callback_data: 'job_type_Contract' }],
                [{ text: 'Temporary', callback_data: 'job_type_Temporary' }]
              ]
            }
          }
        );
      }
      else if (session.step === 'awaiting_job_category') {
        session.jobData.category = text;
        session.step = 'awaiting_job_salary';
        await bot.sendMessage(chatId, `➕ *Step 6/7*\n\nEnter salary (e.g., £35,000 - £45,000):`, { reply_markup: { force_reply: true } });
      }
      else if (session.step === 'awaiting_job_salary') {
        session.jobData.salary = text;
        session.step = 'awaiting_job_description';
        await bot.sendMessage(chatId, `➕ *Step 7/7*\n\nEnter job description:`, { reply_markup: { force_reply: true } });
      }
      else if (session.step === 'awaiting_job_description') {
        session.jobData.description = text;
        session.jobData.requirements = session.jobData.requirements || 'See description';
        session.jobData.remote = session.jobData.remote || false;
        session.jobData.payment_type = session.jobData.payment_type || 'yearly';
        
        const jobs = await getJobs();
        const newJob = {
          id: jobs.length + 1,
          ...session.jobData,
          posted: new Date().toISOString().split('T')[0],
          expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
          status: 'active'
        };
        
        jobs.push(newJob);
        await saveJobs(jobs);
        
        delete adminSessions[chatId];
        await bot.sendMessage(chatId, `✅ Job added successfully!\n\nTitle: ${newJob.title}\nCompany: ${newJob.company}\nLocation: ${newJob.location}`);
        await showJobList(chatId);
        
        await notifyNewJob(newJob);
      }
      else if (session.step === 'awaiting_job_id_delete') {
        const jobId = parseInt(text);
        const jobs = await getJobs();
        const jobExists = jobs.some(j => j.id === jobId);
        
        if (jobExists) {
          const updatedJobs = jobs.filter(j => j.id !== jobId);
          await saveJobs(updatedJobs);
          await bot.sendMessage(chatId, `✅ Job #${jobId} deleted successfully`);
        } else {
          await bot.sendMessage(chatId, `❌ Job #${jobId} not found`);
        }
        
        delete adminSessions[chatId];
        await showJobList(chatId);
      }
    });

    // Handle job type selection from inline keyboard
    bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      
      await bot.answerCallbackQuery(callbackQuery.id);

      if (data.startsWith('job_type_')) {
        const jobType = data.replace('job_type_', '');
        const session = adminSessions[chatId];
        if (session && session.step === 'awaiting_job_type') {
          session.jobData.type = jobType;
          session.step = 'awaiting_job_category';
          await bot.sendMessage(chatId, `➕ *Step 5/7*\n\nEnter job category (e.g., IT & Tech, Healthcare, Construction):`, { reply_markup: { force_reply: true } });
        }
      }
    });

    console.log('🤖 Telegram bot fully configured with complete admin panel');

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
          user = { 
            userId: uuidv4(), 
            email: ws.email, 
            userName: ws.userName, 
            createdAt: new Date().toISOString(), 
            lastSeen: new Date().toISOString(), 
            unreadCount: 0 
          };
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
          
          // Notify admins about new message
          await notifyAllAdmins(
            `💬 *New Message from ${message.userName}*\n\n📝 ${message.text}\n\n👤 Email: ${message.email}\n[Reply](${BASE_URL}/admin)`,
            { parse_mode: 'Markdown' }
          );
        }

        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
          }
        });
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
    const newUser = { 
      userId: uuidv4(), 
      email: normalizedEmail, 
      userName: userName || normalizedEmail.split('@')[0], 
      createdAt: new Date().toISOString(), 
      lastSeen: new Date().toISOString(), 
      unreadCount: 0 
    };
    users.push(newUser);
    await saveUsers(users);
    res.json({ success: true, userId: newUser.userId, userName: newUser.userName });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user/:email/messages', async (req, res) => {
  try {
    const user = await findUserByEmail(req.params.email);
    if (!user) return res.json([]);
    const messages = await getMessages();
    res.json(messages.filter(m => m.userId === user.userId));
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await getUsers();
    const messages = await getMessages();
    res.json(users.map(u => ({ 
      ...u, 
      unread: messages.filter(m => m.userId === u.userId && !m.read && !m.isAdmin).length 
    })));
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/send', async (req, res) => {
  try {
    const { email, message } = req.body;
    const user = await findUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newMessage = { 
      id: Date.now(), 
      userId: user.userId, 
      userEmail: email.toLowerCase(), 
      userName: 'Admin', 
      message, 
      isAdmin: true, 
      timestamp: new Date().toISOString(), 
      read: true 
    };
    
    const messages = await getMessages();
    messages.push(newMessage);
    await saveMessages(messages);

    wss.clients.forEach(client => {
      if (client.userId === user.userId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
      }
    });

    if (user.telegramChatId && bot) {
      try { 
        await bot.sendMessage(user.telegramChatId, 
          `💬 *Admin Message:*\n\n${message}\n\n[Reply in Web Chat](${BASE_URL}/chat)`,
          { parse_mode: 'Markdown' }
        ); 
      } catch (e) {}
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
  console.log(`🤖 Bot: ✅ Active with Full Admin Panel`);
  console.log(`👑 Admin Code: ${ADMIN_ACCESS_CODE}`);
  console.log(`📢 Ntfy: ${NTFY_TOPIC}`);
  console.log('='.repeat(60) + '\n');
});
