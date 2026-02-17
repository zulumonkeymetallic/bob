#!/bin/bash
set -e

# Configuration
OPENCLAW_DIR="$HOME/openclaw"
BOB_DIR="$(pwd)"
SKILLS_DIR="$OPENCLAW_DIR/skills"
BOB_SKILL_DIR="$SKILLS_DIR/bob-admin"

echo "🦁 Starting OpenClaw & Bob Integration Setup..."

# 1. Check Pre-requisites
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node v22+."
    exit 1
fi

if ! command -v tailscale &> /dev/null; then
    echo "⚠️ Tailscale is not found. Proceeding, but remote access setup might require manual work."
fi

# 2. Install OpenClaw (Simulated Install - assuming git repo exists or using npx)
if [ -d "$OPENCLAW_DIR" ]; then
    echo "✅ OpenClaw directory exists at $OPENCLAW_DIR"
else
    echo "📥 Installing OpenClaw..."
    # Using a placeholder repo URL based on search context - in reality user might need to adjust
    git clone https://github.com/openclaw/openclaw.git "$OPENCLAW_DIR" || echo "⚠️  Could not clone. Please manually clone OpenClaw to $OPENCLAW_DIR"
    cd "$OPENCLAW_DIR"
    npm install
    cd "$BOB_DIR"
fi

# 3. Configure OpenClaw (openclaw.json)
CONFIG_FILE="$HOME/.openclaw/openclaw.json"
mkdir -p "$(dirname "$CONFIG_FILE")"

# Detect Tailscale IP
TS_IP=$(tailscale ip -4 2>/dev/null || echo "0.0.0.0")
echo "🌐 Detected Tailscale IP: $TS_IP"

# Read Secrets
GEMINI_KEY=$(cat "$HOME/GitHub/secret/oc-gemini" 2>/dev/null || echo "")
OPENAI_KEY=$(cat "$HOME/GitHub/secret/oc-chatgpt" 2>/dev/null || echo "")

if [ -z "$GEMINI_KEY" ] && [ -z "$OPENAI_KEY" ]; then
    echo "⚠️  No API keys found in $HOME/GitHub/secret/. Please configure manually."
fi

if [ ! -f "$CONFIG_FILE" ]; then
    echo "⚙️ Creating default config at $CONFIG_FILE..."
    cat > "$CONFIG_FILE" <<EOF
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "tailscale_ip": "$TS_IP"
  },
  "llm": {
    "provider": "google",
    "model": "gemini-1.5-pro-latest",
    "api_key": "$GEMINI_KEY",
    "fallback": {
      "provider": "openai",
      "model": "gpt-4o",
      "api_key": "$OPENAI_KEY"
    }
  },
  "channels": {
    "whatsapp": {
      "enabled": true,
      "session_path": "./whatsapp_session"
    }
  },
  "skills_path": "$SKILLS_DIR"
}
EOF
else
    echo "ℹ️ Config file exists. Updating keys if missing..."
    # Simple sed replacement or manual check warning
    echo "⚠️  Please manually check $CONFIG_FILE to ensure 'llm' provider keys are set."
fi

# 4. Create 'bob-admin' Skill
echo "🧠 Creating 'bob-admin' skill..."
mkdir -p "$BOB_SKILL_DIR"

cat > "$BOB_SKILL_DIR/skill.json" <<EOF
{
  "name": "bob-admin",
  "version": "1.0.0",
  "description": "Integration with Bob Productivity Platform",
  "tools": [
    {
      "name": "create_bob_task",
      "description": "Create a new task in the Bob system",
      "parameters": {
        "title": { "type": "string", "description": "Title of the task" },
        "due_date": { "type": "string", "description": "Due date (YYYY-MM-DD) or 'today', 'tomorrow'" },
        "persona": { "type": "string", "enum": ["personal", "work"], "default": "personal" }
      },
      "handler": "node $BOB_DIR/scripts/agent_create_task.js"
    },
    {
      "name": "get_bob_summary",
      "description": "Get a summary of today's schedule and high priority tasks",
      "parameters": {},
      "handler": "node $BOB_DIR/scripts/agent_get_summary.js"
    }
  ]
}
EOF

# 5. Create Bridge Scripts in Bob
echo "fZ Creating bridge scripts in $BOB_DIR/scripts/..."

# agent_create_task.js
cat > "$BOB_DIR/scripts/agent_create_task.js" <<EOF
const admin = require('firebase-admin');
const serviceAccount = require('$HOME/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

const args = require('minimist')(process.argv.slice(2));
const title = args.title;
const due = args.due_date || new Date().toISOString();
const persona = args.persona || 'personal';

async function run() {
    if (!title) { console.error('Error: Title required'); process.exit(1); }
    
    // Parse Date logic here (simplified)
    const dueDateObj = new Date(due); 
    
    const docRef = await db.collection('tasks').add({
        title,
        dueDate: dueDateObj.toISOString(),
        persona,
        status: 'todo',
        source: 'agent_claw',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ownerUid: '3L3nnXSuTPfr08c8DTXG5zYX37A2' // Hardcoded for your user, ideally passed in
    });
    
    console.log(JSON.stringify({ success: true, taskId: docRef.id, message: 'Task created' }));
}
run();
EOF

# agent_get_summary.js
cat > "$BOB_DIR/scripts/agent_get_summary.js" <<EOF
const admin = require('firebase-admin');
const serviceAccount = require('$HOME/GitHub/secret/bob20250810-firebase-adminsdk-fbsvc-0f8ac23f94.json');

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

async function run() {
    const today = new Date();
    today.setHours(0,0,0,0);
    
    const snapshot = await db.collection('calendar_blocks')
        .where('ownerUid', '==', '3L3nnXSuTPfr08c8DTXG5zYX37A2')
        .where('start', '>=', today.getTime())
        .orderBy('start')
        .get();
        
    const blocks = snapshot.docs.map(d => ({ title: d.data().title, time: new Date(d.data().start).toLocaleTimeString() }));
    console.log(JSON.stringify({ blocks }));
}
run();
EOF

# 6. Install npm deps for scripts if needed
cd "$BOB_DIR"
npm install minimist || true

echo "✅ Setup Complete!"
echo "---------------------------------------------------"
echo "1. Edit $HOME/.openclaw/openclaw.json to add your API keys."
echo "2. Start OpenClaw: cd $OPENCLAW_DIR && npm start"
echo "3. Scan the WhatsApp QR code when it appears."
echo "4. From your phone, message 'Agent, list my tasks'."
echo "---------------------------------------------------"
