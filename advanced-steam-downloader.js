const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

class AdvancedSteamDownloader {
  constructor(steamcmdPath, steamUsername = 'anonymous', steamPassword = '') {
    this.steamcmdPath = steamcmdPath;
    this.steamUsername = steamUsername;
    this.steamPassword = steamPassword;
    this.retryCount = 5;
    this.retryDelay = 10000;
    this.timeout = 7200000; // 2 hours
    
    // Steam directories
    this.steamcmdDir = path.dirname(steamcmdPath);
    this.steamDir = '/root/Steam';
    
    // ====== FIX: Session management ======
    this.sessionValid = false;
    this.lastSessionCheck = 0;
    this.sessionCheckInterval = 1800000; // 30 minutes
    this.sessionLockFile = path.join(this.steamDir, '.session_active');
    
    console.log(`✅ Using Steam directory: ${this.steamDir}`);
    
    this.configPath = path.join(this.steamDir, 'config');
    
    this.ensureDirectories();
  }

  async ensureDirectories() {
    try {
      await fs.ensureDir(this.steamDir);
      await fs.ensureDir(this.configPath);
      await fs.ensureDir(path.join(this.steamDir, 'userdata'));
      console.log(`Steam directory: ${this.steamDir}`);
      console.log(`Steam config path: ${this.configPath}`);
    } catch (error) {
      console.error('Error creating directories:', error);
    }
  }

  // ====== FIX: Improved authentication check ======
  async isAuthenticated() {
    try {
      // Check if we have a valid cached session
      if (this.sessionValid && (Date.now() - this.lastSessionCheck < this.sessionCheckInterval)) {
        console.log('✅ Using cached session (still valid)');
        return true;
      }

      // Anonymous users don't need authentication
      if (this.steamUsername === 'anonymous') {
        console.log('ℹ️ Using anonymous login - no authentication required');
        this.sessionValid = true;
        this.lastSessionCheck = Date.now();
        return true;
      }

      // Check for config.vdf with saved credentials
      const configVdfPath = path.join(this.configPath, 'config.vdf');
      if (fs.existsSync(configVdfPath)) {
        const configContent = fs.readFileSync(configVdfPath, 'utf8');
        
        // Check if our user is saved in config
        if (configContent.includes(this.steamUsername.toLowerCase())) {
          console.log(`✅ Found saved credentials for ${this.steamUsername} in config.vdf`);
          
          // Verify session is still active with a quick test
          const isActive = await this.verifySessionActive();
          if (isActive) {
            this.sessionValid = true;
            this.lastSessionCheck = Date.now();
            return true;
          }
        }
      }

      // Check for modern Steam authentication (userdata)
      const userdataPath = path.join(this.steamDir, 'userdata');
      if (fs.existsSync(userdataPath)) {
        const userDirs = fs.readdirSync(userdataPath);
        if (userDirs.length > 0) {
          for (const userDir of userDirs) {
            const localConfigPath = path.join(userdataPath, userDir, 'config', 'localconfig.vdf');
            if (fs.existsSync(localConfigPath)) {
              console.log(`✅ Found Steam authentication in userdata/${userDir}`);
              
              // Verify session
              const isActive = await this.verifySessionActive();
              if (isActive) {
                this.sessionValid = true;
                this.lastSessionCheck = Date.now();
                return true;
              }
            }
          }
        }
      }

      console.log('❌ No valid authentication found');
      this.sessionValid = false;
      return false;
      
    } catch (error) {
      console.error('Error checking authentication:', error);
      return false;
    }
  }

  // ====== NEW: Verify session is actually active ======
  async verifySessionActive() {
    return new Promise((resolve) => {
      console.log('🔍 Verifying Steam session...');
      
      // Quick login test without downloading anything
      const steamcmd = spawn(this.steamcmdPath, [
        '+login', this.steamUsername,
        '+quit'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/root',
        env: { 
          ...process.env, 
          STEAM_COMPAT_CLIENT_INSTALL_PATH: this.steamDir,
          HOME: '/root'
        },
        timeout: 30000 // 30 second timeout for verification
      });

      let output = '';
      let needsSteamGuard = false;
      let loginSuccess = false;

      const timeout = setTimeout(() => {
        steamcmd.kill('SIGTERM');
        resolve(false);
      }, 30000);

      steamcmd.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        
        if (dataStr.includes('Steam Guard') || dataStr.includes('Two-factor')) {
          needsSteamGuard = true;
        }
        
        if (dataStr.includes('Logged in OK') || 
            dataStr.includes('Waiting for client config...OK') ||
            dataStr.includes('Loading Steam API...OK')) {
          loginSuccess = true;
        }
      });

      steamcmd.on('close', (code) => {
        clearTimeout(timeout);
        
        if (needsSteamGuard) {
          console.log('⚠️ Steam Guard required - session expired');
          resolve(false);
        } else if (loginSuccess || code === 0) {
          console.log('✅ Session verified - still active');
          resolve(true);
        } else {
          console.log('❌ Session verification failed');
          resolve(false);
        }
      });

      steamcmd.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  // ====== FIX: One-time authentication with Steam Guard ======
  async authenticateAndSaveSession(steamGuardCode = null) {
    return new Promise((resolve, reject) => {
      console.log(`🔐 Authenticating user: ${this.steamUsername} (saving session)`);
      
      const args = [
        '+@ShutdownOnFailedCommand', '0',
        '+login', this.steamUsername
      ];
      
      if (this.steamPassword) {
        args.push(this.steamPassword);
      }
      
      if (steamGuardCode) {
        args.push(steamGuardCode);
      }
      
      // Don't quit immediately - let Steam save the session
      args.push('+quit');
      
      const steamcmd = spawn(this.steamcmdPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/root',
        env: { 
          ...process.env, 
          STEAM_COMPAT_CLIENT_INSTALL_PATH: this.steamDir,
          HOME: '/root'
        }
      });

      let output = '';
      let needsSteamGuard = false;
      let authSuccess = false;
      let steamGuardType = null;

      const timeout = setTimeout(() => {
        steamcmd.kill('SIGTERM');
        reject(new Error('Authentication timeout'));
      }, 120000); // 2 minute timeout

      steamcmd.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log('Steam Auth:', dataStr);
        
        // Detect Steam Guard type
        if (dataStr.includes('Steam Guard code')) {
          needsSteamGuard = true;
          steamGuardType = 'email';
        } else if (dataStr.includes('Two-factor code')) {
          needsSteamGuard = true;
          steamGuardType = 'mobile';
        }
        
        if (dataStr.includes('Logged in OK') || 
            dataStr.includes('Waiting for client config...OK')) {
          authSuccess = true;
        }
      });

      steamcmd.stderr.on('data', (data) => {
        console.error('Steam Auth Error:', data.toString());
      });

      steamcmd.on('close', async (code) => {
        clearTimeout(timeout);
        
        if (needsSteamGuard && !steamGuardCode) {
          reject(new Error(`STEAM_GUARD_REQUIRED:${steamGuardType || 'unknown'}`));
        } else if (authSuccess || code === 0) {
          console.log('✅ Authentication successful - session saved');
          
          // Mark session as valid
          this.sessionValid = true;
          this.lastSessionCheck = Date.now();
          
          // Create session lock file
          try {
            await fs.writeFile(this.sessionLockFile, JSON.stringify({
              username: this.steamUsername,
              authenticatedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 86400000 * 30).toISOString() // 30 days
            }));
          } catch (err) {
            console.warn('Could not create session lock file:', err.message);
          }
          
          resolve(true);
        } else {
          reject(new Error(`Authentication failed with code: ${code}`));
        }
      });

      steamcmd.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // ====== FIX: Download using cached session (no re-login) ======
  async downloadWithCachedSession(workshopId, downloadPath, appId) {
    return new Promise((resolve, reject) => {
      console.log(`📥 Downloading ${workshopId} using cached session...`);
      
      const timeout = setTimeout(() => {
        steamcmd.kill('SIGTERM');
        reject(new Error('Download timeout'));
      }, this.timeout);

      // ====== KEY FIX: Use saved credentials without password ======
      const steamcmd = spawn(this.steamcmdPath, [
        '+@ShutdownOnFailedCommand', '0',
        '+force_install_dir', downloadPath,
        '+login', this.steamUsername, // No password = use cached credentials
        '+workshop_download_item', appId, workshopId,
        '+quit'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/root',
        env: { 
          ...process.env, 
          STEAM_COMPAT_CLIENT_INSTALL_PATH: this.steamDir,
          HOME: '/root'
        }
      });

      let output = '';
      let hasError = false;
      let needsReauth = false;

      steamcmd.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log('SteamCMD:', dataStr);
        
        // Check if we need to re-authenticate
        if (dataStr.includes('Steam Guard') || 
            dataStr.includes('Two-factor') ||
            dataStr.includes('Invalid Password') ||
            dataStr.includes('Login Failure')) {
          needsReauth = true;
        }
        
        if (dataStr.includes('ERROR!') || 
            dataStr.includes('failed (Failure)') ||
            dataStr.includes('No subscription') ||
            dataStr.includes('Access Denied')) {
          hasError = true;
        }
      });

      steamcmd.stderr.on('data', (data) => {
        console.error('SteamCMD Error:', data.toString());
      });

      steamcmd.on('close', (code) => {
        clearTimeout(timeout);
        
        if (needsReauth) {
          // Session expired - need to re-authenticate
          this.sessionValid = false;
          reject(new Error('SESSION_EXPIRED'));
          return;
        }
        
        const expectedPath = path.join(downloadPath, 'steamapps', 'workshop', 'content', appId, workshopId);
        if (fs.existsSync(expectedPath)) {
          try {
            const files = fs.readdirSync(expectedPath);
            if (files.length > 0) {
              console.log(`✅ Download successful: ${files.length} files`);
              resolve({ success: true, method: 'cached_session', path: expectedPath, output });
              return;
            }
          } catch (err) {
            console.error('Error reading files:', err);
          }
        }
        
        reject(new Error(`Download failed: ${hasError ? 'SteamCMD error' : 'No content found'}`));
      });

      steamcmd.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // ====== FIX: Download with full login (when session expired) ======
  async downloadWithFullLogin(workshopId, downloadPath, appId) {
    return new Promise((resolve, reject) => {
      console.log(`📥 Downloading ${workshopId} with full login...`);
      
      const timeout = setTimeout(() => {
        steamcmd.kill('SIGTERM');
        reject(new Error('Download timeout'));
      }, this.timeout);

      const steamcmd = spawn(this.steamcmdPath, [
        '+@ShutdownOnFailedCommand', '0',
        '+force_install_dir', downloadPath,
        '+login', this.steamUsername, this.steamPassword,
        '+workshop_download_item', appId, workshopId,
        '+quit'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/root',
        env: { 
          ...process.env, 
          STEAM_COMPAT_CLIENT_INSTALL_PATH: this.steamDir,
          HOME: '/root'
        }
      });

      let output = '';
      let hasError = false;
      let needsSteamGuard = false;

      steamcmd.stdout.on('data', (data) => {
        const dataStr = data.toString();
        output += dataStr;
        console.log('SteamCMD Full:', dataStr);
        
        if (dataStr.includes('Steam Guard') || dataStr.includes('Two-factor')) {
          needsSteamGuard = true;
        }
        
        if (dataStr.includes('ERROR!') || 
            dataStr.includes('failed (Failure)') ||
            dataStr.includes('No subscription')) {
          hasError = true;
        }
      });

      steamcmd.on('close', (code) => {
        clearTimeout(timeout);
        
        if (needsSteamGuard) {
          reject(new Error('STEAM_GUARD_REQUIRED'));
          return;
        }
        
        const expectedPath = path.join(downloadPath, 'steamapps', 'workshop', 'content', appId, workshopId);
        if (fs.existsSync(expectedPath)) {
          const files = fs.readdirSync(expectedPath);
          if (files.length > 0) {
            // Session was saved during download
            this.sessionValid = true;
            this.lastSessionCheck = Date.now();
            
            resolve({ success: true, method: 'full_login', path: expectedPath, output });
            return;
          }
        }
        
        reject(new Error(`Download failed`));
      });

      steamcmd.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // ====== FIX: Main download method with smart session handling ======
  async downloadWorkshopItem(workshopId, downloadPath, appId = '221100') {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎮 Starting download for workshop ID: ${workshopId}`);
    console.log(`${'='.repeat(60)}\n`);
    
    // Step 1: Check if we have a valid session
    const isAuth = await this.isAuthenticated();
    
    if (isAuth) {
      // Try to use cached session first (no Steam Guard needed)
      try {
        console.log('📌 Attempting download with cached session...');
        const result = await this.downloadWithCachedSession(workshopId, downloadPath, appId);
        return result;
      } catch (error) {
        if (error.message === 'SESSION_EXPIRED') {
          console.log('⚠️ Session expired, need to re-authenticate');
          this.sessionValid = false;
        } else {
          throw error;
        }
      }
    }
    
    // Step 2: Session invalid/expired - try full login
    if (this.steamUsername !== 'anonymous') {
      console.log('🔐 No valid session, attempting full login...');
      
      try {
        const result = await this.downloadWithFullLogin(workshopId, downloadPath, appId);
        return result;
      } catch (error) {
        if (error.message.includes('STEAM_GUARD_REQUIRED')) {
          console.log('\n' + '!'.repeat(60));
          console.log('⚠️  STEAM GUARD REQUIRED');
          console.log('!'.repeat(60));
          console.log('\nYou need to authenticate with Steam Guard first.');
          console.log('Run this command manually:');
          console.log(`\n  ${this.steamcmdPath} +login ${this.steamUsername}\n`);
          console.log('Enter your Steam Guard code when prompted.');
          console.log('This only needs to be done ONCE every 30 days.\n');
          throw error;
        }
        throw error;
      }
    }
    
    // Anonymous download
    return this.downloadAnonymous(workshopId, downloadPath, appId);
  }

  // ====== Anonymous download (for public items) ======
  async downloadAnonymous(workshopId, downloadPath, appId) {
    return new Promise((resolve, reject) => {
      console.log(`📥 Downloading ${workshopId} anonymously...`);
      
      const timeout = setTimeout(() => {
        steamcmd.kill('SIGTERM');
        reject(new Error('Download timeout'));
      }, this.timeout);

      const steamcmd = spawn(this.steamcmdPath, [
        '+force_install_dir', downloadPath,
        '+login', 'anonymous',
        '+workshop_download_item', appId, workshopId,
        '+quit'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: '/root',
        env: { 
          ...process.env, 
          STEAM_COMPAT_CLIENT_INSTALL_PATH: this.steamDir,
          HOME: '/root'
        }
      });

      let output = '';
      let hasError = false;

      steamcmd.stdout.on('data', (data) => {
        output += data.toString();
        console.log('SteamCMD Anon:', data.toString());
        
        if (data.toString().includes('ERROR!') || 
            data.toString().includes('No subscription')) {
          hasError = true;
        }
      });

      steamcmd.on('close', (code) => {
        clearTimeout(timeout);
        
        const expectedPath = path.join(downloadPath, 'steamapps', 'workshop', 'content', appId, workshopId);
        if (fs.existsSync(expectedPath)) {
          const files = fs.readdirSync(expectedPath);
          if (files.length > 0) {
            resolve({ success: true, method: 'anonymous', path: expectedPath, output });
            return;
          }
        }
        
        // Anonymous failed - item might require login
        if (hasError) {
          reject(new Error('Anonymous download failed - item may require Steam account'));
        } else {
          reject(new Error('No content downloaded'));
        }
      });

      steamcmd.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // ====== FIX: Retry with smart session handling ======
  async retryDownload(workshopId, downloadPath, appId = '221100') {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryCount; attempt++) {
      try {
        console.log(`\n📥 Download attempt ${attempt}/${this.retryCount} for workshop ID: ${workshopId}`);
        
        // Clean up partial downloads before retry (except first attempt)
        if (attempt > 1) {
          const partialPath = path.join(downloadPath, 'steamapps');
          if (fs.existsSync(partialPath)) {
            try {
              await fs.remove(partialPath);
              console.log('🧹 Cleaned up partial download');
            } catch (cleanError) {
              console.warn('Failed to clean up:', cleanError.message);
            }
          }
        }
        
        const result = await this.downloadWorkshopItem(workshopId, downloadPath, appId);
        
        if (result.success && result.path && fs.existsSync(result.path)) {
          const files = fs.readdirSync(result.path);
          if (files.length > 0) {
            console.log(`\n✅ Download successful on attempt ${attempt} using method: ${result.method}`);
            return result;
          }
        }
        
        throw new Error('Download verification failed');
        
      } catch (error) {
        lastError = error;
        console.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        
        // Don't retry if Steam Guard is required - user needs to take action
        if (error.message.includes('STEAM_GUARD_REQUIRED')) {
          throw error;
        }
        
        if (attempt < this.retryCount) {
          const delay = this.retryDelay * attempt;
          console.log(`⏳ Waiting ${delay/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Failed after ${this.retryCount} attempts. Last error: ${lastError.message}`);
  }

  // ====== Manual Steam Guard setup ======
  async setupSteamGuard(steamGuardCode) {
    try {
      console.log('🔐 Setting up Steam Guard authentication...');
      await this.authenticateAndSaveSession(steamGuardCode);
      console.log('✅ Steam Guard setup completed successfully');
      console.log('📝 Session saved - you should not need to enter Steam Guard again for ~30 days');
      return true;
    } catch (error) {
      console.error('❌ Steam Guard setup failed:', error);
      throw error;
    }
  }

  // Get session status
  getSessionStatus() {
    return {
      username: this.steamUsername,
      sessionValid: this.sessionValid,
      lastChecked: this.lastSessionCheck ? new Date(this.lastSessionCheck).toISOString() : null,
      steamDir: this.steamDir,
      configExists: fs.existsSync(path.join(this.configPath, 'config.vdf')),
      sessionLockExists: fs.existsSync(this.sessionLockFile)
    };
  }

  // Clear session (force re-authentication)
  async clearSession() {
    try {
      this.sessionValid = false;
      this.lastSessionCheck = 0;
      
      if (fs.existsSync(this.sessionLockFile)) {
        await fs.remove(this.sessionLockFile);
      }
      
      console.log('🧹 Session cleared - will need to re-authenticate');
    } catch (error) {
      console.error('Error clearing session:', error);
    }
  }

  // Check workshop item accessibility
  async checkWorkshopItem(workshopId) {
    try {
      const workshopUrl = `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`;
      const response = await axios.get(workshopUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      
      const pageContent = response.data;
      
      return {
        isValid: !pageContent.includes('The specified item does not exist') &&
                 !pageContent.includes('This item is unavailable'),
        isPrivate: pageContent.includes('This item is only visible to you'),
        requiresSubscription: pageContent.includes('Subscribe to download'),
        accessible: !pageContent.includes('private') && 
                   !pageContent.includes('Access Denied')
      };
      
    } catch (error) {
      return {
        isValid: false,
        isPrivate: false,
        requiresSubscription: false,
        accessible: false,
        error: error.message
      };
    }
  }

  // Cleanup
  async cleanup(downloadPath) {
    try {
      if (fs.existsSync(downloadPath)) {
        await fs.remove(downloadPath);
        console.log(`🧹 Cleaned up: ${downloadPath}`);
      }
    } catch (error) {
      console.error('Cleanup error:', error.message);
    }
  }
}

module.exports = AdvancedSteamDownloader;