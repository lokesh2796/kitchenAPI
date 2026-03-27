require('dotenv').config();
const mongoose = require('mongoose');
const Usersdetail = require('./models/users.model');
const VendorStep1 = require('./vendor-service/models/vendorstep1.model');
const VendorStep2 = require('./vendor-service/models/vendorstep2.model');
const VendorStep3 = require('./vendor-service/models/vendorstep3.model');
const VendorStep4 = require('./vendor-service/models/vendorstep4.model');
const VendorStep5 = require('./vendor-service/models/vendorstep5.model');
const VendorStep6 = require('./vendor-service/models/vendorstep6.model');

const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ DB connected for seeding');
    } catch (err) {
        console.error('❌ DB connection failed', err);
        process.exit(1);
    }

    // --- 1. Create Normal User ---
    const userMobile = "9876543210";
    const normalUser = {
        mobile: userMobile,
        otp: false,
        userProfile: {
            firstname: "Vijay",
            lastname: "Amarnath",
            email: "vijay@example.com",
            profileImage: "https://ui-avatars.com/api/?name=Vijay+Amarnath",
            password: "password123"
        },
        activeRole: "USER"
    };

    try {
        const userExists = await Usersdetail.findOne({ mobile: userMobile });
        if (userExists) {
            console.log('⚠️ Normal user already exists. Updating...');
            await Usersdetail.updateOne({ mobile: userMobile }, normalUser);
        } else {
            const user = new Usersdetail(normalUser);
            await user.save();
            console.log('✅ Normal user inserted');
        }
    } catch (err) {
        console.error('❌ Error seeding normal user:', err);
    }

    // --- 2. Create Vendor User ---
    const vendorMobile = "9998887770";

    // We need to create step documents first to get their IDs
    // Note: In a real flow, these are created step-by-step. Here we simluate a fully onboarded vendor.

    // Placeholder IDs (will be replaced by actual saved docs)
    let s1Id, s2Id, s3Id, s4Id, s5Id, s6Id;

    try {
        // Step 1
        const s1 = new VendorStep1({
            firstName: "Vendor", lastName: "Owner", businessName: "Tasty Foods",
            businessAddress: "123 Food St", city: "Chennai", state: "TN",
            zipcode: "600001", email: "vendor@tasty.com", mobileNumber: "9998887770"
        });
        const savedS1 = await s1.save();
        s1Id = savedS1._id;

        // Step 2
        const s2 = new VendorStep2({ fullName: "Vendor Owner", paypalId: "pay@tasty.com" });
        const savedS2 = await s2.save();
        s2Id = savedS2._id;

        // Step 3
        const s3 = new VendorStep3({
            offerFreeCancellation: "yes", freeCancellationDuration: "10 mins",
            offerPenaltyCancellation: "yes", penaltyTimeframe: "20 mins", penaltyFee: "50",
            preOrderFreeCancellation: "yes", preOrderFreeDuration: "1 hour",
            preOrderPenaltyCancellation: "yes", preOrderPenaltyDuration: "30 mins", preOrderPenaltyFee: "100"
        });
        const savedS3 = await s3.save();
        s3Id = savedS3._id;

        // Step 4
        const s4 = new VendorStep4({
            deliveryAvailable: "yes", minOrderAmount: 200, deliveryCharge: 50, maxDistance: "10km"
        });
        const savedS4 = await s4.save();
        s4Id = savedS4._id;

        // Step 5
        const s5 = new VendorStep5({ agreedToTerms: true });
        const savedS5 = await s5.save();
        s5Id = savedS5._id;

        // Step 6
        const s6 = new VendorStep6({ agreedToTerms: true });
        const savedS6 = await s6.save();
        s6Id = savedS6._id;

        // Now create/update Vendor User
        const vendorUser = {
            mobile: vendorMobile,
            otp: false,
            userProfile: {
                firstname: "Vendor",
                lastname: "Owner",
                email: "vendor@tasty.com",
                profileImage: "https://ui-avatars.com/api/?name=Vendor+Owner",
                password: "password123"
            },
            isVendorCreated: true,
            activeRole: 'VENDOR',
            vendorProfile: {
                stepCompleted: { step1: true, step2: true, step3: true, step4: true, step5: true, step6: true },
                onboardingStep: {
                    step1Id: s1Id, step2Id: s2Id, step3Id: s3Id, step4Id: s4Id, step5Id: s5Id, step6Id: s6Id
                },
                isActive: true,
                closeKitchen: false
            }
        };

        const vendorExists = await Usersdetail.findOne({ mobile: vendorMobile });
        if (vendorExists) {
            console.log('⚠️ Vendor user already exists. Updating...');
            await Usersdetail.updateOne({ mobile: vendorMobile }, vendorUser);
        } else {
            const vendor = new Usersdetail(vendorUser);
            await vendor.save();
            // Link back userId to steps (optional but good practice)
            await VendorStep1.findByIdAndUpdate(s1Id, { userId: vendor._id });
            await VendorStep2.findByIdAndUpdate(s2Id, { userId: vendor._id });
            await VendorStep3.findByIdAndUpdate(s3Id, { userId: vendor._id });
            await VendorStep4.findByIdAndUpdate(s4Id, { userId: vendor._id });
            await VendorStep5.findByIdAndUpdate(s5Id, { userId: vendor._id });
            await VendorStep6.findByIdAndUpdate(s6Id, { userId: vendor._id });

            console.log('✅ Vendor user inserted');
        }

    } catch (err) {
        console.error('❌ Error seeding vendor data:', err);
    }

    process.exit();
};

seedData();
