import { logger } from "../lib/logger";

const MAILERSEND_API_URL = "https://api.mailersend.com/v1/email";

const FROM_EMAIL =
  process.env["MAILERSEND_FROM_EMAIL"] ||
  "noreply@test-ywj2lpn007jg7oqz.mlsender.net";
const FROM_NAME = "OXIER";

async function sendViaMailerSend(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env["MAILERSEND_API_KEY"];
  if (!apiKey) {
    logger.warn({ to: params.to }, "MAILERSEND_API_KEY not set — email skipped (set it in .env)");
    return;
  }

  try {
    const res = await fetch(MAILERSEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: params.to }],
        subject: params.subject,
        html: params.html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, "MailerSend API error");
    } else {
      logger.info({ to: params.to, subject: params.subject }, "Email sent via MailerSend");
    }
  } catch (err) {
    logger.error({ err }, "Failed to send email via MailerSend");
  }
}

function buildOxierEmailHtml(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OXIER Verification</title>
</head>
<body style="margin:0;padding:0;background:#04060C;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#04060C;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" style="max-width:480px;background:#0A0E18;border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:28px;font-weight:900;letter-spacing:2px;color:#F0F6FC;font-family:'Courier New',monospace;">
                O<span style="color:#00E676;text-shadow:0 0 20px rgba(0,230,118,0.6);">X</span>IER
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <!-- Icon -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="width:64px;height:64px;background:rgba(0,230,118,0.1);border-radius:18px;border:1px solid rgba(0,230,118,0.2);text-align:center;vertical-align:middle;font-size:28px;">
                    🔐
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#F0F6FC;">
                Verify your email
              </p>
              <p style="margin:0 0 28px;font-size:14px;color:rgba(240,246,252,0.55);line-height:1.6;">
                Enter this code in the OXIER app to complete your verification.
                It expires in <strong style="color:#F0F6FC;">10 minutes</strong>.
              </p>

              <!-- OTP Code -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="background:rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.25);border-radius:16px;padding:24px;text-align:center;">
                    <span style="font-family:'Courier New',monospace;font-size:42px;font-weight:900;letter-spacing:14px;color:#00E676;text-shadow:0 0 20px rgba(0,230,118,0.4);">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:13px;color:rgba(240,246,252,0.35);line-height:1.6;">
                If you didn't create an OXIER account, you can safely ignore this email.
                Never share this code with anyone.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:11px;color:rgba(240,246,252,0.25);letter-spacing:1px;text-transform:uppercase;">
                © OXIER · Binary Options Trading
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildRejectionHtml(txId: string, reason: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Transaction Update</title></head>
<body style="margin:0;padding:0;background:#04060C;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#04060C;min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table width="100%" style="max-width:480px;background:#0A0E18;border-radius:20px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
              <span style="font-size:28px;font-weight:900;letter-spacing:2px;color:#F0F6FC;font-family:'Courier New',monospace;">
                O<span style="color:#00E676;">X</span>IER
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="width:64px;height:64px;background:rgba(255,61,87,0.12);border-radius:18px;border:1px solid rgba(255,61,87,0.25);text-align:center;vertical-align:middle;font-size:28px;">
                    ❌
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#F0F6FC;">Transaction Rejected</p>
              <p style="margin:0 0 20px;font-size:14px;color:rgba(240,246,252,0.55);">
                Transaction <strong style="color:#F0F6FC;font-family:'Courier New',monospace;">#${txId}</strong> has been rejected.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                  <td style="background:rgba(255,61,87,0.08);border:1px solid rgba(255,61,87,0.2);border-radius:12px;padding:16px;">
                    <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:rgba(240,246,252,0.35);letter-spacing:1px;text-transform:uppercase;">Reason</p>
                    <p style="margin:0;font-size:14px;color:#FF3D57;font-weight:600;">${reason}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:rgba(240,246,252,0.35);">
                Please contact our support team if you believe this is an error.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
              <p style="margin:0;font-size:11px;color:rgba(240,246,252,0.25);letter-spacing:1px;text-transform:uppercase;">
                © OXIER · Binary Options Trading
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  await sendViaMailerSend({
    to: email,
    subject: `${code} — Your OXIER Verification Code`,
    html: buildOxierEmailHtml(code),
  });
}

export async function sendRejectionEmail(
  email: string,
  reason: string,
  txId: string
): Promise<void> {
  await sendViaMailerSend({
    to: email,
    subject: `Transaction ${txId} Rejected — OXIER`,
    html: buildRejectionHtml(txId, reason),
  });
}
