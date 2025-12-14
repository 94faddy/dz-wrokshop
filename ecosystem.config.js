module.exports = {
  apps: [
    {
      name: 'dayz-frontend',
      script: process.env.NODE_ENV === 'production' ? 'npm' : 'npm',
      args: process.env.NODE_ENV === 'production' ? 'run start' : 'run dev',
      cwd: '/root/dayz-workshop-downloader',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3020,
        NEXT_PUBLIC_API_URL: 'http://localhost:8080',
        NEXT_PUBLIC_FRONTEND_URL: 'http://localhost:3020'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3020,
        NEXT_PUBLIC_API_URL: 'https://downloaderapi-dayzworkshop.linkz.ltd',
        NEXT_PUBLIC_FRONTEND_URL: 'https://dayzworkshop.linkz.ltd'
      },
      log_file: '/root/dayz-workshop-downloader/logs/frontend.log',
      out_file: '/root/dayz-workshop-downloader/logs/frontend-out.log',
      error_file: '/root/dayz-workshop-downloader/logs/frontend-error.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      listen_timeout: 10000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s'
    },
    {
      name: 'dayz-backend',
      script: 'server.js',
      cwd: '/root/dayz-workshop-downloader',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '2G',
      ignore_watch: ['node_modules', 'logs', 'downloads', '.next'],
      env: {
        NODE_ENV: 'development',
        PORT: 8080,
        NEXT_PUBLIC_API_URL: 'http://localhost:8080',
        NEXT_PUBLIC_FRONTEND_URL: 'http://localhost:3020'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8080,
        NEXT_PUBLIC_API_URL: 'https://downloaderapi-dayzworkshop.linkz.ltd',
        NEXT_PUBLIC_FRONTEND_URL: 'https://dayzworkshop.linkz.ltd'
      },
      log_file: '/root/dayz-workshop-downloader/logs/backend.log',
      out_file: '/root/dayz-workshop-downloader/logs/backend-out.log',
      error_file: '/root/dayz-workshop-downloader/logs/backend-error.log',
      merge_logs: true,
      time: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 10000,
      listen_timeout: 10000,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s'
    }
  ],

  // Deployment configuration
  deploy: {
    production: {
      user: 'root',
      host: 'your-server-ip',
      ref: 'origin/main',
      repo: 'https://github.com/your-username/dayz-workshop-downloader.git',
      path: '/root/dayz-workshop-downloader',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'ForwardAgent=yes'
    }
  }
};