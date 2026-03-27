const express = require('express');
const cors = require('cors');

//routes
const userRoutes = require('./user-service/routes/user.routes');
const profileRoutes = require('./user-service/routes/profile.routes');
const commonRoutes = require('./common-service/routes/common.routes');
const vendorRoutes = require('./vendor-service/routes/vendor.routes');
const authRoutes = require('./user-service/routes/auth.routes');
const menuRoutes = require('./menu-service/routes/menu.routes');
const orderRoutes = require('./menu-service/routes/order.routes');
const cartRoutes = require('./order-service/routes/cart.routes');
const v2OrderRoutes = require('./order-service/routes/order.routes');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve Static Uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/users', userRoutes);
app.use('/users', profileRoutes); // Mount profile routes on /users too (e.g. /users/profile)
app.use('/auth', authRoutes);
app.use('/common', commonRoutes);
app.use('/vendor', vendorRoutes);
app.use('/menu', menuRoutes);
app.use('/orders', orderRoutes);
app.use('/cart', cartRoutes);
app.use('/v2/orders', v2OrderRoutes);

// Swagger
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));


// Health check
app.get('/health', (req, res) => {
    res.json({
        service: process.env.SERVICE_NAME,
        status: 'UP'
    });
});

module.exports = app;
