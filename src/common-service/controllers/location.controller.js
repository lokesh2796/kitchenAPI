const axios = require('axios');

exports.findLocation = async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        // Validation
        if (!latitude || !longitude) {
            return res.status(400).json({
                message: 'Latitude and longitude are required'
            });
        }

        // Call Google Maps Geocoding API
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}`
        );

        if (response.data.status !== 'OK') {
            console.error('❌ Google Maps API Error:', response.data.status, response.data.error_message);
            return res.status(400).json({
                success: false,
                message: response.data.error_message || 'Failed to fetch location from Google Maps'
            });
        }

        const result = response.data.results[0];
        const addressComponents = result.address_components;

        const getComponent = (types) => {
            const component = addressComponents.find(c => types.some(t => c.types.includes(t)));
            return component ? component.long_name : '';
        };

        // Extract location details from Google components
        const location = {
            fullAddress: result.formatted_address || '',
            area: getComponent(['sublocality', 'neighborhood', 'sublocality_level_1', 'sublocality_level_2']),
            city: getComponent(['locality', 'administrative_area_level_2']),
            state: getComponent(['administrative_area_level_1']),
            country: getComponent(['country']),
            pincode: getComponent(['postal_code']),
            latitude,
            longitude
        };

        return res.status(200).json({
            success: true,
            location
        });
    } catch (error) {
        console.error('❌ Location fetch error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch location'
        });
    }
};
