#!/bin/bash

APP_BACKEND_NAME="DZW-B"
APP_FRONTEND_NAME="DZW-F"

echo "🛑 Stopping DayZ Workshop Downloader..."

pm2 delete $APP_BACKEND_NAME 2>/dev/null
pm2 delete $APP_FRONTEND_NAME 2>/dev/null

echo "✅ PM2 processes stopped."
