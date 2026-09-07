require("dotenv").config();
const { sendEmail } = require("../services/emailService");

async function run() {
  console.log("Sending demo email to husnain@maildrop.cc...");
  try {
    const res = await sendEmail({
      to: "husnain@maildrop.cc",
      subject: "Demo Email - PayMate",
      title: "Demo Email - PayMate",
      body: "This is a demo email to verify that the sending functionality works and parameters are correctly passed into the template.",
      actionLink: "https://invoicemate.net",
      actionText: "View Dashboard",
      organizationName: "DeFa",
    });
    console.log("Result:", res);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}
// node scripts/testEmails.js
run();
