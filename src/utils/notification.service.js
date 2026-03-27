const nodemailer = require('nodemailer');
const { sendSMS } = require('../core/twilio.service');
const Template = require('../models/template.model');

// Email Transporter Config - Only create if credentials exist
let transporter;
if (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    try {
        transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: process.env.EMAIL_PORT || 587,
            secure: false, // true for 465, false for others
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false
            }
        });
    } catch (e) {
        console.warn('⚠️ Invalid Email Configuration:', e.message);
    }
} else {
    // Only warn if they are totally missing, to avoid noise if user intentionally didn't set them
    console.log('ℹ️ Email credentials missing or incomplete. Emails will be mocked.');
}

const getTemplate = async (slug, type) => {
    try {
        const template = await Template.findOne({ slug, type, isActive: true });
        return template;
    } catch (err) {
        console.error(`⚠️ Template error for ${slug}: ${err.message}`);
        return null; // Return null so callers can handle fallback
    }
};

const replacePlaceholders = (content, data) => {
    let result = content || '';
    Object.keys(data).forEach(key => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, data[key]);
    });
    return result;
};

exports.sendEmail = async (to, slug, data) => {
    try {
        const template = await getTemplate(slug, 'EMAIL');
        // Even if template is missing, we might want to log it
        if (!template) {
            console.warn(`Template ${slug} not found or inactive.`);
            return;
        }

        // Default data like AppName
        const enhancedData = {
            appName: process.env.APP_NAME || 'HomeKitchen',
            ...data
        };

        const html = replacePlaceholders(template.content, enhancedData);
        const subject = replacePlaceholders(template.subject, enhancedData);

        if (transporter) {
            try {
                const info = await transporter.sendMail({
                    from: process.env.EMAIL_FROM || '"Vendor App" <no-reply@vendorapp.com>',
                    to,
                    subject,
                    html
                });
                console.log('✅ Email sent:', info.messageId);
                return info;
            } catch (mailErr) {
                console.error('❌ Failed to send email via transport:', mailErr.message);
                console.log(`[MOCK EMAIL (Fallback)] To: ${to}, Subject: ${subject}`);
            }
        } else {
            console.log(`[MOCK EMAIL] To: ${to}, Subject: ${subject}`);
            return { messageId: 'mock-email-id' };
        }
    } catch (error) {
        console.error('❌ Error in sendEmail:', error.message);
    }
};

exports.sendSmsNotification = async (to, slug, data) => {
    try {
        const template = await getTemplate(slug, 'SMS');
        let message = '';
        if (!template) {
            console.warn(`Template ${slug} not found. Using default fallback.`);
            if (data.otp) message = `Your OTP is ${data.otp}`;
        } else {
            message = replacePlaceholders(template.content, data);
        }

        if (message) {
            const formattedTo = to.startsWith('+') ? to : `+91${to}`;

            // Check for Twilio Credentials and handle potential auth errors gracefully
            if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
                try {
                    await sendSMS(formattedTo, message);
                } catch (smsError) {
                    console.error(`❌ Twilio Error: ${smsError.message}. Using Mock.`);
                    console.log(`[MOCK SMS (Fallback)] To: ${formattedTo}, Msg: ${message}`);
                }
            } else {
                console.log(`[MOCK SMS] To: ${formattedTo}, Msg: ${message}`);
            }
        }
    } catch (error) {
        console.error('❌ Error sending SMS Notification:', error.message);
    }
};
