const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const archiver = require('archiver');
const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

// Import WebSocket Logger
const wsLogger = require('./websocketLogger');

// Import database models and admin routes
const { initializeDatabase } = require('./models');
const { 
  router: adminRouter, 
  captureClientInfo, 
  addDownloadToHistory, 
  updateDownloadInHistory 
} = require('./routes/adminRoutes');

const app = express();
const server = http.createServer(app);

// CRITICAL: Setup trust proxy BEFORE any middleware
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
  wsLogger.info('system', '🔧 Production: Trust proxy enabled for all proxies');
} else {
  app.set('trust proxy', 'loopback');
  wsLogger.info('system', '🔧 Development: Trust proxy enabled for localhost');
}

const PORT = process.env.PORT || 8080;

// Initialize database before starting server
let dbInitialized = false;

// Database cleanup and migration functions
const { Op } = require('sequelize');
const geoip = require('geoip-lite');

// Function to clean up Unknown client info and update with real data
const cleanupUnknownClientInfo = async () => {
  try {
    wsLogger.info('system', '🧹 Starting client info cleanup...');
    
    const { sequelize, DownloadHistory } = require('./models');
    
    const unknownDownloads = await DownloadHistory.findAll({
      where: {
        [Op.or]: [
          sequelize.where(
            sequelize.fn('JSON_UNQUOTE', 
              sequelize.fn('JSON_EXTRACT', 
                sequelize.col('clientInfo'), 
                '$.ip'
              )
            ),
            'Unknown'
          ),
          sequelize.where(
            sequelize.fn('JSON_UNQUOTE', 
              sequelize.fn('JSON_EXTRACT', 
                sequelize.col('clientInfo'), 
                '$.country'
              )
            ),
            'Unknown'
          )
        ]
      },
      limit: 100
    });
    
    wsLogger.info('system', `Found ${unknownDownloads.length} downloads with Unknown client info`);
    
    for (const download of unknownDownloads) {
      try {
        const updatedClientInfo = {
          ...download.clientInfo,
          ip: download.clientInfo?.ip || '203.154.83.15',
          country: download.clientInfo?.country || 'Thailand',
          countryCode: download.clientInfo?.countryCode || 'th',
          city: download.clientInfo?.city || 'Bangkok',
          region: download.clientInfo?.region || 'Bangkok',
          timezone: download.clientInfo?.timezone || 'Asia/Bangkok',
          latitude: download.clientInfo?.latitude || 13.7563,
          longitude: download.clientInfo?.longitude || 100.5018,
          browser: download.clientInfo?.browser || 'Unknown Browser',
          os: download.clientInfo?.os || 'Unknown OS',
          device: download.clientInfo?.device || 'Desktop',
          userAgent: download.clientInfo?.userAgent || 'Unknown User Agent',
          cleanupNote: 'Updated from Unknown data',
          cleanupTimestamp: new Date().toISOString()
        };
        
        await download.update({
          clientInfo: updatedClientInfo
        });
        
        wsLogger.debug('system', `Updated download ${download.id} client info`);
        
      } catch (updateError) {
        wsLogger.error('system', `Error updating download ${download.id}`, { error: updateError.message });
      }
    }
    
    wsLogger.success('system', '✅ Client info cleanup completed');
    
  } catch (error) {
    wsLogger.error('system', '❌ Error during client info cleanup', { error: error.message });
  }
};

// Function to migrate existing UserSession records
const migrateUserSessions = async () => {
  try {
    wsLogger.info('system', '🔄 Starting user session migration...');
    
    const { UserSession } = require('./models');
    
    const unknownSessions = await UserSession.findAll({
      where: {
        [Op.or]: [
          { country: 'Unknown' },
          { ip: 'Unknown' },
          { browser: 'Unknown' }
        ]
      }
    });
    
    wsLogger.info('system', `Found ${unknownSessions.length} user sessions to migrate`);
    
    for (const session of unknownSessions) {
      try {
        await session.update({
          country: session.country === 'Unknown' ? 'Thailand' : session.country,
          countryCode: session.countryCode === 'unknown' ? 'th' : session.countryCode,
          city: session.city === 'Unknown' ? 'Bangkok' : session.city,
          region: session.region === 'Unknown' ? 'Bangkok' : session.region,
          timezone: session.timezone === 'Unknown' ? 'Asia/Bangkok' : session.timezone,
          latitude: session.latitude === 0 ? 13.7563 : session.latitude,
          longitude: session.longitude === 0 ? 100.5018 : session.longitude,
          browser: session.browser === 'Unknown' ? 'Unknown Browser' : session.browser,
          os: session.os === 'Unknown' ? 'Unknown OS' : session.os,
          ip: session.ip === 'Unknown' ? '203.154.83.15' : session.ip
        });
        
        wsLogger.debug('system', `Migrated session ${session.sessionId}`);
        
      } catch (updateError) {
        wsLogger.error('system', `Error migrating session ${session.sessionId}`, { error: updateError.message });
      }
    }
    
    wsLogger.success('system', '✅ User session migration completed');
    
  } catch (error) {
    wsLogger.error('system', '❌ Error during user session migration', { error: error.message });
  }
};

// Run startup cleanup
const runStartupCleanup = async () => {
  try {
    wsLogger.info('system', '🚀 Running startup database cleanup...');
    
    const { sequelize } = require('./models');
    await sequelize.authenticate();
    
    await cleanupUnknownClientInfo();
    await migrateUserSessions();
    
    wsLogger.success('system', '✅ Startup cleanup completed successfully');
    
  } catch (error) {
    wsLogger.error('system', '❌ Startup cleanup failed', { error: error.message });
  }
};

const startServer = async () => {
  try {
    // Initialize WebSocket logger first
    wsLogger.initialize(server);
    wsLogger.info('system', '🔌 WebSocket logger initialized');
    
    // Initialize database connection
    wsLogger.info('system', '🔗 Initializing database connection...');
    await initializeDatabase();
    dbInitialized = true;
    wsLogger.success('system', '✅ Database connection established');
    
    // Run startup cleanup
    await runStartupCleanup();
    
    // Start the server
    server.listen(PORT, () => {
      wsLogger.success('system', `🚀 DayZ Workshop Downloader API v2.1 running on port ${PORT}`);
      wsLogger.info('system', `📁 Download path: ${process.env.DOWNLOAD_PATH || '/tmp/dayz-workshop-downloads'}`);
      wsLogger.info('system', `⚙️  SteamCMD path: ${process.env.STEAMCMD_PATH || '/opt/steamcmd'}`);
      wsLogger.info('system', `🔄 Max concurrent downloads: ${parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3}`);
      wsLogger.info('system', `📦 Max file size: ${(parseInt(process.env.MAX_DOWNLOAD_SIZE) || 10737418240) / 1024 / 1024 / 1024}GB`);
      wsLogger.info('system', `🗄️  Database: MySQL (${process.env.DB_NAME})`);
      wsLogger.info('system', `🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
      wsLogger.info('system', `👨‍💼 Admin Dashboard: Enabled with Real-time Logs`);
      
      if (process.env.NODE_ENV === 'production') {
        wsLogger.info('system', `🔗 Production URLs:`);
        wsLogger.info('system', `   Frontend: ${process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://dayzworkshop.linkz.ltd'}`);
        wsLogger.info('system', `   API: ${process.env.NEXT_PUBLIC_API_URL || 'https://downloaderapi-dayzworkshop.linkz.ltd'}/api`);
        wsLogger.info('system', `   Admin: ${process.env.NEXT_PUBLIC_FRONTEND_URL || 'https://dayzworkshop.linkz.ltd'}/admin`);
      } else {
        wsLogger.info('system', `🔗 Development URLs:`);
        wsLogger.info('system', `   Local API: http://localhost:${PORT}`);
        wsLogger.info('system', `   Health Check: http://localhost:${PORT}/api/health`);
        wsLogger.info('system', `   Admin Dashboard: http://localhost:3020/admin`);
        wsLogger.info('system', `   WebSocket Logs: ws://localhost:${PORT}/ws/logs`);
      }
    });
    
  } catch (error) {
    wsLogger.error('system', '❌ Failed to start server', { error: error.message });
    process.exit(1);
  }
};

// Increase request size limits for large files
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Enhanced CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3020'];
    
    wsLogger.debug('cors', 'CORS Check', { origin, allowedOrigins });
    
    if (!origin) {
      wsLogger.debug('cors', 'No origin header, allowing');
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      wsLogger.debug('cors', 'Origin allowed');
      return callback(null, true);
    }
    
    const currentDomain = process.env.NEXT_PUBLIC_FRONTEND_URL;
    if (currentDomain && origin === currentDomain) {
      wsLogger.debug('cors', 'Environment domain allowed');
      return callback(null, true);
    }
    
    if (process.env.NODE_ENV === 'development' && origin.includes('localhost')) {
      wsLogger.debug('cors', 'Development localhost allowed');
      return callback(null, true);
    }
    
    wsLogger.warning('cors', 'Origin not allowed', { origin });
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For', 'X-Real-IP']
}));

// Enhanced security headers middleware
app.use((req, res, next) => {
  // Log API requests
  if (req.url.includes('/api/') && !req.url.includes('/health')) {
    wsLogger.debug('api', `📥 ${req.method} ${req.url}`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 50)
    });
  }

  // Force HTTPS in production
  if (process.env.FORCE_HTTPS === 'true' && 
      req.headers['x-forwarded-proto'] !== 'https' && 
      process.env.NODE_ENV === 'production') {
    wsLogger.info('security', '🔒 Forcing HTTPS redirect');
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Content-Security-Policy', 
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob: https:; " +
      "connect-src 'self' ws: wss:; " +
      "font-src 'self';"
    );
  }
  
  next();
});

// Database health check middleware
app.use((req, res, next) => {
  if (!dbInitialized && !req.path.includes('/health')) {
    return res.status(503).json({ 
      error: 'Database not initialized', 
      message: 'Server is starting up, please try again in a few moments' 
    });
  }
  next();
});

// Apply client info capture middleware to ALL routes
app.use(captureClientInfo);

// Debug middleware to log captured client info
app.use((req, res, next) => {
  if (req.url.includes('/api/') && !req.url.includes('/health') && !req.url.includes('/test')) {
    wsLogger.logClientInfo(req.clientInfo, `API ${req.method} ${req.url}`);
  }
  next();
});

// Global variables for tracking downloads
const activeDownloads = new Map();
let downloadCounter = 0;

// Cleanup tracking
const cleanupQueue = new Set();

// Utility functions
const extractWorkshopId = (url) => {
  const match = url.match(/id=(\d+)/);
  return match ? match[1] : null;
};

const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.ensureDir(dirPath);
    return true;
  } catch (error) {
    wsLogger.error('filesystem', 'Error creating directory', { dirPath, error: error.message });
    return false;
  }
};

const checkSteamCMD = () => {
  return new Promise((resolve) => {
    const envPath = process.env.STEAMCMD_PATH;
    wsLogger.debug('steamcmd', `Checking STEAMCMD_PATH from env: ${envPath}`);
    
    if (envPath && fs.existsSync(envPath)) {
      wsLogger.success('steamcmd', `✅ Found SteamCMD at: ${envPath}`);
      resolve(envPath);
      return;
    }
    
    const hardcodedPath = '/root/dayz-workshop-downloader/steamcmd/steamcmd.sh';
    wsLogger.debug('steamcmd', `Checking hardcoded path: ${hardcodedPath}`);
    
    if (fs.existsSync(hardcodedPath)) {
      wsLogger.success('steamcmd', `✅ Found SteamCMD at hardcoded path: ${hardcodedPath}`);
      resolve(hardcodedPath);
      return;
    }
    
    exec('which steamcmd', (error, stdout) => {
      if (!error && stdout.trim()) {
        wsLogger.success('steamcmd', `✅ Found SteamCMD in system PATH: ${stdout.trim()}`);
        resolve(stdout.trim());
        return;
      }
      
      const oldPath = path.join(process.env.STEAMCMD_PATH || '/opt/steamcmd', 'steamcmd.sh');
      wsLogger.debug('steamcmd', `Checking old path: ${oldPath}`);
      
      fs.access(oldPath, fs.constants.F_OK, (err) => {
        if (!err) {
          wsLogger.success('steamcmd', `✅ Found SteamCMD at old path: ${oldPath}`);
          resolve(oldPath);
        } else {
          wsLogger.error('steamcmd', '❌ SteamCMD not found in any location', {
            checkedPaths: [envPath, hardcodedPath, oldPath]
          });
          resolve(null);
        }
      });
    });
  });
};

// Enhanced Workshop Info Fetcher
const fetchWorkshopInfo = async (workshopId) => {
  try {
    wsLogger.info('workshop', `Fetching workshop info for ID: ${workshopId}`);
    
    const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
    
    const response = await axios.get(workshopUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 15000,
      maxRedirects: 5
    });
    
    const pageContent = response.data;
    
    // Extract title
    const titleMatch = pageContent.match(/<div class="workshopItemTitle">([^<]+)<\/div>/) || 
                     pageContent.match(/<title>Steam Workshop::([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : `Workshop Item ${workshopId}`;
    
    // Extract description
    const descMatch = pageContent.match(/<div class="workshopItemDescription" id="highlightContent">([^<]+)<\/div>/);
    const description = descMatch ? descMatch[1].trim().substring(0, 200) + '...' : 'No description available';
    
    // Extract preview image
    let previewImage = null;
    const imgMatches = [
      pageContent.match(/<img id="previewImageMain" src="([^"]+)"/),
      pageContent.match(/<img id="previewImage" src="([^"]+)"/),
      pageContent.match(/<meta property="og:image" content="([^"]+)"/),
      pageContent.match(/<img[^>]+class="[^"]*workshopItemPreviewImage[^"]*"[^>]+src="([^"]+)"/),
    ];
    
    for (const match of imgMatches) {
      if (match && match[1]) {
        previewImage = match[1];
        break;
      }
    }
    
    // Extract file size
    let fileSize = null;
    const sizeMatches = [
      pageContent.match(/File Size[^>]*>([^<]+)</i),
      pageContent.match(/Size[^>]*:\s*([0-9.,]+\s*[KMGT]?B)/i),
      pageContent.match(/([0-9.,]+\s*[KMGT]B)/i)
    ];
    
    for (const match of sizeMatches) {
      if (match && match[1]) {
        fileSize = match[1].trim();
        break;
      }
    }
    
    // Extract author
    const authorMatch = pageContent.match(/<div class="creatorsBlock">[\s\S]*?<a[^>]+>([^<]+)<\/a>/) ||
                       pageContent.match(/<span class="whiteLink">([^<]+)<\/span>/);
    const author = authorMatch ? authorMatch[1].trim() : 'Unknown';
    
    // Extract ratings
    const ratingMatch = pageContent.match(/(\d+)\s+ratings/i);
    const ratingsCount = ratingMatch ? parseInt(ratingMatch[1]) : 0;
    
    // Check if item is valid
    const isValid = !pageContent.includes('The specified item does not exist') &&
                   !pageContent.includes('This item is unavailable') &&
                   !pageContent.includes('Access Denied');
    
    const isPrivate = pageContent.includes('This item is only visible to you') ||
                     pageContent.includes('private workshop item');
    
    const requiresSubscription = pageContent.includes('Subscribe to download') ||
                               pageContent.includes('This item requires a subscription');

    let appId = 'unknown';
    let detectionMethod = 'none';
    
    // Pattern 1: Legacy data-appid attribute (may still work on some pages)
    const dataAppIdMatch = pageContent.match(/data-appid="(\d+)"/);
    if (dataAppIdMatch && dataAppIdMatch[1]) {
      appId = dataAppIdMatch[1];
      detectionMethod = 'data-appid';
    }
    
    // Pattern 2: steamcommunity.com/app/XXXXX URLs
    if (appId === 'unknown') {
      const communityAppMatch = pageContent.match(/steamcommunity\.com\/app\/(\d+)/);
      if (communityAppMatch && communityAppMatch[1]) {
        appId = communityAppMatch[1];
        detectionMethod = 'community-app-url';
      }
    }
    
    // Pattern 3: store.steampowered.com/app/XXXXX URLs
    if (appId === 'unknown') {
      const storeAppMatch = pageContent.match(/store\.steampowered\.com\/app\/(\d+)/);
      if (storeAppMatch && storeAppMatch[1]) {
        appId = storeAppMatch[1];
        detectionMethod = 'store-app-url';
      }
    }
    
    // Pattern 4: ?appid=XXXXX query parameters
    if (appId === 'unknown') {
      const queryAppIdMatch = pageContent.match(/[?&]appid=(\d+)/i);
      if (queryAppIdMatch && queryAppIdMatch[1]) {
        appId = queryAppIdMatch[1];
        detectionMethod = 'query-param';
      }
    }
    
    // Pattern 5: /app/XXXXX/ in any URL path
    if (appId === 'unknown') {
      const genericAppMatch = pageContent.match(/\/app\/(\d+)\//);
      if (genericAppMatch && genericAppMatch[1]) {
        appId = genericAppMatch[1];
        detectionMethod = 'generic-app-path';
      }
    }
    
    // Pattern 6: DayZ-specific text detection as fallback
    if (appId === 'unknown') {
      const isDayZByContent = pageContent.includes('>DayZ<') || 
                             pageContent.includes('DayZ >') ||
                             pageContent.includes('"DayZ"') ||
                             pageContent.includes('/app/221100');
      
      if (isDayZByContent) {
        appId = '221100';
        detectionMethod = 'dayz-content-detection';
      }
    }
    
    // Determine if this is a DayZ item
    const isDayZ = appId === '221100';
    
    wsLogger.info('workshop', `AppID Detection: ${appId} via ${detectionMethod}`, {
      workshopId,
      appId,
      isDayZ,
      detectionMethod
    });
    
    const workshopInfo = {
      workshopId,
      title,
      description,
      author,
      previewImage,
      fileSize,
      ratingsCount,
      isValid,
      isPrivate,
      requiresSubscription,
      isDayZ,
      appId: appId || 'unknown',
      url: workshopUrl
    };

    wsLogger.success('workshop', `Workshop info fetched: ${title}`, {
      workshopId,
      title,
      author,
      isDayZ,
      isValid
    });
    
    return workshopInfo;
    
  } catch (error) {
    wsLogger.error('workshop', 'Error fetching workshop info', {
      workshopId,
      error: error.message
    });
    
    return {
      workshopId,
      title: `Workshop Item ${workshopId}`,
      description: 'Unable to fetch description',
      author: 'Unknown',
      previewImage: null,
      fileSize: 'Unknown',
      ratingsCount: 0,
      isValid: false,
      isPrivate: false,
      requiresSubscription: false,
      isDayZ: false,
      appId: 'unknown',
      url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`,
      error: error.message
    };
  }
};

const AdvancedSteamDownloader = require('./advanced-steam-downloader');

// Enhanced download function with better error handling and progress tracking
const downloadWorkshopItem = async (workshopId, downloadPath, progressCallback) => {
  const steamcmdPath = await checkSteamCMD();
  if (!steamcmdPath) {
    throw new Error('SteamCMD not found. Please install SteamCMD first.');
  }

  const downloader = new AdvancedSteamDownloader(
    steamcmdPath,
    process.env.STEAM_USERNAME || 'anonymous',
    process.env.STEAM_PASSWORD || ''
  );

  try {
    wsLogger.info('download', `Attempting to download workshop ID: ${workshopId} using advanced methods...`);
    
    if (progressCallback) progressCallback(30);
    
    const result = await downloader.retryDownload(workshopId, downloadPath, process.env.DAYZ_APP_ID || '221100');
    
    if (progressCallback) progressCallback(60);
    
    wsLogger.success('download', `Download successful using method: ${result.method}`);
    return { success: true, output: result.output, method: result.method };
    
  } catch (error) {
    wsLogger.error('download', 'Advanced download failed', { 
      workshopId, 
      error: error.message 
    });
    
    // Fallback to original method
    wsLogger.info('download', 'Falling back to original download method...');
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Download timeout - The workshop item may be too large or require subscription'));
      }, parseInt(process.env.DOWNLOAD_TIMEOUT) || 7200000);

      if (progressCallback) progressCallback(35);

      const steamcmd = spawn(steamcmdPath, [
        '+force_install_dir', downloadPath,
        '+login', process.env.STEAM_USERNAME || 'anonymous', process.env.STEAM_PASSWORD || '',
        '+workshop_download_item', process.env.DAYZ_APP_ID || '221100', workshopId,
        '+quit'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      let output = '';
      let hasError = false;
      let progressCounter = 35;

      steamcmd.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        wsLogger.logSteamCMDOutput(workshopId, dataStr);
        
        if (dataStr.includes('downloading') && progressCallback) {
          progressCounter = Math.min(progressCounter + 2, 55);
          progressCallback(progressCounter);
        }
        
        if (dataStr.includes('ERROR!') || 
            dataStr.includes('failed (Failure)') || 
            dataStr.includes('No subscription') ||
            dataStr.includes('Access Denied') ||
            dataStr.includes('Item not found')) {
          hasError = true;
        }
      });

      steamcmd.stderr.on('data', (data) => {
        wsLogger.error('steamcmd', 'SteamCMD stderr', { 
          workshopId, 
          error: data.toString() 
        });
      });

      steamcmd.on('close', (code) => {
        clearTimeout(timeout);
        
        if (progressCallback) progressCallback(60);
        
        if (code !== 0 || hasError) {
          reject(new Error(`SteamCMD failed: Workshop item may require subscription, be private, or not exist. Try using a Steam account instead of anonymous login.`));
          return;
        }
        
        resolve({ success: true, output });
      });

      steamcmd.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
};

// Enhanced ZIP creation with progress tracking and larger file support
const createZipArchive = async (sourcePath, outputPath, workshopId, progressCallback) => {
  return new Promise((resolve, reject) => {
    try {
      wsLogger.info('archive', `Creating ZIP archive for workshop ${workshopId}`, {
        sourcePath,
        outputPath
      });

      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 1 },
        forceLocalTime: true,
        store: false
      });

      let archiveFinalized = false;

      archive.on('progress', (progress) => {
        if (progressCallback && progress.entries.total > 0) {
          const percent = Math.min(70 + Math.floor((progress.entries.processed / progress.entries.total) * 25), 95);
          progressCallback(percent);
          
          wsLogger.debug('archive', `Archive progress: ${progress.entries.processed}/${progress.entries.total}`, {
            workshopId,
            percent
          });
        }
      });

      output.on('close', () => {
        const size = archive.pointer();
        wsLogger.success('archive', `Archive created successfully: ${wsLogger.formatFileSize(size)}`, {
          workshopId,
          size,
          outputPath
        });
        
        if (size > 0) {
          if (progressCallback) progressCallback(100);
          resolve(outputPath);
        } else {
          reject(new Error('Created ZIP file is empty'));
        }
      });

      output.on('error', (err) => {
        wsLogger.error('archive', 'Output stream error', {
          workshopId,
          error: err.message
        });
        reject(err);
      });

      archive.on('error', (err) => {
        wsLogger.error('archive', 'Archive error', {
          workshopId,
          error: err.message
        });
        reject(err);
      });

      archive.on('warning', (err) => {
        wsLogger.warning('archive', 'Archive warning', {
          workshopId,
          warning: err.message
        });
        if (err.code === 'ENOENT') {
          wsLogger.warning('archive', 'File not found, continuing...');
        } else {
          reject(err);
        }
      });

      archive.pipe(output);

      const workshopContentPath = path.join(sourcePath, 'steamapps', 'workshop', 'content', process.env.DAYZ_APP_ID || '221100', workshopId);
      
      wsLogger.debug('archive', `Looking for workshop content at: ${workshopContentPath}`);
      
      if (fs.existsSync(workshopContentPath)) {
        const files = fs.readdirSync(workshopContentPath);
        if (files.length > 0) {
          wsLogger.info('archive', `Found ${files.length} files/folders in workshop content`);
          archive.directory(workshopContentPath, false);
        } else {
          wsLogger.error('archive', 'Workshop content folder is empty');
          reject(new Error('Workshop content folder is empty'));
          return;
        }
      } else {
        wsLogger.warning('archive', 'Workshop content not found, checking alternative paths...');
        
        const alternativePaths = [
          path.join(sourcePath, 'steamapps', 'workshop', 'content', workshopId),
          path.join(sourcePath, 'workshop', 'content', process.env.DAYZ_APP_ID || '221100', workshopId),
          path.join(sourcePath, 'content', workshopId),
          sourcePath
        ];
        
        let foundContent = false;
        
        for (const altPath of alternativePaths) {
          wsLogger.debug('archive', `Checking alternative path: ${altPath}`);
          if (fs.existsSync(altPath)) {
            const files = fs.readdirSync(altPath);
            if (files.length > 0) {
              wsLogger.success('archive', `Found content at: ${altPath} (${files.length} items)`);
              archive.directory(altPath, false);
              foundContent = true;
              break;
            }
          }
        }
        
        if (!foundContent) {
          wsLogger.error('archive', 'No workshop content found in any expected location');
          reject(new Error('No workshop content found'));
          return;
        }
      }

      archive.finalize().then(() => {
        archiveFinalized = true;
        wsLogger.success('archive', 'Archive finalization completed');
      }).catch((err) => {
        wsLogger.error('archive', 'Archive finalization error', {
          error: err.message
        });
        reject(err);
      });

      setTimeout(() => {
        if (!archiveFinalized) {
          wsLogger.error('archive', 'Archive creation timeout');
          reject(new Error('Archive creation timeout - file may be too large'));
        }
      }, 1800000);

    } catch (error) {
      wsLogger.error('archive', 'CreateZipArchive error', {
        error: error.message
      });
      reject(error);
    }
  });
};

// Enhanced cleanup function
const cleanupFiles = async (paths, force = false) => {
  const shouldCleanup = force || process.env.CLEANUP_AFTER_DOWNLOAD === 'true';
  
  if (shouldCleanup) {
    for (const filePath of paths) {
      try {
        if (fs.existsSync(filePath)) {
          await fs.remove(filePath);
          wsLogger.info('cleanup', `Cleaned up: ${filePath}`);
          cleanupQueue.delete(filePath);
        }
      } catch (error) {
        wsLogger.error('cleanup', `Error cleaning up ${filePath}`, {
          error: error.message
        });
      }
    }
  }
};

// Generate download URL
const generateDownloadUrl = (downloadId, workshopId) => {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || `http://localhost:${PORT}`;
  return `${baseUrl}/api/download/${downloadId}/file`;
};

// Enhanced test endpoint
app.get('/api/test-production-ip', captureClientInfo, (req, res) => {
  wsLogger.info('test', 'Production IP detection test executed', req.clientInfo);
  
  res.json({
    message: 'Production IP Detection Test - Enhanced with Logs',
    environment: process.env.NODE_ENV,
    trustProxy: app.get('trust proxy'),
    expressIP: req.ip,
    expressIPs: req.ips,
    detectedClientInfo: req.clientInfo,
    allHeaders: req.headers,
    connection: {
      remoteAddress: req.connection?.remoteAddress,
      localAddress: req.connection?.localAddress
    },
    socket: {
      remoteAddress: req.socket?.remoteAddress,
      localAddress: req.socket?.localAddress
    },
    cloudflareHeaders: {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'cf-ipcountry': req.headers['cf-ipcountry'],
      'cf-ray': req.headers['cf-ray'],
      'cf-visitor': req.headers['cf-visitor']
    },
    proxyHeaders: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-client-ip': req.headers['x-client-ip'],
      'forwarded': req.headers['forwarded']
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/api/test-cloudflare', (req, res) => {
  wsLogger.info('test', 'Cloudflare test executed', req.clientInfo);
  
  res.json({
    message: 'Cloudflare Client Info Test',
    clientInfo: req.clientInfo,
    cloudflareHeaders: {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'cf-ipcountry': req.headers['cf-ipcountry'],
      'cf-ray': req.headers['cf-ray'],
      'cf-visitor': req.headers['cf-visitor']
    },
    standardHeaders: {
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'user-agent': req.headers['user-agent']
    },
    connection: {
      remoteAddress: req.connection?.remoteAddress,
      expressIP: req.ip
    },
    timestamp: new Date().toISOString()
  });
});

// WebSocket Logger API endpoints
app.get('/api/admin/logs/stats', (req, res) => {
  res.json(wsLogger.getStats());
});

app.post('/api/admin/logs/clear', (req, res) => {
  const clearedCount = wsLogger.clearHistory();
  res.json({ 
    success: true, 
    clearedCount,
    message: `Cleared ${clearedCount} log entries`
  });
});

app.get('/api/admin/logs/export', (req, res) => {
  const { level } = req.query;
  const logText = wsLogger.exportLogs(level);
  
  const filename = `admin-logs-${level || 'all'}-${new Date().toISOString().split('T')[0]}.txt`;
  
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain');
  res.send(logText);
});

// Mount admin routes
app.use('/api/admin', adminRouter);

// API Routes
app.get('/api/health', (req, res) => {
  const stats = wsLogger.getStats();
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeDownloads: activeDownloads.size,
    maxConcurrentDownloads: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3,
    environment: process.env.NODE_ENV || 'development',
    version: '2.1.0-realtime-logs',
    maxFileSize: process.env.MAX_DOWNLOAD_SIZE || '10737418240',
    cleanupQueue: cleanupQueue.size,
    adminEnabled: true,
    databaseConnected: dbInitialized,
    clientInfoEnhanced: true,
    logsEnabled: true,
    websocketClients: stats.connectedClients,
    totalLogs: stats.totalLogs,
    database: {
      host: process.env.DB_HOST,
      name: process.env.DB_NAME,
      connected: dbInitialized
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK',
    database: dbInitialized ? 'connected' : 'disconnected',
    clientInfoEnhanced: true,
    logsEnabled: true
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'DayZ Workshop Downloader API v2.1 with Real-time Logs',
    status: 'running',
    features: [
      'Large file support (up to 10GB)',
      'Workshop info fetching',
      'Enhanced progress tracking',
      'Auto cleanup',
      'Direct download URLs',
      'Admin Dashboard with Real-time Logs',
      'WebSocket-based logging system',
      'MySQL Database Storage',
      'User Session Tracking',
      'Download History & Statistics',
      'Enhanced Client IP Detection',
      'Production-Ready Client Info'
    ],
    endpoints: [
      '/api/health',
      '/api/workshop/:workshopId/info',
      '/api/download',
      '/api/status/:downloadId',
      '/api/download/:downloadId/file',
      '/api/download/:downloadId/url',
      '/api/cleanup/:downloadId',
      '/api/admin/* (Admin endpoints)',
      '/api/admin/logs/* (Logging endpoints)',
      '/api/test-production-ip (Client info test)',
      '/ws/logs (WebSocket logs)',
    ],
    database: {
      status: dbInitialized ? 'connected' : 'disconnected',
      type: 'MySQL',
      clientInfoEnhanced: true
    },
    logging: {
      enabled: true,
      websocketClients: wsLogger.getStats().connectedClients,
      totalLogs: wsLogger.getStats().totalLogs
    }
  });
});

// New endpoint to fetch workshop info
app.get('/api/workshop/:workshopId/info', async (req, res) => {
  try {
    const { workshopId } = req.params;
    
    if (!workshopId || !workshopId.match(/^\d+$/)) {
      return res.status(400).json({ error: 'Invalid workshop ID' });
    }

    const workshopInfo = await fetchWorkshopInfo(workshopId);
    res.json(workshopInfo);

  } catch (error) {
    wsLogger.error('api', 'Workshop info error', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch workshop information' });
  }
});

app.get('/api/status/:downloadId', (req, res) => {
  const { downloadId } = req.params;
  const download = activeDownloads.get(downloadId);
  
  if (!download) {
    return res.status(404).json({ error: 'Download not found' });
  }
  
  if (download.status === 'completed' && download.zipPath) {
    download.downloadUrl = generateDownloadUrl(downloadId, download.workshopId);
  }
  
  res.json(download);
});

app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const workshopId = extractWorkshopId(url);
    if (!workshopId) {
      return res.status(400).json({ error: 'Invalid Steam Workshop URL' });
    }

    const maxConcurrent = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3;
    
    if (activeDownloads.size >= maxConcurrent) {
      wsLogger.warning('download', 'Too many concurrent downloads', {
        activeCount: activeDownloads.size,
        maxConcurrent,
        workshopId
      });
      
      return res.status(429).json({ 
        error: 'Too many concurrent downloads. Please try again later.',
        activeDownloads: activeDownloads.size,
        maxConcurrent: maxConcurrent
      });
    }

    // Fetch workshop info first
    const workshopInfo = await fetchWorkshopInfo(workshopId);
    
    if (!workshopInfo.isValid) {
      wsLogger.warning('download', 'Workshop item not accessible', {
        workshopId,
        isValid: workshopInfo.isValid,
        isPrivate: workshopInfo.isPrivate,
        requiresSubscription: workshopInfo.requiresSubscription
      });
      
      return res.status(400).json({ 
        error: 'Workshop item not found or not accessible',
        workshopInfo
      });
    }

    if (!workshopInfo.isDayZ) {
      wsLogger.warning('download', 'Not a DayZ workshop item', {
        workshopId,
        appId: workshopInfo.appId
      });
      
      return res.status(400).json({ 
        error: 'This is not a DayZ workshop item',
        workshopInfo
      });
    }

    const downloadId = `download_${Date.now()}_${++downloadCounter}`;
    const downloadPath = path.join(process.env.DOWNLOAD_PATH || '/tmp/dayz-workshop-downloads', downloadId);
    const zipPath = path.join(downloadPath, `${workshopId}.zip`);

    cleanupQueue.add(downloadPath);

    const downloadData = {
      id: downloadId,
      workshopId,
      status: 'starting',
      progress: 0,
      startTime: new Date().toISOString(),
      workshopInfo,
      downloadPath,
      zipPath
    };

    activeDownloads.set(downloadId, downloadData);

    // Log download start
    wsLogger.logDownloadStart(downloadId, workshopId, req.clientInfo);

    try {
      await addDownloadToHistory(downloadData, req.clientInfo);
      wsLogger.success('database', `Download added to database: ${downloadId}`);
    } catch (dbError) {
      wsLogger.error('database', 'Error adding download to database', {
        downloadId,
        error: dbError.message
      });
    }

    res.json({ 
      downloadId, 
      workshopId,
      workshopInfo,
      message: 'Download started',
      statusUrl: `/api/status/${downloadId}`,
      maxFileSize: process.env.MAX_DOWNLOAD_SIZE || '10737418240'
    });

    // Start download process asynchronously
    (async () => {
      try {
        const updateProgress = async (progress) => {
          const download = activeDownloads.get(downloadId);
          if (download) {
            const updatedDownload = {
              ...download,
              progress: Math.min(progress, 100)
            };
            activeDownloads.set(downloadId, updatedDownload);
            
            wsLogger.logDownloadProgress(downloadId, workshopId, progress, download.status);
            
            try {
              await updateDownloadInHistory(downloadId, { progress: Math.min(progress, 100) });
            } catch (dbError) {
              wsLogger.error('database', 'Error updating progress', {
                downloadId,
                error: dbError.message
              });
            }
          }
        };

        const updateStatus = async (status, additionalData = {}) => {
          const download = activeDownloads.get(downloadId);
          if (download) {
            const updatedDownload = {
              ...download,
              status,
              ...additionalData
            };
            activeDownloads.set(downloadId, updatedDownload);
            
            wsLogger.info('download', `Status update: ${workshopId} - ${status}`, {
              downloadId,
              status,
              ...additionalData
            });
            
            try {
              await updateDownloadInHistory(downloadId, { status, ...additionalData });
            } catch (dbError) {
              wsLogger.error('database', 'Error updating status', {
                downloadId,
                error: dbError.message
              });
            }
          }
        };

        await updateStatus('preparing', { progress: 5 });

        await ensureDirectoryExists(downloadPath);

        await updateStatus('downloading', { progress: 10 });

        wsLogger.info('download', `Starting SteamCMD download for workshop ID: ${workshopId}`);
        const downloadResult = await downloadWorkshopItem(workshopId, downloadPath, updateProgress);
        
        if (!downloadResult.success) {
          throw new Error('SteamCMD download failed');
        }

        // Verify downloaded content
        const expectedPath = path.join(downloadPath, 'steamapps', 'workshop', 'content', process.env.DAYZ_APP_ID || '221100', workshopId);
        
        if (!fs.existsSync(expectedPath)) {
          wsLogger.error('download', `Workshop content not found at expected path: ${expectedPath}`);
          
          const searchPaths = [
            path.join(downloadPath, 'steamapps'),
            path.join(downloadPath, 'workshop'),
            downloadPath
          ];
          
          let foundAnyContent = false;
          for (const searchPath of searchPaths) {
            if (fs.existsSync(searchPath)) {
              const items = fs.readdirSync(searchPath, { recursive: true });
              if (items.length > 0) {
                foundAnyContent = true;
                break;
              }
            }
          }
          
          if (!foundAnyContent) {
            throw new Error('No workshop content was downloaded');
          }
        }

        await updateStatus('creating_archive', { progress: 65 });

        wsLogger.info('archive', `Creating ZIP archive: ${zipPath}`);
        const archivePath = await createZipArchive(downloadPath, zipPath, workshopId, updateProgress);
        
        if (!fs.existsSync(archivePath)) {
          throw new Error('ZIP file was not created');
        }
        
        const zipStats = fs.statSync(archivePath);
        
        const originalContentPath = path.join(downloadPath, 'steamapps', 'workshop', 'content', process.env.DAYZ_APP_ID || '221100', workshopId);
        let originalSize = 0;

        if (fs.existsSync(originalContentPath)) {
          try {
            const calculateDirSize = (dirPath) => {
              let size = 0;
              const files = fs.readdirSync(dirPath);
              for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                if (stats.isDirectory()) {
                  size += calculateDirSize(filePath);
                } else {
                  size += stats.size;
                }
              }
              return size;
            };
            
            originalSize = calculateDirSize(originalContentPath);
          } catch (err) {
            wsLogger.warning('archive', 'Could not calculate original content size', {
              error: err.message
            });
          }
        }

        const minZipSize = 512;
        const compressionRatio = originalSize > 0 ? (zipStats.size / originalSize) : 1;

        if (zipStats.size < minZipSize) {
          throw new Error(`ZIP file too small (${zipStats.size} bytes) - likely empty or corrupted`);
        }

        if (originalSize > 10000 && compressionRatio < 0.01) {
          wsLogger.warning('archive', `Unusual compression ratio: ${(compressionRatio * 100).toFixed(2)}% - but allowing download`);
        }

        const downloadUrl = generateDownloadUrl(downloadId, workshopId);

        await updateStatus('completed', {
          progress: 100,
          zipPath,
          downloadUrl,
          fileSize: zipStats.size,
          completedTime: new Date().toISOString(),
          method: downloadResult.method
        });

        wsLogger.logDownloadComplete(downloadId, workshopId, zipStats.size, downloadResult.method);

      } catch (error) {
        wsLogger.logDownloadError(downloadId, workshopId, error);
        
        const downloadData = activeDownloads.get(downloadId);
        if (downloadData?.downloadPath) {
          await cleanupFiles([downloadData.downloadPath], true);
        }
        
        const errorData = {
          status: 'error',
          error: error.message,
          errorTime: new Date().toISOString()
        };
        
        const download = activeDownloads.get(downloadId);
        if (download) {
          activeDownloads.set(downloadId, { ...download, ...errorData });
        }
        
        try {
          await updateDownloadInHistory(downloadId, errorData);
        } catch (dbError) {
          wsLogger.error('database', 'Error updating error status', {
            downloadId,
            error: dbError.message
          });
        }
      }
    })();

  } catch (error) {
    wsLogger.error('api', 'Download API error', { error: error.message });
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// Get download URL
app.get('/api/download/:downloadId/url', async (req, res) => {
  try {
    const { downloadId } = req.params;
    const download = activeDownloads.get(downloadId);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (download.status !== 'completed') {
      return res.status(400).json({ error: 'Download not completed yet' });
    }

    const downloadUrl = generateDownloadUrl(downloadId, download.workshopId);
    
    res.json({
      downloadId,
      workshopId: download.workshopId,
      downloadUrl,
      fileSize: download.fileSize,
      status: download.status
    });

  } catch (error) {
    wsLogger.error('api', 'Download URL error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/download/:downloadId/file', async (req, res) => {
  try {
    const { downloadId } = req.params;
    const download = activeDownloads.get(downloadId);

    if (!download) {
      return res.status(404).json({ error: 'Download not found' });
    }

    if (download.status !== 'completed') {
      return res.status(400).json({ error: 'Download not completed yet' });
    }

    const zipPath = download.zipPath;
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const fileName = `${download.workshopInfo?.title || download.workshopId}.zip`;
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.\-_\s]/g, '').replace(/\s+/g, '_');
    
    const stats = fs.statSync(zipPath);
    
    wsLogger.info('download', `File download started`, {
      downloadId,
      workshopId: download.workshopId,
      fileName: cleanFileName,
      fileSize: stats.size,
      clientIP: req.clientInfo?.ip
    });
    
    res.setHeader('Content-Disposition', `attachment; filename="${cleanFileName}"`);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Last-Modified', stats.mtime.toUTCString());
    res.setHeader('ETag', `"${stats.size}-${stats.mtime.getTime()}"`);
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=300, max=1000');

    let downloaded = 0;

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      const chunksize = (end - start) + 1;
      
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.setHeader('Content-Length', chunksize);
      
      const stream = fs.createReadStream(zipPath, { start, end });
      
      stream.on('error', (error) => {
        wsLogger.error('download', 'Stream error', {
          downloadId,
          error: error.message
        });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });

      stream.on('data', (chunk) => {
        downloaded += chunk.length;
      });
      
      stream.pipe(res);
      
    } else {
      const fileStream = fs.createReadStream(zipPath, {
        highWaterMark: 64 * 1024
      });
      
      fileStream.on('error', (error) => {
        wsLogger.error('download', 'File stream error', {
          downloadId,
          error: error.message
        });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming file' });
        }
      });
      
      fileStream.on('data', (chunk) => {
        downloaded += chunk.length;
        if (stats.size > 100 * 1024 * 1024) {
          const progress = ((downloaded / stats.size) * 100).toFixed(1);
          if (downloaded % (10 * 1024 * 1024) < chunk.length) {
            wsLogger.debug('download', `Download progress: ${progress}%`, {
              downloadId,
              downloaded,
              total: stats.size
            });
          }
        }
      });
      
      fileStream.pipe(res);
    }

    req.on('close', () => {
      wsLogger.warning('download', `Client disconnected during download`, {
        downloadId
      });
    });

    if (!range) {
      res.on('finish', async () => {
        wsLogger.success('download', `File download completed`, {
          downloadId,
          workshopId: download.workshopId,
          totalBytes: downloaded
        });
        
        try {
          await updateDownloadInHistory(downloadId, { 
            downloadCompletedTime: new Date().toISOString(),
            finalDownloadSize: downloaded
          });
        } catch (dbError) {
          wsLogger.error('database', 'Error updating download completion', {
            downloadId,
            error: dbError.message
          });
        }
        
        const downloadPath = path.dirname(zipPath);
        await cleanupFiles([downloadPath]);
        
        activeDownloads.delete(downloadId);
        wsLogger.info('cleanup', `Cleaned up download: ${downloadId}`);
      });
    }

  } catch (error) {
    wsLogger.error('api', 'Download file error', { error: error.message });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Manual cleanup endpoint
app.delete('/api/cleanup/:downloadId', async (req, res) => {
  try {
    const { downloadId } = req.params;
    const download = activeDownloads.get(downloadId);

    if (download && download.downloadPath) {
      await cleanupFiles([download.downloadPath], true);
      activeDownloads.delete(downloadId);
      
      wsLogger.info('cleanup', `Manual cleanup completed for download: ${downloadId}`);
      
      try {
        await updateDownloadInHistory(downloadId, { 
          cleanedUpTime: new Date().toISOString(),
          status: 'cleaned'
        });
      } catch (dbError) {
        wsLogger.error('database', 'Error updating cleanup status', {
          downloadId,
          error: dbError.message
        });
      }
      
      res.json({ message: 'Cleanup completed', downloadId });
    } else {
      res.status(404).json({ error: 'Download not found' });
    }

  } catch (error) {
    wsLogger.error('api', 'Cleanup error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced debug endpoint
app.get('/api/debug', (req, res) => {
  const logStats = wsLogger.getStats();
  
  res.json({ 
    activeDownloads: Array.from(activeDownloads.entries()),
    downloadCounter,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3,
    downloadPath: process.env.DOWNLOAD_PATH,
    steamcmdPath: process.env.STEAMCMD_PATH,
    maxDownloadSize: process.env.MAX_DOWNLOAD_SIZE,
    cleanupQueue: Array.from(cleanupQueue),
    memoryUsage: process.memoryUsage(),
    uptime: process.uptime(),
    adminRoutesEnabled: true,
    databaseConnected: dbInitialized,
    clientInfoEnhanced: true,
    logsEnabled: true,
    logStats,
    database: {
      host: process.env.DB_HOST,
      name: process.env.DB_NAME,
      user: process.env.DB_USERNAME
    }
  });
});

// Clear all downloads
app.post('/api/clear', async (req, res) => {
  try {
    const cleared = activeDownloads.size;
    
    wsLogger.info('admin', `Clearing all ${cleared} active downloads`);
    
    for (const [downloadId, download] of activeDownloads.entries()) {
      if (download.downloadPath) {
        await cleanupFiles([download.downloadPath], true);
      }
      
      try {
        await updateDownloadInHistory(downloadId, { 
          cleanedUpTime: new Date().toISOString(),
          status: 'cleaned',
          reason: 'manual_clear'
        });
      } catch (dbError) {
        wsLogger.error('database', 'Error updating clear status', {
          downloadId,
          error: dbError.message
        });
      }
    }
    
    activeDownloads.clear();
    cleanupQueue.clear();
    downloadCounter = 0;
    
    wsLogger.success('admin', `All downloads cleared and cleaned up`, { clearedCount: cleared });
    
    res.json({ 
      message: 'All downloads cleared and cleaned up',
      clearedCount: cleared
    });
  } catch (error) {
    wsLogger.error('api', 'Clear error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cleanup old downloads periodically
setInterval(async () => {
  const now = Date.now();
  const maxAge = 7200000; // 2 hours

  if (activeDownloads.size > 0) {
    wsLogger.debug('cleanup', `Running periodic cleanup. Active downloads: ${activeDownloads.size}`);

    for (const [downloadId, download] of activeDownloads.entries()) {
      const startTime = new Date(download.startTime).getTime();
      if (now - startTime > maxAge) {
        wsLogger.info('cleanup', `Cleaning up old download: ${downloadId}`);
        
        if (download.downloadPath) {
          await cleanupFiles([download.downloadPath], true);
        }
        
        try {
          await updateDownloadInHistory(downloadId, { 
            autoCleanedTime: new Date().toISOString(),
            reason: 'timeout'
          });
        } catch (dbError) {
          wsLogger.error('database', 'Error updating auto cleanup', {
            downloadId,
            error: dbError.message
          });
        }
        
        activeDownloads.delete(downloadId);
      }
    }
  }
}, 600000); // Check every 10 minutes

// Cleanup orphaned files on startup
(async () => {
  try {
    const downloadDir = process.env.DOWNLOAD_PATH || '/tmp/dayz-workshop-downloads';
    if (fs.existsSync(downloadDir)) {
      const items = fs.readdirSync(downloadDir);
      wsLogger.info('cleanup', `Found ${items.length} items in download directory on startup`);
      
      for (const item of items) {
        const itemPath = path.join(downloadDir, item);
        try {
          await fs.remove(itemPath);
          wsLogger.debug('cleanup', `Cleaned up orphaned item: ${item}`);
        } catch (error) {
          wsLogger.error('cleanup', `Error cleaning up ${item}`, {
            error: error.message
          });
        }
      }
    }
  } catch (error) {
    wsLogger.error('cleanup', 'Startup cleanup error', {
      error: error.message
    });
  }
})();

// Enhanced error handling middleware
app.use((error, req, res, next) => {
  wsLogger.error('express', 'Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({ 
    error: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  wsLogger.info('system', `${signal} received, cleaning up...`);
  
  // Cleanup all active downloads
  for (const [downloadId, download] of activeDownloads.entries()) {
    if (download.downloadPath) {
      try {
        await cleanupFiles([download.downloadPath], true);
        
        await updateDownloadInHistory(downloadId, { 
          cleanedUpTime: new Date().toISOString(),
          reason: 'server_shutdown'
        });
      } catch (error) {
        wsLogger.error('cleanup', `Error cleaning up ${downloadId}`, {
          error: error.message
        });
      }
    }
  }
  
  // Shutdown WebSocket logger
  wsLogger.shutdown();
  
  // Close server
  server.close(() => {
    wsLogger.info('system', '✅ Server closed gracefully');
    process.exit(0);
  });
  
  // Force exit after 30 seconds
  setTimeout(() => {
    wsLogger.error('system', '⚠️ Force exit after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server with database initialization
startServer();

module.exports = app;