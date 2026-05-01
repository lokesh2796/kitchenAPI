module.exports = {
    SUCCESS: {
        OTP_SENT: 'OTP sent successfully',
        LOGIN_SUCCESS: 'Login successful',
        REGISTRATION_INITIATED: 'OTP sent to email and mobile',
        ACCOUNT_CREATED: 'Account created successfully'
    },
    ERROR: {
        INTERNAL_SERVER_ERROR: 'Oops! Something went wrong. Please try again later.',
        BAD_REQUEST: 'Bad Request',
        NOT_FOUND: 'Resource not found',
        USER_NOT_FOUND: 'User not found',
        INVALID_OTP: 'Invalid OTP',
        OTP_EXPIRED: 'OTP has expired',
        NO_OTP_REQUESTED: 'No OTP requested for this user',
        MOBILE_REQUIRED: 'Mobile number is required',
        EMAIL_REQUIRED: 'Email is required',
        PASSWORD_REQUIRED: 'Password is required',
        USER_ALREADY_EXISTS: 'User already exists',
        UNAUTHORIZED: 'Unauthorized access',
        INVALID_INPUT: 'Invalid input provided'
    },
    ORDER: {
        PLACED: 'Order placed successfully!',
        NOT_FOUND: 'Order not found',
        INVALID_STATUS: 'Invalid status provided',
        STATUS_UPDATED: 'Status updated',
        UNAUTHORIZED_UPDATE: 'Not authorized to update this order',
        MISSING_FIELDS: 'Missing required fields: vendorId, items',
        SELECT_DELIVERY_TIME: 'Please select a preferred delivery time for this future-dated order',
        SELECT_TIME_SCHEDULED: 'Please select a delivery time for your scheduled order',
        DELIVERY_TIME_WINDOW: 'For {category} delivery, please select a time between 9:00 AM and 12:00 PM.',
        PREORDER_LEAD_TIME: 'Pre-orders require at least a 3-day advance notice.',
        OUT_OF_STOCK: 'Insufficient quantity available for {item}. Order could not be placed.',
        DELIVERY_DATE_REQUIRED: 'Delivery date is required'
    },
    ORDER_NOTIFICATION: {
        STATUS_TITLES: {
            confirmed: 'Order Confirmed!',
            preparing: 'Order Being Prepared',
            ready: 'Order Ready!',
            out_for_delivery: 'Out for Delivery',
            delivered: 'Order Delivered!',
            cancelled: 'Order Cancelled'
        },
        STATUS_MESSAGES: {
            confirmed: 'has been accepted.',
            preparing: 'is being prepared.',
            ready: 'is ready for pickup.',
            out_for_delivery: 'is on the way!',
            delivered: 'has been delivered.',
            cancelled: 'has been cancelled.'
        }
    }
};
