const nodemailer = require("nodemailer");

/**
 * Standard Email Layout Wrapper (DeFa Purple Premium theme)
 */
const getEmailLayout = ({
  subject,
  message,
  title,
  body,
  actionLink,
  actionText,
  rejectionComment,
  redirectURL,
  loginURL,
  organizationName,
  signature,
  showButton = false,
}) => {
  subject = subject || title || "Notification";
  message = message || body || "";
  redirectURL = redirectURL || actionLink;
  showButton = showButton || !!actionLink;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f8fafc;
      font-family: 'Inter', Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
      color: #334155;
    }
    table {
      border-collapse: collapse !important;
    }
    img {
      border: 0;
      display: block;
    }
    a {
      text-decoration: none;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    .header {
      background-color: #6298FC;
      padding: 40px 20px;
      text-align: center;
    }
    .logo-text {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 1px;
      margin: 0 0 20px 0;
    }
    .logo-text span {
      color: #e2e8f0;
      font-weight: 400;
    }
    .title {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      color: #ffffff;
    }
    .content-area {
      padding: 40px 30px;
    }
    .content-area p {
      font-size: 16px;
      line-height: 1.6;
      color: #475569;
      margin: 0 0 20px 0;
    }
    .comment-box {
      background-color: #fef2f2;
      border-left: 4px solid #ef4444;
      padding: 16px 20px;
      border-radius: 4px;
      margin-bottom: 24px;
    }
    .comment-box strong {
      color: #991b1b;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .comment-box p {
      margin: 8px 0 0 0;
      color: #7f1d1d;
      font-size: 15px;
    }
    .btn-container {
      text-align: center;
      margin: 30px 0;
    }
    .btn {
      background-color: #6298FC;
      color: #ffffff !important;
      padding: 14px 32px;
      border-radius: 6px;
      display: inline-block;
      font-size: 15px;
      font-weight: 600;
      transition: background-color 0.2s;
    }
    .footer {
      background-color: #f1f5f9;
      padding: 30px;
      text-align: center;
      font-size: 14px;
      color: #64748b;
    }
    .footer a {
      color: #6298FC;
      font-weight: 600;
    }
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      color: #64748b;
    }
    .logo-text {
      display: flex;
      justify-content: center;  /* horizontal center */
      align-items: center;      /* vertical center (if height exists) */
    }
    .logo-img {
      height: 40px;
      width: auto;
      object-fit: contain;
    }
  </style>
</head>

<body>
  <div style="background-color: #f8fafc; padding: 40px 0;">
    <table width="100%">
      <tr>
        <td align="center">
          <table class="container">
            
            <!-- Header -->
            <tr>
              <td class="header">
                <!-- Fallback CSS Text Logo -->
                <div class="logo-text">
                  <img src="https://prefunding.invoicemate.net/main-defa-logo.svg" alt="DeFa Logo" class="logo-img" />
                </div>
                <!-- If you upload the generated logo.png to your server, uncomment and use this image tag instead -->
                <h1 class="title">${subject}</h1>
              </td>
            </tr>

            <!-- Content -->
            <tr>
              <td class="content-area">
                ${message}

                ${rejectionComment
      ? `
                    <div class="comment-box">
                      <strong>Comment:</strong>
                      <p>${rejectionComment}</p>
                    </div>`
      : ""
    }

                ${showButton && redirectURL
      ? `
                    <div class="btn-container">
                      <a href="${redirectURL}" class="btn">${actionText || "View Details"}</a>
                    </div>`
      : ""
    }

                <p>
                  For details please 
                  <a href="${loginURL}" style="color: #6298FC; font-weight: 600;">login</a>.
                </p>

                <div class="signature">
                  ${signature || "Regards,<br/>The DeFa Team"}
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td class="footer">
                <p style="margin: 0 0 10px 0;">Thanks for choosing our service.</p>
                <p style="margin: 0;">
                  Need more help? <a href="https://invoicemate.net/">We’re here to help you out</a>
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </div>
</body>
</html>`;
};
/**
 * SMTP Transport (Office365)
 */
const transporter = nodemailer.createTransport({
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD,
  },
});

/**
 * Send Email
 */
const sendEmail = async ({
  to,
  subject,
  html,
  title,
  body,
  actionLink,
  actionText,
  text,
}) => {
  try {
    const finalHtml =
      html || getEmailLayout({ title, body, actionLink, actionText });

    const info = await transporter.sendMail({
      from: process.env.EMAIL_USERNAME,
      to,
      subject,
      text: text || finalHtml.replace(/<[^>]*>?/gm, ""),
      html: finalHtml,
    });

    console.log(`[Email Service] Email sent to ${to}: ${subject}`);
    return { success: true, info };
  } catch (error) {
    console.error(`[Email Service] Error sending email:`, error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendEmail,
};