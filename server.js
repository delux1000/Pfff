// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
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

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ===== CONFIGURATION FROM ENVIRONMENT VARIABLES =====
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ACCESS_CODE = process.env.ADMIN_ACCESS_CODE || '338989';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const JOBS_FILE = process.env.JOBS_FILE || path.join(__dirname, 'jobs.json');
const MESSAGES_FILE = process.env.MESSAGES_FILE || path.join(DATA_DIR, 'messages.json');
const USERS_FILE = process.env.USERS_FILE || path.join(DATA_DIR, 'users.json');
const APPLICATIONS_FILE = process.env.APPLICATIONS_FILE || path.join(DATA_DIR, 'applications.json');
const TELEGRAM_CHATS_FILE = process.env.TELEGRAM_CHATS_FILE || path.join(DATA_DIR, 'telegram.json');
const PAYMENTS_FILE = process.env.PAYMENTS_FILE || path.join(DATA_DIR, 'payments.json');
const NTFY_TOPIC = process.env.NTFY_TOPIC || 'recruit_chat';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ===== DETERMINE BASE URL FOR TELEGRAM BUTTONS =====
const IS_PRODUCTION = NODE_ENV === 'production';
const PRODUCTION_URL = 'https://perfectionsrecruitmentagency.com';
const DEVELOPMENT_URL = 'https://perfectionsrecruitmentagency.com'; // Use HTTPS even in dev for testing
const TELEGRAM_BUTTON_URL = IS_PRODUCTION ? PRODUCTION_URL : DEVELOPMENT_URL;

// Store admin chat IDs for notifications
let adminChatIds = [];

console.log('\n' + '='.repeat(60));
console.log('🔧 SERVER CONFIGURATION');
console.log('='.repeat(60));
console.log(`Environment: ${NODE_ENV}`);
console.log(`Port: ${PORT}`);
console.log(`Telegram Button URL: ${TELEGRAM_BUTTON_URL}`);
console.log(`Admin Code: ${ADMIN_ACCESS_CODE} (hidden from users)`);
console.log('='.repeat(60) + '\n');

// ===== VALIDATE REQUIRED CONFIGURATION =====
if (!TELEGRAM_BOT_TOKEN) {
  console.error('\n❌ FATAL ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
  process.exit(1);
}

// ===== ENSURE FILES AND DIRECTORIES EXIST =====
async function ensureFiles() {
  try {
    await fs.ensureDir(DATA_DIR);
    await fs.ensureDir(path.join(DATA_DIR, 'uploads'));
    await fs.ensureDir(path.join(DATA_DIR, 'backups'));
    await fs.ensureDir(path.join(DATA_DIR, 'logs'));

    if (!await fs.pathExists(JOBS_FILE)) {
      await fs.writeJson(JOBS_FILE, {
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
            payment_period: "annual",
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
            payment_period: "hourly",
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
            payment_period: "daily",
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
            payment_period: "weekly",
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
            payment_period: "monthly",
            description: "Lead marketing campaigns for growing digital agency.",
            requirements: "5+ years marketing experience",
            posted: new Date().toISOString().split('T')[0],
            expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
            status: "active"
          }
        ]
      });
      console.log('✅ Created jobs.json with enhanced payment types');
    }

    if (!await fs.pathExists(MESSAGES_FILE)) await fs.writeJson(MESSAGES_FILE, []);
    if (!await fs.pathExists(USERS_FILE)) await fs.writeJson(USERS_FILE, []);
    if (!await fs.pathExists(APPLICATIONS_FILE)) await fs.writeJson(APPLICATIONS_FILE, []);
    if (!await fs.pathExists(TELEGRAM_CHATS_FILE)) await fs.writeJson(TELEGRAM_CHATS_FILE, []);
    if (!await fs.pathExists(PAYMENTS_FILE)) await fs.writeJson(PAYMENTS_FILE, []);

    console.log('✅ All data files initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing files:', error);
  }
}

ensureFiles().catch(console.error);

// ===== DATA STORAGE FUNCTIONS =====
async function getJobs() { return await fs.readJson(JOBS_FILE); }
async function saveJobs(jobs) { await fs.writeJson(JOBS_FILE, jobs); }
async function getMessages() { return await fs.readJson(MESSAGES_FILE); }
async function saveMessages(messages) { await fs.writeJson(MESSAGES_FILE, messages); }
async function getUsers() { return await fs.readJson(USERS_FILE); }
async function saveUsers(users) { await fs.writeJson(USERS_FILE, users); }
async function getApplications() { return await fs.readJson(APPLICATIONS_FILE); }
async function saveApplications(apps) { await fs.writeJson(APPLICATIONS_FILE, apps); }
async function getTelegramChats() { return await fs.readJson(TELEGRAM_CHATS_FILE); }
async function saveTelegramChats(chats) { await fs.writeJson(TELEGRAM_CHATS_FILE, chats); }
async function getPayments() { return await fs.readJson(PAYMENTS_FILE); }
async function savePayments(payments) { await fs.writeJson(PAYMENTS_FILE, payments); }

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

// Multer setup for file uploads
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
        click: TELEGRAM_BUTTON_URL
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
    const jobsData = await getJobs();
    const activeJobs = jobsData.jobs.filter(j => j.status === 'active').slice(0, 5);

    if (activeJobs.length === 0) return;

    let jobsMessage = '📢 *Latest Job Opportunities*\n\n';
    activeJobs.forEach((job, index) => {
      jobsMessage += `${index+1}. ${job.title}\n`;
      jobsMessage += `   🏢 ${job.company} - ${job.location}\n`;
      jobsMessage += `   💷 ${job.salary}\n`;
      jobsMessage += `   ⏰ ${job.type} | ${job.payment_type} payment\n\n`;
    });
    jobsMessage += `🔗 [Apply Now](${TELEGRAM_BUTTON_URL}/jobs)`;

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
                [{ text: '📋 View All Jobs', url: `${TELEGRAM_BUTTON_URL}/jobs` }],
                [{ text: '💬 Chat with Us', url: `${TELEGRAM_BUTTON_URL}/chat` }]
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
      `🔗 [Apply Now](${TELEGRAM_BUTTON_URL}/jobs)`;

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
                [{ text: '📋 View Job', url: `${TELEGRAM_BUTTON_URL}/jobs` }]
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
let bot = null;

async function setupTelegramBot() {
  try {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    console.log('✅ Telegram bot initialized successfully');
    console.log(`🔑 Admin access code is HIDDEN (not displayed to users)`);

    // Welcome message with beautiful buttons
    bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      const firstName = msg.from.first_name || 'User';

      const jobsData = await getJobs();
      const activeJobs = jobsData.jobs.filter(j => j.status === 'active').slice(0, 3);

      let jobsPreview = '';
      activeJobs.forEach((job, i) => {
        jobsPreview += `${i+1}. ${job.title}\n   🏢 ${job.company} - 💷 ${job.salary}\n`;
      });

      const welcomeMessage = 
        `👋 *Welcome ${firstName} to Perfections Recruitment!* 🇬🇧\n\n` +
        `🌟 *Your Trusted Recruitment Partner Across the UK*\n\n` +
        `🔍 *Today's Featured Jobs:*\n${jobsPreview}\n\n` +
        `📧 *To get started, please enter your email address:*\n\n` +
        `_We'll send you personalized job alerts and updates!_`;

      await bot.sendMessage(chatId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📋 Browse All Jobs', url: `${TELEGRAM_BUTTON_URL}/jobs` }],
            [{ text: '💬 Live Chat Support', url: `${TELEGRAM_BUTTON_URL}/chat` }],
            [{ text: '📢 Job Alerts', callback_data: 'job_alerts' }]
          ]
        }
      });
    });

    // Handle email input (and hidden admin code)
    bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      const text = msg.text;
      const telegramId = msg.from.id.toString();
      const firstName = msg.from.first_name || 'User';
      const username = msg.from.username || 'No username';

      if (!text || text.startsWith('/')) return;

      // Check for hidden admin code (no message shown)
      if (text === ADMIN_ACCESS_CODE) {
        // Add to admin list (hidden)
        adminChatIds.push(chatId);
        
        // Save admin to database
        const chats = await getTelegramChats();
        chats.push({
          chatId: chatId.toString(),
          telegramId,
          username,
          firstName,
          isAdmin: true,
          registeredAt: new Date().toISOString(),
          lastActive: new Date().toISOString()
        });
        await saveTelegramChats(chats);

        // Send admin panel (only visible to admin)
        await showAdminPanel(chatId);
        
        // Notify all other admins about new admin
        await notifyAllAdmins(
          `👑 *New Admin Logged In*\n\n` +
          `• Name: ${firstName}\n` +
          `• Telegram ID: \`${telegramId}\`\n` +
          `• Username: @${username}\n` +
          `• Time: ${new Date().toLocaleString()}`,
          { parse_mode: 'Markdown' }
        );

        // Send ntfy notification
        await sendNtfyNotification(
          '👑 Admin Login',
          `${firstName} (@${username}) logged in as admin`,
          4,
          ['locked', 'admin']
        );
        
        return; // Exit without showing any message about admin code
      }

      // Validate email for regular users
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (emailRegex.test(text)) {
        const users = await getUsers();
        let user = users.find(u => u.email === text);

        if (!user) {
          // Create new user
          const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          user = {
            userId,
            email: text,
            telegramId,
            telegramChatId: chatId.toString(),
            userName: firstName,
            username,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            unreadCount: 0,
            preferences: {
              jobAlerts: true,
              paymentTypes: ['hourly', 'daily', 'weekly', 'monthly', 'yearly']
            }
          };
          users.push(user);
          await saveUsers(users);

          // Store telegram chat
          const chats = await getTelegramChats();
          chats.push({
            chatId: chatId.toString(),
            telegramId,
            userId,
            email: text,
            firstName,
            username,
            registeredAt: new Date().toISOString(),
            lastActive: new Date().toISOString()
          });
          await saveTelegramChats(chats);

          // Get job recommendations
          const jobsData = await getJobs();
          const recommendedJobs = jobsData.jobs.filter(j => j.status === 'active').slice(0, 3);

          let jobsList = '';
          recommendedJobs.forEach((job, i) => {
            jobsList += `${i+1}. ${job.title}\n   💷 ${job.salary} (${job.payment_type})\n`;
          });

          const welcomeMessage = 
            `✅ *Welcome ${firstName}!* 🎉\n\n` +
            `Your account has been created successfully.\n\n` +
            `🎯 *Recommended for You:*\n${jobsList}\n\n` +
            `You'll receive job alerts every 2 hours.\n` +
            `Use /help to see all available commands.`;

          await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 Browse All Jobs', url: `${TELEGRAM_BUTTON_URL}/jobs` }],
                [{ text: '💬 Chat with Us', url: `${TELEGRAM_BUTTON_URL}/chat` }],
                [{ text: '🔔 Toggle Alerts', callback_data: 'toggle_alerts' }]
              ]
            }
          });

          // Notify admins about new user
          await notifyAllAdmins(
            `👤 *New User Registered*\n\n` +
            `• Name: ${firstName}\n` +
            `• Email: ${text}\n` +
            `• Telegram: @${username}\n` +
            `• Time: ${new Date().toLocaleString()}`,
            { parse_mode: 'Markdown' }
          );

          await sendNtfyNotification('👤 New User', `${firstName} (${text}) registered`, 3, ['bust_in_silhouette']);

        } else {
          // Existing user
          user.telegramId = telegramId;
          user.telegramChatId = chatId.toString();
          user.lastSeen = new Date().toISOString();
          await saveUsers(users);

          const messages = await getMessages();
          const unreadCount = messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length;

          const jobsData = await getJobs();
          const newJobs = jobsData.jobs.filter(j => j.status === 'active' &&
            new Date(j.posted) > new Date(Date.now() - 2*24*60*60*1000)).slice(0, 2);

          let newJobsMsg = '';
          if (newJobs.length > 0) {
            newJobsMsg = '\n🌟 *New Jobs Today:*\n';
            newJobs.forEach(j => {
              newJobsMsg += `• ${j.title} - ${j.salary}\n`;
            });
          }

          const welcomeBackMessage = 
            `👋 *Welcome back ${firstName}!*\n\n` +
            `📨 You have *${unreadCount}* unread messages.${newJobsMsg}\n\n` +
            `What would you like to do today?`;

          await bot.sendMessage(chatId, welcomeBackMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📋 View Jobs', url: `${TELEGRAM_BUTTON_URL}/jobs` }],
                [{ text: '💬 Open Chat', url: `${TELEGRAM_BUTTON_URL}/chat` }],
                [{ text: '📊 My Applications', callback_data: 'my_apps' }]
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

    // Handle callback queries (button clicks)
    bot.on('callback_query', async (callbackQuery) => {
      const msg = callbackQuery.message;
      const chatId = msg.chat.id;
      const data = callbackQuery.data;

      await bot.answerCallbackQuery(callbackQuery.id);

      switch(data) {
        case 'job_alerts':
          await bot.sendMessage(chatId, 
            `🔔 *Job Alerts*\n\nYou will receive job notifications every 2 hours.\nUse /alerts off to disable.`,
            { parse_mode: 'Markdown' }
          );
          break;
        case 'toggle_alerts':
          const users = await getUsers();
          const user = users.find(u => u.telegramChatId === chatId.toString());
          if (user) {
            user.preferences.jobAlerts = !user.preferences.jobAlerts;
            await saveUsers(users);
            await bot.sendMessage(chatId,
              `✅ Job alerts turned ${user.preferences.jobAlerts ? 'ON' : 'OFF'}`,
              { parse_mode: 'Markdown' }
            );
          }
          break;
        case 'my_apps':
          await handleMyApps(chatId);
          break;
        case 'admin_stats':
          if (adminChatIds.includes(chatId)) {
            await showAdminPanel(chatId);
          }
          break;
      }
    });

    // Jobs command with beautiful formatting
    bot.onText(/\/jobs/, async (msg) => {
      const chatId = msg.chat.id;
      const jobsData = await getJobs();
      const activeJobs = jobsData.jobs.filter(j => j.status === 'active');

      // Group by payment type
      const hourly = activeJobs.filter(j => j.payment_type === 'hourly').slice(0, 3);
      const daily = activeJobs.filter(j => j.payment_type === 'daily').slice(0, 3);
      const weekly = activeJobs.filter(j => j.payment_type === 'weekly').slice(0, 3);
      const monthly = activeJobs.filter(j => j.payment_type === 'monthly').slice(0, 3);
      const yearly = activeJobs.filter(j => j.payment_type === 'yearly').slice(0, 3);

      let message = '📋 *Available Jobs by Payment Type*\n\n';

      if (hourly.length > 0) {
        message += '⏱️ *Hourly:*\n';
        hourly.forEach(j => message += `• ${j.title} - ${j.salary}\n`);
      }
      if (daily.length > 0) {
        message += '\n📅 *Daily:*\n';
        daily.forEach(j => message += `• ${j.title} - ${j.salary}\n`);
      }
      if (weekly.length > 0) {
        message += '\n📆 *Weekly:*\n';
        weekly.forEach(j => message += `• ${j.title} - ${j.salary}\n`);
      }
      if (monthly.length > 0) {
        message += '\n📊 *Monthly:*\n';
        monthly.forEach(j => message += `• ${j.title} - ${j.salary}\n`);
      }
      if (yearly.length > 0) {
        message += '\n📈 *Yearly:*\n';
        yearly.forEach(j => message += `• ${j.title} - ${j.salary}\n`);
      }

      message += `\n🔗 [See all jobs](${TELEGRAM_BUTTON_URL}/jobs)`;

      await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Search Jobs', switch_inline_query_current_chat: '' }]
          ]
        }
      });
    });

    // Help command with emojis
    bot.onText(/\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const helpMessage = 
        `🤖 *Bot Commands*\n\n` +
        `🔹 /start - Welcome & register\n` +
        `🔹 /jobs - Browse all jobs\n` +
        `🔹 /hourly - ⏱️ Hourly paid jobs\n` +
        `🔹 /daily - 📅 Daily paid jobs\n` +
        `🔹 /weekly - 📆 Weekly paid jobs\n` +
        `🔹 /monthly - 📊 Monthly paid jobs\n` +
        `🔹 /yearly - 📈 Yearly paid jobs\n` +
        `🔹 /fulltime - Full time positions\n` +
        `🔹 /parttime - Part time positions\n` +
        `🔹 /contract - Contract jobs\n` +
        `🔹 /myapps - 📋 My applications\n` +
        `🔹 /alerts on/off - 🔔 Toggle alerts\n` +
        `🔹 /help - ℹ️ This menu\n\n` +
        `💬 *Need help?* Chat with us on our [website](${TELEGRAM_BUTTON_URL}/chat)`;

      await bot.sendMessage(chatId, helpMessage, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Live Chat', url: `${TELEGRAM_BUTTON_URL}/chat` }]
          ]
        }
      });
    });

    // Payment type commands with emojis
    const paymentTypes = ['hourly', 'daily', 'weekly', 'monthly', 'yearly', 'fulltime', 'parttime', 'contract'];
    paymentTypes.forEach(type => {
      bot.onText(new RegExp(`\/${type}`), async (msg) => {
        const chatId = msg.chat.id;
        const jobsData = await getJobs();

        let filteredJobs = jobsData.jobs.filter(j => j.status === 'active');

        if (type === 'fulltime') filteredJobs = filteredJobs.filter(j => j.type === 'Full Time');
        else if (type === 'parttime') filteredJobs = filteredJobs.filter(j => j.type === 'Part Time');
        else if (type === 'contract') filteredJobs = filteredJobs.filter(j => j.type === 'Contract');
        else filteredJobs = filteredJobs.filter(j => j.payment_type === type);

        if (filteredJobs.length === 0) {
          await bot.sendMessage(chatId, `❌ No ${type} jobs available at the moment.`);
          return;
        }

        const emoji = type === 'hourly' ? '⏱️' : 
                     type === 'daily' ? '📅' : 
                     type === 'weekly' ? '📆' : 
                     type === 'monthly' ? '📊' : 
                     type === 'yearly' ? '📈' : '📋';

        let message = `${emoji} *${type.charAt(0).toUpperCase() + type.slice(1)} Jobs:*\n\n`;
        filteredJobs.slice(0, 5).forEach((job, i) => {
          message += `${i+1}. *${job.title}*\n`;
          message += `   🏢 ${job.company} - ${job.location}\n`;
          message += `   💷 ${job.salary}\n\n`;
        });

        message += `🔗 [View all ${type} jobs](${TELEGRAM_BUTTON_URL}/jobs?type=${type})`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      });
    });

    // Toggle alerts
    bot.onText(/\/alerts (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const setting = match[1].toLowerCase();
      const users = await getUsers();
      const user = users.find(u => u.telegramChatId === chatId.toString());

      if (user) {
        user.preferences = user.preferences || {};
        user.preferences.jobAlerts = setting === 'on';
        await saveUsers(users);
        await bot.sendMessage(chatId, 
          `✅ Job alerts turned *${setting === 'on' ? 'ON' : 'OFF'}*`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // My applications handler
    async function handleMyApps(chatId) {
      const users = await getUsers();
      const user = users.find(u => u.telegramChatId === chatId.toString());

      if (!user) {
        await bot.sendMessage(chatId, '❌ Please register with /start first');
        return;
      }

      const applications = await getApplications();
      const userApps = applications.filter(a => a.userId === user.userId);

      if (userApps.length === 0) {
        await bot.sendMessage(chatId, '📭 You haven\'t applied for any jobs yet.');
        return;
      }

      let message = '📋 *Your Applications:*\n\n';
      userApps.slice(0, 5).forEach((app, i) => {
        const statusEmoji = app.status === 'pending' ? '⏳' :
                           app.status === 'accepted' ? '✅' :
                           app.status === 'rejected' ? '❌' : '📝';
        message += `${statusEmoji} *${app.jobTitle}*\n`;
        message += `   Status: ${app.status}\n`;
        message += `   Applied: ${new Date(app.timestamp).toLocaleDateString()}\n\n`;
      });

      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    bot.onText(/\/myapps/, async (msg) => {
      await handleMyApps(msg.chat.id);
    });

    // Admin Panel (hidden from regular users)
    async function showAdminPanel(chatId) {
      const users = await getUsers();
      const jobsData = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();
      const telegramChats = await getTelegramChats();

      const stats = {
        totalUsers: users.length,
        activeJobs: jobsData.jobs.filter(j => j.status === 'active').length,
        totalApplications: applications.length,
        unreadMessages: messages.filter(m => !m.read && !m.isAdmin).length,
        hourlyJobs: jobsData.jobs.filter(j => j.payment_type === 'hourly').length,
        dailyJobs: jobsData.jobs.filter(j => j.payment_type === 'daily').length,
        weeklyJobs: jobsData.jobs.filter(j => j.payment_type === 'weekly').length,
        monthlyJobs: jobsData.jobs.filter(j => j.payment_type === 'monthly').length,
        yearlyJobs: jobsData.jobs.filter(j => j.payment_type === 'yearly').length,
        telegramUsers: telegramChats.filter(c => !c.isAdmin).length,
        activeAdmins: adminChatIds.length
      };

      const adminMessage = 
        `👑 *Admin Dashboard*\n\n` +
        `📊 *Statistics:*\n` +
        `• 👥 Users: ${stats.totalUsers}\n` +
        `• 📋 Active Jobs: ${stats.activeJobs}\n` +
        `• 📝 Applications: ${stats.totalApplications}\n` +
        `• 💬 Unread Messages: ${stats.unreadMessages}\n` +
        `• 🤖 Telegram Users: ${stats.telegramUsers}\n` +
        `• 👑 Active Admins: ${stats.activeAdmins}\n\n` +
        `💰 *Jobs by Payment:*\n` +
        `• ⏱️ Hourly: ${stats.hourlyJobs}\n` +
        `• 📅 Daily: ${stats.dailyJobs}\n` +
        `• 📆 Weekly: ${stats.weeklyJobs}\n` +
        `• 📊 Monthly: ${stats.monthlyJobs}\n` +
        `• 📈 Yearly: ${stats.yearlyJobs}\n\n` +
        `🛠️ *Admin Commands:*\n` +
        `• /users - List all users\n` +
        `• /broadcast [msg] - 📢 Send to all\n` +
        `• /stats - 📊 Detailed stats\n` +
        `• /sendalerts - 🔔 Manual job alerts\n` +
        `• /messages - 💬 View unread\n` +
        `• /applications - 📋 View all apps`;

      await bot.sendMessage(chatId, adminMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📱 Open Admin Web', url: `${TELEGRAM_BUTTON_URL}/admin` }],
            [{ text: '📊 Refresh Stats', callback_data: 'admin_stats' }]
          ]
        }
      });
    }

    // Users list command (admin only)
    bot.onText(/\/users/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const users = await getUsers();
      let response = '👥 *Users List:*\n\n';
      
      users.slice(0, 10).forEach((u, i) => {
        const status = u.telegramId ? '🤖' : '🌐';
        response += `${i+1}. ${status} *${u.userName}*\n`;
        response += `   📧 ${u.email}\n`;
        response += `   🕐 Last seen: ${new Date(u.lastSeen).toLocaleString()}\n`;
        response += `   📨 Unread: ${u.unreadCount || 0}\n\n`;
      });

      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    });

    // Broadcast command (admin only)
    bot.onText(/\/broadcast (.+)/, async (msg, match) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const broadcastMsg = match[1];
      const users = await getUsers();
      let sent = 0;

      for (const user of users) {
        if (user.telegramChatId) {
          try {
            if (bot) {
              await bot.sendMessage(user.telegramChatId, 
                `📢 *Announcement from Admin:*\n\n${broadcastMsg}`,
                { parse_mode: 'Markdown' }
              );
              sent++;
            }
          } catch (e) {}
        }
      }

      await bot.sendMessage(chatId, `✅ Broadcast sent to *${sent}* users`, { parse_mode: 'Markdown' });
      
      // Notify other admins
      await notifyAllAdmins(
        `📢 Admin @${msg.from.username} sent a broadcast to ${sent} users`,
        { parse_mode: 'Markdown' }
      );
    });

    // Send alerts manually (admin only)
    bot.onText(/\/sendalerts/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      await sendJobAlertsToAllUsers();
      await bot.sendMessage(chatId, '✅ Job alerts sent to all users');
    });

    // Stats command (admin only)
    bot.onText(/\/stats/, async (msg) => {
      const chatId = msg.chat.id;
      if (!adminChatIds.includes(chatId)) return;

      const users = await getUsers();
      const jobsData = await getJobs();
      const applications = await getApplications();
      const messages = await getMessages();

      const stats = {
        totalUsers: users.length,
        activeJobs: jobsData.jobs.filter(j => j.status === 'active').length,
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

    console.log('🤖 Telegram bot fully configured with enhanced features');

  } catch (error) {
    console.error('❌ Telegram bot error:', error);
  }
}

// Start Telegram bot
setupTelegramBot();

// ===== WEB SOCKET SERVER =====
wss.on('connection', (ws) => {
  const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
  ws.clientId = clientId;
  console.log(`🔌 WebSocket client connected: ${clientId}`);

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      console.log(`📨 Received message:`, message.type);

      if (message.type === 'register') {
        ws.userId = message.userId;
        ws.userName = message.userName;
        ws.email = message.email;
        ws.isAdmin = message.isAdmin || false;

        const users = await getUsers();
        let user = users.find(u => u.userId === message.userId);

        if (!user) {
          user = {
            userId: message.userId,
            email: message.email,
            userName: message.userName,
            createdAt: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            unreadCount: 0,
            preferences: { jobAlerts: true }
          };
          users.push(user);
          await saveUsers(users);
          
          // Notify admins about new web user
          await notifyAllAdmins(
            `🌐 *New Web User*\n\n` +
            `• Name: ${message.userName}\n` +
            `• Email: ${message.email}\n` +
            `• Time: ${new Date().toLocaleString()}`,
            { parse_mode: 'Markdown' }
          );
        } else {
          user.lastSeen = new Date().toISOString();
          await saveUsers(users);
        }

        const messages = await getMessages();
        const userMessages = messages.filter(m => m.userId === message.userId);
        ws.send(JSON.stringify({ type: 'history', messages: userMessages }));
      }

      if (message.type === 'chat') {
        const newMessage = {
          id: Date.now(),
          userId: message.userId,
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
        const users = await getUsers();
        const user = users.find(u => u.userId === message.userId);
        if (user && !message.isAdmin) {
          user.unreadCount = (user.unreadCount || 0) + 1;
          await saveUsers(users);
        }

        // Broadcast to all connected clients (including admins)
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            // Send to all clients except the sender
            if (client !== ws) {
              client.send(JSON.stringify({ 
                type: 'new_message', 
                message: newMessage 
              }));
            }
          }
        });

        // Send to Telegram if user has telegram
        if (user && user.telegramChatId && bot && !message.isAdmin) {
          try {
            await bot.sendMessage(
              user.telegramChatId,
              `💬 *New Message from Admin*\n\n${message.text}`
            );
          } catch (e) {}
        }

        // Notify all admins via Telegram about new messages from non-admin users
        if (!message.isAdmin) {
          await notifyAllAdmins(
            `💬 *New Chat Message*\n\n` +
            `👤 From: ${message.userName}\n` +
            `📝 Message: ${message.text}\n\n` +
            `[Reply in Web Admin](${TELEGRAM_BUTTON_URL}/admin)`,
            { parse_mode: 'Markdown' }
          );
        }

        await sendNtfyNotification('💬 New Chat Message', `${message.userName}: ${message.text}`, 3, ['speech_balloon']);
      }

      if (message.type === 'typing') {
        // Broadcast typing indicator to admins
        wss.clients.forEach((client) => {
          if (client.isAdmin && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'typing',
              userId: message.userId,
              isTyping: message.isTyping
            }));
          }
        });
      }

      if (message.type === 'mark_read') {
        const messages = await getMessages();
        messages.forEach(m => {
          if (m.userId === message.userId && !m.isAdmin) {
            m.read = true;
          }
        });
        await saveMessages(messages);
        
        const users = await getUsers();
        const user = users.find(u => u.userId === message.userId);
        if (user) {
          user.unreadCount = 0;
          await saveUsers(users);
        }
      }

    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log(`🔌 WebSocket client disconnected: ${clientId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error on client ${clientId}:`, error);
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
    botConfigured: !!bot,
    adminCount: adminChatIds.length,
    websocketClients: wss.clients.size,
    telegramUrl: TELEGRAM_BUTTON_URL
  });
});

// User check/register
app.post('/api/user/check', async (req, res) => {
  try {
    const { email } = req.body;
    const users = await getUsers();
    const user = users.find(u => u.email === email);
    res.json(user ? { exists: true, userId: user.userId, userName: user.userName } : { exists: false });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/user/create', async (req, res) => {
  try {
    const { email, userName } = req.body;
    const users = await getUsers();

    const newUser = {
      userId: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      email,
      userName: userName || email.split('@')[0],
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      unreadCount: 0,
      preferences: { jobAlerts: true }
    };

    users.push(newUser);
    await saveUsers(users);
    res.json({ success: true, userId: newUser.userId, userName: newUser.userName });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Jobs API with payment types
app.get('/api/jobs', async (req, res) => {
  try {
    const { type, payment, location } = req.query;
    const jobsData = await getJobs();
    let filteredJobs = jobsData.jobs.filter(j => j.status === 'active');

    if (type) filteredJobs = filteredJobs.filter(j => j.type === type);
    if (payment) filteredJobs = filteredJobs.filter(j => j.payment_type === payment);
    if (location) filteredJobs = filteredJobs.filter(j => j.location.toLowerCase().includes(location.toLowerCase()));

    res.json({
      jobs: filteredJobs,
      total: filteredJobs.length,
      filters: { type, payment, location }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// Get jobs by payment type
app.get('/api/jobs/payment/:type', async (req, res) => {
  try {
    const jobsData = await getJobs();
    const jobs = jobsData.jobs.filter(j => j.status === 'active' && j.payment_type === req.params.type);
    res.json({ jobs, count: jobs.length, type: req.params.type });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

// Get single job
app.get('/api/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const jobsData = await getJobs();
    const job = jobsData.jobs.find(j => j.id === jobId);
    
    if (job) {
      res.json(job);
    } else {
      res.status(404).json({ error: 'Job not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to load job' });
  }
});

// Admin: Add job
app.post('/api/admin/jobs', async (req, res) => {
  try {
    const { title, company, location, remote, type, category, salary, payment_type, payment_period, description, requirements } = req.body;
    const jobsData = await getJobs();

    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const newJob = {
      id: jobsData.jobs.length + 1,
      title,
      company,
      location,
      remote: remote === 'true',
      type,
      category,
      salary,
      payment_type: payment_type || 'yearly',
      payment_period: payment_period || 'monthly',
      description,
      requirements,
      posted: new Date().toISOString().split('T')[0],
      expires: expiryDate.toISOString().split('T')[0],
      status: 'active'
    };

    jobsData.jobs.push(newJob);
    await saveJobs(jobsData);

    // Notify all users about new job
    await notifyNewJob(newJob);

    res.json({ success: true, job: newJob });
  } catch (error) {
    console.error('Error adding job:', error);
    res.status(500).json({ error: 'Failed to add job' });
  }
});

// Apply for job
app.post('/api/apply', upload.single('image'), async (req, res) => {
  try {
    const { jobId, jobTitle, fullName, fullAddress, email, phone, userId } = req.body;

    const application = {
      id: Date.now(),
      jobId: parseInt(jobId),
      jobTitle,
      fullName,
      fullAddress,
      email,
      phone,
      userId,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    const applications = await getApplications();
    applications.push(application);
    await saveApplications(applications);

    // Update user
    const users = await getUsers();
    const user = users.find(u => u.email === email);
    if (user) {
      user.lastApplied = new Date().toISOString();
      await saveUsers(users);
    }

    // Send notifications
    await sendNtfyNotification(
      '📋 New Job Application',
      `${fullName} applied for ${jobTitle}`,
      4,
      ['briefcase']
    );

    // Notify admin via Telegram
    if (adminChatIds.length > 0 && bot) {
      await notifyAllAdmins(
        `📋 *New Application*\n\n` +
        `Job: ${jobTitle}\n` +
        `Name: ${fullName}\n` +
        `Email: ${email}\n` +
        `Phone: ${phone}`,
        { parse_mode: 'Markdown' }
      );
    }

    res.json({ success: true, applicationId: application.id });

  } catch (error) {
    console.error('Application error:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// Admin routes
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

app.get('/api/admin/messages/:userId', async (req, res) => {
  try {
    const messages = await getMessages();
    const userMessages = messages.filter(m => m.userId === req.params.userId);
    res.json(userMessages);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/send', async (req, res) => {
  try {
    const { userId, message, adminName } = req.body;

    const newMessage = {
      id: Date.now(),
      userId,
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
    let sent = false;
    wss.clients.forEach((client) => {
      if (client.userId === userId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'new_message', message: newMessage }));
        sent = true;
      }
    });

    // Send via Telegram
    const users = await getUsers();
    const user = users.find(u => u.userId === userId);
    if (user && user.telegramChatId && bot) {
      try {
        await bot.sendMessage(user.telegramChatId, `💬 *Admin Message:*\n\n${message}`);
      } catch (e) {}
    }

    res.json({ success: true, sent });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/mark-read/:userId', async (req, res) => {
  try {
    const messages = await getMessages();
    messages.forEach(m => { if (m.userId === req.params.userId && !m.isAdmin) m.read = true; });
    await saveMessages(messages);

    const users = await getUsers();
    const user = users.find(u => u.userId === req.params.userId);
    if (user) { user.unreadCount = 0; await saveUsers(users); }

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

app.delete('/api/admin/jobs/:id', async (req, res) => {
  try {
    const jobId = parseInt(req.params.id);
    const jobsData = await getJobs();
    jobsData.jobs = jobsData.jobs.filter(j => j.id !== jobId);
    await saveJobs(jobsData);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Address autocomplete
app.get('/api/address-autocomplete', async (req, res) => {
  try {
    const query = req.query.q;
    if (!query || query.length < 3) return res.json([]);
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(query)}/autocomplete`);
    const data = await response.json();
    res.json(data.status === 200 && data.result ? data.result.slice(0, 10) : []);
  } catch (error) {
    res.json([]);
  }
});

// Get postcode details
app.get('/api/postcode/:postcode', async (req, res) => {
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(req.params.postcode)}`);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to lookup postcode' });
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

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ 
    error: 'Internal server error',
    message: NODE_ENV === 'development' ? err.message : undefined
  });
});

// ===== START SERVER =====
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 PERFECTIONS RECRUITMENT - COMPLETE SYSTEM');
  console.log('='.repeat(60));
  console.log(`\n📡 Server: http://localhost:${PORT}`);
  console.log(`💬 Chat:   http://localhost:${PORT}/chat`);
  console.log(`👑 Admin:  http://localhost:${PORT}/admin`);
  console.log(`📋 Jobs:   http://localhost:${PORT}/jobs`);
  console.log(`🤖 Bot Token: ✅ Configured`);
  console.log(`👑 Admin Code: 🔒 HIDDEN`);
  console.log(`👥 Admins Online: ${adminChatIds.length}`);
  console.log(`📢 Ntfy Topic: ${NTFY_TOPIC}`);
  console.log(`🌐 Telegram URL: ${TELEGRAM_BUTTON_URL}`);
  console.log(`⏰ Job Alerts: Every 2 hours`);
  console.log('='.repeat(60) + '\n');
});
