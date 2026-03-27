const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Vendor App API',
            version: '1.0.0',
            description: 'API Documentation for Vendor App Backend'
        },
        servers: [
            {
                url: 'http://localhost:5000', // Update based on process.env.PORT
                description: 'Local server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [{
            bearerAuth: []
        }],
    },
    apis: ['./src/user-service/routes/*.js', './src/common-service/routes/*.js', './src/vendor-service/routes/*.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);
module.exports = specs;
