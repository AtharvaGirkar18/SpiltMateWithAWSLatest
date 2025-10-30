#!/bin/bash

# ==============================================
# SplitMate EC2 Setup Script
# Run this script after SSH into fresh EC2 instance
# ==============================================

set -e  # Exit on error

echo "🚀 Starting SplitMate EC2 Setup..."
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "❌ Please don't run as root. Run as ec2-user or ubuntu."
   exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "❌ Cannot detect OS"
    exit 1
fi

echo "✅ Detected OS: $OS"

# Update system
echo ""
echo "📦 Updating system packages..."
if [ "$OS" = "amzn" ]; then
    sudo yum update -y
elif [ "$OS" = "ubuntu" ]; then
    sudo apt update && sudo apt upgrade -y
fi

# Install Git
echo ""
echo "📦 Installing Git..."
if [ "$OS" = "amzn" ]; then
    sudo yum install git -y
elif [ "$OS" = "ubuntu" ]; then
    sudo apt install git -y
fi

# Install Node.js v22
echo ""
echo "📦 Installing Node.js v22..."
if [ "$OS" = "amzn" ]; then
    # Install fnm
    curl -fsSL https://fnm.vercel.app/install | bash
    export PATH="$HOME/.local/share/fnm:$PATH"
    eval "$(fnm env)"
    fnm install 22
    fnm use 22
    
    # Add to bashrc
    echo 'export PATH="$HOME/.local/share/fnm:$PATH"' >> ~/.bashrc
    echo 'eval "$(fnm env)"' >> ~/.bashrc
elif [ "$OS" = "ubuntu" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Verify Node.js installation
NODE_VERSION=$(node --version)
echo "✅ Node.js installed: $NODE_VERSION"

# Install PM2
echo ""
echo "📦 Installing PM2 (Process Manager)..."
sudo npm install -g pm2
pm2 startup | grep "sudo" | sh  # Auto-configure PM2 startup

echo "✅ PM2 installed: $(pm2 --version)"

# Install Nginx
echo ""
echo "📦 Installing Nginx..."
if [ "$OS" = "amzn" ]; then
    sudo yum install nginx -y
elif [ "$OS" = "ubuntu" ]; then
    sudo apt install nginx -y
fi

sudo systemctl enable nginx
echo "✅ Nginx installed"

# Clone repository
echo ""
echo "📦 Cloning SplitMate repository..."
cd ~
if [ -d "SpiltMateWithAWSLatest" ]; then
    echo "⚠️  Repository already exists. Skipping clone."
else
    git clone https://github.com/AtharvaGirkar18/SpiltMateWithAWSLatest.git
    cd SpiltMateWithAWSLatest
    git checkout aws
    echo "✅ Repository cloned"
fi

# Navigate to project
cd ~/SpiltMateWithAWSLatest

# Prompt for environment variables
echo ""
echo "=========================================="
echo "📝 Environment Configuration"
echo "=========================================="
echo ""

read -p "Enter your EC2 Public IP: " EC2_IP
read -p "Enter AWS Access Key ID: " AWS_ACCESS_KEY
read -sp "Enter AWS Secret Access Key: " AWS_SECRET_KEY
echo ""
read -p "Enter PostgreSQL RDS Host: " DB_HOST
read -p "Enter PostgreSQL Password: " DB_PASSWORD

# Create .env file
echo ""
echo "📝 Creating .env file..."
cat > .env << EOF
# MongoDB Atlas
MONGODB_URI=mongodb+srv://node:node@cluster0.yilta.mongodb.net/splitmate

# PostgreSQL RDS
DB_HOST=$DB_HOST
DB_PORT=5432
DB_NAME=splitmate
DB_USER=postgres
DB_PASSWORD=$DB_PASSWORD

# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_KEY
AWS_S3_BUCKET=splitmate-profile-images

# AWS Cognito
COGNITO_DOMAIN=https://us-east-1dnpdmzhmx.auth.us-east-1.amazoncognito.com
COGNITO_CLIENT_ID=27pim7sjr8hgard9l21phj9pt4
COGNITO_CLIENT_SECRET=s3mqikofqcsosv60qides7uvimb4tnpg690s1s7s2i29hvgmc5b
COGNITO_REDIRECT_URI=http://$EC2_IP:3000/auth/callback
COGNITO_LOGOUT_URI=http://$EC2_IP:3000

# Session Secret
SESSION_SECRET=$(openssl rand -base64 32)

# Lambda Debug
LAMBDA_DEBUG=0

# Node Environment
NODE_ENV=production

# Port
PORT=3000
EOF

echo "✅ .env file created"

# Install dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
npm install --production

# Configure Nginx
echo ""
echo "🌐 Configuring Nginx reverse proxy..."
sudo tee /etc/nginx/conf.d/splitmate.conf > /dev/null << EOF
server {
    listen 80;
    server_name $EC2_IP;

    # Increase body size for file uploads
    client_max_body_size 10M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Test and start Nginx
sudo nginx -t
sudo systemctl start nginx
echo "✅ Nginx configured and started"

# Start application with PM2
echo ""
echo "🚀 Starting SplitMate application..."
pm2 start app.js --name splitmate
pm2 save

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "📊 Application Status:"
pm2 status
echo ""
echo "🌐 Access your app at:"
echo "   http://$EC2_IP"
echo "   http://$EC2_IP:3000 (direct)"
echo ""
echo "📝 Next Steps:"
echo "   1. Update AWS Cognito callback URLs to include:"
echo "      - http://$EC2_IP:3000/auth/callback"
echo "      - http://$EC2_IP:3000"
echo ""
echo "   2. Update MongoDB Atlas Network Access to allow:"
echo "      - EC2 IP: $EC2_IP"
echo ""
echo "   3. Update RDS Security Group to allow inbound on port 5432"
echo ""
echo "   4. Test login at: http://$EC2_IP"
echo ""
echo "📊 Useful Commands:"
echo "   pm2 logs splitmate          - View logs"
echo "   pm2 restart splitmate       - Restart app"
echo "   pm2 stop splitmate          - Stop app"
echo "   sudo systemctl status nginx - Check Nginx"
echo ""
echo "🎉 Happy deploying!"
