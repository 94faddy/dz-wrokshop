// websocketLogger.js - Real-time logging system with WebSocket support

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

class WebSocketLogger {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.logHistory = [];
    this.maxHistorySize = 1000;
    this.JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
  }

  // Initialize WebSocket server
  initialize(server) {
    console.log('🔌 Initializing WebSocket server for real-time logs...');
    
    this.wss = new WebSocket.Server({
      server,
      path: '/ws/logs',
      verifyClient: (info) => {
        // Extract token from query string
        const url = new URL(info.req.url, 'http://localhost');
        const token = url.searchParams.get('token');
        
        if (!token) {
          console.log('❌ WebSocket connection rejected: No token provided');
          return false;
        }

        try {
          // Verify admin session token
          const decoded = this.verifySessionToken(token);
          if (decoded) {
            info.req.adminUser = decoded;
            console.log('✅ WebSocket connection authorized for admin user');
            return true;
          }
        } catch (error) {
          console.error('❌ WebSocket token verification failed:', error.message);
        }

        return false;
      }
    });

    this.wss.on('connection', (ws, req) => {
      console.log('🔗 New WebSocket connection established');
      
      this.clients.add(ws);
      
      // Send recent log history to new client
      if (this.logHistory.length > 0) {
        const recentLogs = this.logHistory.slice(-50); // Send last 50 logs
        ws.send(JSON.stringify({
          type: 'history',
          logs: recentLogs
        }));
      }

      // Send welcome message
      this.sendToClient(ws, 'info', 'backend', 'WebSocket connection established', {
        connectionTime: new Date().toISOString(),
        clientCount: this.clients.size
      });

      ws.on('close', () => {
        console.log('🔌 WebSocket connection closed');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(ws);
      });

      // Handle ping/pong for connection health
      ws.on('ping', () => {
        ws.pong();
      });

      // Send periodic heartbeat
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);
    });

    console.log('✅ WebSocket server initialized successfully');
  }

  // Verify session token (similar to admin middleware)
  verifySessionToken(token) {
    try {
      // Try JWT verification first
      const decoded = jwt.verify(token, this.JWT_SECRET);
      if (decoded) {
        return decoded;
      }
    } catch (jwtError) {
      // If JWT fails, check if it's a session token format
      if (token.startsWith('admin_session')) {
        // For session tokens, we'll accept them if they're in the correct format
        // In production, you should validate against the database
        return { username: 'admin', role: 'admin', sessionToken: token };
      }
    }
    
    throw new Error('Invalid token');
  }

  // Log message and broadcast to all connected clients
  log(level, source, message, data = null) {
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data
    };

    // Add to history
    this.logHistory.push(logEntry);
    
    // Maintain history size limit
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory = this.logHistory.slice(-this.maxHistorySize);
    }

    // Broadcast to all connected clients
    this.broadcast(logEntry);

    // Also log to console for server logs
    const levelColors = {
      error: '\x1b[31m',   // Red
      warning: '\x1b[33m', // Yellow
      info: '\x1b[34m',    // Blue
      success: '\x1b[32m', // Green
      debug: '\x1b[90m'    // Gray
    };
    
    const resetColor = '\x1b[0m';
    const color = levelColors[level] || '';
    
    console.log(
      `${color}[${logEntry.timestamp}] [${level.toUpperCase()}] [${source}]${resetColor} ${message}`,
      data ? JSON.stringify(data, null, 2) : ''
    );
  }

  // Send message to specific client
  sendToClient(ws, level, source, message, data = null) {
    if (ws.readyState === WebSocket.OPEN) {
      const logEntry = {
        id: Date.now() + Math.random(),
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        data
      };

      try {
        ws.send(JSON.stringify(logEntry));
      } catch (error) {
        console.error('Error sending message to WebSocket client:', error);
      }
    }
  }

  // Broadcast to all connected clients
  broadcast(logEntry) {
    if (this.clients.size === 0) return;

    const message = JSON.stringify(logEntry);
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting to WebSocket client:', error);
          this.clients.delete(client);
        }
      } else {
        this.clients.delete(client);
      }
    });
  }

  // Convenience methods for different log levels
  info(source, message, data) {
    this.log('info', source, message, data);
  }

  warning(source, message, data) {
    this.log('warning', source, message, data);
  }

  error(source, message, data) {
    this.log('error', source, message, data);
  }

  success(source, message, data) {
    this.log('success', source, message, data);
  }

  debug(source, message, data) {
    this.log('debug', source, message, data);
  }

  // Download-specific logging methods
  logDownloadStart(downloadId, workshopId, clientInfo) {
    this.info('backend', `🚀 Download started: ${workshopId}`, {
      downloadId,
      workshopId,
      clientIP: clientInfo?.ip,
      country: clientInfo?.country,
      browser: clientInfo?.browser
    });
  }

  logDownloadProgress(downloadId, workshopId, progress, status) {
    this.info('backend', `📊 Download progress: ${workshopId} - ${progress}%`, {
      downloadId,
      workshopId,
      progress,
      status
    });
  }

  logDownloadComplete(downloadId, workshopId, fileSize, method) {
    this.success('backend', `✅ Download completed: ${workshopId}`, {
      downloadId,
      workshopId,
      fileSize,
      method,
      fileSizeFormatted: this.formatFileSize(fileSize)
    });
  }

  logDownloadError(downloadId, workshopId, error) {
    this.error('backend', `❌ Download failed: ${workshopId}`, {
      downloadId,
      workshopId,
      error: error.message || error,
      stack: error.stack
    });
  }

  logSteamCMDOutput(downloadId, output) {
    // Parse SteamCMD output for relevant information
    if (output.includes('downloading')) {
      this.info('steamcmd', `📥 SteamCMD downloading...`, { downloadId, output: output.trim() });
    } else if (output.includes('ERROR')) {
      this.error('steamcmd', `❌ SteamCMD error`, { downloadId, output: output.trim() });
    } else if (output.includes('success') || output.includes('completed')) {
      this.success('steamcmd', `✅ SteamCMD operation completed`, { downloadId, output: output.trim() });
    } else if (output.trim()) {
      this.debug('steamcmd', output.trim(), { downloadId });
    }
  }

  logClientInfo(clientInfo, context = 'request') {
    this.info('backend', `🌍 Client info detected`, {
      context,
      ip: clientInfo?.ip,
      country: clientInfo?.country,
      city: clientInfo?.city,
      browser: clientInfo?.browser,
      os: clientInfo?.os,
      method: clientInfo?.ipDetectionMethod
    });
  }

  logAdminAction(username, action, data = null) {
    this.info('admin', `👨‍💼 Admin action: ${action}`, {
      username,
      action,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  logSystemEvent(event, data = null) {
    this.info('system', `⚙️ System event: ${event}`, {
      event,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  // Utility methods
  formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  // Get connection statistics
  getStats() {
    return {
      connectedClients: this.clients.size,
      totalLogs: this.logHistory.length,
      maxHistorySize: this.maxHistorySize,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  // Clear log history
  clearHistory() {
    const clearedCount = this.logHistory.length;
    this.logHistory = [];
    this.info('system', `🧹 Log history cleared`, { clearedCount });
    return clearedCount;
  }

  // Export logs to file
  exportLogs(filterLevel = null) {
    let logs = this.logHistory;
    
    if (filterLevel) {
      logs = logs.filter(log => log.level === filterLevel);
    }

    return logs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${
        log.data ? ' | Data: ' + JSON.stringify(log.data) : ''
      }`
    ).join('\n');
  }

  // Shutdown cleanup
  shutdown() {
    console.log('🔌 Shutting down WebSocket logger...');
    
    if (this.wss) {
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1000, 'Server shutting down');
        }
      });
      
      this.wss.close(() => {
        console.log('✅ WebSocket server closed');
      });
    }
    
    this.clients.clear();
  }
}

// Create singleton instance
const wsLogger = new WebSocketLogger();

module.exports = wsLogger;