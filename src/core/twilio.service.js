const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

const client = new twilio(accountSid, authToken);

const sendSMS = async (to, message) => {
    try {
        const msg = await client.messages.create({
            body: message,
            to: to,
            from: process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID
        });
        console.log('✅ SMS sent:', msg.sid);
        return msg;
    } catch (error) {
        console.error('❌ Error sending SMS:', error);
        throw error;
    }
};

module.exports = { sendSMS };
