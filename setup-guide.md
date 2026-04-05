# Student Job Finder: Setup Guide

This guide walks through getting the full system running: the web app, automated job scanning, and email/SMS notifications.

## What you get

| Component | What it does |
|-----------|-------------|
| `index.html` | The web app your kids open in a browser. Shows curated job listings, saved jobs, tips. |
| `scanner/scan.js` | Node.js script that searches GC Jobs, Adzuna, and Charity Village for matching jobs. |
| `scanner/notify.js` | Sends email (Gmail SMTP) and SMS (Twilio) when new jobs are found. |
| `.github/workflows/scan-jobs.yml` | GitHub Actions workflow that runs the scanner twice daily (8 AM and 6 PM ET). |
| `data/*.json` | Job listing data, updated by the scanner and read by the frontend. |
| `config.json` | All settings: search terms, notification recipients, API keys. |

## Step 1: Create a GitHub repository

1. Go to [github.com/new](https://github.com/new) and create a new repository (e.g., `student-job-finder`).
2. Copy the entire `job-finder/` folder contents into the repository.
3. Push to GitHub.

## Step 2: Enable GitHub Pages

1. In your repo, go to **Settings > Pages**.
2. Under **Source**, select **Deploy from a branch**.
3. Select the `main` branch and `/ (root)` folder.
4. Save. Your app will be live at `https://yourusername.github.io/student-job-finder/`.

## Step 3: Configure the scanner

Open `config.json` and fill in the settings.

### Notification recipients

Under `notifications.email.recipients`, add email addresses for each profile:

```json
"recipients": {
  "papm": ["kidname@gmail.com"],
  "cyc": ["otherkid@gmail.com"]
}
```

Do the same for `notifications.sms.recipients` with phone numbers (format: `+1XXXXXXXXXX`).

### Adzuna API (free, optional but recommended)

Adzuna provides private-sector job listings. Their free tier gives 250 requests per month, more than enough for twice-daily scanning.

1. Go to [developer.adzuna.com](https://developer.adzuna.com/) and create an account.
2. Get your **App ID** and **API Key**.
3. Add them to `config.json` under `sources.adzuna.apiId` and `sources.adzuna.apiKey`.

If you skip this, the scanner still works with GC Jobs and Charity Village.

## Step 4: Set up email notifications (Gmail)

You need a Gmail App Password (not your regular Gmail password).

1. Go to [myaccount.google.com/security](https://myaccount.google.com/security).
2. Enable **2-Step Verification** if not already on.
3. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
4. Create an App Password for "Mail" on "Other (Student Job Finder)".
5. Copy the 16-character password.

You can use `hal@thesix.ca` or another Gmail account as the sender.

## Step 5: Set up SMS notifications (Twilio, optional)

1. Create a free account at [twilio.com](https://www.twilio.com/).
2. Twilio gives you a free trial with a phone number and some credits.
3. Note your **Account SID**, **Auth Token**, and **Twilio Phone Number**.
4. During the trial, you need to verify recipient phone numbers at [twilio.com/console/phone-numbers/verified](https://www.twilio.com/console/phone-numbers/verified).

If you skip Twilio, only email notifications will be sent.

## Step 6: Add secrets to GitHub

In your GitHub repo, go to **Settings > Secrets and variables > Actions** and add these secrets:

| Secret name | Value |
|---|---|
| `SMTP_EMAIL` | Your Gmail address (e.g., `hal@thesix.ca`) |
| `SMTP_PASSWORD` | The 16-character App Password from Step 4 |
| `TWILIO_ACCOUNT_SID` | From Twilio dashboard (skip if not using SMS) |
| `TWILIO_AUTH_TOKEN` | From Twilio dashboard (skip if not using SMS) |
| `TWILIO_PHONE_NUMBER` | Your Twilio phone number, e.g. `+14155551234` (skip if not using SMS) |

## Step 7: Test the scanner

You can trigger the scanner manually from GitHub:

1. Go to your repo's **Actions** tab.
2. Select the **Scan for Student Jobs** workflow.
3. Click **Run workflow** > **Run workflow**.
4. Watch the logs. The scanner will search job sources, save results to `data/`, commit the changes, and send notifications.

Or test locally:

```bash
cd scanner
npm install
node scan.js --dry-run    # Test without saving or notifying
node scan.js              # Full run
```

## Step 8: Share with your kids

Send them the GitHub Pages URL. They pick their profile, customize their interests, and see curated job listings that update automatically twice a day. New listings are marked with a "NEW" badge and they get email/SMS alerts.

## Customizing search terms

To add or change what jobs the scanner looks for, edit `config.json` under each profile's `searchTerms` object. The scanner uses these terms to query each job source.

Keywords in the `keywords` array are used to filter results for relevance. Terms in `excludeKeywords` filter out senior or irrelevant positions.

## Architecture overview

```
GitHub Actions (twice daily)
    |
    v
scan.js runs
    |
    +-- Queries GC Jobs (government positions)
    +-- Queries Canada.ca RSS feed
    +-- Queries Adzuna API (private sector)
    +-- Queries Charity Village (non-profit)
    |
    v
Deduplicates, filters, merges with existing data
    |
    +-- Saves to data/papm-jobs.json and data/cyc-jobs.json
    +-- Commits changes to repo (auto-deploys via GitHub Pages)
    +-- Sends email notifications for new listings (Gmail SMTP)
    +-- Sends SMS notifications for new listings (Twilio)
    |
    v
index.html reads from data/*.json and displays curated listings
```

## Costs

| Service | Cost |
|---------|------|
| GitHub Actions | Free (2,000 minutes/month on free tier) |
| GitHub Pages | Free |
| Adzuna API | Free tier (250 requests/month) |
| Gmail SMTP | Free |
| Twilio SMS | Free trial credits, then ~$0.0079/message |

## Troubleshooting

**Scanner finds no jobs:** Check that search terms in `config.json` match real job titles. Run `node scan.js --dry-run` locally to see output.

**Emails not sending:** Verify the Gmail App Password is correct. Check that 2-Step Verification is on. Some Gmail accounts may require enabling "Less secure app access."

**SMS not sending:** Verify recipient numbers are in E.164 format (`+1XXXXXXXXXX`). During Twilio trial, recipients must be verified.

**GitHub Actions failing:** Check the Actions tab for error logs. Common issues: missing secrets, npm install failure, rate limiting from job sources.
