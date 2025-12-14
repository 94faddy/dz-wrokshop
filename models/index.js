const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

// Database configuration
const sequelize = new Sequelize({
  database: process.env.DB_NAME || 'dayz_workshop_downloader',
  username: process.env.DB_USERNAME || 'rootdz',
  password: process.env.DB_PASSWORD || '8%N6Hhzq2Za%hfzl',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  dialect: process.env.DB_DIALECT || 'mysql',
  timezone: process.env.DB_TIMEZONE || '+07:00',
  
  pool: {
    max: parseInt(process.env.DB_POOL_MAX) || 10,
    min: parseInt(process.env.DB_POOL_MIN) || 0,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
    idle: parseInt(process.env.DB_POOL_IDLE) || 10000
  },
  
  logging: process.env.DB_LOGGING === 'true' ? console.log : false,
  
  define: {
    timestamps: true,
    underscored: false,
    freezeTableName: true,
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci'
  }
});

// Download History Model
const DownloadHistory = sequelize.define('DownloadHistory', {
  id: {
    type: DataTypes.STRING(50),
    primaryKey: true,
    allowNull: false
  },
  workshopId: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('starting', 'preparing', 'downloading', 'creating_archive', 'completed', 'error', 'cleaned'),
    allowNull: false,
    defaultValue: 'starting'
  },
  progress: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    validate: {
      min: 0,
      max: 100
    }
  },
  startTime: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  completedTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  errorTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  cleanedUpTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  autoCleanedTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  downloadCompletedTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  error: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  fileSize: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  finalDownloadSize: {
    type: DataTypes.BIGINT,
    allowNull: true
  },
  downloadUrl: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  method: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  reason: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  
  // Workshop Info (JSON)
  workshopInfo: {
    type: DataTypes.JSON,
    allowNull: true
  },
  
  // Client Info (JSON)
  clientInfo: {
    type: DataTypes.JSON,
    allowNull: true
  }
}, {
  tableName: 'download_history',
  indexes: [
    { name: 'idx_download_workshopId', fields: ['workshopId'] },
    { name: 'idx_download_status', fields: ['status'] },
    { name: 'idx_download_startTime', fields: ['startTime'] },
    { name: 'idx_download_createdAt', fields: ['createdAt'] }
  ]
});

// User Sessions Model - แก้ไข: ไม่ใช้ unique: true ใน field definition
// ใช้ indexes แทนเพื่อควบคุมชื่อ index ได้
const UserSession = sequelize.define('UserSession', {
  sessionId: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false
  },
  sessionKey: {
    type: DataTypes.STRING(255),
    allowNull: false
    // ไม่ใส่ unique: true ที่นี่ เพราะจะไปกำหนดใน indexes แทน
  },
  ip: {
    type: DataTypes.STRING(45),
    allowNull: false
  },
  country: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  countryCode: {
    type: DataTypes.STRING(3),
    allowNull: true
  },
  city: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  region: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  timezone: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 8),
    allowNull: true
  },
  longitude: {
    type: DataTypes.DECIMAL(11, 8),
    allowNull: true
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  browser: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  os: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  device: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  referer: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  acceptLanguage: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  firstSeen: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  lastSeen: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  totalDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  completedDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  failedDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  totalDataTransferred: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'user_sessions',
  // กำหนด indexes แบบ explicit พร้อมตั้งชื่อ เพื่อป้องกันการสร้างซ้ำ
  indexes: [
    { name: 'idx_user_sessions_sessionKey', unique: true, fields: ['sessionKey'] },
    { name: 'idx_user_sessions_ip', fields: ['ip'] },
    { name: 'idx_user_sessions_country', fields: ['country'] },
    { name: 'idx_user_sessions_firstSeen', fields: ['firstSeen'] },
    { name: 'idx_user_sessions_lastSeen', fields: ['lastSeen'] }
  ]
});

// Admin Sessions Model
const AdminSession = sequelize.define('AdminSession', {
  sessionId: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false
  },
  username: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  },
  loginTime: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  clientIp: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  userAgent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: 'admin_sessions',
  indexes: [
    { name: 'idx_admin_sessions_username', fields: ['username'] },
    { name: 'idx_admin_sessions_expiresAt', fields: ['expiresAt'] },
    { name: 'idx_admin_sessions_isActive', fields: ['isActive'] }
  ]
});

// Login Attempts Model
const LoginAttempt = sequelize.define('LoginAttempt', {
  clientIp: {
    type: DataTypes.STRING(45),
    primaryKey: true,
    allowNull: false
  },
  attemptCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1
  },
  lastAttempt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  isLocked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  lockedUntil: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'login_attempts',
  indexes: [
    { name: 'idx_login_attempts_lastAttempt', fields: ['lastAttempt'] },
    { name: 'idx_login_attempts_isLocked', fields: ['isLocked'] }
  ]
});

// System Stats Model (for caching)
const SystemStats = sequelize.define('SystemStats', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  totalDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  completedDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  failedDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  activeDownloads: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  uniqueUsers: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  totalDataTransferred: {
    type: DataTypes.BIGINT,
    allowNull: false,
    defaultValue: 0
  },
  successRate: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0
  },
  topCountries: {
    type: DataTypes.JSON,
    allowNull: true
  },
  topWorkshopItems: {
    type: DataTypes.JSON,
    allowNull: true
  },
  calculatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'system_stats'
});

// Relationships
DownloadHistory.belongsTo(UserSession, { 
  foreignKey: 'sessionId', 
  targetKey: 'sessionId', 
  as: 'userSession' 
});

UserSession.hasMany(DownloadHistory, { 
  foreignKey: 'sessionId', 
  sourceKey: 'sessionId', 
  as: 'downloads' 
});

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection has been established successfully.');
    
    // =====================================================
    // สำคัญ: การ sync database
    // =====================================================
    // - DB_FORCE_SYNC=true  → ลบและสร้างตารางใหม่ทั้งหมด (ข้อมูลหาย!)
    // - DB_ALTER_SYNC=true  → alter ตารางให้ตรง model (ใช้เฉพาะตอน migrate)
    // - default (ไม่ตั้งค่า) → สร้างตารางถ้ายังไม่มี (ปลอดภัยที่สุด)
    //
    // ใน Production ควรใช้ default เท่านั้น!
    // =====================================================
    
    if (process.env.DB_FORCE_SYNC === 'true') {
      console.log('⚠️  WARNING: Force sync enabled - this will DROP all tables!');
      await sequelize.sync({ force: true });
      console.log('🔄 Database tables have been force synced (all data deleted).');
    } else if (process.env.DB_ALTER_SYNC === 'true') {
      // ใช้ alter เฉพาะเมื่อต้องการ migrate schema เท่านั้น
      // หลังจาก migrate เสร็จแล้วควรปิด
      console.log('⚠️  Alter sync enabled - use only for migrations!');
      await sequelize.sync({ alter: true });
      console.log('🔄 Database tables have been altered.');
    } else {
      // Default: แค่สร้างตารางถ้ายังไม่มี (ไม่ alter) - ปลอดภัยที่สุด
      await sequelize.sync();
      console.log('🔄 Database tables synced (create only, no alter).');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
    return false;
  }
};

// Initialize database
const initializeDatabase = async () => {
  const isConnected = await testConnection();
  if (!isConnected) {
    throw new Error('Failed to connect to database');
  }
  
  console.log('🗄️  Database initialized successfully');
  return sequelize;
};

module.exports = {
  sequelize,
  DownloadHistory,
  UserSession,
  AdminSession,
  LoginAttempt,
  SystemStats,
  testConnection,
  initializeDatabase
};