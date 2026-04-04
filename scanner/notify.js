#!/usr/bin/env node
/**
 * Notification Module
 * Sends email (Gmail SMTP) and SMS (Twilio) alerts when new jobs are found.
 */

import nodemailer from 'nodemailer';

// Email Notifications

function buildEmailHTML(profileName, school, newJobs) {
  const jobRows = newJobs.map(j => {
    const typeColor = j.sourceType === 'government' ? '#3B82F6'
      : j.sourceType === 'nonprofit' ? '#22C55E' : '#FF9F43';
    const typeLabel = j.sourceType === 'government' ? 'Government'
      : j.sourceType === 'nonprofit' ? 'Non-Profit' : 'Private';

    return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;">
        <a href="${j.url}" style="color:#1E293B;font-weight:600;text-decoration:none;font-size:15px;">${j.title}</a>
        <div style="color:#64748B;font-size:13px;margin-top:2px;">${j.company}</div>
        ${j.description ? `<div style="color:#94A3B8;font-size:12px;margin-top:4px;">${j.description.slice(0, 150)}...</div>` : ''}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;text-align:right;white-space:nowrap;">
        <span style="background:${typeColor}15;color:${typeColor};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;">${typeLabel}</span>
        <div style="color:#94A3B8;font-size:11px;margin-top:4px;">${j.source}</div>
      </td>
    </tr>`;
  }).join('');

  return `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#667eea,#764ba2);border-radius:16px 16px 0 0;padding:24px 24px 20px;text-align:center;">
        <div style="font-size:28px;margin-bottom:8px;">&#127919;</div>
        <h1 style="color:#fff;font-size:20px;margin:0;">New Job Alerts</h1>
        <p style="color:rgba(255,255,255,.8);font-size:14px;margin:4px 0 0;">${profileName} &middot; ${school}</p>
      </div>
      <div style="background:#fff;border-radius:0 0 16px 16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.06);">
        <div style="padding:16px 16px 8px;">
          <p style="color:#64748B;font-size:14px;margin:0;">
            We found <strong style="color:#1E293B;">${newJobs.length} new listing${newJobs.length > 1 ? 's' : ''}</strong> since our last scan.
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          ${jobRows}
        </table>
        <div style="padding:16px;text-align:center;">
          <p style="color:#94A3B8;font-size:12px;margin:0;">
            Scanned on ${new Date().toLocaleDateString('en-CA', { weekday:'long', year:'numeric', month:'long', day:'numeric' })} at ${new Date().toLocaleTimeString('en-CA', { hour:'2-digit', minute:'2-digit' })}
          </p>
        </div>
      </div>
      <p style="text-align:center;color:#94A3B8;font-size:11px;margin-top:16px;">
        Student Job Finder &middot; Built by Jordan for the team
      </p>
    </div>
  </body>
  </html>`;
}

async function sendEmail(config, profileId, profileName, school, newJobs) {
  const emailConfig = config.notifications.email;
  if (!emailConfig.enabled) {
    console.log('  Email notifications disabled');
    return;
  }

  const recipients = emailConfig.recipients[profileId];
  if (!recipients || recipients.length === 0) {
    console.log(`  No email recipients configured for ${profileId}`);
    return;
  }

  const smtpUser = emailConfig.senderEmail || process.env.SMTP_EMAIL;
  const smtpPass = emailConfig.senderPassword || process.env.SMTP_PASSWORD;

  if (!smtpUser || !smtpPass) {
    console.log('  Email: No SMTP credentials configured, skipping');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass }
  });

  const html = buildEmailHTML(profileName, school, newJobs);
  const subject = `${newJobs.length} new job${newJobs.length > 1 ? 's' : ''} found for ${profileName}`;

  try {
    await transporter.sendMail({
      from: `"Student Job Finder" <${smtpUser}>`,
      to: recipients.join(', '),
      subject,
      html
    });
    console.log(`  Email sent to ${recipients.join(', ')}`);
  } catch (err) {
    console.error(`  Email error: ${err.message}`);
  }
}

// SMS Notifications

async function sendSMS(config, profileId, profileName, newJobs) {
  const smsConfig = config.notifications.sms;
  if (!smsConfig.enabled) {
    console.log('  SMS notifications disabled');
    return;
  }

  const recipients = smsConfig.recipients[profileId];
  if (!recipients || recipients.length === 0) {
    console.log(`  No SMS recipients configured for ${profileId}`);
    return;
  }

  const accountSid = smsConfig.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID;
  const authToken = smsConfig.twilioAuthToken || process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = smsConfig.twilioPhoneNumber || process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.log('  SMS: No Twilio credentials configured, skipping');
    return;
  }

  let twilio;
  try {
    twilio = (await import('twilio')).default;
  } catch (err) {
    console.log('  SMS: Twilio package not installed, skipping');
    return;
  }

  const client = twilio(accountSid, authToken);

  const topJobs = newJobs.slice(0, 3);
  const jobList = topJobs.map(j => `- ${j.title} (${j.company})`).join('\n');
  const more = newJobs.length > 3 ? `\n+ ${newJobs.length - 3} more` : '';
  const body = `Job Alert (${profileName}):\n${newJobs.length} new listing${newJobs.length > 1 ? 's' : ''} found!\n\n${jobList}${more}\n\nCheck your Job Finder app for details.`;

  for (const to of recipients) {
    try {
      await client.messages.create({ body, from: fromNumber, to });
      console.log(`  SMS sent to ${to}`);
    } catch (err) {
      console.error(`  SMS error for ${to}: ${err.message}`);
    }
  }
}

// Main Export

export async function sendNotifications(allNewJobs, config) {
  for (const [profileId, { profile, jobs }] of Object.entries(allNewJobs)) {
    console.log(`\nNotifying for ${profile.name}: ${jobs.length} new jobs`);
    await sendEmail(config, profileId, profile.name, profile.school, jobs);
    await sendSMS(config, profileId, profile.name, jobs);
  }
}

// Allow running standalone for testing
if (process.argv[1]?.includes('notify.js')) {
  console.log('Notification module loaded. Use via scan.js or import sendNotifications().');
}
