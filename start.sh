#!/bin/bash

APP_BACKEND_NAME="DZW-B"
APP_FRONTEND_NAME="DZW-F"

echo "🛑 Stopping old PM2 processes if running..."
pm2 delete $APP_BACKEND_NAME 2>/dev/null
pm2 delete $APP_FRONTEND_NAME 2>/dev/null

# Build frontend first (สำคัญ! ต้อง build ก่อน start)
echo "🔨 Building Next.js frontend..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Exiting..."
    exit 1
fi

echo "🚀 Starting DayZ Workshop Downloader backend..."
pm2 start npm --name "$APP_BACKEND_NAME" -- run server

echo "🚀 Starting frontend (production mode)..."
pm2 start npm --name "$APP_FRONTEND_NAME" -- run start

echo "💾 Saving PM2 process list..."
pm2 save

echo "✅ Production system started with PM2!"

echo -e "\n📜 Opening logs for $APP_BACKEND_NAME and $APP_FRONTEND_NAME...\n"
pm2 logs $APP_BACKEND_NAME $APP_FRONTEND_NAME --lines 50