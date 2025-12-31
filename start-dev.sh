#!/bin/bash

APP_BACKEND_NAME="DZW-B"
APP_FRONTEND_NAME="DZW-F"

echo "🛑 Stopping old PM2 processes if running..."
pm2 delete $APP_BACKEND_NAME 2>/dev/null
pm2 delete $APP_FRONTEND_NAME 2>/dev/null

echo "🚀 Starting backend (dev mode)..."
pm2 start npm --name "$APP_BACKEND_NAME" -- run dev:server

echo "🚀 Starting frontend (dev mode)..."
pm2 start npm --name "$APP_FRONTEND_NAME" -- run dev

echo "💾 Saving PM2 process list..."
pm2 save

echo "✅ Development system started with PM2!"

echo -e "\n📜 Opening logs...\n"
pm2 logs $APP_BACKEND_NAME $APP_FRONTEND_NAME --lines 50