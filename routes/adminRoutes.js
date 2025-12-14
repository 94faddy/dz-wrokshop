const express = require('express');
const geoip = require('geoip-lite');
const useragent = require('useragent');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const router = express.Router();

// Import models
const {
  sequelize,
  DownloadHistory,
  UserSession,
  AdminSession,
  LoginAttempt,
  SystemStats
} = require('../models');

// Admin credentials from environment variables
const ADMIN_CREDENTIALS = {
  username: process.env.ADMIN_USERNAME || 'admin',
  passwordHash: process.env.ADMIN_PASSWORD_HASH || '$2a$13$defaulthash'
};

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 86400000; // 24 hours

// Rate limiting configuration
const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_TIME = parseInt(process.env.LOCKOUT_TIME) || 900000; // 15 minutes

// Generate JWT token
const generateToken = (username) => {
  const payload = {
    username,
    role: 'admin',
    iat: Date.now()
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Enhanced admin authentication middleware
const verifyAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.replace('Bearer ', '');
    
    console.log('🔐 Verifying admin token:', token?.substring(0, 20) + '...');
    
    // Check for session token from admin dashboard
    if (!token || token === 'admin_session') {
      // ถ้าเป็น token เก่า ให้หา session ที่ active
      const session = await AdminSession.findOne({
        where: {
          sessionId: {
            [Op.like]: 'admin_session%' // หา session ที่ขึ้นต้นด้วย admin_session
          },
          isActive: true,
          expiresAt: { [Op.gt]: new Date() }
        },
        order: [['loginTime', 'DESC']] // เอา session ล่าสุด
      });
      
      if (session) {
        console.log(`✅ Found active session: ${session.sessionId}`);
        req.admin = { username: session.username, role: 'admin' };
        return next();
      }
      
      console.log('❌ No active session found');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // ถ้ามี token ที่ไม่ใช่ admin_session ให้หา session ตาม token นั้น
    const session = await AdminSession.findOne({
      where: {
        sessionId: token,
        isActive: true,
        expiresAt: { [Op.gt]: new Date() }
      }
    });
    
    if (session) {
      console.log(`✅ Session verified: ${session.sessionId}`);
      req.admin = { username: session.username, role: 'admin' };
      return next();
    }
    
    // Verify JWT token as fallback
    const decoded = verifyToken(token);
    if (!decoded) {
      console.log('❌ Invalid token');
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    console.log('✅ JWT token verified');
    req.admin = decoded;
    next();
    
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Rate limiting for login attempts
const checkRateLimit = async (clientIp) => {
  try {
    const attempt = await LoginAttempt.findOne({
      where: { clientIp }
    });
    
    if (!attempt) return true;
    
    // Reset attempts if lockout time has passed
    if (Date.now() - attempt.lastAttempt.getTime() > LOCKOUT_TIME) {
      await attempt.update({
        attemptCount: 0,
        isLocked: false,
        lockedUntil: null
      });
      return true;
    }
    
    return attempt.attemptCount < MAX_LOGIN_ATTEMPTS;
    
  } catch (error) {
    console.error('Rate limit check error:', error);
    return true; // Allow on error
  }
};

// Record failed login attempt
const recordFailedAttempt = async (clientIp) => {
  try {
    const [attempt, created] = await LoginAttempt.findOrCreate({
      where: { clientIp },
      defaults: {
        clientIp,
        attemptCount: 1,
        lastAttempt: new Date(),
        isLocked: false
      }
    });
    
    if (!created) {
      const newCount = attempt.attemptCount + 1;
      const isLocked = newCount >= MAX_LOGIN_ATTEMPTS;
      
      await attempt.update({
        attemptCount: newCount,
        lastAttempt: new Date(),
        isLocked,
        lockedUntil: isLocked ? new Date(Date.now() + LOCKOUT_TIME) : null
      });
    }
    
    console.warn(`Failed admin login attempt from ${clientIp}. Attempts: ${attempt.attemptCount}/${MAX_LOGIN_ATTEMPTS}`);
    
  } catch (error) {
    console.error('Record failed attempt error:', error);
  }
};

// Clear login attempts on successful login
const clearLoginAttempts = async (clientIp) => {
  try {
    await LoginAttempt.destroy({
      where: { clientIp }
    });
  } catch (error) {
    console.error('Clear login attempts error:', error);
  }
};

// Enhanced middleware to capture client information
const captureClientInfo = (req, res, next) => {
  // Enhanced IP detection สำหรับ Production และ Cloudflare
  const getClientIP = () => {
    // ลำดับความสำคัญใหม่สำหรับ Production Environment
    const ipSources = [
      req.headers['cf-connecting-ip'],     // Cloudflare Real IP (สำคัญที่สุดใน Production)
      req.headers['x-forwarded-for'],     // Standard proxy header
      req.headers['x-real-ip'],           // Nginx proxy
      req.headers['x-client-ip'],         // Apache
      req.headers['true-client-ip'],      // Cloudflare Enterprise
      req.headers['x-cluster-client-ip'], // Cluster
      req.headers['forwarded'],           // RFC 7239
      req.connection?.remoteAddress,      // Direct connection
      req.socket?.remoteAddress,          // Socket
      req.ip                              // Express default
    ];

    console.log('🔍 === Enhanced IP Detection Debug ===');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('All Headers:', {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-client-ip': req.headers['x-client-ip'],
      'forwarded': req.headers['forwarded'],
      'user-agent': req.headers['user-agent']?.substring(0, 50) + '...',
      'host': req.headers['host']
    });
    console.log('Connection Info:', {
      'connection': req.connection?.remoteAddress,
      'socket': req.socket?.remoteAddress,
      'express-ip': req.ip
    });

    let detectedIP = null;
    let detectionMethod = 'fallback';

    for (let i = 0; i < ipSources.length; i++) {
      const source = ipSources[i];
      if (source) {
        // Handle comma-separated IPs (first one is usually the real client)
        let ip = source.split(',')[0].trim();
        
        // Clean IPv6 mapped IPv4
        ip = ip.replace(/^::ffff:/, '');
        
        // Remove port if exists
        ip = ip.split(':')[0];
        
        console.log(`Testing IP source ${i}: ${ip} from header: ${source}`);
        
        // Validate IP format และไม่เป็น Cloudflare/Proxy IP
        if (isValidIP(ip) && !isInternalIP(ip)) {
          detectedIP = ip;
          detectionMethod = getDetectionMethodName(i);
          console.log(`✅ Selected Real Client IP: ${ip} via ${detectionMethod}`);
          break;
        } else {
          console.log(`❌ Rejected IP: ${ip} (invalid format or internal IP)`);
        }
      }
    }

    // Fallback strategies
    if (!detectedIP) {
      console.log('⚠️ No valid client IP found, trying fallback strategies...');
      
      // Try parsing Forwarded header (RFC 7239)
      const forwardedHeader = req.headers['forwarded'];
      if (forwardedHeader) {
        const forMatch = forwardedHeader.match(/for=([^;,\s]+)/i);
        if (forMatch) {
          let forIP = forMatch[1].replace(/["\[\]]/g, '');
          forIP = forIP.replace(/^::ffff:/, '');
          if (isValidIP(forIP) && !isInternalIP(forIP)) {
            detectedIP = forIP;
            detectionMethod = 'forwarded-header';
            console.log(`✅ Found IP via Forwarded header: ${forIP}`);
          }
        }
      }
      
      // Last resort - use a public IP for development/testing
      if (!detectedIP) {
        if (process.env.NODE_ENV === 'development') {
          detectedIP = '203.154.83.15'; // Thailand IP for development
          detectionMethod = 'development-fallback';
        } else {
          detectedIP = '8.8.8.8'; // Google DNS as last resort
          detectionMethod = 'production-fallback';
        }
        console.log(`🆘 Using fallback IP: ${detectedIP} (${detectionMethod})`);
      }
    }

    return { ip: detectedIP, method: detectionMethod };
  };

  // Get detection method name
  const getDetectionMethodName = (index) => {
    const methods = [
      'cloudflare-connecting-ip',
      'x-forwarded-for',
      'x-real-ip',
      'x-client-ip',
      'true-client-ip',
      'x-cluster-client-ip',
      'forwarded',
      'connection-remote',
      'socket-remote',
      'express-ip'
    ];
    return methods[index] || 'unknown-header';
  };

  // Enhanced IP validation function
  const isValidIP = (ip) => {
    if (!ip || ip === 'unknown' || ip === 'undefined' || ip === 'null') return false;
    
    // IPv4 validation
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (ipv4Regex.test(ip)) return true;
    
    // IPv6 validation (basic)
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$/;
    if (ipv6Regex.test(ip)) return true;
    
    return false;
  };

  // Check if IP is internal/private/cloudflare
  const isInternalIP = (ip) => {
    const internalRanges = [
      /^127\./,          // Loopback
      /^192\.168\./,     // Private Class C
      /^10\./,           // Private Class A
      /^172\.1[6-9]\./,  // Private Class B
      /^172\.2[0-9]\./,  // Private Class B
      /^172\.3[0-1]\./,  // Private Class B
      /^::1$/,           // IPv6 loopback
      /^fc00:/,          // IPv6 private
      /^fe80:/,          // IPv6 link-local
      /^169\.254\./,     // Link-local
      /^0\.0\.0\.0$/,    // Null route
      // Cloudflare IP ranges
      /^173\.245\./,
      /^103\.21\./,
      /^103\.22\./,
      /^103\.31\./,
      /^141\.101\./,
      /^108\.162\./,
      /^190\.93\./,
      /^188\.114\./,
      /^197\.234\./,
      /^198\.41\./,
      /^162\.158\./,
      /^104\.1[6-9]\./,
      /^104\.2[0-8]\./
    ];
    
    return internalRanges.some(range => range.test(ip));
  };

  // Get client IP with detection info
  const ipResult = getClientIP();
  const clientIp = ipResult.ip;

  // Enhanced geo-location lookup with fallback
  let geo = null;
  let geoMethod = 'none';
  
  try {
    // Primary geo lookup
    geo = geoip.lookup(clientIp);
    if (geo) {
      geoMethod = 'geoip-lite';
    }
  } catch (error) {
    console.error('Primary geo lookup error:', error);
  }

  // Fallback geo data if primary fails
  if (!geo && !isInternalIP(clientIp)) {

    geo = {
      country: 'Unknown',
      region: 'Unknown',
      city: 'Unknown',
      ll: [0, 0],
      timezone: 'UTC'
    };
    geoMethod = 'fallback';
  }

  // Enhanced User-Agent parsing
  const userAgentString = req.headers['user-agent'] || 'Unknown User Agent';
  const agent = useragent.parse(userAgentString);

  // Parse browser info with better detection
  const getBrowserInfo = (ua) => {
    if (!ua || ua === 'Unknown User Agent') return 'Unknown Browser';
    
    const ua_lower = ua.toLowerCase();
    
    // More specific browser detection
    if (ua_lower.includes('edg/')) return `Edge ${agent.major || ''}`.trim();
    if (ua_lower.includes('chrome/') && !ua_lower.includes('edg')) return `Chrome ${agent.major || ''}`.trim();
    if (ua_lower.includes('firefox/')) return `Firefox ${agent.major || ''}`.trim();
    if (ua_lower.includes('safari/') && !ua_lower.includes('chrome')) return `Safari ${agent.major || ''}`.trim();
    if (ua_lower.includes('opera/') || ua_lower.includes('opr/')) return `Opera ${agent.major || ''}`.trim();
    
    return `${agent.family || 'Unknown'} ${agent.major || ''}`.trim();
  };

  // Parse OS info with better detection
  const getOSInfo = (ua) => {
    if (!ua || ua === 'Unknown User Agent') return 'Unknown OS';
    
    const ua_lower = ua.toLowerCase();
    
    if (ua_lower.includes('windows nt 10')) return 'Windows 10';
    if (ua_lower.includes('windows nt 6.3')) return 'Windows 8.1';
    if (ua_lower.includes('windows nt 6.1')) return 'Windows 7';
    if (ua_lower.includes('windows')) return `Windows ${agent.os.major || ''}`.trim();
    if (ua_lower.includes('mac os x')) return `macOS ${agent.os.major || ''}`.trim();
    if (ua_lower.includes('macintosh')) return 'macOS';
    if (ua_lower.includes('linux')) return 'Linux';
    if (ua_lower.includes('android')) return `Android ${agent.os.major || ''}`.trim();
    if (ua_lower.includes('iphone') || ua_lower.includes('ipad')) return `iOS ${agent.os.major || ''}`.trim();
    
    return `${agent.os.family || 'Unknown'} ${agent.os.major || ''}`.trim();
  };

  // Get device type
  const getDeviceType = (ua) => {
    if (!ua) return 'Unknown';
    
    const ua_lower = ua.toLowerCase();
    
    if (ua_lower.includes('mobile') || ua_lower.includes('android')) return 'Mobile';
    if (ua_lower.includes('tablet') || ua_lower.includes('ipad')) return 'Tablet';
    return 'Desktop';
  };

  // Get Cloudflare country with validation
  const cloudflareCountry = req.headers['cf-ipcountry'];

  // Build enhanced client info
  req.clientInfo = {
    // IP Information
    ip: clientIp,
    ipDetectionMethod: ipResult.method,
    
    // Geographic info with multiple sources and fallbacks
    country: cloudflareCountry || geo?.country || 'Unknown',
    countryCode: (cloudflareCountry || geo?.country || 'XX').toLowerCase(),
    city: geo?.city || 'Unknown',
    region: geo?.region || 'Unknown',
    timezone: geo?.timezone || 'UTC',
    geoMethod: geoMethod,
    
    // Coordinates with fallback
    latitude: geo?.ll?.[0] || 0,
    longitude: geo?.ll?.[1] || 0,
    
    // User agent info
    userAgent: userAgentString,
    browser: getBrowserInfo(userAgentString),
    os: getOSInfo(userAgentString),
    device: getDeviceType(userAgentString),
    
    // Additional info
    timestamp: new Date().toISOString(),
    referer: req.headers.referer || req.headers.referrer || null,
    acceptLanguage: req.headers['accept-language']?.split(',')[0] || 'en',
    
    // Request info
    method: req.method,
    url: req.url,
    protocol: req.protocol,
    host: req.headers.host,
    
    // Cloudflare specific headers
    cloudflare: {
      country: req.headers['cf-ipcountry'],
      ray: req.headers['cf-ray'],
      visitor: req.headers['cf-visitor'],
      connectingIP: req.headers['cf-connecting-ip'],
      ipcountry: req.headers['cf-ipcountry']
    },
    
    // Debug headers for troubleshooting
    debugHeaders: {
      'cf-connecting-ip': req.headers['cf-connecting-ip'],
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip'],
      'x-client-ip': req.headers['x-client-ip'],
      'forwarded': req.headers['forwarded'],
      'user-agent': userAgentString,
      'host': req.headers.host
    }
  };

  next();
};

// Enhanced function to add download to history
const addToDownloadHistory = async (downloadData, clientInfo) => {
  try {
    console.log('📝 Adding download to history with client info:', {
      downloadId: downloadData.id,
      clientInfo: {
        ip: clientInfo?.ip || 'Unknown',
        country: clientInfo?.country || 'Unknown',
        city: clientInfo?.city || 'Unknown',
        browser: clientInfo?.browser || 'Unknown'
      }
    });

    // Validate and clean client info
    const cleanClientInfo = {
      ip: clientInfo?.ip || 'Unknown',
      ipDetectionMethod: clientInfo?.ipDetectionMethod || 'unknown',
      country: clientInfo?.country || 'Unknown',
      countryCode: clientInfo?.countryCode || 'xx',
      city: clientInfo?.city || 'Unknown',
      region: clientInfo?.region || 'Unknown',
      timezone: clientInfo?.timezone || 'UTC',
      latitude: clientInfo?.latitude || 0,
      longitude: clientInfo?.longitude || 0,
      userAgent: clientInfo?.userAgent || 'Unknown',
      browser: clientInfo?.browser || 'Unknown',
      os: clientInfo?.os || 'Unknown',
      device: clientInfo?.device || 'Unknown',
      referer: clientInfo?.referer || null,
      acceptLanguage: clientInfo?.acceptLanguage || 'en',
      method: clientInfo?.method || 'POST',
      url: clientInfo?.url || '/api/download',
      protocol: clientInfo?.protocol || 'https',
      host: clientInfo?.host || 'unknown',
      timestamp: clientInfo?.timestamp || new Date().toISOString(),
      cloudflare: clientInfo?.cloudflare || {},
      geoMethod: clientInfo?.geoMethod || 'none'
    };

    // Create or update user session with validated data
    const sessionKey = `${cleanClientInfo.ip}_${cleanClientInfo.userAgent}`;
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log('Creating user session with key:', sessionKey);
    
    const [userSession, sessionCreated] = await UserSession.findOrCreate({
      where: { sessionKey },
      defaults: {
        sessionId,
        sessionKey,
        ip: cleanClientInfo.ip,
        country: cleanClientInfo.country,
        countryCode: cleanClientInfo.countryCode,
        city: cleanClientInfo.city,
        region: cleanClientInfo.region,
        timezone: cleanClientInfo.timezone,
        latitude: cleanClientInfo.latitude,
        longitude: cleanClientInfo.longitude,
        userAgent: cleanClientInfo.userAgent,
        browser: cleanClientInfo.browser,
        os: cleanClientInfo.os,
        device: cleanClientInfo.device,
        referer: cleanClientInfo.referer,
        acceptLanguage: cleanClientInfo.acceptLanguage,
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalDownloads: 1,
        completedDownloads: 0,
        failedDownloads: 0,
        totalDataTransferred: 0
      }
    });
    
    if (!sessionCreated) {
      console.log('Updating existing user session');
      await userSession.update({
        lastSeen: new Date(),
        totalDownloads: userSession.totalDownloads + 1,
        // Update other fields if they've changed
        country: cleanClientInfo.country,
        city: cleanClientInfo.city,
        browser: cleanClientInfo.browser,
        os: cleanClientInfo.os
      });
    } else {
      console.log('Created new user session');
    }
    
    // Create download history entry with full client info
    const historyEntry = await DownloadHistory.create({
      id: downloadData.id,
      workshopId: downloadData.workshopId,
      status: downloadData.status,
      progress: downloadData.progress || 0,
      startTime: downloadData.startTime || new Date(),
      workshopInfo: downloadData.workshopInfo || {},
      clientInfo: cleanClientInfo,  // Store complete client info
      sessionId: userSession.sessionId
    });
    
    console.log(`✅ Download history created successfully: ${downloadData.id}`);
    console.log('Stored client info:', {
      ip: cleanClientInfo.ip,
      country: cleanClientInfo.country,
      city: cleanClientInfo.city,
      browser: cleanClientInfo.browser,
      os: cleanClientInfo.os
    });
    
    return historyEntry;
    
  } catch (error) {
    console.error('❌ Error adding to download history:', error);
    console.error('Client info that failed:', clientInfo);
    
    // Create a minimal entry even if clientInfo is problematic
    try {
      const fallbackEntry = await DownloadHistory.create({
        id: downloadData.id,
        workshopId: downloadData.workshopId,
        status: downloadData.status,
        progress: downloadData.progress || 0,
        startTime: downloadData.startTime || new Date(),
        workshopInfo: downloadData.workshopInfo || {},
        clientInfo: {
          ip: 'Unknown',
          country: 'Unknown',
          city: 'Unknown',
          browser: 'Unknown',
          os: 'Unknown',
          device: 'Unknown',
          userAgent: 'Unknown',
          error: 'Failed to parse client info',
          fallback: true,
          timestamp: new Date().toISOString()
        },
        sessionId: null
      });
      
      console.log('✅ Created fallback download history entry');
      return fallbackEntry;
      
    } catch (fallbackError) {
      console.error('❌ Even fallback creation failed:', fallbackError);
      throw fallbackError;
    }
  }
};

// Enhanced function to update download in history
const updateDownloadInHistory = async (downloadId, updates) => {
  try {
    console.log(`📝 Updating download history: ${downloadId}`, updates);
    
    const [updatedCount] = await DownloadHistory.update(updates, {
      where: { id: downloadId }
    });
    
    if (updatedCount > 0) {
      console.log(`✅ Updated ${updatedCount} download record(s)`);
      
      // Update user session stats if download completed or failed
      if (updates.status === 'completed' || updates.status === 'error') {
        try {
          const download = await DownloadHistory.findByPk(downloadId, {
            include: [{
              model: UserSession,
              as: 'userSession'
            }]
          });
          
          if (download && download.userSession) {
            const updateData = {};
            
            if (updates.status === 'completed') {
              updateData.completedDownloads = download.userSession.completedDownloads + 1;
              if (updates.fileSize) {
                updateData.totalDataTransferred = download.userSession.totalDataTransferred + updates.fileSize;
              }
            } else if (updates.status === 'error') {
              updateData.failedDownloads = download.userSession.failedDownloads + 1;
            }
            
            if (Object.keys(updateData).length > 0) {
              await download.userSession.update(updateData);
              console.log('✅ Updated user session stats');
            }
          }
        } catch (sessionError) {
          console.error('⚠️ Error updating session stats:', sessionError);
          // Don't throw, this is not critical
        }
      }
      
      return true;
    } else {
      console.log('⚠️ No records updated for download:', downloadId);
      return false;
    }
    
  } catch (error) {
    console.error('❌ Error updating download history:', error);
    return false;
  }
};

// Calculate system statistics from database
const calculateSystemStats = async () => {
  try {
    const [stats] = await sequelize.query(`
      SELECT 
        COUNT(*) as totalDownloads,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedDownloads,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failedDownloads,
        SUM(CASE WHEN status IN ('downloading', 'preparing', 'creating_archive', 'starting') THEN 1 ELSE 0 END) as activeDownloads,
        SUM(CASE WHEN status = 'completed' AND fileSize IS NOT NULL THEN fileSize ELSE 0 END) as totalDataTransferred
      FROM download_history
    `);
    
    const uniqueUsers = await UserSession.count();
    
    // Top countries
    const [countryStats] = await sequelize.query(`
      SELECT 
        JSON_UNQUOTE(JSON_EXTRACT(clientInfo, '$.country')) as country,
        COUNT(*) as count
      FROM download_history 
      WHERE JSON_EXTRACT(clientInfo, '$.country') IS NOT NULL
      GROUP BY JSON_UNQUOTE(JSON_EXTRACT(clientInfo, '$.country'))
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    // Top workshop items
    const [workshopStats] = await sequelize.query(`
      SELECT 
        workshopId,
        JSON_UNQUOTE(JSON_EXTRACT(workshopInfo, '$.title')) as title,
        COUNT(*) as count
      FROM download_history 
      GROUP BY workshopId
      ORDER BY count DESC 
      LIMIT 10
    `);
    
    const systemStats = stats[0];
    const successRate = systemStats.totalDownloads > 0 
      ? Math.round((systemStats.completedDownloads / systemStats.totalDownloads) * 100) 
      : 0;
    
    // Get active admin sessions count
    const activeSessions = await AdminSession.count({
      where: {
        isActive: true,
        expiresAt: { [Op.gt]: new Date() }
      }
    });
    
    const result = {
      totalDownloads: parseInt(systemStats.totalDownloads),
      completedDownloads: parseInt(systemStats.completedDownloads),
      failedDownloads: parseInt(systemStats.failedDownloads),
      activeDownloads: parseInt(systemStats.activeDownloads),
      uniqueUsers,
      totalDataTransferred: parseInt(systemStats.totalDataTransferred),
      topCountries: countryStats.map(row => ({
        country: row.country || 'Unknown',
        count: parseInt(row.count)
      })),
      topWorkshopItems: workshopStats.map(row => ({
        workshopId: row.workshopId,
        title: row.title || `Workshop ${row.workshopId}`,
        count: parseInt(row.count)
      })),
      successRate,
      activeSessions
    };
    
    // Cache the stats
    await SystemStats.create({
      ...result,
      topCountries: result.topCountries,
      topWorkshopItems: result.topWorkshopItems,
      calculatedAt: new Date()
    });
    
    return result;
    
  } catch (error) {
    console.error('Error calculating system stats:', error);
    
    // Return fallback stats
    return {
      totalDownloads: 0,
      completedDownloads: 0,
      failedDownloads: 0,
      activeDownloads: 0,
      uniqueUsers: 0,
      totalDataTransferred: 0,
      topCountries: [],
      topWorkshopItems: [],
      successRate: 0,
      activeSessions: 0
    };
  }
};

// Calculate user statistics from database
const calculateUserStats = async () => {
  try {
    const userStats = await UserSession.findAll({
      order: [['totalDownloads', 'DESC']],
      limit: 100,
      attributes: [
        'sessionId',
        'ip',
        'country',
        'countryCode',
        'city',
        'browser',
        'os',
        'firstSeen',
        'lastSeen',
        'totalDownloads',
        'completedDownloads',
        'failedDownloads',
        'totalDataTransferred'
      ]
    });
    
    return userStats.map(user => user.toJSON());
    
  } catch (error) {
    console.error('Error calculating user stats:', error);
    return [];
  }
};

// Admin authentication endpoint with bcrypt
router.post('/auth', async (req, res) => {
  try {
    let { username, password } = req.body;
    const clientIp = req.clientInfo?.ip || req.ip || 'unknown';
    
    // Clean username
    if (username) {
      username = username.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    }
    if (password) {
      password = password.trim();
    }
    
    console.log('\n=== Admin Login Debug ===');
    console.log('Username:', username);
    console.log('IP:', clientIp);
    
    if (!username || !password) {
      console.log('❌ Missing credentials');
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    // Check rate limiting
    const canAttempt = await checkRateLimit(clientIp);
    if (!canAttempt) {
      console.log('❌ Rate limited');
      return res.status(429).json({ 
        error: 'Too many login attempts', 
        message: `Account locked. Try again in ${Math.ceil(LOCKOUT_TIME / 1000 / 60)} minutes.`
      });
    }
    
    // Check username
    if (username !== ADMIN_CREDENTIALS.username) {
      console.log('❌ Username mismatch');
      await recordFailedAttempt(clientIp);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check password with bcrypt
    try {
      const isValidPassword = await bcrypt.compare(password, ADMIN_CREDENTIALS.passwordHash);
      
      if (!isValidPassword) {
        console.log('❌ Password mismatch');
        await recordFailedAttempt(clientIp);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
    } catch (bcryptError) {
      console.log('❌ Bcrypt error:', bcryptError.message);
      return res.status(500).json({ error: 'Authentication error' });
    }
    
    // Clear failed attempts on successful login
    await clearLoginAttempts(clientIp);
    
    // Generate JWT token
    const jwtToken = generateToken(username);
    
    // Generate unique session ID with timestamp
    const sessionId = `admin_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT);
    
    console.log(`🔑 Generated session ID: ${sessionId}`);
    
    // Transaction to handle session creation safely
    const transaction = await sequelize.transaction();
    
    try {
      // First, deactivate ALL old sessions for this user
      await AdminSession.update(
        { 
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedReason: 'new_login'
        },
        { 
          where: { 
            username, 
            isActive: true 
          },
          transaction
        }
      );
      
      console.log(`♻️  Deactivated old sessions for user: ${username}`);
      
      // Create new session with unique ID
      const newSession = await AdminSession.create({
        sessionId,
        username,
        expiresAt,
        loginTime: new Date(),
        clientIp,
        userAgent: req.headers['user-agent'] || 'Unknown',
        isActive: true
      }, { transaction });
      
      console.log(`✅ Created new session: ${sessionId}`);
      
      // Commit transaction
      await transaction.commit();
      
      console.log(`✅ Successful admin login: ${username} from ${clientIp}`);
      
      res.json({ 
        success: true, 
        token: sessionId, // ส่ง unique session ID กลับไป
        jwtToken,
        expiresIn: JWT_EXPIRES_IN,
        sessionTimeout: SESSION_TIMEOUT,
        message: 'Authentication successful'
      });
      
    } catch (sessionError) {
      // Rollback transaction on error
      await transaction.rollback();
      console.error('❌ Session creation failed:', sessionError);
      
      // If it's still a duplicate error, try to handle it gracefully
      if (sessionError.code === 'ER_DUP_ENTRY') {
        console.log('🔄 Duplicate session detected, trying alternative approach...');
        
        // Find and update existing session instead
        try {
          const existingSession = await AdminSession.findOne({
            where: { sessionId: 'admin_session' } // หา session เก่า
          });
          
          if (existingSession) {
            await existingSession.update({
              username,
              expiresAt,
              loginTime: new Date(),
              clientIp,
              userAgent: req.headers['user-agent'] || 'Unknown',
              isActive: true
            });
            
            console.log('✅ Updated existing session instead');
            
            res.json({ 
              success: true, 
              token: existingSession.sessionId,
              jwtToken,
              expiresIn: JWT_EXPIRES_IN,
              sessionTimeout: SESSION_TIMEOUT,
              message: 'Authentication successful (session updated)'
            });
          } else {
            throw new Error('Unable to create or update session');
          }
        } catch (fallbackError) {
          console.error('❌ Fallback session creation also failed:', fallbackError);
          return res.status(500).json({ error: 'Session creation failed' });
        }
      } else {
        return res.status(500).json({ error: 'Session creation failed' });
      }
    }
    
  } catch (error) {
    console.error('❌ Admin auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.replace('Bearer ', '');
    
    // Deactivate all sessions for safety
    await AdminSession.update(
      { 
        isActive: false,
        deactivatedAt: new Date(),
        deactivatedReason: 'logout'
      },
      { 
        where: { 
          [Op.or]: [
            { sessionId: token },
            { sessionId: { [Op.like]: 'admin_session%' } }
          ],
          isActive: true 
        } 
      }
    );
    
    console.log('✅ Admin logout completed');
    res.json({ success: true, message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get admin session info
router.get('/session', verifyAdmin, async (req, res) => {
  try {
    // หา session ที่ active ล่าสุด
    const session = await AdminSession.findOne({
      where: {
        sessionId: {
          [Op.like]: 'admin_session%'
        },
        isActive: true,
        expiresAt: { [Op.gt]: new Date() }
      },
      order: [['loginTime', 'DESC']]
    });
    
    if (session) {
      const timeLeft = session.expiresAt.getTime() - Date.now();
      res.json({
        sessionId: session.sessionId,
        username: session.username,
        loginTime: session.loginTime,
        expiresAt: session.expiresAt.toISOString(),
        timeLeft: Math.max(0, Math.floor(timeLeft / 1000)),
        isValid: timeLeft > 0,
        clientIp: session.clientIp
      });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get download history with pagination and filters
router.get('/download-history', verifyAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      status, 
      country, 
      search,
      startDate,
      endDate 
    } = req.query;
    
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const whereClause = {};
    
    // Filter by status
    if (status && status !== 'all') {
      whereClause.status = status;
    }
    
    // Filter by date range
    if (startDate || endDate) {
      whereClause.startTime = {};
      if (startDate) {
        whereClause.startTime[Op.gte] = new Date(startDate);
      }
      if (endDate) {
        whereClause.startTime[Op.lte] = new Date(endDate);
      }
    }
    
    // Search filter (workshop ID, title, IP)
    if (search) {
      const searchConditions = [
        { workshopId: { [Op.like]: `%${search}%` } },
        { '$workshopInfo.title$': { [Op.like]: `%${search}%` } },
        { '$clientInfo.ip$': { [Op.like]: `%${search}%` } }
      ];
      
      whereClause[Op.or] = searchConditions;
    }
    
    // Filter by country (using JSON extraction)
    if (country && country !== 'all') {
      whereClause[Op.and] = sequelize.where(
        sequelize.fn('JSON_UNQUOTE', 
          sequelize.fn('JSON_EXTRACT', 
            sequelize.col('clientInfo'), 
            '$.country'
          )
        ),
        country
      );
    }
    
    const { rows: downloads, count } = await DownloadHistory.findAndCountAll({
      where: whereClause,
      order: [['startTime', 'DESC']],
      limit: parseInt(limit),
      offset,
      include: [{
        model: UserSession,
        as: 'userSession',
        attributes: ['sessionId', 'totalDownloads', 'completedDownloads']
      }]
    });
    
    res.json({
      downloads: downloads.map(d => d.toJSON()),
      pagination: {
        current: parseInt(page),
        total: Math.ceil(count / parseInt(limit)),
        count,
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    console.error('Download history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get active downloads
router.get('/active-downloads', verifyAdmin, async (req, res) => {
  try {
    const activeDownloads = await DownloadHistory.findAll({
      where: {
        status: {
          [Op.in]: ['downloading', 'preparing', 'creating_archive', 'starting']
        }
      },
      order: [['startTime', 'DESC']],
      include: [{
        model: UserSession,
        as: 'userSession',
        attributes: ['sessionId', 'ip', 'country']
      }]
    });
    
    res.json({
      downloads: activeDownloads.map(d => d.toJSON()),
      count: activeDownloads.length
    });
    
  } catch (error) {
    console.error('Active downloads error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get system and user statistics
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const systemStats = await calculateSystemStats();
    const userStats = await calculateUserStats();
    
    res.json({
      system: systemStats,
      users: userStats
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get download analytics
router.get('/analytics', verifyAdmin, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    let dateFilter = new Date();
    switch (period) {
      case '24h':
        dateFilter.setHours(dateFilter.getHours() - 24);
        break;
      case '7d':
        dateFilter.setDate(dateFilter.getDate() - 7);
        break;
      case '30d':
        dateFilter.setDate(dateFilter.getDate() - 30);
        break;
      case '90d':
        dateFilter.setDate(dateFilter.getDate() - 90);
        break;
      default:
        dateFilter.setDate(dateFilter.getDate() - 7);
    }
    
    // Downloads per day
    const [downloadTrends] = await sequelize.query(`
      SELECT 
        DATE(startTime) as date,
        COUNT(*) as downloads,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed
      FROM download_history 
      WHERE startTime >= :dateFilter
      GROUP BY DATE(startTime)
      ORDER BY date ASC
    `, {
      replacements: { dateFilter },
      type: sequelize.QueryTypes.SELECT
    });
    
    // File size distribution
    const [sizeDistribution] = await sequelize.query(`
      SELECT 
        CASE 
          WHEN fileSize < 10485760 THEN 'Under 10MB'
          WHEN fileSize < 104857600 THEN '10MB - 100MB'
          WHEN fileSize < 1073741824 THEN '100MB - 1GB'
          WHEN fileSize < 5368709120 THEN '1GB - 5GB'
          ELSE 'Over 5GB'
        END as sizeRange,
        COUNT(*) as count
      FROM download_history 
      WHERE fileSize IS NOT NULL AND startTime >= :dateFilter
      GROUP BY sizeRange
      ORDER BY count DESC
    `, {
      replacements: { dateFilter },
      type: sequelize.QueryTypes.SELECT
    });
    
    res.json({
      downloadTrends,
      sizeDistribution,
      period
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clean up expired sessions and old data
const cleanupDatabase = async () => {
  try {
    const now = new Date();
    
    // Clean up expired admin sessions
    const expiredSessions = await AdminSession.update(
      { isActive: false },
      { 
        where: { 
          expiresAt: { [Op.lt]: now },
          isActive: true 
        } 
      }
    );
    
    // Clean up old login attempts (older than 24 hours)
    const oldAttempts = await LoginAttempt.destroy({
      where: {
        lastAttempt: { [Op.lt]: new Date(now.getTime() - 86400000) }
      }
    });
    
    // Clean up old system stats (keep only last 30 days)
    const oldStats = await SystemStats.destroy({
      where: {
        calculatedAt: { [Op.lt]: new Date(now.getTime() - 2592000000) }
      }
    });
    
    if (expiredSessions[0] > 0 || oldAttempts > 0 || oldStats > 0) {
      console.log(`🧹 Database cleanup: ${expiredSessions[0]} sessions, ${oldAttempts} attempts, ${oldStats} stats`);
    }
    
  } catch (error) {
    console.error('Database cleanup error:', error);
  }
};

// เพิ่ม Cleanup function สำหรับ expired sessions
const cleanupExpiredSessions = async () => {
  try {
    const now = new Date();
    
    // Deactivate expired sessions
    const expiredCount = await AdminSession.update(
      { 
        isActive: false,
        deactivatedAt: now,
        deactivatedReason: 'expired'
      },
      { 
        where: { 
          [Op.or]: [
            { expiresAt: { [Op.lt]: now } },
            { isActive: true, expiresAt: { [Op.lt]: now } }
          ]
        } 
      }
    );
    
    if (expiredCount[0] > 0) {
      console.log(`🧹 Cleaned up ${expiredCount[0]} expired admin sessions`);
    }
    
    // Delete old sessions (older than 7 days)
    const oldSessionsCount = await AdminSession.destroy({
      where: {
        createdAt: { [Op.lt]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        isActive: false
      }
    });
    
    if (oldSessionsCount > 0) {
      console.log(`🗑️  Deleted ${oldSessionsCount} old admin sessions`);
    }
    
  } catch (error) {
    console.error('Session cleanup error:', error);
  }
};

// Run cleanup every hour
setInterval(cleanupDatabase, 3600000);

// Export functions for use in main server
module.exports = {
  router,
  captureClientInfo,
  addDownloadToHistory: addToDownloadHistory,
  updateDownloadInHistory,
  calculateSystemStats,
  calculateUserStats,
  cleanupDatabase
};