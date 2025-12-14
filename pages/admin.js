import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminData, setAdminData] = useState({
    downloadHistory: [],
    activeDownloads: [],
    systemStats: {},
    userStats: {}
  });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('timestamp');
  const [sortOrder, setSortOrder] = useState('desc');
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [clientInfoTestResult, setClientInfoTestResult] = useState(null);
  const [showClientInfoTest, setShowClientInfoTest] = useState(false);
  
  // Logs state
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logFilter, setLogFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [maxLogEntries, setMaxLogEntries] = useState(500);
  
  const intervalRef = useRef(null);
  const logsContainerRef = useRef(null);
  const wsRef = useRef(null);

  const getApiUrl = () => {
    if (typeof window !== 'undefined') {
      const currentUrl = window.location.origin;
      if (currentUrl.includes('localhost')) {
        return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
      }
      return process.env.NEXT_PUBLIC_API_URL || currentUrl.replace(':3020', ':8080');
    }
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
  };

  // Initialize WebSocket for real-time logs
  const initializeWebSocket = () => {
    try {
      const apiUrl = getApiUrl();
      const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const sessionToken = localStorage.getItem('admin_session');
      
      console.log('🔌 Connecting to WebSocket for logs:', `${wsUrl}/ws/logs`);
      
      wsRef.current = new WebSocket(`${wsUrl}/ws/logs?token=${sessionToken}`);
      
      wsRef.current.onopen = () => {
        console.log('✅ WebSocket connected for logs');
        addLog('info', 'frontend', 'WebSocket connected for real-time logs');
      };
      
      wsRef.current.onmessage = (event) => {
        try {
          const logData = JSON.parse(event.data);
          
          // Validate and normalize log data
          const level = logData.level || 'info';
          const source = logData.source || 'backend';
          const message = logData.message || 'No message';
          const data = logData.data || null;
          
          addLog(level, source, message, data);
        } catch (error) {
          console.error('Error parsing log message:', error);
          addLog('error', 'frontend', 'Failed to parse WebSocket message', { 
            error: error.message,
            rawData: event.data 
          });
        }
      };
      
      wsRef.current.onclose = () => {
        console.log('❌ WebSocket disconnected');
        addLog('warning', 'frontend', 'WebSocket disconnected - attempting to reconnect...');
        
        // Attempt to reconnect after 5 seconds
        setTimeout(() => {
          if (isAuthenticated) {
            initializeWebSocket();
          }
        }, 5000);
      };
      
      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        addLog('error', 'frontend', 'WebSocket connection error');
      };
      
    } catch (error) {
      console.error('Failed to initialize WebSocket:', error);
      addLog('error', 'frontend', 'Failed to initialize WebSocket connection');
    }
  };

  // Add log entry to the logs array
  const addLog = (level = 'info', source = 'unknown', message = '', data = null) => {
    const logEntry = {
      id: Date.now() + Math.random(),
      timestamp: new Date().toISOString(),
      level: level || 'info',
      source: source || 'unknown', 
      message: message || 'No message',
      data
    };
    
    setLogs(prevLogs => {
      const newLogs = [logEntry, ...prevLogs];
      // Keep only the latest maxLogEntries
      return newLogs.slice(0, maxLogEntries);
    });
  };

  // Frontend logging functions
  const logInfo = (message, data = null) => addLog('info', 'frontend', message, data);
  const logWarning = (message, data = null) => addLog('warning', 'frontend', message, data);
  const logError = (message, data = null) => addLog('error', 'frontend', message, data);
  const logSuccess = (message, data = null) => addLog('success', 'frontend', message, data);

  // Auto-scroll logs to bottom
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = 0; // Since we're showing newest first
    }
  }, [logs, autoScroll]);

  // Test client info detection
  const testClientInfo = async () => {
    try {
      const apiUrl = getApiUrl();
      const sessionToken = localStorage.getItem('admin_session');
      
      logInfo('🧪 Testing client info detection...');
      
      const response = await fetch(`${apiUrl}/api/test-production-ip`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        logSuccess('✅ Client info test successful', data);
        setClientInfoTestResult(data);
        setShowClientInfoTest(true);
      } else {
        logError('❌ Client info test failed', { status: response.status });
        if (response.status === 401) {
          handleLogout();
        }
      }
    } catch (error) {
      logError('❌ Error testing client info', { error: error.message });
    }
  };

  // Login function
  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');

    const cleanUsername = username.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const cleanPassword = password.trim();

    if (!cleanUsername || !cleanPassword) {
      setLoginError('Please enter both username and password');
      return;
    }

    logInfo('🔐 Attempting admin login...', { username: cleanUsername });

    try {
      const apiUrl = getApiUrl();
      
      const response = await fetch(`${apiUrl}/api/admin/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: cleanUsername, password: cleanPassword }),
        credentials: 'include'
      });

      const data = await response.json();
      
      if (response.ok && data.success) {
        logSuccess('✅ Login successful', { token: data.token });
        
        setIsAuthenticated(true);
        localStorage.setItem('admin_session', data.token);
        localStorage.setItem('admin_username', cleanUsername);
        localStorage.setItem('admin_session_expires', new Date(Date.now() + data.sessionTimeout).toISOString());
        
        // Initialize WebSocket after successful login
        setTimeout(() => {
          initializeWebSocket();
          fetchAdminData();
        }, 100);
      } else {
        logError('❌ Login failed', data);
        setLoginError(data.error || data.message || 'Login failed');
      }
    } catch (error) {
      logError('❌ Login error', { error: error.message });
      setLoginError('Connection error: Unable to connect to server');
    }
  };

  // Fetch admin data
  const fetchAdminData = async () => {
    setLoading(true);
    logInfo('📊 Fetching admin data...');
    
    try {
      const apiUrl = getApiUrl();
      const sessionToken = localStorage.getItem('admin_session');
      
      const headers = {
        'Authorization': `Bearer ${sessionToken}`,
        'Content-Type': 'application/json'
      };
      
      const [historyRes, activeRes, statsRes] = await Promise.all([
        fetch(`${apiUrl}/api/admin/download-history`, { credentials: 'include', headers }),
        fetch(`${apiUrl}/api/admin/active-downloads`, { credentials: 'include', headers }),
        fetch(`${apiUrl}/api/admin/stats`, { credentials: 'include', headers })
      ]);

      if (historyRes.ok && activeRes.ok && statsRes.ok) {
        const [history, active, stats] = await Promise.all([
          historyRes.json(),
          activeRes.json(),
          statsRes.json()
        ]);

        logSuccess('✅ Admin data loaded successfully', {
          historyCount: history.downloads?.length || 0,
          activeCount: active.downloads?.length || 0
        });
        
        setAdminData({
          downloadHistory: history.downloads || [],
          activeDownloads: active.downloads || [],
          systemStats: stats.system || {},
          userStats: stats.users || {}
        });
      } else {
        logWarning('⚠️ Some API calls failed', {
          history: historyRes.status,
          active: activeRes.status,
          stats: statsRes.status
        });
        
        if (historyRes.status === 401 || activeRes.status === 401 || statsRes.status === 401) {
          logError('❌ Authentication failed, logging out...');
          handleLogout();
        }
      }
    } catch (error) {
      logError('❌ Error fetching admin data', { error: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Auto refresh
  useEffect(() => {
    if (isAuthenticated && refreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        logInfo('🔄 Auto-refreshing admin data...');
        fetchAdminData();
      }, refreshInterval * 1000);
      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    }
  }, [isAuthenticated, refreshInterval]);

  // Check existing session
  useEffect(() => {
    const session = localStorage.getItem('admin_session');
    const sessionExpires = localStorage.getItem('admin_session_expires');
    
    logInfo('🔍 Checking existing session...');
    
    if (session && session !== 'null' && session !== 'undefined') {
      if (sessionExpires) {
        const expiryTime = new Date(sessionExpires);
        const now = new Date();
        
        if (expiryTime > now) {
          logSuccess('✅ Valid session found, auto-login...');
          setIsAuthenticated(true);
          initializeWebSocket();
          fetchAdminData();
        } else {
          logWarning('⏰ Session expired, clearing...');
          handleLogout();
        }
      } else {
        logWarning('🤔 Session without expiry, trying to validate...');
        setIsAuthenticated(true);
        initializeWebSocket();
        fetchAdminData();
      }
    } else {
      logInfo('❌ No valid session found');
    }
  }, []);

  // Logout
  const handleLogout = async () => {
    logInfo('🚪 Logging out...');
    
    try {
      const apiUrl = getApiUrl();
      const sessionToken = localStorage.getItem('admin_session');
      
      if (sessionToken) {
        await fetch(`${apiUrl}/api/admin/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        });
      }
    } catch (error) {
      logError('Logout API error', { error: error.message });
    }
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsAuthenticated(false);
    localStorage.removeItem('admin_session');
    localStorage.removeItem('admin_username');
    localStorage.removeItem('admin_session_expires');
    
    setAdminData({
      downloadHistory: [],
      activeDownloads: [],
      systemStats: {},
      userStats: {}
    });
    
    // Clear logs on logout
    setLogs([]);
    
    logSuccess('✅ Logout completed');
  };

  // Check session validity
  const checkSessionValidity = async () => {
    try {
      const apiUrl = getApiUrl();
      const sessionToken = localStorage.getItem('admin_session');
      
      if (!sessionToken) return false;
      
      const response = await fetch(`${apiUrl}/api/admin/session`, {
        credentials: 'include',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const sessionData = await response.json();
        
        if (sessionData.expiresAt) {
          localStorage.setItem('admin_session_expires', sessionData.expiresAt);
        }
        
        return sessionData.isValid;
      } else {
        logWarning('❌ Session check failed', { status: response.status });
        return false;
      }
    } catch (error) {
      logError('Session check error', { error: error.message });
      return false;
    }
  };

  // Periodic session check
  useEffect(() => {
    if (isAuthenticated) {
      const sessionCheckInterval = setInterval(async () => {
        const isValid = await checkSessionValidity();
        if (!isValid) {
          logWarning('⚠️ Session invalid, logging out...');
          handleLogout();
        }
      }, 5 * 60 * 1000); // 5 minutes
      
      return () => clearInterval(sessionCheckInterval);
    }
  }, [isAuthenticated]);

  // Clear logs
  const clearLogs = () => {
    setLogs([]);
    logInfo('🧹 Logs cleared');
  };

  // Export logs
  const exportLogs = () => {
    const filteredLogs = getFilteredLogs();
    const logText = filteredLogs.map(log => 
      `[${log.timestamp}] [${log.level.toUpperCase()}] [${log.source}] ${log.message}${log.data ? ' | Data: ' + JSON.stringify(log.data) : ''}`
    ).join('\n');
    
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    logSuccess('📁 Logs exported successfully');
  };

  // Get filtered logs
  const getFilteredLogs = () => {
    return logs.filter(log => {
      if (logFilter === 'all') return true;
      if (logFilter === 'frontend') return log.source === 'frontend';
      if (logFilter === 'backend') return log.source === 'backend';
      if (logFilter === 'error') return log.level === 'error';
      if (logFilter === 'warning') return log.level === 'warning';
      if (logFilter === 'info') return log.level === 'info';
      if (logFilter === 'success') return log.level === 'success';
      return true;
    });
  };

  // Get log level color
  const getLogLevelColor = (level) => {
    switch (level) {
      case 'error': return '#ef4444';
      case 'warning': return '#f59e0b';
      case 'info': return '#3b82f6';
      case 'success': return '#22c55e';
      default: return '#6b7280';
    }
  };

  // Get log level icon
  const getLogLevelIcon = (level) => {
    switch (level) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      case 'success': return '✅';
      default: return '📝';
    }
  };

  // Filter and sort downloads (existing code)
  const filteredDownloads = adminData.downloadHistory
    .filter(download => {
      if (filter === 'all') return true;
      if (filter === 'completed') return download.status === 'completed';
      if (filter === 'failed') return download.status === 'error';
      if (filter === 'active') return ['downloading', 'preparing', 'creating_archive'].includes(download.status);
      return true;
    })
    .filter(download => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      return (
        download.workshopInfo?.title?.toLowerCase().includes(searchLower) ||
        download.workshopId?.toString().includes(searchTerm) ||
        download.clientInfo?.ip?.includes(searchTerm) ||
        download.clientInfo?.country?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => {
      let aVal, bVal;
      
      switch (sortBy) {
        case 'timestamp':
          aVal = new Date(a.startTime);
          bVal = new Date(b.startTime);
          break;
        case 'size':
          aVal = a.fileSize || 0;
          bVal = b.fileSize || 0;
          break;
        case 'country':
          aVal = a.clientInfo?.country || '';
          bVal = b.clientInfo?.country || '';
          break;
        case 'workshopId':
          aVal = parseInt(a.workshopId) || 0;
          bVal = parseInt(b.workshopId) || 0;
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

  // Utility functions (existing code)
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return '#22c55e';
      case 'error': return '#ef4444';
      case 'downloading': return '#3b82f6';
      case 'preparing': return '#f59e0b';
      case 'creating_archive': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  const getCountryFlag = (countryCode) => {
    if (!countryCode) return '🌍';
    return countryCode.toUpperCase().replace(/./g, char => 
      String.fromCodePoint(127397 + char.charCodeAt())
    );
  };

  const getClientInfoDisplay = (clientInfo) => {
    if (!clientInfo) return { ip: 'Unknown', country: 'Unknown', city: 'Unknown', browser: 'Unknown' };
    
    return {
      ip: clientInfo.ip || 'Unknown',
      country: clientInfo.country || 'Unknown',
      city: clientInfo.city || 'Unknown',
      browser: clientInfo.browser || 'Unknown',
      os: clientInfo.os || 'Unknown',
      device: clientInfo.device || 'Unknown',
      method: clientInfo.ipDetectionMethod || 'unknown'
    };
  };

  if (!isAuthenticated) {
    return (
      <div className="login-container">
        <Head>
          <title>Admin Login - DayZ Workshop Downloader</title>
        </Head>
        
        <div className="login-card">
          <div className="login-header">
            <div className="login-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4l3-3z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <h1>Admin Dashboard</h1>
            <p>DayZ Workshop Downloader Management</p>
            <p className="version-info">Enhanced with Real-time Logs v2.1</p>
          </div>
          
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="form-input"
                placeholder="Enter username"
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="form-input"
                placeholder="Enter password"
              />
            </div>
            
            {loginError && (
              <div className="login-error">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {loginError}
              </div>
            )}
            
            <button type="submit" className="login-button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10,17 15,12 10,7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Login
            </button>
          </form>
        </div>

        <style jsx>{`
          .login-container {
            min-height: 100vh;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
          }

          .login-card {
            background: rgba(30, 41, 59, 0.8);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            border: 1px solid rgba(71, 85, 105, 0.3);
            box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
            padding: 3rem;
            width: 100%;
            max-width: 400px;
          }

          .login-header {
            text-align: center;
            margin-bottom: 2rem;
          }

          .login-icon {
            width: 64px;
            height: 64px;
            background: linear-gradient(135deg, #3b82f6, #1e40af);
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            margin: 0 auto 1rem auto;
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
          }

          .login-header h1 {
            font-size: 1.875rem;
            font-weight: 700;
            color: #f8fafc;
            margin: 0 0 0.5rem 0;
          }

          .login-header p {
            color: #94a3b8;
            margin: 0;
          }

          .version-info {
            color: #22c55e !important;
            font-weight: 600 !important;
            font-size: 0.875rem !important;
            margin-top: 0.5rem !important;
          }

          .login-form {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
          }

          .form-group {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }

          .form-group label {
            font-weight: 600;
            color: #e2e8f0;
            font-size: 0.875rem;
          }

          .form-input {
            padding: 1rem 1.25rem;
            border: 2px solid rgba(71, 85, 105, 0.3);
            border-radius: 12px;
            font-size: 1rem;
            transition: all 0.3s ease;
            background: rgba(15, 23, 42, 0.6);
            color: #f1f5f9;
            backdrop-filter: blur(10px);
          }

          .form-input::placeholder {
            color: #64748b;
          }

          .form-input:focus {
            outline: none;
            border-color: #3b82f6;
            background: rgba(15, 23, 42, 0.8);
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
          }

          .login-error {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: #f87171;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 8px;
            padding: 0.75rem;
            font-size: 0.875rem;
          }

          .login-button {
            background: linear-gradient(135deg, #3b82f6, #1e40af);
            color: white;
            border: none;
            padding: 1.25rem 2rem;
            border-radius: 12px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);
          }

          .login-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 15px 40px rgba(59, 130, 246, 0.4);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <Head>
        <title>Admin Dashboard - DayZ Workshop Downloader v2.1</title>
      </Head>

      {/* Header */}
      <header className="admin-header">
        <div className="header-content">
          <div className="header-left">
            <div className="header-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1l3 3h4v4l3 3-3 3v4h-4l-3 3-3-3H5v-4l-3-3 3-3V5h4l3-3z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <div>
              <h1>Admin Dashboard</h1>
              <p>DayZ Workshop Downloader Management</p>
              <span className="version-badge">v2.1</span>
            </div>
          </div>
          
          <div className="header-right">
            <div className="refresh-control">
              <label>Auto Refresh:</label>
              <select 
                value={refreshInterval} 
                onChange={(e) => setRefreshInterval(parseInt(e.target.value))}
                className="refresh-select"
              >
                <option value={0}>Disabled</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>1m</option>
                <option value={300}>5m</option>
              </select>
            </div>
            
            <button onClick={fetchAdminData} className="refresh-button" disabled={loading}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Refresh
            </button>

            <button onClick={() => setShowLogs(!showLogs)} className={`logs-button ${showLogs ? 'active' : ''}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10,9 9,9 8,9"/>
              </svg>
              {showLogs ? 'Hide Logs' : 'Show Logs'}
              {logs.length > 0 && <span className="log-count">{logs.length}</span>}
            </button>

            <button onClick={testClientInfo} className="test-button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4"/>
                <circle cx="12" cy="12" r="10"/>
              </svg>
              Test Client Info
            </button>
            
            <button onClick={handleLogout} className="logout-button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Real-time Logs Modal */}
      {showLogs && (
        <div className="logs-modal-overlay" onClick={() => setShowLogs(false)}>
          <div className="logs-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="logs-header">
              <div className="logs-title">
                <h3>Real-time Logs</h3>
                <div className="logs-status">
                  <div className={`ws-status ${wsRef.current?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected'}`}>
                    {wsRef.current?.readyState === WebSocket.OPEN ? '🟢 Connected' : '🔴 Disconnected'}
                  </div>
                  <span className="log-count-text">{getFilteredLogs().length} entries</span>
                </div>
              </div>
              
              <div className="logs-controls">
                <select 
                  value={logFilter} 
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="log-filter-select"
                >
                  <option value="all">All Logs</option>
                  <option value="frontend">Frontend</option>
                  <option value="backend">Backend</option>
                  <option value="error">Errors</option>
                  <option value="warning">Warnings</option>
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                </select>
                
                <label className="auto-scroll-label">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  Auto Scroll
                </label>
                
                <button onClick={exportLogs} className="export-logs-button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Export
                </button>
                
                <button onClick={clearLogs} className="clear-logs-button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6"/>
                    <path d="M19,6V20a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6M8,6V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                  </svg>
                  Clear
                </button>
                
                <button onClick={() => setShowLogs(false)} className="close-logs-button">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="logs-body" ref={logsContainerRef}>
              {getFilteredLogs().length === 0 ? (
                <div className="logs-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14,2 14,8 20,8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10,9 9,9 8,9"/>
                  </svg>
                  <h3>No logs available</h3>
                  <p>Logs will appear here as they are generated</p>
                </div>
              ) : (
                getFilteredLogs().map((log) => (
                  <div key={log.id} className={`log-entry log-${log.level || 'info'}`}>
                    <div className="log-meta">
                      <span className="log-timestamp">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="log-level" style={{ color: getLogLevelColor(log.level) }}>
                        {getLogLevelIcon(log.level)} {(log.level || 'info').toUpperCase()}
                      </span>
                      <span className={`log-source source-${log.source || 'unknown'}`}>
                        {log.source || 'unknown'}
                      </span>
                    </div>
                    <div className="log-message">
                      {log.message || 'No message'}
                    </div>
                    {log.data && (
                      <div className="log-data">
                        <pre>{JSON.stringify(log.data, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Client Info Test Modal */}
      {showClientInfoTest && clientInfoTestResult && (
        <div className="modal-overlay" onClick={() => setShowClientInfoTest(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Client Info Detection Test Results</h3>
              <button onClick={() => setShowClientInfoTest(false)} className="modal-close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="test-section">
                <h4>Detected Client Information</h4>
                <div className="test-grid">
                  <div className="test-item">
                    <span className="test-label">IP Address:</span>
                    <span className="test-value">{clientInfoTestResult.detectedClientInfo?.ip || 'Unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">Detection Method:</span>
                    <span className="test-value method">{clientInfoTestResult.detectedClientInfo?.ipDetectionMethod || 'unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">Country:</span>
                    <span className="test-value">{clientInfoTestResult.detectedClientInfo?.country || 'Unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">City:</span>
                    <span className="test-value">{clientInfoTestResult.detectedClientInfo?.city || 'Unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">Browser:</span>
                    <span className="test-value">{clientInfoTestResult.detectedClientInfo?.browser || 'Unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">OS:</span>
                    <span className="test-value">{clientInfoTestResult.detectedClientInfo?.os || 'Unknown'}</span>
                  </div>
                </div>
              </div>

              <div className="test-section">
                <h4>Cloudflare Headers</h4>
                <div className="test-grid">
                  <div className="test-item">
                    <span className="test-label">CF-Connecting-IP:</span>
                    <span className="test-value">{clientInfoTestResult.cloudflareHeaders?.['cf-connecting-ip'] || 'Not set'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">CF-IPCountry:</span>
                    <span className="test-value">{clientInfoTestResult.cloudflareHeaders?.['cf-ipcountry'] || 'Not set'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">CF-Ray:</span>
                    <span className="test-value">{clientInfoTestResult.cloudflareHeaders?.['cf-ray'] || 'Not set'}</span>
                  </div>
                </div>
              </div>

              <div className="test-section">
                <h4>Proxy Headers</h4>
                <div className="test-grid">
                  <div className="test-item">
                    <span className="test-label">X-Forwarded-For:</span>
                    <span className="test-value">{clientInfoTestResult.proxyHeaders?.['x-forwarded-for'] || 'Not set'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">X-Real-IP:</span>
                    <span className="test-value">{clientInfoTestResult.proxyHeaders?.['x-real-ip'] || 'Not set'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">Express IP:</span>
                    <span className="test-value">{clientInfoTestResult.expressIP || 'Not set'}</span>
                  </div>
                </div>
              </div>

              <div className="test-section">
                <h4>Environment Info</h4>
                <div className="test-grid">
                  <div className="test-item">
                    <span className="test-label">Environment:</span>
                    <span className="test-value">{clientInfoTestResult.environment || 'unknown'}</span>
                  </div>
                  <div className="test-item">
                    <span className="test-label">Trust Proxy:</span>
                    <span className="test-value">{clientInfoTestResult.trustProxy ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowClientInfoTest(false)} className="modal-ok-button">
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22,4 12,14.01 9,11.01"/>
            </svg>
          </div>
          <div className="stat-content">
            <h3>Completed Downloads</h3>
            <p className="stat-number">{adminData.systemStats.completedDownloads || 0}</p>
            <span className="stat-subtitle">Total successful</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon warning">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div className="stat-content">
            <h3>Active Downloads</h3>
            <p className="stat-number">{adminData.activeDownloads.length}</p>
            <span className="stat-subtitle">Currently processing</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon error">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div className="stat-content">
            <h3>Failed Downloads</h3>
            <p className="stat-number">{adminData.systemStats.failedDownloads || 0}</p>
            <span className="stat-subtitle">Errors encountered</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon info">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <div className="stat-content">
            <h3>Unique Users</h3>
            <p className="stat-number">{adminData.systemStats.uniqueUsers || 0}</p>
            <span className="stat-subtitle">Total visitors</span>
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="controls-section">
        <div className="filters">
          <div className="filter-group">
            <label>Status Filter:</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
              <option value="all">All Downloads</option>
              <option value="completed">Completed</option>
              <option value="active">Active</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Sort By:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="filter-select">
              <option value="timestamp">Date</option>
              <option value="size">File Size</option>
              <option value="country">Country</option>
              <option value="workshopId">Workshop ID</option>
            </select>
          </div>

          <div className="filter-group">
            <label>Order:</label>
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="filter-select">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>

        <div className="search-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder="Search by title, workshop ID, IP, or country..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>
      </div>

      {/* Downloads Table */}
      <div className="downloads-section">
        <div className="section-header">
          <h2>Download History</h2>
          <span className="result-count">
            {filteredDownloads.length} of {adminData.downloadHistory.length} downloads
          </span>
        </div>

        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Loading admin data...</p>
          </div>
        ) : (
          <div className="downloads-table">
            <div className="table-header">
              <div className="col-timestamp">Date/Time</div>
              <div className="col-workshop">Workshop Item</div>
              <div className="col-client">Enhanced Client Info</div>
              <div className="col-status">Status</div>
              <div className="col-size">File Size</div>
              <div className="col-actions">Actions</div>
            </div>

            <div className="table-body">
              {filteredDownloads.length === 0 ? (
                <div className="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m15 9-6 6"/>
                    <path d="m9 9 6 6"/>
                  </svg>
                  <h3>No downloads found</h3>
                  <p>No downloads match your current filters.</p>
                </div>
              ) : (
                filteredDownloads.map((download, index) => {
                  const clientDisplay = getClientInfoDisplay(download.clientInfo);
                  
                  return (
                    <div key={download.id || index} className="table-row">
                      <div className="col-timestamp">
                        <div className="timestamp-info">
                          <span className="date">{formatDate(download.startTime)}</span>
                          {download.completedTime && (
                            <span className="duration">
                              Duration: {Math.round((new Date(download.completedTime) - new Date(download.startTime)) / 1000)}s
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="col-workshop">
                        <div className="workshop-info">
                          <div className="workshop-header">
                            <h4>{download.workshopInfo?.title || `Workshop ${download.workshopId}`}</h4>
                            <span className="workshop-id">ID: {download.workshopId}</span>
                          </div>
                          {download.workshopInfo?.author && (
                            <p className="workshop-author">by {download.workshopInfo.author}</p>
                          )}
                          {download.workshopInfo?.previewImage && (
                            <img src={download.workshopInfo.previewImage} alt="Workshop preview" className="workshop-thumbnail" />
                          )}
                        </div>
                      </div>

                      <div className="col-client">
                        <div className="enhanced-client-info">
                          <div className="ip-info">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                              <circle cx="12" cy="7" r="4"/>
                            </svg>
                            <span className="ip-address">{clientDisplay.ip}</span>
                            {clientDisplay.method !== 'unknown' && (
                              <span className="detection-method" title={`Detected via: ${clientDisplay.method}`}>
                                {clientDisplay.method.split('-')[0]}
                              </span>
                            )}
                          </div>
                          <div className="location-info">
                            <span className="flag">{getCountryFlag(download.clientInfo?.countryCode)}</span>
                            <span className="country">{clientDisplay.country}</span>
                            {clientDisplay.city !== 'Unknown' && (
                              <span className="city">{clientDisplay.city}</span>
                            )}
                          </div>
                          <div className="device-info">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                              <line x1="8" y1="21" x2="16" y2="21"/>
                              <line x1="12" y1="17" x2="12" y2="21"/>
                            </svg>
                            <span className="browser-os">{clientDisplay.browser} • {clientDisplay.os}</span>
                          </div>
                          {clientDisplay.device !== 'Unknown' && (
                            <div className="device-type">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
                                <line x1="12" y1="18" x2="12.01" y2="18"/>
                              </svg>
                              <span>{clientDisplay.device}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-status">
                        <div className="status-info">
                          <div 
                            className="status-badge"
                            style={{ backgroundColor: getStatusColor(download.status) }}
                          >
                            {download.status}
                          </div>
                          {download.progress !== undefined && (
                            <div className="progress-bar">
                              <div 
                                className="progress-fill"
                                style={{ 
                                  width: `${download.progress}%`,
                                  backgroundColor: getStatusColor(download.status)
                                }}
                              ></div>
                              <span className="progress-text">{download.progress}%</span>
                            </div>
                          )}
                          {download.error && (
                            <div className="error-message" title={download.error}>
                              Error: {download.error.substring(0, 100)}...
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="col-size">
                        <div className="size-info">
                          <span className="file-size">{formatFileSize(download.fileSize)}</span>
                          {download.workshopInfo?.fileSize && (
                            <span className="original-size">Original: {download.workshopInfo.fileSize}</span>
                          )}
                        </div>
                      </div>

                      <div className="col-actions">
                        <div className="action-buttons">
                          {download.status === 'completed' && download.downloadUrl && (
                            <a 
                              href={download.downloadUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="action-btn download-btn"
                              title="Download file"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7,10 12,15 17,10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                              </svg>
                            </a>
                          )}
                          <a 
                            href={`https://steamcommunity.com/sharedfiles/filedetails/?id=${download.workshopId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="action-btn steam-btn"
                            title="View on Steam"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                              <polyline points="15,3 21,3 21,9"/>
                              <line x1="10" y1="14" x2="21" y2="3"/>
                            </svg>
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .admin-container {
          min-height: 100vh;
          background: #0a0a0f;
          background-image: 
            radial-gradient(circle at 25% 25%, #1a1a2e 0%, transparent 50%),
            radial-gradient(circle at 75% 75%, #16213e 0%, transparent 50%);
          color: #e2e8f0;
        }

        .admin-header {
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(20px);
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
          padding: 1.5rem 2rem;
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          max-width: 1400px;
          margin: 0 auto;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .header-icon {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .header-left h1 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #f8fafc;
          margin: 0;
        }

        .header-left p {
          color: #94a3b8;
          margin: 0;
          font-size: 0.875rem;
        }

        .version-badge {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          margin-top: 0.5rem;
          display: inline-block;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .refresh-control {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #cbd5e1;
        }

        .refresh-select, .filter-select {
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(71, 85, 105, 0.3);
          border-radius: 8px;
          color: #e2e8f0;
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
        }

        .refresh-button, .logout-button, .test-button, .logs-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1rem;
          border: none;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }

        .refresh-button {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border: 1px solid rgba(59, 130, 246, 0.3);
        }

        .refresh-button:hover:not(:disabled) {
          background: rgba(59, 130, 246, 0.3);
        }

        .test-button {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .test-button:hover {
          background: rgba(34, 197, 94, 0.3);
        }

        .logs-button {
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }

        .logs-button:hover {
          background: rgba(139, 92, 246, 0.3);
        }

        .logs-button.active {
          background: rgba(139, 92, 246, 0.4);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.3);
        }

        .log-count {
          position: absolute;
          top: -4px;
          right: -4px;
          background: #ef4444;
          color: white;
          border-radius: 50%;
          width: 18px;
          height: 18px;
          font-size: 0.75rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
        }

        .refresh-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .logout-button {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .logout-button:hover {
          background: rgba(239, 68, 68, 0.3);
        }

        /* Logs Modal Styles */
        .logs-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .logs-modal-content {
          background: rgba(15, 23, 42, 0.95);
          border-radius: 16px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          width: 95%;
          height: 85%;
          max-width: 1200px;
          max-height: 800px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .logs-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.5rem 2rem;
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
          background: rgba(30, 41, 59, 0.5);
        }

        .logs-title {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .logs-title h3 {
          color: #f8fafc;
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
        }

        .logs-status {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .ws-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .ws-status.connected {
          color: #22c55e;
        }

        .ws-status.disconnected {
          color: #ef4444;
        }

        .log-count-text {
          color: #94a3b8;
          font-size: 0.875rem;
        }

        .logs-controls {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .log-filter-select {
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(71, 85, 105, 0.3);
          border-radius: 6px;
          color: #e2e8f0;
          padding: 0.5rem;
          font-size: 0.875rem;
        }

        .auto-scroll-label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #cbd5e1;
          cursor: pointer;
        }

        .auto-scroll-label input[type="checkbox"] {
          accent-color: #3b82f6;
        }

        .export-logs-button, .clear-logs-button, .close-logs-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .export-logs-button {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
          border: 1px solid rgba(34, 197, 94, 0.3);
        }

        .export-logs-button:hover {
          background: rgba(34, 197, 94, 0.3);
        }

        .clear-logs-button {
          background: rgba(239, 68, 68, 0.2);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .clear-logs-button:hover {
          background: rgba(239, 68, 68, 0.3);
        }

        .close-logs-button {
          background: rgba(71, 85, 105, 0.2);
          color: #94a3b8;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .close-logs-button:hover {
          background: rgba(71, 85, 105, 0.3);
          color: #f8fafc;
        }

        .logs-body {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
          font-size: 0.875rem;
          line-height: 1.5;
        }

        .logs-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #64748b;
          text-align: center;
        }

        .logs-empty svg {
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .logs-empty h3 {
          margin: 0 0 0.5rem 0;
          color: #94a3b8;
        }

        .logs-empty p {
          margin: 0;
          color: #64748b;
        }

        .log-entry {
          margin-bottom: 0.75rem;
          padding: 0.75rem;
          border-radius: 8px;
          border-left: 4px solid transparent;
          background: rgba(30, 41, 59, 0.3);
          transition: all 0.2s ease;
        }

        .log-entry:hover {
          background: rgba(30, 41, 59, 0.5);
        }

        .log-entry.log-error {
          border-left-color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
        }

        .log-entry.log-warning {
          border-left-color: #f59e0b;
          background: rgba(245, 158, 11, 0.1);
        }

        .log-entry.log-success {
          border-left-color: #22c55e;
          background: rgba(34, 197, 94, 0.1);
        }

        .log-entry.log-info {
          border-left-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }

        .log-meta {
          display: flex;
          align-items: center;
          gap: 1rem;
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
        }

        .log-timestamp {
          color: #64748b;
          font-weight: 500;
        }

        .log-level {
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .log-source {
          padding: 0.125rem 0.5rem;
          border-radius: 4px;
          font-weight: 500;
          font-size: 0.75rem;
        }

        .log-source.source-frontend {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
        }

        .log-source.source-backend {
          background: rgba(139, 92, 246, 0.2);
          color: #a78bfa;
        }

        .log-source.source-unknown {
          background: rgba(107, 114, 128, 0.2);
          color: #9ca3af;
        }

        .log-message {
          color: #e2e8f0;
          margin-bottom: 0.5rem;
          word-wrap: break-word;
        }

        .log-data {
          background: rgba(15, 23, 42, 0.8);
          border-radius: 6px;
          padding: 0.75rem;
          margin-top: 0.5rem;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .log-data pre {
          margin: 0;
          color: #94a3b8;
          font-size: 0.75rem;
          white-space: pre-wrap;
          word-wrap: break-word;
          max-height: 200px;
          overflow-y: auto;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .modal-content {
          background: rgba(15, 23, 42, 0.95);
          border-radius: 16px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          max-width: 800px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.5rem 2rem;
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
        }

        .modal-header h3 {
          color: #f8fafc;
          margin: 0;
          font-size: 1.25rem;
          font-weight: 700;
        }

        .modal-close {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 0.5rem;
          border-radius: 8px;
          transition: all 0.2s ease;
        }

        .modal-close:hover {
          background: rgba(71, 85, 105, 0.3);
          color: #f8fafc;
        }

        .modal-body {
          padding: 2rem;
        }

        .test-section {
          margin-bottom: 2rem;
        }

        .test-section h4 {
          color: #cbd5e1;
          margin: 0 0 1rem 0;
          font-size: 1rem;
          font-weight: 600;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
        }

        .test-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 1rem;
        }

        .test-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem;
          background: rgba(30, 41, 59, 0.4);
          border-radius: 8px;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        .test-label {
          color: #94a3b8;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .test-value {
          color: #f8fafc;
          font-size: 0.875rem;
          font-weight: 600;
          font-family: monospace;
        }

        .test-value.method {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
          padding: 0.25rem 0.5rem;
          border-radius: 6px;
          font-size: 0.75rem;
        }

        .modal-footer {
          padding: 1.5rem 2rem;
          border-top: 1px solid rgba(71, 85, 105, 0.3);
          display: flex;
          justify-content: flex-end;
        }

        .modal-ok-button {
          background: linear-gradient(135deg, #3b82f6, #1e40af);
          color: white;
          border: none;
          padding: 0.75rem 2rem;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .modal-ok-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 25px rgba(59, 130, 246, 0.3);
        }

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 1.5rem;
          padding: 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .stat-card {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          padding: 1.5rem;
          display: flex;
          align-items: center;
          gap: 1rem;
          transition: all 0.3s ease;
        }

        .stat-card:hover {
          transform: translateY(-2px);
          background: rgba(30, 41, 59, 0.8);
        }

        .stat-icon {
          width: 48px;
          height: 48px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .stat-icon.success { background: linear-gradient(135deg, #22c55e, #16a34a); }
        .stat-icon.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .stat-icon.error { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .stat-icon.info { background: linear-gradient(135deg, #3b82f6, #1e40af); }

        .stat-content h3 {
          font-size: 0.875rem;
          font-weight: 600;
          color: #cbd5e1;
          margin: 0 0 0.25rem 0;
        }

        .stat-number {
          font-size: 2rem;
          font-weight: 800;
          color: #f8fafc;
          margin: 0;
        }

        .stat-subtitle {
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .controls-section {
          padding: 0 2rem 1rem;
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 2rem;
          flex-wrap: wrap;
        }

        .filters {
          display: flex;
          align-items: center;
          gap: 1.5rem;
          flex-wrap: wrap;
        }

        .filter-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          color: #cbd5e1;
        }

        .search-box {
          position: relative;
          display: flex;
          align-items: center;
          max-width: 400px;
          flex: 1;
        }

        .search-box svg {
          position: absolute;
          left: 1rem;
          color: #64748b;
          z-index: 1;
        }

        .search-input {
          width: 100%;
          padding: 0.75rem 1rem 0.75rem 2.5rem;
          background: rgba(30, 41, 59, 0.6);
          border: 1px solid rgba(71, 85, 105, 0.3);
          border-radius: 12px;
          color: #e2e8f0;
          font-size: 0.875rem;
        }

        .search-input::placeholder {
          color: #64748b;
        }

        .search-input:focus {
          outline: none;
          border-color: #3b82f6;
          background: rgba(30, 41, 59, 0.8);
        }

        .downloads-section {
          padding: 1rem 2rem 2rem;
          max-width: 1400px;
          margin: 0 auto;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 1.5rem;
        }

        .section-header h2 {
          font-size: 1.5rem;
          font-weight: 700;
          color: #f8fafc;
          margin: 0;
        }

        .result-count {
          font-size: 0.875rem;
          color: #94a3b8;
        }

        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem;
          color: #94a3b8;
        }

        .loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          border-top-color: #3b82f6;
          animation: spin 1s linear infinite;
          margin-bottom: 1rem;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .downloads-table {
          background: rgba(30, 41, 59, 0.6);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          border: 1px solid rgba(71, 85, 105, 0.3);
          overflow: hidden;
        }

        .table-header {
          display: grid;
          grid-template-columns: 180px 1fr 250px 120px 120px 100px;
          gap: 1rem;
          padding: 1rem 1.5rem;
          background: rgba(15, 23, 42, 0.8);
          border-bottom: 1px solid rgba(71, 85, 105, 0.3);
          font-weight: 600;
          color: #cbd5e1;
          font-size: 0.875rem;
        }

        .table-body {
          max-height: 800px;
          overflow-y: auto;
        }

        .table-row {
          display: grid;
          grid-template-columns: 180px 1fr 250px 120px 120px 100px;
          gap: 1rem;
          padding: 1.5rem;
          border-bottom: 1px solid rgba(71, 85, 105, 0.2);
          transition: all 0.2s ease;
        }

        .table-row:hover {
          background: rgba(30, 41, 59, 0.4);
        }

        .timestamp-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .date {
          font-size: 0.875rem;
          color: #e2e8f0;
          font-weight: 500;
        }

        .duration {
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .workshop-info {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .workshop-header {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .workshop-header h4 {
          font-size: 0.875rem;
          font-weight: 600;
          color: #f8fafc;
          margin: 0;
          line-height: 1.2;
        }

        .workshop-id {
          font-size: 0.75rem;
          color: #60a5fa;
          font-family: monospace;
        }

        .workshop-author {
          font-size: 0.75rem;
          color: #94a3b8;
          margin: 0;
        }

        .workshop-thumbnail {
          width: 60px;
          height: 40px;
          object-fit: cover;
          border-radius: 6px;
          border: 1px solid rgba(71, 85, 105, 0.3);
        }

        /* Enhanced Client Info Styles */
        .enhanced-client-info {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .ip-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
        }

        .ip-address {
          color: #e2e8f0;
          font-family: monospace;
          font-weight: 600;
        }

        .detection-method {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
          padding: 0.125rem 0.375rem;
          border-radius: 4px;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
        }

        .location-info {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #cbd5e1;
        }

        .flag {
          font-size: 1rem;
        }

        .country {
          font-weight: 600;
        }

        .city {
          color: #94a3b8;
        }

        .device-info, .device-type {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .browser-os {
          font-family: monospace;
        }

        .status-info {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
          text-align: center;
          text-transform: capitalize;
        }

        .progress-bar {
          position: relative;
          width: 100%;
          height: 16px;
          background: rgba(15, 23, 42, 0.8);
          border-radius: 8px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          border-radius: 8px;
          transition: width 0.3s ease;
        }

        .progress-text {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 0.75rem;
          font-weight: 600;
          color: white;
        }

        .error-message {
          font-size: 0.75rem;
          color: #f87171;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.3);
          border-radius: 6px;
          padding: 0.5rem;
        }

        .size-info {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .file-size {
          font-size: 0.875rem;
          color: #e2e8f0;
          font-weight: 500;
        }

        .original-size {
          font-size: 0.75rem;
          color: #94a3b8;
        }

        .action-buttons {
          display: flex;
          gap: 0.5rem;
          align-items: center;
        }

        .action-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid;
          text-decoration: none;
          transition: all 0.2s ease;
        }

        .download-btn {
          background: rgba(34, 197, 94, 0.2);
          color: #4ade80;
          border-color: rgba(34, 197, 94, 0.3);
        }

        .download-btn:hover {
          background: rgba(34, 197, 94, 0.3);
        }

        .steam-btn {
          background: rgba(59, 130, 246, 0.2);
          color: #60a5fa;
          border-color: rgba(59, 130, 246, 0.3);
        }

        .steam-btn:hover {
          background: rgba(59, 130, 246, 0.3);
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4rem;
          color: #94a3b8;
          text-align: center;
        }

        .empty-state svg {
          margin-bottom: 1rem;
          opacity: 0.5;
        }

        .empty-state h3 {
          margin: 0 0 0.5rem 0;
          color: #cbd5e1;
        }

        .empty-state p {
          margin: 0;
          color: #64748b;
        }

        @media (max-width: 1200px) {
          .table-header, .table-row {
            grid-template-columns: 160px 1fr 220px 100px 100px 80px;
            gap: 0.75rem;
          }
          
          .controls-section {
            flex-direction: column;
            align-items: stretch;
            gap: 1rem;
          }
          
          .filters {
            justify-content: center;
          }

          .logs-modal-content {
            width: 98%;
            height: 90%;
          }

          .logs-controls {
            flex-wrap: wrap;
            gap: 0.5rem;
          }
        }

        @media (max-width: 768px) {
          .admin-header {
            padding: 1rem;
          }
          
          .header-content {
            flex-direction: column;
            gap: 1rem;
          }
          
          .header-right {
            width: 100%;
            justify-content: center;
            flex-wrap: wrap;
          }
          
          .stats-grid {
            grid-template-columns: 1fr;
            padding: 1rem;
          }
          
          .downloads-section {
            padding: 1rem;
          }
          
          .table-header {
            display: none;
          }
          
          .table-row {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding: 1rem;
          }
          
          .search-box {
            max-width: none;
          }

          .modal-content {
            width: 95%;
            margin: 1rem;
          }

          .test-grid {
            grid-template-columns: 1fr;
          }

          .logs-modal-content {
            width: 100%;
            height: 100%;
            border-radius: 0;
          }

          .logs-header {
            padding: 1rem;
          }

          .logs-title {
            display: none;
          }

          .logs-controls {
            justify-content: space-between;
            width: 100%;
          }

          .log-filter-select {
            width: 120px;
          }

          .logs-body {
            padding: 0.5rem;
          }

          .log-entry {
            padding: 0.5rem;
            margin-bottom: 0.5rem;
          }

          .log-meta {
            gap: 0.5rem;
            flex-wrap: wrap;
          }
        }
      `}</style>
    </div>
  );
}