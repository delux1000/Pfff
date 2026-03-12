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
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || '338989';
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID;
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'recruit_chat';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const NODE_ENV = process.env.NODE_ENV || 'development';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// JSONBin.io base URL - SINGLE BIN for all data
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// Store admin chat IDs in memory (runtime only)
let adminChatIds = [];
let bot = null;

// ===== VALIDATE REQUIRED CONFIGURATION =====
if (!TELEGRAM_BOT_TOKEN) {
  console.error('\n❌ FATAL ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
  process.exit(1);
}

if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
  console.error('\n❌ FATAL ERROR: JSONBIN_API_KEY and JSONBIN_BIN_ID must be set in .env file');
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('🔧 SERVER CONFIGURATION');
console.log('='.repeat(60));
console.log(`Environment: ${NODE_ENV}`);
console.log(`Port: ${PORT}`);
console.log(`JSONBin Bin ID: ${JSONBIN_BIN_ID}`);
console.log(`Bot Token: ${TELEGRAM_BOT_TOKEN ? '✅ Configured' : '❌ Missing'}`);
console.log('='.repeat(60) + '\n');

// ===== JSONBin.io HELPER FUNCTIONS (SINGLE BIN) =====
async function jsonbinGet() {
  try {
    const response = await fetch(JSONBIN_URL, {
      method: 'GET',
      headers: {
        'X-Master-Key': JSONBIN_API_KEY,
        'X-Bin-Meta': 'false'
      }
    });
    
    if (!response.ok) {
      throw new Error(`JSONBin GET failed: ${response.status}`);
    }
    
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
    
    if (!response.ok) {
      throw new Error(`JSONBin PUT failed: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('❌ JSONBin PUT error:', error.message);
    return null;
  }
}

// ===== INITIALIZE JSONBin WITH DEFAULT DATA (SINGLE BIN) =====
async function initializeJSONBin() {
  try {
    console.log('📦 Connecting to JSONBin.io...');
    const existingData = await jsonbinGet();
    
    if (!existingData || Object.keys(existingData).length === 0) {
      // Create initial data structure with all collections in ONE bin
      const initialData = {
        // Jobs collection
        jobs: [
          {
            id: 1,
            title: "💻 Senior Software Developer",
            company: "Tech Innovations Ltd",
            location: "London",
            remote: true,
            type: "Full Time",
            category: "IT & Tech",
            salary: "£55,000 - £70,000 per year",
            payment_type: "yearly",
            description: "Leading fintech company seeks experienced developer with Java, Spring Boot, and AWS.",
            requirements: "5+ years Java experience, Spring Boot, AWS",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          },
          {
            id: 2,
            title: "⚕️ Registered General Nurse",
            company: "NHS Trust",
            location: "Northampton",
            remote: false,
            type: "Full Time",
            category: "Healthcare",
            salary: "£28 - £42 per hour",
            payment_type: "hourly",
            description: "Immediate starts available for RGNs at local NHS trust. Flexible shifts available.",
            requirements: "Valid NMC registration",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          },
          {
            id: 3,
            title: "🏗️ Project Manager (Construction)",
            company: "Construction Solutions Ltd",
            location: "Birmingham",
            remote: false,
            type: "Contract",
            category: "Construction",
            salary: "£350 - £450 per day",
            payment_type: "daily",
            description: "Major infrastructure project seeking experienced Project Manager.",
            requirements: "APM/PRINCE2 qualified, 8+ years experience",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          },
          {
            id: 4,
            title: "🛒 Sales Assistant",
            company: "Retail Group UK",
            location: "Corby",
            remote: false,
            type: "Part Time",
            category: "Retail",
            salary: "£10.50 - £12.00 per hour",
            payment_type: "hourly",
            description: "Weekend sales assistant needed for busy retail store.",
            requirements: "Customer service skills",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          },
          {
            id: 5,
            title: "📊 Marketing Manager",
            company: "Digital Agency Manchester",
            location: "Manchester",
            remote: true,
            type: "Full Time",
            category: "Marketing",
            salary: "£35,000 - £45,000 per year",
            payment_type: "yearly",
            description: "Lead marketing campaigns for growing digital agency.",
            requirements: "5+ years marketing experience",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          }
        ],
        
        // Messages collection
        messages: [],
        
        // Users collection (identified by email)
        users: [],
        
        // Applications collection
        applications: [],
        
        // Telegram chats collection
        telegram: []
      };
      
      await jsonbinPut(initialData);
      console.log('✅ JSONBin initialized with default data');
      console.log(`   📋 Jobs: ${initialData.jobs.length}`);
      console.log(`   👥 Users: ${initialData.users.length}`);
      console.log(`   💬 Messages: ${initialData.messages.length}`);
    } else {
      console.log('✅ JSONBin data loaded successfully');
      console.log(`   📋 Jobs: ${existingData.jobs?.length || 0}`);
      console.log(`   👥 Users: ${existingData.users?.length || 0}`);
      console.log(`   💬 Messages: ${existingData.messages?.length || 0}`);
    }
  } catch (error) {
    console.error('❌ Failed to initialize JSONBin:', error);
    process.exit(1);
  }
}

// ===== DATA ACCESS FUNCTIONS (ALL FROM SINGLE BIN) =====

// Jobs
async function getJobs() {
  const data = await jsonbinGet();
  return data?.jobs || [];
}

async function saveJobs(jobs) {
  const data = await jsonbinGet();
  data.jobs = jobs;
  return await jsonbinPut(data);
}

// Messages
async function getMessages() {
  const data = await jsonbinGet();
  return data?.messages || [];
}

async function saveMessages(messages) {
  const data = await jsonbinGet();
  data.messages = messages;
  return await jsonbinPut(data);
}

// Users (identified by email)
async function getUsers() {
  const data = await jsonbinGet();
  return data?.users || [];
}

async function saveUsers(users) {
  const data = await jsonbinGet();
  data.users = users;
  return await jsonbinPut(data);
}

// Find user by email
async function findUserByEmail(email) {
  const users = await getUsers();
  return users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

// Find user by userId
async function findUserById(userId) {
  const users = await getUsers();
  return users.find(u => u.userId === userId);
}

// Applications
async function getApplications() {
  const data = await jsonbinGet();
  return data?.applications || [];
}

async function saveApplications(applications) {
  const data = await jsonbinGet();
  data.applications = applications;
  return await jsonbinPut(data);
}

// Telegram chats
async function getTelegramChats() {
  const data = await jsonbinGet();
  return data?.telegram || [];
}

async function saveTelegramChats(telegram) {
  const data = await jsonbinGet();
  data.telegram = telegram;
  return await jsonbinPut(data);
}

// Initialize JSONBin
initializeJSONBin().catch(console.error);

// ===== MIDDLEWARE =====
app.use(helmet({ 
  contentSecurityPolicy: false, 
  crossOriginEmbedderPolicy: false 
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(compression());
app.use(morgan(NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup for file uploads (temporary memory storage)
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF are allowed.'));
    }
  }
});

// ===== NTFY NOTIFICATION FUNCTION =====
async function sendNtfyNotification(title, message, priority = 3, tags = []) {
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: 'POST',
      body: JSON.stringify({ 
        topic: NTFY_TOPIC, 
        title, 
        message, 
        priority, 
        tags,
        click: BASE_URL
      }),
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`📢 Ntfy notification sent: ${title}`);
  } catch (error) { 
    console.error('Failed to send ntfy notification:', error); 
  }
}

// ===== NOTIFY ALL ADMINS =====
async function notifyAllAdmins(message, options = {}) {
  for (const chatId of adminChatIds) {
    try {
      if (bot) {
        await bot.sendMessage(chatId, message, options);
      }
    } catch (error) {
      console.error(`Failed to notify admin ${chatId}:`, error.message);
    }
  }
}

// ===== JOB ALERT FUNCTIONS =====
async function sendJobAlertsToAllUsers() {
  try {
    const users = await getUsers();
    const jobs = await getJobs();
    const activeJobs = jobs.filter(j => j.status === 'active').slice(0, 5);

    if (activeJobs.length === 0) return;

    let jobsMessage = '📢 *Latest Job Opportunities*\n\n';
    activeJobs.forEach((job, index) => {
      jobsMessage += `${index+1}. ${job.title}\n`;
      jobsMessage += `   🏢 ${job.company} - ${job.location}\n`;
      jobsMessage += `   💷 ${job.salary}\n`;
      jobsMessage += `   ⏰ ${job.type} | ${job.payment_type} payment\n\n`;
    });
    jobsMessage += `🔗 [Apply Now](${BASE_URL}/jobs)`;

    // Send to all Telegram users
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

    // Send to all WebSocket connected users
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId) {
        client.send(JSON.stringify({
          type: 'job_alert',
          jobs: activeJobs,
          message: 'New job opportunities available!'
        }));
      }
    });

    console.log('📢 Job alerts sent to all users');
    await sendNtfyNotification('📢 Job Alerts Sent', `Sent ${activeJobs.length} jobs to all users`, 3, ['megaphone']);

  } catch (error) {
    console.error('Error sending job alerts:', error);
  }
}

async function notifyNewJob(job) {
  try {
    const message = `🎉 *NEW JOB ADDED!*\n\n` +
      `${job.title}\n` +
      `🏢 ${job.company} - ${job.location}\n` +
      `💷 ${job.salary}\n` +
      `⏰ ${job.type} | ${job.payment_type} payment\n\n` +
      `🔗 [Apply Now](${BASE_URL}/jobs)`;

    // Send to all Telegram users
    const telegramChats = await getTelegramChats();
    for (const chat of telegramChats) {
      if (chat.isAdmin) continue;
      try {
        if (bot) {
          await bot.sendMessage(chat.chatId, message, { 
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 View Job', url: `${BASE_URL}/jobs` }]
              ]
            }
          });
        }
      } catch (e) {}
    }

    // Notify admins
    await notifyAllAdmins(
      `👑 *New Job Added by Admin*\n\n${job.title}\n🏢 ${job.company}\n💷 ${job.salary}`,
      { parse_mode: 'Markdown' }
    );

    // Send to all WebSocket users
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.userId) {
        client.send(JSON.stringify({
          type: 'new_job_alert',
          job: job,
          message: 'New job just posted!'
        }));
      }
    });

    await sendNtfyNotification('📢 New Job Added', `${job.title} at ${job.company}`, 4, ['new', 'briefcase']);

  } catch (error) {
    console.error('Error notifying new job:', error);
  }
}

// Schedule job alerts every 2 hours
cron.schedule('0 */2 * * *', () => {
  console.log('🕐 Running scheduled job alerts...');
  sendJobAlertsToAllUsers();
});

// ===== TELEGRAM BOT SETUP =====
async function setupTelegramBot() {
  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('✅ Telegram bot initialized successfully');

    // Welcome message
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name || 'User';

      const jobs = await getJobs();
      const activeJobs = jobs.filter(j => j.status === 'active').slice(0, 3);

      let jobsPreview = '';
      activeJobs.forEach((job, i) => {
        jobsPreview += `${i+1}. ${job.title}\n   🏢 ${job.company} - 💷 ${job.salary}\n`;
      });

      const welcomeMessage = 
        `👋 *Welcome ${firstName} to Perfections Recruitment!* 🇬🇧\n\n` +
        `🌟 *Your Trusted Recruitment Partner*\n\n` +
        `🔍 *Today's Featured Jobs:*\n${jobsPreview}\n\n` +
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

    // Handle messages (email or hidden admin code)
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'User';
      const username = msg.from.username || 'No username';

      if (!text || text.startsWith('/')) return;

      // Hidden admin code check
      if (text === ADMIN_ACCESS_CODE) {
        // Add to admin list (memory only)
        adminChatIds.push(chatId);
        
        // Store admin in telegram collection
        const telegramChats = await getTelegramChats();
        telegramChats.push({
          chatId: chatId.toString(),
          telegramId,
          username,
          firstName,
          isAdmin: true,
          registeredAt: new Date().toISOString()
        });
        await saveTelegramChats(telegramChats);

        // Send admin panel (silently)
        await showAdminPanel(chatId);
        
        // Notify other admins
        await notifyAllAdmins(
          `👑 *New Admin Logged In*\n\n• Name: ${firstName}\n• Telegram: @${username}`,
          { parse_mode: 'Markdown' }
        );

        await sendNtfyNotification('👑 Admin Login', `${firstName} logged in as admin`, 4, ['locked']);
        
        return;
      }

      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(text)) {
        // Check if user exists by email
        let user = await findUserByEmail(text);

        if (!user) {
          // Create new user with email as identifier
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

          // Store telegram chat
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

          // Get job recommendations
          const jobs = await getJobs();
          const recommendedJobs = jobs.filter(j => j.status === 'active').slice(0, 3);

          let jobsList = '';
          recommendedJobs.forEach((job, i) => {
            jobsList += `${i+1}. ${job.title} - ${job.salary}\n`;
          });

          const welcomeMessage = 
            `✅ *Welcome ${firstName}!* 🎉\n\n` +
            `Your account has been created with email: ${text}\n\n` +
            `🎯 *Recommended Jobs:*\n${jobsList}\n\n` +
            `Use /help for commands.`;

          await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Browse Jobs', url: `${BASE_URL}/jobs` }],
                [{ text: '💬 Chat', url: `${BASE_URL}/chat` }]
              ]
            }
          });

          // Notify admins
          await notifyAllAdmins(
            `👤 *New User*\n\n• Name: ${firstName}\n• Email: ${text}\n• Telegram: @${username}`,
            { parse_mode: 'Markdown' }
          );

        } else {
          // Existing user - update last seen
          user.lastSeen = new Date().toISOString();
          user.telegramId = telegramId;
          user.telegramChatId = chatId.toString();
          
          const users = await getUsers();
          const index = users.findIndex(u => u.email === text.toLowerCase());
          users[index] = user;
          await saveUsers(users);

          // Get unread messages
          const messages = await getMessages();
          const unreadCount = messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length;

          const welcomeBackMessage = 
            `👋 *Welcome back ${firstName}!*\n\n` +
            `📨 You have *${unreadCount}* unread messages.\n\n` +
            `Email: ${user.email}`;

          await bot.sendMessage(chatId, welcomeBackMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 View Jobs', url: `${BASE_URL}/jobs` }],
                [{ text: '💬 Open Chat', url: `${BASE_URL}/chat` }]
              ]
            }
          });
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
      const chatId = msg.chat.id;
      const helpMessage = 
        `🤖 *Bot Commands*\n\n` +
        `• /start - Register with email\n` +
        `• /jobs - Browse jobs\n` +
        `• /help - This menu\n\n` +
        `💬 [Live Chat](${BASE_URL}/chat)`;

      await bot.sendMessage(chatId, helpMessage, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Live Chat', url: `${BASE_URL}/chat` }]
          ]
        }
      });
    });

    // Jobs command
    bot.onText(/\/jobs/, async (msg) => {
      const chatId = msg.chat.id;
      const jobs = await getJobs();
      const activeJobs = jobs.filter(j => j.status === 'active').slice(0, 5);

      let message = '📋 *Latest Jobs*\n\n';
      activeJobs.forEach((job, i) => {
        message += `${i+1}. *${job.title}*\n`;
        message += `   🏢 ${job.company} - ${job.location}\n`;
        message += `   💷 ${job.salary}\n\n`;
      });

      message += `🔗 [See all jobs](${BASE_URL}/jobs)`;

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    });

    // Admin Panel
    async function showAdminPanel(chatId) {
      const users = await getUsers();
      const jobs = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();

      const stats = {
        users: users.length,
        jobs: jobs.filter(j => j.status === 'active').length,
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
        `🛠️ *Commands:*\n` +
        `/users - List users\n` +
        `/broadcast [msg] - Send to all\n` +
        `/stats - Details\n` +
        `/sendalerts - Send job alerts`;

      await bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Open Admin', url: `${BASE_URL}/admin` }]
          ]
        }
      });
    }

    // Users list (admin only)
    bot.onText(/\/users/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const users = await getUsers();
      let response = '👥 *Users by Email:*\n\n';
      
      users.slice(0, 10).forEach((u, i) => {
        response += `${i+1}. *${u.userName}*\n`;
        response += `   📧 ${u.email}\n`;
        response += `   🕐 Last seen: ${new Date(u.lastSeen).toLocaleString()}\n`;
        response += `   📨 Unread: ${u.unreadCount || 0}\n\n`;
      });

      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    });

    // Broadcast (admin only)
    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const broadcastMsg = match[1];
      const users = await getUsers();
      let sent = 0;

      for (const user of users) {
        if (user.telegramChatId) {
          try {
            await bot.sendMessage(user.telegramChatId, 
              `📢 *Announcement:*\n\n${broadcastMsg}`,
              { parse_mode: 'Markdown' }
            );
            sent++;
          } catch (e) {}
        }
      }

      await bot.sendMessage(chatId, `✅ Broadcast sent to ${sent} users`);
    });

    // Send alerts manually (admin only)
    bot.onText(/\/sendalerts/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      await sendJobAlertsToAllUsers();
      await bot.sendMessage(chatId, '✅ Job alerts sent');
    });

    // Stats (admin only)
    bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const users = await getUsers();
      const jobs = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();

      const stats = {
        totalUsers: users.length,
        activeJobs: jobs.filter(j => j.status === 'active').length,
        totalApplications: applications.length,
        totalMessages: messages.length,
        unreadMessages: messages.filter(m => !m.read && !m.isAdmin).length
      };

      await bot.sendMessage(chatId,
        `📊 *Detailed Statistics*\n\n` +
        `👥 **Users:** ${stats.totalUsers}\n` +
        `📋 **Active Jobs:** ${stats.activeJobs}\n` +
        `📝 **Applications:** ${stats.totalApplications}\n` +
        `💬 **Total Messages:** ${stats.totalMessages}\n` +
        `📨 **Unread:** ${stats.unreadMessages}\n` +
        `🕐 **Last Updated:** ${new Date().toLocaleString()}`,
        { parse_mode: 'Markdown' }
      );
    });

    console.log('🤖 Telegram bot fully configured');

  } catch (error) {
    console.error('❌ Telegram bot error:', error);
  }
}

// Start Telegram bot
setupTelegramBot();

// ===== WEB SOCKET SERVER =====
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  ws.clientId = clientId;

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      if (message.type === 'register') {
        // User identified by email
        ws.userId = message.userId;
        ws.userName = message.userName;
        ws.email = message.email?.toLowerCase();
        ws.isAdmin = message.isAdmin || false;

        const users = await getUsers();
        let user = users.find(u => u.email === ws.email);

        if (!user) {
          // Create new user if doesn't exist
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
        const userMessages = messages.filter(m => m.userId === ws.userId);
        ws.send(JSON.stringify({ type: 'history', messages: userMessages }));
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

        // Update user unread count
        if (user && !message.isAdmin) {
          user.unreadCount = (user.unreadCount || 0) + 1;
          await saveUsers(users);
        }

        // Broadcast to all clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN && client !== ws) {
            client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
          }
        });

        // Notify admins
        if (!message.isAdmin) {
          await notifyAllAdmins(
            `💬 *New Message*\n\n👤 From: ${message.userName} (${message.email})\n📝 ${message.text}\n\n[Reply](${BASE_URL}/admin)`,
            { parse_mode: 'Markdown' }
          );
        }

        await sendNtfyNotification('💬 New Message', `${message.userName}: ${message.text}`, 3);
      }

    } catch (error) {
      console.error('WebSocket error:', error);
    }
  });
});

// ===== API ROUTES =====

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    uptime: process.uptime(),
    botConfigured: !!bot
  });
});

// Check if user exists by email
app.post('/api/user/check', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await findUserByEmail(email);
    res.json(user ? { 
      exists: true, 
      userId: user.userId, 
      userName: user.userName 
    } : { exists: false });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new user with email
app.post('/api/user/create', async (req, res) => {
  try {
    const { email, userName } = req.body;
    const normalizedEmail = email.toLowerCase();
    
    // Check if user already exists
    const existingUser = await findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.json({ 
        success: true, 
        userId: existingUser.userId, 
        userName: existingUser.userName 
      });
    }

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

// Get jobs
app.get('/api/jobs', async (req, res) => {
  try {
    const jobs = await getJobs();
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// Get user messages by email
app.get('/api/user/:email/messages', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await findUserByEmail(email);
    
    if (!user) {
      return res.json([]);
    }
    
    const messages = await getMessages();
    const userMessages = messages.filter(m => m.userId === user.userId);
    res.json(userMessages);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get all users
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await getUsers();
    const messages = await getMessages();
    const usersWithUnread = users.map(user => ({
      ...user,
      unread: messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length
    }));
    res.json(usersWithUnread);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get user messages by email
app.get('/api/admin/messages/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await findUserByEmail(email);
    
    if (!user) {
      return res.json([]);
    }
    
    const messages = await getMessages();
    const userMessages = messages.filter(m => m.userId === user.userId);
    res.json(userMessages);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Send message
app.post('/api/admin/send', async (req, res) => {
  try {
    const { email, message, adminName } = req.body;
    const normalizedEmail = email.toLowerCase();
    
    const user = await findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newMessage = {
      id: Date.now(),
      userId: user.userId,
      userEmail: normalizedEmail,
      userName: adminName || 'Admin',
      message,
      isAdmin: true,
      timestamp: new Date().toISOString(),
      read: true
    };

    const messages = await getMessages();
    messages.push(newMessage);
    await saveMessages(messages);

    // Send via WebSocket
    wss.clients.forEach((client) => {
      if (client.userId === user.userId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
      }
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Mark messages as read by email
app.post('/api/admin/mark-read/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await findUserByEmail(email);
    
    if (!user) {
      return res.json({ success: true });
    }
    
    const messages = await getMessages();
    messages.forEach(m => { 
      if (m.userId === user.userId && !m.isAdmin) m.read = true; 
    });
    await saveMessages(messages);

    const users = await getUsers();
    const userIndex = users.findIndex(u => u.email === email);
    if (userIndex !== -1) { 
      users[userIndex].unreadCount = 0; 
      await saveUsers(users); 
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin: Get unread count
app.get('/api/admin/unread', async (req, res) => {
  try {
    const messages = await getMessages();
    res.json({ unread: messages.filter(m => !m.read && !m.isAdmin).length });
  } catch (error) {
    res.json({ unread: 0 });
  }
});

// Admin: Add job
app.post('/api/admin/jobs', async (req, res) => {
  try {
    const { title, company, location, remote, type, category, salary, payment_type, description, requirements } = req.body;
    const jobs = await getJobs();

    const newJob = {
      id: jobs.length + 1,
      title,
      company,
      location,
      remote: remote === 'true',
      type,
      category,
      salary,
      payment_type: payment_type || 'yearly',
      description,
      requirements,
      posted: new Date().toISOString().split('T')[0],
      expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
      status: 'active'
    };

    jobs.push(newJob);
    await saveJobs(jobs);
    
    await notifyNewJob(newJob);

    res.json({ success: true, job: newJob });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add job' });
  }
});

// Admin: Delete job
app.delete('/api/admin/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const jobs = await getJobs();
    const updatedJobs = jobs.filter(j => j.id !== jobId);
    await saveJobs(updatedJobs);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// ===== SERVE HTML PAGES =====
const pages = [
  'index.html', 'about.html', 'services.html', 'candidates.html', 
  'employers.html', 'jobs.html', 'testimonials.html', 'contact.html', 
  'careers.html', 'blog.html', 'funding.html', 'chat.html', 
  'admin.html', '404.html'
];

pages.forEach(page => {
  const route = page === 'index.html' ? '/' : `/${page.replace('.html', '')}`;
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', page));
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// ===== START SERVER =====
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PERFECTIONS RECRUITMENT - SINGLE JSONBin.io STORAGE');
  console.log('='.repeat(60));
  console.log(`\n📡 Server: http://localhost:${PORT}`);
  console.log(`💬 Chat:   http://localhost:${PORT}/chat`);
  console.log(`👑 Admin:  http://localhost:${PORT}/admin`);
  console.log(`📋 Jobs:   http://localhost:${PORT}/jobs`);
  console.log(`🤖 Bot Token: ✅ Configured`);
  console.log(`📦 JSONBin: ✅ Single Bin (ID: ${JSONBIN_BIN_ID})`);
  console.log(`📢 Ntfy Topic: ${NTFY_TOPIC}`);
  console.log(`👤 User Identification: Email-based`);
  console.log(`👑 Admin Code: ${ADMIN_ACCESS_CODE} (hidden from users)`);
  console.log('='.repeat(60) + '\n');
});
