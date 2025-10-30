# 📝 EC2 Deployment Quick Reference Card

## 🚨 **CRITICAL: Update BEFORE Deploying**

### **1. AWS Cognito (MUST DO FIRST!)**

```
AWS Console → Cognito → User Pools → App Client → Hosted UI

Add Callback URLs:
  http://<EC2-IP>:3000/auth/callback

Add Sign-out URLs:
  http://<EC2-IP>:3000
```

### **2. MongoDB Atlas**

```
MongoDB Atlas → Network Access → Add IP Address
  Add your EC2 Public IP
```

### **3. RDS Security Group**

```
AWS Console → RDS → Security Group
  Allow inbound: PostgreSQL (5432) from EC2
```

---

## ⚡ **Quick Deploy Commands**

### **SSH into EC2:**

```bash
ssh -i your-key.pem ec2-user@<EC2-IP>
```

### **Install Node.js v22:**

```bash
# Amazon Linux
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
fnm use 22

# Ubuntu
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### **Install PM2 & Nginx:**

```bash
sudo npm install -g pm2
sudo yum install nginx -y    # Amazon Linux
sudo apt install nginx -y     # Ubuntu
```

### **Clone & Setup:**

```bash
cd ~
git clone https://github.com/AtharvaGirkar18/SpiltMateWithAWSLatest.git
cd SpiltMateWithAWSLatest
git checkout aws
npm install --production
```

### **Create .env:**

```bash
nano .env
```

Paste your environment variables, update `COGNITO_REDIRECT_URI` and `COGNITO_LOGOUT_URI` with EC2 IP.

### **Start App:**

```bash
pm2 start app.js --name splitmate
pm2 startup
pm2 save
pm2 logs splitmate
```

### **Configure Nginx:**

```bash
sudo nano /etc/nginx/conf.d/splitmate.conf
```

Paste the Nginx config, test, and start:

```bash
sudo nginx -t
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 🛠️ **Useful PM2 Commands**

```bash
pm2 status                  # Check app status
pm2 logs splitmate          # View real-time logs
pm2 logs splitmate --lines 100  # Last 100 lines
pm2 restart splitmate       # Restart app
pm2 stop splitmate          # Stop app
pm2 delete splitmate        # Remove from PM2
pm2 monit                   # Monitor CPU/Memory
pm2 save                    # Save current process list
```

---

## 🌐 **Nginx Commands**

```bash
sudo systemctl status nginx     # Check status
sudo systemctl start nginx      # Start Nginx
sudo systemctl stop nginx       # Stop Nginx
sudo systemctl restart nginx    # Restart Nginx
sudo nginx -t                   # Test config
sudo tail -f /var/log/nginx/error.log  # View errors
```

---

## 🔄 **Update Deployed Code**

```bash
cd ~/SpiltMateWithAWSLatest
git pull origin aws
npm install --production
pm2 restart splitmate
pm2 logs splitmate
```

---

## 🐛 **Quick Troubleshooting**

### **Cognito redirect fails:**

```bash
# Check Cognito URLs in AWS Console
# Verify .env has correct COGNITO_REDIRECT_URI
pm2 restart splitmate
```

### **MongoDB timeout:**

```bash
# Add EC2 IP to MongoDB Atlas whitelist
# Or use 0.0.0.0/0 (less secure)
```

### **PostgreSQL connection fails:**

```bash
# Check RDS security group allows port 5432
# Verify .env has correct DB_HOST, DB_PASSWORD
```

### **App not starting:**

```bash
pm2 logs splitmate --err
# Check for missing environment variables
# Verify Node.js version: node --version (should be v22.x)
```

### **Port 3000 in use:**

```bash
pm2 stop splitmate
# OR
sudo lsof -i :3000
sudo kill -9 <PID>
```

---

## 📊 **Health Check URLs**

```bash
# Homepage
http://<EC2-IP>

# Direct to Node.js (before Nginx)
http://<EC2-IP>:3000

# Test Cognito login
http://<EC2-IP>/auth/login

# Check if app is running
curl http://localhost:3000
```

---

## 🔐 **Security Checklist**

- [ ] Close port 3000 after Nginx setup (use only 80/443)
- [ ] Use strong `SESSION_SECRET` in .env
- [ ] Don't commit `.env` to git
- [ ] Keep `.pem` key file secure (chmod 400)
- [ ] Setup SSL with Let's Encrypt for HTTPS
- [ ] Restrict SSH (port 22) to your IP only
- [ ] Enable AWS CloudWatch logging

---

## 📁 **Important File Locations**

```
~/SpiltMateWithAWSLatest/     # App directory
~/.env                         # Environment variables
/etc/nginx/conf.d/splitmate.conf  # Nginx config
/var/log/nginx/error.log      # Nginx error logs
~/.pm2/logs/                  # PM2 logs
```

---

## 🎯 **Post-Deployment Steps**

1. [ ] Test authentication flow
2. [ ] Test profile image upload (S3)
3. [ ] Test group creation
4. [ ] Test expense calculation (Lambda)
5. [ ] Setup domain + SSL (optional)
6. [ ] Configure CloudWatch monitoring
7. [ ] Setup automated backups

---

## 📚 **Full Documentation**

- `EC2_DEPLOYMENT_GUIDE.md` - Complete step-by-step guide
- `COGNITO_SETUP_CHECKLIST.md` - Critical Cognito setup
- `PROJECT_SUMMARY.md` - Full architecture overview

---

## 💰 **Monthly Cost**

- EC2 t2.small: ~$17
- RDS db.t3.micro: ~$12
- S3 + Lambda + Cognito: ~$1 (free tier)
- **Total: ~$30-40/month**

---

## 🆘 **Quick Help**

**EC2 not accessible?**
→ Check security group allows HTTP (80) and your IP for SSH (22)

**Cognito errors?**
→ Verify callback URLs in AWS Console match your EC2 IP exactly

**App crashes on start?**
→ `pm2 logs splitmate --err` to see error details

**Can't connect to RDS?**
→ Check RDS security group allows EC2's security group on port 5432

**MongoDB timeout?**
→ Add EC2 IP to MongoDB Atlas Network Access whitelist

---

**🎉 Quick Deploy Time: ~30-45 minutes**

**For detailed instructions, see:** `EC2_DEPLOYMENT_GUIDE.md`
