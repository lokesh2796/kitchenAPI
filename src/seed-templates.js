require('dotenv').config();
const mongoose = require('mongoose');
const Template = require('./models/template.model');
const connectDB = require('./config/db');

const seedTemplates = async () => {
    try {
        await connectDB();
        console.log('✅ DB connected for seeding templates');

        const templates = [
            {
                slug: 'OTP_EMAIL',
                type: 'EMAIL',
                subject: 'Your {{appName}} OTP Code',
                content: '<p>Hi {{firstname}},</p><p>Your One-Time Password (OTP) for <strong>{{appName}}</strong> verification is:</p><h3>{{otp}}</h3><p>This OTP is valid for <strong>10 minutes</strong>. Please do not share this code with anyone.</p><p>Stay safe,<br>Team {{appName}}</p>'
            },
            {
                slug: 'OTP_SMS',
                type: 'SMS',
                content: 'Your {{appName}} OTP is {{otp}}. Valid for 10 minutes.'
            },
            {
                slug: 'ACCOUNT_CREATED',
                type: 'EMAIL',
                subject: 'Welcome to {{appName}} 🎉 Your Account is Ready',
                content: '<p>Hi {{firstname}},</p><p>Welcome to <strong>{{appName}}</strong>! 🎊 Your account has been created successfully, and you’re all set to start exploring delicious food experiences.</p><p><strong>What you can do now:</strong><ul><li>Browse nearby kitchens 🍳</li><li>Place and track your orders 📦</li><li>Manage your profile and preferences</li></ul></p><p>If you have any questions, feel free to reach out to our support team anytime.</p><p>Happy ordering! 😋<br>Team {{appName}}</p>'
            },
            {
                slug: 'PARTNER_SIGNUP_CREATED',
                type: 'EMAIL',
                subject: 'Welcome to {{appName}} Partner Program 🎉',
                content: '<p>Hi {{firstname}},</p><p>Welcome to the <strong>{{appName}} Partner Program</strong>! 🎊 Your partner account has been created successfully.</p><p>We’re excited to have <strong>{{kitchenName}}</strong> onboard and look forward to helping you grow your food business with us.</p><p><strong>What’s next?</strong><ul><li>Complete your kitchen profile 🏪</li><li>Upload your menu and pricing 🍽️</li><li>Set your availability & delivery timings ⏰</li><li>Go live and start receiving orders 🚀</li></ul></p><p>Let’s grow together! 🤝<br>Team {{appName}}</p>'
            },
            {
                slug: 'KITCHEN_LIVE',
                type: 'EMAIL',
                subject: 'Your Kitchen is Now Live on {{appName}} 🚀',
                content: '<p>Hi {{firstname}},</p><p>Great news! 🎉 Your kitchen <strong>{{kitchenName}}</strong> is now <strong>LIVE</strong> on <strong>{{appName}}</strong>.</p><p>Customers can now:<ul><li>View your menu 🍽️</li><li>Place orders 🛒</li><li>Leave reviews ⭐</li></ul></p><p>Make sure your menu and availability are always up to date to maximize orders.</p><p>Wishing you great success!<br>Team {{appName}}</p>'
            },
            {
                slug: 'KITCHEN_OFFLINE',
                type: 'EMAIL',
                subject: 'Your Kitchen is Currently Offline on {{appName}}',
                content: '<p>Hi {{firstname}},</p><p>This is to inform you that your kitchen <strong>{{kitchenName}}</strong> is currently marked as <strong>OFFLINE</strong> on <strong>{{appName}}</strong>.</p><p>While offline:<ul><li>Customers won’t be able to place new orders</li><li>Your kitchen won’t appear in active listings</li></ul></p><p>You can go online anytime from your dashboard.</p><p>Regards,<br>Team {{appName}}</p>'
            },
            {
                slug: 'PASSWORD_CHANGED',
                type: 'EMAIL',
                subject: 'Your {{appName}} Password Was Changed',
                content: '<p>Hi {{firstname}},</p><p>Your <strong>{{appName}} account password</strong> has been changed successfully.</p><p>🔐 <strong>Security Tip:</strong> If you did not make this change, please reset your password immediately or contact our support team.</p><p>Thanks for keeping your account secure.<br>Team {{appName}}</p>'
            },
            {
                slug: 'EMAIL_VERIFICATION',
                type: 'EMAIL',
                subject: 'Verify Your Email Address for {{appName}}',
                content: '<p>Hi {{firstname}},</p><p>Thanks for signing up with <strong>{{appName}}</strong>! Please verify your email address by clicking the link below:</p><p><a href="{{verificationLink}}">{{verificationLink}}</a></p><p>This helps us keep your account secure and activated.</p><p>Welcome aboard! 🎉<br>Team {{appName}}</p>'
            }
        ];

        for (const t of templates) {
            await Template.findOneAndUpdate(
                { slug: t.slug, type: t.type },
                t,
                { upsert: true, new: true }
            );
            console.log(`✅ Synced Template: ${t.slug}`);
        }
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seedTemplates();
