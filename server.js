// Load environment variables FIRST
require('dotenv').config();

const express = require('express');
const path = require('path');
const http = require('http');
const fs = require('fs-extra');
const { Server } = require('socket.io');
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
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
    }
});

// ===== CONFIGURATION =====
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
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Store admin chat IDs and bot instance
let adminChatIds = [];
let bot = null;
let connectedUsers = new Map(); // Store socket.io connections
let adminSessions = {}; // Store admin session states

console.log('\n' + '='.repeat(60));
console.log('🚀 PERFECTIONS RECRUITMENT - COMPLETE SERVER');
console.log('='.repeat(60));
console.log(`Environment: ${NODE_ENV}`);
console.log(`Port: ${PORT}`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Admin Code: ${ADMIN_ACCESS_CODE}`);
console.log('='.repeat(60) + '\n');

// ===== VALIDATE REQUIRED CONFIGURATION =====
if (!TELEGRAM_BOT_TOKEN) {
    console.error('\n❌ FATAL ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
    console.error('Please get a token from @BotFather on Telegram');
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
                        title: "💻 Senior Full Stack Developer",
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
                        description: "Immediate starts available for RGNs at local NHS trust.",
                        requirements: "Valid NMC registration",
                        posted: new Date().toISOString().split('T')[0],
                        expires: new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0],
                        status: "active"
                    }
                ]
            });
            console.log('✅ Created jobs.json with sample data');
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

        connectedUsers.forEach((socket) => {
            socket.emit('job_alert', {
                jobs: activeJobs,
                message: 'New job opportunities available!'
            });
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

        await notifyAllAdmins(
            `👑 *New Job Added by Admin*\n\n${job.title}\n🏢 ${job.company}\n💷 ${job.salary}`,
            { parse_mode: 'Markdown' }
        );

        connectedUsers.forEach((socket) => {
            socket.emit('new_job_alert', {
                job: job,
                message: 'New job just posted!'
            });
        });

        await sendNtfyNotification('📢 New Job Added', `${job.title} at ${job.company}`, 4, ['new', 'briefcase']);

    } catch (error) {
        console.error('Error notifying new job:', error);
    }
}

cron.schedule('0 */2 * * *', () => {
    console.log('🕐 Running scheduled job alerts...');
    sendJobAlertsToAllUsers();
});

// ===== TELEGRAM BOT SETUP WITH FULL CHAT CAPABILITIES =====
async function setupTelegramBot() {
    try {
        bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { 
            polling: true,
            onlyFirstMatch: false
        });
        
        console.log('✅ Telegram bot initialized successfully');

        // Handle /start command
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
                `🌟 *Your Trusted Recruitment Partner*\n\n` +
                `🔍 *Today's Featured Jobs:*\n${jobsPreview}\n\n` +
                `📧 *To get started, please enter your email address:*\n\n` +
                `_Admins: Enter ${ADMIN_ACCESS_CODE} for admin panel_`;

            await bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Browse All Jobs', url: `${BASE_URL}/jobs` }],
                        [{ text: '💬 Live Chat', url: `${BASE_URL}/chat` }],
                        [{ text: '📢 Job Alerts', callback_data: 'job_alerts' }]
                    ]
                }
            });
        });

        // Handle all messages (including chat messages from users)
        bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            const telegramId = msg.from.id.toString();
            const firstName = msg.from.first_name || 'User';
            const username = msg.from.username || 'No username';

            if (!text) return;

            // Check if this is a command
            if (text.startsWith('/')) {
                // Commands are handled by specific handlers
                return;
            }

            // Check for admin code
            if (text === ADMIN_ACCESS_CODE) {
                if (!adminChatIds.includes(chatId)) {
                    adminChatIds.push(chatId);
                }
                
                const chats = await getTelegramChats();
                if (!chats.find(c => c.chatId === chatId.toString())) {
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
                }

                adminSessions[chatId] = { step: 'main_menu' };
                await showAdminMainMenu(chatId);
                
                await notifyAllAdmins(
                    `👑 *New Admin Logged In*\n\n• Name: ${firstName}\n• Telegram: @${username}`,
                    { parse_mode: 'Markdown' }
                );

                await sendNtfyNotification('👑 Admin Login', `${firstName} logged in as admin`, 4, ['locked']);
                return;
            }

            // Check if this is a reply to a user (admin replying to a specific user)
            if (text.startsWith('/reply ')) {
                const parts = text.split(' ');
                if (parts.length >= 3) {
                    const targetUserId = parts[1];
                    const replyMsg = parts.slice(2).join(' ');
                    
                    await handleAdminReply(chatId, targetUserId, replyMsg);
                }
                return;
            }

            // Regular user message - treat as chat message
            const users = await getUsers();
            let user = users.find(u => u.telegramChatId === chatId.toString());

            if (!user) {
                // New user - ask for email
                await bot.sendMessage(chatId, 
                    `❓ *Please register first*\n\nSend your email address to start using the bot.`,
                    { parse_mode: 'Markdown' }
                );
                return;
            }

            // This is a chat message from a registered user
            const newMessage = {
                id: Date.now(),
                userId: user.userId,
                userEmail: user.email,
                userName: user.userName,
                message: text,
                isAdmin: false,
                platform: 'telegram',
                timestamp: new Date().toISOString(),
                read: false
            };

            const messages = await getMessages();
            messages.push(newMessage);
            await saveMessages(messages);

            // Update user unread count
            user.unreadCount = (user.unreadCount || 0) + 1;
            await saveUsers(users);

            // Send to all connected web admins via socket.io
            io.emit('new_message', newMessage);

            // Notify all Telegram admins
            await notifyAllAdmins(
                `💬 *New Message from ${user.userName}*\n\n` +
                `📝 ${text}\n\n` +
                `To reply: /reply ${user.userId} your message`,
                { parse_mode: 'Markdown' }
            );

            // Send confirmation to user
            await bot.sendMessage(chatId, 
                `✅ Message sent to our team. We'll get back to you soon!`,
                { parse_mode: 'Markdown' }
            );

            await sendNtfyNotification('💬 New Telegram Message', `${user.userName}: ${text}`, 3, ['speech_balloon']);
        });

        // Handle admin replies
        async function handleAdminReply(adminChatId, targetUserId, message) {
            try {
                const users = await getUsers();
                const user = users.find(u => u.userId === targetUserId);

                if (!user) {
                    await bot.sendMessage(adminChatId, `❌ User not found`);
                    return;
                }

                const newMessage = {
                    id: Date.now(),
                    userId: user.userId,
                    userEmail: user.email,
                    userName: 'Admin',
                    message: message,
                    isAdmin: true,
                    platform: 'telegram',
                    timestamp: new Date().toISOString(),
                    read: true
                };

                const messages = await getMessages();
                messages.push(newMessage);
                await saveMessages(messages);

                // Send to user via Telegram if they have it
                if (user.telegramChatId) {
                    await bot.sendMessage(user.telegramChatId, 
                        `💬 *Admin Message:*\n\n${message}\n\n[Reply in Web Chat](${BASE_URL}/chat)`,
                        { parse_mode: 'Markdown' }
                    );
                }

                // Send to user via socket.io if they're online
                const userSocket = connectedUsers.get(user.userId);
                if (userSocket) {
                    userSocket.emit('new_message', newMessage);
                }

                await bot.sendMessage(adminChatId, 
                    `✅ Reply sent to ${user.userName} (${user.email})`,
                    { parse_mode: 'Markdown' }
                );

                await sendNtfyNotification('📨 Admin Reply', `Admin replied to ${user.userName}`, 2, ['speech_balloon']);

            } catch (error) {
                console.error('Error in admin reply:', error);
                await bot.sendMessage(adminChatId, `❌ Failed to send reply`);
            }
        }

        // Handle callback queries
        bot.on('callback_query', async (callbackQuery) => {
            const msg = callbackQuery.message;
            const chatId = msg.chat.id;
            const data = callbackQuery.data;

            await bot.answerCallbackQuery(callbackQuery.id);

            const users = await getUsers();
            const user = users.find(u => u.telegramChatId === chatId.toString());

            if (!user && data !== 'job_alerts') {
                await bot.sendMessage(chatId, '❌ Please register with /start first');
                return;
            }

            switch(data) {
                case 'job_alerts':
                    await bot.sendMessage(chatId, 
                        `🔔 *Job Alerts*\n\nYou will receive job notifications every 2 hours.\nUse /alerts on/off to toggle.`,
                        { parse_mode: 'Markdown' }
                    );
                    break;
                    
                case 'toggle_alerts':
                    if (user) {
                        user.preferences = user.preferences || {};
                        user.preferences.jobAlerts = !user.preferences.jobAlerts;
                        await saveUsers(users);
                        await bot.sendMessage(chatId,
                            `✅ Job alerts turned ${user.preferences.jobAlerts ? 'ON' : 'OFF'}`,
                            { parse_mode: 'Markdown' }
                        );
                    }
                    break;
                    
                case 'my_apps':
                    await handleMyApps(chatId, user);
                    break;
                    
                case 'view_messages':
                    await showUserMessages(chatId, user);
                    break;
                    
                case 'admin_users':
                    if (adminChatIds.includes(chatId)) {
                        await showUserList(chatId);
                    }
                    break;
                    
                case 'admin_jobs':
                    if (adminChatIds.includes(chatId)) {
                        await showJobList(chatId);
                    }
                    break;
                    
                case 'admin_stats':
                    if (adminChatIds.includes(chatId)) {
                        await showAdminStats(chatId);
                    }
                    break;
                    
                case 'admin_broadcast':
                    if (adminChatIds.includes(chatId)) {
                        adminSessions[chatId] = { step: 'awaiting_broadcast' };
                        await bot.sendMessage(chatId, 
                            `📢 *Enter broadcast message:*`,
                            { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                        );
                    }
                    break;
                    
                case 'admin_back':
                    if (adminChatIds.includes(chatId)) {
                        await showAdminMainMenu(chatId);
                    }
                    break;
            }

            // Handle user selection from list
            if (data.startsWith('user_')) {
                const userId = data.replace('user_', '');
                if (adminChatIds.includes(chatId)) {
                    await showUserDetail(chatId, userId);
                }
            }

            // Handle reply to specific user
            if (data.startsWith('reply_')) {
                const userId = data.replace('reply_', '');
                if (adminChatIds.includes(chatId)) {
                    adminSessions[chatId] = { step: 'awaiting_reply', targetUserId: userId };
                    await bot.sendMessage(chatId, 
                        `✉️ *Type your reply:*`,
                        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
                    );
                }
            }
        });

        // Jobs command
        bot.onText(/\/jobs/, async (msg) => {
            const chatId = msg.chat.id;
            const jobsData = await getJobs();
            const activeJobs = jobsData.jobs.filter(j => j.status === 'active').slice(0, 5);

            let message = '📋 *Latest Jobs*\n\n';
            activeJobs.forEach((job, i) => {
                message += `${i+1}. *${job.title}*\n`;
                message += `   🏢 ${job.company} - ${job.location}\n`;
                message += `   💷 ${job.salary}\n\n`;
            });

            message += `🔗 [See all jobs](${BASE_URL}/jobs)`;

            await bot.sendMessage(chatId, message, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 Search Jobs', callback_data: 'search_jobs' }]
                    ]
                }
            });
        });

        // My messages command
        bot.onText(/\/messages/, async (msg) => {
            const chatId = msg.chat.id;
            const users = await getUsers();
            const user = users.find(u => u.telegramChatId === chatId.toString());

            if (!user) {
                await bot.sendMessage(chatId, '❌ Please register with /start first');
                return;
            }

            await showUserMessages(chatId, user);
        });

        // Help command
        bot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            const helpMessage = 
                `🤖 *Bot Commands*\n\n` +
                `• /start - Register with email\n` +
                `• /jobs - Browse latest jobs\n` +
                `• /messages - View your messages\n` +
                `• /help - Show this menu\n\n` +
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

        // Show user messages
        async function showUserMessages(chatId, user) {
            const messages = await getMessages();
            const userMessages = messages
                .filter(m => m.userId === user.userId)
                .slice(-10);

            if (userMessages.length === 0) {
                await bot.sendMessage(chatId, '📭 No messages yet.');
                return;
            }

            let messageText = '📋 *Your Recent Messages*\n\n';
            userMessages.reverse().forEach((msg, i) => {
                const sender = msg.isAdmin ? '👑 Admin' : '👤 You';
                const date = new Date(msg.timestamp).toLocaleString();
                messageText += `${sender} [${date}]:\n${msg.message}\n\n`;
            });

            await bot.sendMessage(chatId, messageText, { 
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 Send New Message', callback_data: 'send_message' }]
                    ]
                }
            });
        }

        // Handle my applications
        async function handleMyApps(chatId, user) {
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

        // ===== ADMIN FUNCTIONS =====
        async function showAdminMainMenu(chatId) {
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
                telegramUsers: telegramChats.filter(c => !c.isAdmin).length,
                activeAdmins: adminChatIds.length,
                onlineUsers: connectedUsers.size
            };

            const adminMessage = 
                `👑 *Admin Dashboard*\n\n` +
                `📊 *Statistics:*\n` +
                `• 👥 Total Users: ${stats.totalUsers}\n` +
                `• 📋 Active Jobs: ${stats.activeJobs}\n` +
                `• 📝 Applications: ${stats.totalApplications}\n` +
                `• 💬 Unread: ${stats.unreadMessages}\n` +
                `• 🤖 Telegram Users: ${stats.telegramUsers}\n` +
                `• 👑 Admins: ${stats.activeAdmins}\n` +
                `• 🟢 Online Now: ${stats.onlineUsers}\n\n` +
                `🛠️ *Select an option:*`;

            await bot.sendMessage(chatId, adminMessage, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👥 Manage Users', callback_data: 'admin_users' }],
                        [{ text: '📋 Manage Jobs', callback_data: 'admin_jobs' }],
                        [{ text: '📊 Statistics', callback_data: 'admin_stats' }],
                        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
                        [{ text: '🔙 Back', callback_data: 'admin_back' }]
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
                const online = connectedUsers.has(user.userId) ? '🟢' : '⚪';
                const platform = user.telegramId ? '🤖' : '🌐';
                
                message += `${online} ${platform} *${user.userName || 'Unknown'}*\n`;
                message += `   📧 ${user.email || 'N/A'}\n`;
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

            // Add user selection buttons
            const userRow = [];
            paginatedUsers.slice(0, 3).forEach(user => {
                userRow.push({ text: user.userName?.substring(0, 10) || 'User', callback_data: `user_${user.userId}` });
            });
            if (userRow.length > 0) {
                keyboard.push(userRow);
            }

            keyboard.push([{ text: '« Back to Main Menu', callback_data: 'admin_back' }]);

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        async function showUserDetail(chatId, userId) {
            const users = await getUsers();
            const user = users.find(u => u.userId === userId);
            if (!user) {
                await bot.sendMessage(chatId, '❌ User not found');
                return;
            }

            const messages = await getMessages();
            const userMessages = messages.filter(m => m.userId === userId);
            const unread = userMessages.filter(m => !m.read && !m.isAdmin).length;
            const applications = await getApplications();
            const userApps = applications.filter(a => a.userId === userId);

            const message = 
                `👤 *User Details*\n\n` +
                `• Name: ${user.userName}\n` +
                `• Email: ${user.email}\n` +
                `• Registered: ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}\n` +
                `• Last Seen: ${user.lastSeen ? new Date(user.lastSeen).toLocaleString() : 'Never'}\n` +
                `• Total Messages: ${userMessages.length}\n` +
                `• Unread: ${unread}\n` +
                `• Applications: ${userApps.length}\n` +
                `• Platform: ${user.telegramId ? 'Telegram' : 'Web'}\n` +
                `• Status: ${connectedUsers.has(userId) ? '🟢 Online' : '⚪ Offline'}`;

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💬 View Messages', callback_data: `view_msgs_${userId}` }],
                        [{ text: '✉️ Send Reply', callback_data: `reply_${userId}` }],
                        [{ text: '📋 Applications', callback_data: `user_apps_${userId}` }],
                        [{ text: '🔙 Back to Users', callback_data: 'admin_users' }],
                        [{ text: '« Main Menu', callback_data: 'admin_back' }]
                    ]
                }
            });
        }

        async function showJobList(chatId, page = 0) {
            const jobsData = await getJobs();
            const jobs = jobsData.jobs;
            const pageSize = 5;
            const start = page * pageSize;
            const end = start + pageSize;
            const paginatedJobs = jobs.slice(start, end);

            let message = `📋 *Jobs List (Page ${page+1}/${Math.ceil(jobs.length/pageSize)})*\n\n`;

            paginatedJobs.forEach((job, i) => {
                message += `${start + i + 1}. *${job.title}*\n`;
                message += `   🏢 ${job.company} - ${job.location}\n`;
                message += `   💷 ${job.salary}\n`;
                message += `   Status: ${job.status}\n\n`;
            });

            const keyboard = [];
            const navRow = [];

            if (page > 0) {
                navRow.push({ text: '⬅️ Previous', callback_data: `jobs_page_${page-1}` });
            }
            if (end < jobs.length) {
                navRow.push({ text: 'Next ➡️', callback_data: `jobs_page_${page+1}` });
            }
            if (navRow.length > 0) {
                keyboard.push(navRow);
            }

            keyboard.push([{ text: '➕ Add New Job', callback_data: 'admin_add_job' }]);
            keyboard.push([{ text: '« Main Menu', callback_data: 'admin_back' }]);

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

        async function showAdminStats(chatId) {
            const users = await getUsers();
            const jobsData = await getJobs();
            const applications = await getApplications();
            const messages = await getMessages();

            const webUsers = users.filter(u => !u.telegramId).length;
            const telegramUsers = users.filter(u => u.telegramId).length;
            const activeJobs = jobsData.jobs.filter(j => j.status === 'active').length;
            const totalMessages = messages.length;
            const unread = messages.filter(m => !m.read && !m.isAdmin).length;

            const stats = 
                `📊 *Detailed Statistics*\n\n` +
                `👥 **Users:**\n` +
                `• Total: ${users.length}\n` +
                `• Web: ${webUsers}\n` +
                `• Telegram: ${telegramUsers}\n` +
                `• Online Now: ${connectedUsers.size}\n\n` +
                `📋 **Jobs:**\n` +
                `• Total: ${jobsData.jobs.length}\n` +
                `• Active: ${activeJobs}\n\n` +
                `📝 **Applications:** ${applications.length}\n\n` +
                `💬 **Messages:**\n` +
                `• Total: ${totalMessages}\n` +
                `• Unread: ${unread}\n\n` +
                `🕐 **Last Updated:** ${new Date().toLocaleString()}`;

            await bot.sendMessage(chatId, stats, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Refresh', callback_data: 'admin_stats' }],
                        [{ text: '« Main Menu', callback_data: 'admin_back' }]
                    ]
                }
            });
        }

        // Handle page navigation callbacks
        bot.on('callback_query', async (callbackQuery) => {
            const msg = callbackQuery.message;
            const chatId = msg.chat.id;
            const data = callbackQuery.data;

            await bot.answerCallbackQuery(callbackQuery.id);

            if (!adminChatIds.includes(chatId)) return;

            if (data.startsWith('users_page_')) {
                const page = parseInt(data.split('_')[2]);
                await showUserList(chatId, page);
            }
            else if (data.startsWith('jobs_page_')) {
                const page = parseInt(data.split('_')[2]);
                await showJobList(chatId, page);
            }
            else if (data.startsWith('view_msgs_')) {
                const userId = data.split('_')[2];
                await showUserMessages(chatId, userId);
            }
            else if (data.startsWith('user_apps_')) {
                const userId = data.split('_')[2];
                await showUserApplications(chatId, userId);
            }
        });

        async function showUserApplications(chatId, userId) {
            const users = await getUsers();
            const user = users.find(u => u.userId === userId);
            if (!user) return;

            const applications = await getApplications();
            const userApps = applications.filter(a => a.userId === userId);

            if (userApps.length === 0) {
                await bot.sendMessage(chatId, `📭 No applications from ${user.userName}`);
                return;
            }

            let message = `📋 *Applications from ${user.userName}*\n\n`;
            userApps.forEach((app, i) => {
                message += `${i+1}. *${app.jobTitle}*\n`;
                message += `   Status: ${app.status}\n`;
                message += `   Applied: ${new Date(app.timestamp).toLocaleDateString()}\n\n`;
            });

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Back', callback_data: `user_${userId}` }]
                    ]
                }
            });
        }

        console.log('🤖 Telegram bot fully configured with chat capabilities');

    } catch (error) {
        console.error('❌ Telegram bot error:', error);
    }
}

// Start Telegram bot
setupTelegramBot();

// ===== SOCKET.IO SETUP =====
io.on('connection', (socket) => {
    const clientId = uuidv4();
    socket.clientId = clientId;
    console.log(`🔌 Socket.io client connected: ${clientId}`);

    socket.on('register', async (data) => {
        try {
            socket.userId = data.userId;
            socket.userName = data.userName;
            socket.userEmail = data.email?.toLowerCase();
            socket.isAdmin = data.isAdmin || false;

            connectedUsers.set(socket.userId, socket);

            const users = await getUsers();
            let user = users.find(u => u.userId === socket.userId);

            if (!user) {
                user = {
                    userId: socket.userId,
                    email: socket.userEmail,
                    userName: socket.userName,
                    createdAt: new Date().toISOString(),
                    lastSeen: new Date().toISOString(),
                    unreadCount: 0
                };
                users.push(user);
                await saveUsers(users);
                
                await notifyAllAdmins(
                    `🌐 *New Web User*\n\n` +
                    `• Name: ${socket.userName}\n` +
                    `• Email: ${socket.userEmail}\n` +
                    `• Time: ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );
            } else {
                user.lastSeen = new Date().toISOString();
                await saveUsers(users);
            }

            const messages = await getMessages();
            const userMessages = messages.filter(m => m.userId === socket.userId);
            socket.emit('history', userMessages);

            io.emit('user_status', {
                userId: socket.userId,
                userName: socket.userName,
                status: 'online'
            });

        } catch (error) {
            console.error('Socket registration error:', error);
        }
    });

    socket.on('chat_message', async (data) => {
        try {
            const newMessage = {
                id: Date.now(),
                userId: socket.userId,
                userEmail: socket.userEmail,
                userName: socket.userName,
                message: data.message,
                isAdmin: socket.isAdmin || false,
                platform: 'web',
                timestamp: new Date().toISOString(),
                read: false
            };

            const messages = await getMessages();
            messages.push(newMessage);
            await saveMessages(messages);

            const users = await getUsers();
            const user = users.find(u => u.userId === socket.userId);
            if (user && !socket.isAdmin) {
                user.unreadCount = (user.unreadCount || 0) + 1;
                await saveUsers(users);
            }

            // Broadcast to all connected clients
            io.emit('new_message', newMessage);

            // Send to Telegram admins
            if (!socket.isAdmin) {
                const adminMessage = 
                    `💬 *New Web Message*\n\n` +
                    `👤 From: ${socket.userName}\n` +
                    `📧 Email: ${socket.userEmail}\n` +
                    `📝 Message: ${data.message}\n\n` +
                    `To reply: /reply ${socket.userId} your message`;
                
                await notifyAllAdmins(adminMessage, { parse_mode: 'Markdown' });
            }

            // Send to Telegram user if they have it
            if (user && user.telegramChatId && bot && !socket.isAdmin) {
                try {
                    await bot.sendMessage(
                        user.telegramChatId,
                        `💬 *New Message from Admin*\n\n${data.message}`
                    );
                } catch (e) {}
            }

            await sendNtfyNotification('💬 New Chat Message', `${socket.userName}: ${data.message}`, 3, ['speech_balloon']);

        } catch (error) {
            console.error('Socket chat error:', error);
        }
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('user_typing', {
            userId: socket.userId,
            userName: socket.userName,
            isTyping: data.isTyping
        });
    });

    socket.on('mark_read', async (data) => {
        try {
            const messages = await getMessages();
            messages.forEach(m => {
                if (m.userId === socket.userId && !m.isAdmin) {
                    m.read = true;
                }
            });
            await saveMessages(messages);
            
            const users = await getUsers();
            const user = users.find(u => u.userId === socket.userId);
            if (user) {
                user.unreadCount = 0;
                await saveUsers(users);
            }

            socket.emit('messages_read', { success: true });
        } catch (error) {
            console.error('Mark read error:', error);
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Socket.io client disconnected: ${clientId}`);
        
        if (socket.userId) {
            connectedUsers.delete(socket.userId);
            
            io.emit('user_status', {
                userId: socket.userId,
                userName: socket.userName,
                status: 'offline'
            });
        }
    });
});

// ===== API ROUTES =====
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: NODE_ENV,
        uptime: process.uptime(),
        botConfigured: !!bot,
        adminCount: adminChatIds.length,
        onlineUsers: connectedUsers.size
    });
});

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
            unreadCount: 0
        };

        users.push(newUser);
        await saveUsers(users);
        res.json({ success: true, userId: newUser.userId, userName: newUser.userName });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

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

app.get('/api/user/:email/messages', async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        const users = await getUsers();
        const user = users.find(u => u.email === email);
        
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

app.get('/api/admin/users', async (req, res) => {
    try {
        const users = await getUsers();
        const messages = await getMessages();
        const usersWithUnread = users.map(user => ({
            ...user,
            unread: messages.filter(m => m.userId === user.userId && !m.read && !m.isAdmin).length,
            online: connectedUsers.has(user.userId)
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
            platform: 'web',
            timestamp: new Date().toISOString(),
            read: true
        };

        const messages = await getMessages();
        messages.push(newMessage);
        await saveMessages(messages);

        const userSocket = connectedUsers.get(userId);
        if (userSocket) {
            userSocket.emit('new_message', newMessage);
        }

        const users = await getUsers();
        const user = users.find(u => u.userId === userId);
        if (user && user.telegramChatId && bot) {
            try {
                await bot.sendMessage(user.telegramChatId, 
                    `💬 *Admin Message:*\n\n${message}\n\n[Reply in Web Chat](${BASE_URL}/chat)`,
                    { parse_mode: 'Markdown' }
                );
            } catch (e) {}
        }

        res.json({ success: true, delivered: !!userSocket });
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/mark-read/:userId', async (req, res) => {
    try {
        const messages = await getMessages();
        messages.forEach(m => { 
            if (m.userId === req.params.userId && !m.isAdmin) m.read = true; 
        });
        await saveMessages(messages);

        const users = await getUsers();
        const user = users.find(u => u.userId === req.params.userId);
        if (user) { 
            user.unreadCount = 0; 
            await saveUsers(users); 
        }

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

app.post('/api/admin/jobs', async (req, res) => {
    try {
        const { title, company, location, remote, type, category, salary, payment_type, description, requirements } = req.body;
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
            description,
            requirements,
            posted: new Date().toISOString().split('T')[0],
            expires: expiryDate.toISOString().split('T')[0],
            status: 'active'
        };

        jobsData.jobs.push(newJob);
        await saveJobs(jobsData);

        await notifyNewJob(newJob);

        res.json({ success: true, job: newJob });
    } catch (error) {
        console.error('Error adding job:', error);
        res.status(500).json({ error: 'Failed to add job' });
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

        const users = await getUsers();
        const user = users.find(u => u.email === email);
        if (user) {
            user.lastApplied = new Date().toISOString();
            await saveUsers(users);
        }

        await sendNtfyNotification(
            '📋 New Job Application',
            `${fullName} applied for ${jobTitle}`,
            4,
            ['briefcase']
        );

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

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ 
        error: 'Internal server error',
        message: NODE_ENV === 'development' ? err.message : undefined
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 PERFECTIONS RECRUITMENT - COMPLETE SYSTEM');
    console.log('='.repeat(60));
    console.log(`\n📡 Server: http://localhost:${PORT}`);
    console.log(`💬 Chat:   http://localhost:${PORT}/chat`);
    console.log(`👑 Admin:  http://localhost:${PORT}/admin`);
    console.log(`📋 Jobs:   http://localhost:${PORT}/jobs`);
    console.log(`🤖 Bot: ✅ Active with Full Chat Integration`);
    console.log(`👑 Admin Code: ${ADMIN_ACCESS_CODE}`);
    console.log(`👥 Admins Online: ${adminChatIds.length}`);
    console.log(`🟢 Users Online: ${connectedUsers.size}`);
    console.log(`📢 Ntfy Topic: ${NTFY_TOPIC}`);
    console.log(`⏰ Job Alerts: Every 2 hours`);
    console.log('='.repeat(60) + '\n');
});
