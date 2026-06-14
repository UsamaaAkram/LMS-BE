const nodemailer = require("nodemailer");

// SMTP transporter built from environment variables.
// Required env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
// Optional: SMTP_FROM_EMAIL (defaults to SMTP_USER), SMTP_SECURE ("true"/"false")
let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS."
    );
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    // secure=true for 465, false for 587/STARTTLS — overridable via SMTP_SECURE
    secure:
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === "true"
        : port === 465,
    auth: { user, pass },
  });

  return transporter;
}

async function sendMail({ to, subject, html, text }) {
  const from =
    process.env.MAIL_FROM ||
    process.env.SMTP_FROM_EMAIL ||
    process.env.SMTP_USER ||
    "no-reply@bluversedigitalhub.com";
  return getTransporter().sendMail({ from, to, subject, html, text });
}

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
}

async function sendVerificationEmail(to, name, otp) {
  const subject = "Verify your email — Bluverse Digital Hub";
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#333;">
      <h2 style="color:#00bffd;">Bluverse Digital Hub</h2>
      <p>Hi ${name || "there"},</p>
      <p>Welcome to Bluverse! Use the verification code below to confirm your email address:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f5f5f5;padding:12px 16px;border-radius:8px;text-align:center;">
        ${otp}
      </p>
      <p style="color:#888;font-size:13px;">This code expires in 15 minutes. If you didn't sign up, you can ignore this email.</p>
      <p style="margin-top:24px;">— The Bluverse Team</p>
    </div>`;
  return sendMail({
    to,
    subject,
    html,
    text: `Your Bluverse verification code is ${otp}. It expires in 15 minutes.`,
  });
}

async function sendPasswordResetEmail(to, name, otp) {
  const subject = "Reset your password — Bluverse Digital Hub";
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:auto;color:#333;">
      <h2 style="color:#00bffd;">Bluverse Digital Hub</h2>
      <p>Hi ${name || "there"},</p>
      <p>We received a request to reset your password. Use the code below to set a new password:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f5f5f5;padding:12px 16px;border-radius:8px;text-align:center;">
        ${otp}
      </p>
      <p style="color:#888;font-size:13px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="margin-top:24px;">— The Bluverse Team</p>
    </div>`;
  return sendMail({
    to,
    subject,
    html,
    text: `Your Bluverse password reset code is ${otp}. It expires in 15 minutes.`,
  });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  generateOtp,
};
