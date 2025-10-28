#!/bin/bash
# Helper script to build ClipForge with the correct Node version

set -e  # Exit on error

echo "🔧 ClipForge Build Script"
echo "========================="
echo ""

# Load nvm
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  echo "📦 Loading nvm..."
  \. "$NVM_DIR/nvm.sh"
else
  echo "❌ nvm not found. Please install nvm first."
  echo "   Visit: https://github.com/nvm-sh/nvm#install--update-script"
  exit 1
fi

# Check if Node 20 is installed
if ! nvm ls 20 &> /dev/null; then
  echo "📥 Node 20 not found. Installing..."
  nvm install 20
fi

# Use Node 20
echo "🔄 Switching to Node 20..."
nvm use 20

# Show versions
echo ""
echo "✅ Node: $(node --version)"
echo "✅ npm: $(npm --version)"
echo ""

# Build based on argument
if [ "$1" == "dist" ]; then
  echo "🏗️  Building distribution package..."
  npm run build
  npm run dist
  echo ""
  echo "✅ Distribution build complete!"
  echo "📦 Check the dist/ folder for installers"
elif [ "$1" == "dev" ]; then
  echo "🚀 Starting development mode..."
  npm run dev
else
  echo "🏗️  Building app..."
  npm run build
  echo ""
  echo "✅ Build complete!"
  echo ""
  echo "To run the app:"
  echo "  npm run dev         # Development mode"
  echo "  npm run dist        # Build distributable"
  echo ""
  echo "Or use this script:"
  echo "  ./build.sh dev      # Start dev mode"
  echo "  ./build.sh dist     # Build distributable"
fi

