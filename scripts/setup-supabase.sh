#!/bin/bash
# Setup script for Supabase local development
# This script checks for Supabase CLI and initializes the project

set -e

echo "🔍 Checking for Supabase CLI..."

if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found"
    echo ""
    echo "📦 Installing Supabase CLI..."
    echo ""
    echo "Choose installation method:"
    echo "  1) npm (recommended)"
    echo "  2) Homebrew (macOS/Linux)"
    echo "  3) Skip installation"
    echo ""
    read -p "Enter choice [1-3]: " choice

    case $choice in
        1)
            npm install -g supabase
            ;;
        2)
            brew install supabase/tap/supabase
            ;;
        3)
            echo "⏭️  Skipping installation"
            echo "Please install Supabase CLI manually:"
            echo "  npm install -g supabase"
            echo "  or"
            echo "  brew install supabase/tap/supabase"
            exit 1
            ;;
        *)
            echo "Invalid choice"
            exit 1
            ;;
    esac
fi

echo "✅ Supabase CLI found: $(supabase --version)"

# Check if Supabase is already initialized
if [ -d "supabase" ] && [ -f "supabase/config.toml" ]; then
    echo "✅ Supabase already initialized"
else
    echo "🔧 Initializing Supabase..."
    supabase init
fi

# Check if Supabase is running
if supabase status &> /dev/null; then
    echo "✅ Supabase is running"
    supabase status
else
    echo "🚀 Starting Supabase..."
    supabase start

    echo ""
    echo "📋 Supabase Configuration:"
    echo ""
    supabase status

    echo ""
    echo "💡 Add these to your .env.local file:"
    echo ""
    supabase status | grep -E "(API URL|anon key)" | sed 's/^/   /'
    echo ""
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Copy the API URL and anon key to .env.local"
echo "  2. Migrations will be automatically applied on startup"
echo "  3. Access Supabase Studio at http://localhost:54323"

