#!/bin/bash
set -e

# Configuration
OPENCLAW_DIR="$HOME/openclaw"
PLIST_NAME="com.openclaw.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"
WRAPPER_SCRIPT="$OPENCLAW_DIR/start_agent.sh"
# Hardcode paths to the installed v22 version
NODE_PATH="$HOME/.nvm/versions/node/v22.22.0/bin/node"
NPM_PATH="$HOME/.nvm/versions/node/v22.22.0/bin/npm"
PNPM_PATH="$HOME/.nvm/versions/node/v22.22.0/bin/pnpm"


echo "🦁 Setting up OpenClaw Auto-Start..."

# 1. Create Wrapper Script (handles environment)
echo "📜 Creating wrapper script at $WRAPPER_SCRIPT..."
cat > "$WRAPPER_SCRIPT" <<EOF
#!/bin/bash
export PATH="$PATH:$(dirname "$NODE_PATH")"
export PNPM_HOME="$(dirname "$PNPM_PATH")"

# Inject API Keys
export GEMINI_API_KEY="\$(cat $HOME/GitHub/secret/oc-gemini)"
export OPENAI_API_KEY="\$(cat $HOME/GitHub/secret/oc-chatgpt)"

cd "$OPENCLAW_DIR"
"$NPM_PATH" start -- gateway >> "$OPENCLAW_DIR/agent.log" 2>&1
EOF
chmod +x "$WRAPPER_SCRIPT"

# 2. Create LaunchAgent Plist
echo "⚙️  Creating LaunchAgent at $PLIST_PATH..."
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$WRAPPER_SCRIPT</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$OPENCLAW_DIR/agent.log</string>
    <key>StandardErrorPath</key>
    <string>$OPENCLAW_DIR/agent.log</string>
    <key>WorkingDirectory</key>
    <string>$OPENCLAW_DIR</string>
</dict>
</plist>
EOF

# 3. Load the Service
echo "🚀 Loading service..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo "✅ OpenClaw is now set to run automatically on login!"
echo "📄 Logs are available at: $OPENCLAW_DIR/agent.log"
echo "🛑 To stop manually: launchctl unload $PLIST_PATH"
