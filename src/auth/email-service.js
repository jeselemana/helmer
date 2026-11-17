import fs from "node:fs/promises";
import path from "node:path";
import nodemailer from "nodemailer";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

export class PasswordResetEmailService {
  constructor({ dataDir, env = process.env } = {}) {
    this.dataDir = dataDir;
    this.env = env;
    this.transport = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: String(env.SMTP_SECURE || "false") === "true",
          auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD || env.SMTP_PASS } : undefined,
        })
      : null;
  }

  async sendWithResend({ to, subject, text, html, replyTo }) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "helmer/1.0",
      },
      body: JSON.stringify({
        from: this.env.EMAIL_FROM || "Helmer <onboarding@resend.dev>",
        to: [to],
        subject,
        text,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Resend email delivery failed (${response.status})`);
    }
  }

  async deliver({ to, subject, text, html, replyTo }) {
    if (this.env.RESEND_API_KEY) return this.sendWithResend({ to, subject, text, html, replyTo });
    if (this.transport) {
      await this.transport.sendMail({
        from: this.env.EMAIL_FROM || "Helmer <no-reply@helmeros.com>",
        to,
        subject,
        text,
        html,
        replyTo,
      });
      return;
    }
    if (this.env.NODE_ENV !== "test") throw new Error("Email transport is not configured.");
    const outboxPath = path.join(this.dataDir, "email-outbox.json");
    await fs.mkdir(this.dataDir, { recursive: true });
    let outbox = [];
    try { outbox = JSON.parse(await fs.readFile(outboxPath, "utf8")); } catch {}
    outbox.push({ to, replyTo, subject, text, html, createdAt: new Date().toISOString() });
    await fs.writeFile(outboxPath, `${JSON.stringify(outbox, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async sendEmailVerificationCode({ email, fullName, code }) {
    const subject = "Helmer e-poçt təsdiqi";
    const text = `Salam ${fullName},\n\nHelmer hesabını təsdiqləmək üçün kodun: ${code}\n\nKod 10 dəqiqə ərzində etibarlıdır. Bu sorğunu sən etməmisənsə, mesajı nəzərə alma.`;
    const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;color:#171b24;font-family:Inter,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:40px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e4e7ec;border-radius:16px"><tr><td style="padding:34px"><div style="font-weight:700;margin-bottom:32px">Helmer</div><h1 style="margin:0 0 12px;font-size:25px">E-poçtunu təsdiqlə</h1><p style="margin:0 0 24px;color:#667085;line-height:1.65">Salam ${escapeHtml(fullName)}, hesabını aktivləşdirmək üçün aşağıdakı kodu daxil et.</p><div style="font-size:32px;letter-spacing:8px;font-weight:700;background:#f3f4f6;border-radius:10px;padding:16px;text-align:center">${escapeHtml(code)}</div><p style="margin:24px 0 0;color:#98a2b3;font-size:12px;line-height:1.6">Kod 10 dəqiqə ərzində etibarlıdır. Sorğunu sən etməmisənsə, mesajı nəzərə alma.</p></td></tr></table></td></tr></table></body></html>`;
    await this.deliver({ to: email, subject, text, html });
  }

  async sendPasswordResetEmail({ email, fullName, resetUrl }) {
    const subject = "Helmer şifrəsini yenilə";
    const text = `Salam ${fullName},\n\nHelmer şifrəsini yeniləmək üçün bu keçiddən istifadə et:\n${resetUrl}\n\nKeçid 20 dəqiqə ərzində etibarlıdır və yalnız bir dəfə işləyir. Bu sorğunu sən etməmisənsə, mesajı nəzərə alma.`;
    const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;color:#171b24;font-family:Inter,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:40px 16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e4e7ec;border-radius:16px"><tr><td style="padding:34px"><div style="font-weight:700;margin-bottom:32px">Helmer</div><h1 style="margin:0 0 12px;font-size:25px;letter-spacing:-.5px">Şifrəni yenilə</h1><p style="margin:0 0 24px;color:#667085;line-height:1.65">Salam ${escapeHtml(fullName)}, Helmer hesabının şifrəsini yeniləmək üçün aşağıdakı düymədən istifadə et.</p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#111827;color:#fff;text-decoration:none;font-size:14px;font-weight:600">Şifrəni yenilə</a><p style="margin:24px 0 0;color:#98a2b3;font-size:12px;line-height:1.6">Bu keçid 20 dəqiqə ərzində etibarlıdır və yalnız bir dəfə işləyir. Sorğunu sən etməmisənsə, bu mesajı nəzərə alma.</p></td></tr></table></td></tr></table></body></html>`;
    await this.deliver({ to: email, subject, text, html });
  }

  async sendLegalReportEmail({
    issueType,
    description,
    userEmail,
    userName,
    userId,
    model,
    messageContent,
    timestamp = new Date().toISOString(),
    userAgent,
    ip,
  }) {
    const recipient = this.env.LEGAL_REPORT_EMAIL?.trim();
    if (!recipient) throw new Error("LEGAL_REPORT_EMAIL is required.");
    const subject = `[Helmer] Hüquqi Problem Bildirişi: ${issueType || "Ümumi"}`;
    const text = `Helmer - Yeni Hüquqi Problem Bildirişi\n\n`
      + `Tarix: ${timestamp}\n`
      + `Problem Növü: ${issueType || "Qeyd edilməyib"}\n`
      + `İstifadəçi: ${userName || "Anonim"} (${userEmail || "Qeyd edilməyib"})\n`
      + `İstifadəçi ID / Sessiya: ${userId || "Məlum deyil"}\n`
      + `Model: ${model || "Məlum deyil"}\n`
      + `IP Ünvanı: ${ip || "Məlum deyil"}\n`
      + `User Agent: ${userAgent || "Məlum deyil"}\n\n`
      + `--- Şikayət / Təsvir ---\n${description}\n\n`
      + `--- İstinad edilən AI Cavabı ---\n${messageContent || "(Cavab konteksti yoxdur)"}\n`;

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin:0; background:#f4f6f8; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; color:#1e293b; }
    .container { max-width:620px; margin:30px auto; background:#ffffff; border-radius:14px; border:1px solid #e2e8f0; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.05); }
    .header { background:#0f172a; padding:24px 32px; color:#ffffff; }
    .badge { display:inline-block; padding:4px 10px; background:#ef4444; color:#fff; border-radius:6px; font-size:12px; font-weight:600; text-transform:uppercase; margin-bottom:8px; }
    .title { font-size:20px; font-weight:700; margin:0; color:#ffffff; }
    .content { padding:32px; font-size:14px; line-height:1.6; }
    .section-title { font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px; color:#64748b; margin:20px 0 8px; }
    .card-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:16px; white-space:pre-wrap; word-break:break-word; }
    .ai-box { background:#f1f5f9; border-left:4px solid #3b82f6; font-size:13px; color:#334155; max-height:300px; overflow-y:auto; }
    .meta-table { width:100%; border-collapse:collapse; margin-bottom:16px; }
    .meta-table td { padding:6px 0; font-size:13px; border-bottom:1px solid #f1f5f9; }
    .meta-table td.label { color:#64748b; width:130px; font-weight:500; }
    .meta-table td.value { color:#0f172a; font-weight:600; }
    .footer { padding:20px 32px; background:#f8fafc; border-top:1px solid #e2e8f0; font-size:12px; color:#94a3b8; text-align:center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="badge">Hüquqi Bildiriş</div>
      <h1 class="title">Helmer Hüquqi Problem Bildirişi</h1>
    </div>
    <div class="content">
      <table class="meta-table">
        <tr><td class="label">Problem Növü:</td><td class="value">${escapeHtml(issueType || "Ümumi")}</td></tr>
        <tr><td class="label">Tarix:</td><td class="value">${escapeHtml(timestamp)}</td></tr>
        <tr><td class="label">İstifadəçi:</td><td class="value">${escapeHtml(userName || "Anonim")}</td></tr>
        <tr><td class="label">Email:</td><td class="value">${userEmail ? `<a href="mailto:${escapeHtml(userEmail)}">${escapeHtml(userEmail)}</a>` : "Qeyd edilməyib"}</td></tr>
        <tr><td class="label">Model:</td><td class="value">${escapeHtml(model || "Məlum deyil")}</td></tr>
        <tr><td class="label">İstifadəçi ID:</td><td class="value">${escapeHtml(userId || "Qonaq")}</td></tr>
        <tr><td class="label">IP / Şəbəkə:</td><td class="value">${escapeHtml(ip || "Məlum deyil")}</td></tr>
      </table>

      <div class="section-title">İstifadəçinin Şikayəti / Təsvir:</div>
      <div class="card-box" style="border-left:4px solid #ef4444; font-weight:500;">${escapeHtml(description)}</div>

      <div class="section-title">İstinad Edilən AI Cavabı:</div>
      <div class="card-box ai-box">${escapeHtml(messageContent || "(Cavab mətni yoxdur)")}</div>
    </div>
    <div class="footer">
      Bu bildiriş Helmer cavab generasiyası ekranından avtomatik göndərilmişdir.
    </div>
  </div>
</body>
</html>`;

    if (this.env.RESEND_API_KEY) {
      await this.sendWithResend({ to: recipient, subject, text, html, replyTo: userEmail || undefined });
      return;
    }

    if (this.transport) {
      await this.transport.sendMail({
        from: this.env.EMAIL_FROM || "Helmer Legal <no-reply@helmeros.com>",
        to: recipient,
        replyTo: userEmail || undefined,
        subject,
        text,
        html,
      });
      return;
    }

    if (this.env.NODE_ENV !== "test") {
      throw new Error("Email transport is not configured.");
    }

    const outboxPath = path.join(this.dataDir, "email-outbox.json");
    await fs.mkdir(this.dataDir, { recursive: true });
    let outbox = [];
    try { outbox = JSON.parse(await fs.readFile(outboxPath, "utf8")); } catch {}
    outbox.push({ to: recipient, replyTo: userEmail || undefined, subject, text, html, createdAt: timestamp });
    await fs.writeFile(outboxPath, `${JSON.stringify(outbox, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
