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
    }
};
