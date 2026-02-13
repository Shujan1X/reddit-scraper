# Overwatch Reddit Scraper - Cloudflare Worker Version

## 🎯 What This Does

Scrapes **posts AND comments** from r/Overwatch (or any subreddit) using Cloudflare Workers - **NO Reddit API keys needed!**

### ✨ Features:
- ✅ Scrapes posts and comments
- ✅ No API keys required
- ✅ Multiple fallback methods (JSON → RSS → HTML)
- ✅ Downloads data as CSV files
- ✅ Free tier works perfectly
- ✅ Beautiful web interface

## 📁 Files Included

1. **overwatch-worker.js** - Cloudflare Worker backend
2. **overwatch-scraper.html** - Frontend web interface

## 🚀 Setup Instructions

### Step 1: Create a Cloudflare Account

1. Go to https://dash.cloudflare.com/sign-up
2. Sign up for a free account
3. Verify your email

### Step 2: Create a Cloudflare Worker

1. Log into Cloudflare Dashboard
2. Click **"Workers & Pages"** in the left sidebar
3. Click **"Create Application"**
4. Click **"Create Worker"**
5. Give it a name: `overwatch-scraper` (or anything you want)
6. Click **"Deploy"**

### Step 3: Add the Worker Code

1. After deployment, click **"Edit Code"**
2. **Delete ALL the default code** in the editor
3. Copy the entire content of `overwatch-worker.js`
4. Paste it into the editor
5. Click **"Save and Deploy"**

### Step 4: Get Your Worker URL

After deploying, you'll see your worker URL. It looks like:
```
https://overwatch-scraper.YOUR-USERNAME.workers.dev
```

**Copy this URL** - you'll need it!

### Step 5: Set Up the Frontend

1. Open `overwatch-scraper.html` in a text editor
2. Find this line (around line 205):
   ```javascript
   value="YOUR_WORKER_URL_HERE"
   ```
3. Replace `YOUR_WORKER_URL_HERE` with your actual worker URL
4. Save the file

### Step 6: Use the Scraper

**Option A: Open Locally**
- Just double-click `overwatch-scraper.html`
- It will open in your browser

**Option B: Deploy to GitHub Pages (Recommended)**
1. Create a GitHub repository
2. Upload `overwatch-scraper.html` (rename it to `index.html`)
3. Go to Settings → Pages
4. Enable GitHub Pages
5. Your scraper will be live at: `https://YOUR-USERNAME.github.io/repo-name`

## 📖 How to Use

1. Open the HTML page in your browser
2. The worker URL should already be filled in
3. Choose your settings:
   - **Subreddit**: Select from dropdown or add custom
   - **Number of Posts**: How many posts to scrape (1-50)
   - **Comments per Post**: How many comments per post (1-50)
4. Click **"Start Scraping"**
5. Wait for the scraping to complete (30 seconds to 2 minutes)
6. Download your CSV files!

## 📊 What Data You Get

### Posts CSV includes:
- Post ID
- Title
- Author
- Score (upvotes)
- Upvote ratio
- Number of comments
- Created timestamp
- Post URL
- Permalink
- Post text (selftext)
- Whether it's a text or link post
- Post flair
- Domain

### Comments CSV includes:
- Comment ID
- Post title (which post it's from)
- Post URL
- Post ID
- Comment author
- Comment text
- Comment score
- Created timestamp
- Depth (0 = top-level, 1 = reply, etc.)
- Parent comment ID
- Whether comment is by the original poster

## 🔧 Customization

### Change Subreddit
In the HTML, you can add more subreddits to the dropdown:
```html
<option value="YourSubreddit">r/YourSubreddit</option>
```

### Change Limits
You can increase/decrease the max limits in the worker code:
```javascript
const limit = Math.min(100, body.limit || 10); // Change 100 to your max
```

### Add More Data Fields
The worker already extracts most available data. Check the Reddit JSON API for more fields you can add.

## 🐛 Troubleshooting

### "Failed to fetch data from worker"
- Check if your worker URL is correct
- Make sure the worker is deployed
- Check browser console for errors

### "CORS Error"
- The worker has CORS headers enabled
- If you still get errors, make sure you deployed the worker code correctly

### No data returned
- Reddit might be rate-limiting
- Try reducing the number of posts
- Wait a few minutes and try again

### Slow scraping
- Normal! Getting comments from multiple posts takes time
- Scraping 10 posts with 20 comments each can take 1-2 minutes
- Don't close the page while scraping

## 💡 Tips & Best Practices

1. **Start small** - Test with 5 posts first
2. **Don't abuse** - Reddit can rate-limit if you scrape too much
3. **Wait between runs** - Wait at least 2-3 minutes between scrapes
4. **Save your data** - Download CSVs immediately after scraping
5. **Check subreddit rules** - Some subreddits don't allow scraping

## 🆓 Cloudflare Free Tier Limits

- **100,000 requests per day** - More than enough!
- **10ms CPU time per request** - Our worker is fast
- No credit card required for free tier

## 🔄 How It Works

1. **Frontend** sends request to Cloudflare Worker
2. **Worker** tries multiple methods to get data:
   - First: Reddit JSON API (most reliable)
   - Fallback 1: Reddit RSS feed
   - Fallback 2: Old Reddit HTML scraping
   - Fallback 3: New Reddit HTML scraping
3. For each post, worker fetches comments using JSON API
4. **Worker** sends all data back to frontend
5. **Frontend** displays preview and lets you download CSVs

## 📈 Advanced Usage

### Scrape Multiple Subreddits
Modify the worker to accept an array of subreddits:
```javascript
const subreddits = ["Overwatch", "Competitiveoverwatch", "OverwatchUniversity"];
```

### Schedule Daily Scraping
Use Cloudflare Cron Triggers to auto-scrape daily and email results.

### Store in Database
Connect to a database (like MongoDB or PostgreSQL) to store scraped data permanently.

### Add Analytics
Process the data to find:
- Most active posters
- Trending topics
- Sentiment analysis
- Most upvoted content

## 🆚 Why This is Better Than Python Scraper

| Feature | Cloudflare Worker | Python Playwright |
|---------|------------------|-------------------|
| Setup | ✅ Easy | 🔴 Complex |
| Blocking | ❌ Never | ✅ Often |
| Speed | ⚡ Fast | 🐌 Slow |
| Cost | 💰 Free | 💰 Free (but needs PC) |
| API Keys | ❌ Not needed | ✅ Needed for API |
| Build Tools | ❌ Not needed | ✅ Needed (C++) |
| Python 3.14 | ✅ N/A | ❌ Issues |
| Works anywhere | ✅ Cloud | 🔴 Local only |

## 🎓 Learning Resources

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Reddit JSON API](https://github.com/reddit-archive/reddit/wiki/JSON)
- [Web Scraping Best Practices](https://www.scrapingbee.com/blog/web-scraping-best-practices/)

## 📝 Legal Notice

- This scraper is for educational/personal use
- Respect Reddit's Terms of Service
- Don't overload Reddit's servers
- Use scraped data responsibly
- Consider using Reddit's official API for production apps

## ❓ Need Help?

If you run into issues:
1. Check the browser console (F12) for errors
2. Verify your worker is deployed correctly
3. Make sure the worker URL is correct in the HTML
4. Test with a small number of posts first

## 🎉 You're All Set!

You now have a fully functional Reddit scraper that:
- ✅ Works without API keys
- ✅ Never gets blocked
- ✅ Scrapes posts AND comments
- ✅ Exports to CSV
- ✅ Runs on free Cloudflare infrastructure

Happy scraping! 🚀
