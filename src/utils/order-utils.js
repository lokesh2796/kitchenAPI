const crypto = require('crypto');

/**
 * Generates a unique 6-character alphanumeric order ID starting with HM.
 */
exports.generateOrderId = () => {
    // Generates a 4-char hex string (0000 to FFFF) and joins it with HM
    return 'HM' + crypto.randomBytes(2).toString('hex').toUpperCase();
};

/**
 * Generates a 4-digit random numeric OTP.
 */
exports.generateOTP = () => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

/**
 * Calculates the next settlement date (the next Saturday after the order date).
 * @param {Date} orderDate 
 */
exports.calculateSettlementDate = (orderDate) => {
    const date = new Date(orderDate);
    const day = date.getDay(); // 0 is Sunday, 6 is Saturday
    const diff = 6 - day; // Days until Saturday

    // If it's already Saturday, move to next Saturday
    const daysToAdd = diff === 0 ? 7 : diff;

    date.setDate(date.getDate() + daysToAdd);
    date.setHours(0, 0, 0, 0);
    return date;
};

/**
 * Calculates distance (Haversine) between two coordinates in KM.
 */
exports.calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Earth radius in KM
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
};
