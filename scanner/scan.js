#!/usr/bin/env node
/**
 * Student Job Scanner
 * Scans multiple job sources for student-relevant positions,
 * updates the job data files, and triggers notifications for new listings.
 *
 * Usage:
 *   node scan.js                 # Scan all profiles
 *   node scan.js --profile papm  # Scan one profile
 *   node scan.js --dry-run       # Scan but don't write or notify
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
const CONFIG_PATH = join(ROOT, 'config.json');

// Helpers

function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

function loadExistingJobs(profile) {
  const path = join(DATA_DIR, `${profile}-jobs.json`);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf-8'));
  }
  return { lastScan: null, jobs: [] };
}

function saveJobs(profile, data) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const path = join(DATA_DIR, `${profile}-jobs.json`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  Saved ${data.jobs.length} jobs to ${path}`);
}

function deduplicateJobs(jobs) {
  const seen = new Map();
  for (const job of jobs) {
    const key = (job.title + '|' + job.company).toLowerCase().trim();
    if (!seen.has(key)) {
      seen.set(key, job);
    }
  }
  return [...seen.values()];
}

function filterByKeywords(jobs, keywords, excludeKeywords) {
  return jobs.filter(job => {
    const text = `${job.title} ${job.description} ${job.company}`.toLowerCase();
    const hasKeyword = keywords.some(k => text.includes(k.toLowerCase()));
    const hasExclude = excludeKeywords.some(k => text.includes(k.toLowerCase()));
    return hasKeyword && !hasExclude;
  });
}

function pruneOldJobs(jobs, maxAgeDays) {
  const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  return jobs.filter(j => {
    if (!j.dateFound) return true;
    return new Date(j.dateFound).getTime() > cutoff;
  });
}

function findNewJobs(existingJobs, scannedJobs) {
  const existingKeys = new Set(
    existingJobs.map(j => (j.title + '|' + j.company).toLowerCase().trim())
  );
  return scannedJobs.filter(j => {
    const key = (j.title + '|' + j.company).toLowerCase().trim();
    return !existingKeys.has(key);
  });
}

// Source: GC Jobs

async function scanGCJobs(searchTerms, location) {
  const fetch = (await import('node-fetch')).default;
  const cheerio = await import('cheerio');
  const jobs = [];

  for (const term of searchTerms) {
    try {
      const params = new URLSearchParams({
        sort: 'score',
        page: '1',
        fkey: term,
        fprov: '35',
        fage: '16384'
      });
      const url = `https://emploisfp-psjobs.cfp-psc.gc.ca/psrs-srfp/applicant/page1710?${params}`;

      console.log(`  GC Jobs: searching "${term}"...`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'StudentJobFinder/1.0 (Educational tool)',
          'Accept': 'text/html',
          'Accept-Language': 'en-CA'
        },
        timeout: 15000
      });

      if (!res.ok) {
        console.warn(`  GC Jobs: HTTP ${res.status} for "${term}", skipping`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      $('a[href*="page1800"]').each((_, el) => {
        const title = $(el).text().trim();
        const link = $(el).attr('href');
        if (title && title.length > 5) {
          jobs.push({
            id: `gc-${Buffer.from(title).toString('base64').slice(0, 16)}`,
            title: title,
            company: 'Government of Canada',
            location: location,
            url: link.startsWith('http') ? link : `https://emploisfp-psjobs.cfp-psc.gc.ca${link}`,
            source: 'GC Jobs',
            sourceType: 'government',
            dateFound: new Date().toISOString(),
            datePosted: null,
            description: '',
            tags: ['government', 'federal', 'student']
          });
        }
      });

      $('.resultJobItem, .job-result, [class*="result"]').each((_, el) => {
        const title = $(el).find('a, .title, h3, h4').first().text().trim();
        const link = $(el).find('a').first().attr('href');
        const dept = $(el).find('.department, .org, .employer').first().text().trim();
        const dateText = $(el).find('.date, .closing, time').first().text().trim();

        if (title && title.length > 5) {
          jobs.push({
            id: `gc-${Buffer.from(title + dept).toString('base64').slice(0, 16)}`,
            title,
            company: dept || 'Government of Canada',
            location,
            url: link ? (link.startsWith('http') ? link : `https://emploisfp-psjobs.cfp-psc.gc.ca${link}`) : '',
            source: 'GC Jobs',
            sourceType: 'government',
            dateFound: new Date().toISOString(),
            datePosted: dateText || null,
            description: '',
            tags: ['government', 'federal', 'student']
          });
        }
      });

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`  GC Jobs error for "${term}":`, err.message);
    }
  }

  return deduplicateJobs(jobs);
}

// Source: Adzuna API

async function scanAdzuna(searchTerms, location, config) {
  const fetch = (await import('node-fetch')).default;
  const { apiId, apiKey } = config.sources.adzuna;
  const jobs = [];

  if (!apiId || !apiKey) {
    console.log('  Adzuna: No API credentials configured, skipping');
    return jobs;
  }

  for (const term of searchTerms) {
    try {
      const params = new URLSearchParams({
        app_id: apiId,
        app_key: apiKey,
        results_per_page: '15',
        what: term,
        where: location,
        sort_by: 'date',
        max_days_old: '14',
        content_type: 'application/json'
      });

      console.log(`  Adzuna: searching "${term}"...`);
      const url = `https://api.adzuna.com/v1/api/jobs/ca/search/1?${params}`;
      const res = await fetch(url, { timeout: 15000 });

      if (!res.ok) {
        console.warn(`  Adzuna: HTTP ${res.status} for "${term}", skipping`);
        continue;
      }

      const data = await res.json();

      if (data.results) {
        for (const r of data.results) {
          jobs.push({
            id: `adz-${r.id || Buffer.from(r.title).toString('base64').slice(0, 16)}`,
            title: r.title || '',
            company: r.company?.display_name || 'Unknown',
            location: r.location?.display_name || location,
            url: r.redirect_url || '',
            source: 'Adzuna',
            sourceType: r.company?.display_name?.toLowerCase().includes('canada') ? 'government' : 'private',
            dateFound: new Date().toISOString(),
            datePosted: r.created || null,
            description: (r.description || '').slice(0, 300),
            salary: r.salary_min ? `$${Math.round(r.salary_min).toLocaleString()} - $${Math.round(r.salary_max).toLocaleString()}` : null,
            tags: ['private-sector']
          });
        }
      }

      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      console.error(`  Adzuna error for "${term}":`, err.message);
    }
  }

  return deduplicateJobs(jobs);
}

// Source: Charity Village (HTML scrape)

async function scanCharityVillage(searchTerms, location) {
  const fetch = (await import('node-fetch')).default;
  const cheerio = await import('cheerio');
  const jobs = [];

  for (const term of searchTerms.slice(0, 3)) {
    try {
      const params = new URLSearchParams({
        keywords: term,
        location: 'Ottawa'
      });

      console.log(`  Charity Village: searching "${term}"...`);
      const url = `https://charityvillage.com/jobs/?${params}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'StudentJobFinder/1.0 (Educational tool)',
          'Accept': 'text/html'
        },
        timeout: 15000
      });

      if (!res.ok) {
        console.warn(`  Charity Village: HTTP ${res.status}, skipping`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      $('[class*="job"], .listing, article').each((_, el) => {
        const title = $(el).find('h2 a, h3 a, .job-title a, .title a').first().text().trim();
        const link = $(el).find('h2 a, h3 a, .job-title a, .title a').first().attr('href');
        const org = $(el).find('.organization, .company, .employer').first().text().trim();
        const loc = $(el).find('.location, .city').first().text().trim();

        if (title && title.length > 5) {
          jobs.push({
            id: `cv-${Buffer.from(title + org).toString('base64').slice(0, 16)}`,
            title,
            company: org || 'Non-Profit Organization',
            location: loc || location,
            url: link ? (link.startsWith('http') ? link : `https://charityvillage.com${link}`) : '',
            source: 'Charity Village',
            sourceType: 'nonprofit',
            dateFound: new Date().toISOString(),
            datePosted: null,
            description: '',
            tags: ['non-profit', 'community']
          });
        }
      });

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`  Charity Village error for "${term}":`, err.message);
    }
  }

  return deduplicateJobs(jobs);
}

// Source: Canada.ca Job RSS Feed

async function scanCanadaRSS(keywords) {
  const fetch = (await import('node-fetch')).default;
  const cheerio = await import('cheerio');
  const jobs = [];

  try {
    console.log('  Canada.ca RSS: fetching feed...');
    const url = 'https://www.canada.ca/content/dam/canada/public-service-commission/migration/psrs-srfp/applicant/xml/jobs-emplois-eng.xml';
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StudentJobFinder/1.0' },
      timeout: 20000
    });

    if (!res.ok) {
      console.warn(`  Canada.ca RSS: HTTP ${res.status}, skipping`);
      return jobs;
    }

    const xml = await res.text();
    const $ = cheerio.load(xml, { xmlMode: true });

    $('item').each((_, el) => {
      const title = $(el).find('title').text().trim();
      const link = $(el).find('link').text().trim();
      const desc = $(el).find('description').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();

      const text = `${title} ${desc}`.toLowerCase();
      const matches = keywords.some(k => text.includes(k.toLowerCase()));

      if (matches && title) {
        jobs.push({
          id: `rss-${Buffer.from(title).toString('base64').slice(0, 16)}`,
          title,
          company: 'Government of Canada',
          location: 'Various',
          url: link,
          source: 'Canada.ca RSS',
          sourceType: 'government',
          dateFound: new Date().toISOString(),
          datePosted: pubDate || null,
          description: desc.slice(0, 300),
          tags: ['government', 'federal']
        });
      }
    });

    console.log(`  Canada.ca RSS: found ${jobs.length} matching jobs`);

  } catch (err) {
    console.error('  Canada.ca RSS error:', err.message);
  }

  return jobs;
}

// Main Scanner

async function scanProfile(profileId, profileConfig, config) {
  console.log(`\nScanning: ${profileConfig.name} (${profileConfig.school})`);
  console.log('─'.repeat(50));

  const allJobs = [];

  if (config.sources.gcJobs.enabled) {
    const gcJobs = await scanGCJobs(profileConfig.searchTerms.gcJobs, profileConfig.location);
    console.log(`  GC Jobs: found ${gcJobs.length} listings`);
    allJobs.push(...gcJobs);
  }

  const rssJobs = await scanCanadaRSS(profileConfig.keywords);
  allJobs.push(...rssJobs);

  if (config.sources.adzuna.enabled) {
    const adzunaJobs = await scanAdzuna(profileConfig.searchTerms.privateApi, profileConfig.location, config);
    console.log(`  Adzuna: found ${adzunaJobs.length} listings`);
    allJobs.push(...adzunaJobs);
  }

  if (config.sources.charityVillage.enabled) {
    const cvJobs = await scanCharityVillage(profileConfig.searchTerms.privateApi, profileConfig.location);
    console.log(`  Charity Village: found ${cvJobs.length} listings`);
    allJobs.push(...cvJobs);
  }

  let processed = deduplicateJobs(allJobs);
  processed = filterByKeywords(processed, profileConfig.keywords, profileConfig.excludeKeywords);

  console.log(`  Total after filtering: ${processed.length} jobs`);

  return processed;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const profileFilter = args.find((a, i) => args[i - 1] === '--profile');

  console.log('='.repeat(50));
  console.log('Student Job Scanner');
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('='.repeat(50));

  const config = loadConfig();
  const profilesToScan = profileFilter
    ? { [profileFilter]: config.profiles[profileFilter] }
    : config.profiles;

  const allNewJobs = {};

  for (const [profileId, profileConfig] of Object.entries(profilesToScan)) {
    if (!profileConfig) {
      console.error(`Profile "${profileId}" not found in config`);
      continue;
    }

    const existing = loadExistingJobs(profileId);
    const scannedJobs = await scanProfile(profileId, profileConfig, config);

    const newJobs = findNewJobs(existing.jobs, scannedJobs);
    console.log(`  NEW jobs found: ${newJobs.length}`);

    const merged = [...existing.jobs, ...newJobs];
    const pruned = pruneOldJobs(merged, config.scanning.maxAgeDays);

    pruned.sort((a, b) => new Date(b.dateFound) - new Date(a.dateFound));

    const output = {
      lastScan: new Date().toISOString(),
      profile: profileId,
      profileName: profileConfig.name,
      school: profileConfig.school,
      totalJobs: pruned.length,
      newJobsThisScan: newJobs.length,
      jobs: pruned
    };

    if (!dryRun) {
      saveJobs(profileId, output);
    } else {
      console.log(`  [DRY RUN] Would save ${pruned.length} jobs`);
    }

    if (newJobs.length > 0) {
      allNewJobs[profileId] = { profile: profileConfig, jobs: newJobs };
    }
  }

  if (!dryRun && Object.keys(allNewJobs).length > 0) {
    console.log('\n' + '='.repeat(50));
    console.log('Sending notifications...');
    try {
      const { sendNotifications } = await import('./notify.js');
      await sendNotifications(allNewJobs, config);
    } catch (err) {
      console.error('Notification error:', err.message);
    }
  } else if (Object.keys(allNewJobs).length === 0) {
    console.log('\nNo new jobs found this scan. No notifications sent.');
  }

  console.log('\n' + '='.repeat(50));
  console.log('Scan complete.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
