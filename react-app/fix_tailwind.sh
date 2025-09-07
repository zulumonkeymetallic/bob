#!/bin/bash
set -e

echo "📦 Installing Tailwind + PostCSS..."
npm install -D tailwindcss @tailwindcss/postcss postcss autoprefixer

echo "📝 Creating/overwriting postcss.config.js..."
cat > postcss.config.js <<'EOF'
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
EOF

echo "📝 Creating tailwind.config.js (content set to ./src/**/*.{js,jsx,ts,tsx})..."
# npx tailwindcss init -p
# Overwrite with good defaults
cat > tailwind.config.js <<'EOF'
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
EOF

echo "🔧 Updating src/index.css (will create if missing)..."
mkdir -p src
cat > src/index.css <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF

echo "🛠 Running npm audit fix..."
npm audit fix || true

echo "✅ Setup done. Try: npm run build"
