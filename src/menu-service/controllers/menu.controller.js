const MenuItem = require('../models/menuItem.model');
const TodayMenu = require('../models/todayMenu.model');
const PreOrderMenu = require('../models/preOrderMenu.model');
const UserProfile = require('../../models/userProfile.model');
const { publishEvent, CHANNELS, EVENTS } = require('../../utils/socket');

// --- Master Menu Items ---

exports.addMenuItem = async (req, res) => {
    try {
        const {
            menuName,
            cuisine,
            category,
            menuItemType,
            coverPicture,
            otherPictures,
            basePrice,
            ingredients,
            aboutItem,
            addOnsAvail,
            addOns,
            maxAddonsAllowed
        } = req.body;

        // "req.user" is the user document from middleware
        const userId = req.user._id;

        const newItem = new MenuItem({
            userId,
            menuName,
            cuisine,
            category,
            menuItemType,
            coverPicture,
            otherPictures,
            basePrice,
            ingredients,
            aboutItem,
            addOnsAvail,
            addOns,
            maxAddonsAllowed
        });

        const savedItem = await newItem.save();
        res.status(201).json({ message: 'Menu item created successfully', data: savedItem });
    } catch (error) {
        console.error('Error creating menu item:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.getMenuItems = async (req, res) => {
    try {
        const userId = req.user._id;
        const items = await MenuItem.find({ userId }).sort({ createdAt: -1 });
        res.status(200).json({ data: items });
    } catch (error) {
        console.error('Error fetching menu items:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.updateMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const updatedItem = await MenuItem.findOneAndUpdate(
            { _id: id, userId },
            req.body,
            { new: true }
        );

        if (!updatedItem) {
            return res.status(404).json({ message: 'Menu item not found or unauthorized' });
        }

        res.status(200).json({ message: 'Menu item updated successfully', data: updatedItem });
    } catch (error) {
        console.error('Error updating menu item:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.deleteMenuItem = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const deletedItem = await MenuItem.findOneAndDelete({ _id: id, userId });

        if (!deletedItem) {
            return res.status(404).json({ message: 'Menu item not found or unauthorized' });
        }

        // Cascade delete scheduled instances
        await TodayMenu.deleteMany({ menuItemId: id, userId });
        await PreOrderMenu.deleteMany({ menuItemId: id, userId });

        // Notify channels of real-time update
        await publishEvent(`vendor-${userId.toString()}`, { event: 'MENU_UPDATED', action: 'deleted', itemId: id });
        await publishEvent('public-updates', { event: 'MENU_UPDATED', action: 'deleted', itemId: id });

        res.status(200).json({ message: 'Menu item deleted successfully' });
    } catch (error) {
        console.error('Error deleting menu item:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// --- Today's Menu & Tomorrow's Menu ---
// (Note: Tomorrow's menu simply uses the TodayMenu model with a future date)

exports.addToTodayMenu = async (req, res) => {
    try {
        const userId = req.user._id;
        const { menuItemId, maxQty, availFrom, availTo, menuDate, basePrice, dealPrice } = req.body;

        const targetDate = new Date(menuDate);
        targetDate.setUTCHours(0, 0, 0, 0); // Normalized to UTC Midnight

        // Function to convert time string (e.g., "10:30 AM") to minutes from midnight
        const timeToMinutes = (timeStr) => {
            if (!timeStr) return 0;
            if (timeStr === 'Noon') return 12 * 60;
            const [time, period] = timeStr.split(' ');
            let [hours, minutes] = time.split(':').map(Number);
            if (isNaN(minutes)) minutes = 0;
            if (period === 'PM' && hours !== 12) hours += 12;
            if (period === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
        };

        const newStart = timeToMinutes(availFrom);
        const newEnd = timeToMinutes(availTo);

        // Fetch all existing entries for this item on this date
        const existingEntries = await TodayMenu.find({
            userId,
            menuItemId,
            menuDate: {
                $gte: targetDate,
                $lt: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)
            }
        });

        // Check for overlaps
        for (const entry of existingEntries) {
            const entryStart = timeToMinutes(entry.availFrom);
            const entryEnd = timeToMinutes(entry.availTo);

            if (newStart < entryEnd && newEnd > entryStart) {
                if (newStart === entryStart && newEnd === entryEnd) {
                    entry.maxQty = maxQty;
                    entry.balanceQty = maxQty - (entry.soldQty || 0);
                    entry.basePrice = basePrice;
                    entry.dealPrice = dealPrice;
                    await entry.save();

                    // Real-time stock broadcast via PubNub
                    await publishEvent('public-updates', {
                        event: 'ITEM_QTY_UPDATE',
                        dailyMenuId: entry._id.toString(),
                        balanceQty: entry.balanceQty
                    });

                    return res.status(200).json({ message: 'Schedule updated successfully', data: entry });
                }

                return res.status(409).json({
                    message: `Time slot overlaps with existing schedule (${entry.availFrom} - ${entry.availTo})`
                });
            }
        }

        const masterItem = await MenuItem.findById(menuItemId);
        if (!masterItem) return res.status(404).json({ message: 'Master menu item not found' });

        const newTodayItem = new TodayMenu({
            userId,
            menuItemId,
            menuName: masterItem.menuName,
            maxQty,
            balanceQty: maxQty, // Initial balance is max
            availFrom,
            availTo,
            menuDate: targetDate,
            basePrice,
            dealPrice
        });

        await newTodayItem.save();

        // Real-time stock broadcast via PubNub
        await publishEvent('public-updates', {
            event: 'ITEM_QTY_UPDATE',
            dailyMenuId: newTodayItem._id.toString(),
            balanceQty: newTodayItem.balanceQty
        });

        res.status(201).json({ message: 'Item scheduled successfully', data: newTodayItem });
    } catch (error) {
        console.error('Error adding to today menu:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.getTodayMenus = async (req, res) => {
    try {
        const userId = req.user._id;
        const { date } = req.query; // Optional filter by date
        const filter = { userId };
        if (date) {
            const d = new Date(date);
            d.setUTCHours(0, 0, 0, 0);
            filter.menuDate = d;
        }
        const items = await TodayMenu.find(filter).populate('menuItemId');
        res.status(200).json({ data: items });
    } catch (error) {
        console.error('Error fetching today menus:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.deleteTodayMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        await TodayMenu.findOneAndDelete({ _id: id, userId });

        // Notify channels to refresh/remove item
        await publishEvent('public-updates', { event: 'MENU_UPDATED', action: 'scheduled_deleted', itemId: id });

        res.status(200).json({ message: 'Item removed from schedule' });
    } catch (error) {
        console.error('Error removing from today menu:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.updateTodayMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const { maxQty } = req.body;

        // If updating maxQty, we should also update balanceQty
        if (maxQty !== undefined) {
            const current = await TodayMenu.findOne({ _id: id, userId });
            if (current) {
                req.body.balanceQty = maxQty - (current.soldQty || 0);
            }
        }

        const updated = await TodayMenu.findOneAndUpdate(
            { _id: id, userId },
            req.body,
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Schedule not found' });
        }

        // Real-time stock broadcast via PubNub
        await publishEvent('public-updates', {
            event: 'ITEM_QTY_UPDATE',
            dailyMenuId: updated._id.toString(),
            balanceQty: updated.balanceQty
        });

        res.status(200).json({ message: 'Schedule updated successfully', data: updated });
    } catch (error) {
        console.error('Error updating today menu:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// --- Pre-Order Menu ---

exports.addToPreOrderMenu = async (req, res) => {
    try {
        const userId = req.user._id;
        const { menuItemId, maxQty, availFrom, availTo, advanceNotice, basePrice, dealPrice } = req.body;

        let existing = await PreOrderMenu.findOne({ userId, menuItemId });
        if (existing) {
            existing.maxQty = maxQty;
            existing.balanceQty = maxQty - (existing.soldQty || 0);
            existing.availFrom = availFrom;
            existing.availTo = availTo;
            existing.advanceNotice = advanceNotice;
            existing.basePrice = basePrice;
            existing.dealPrice = dealPrice;
            await existing.save();

            await publishEvent('public-updates', {
                event: 'ITEM_QTY_UPDATE',
                dailyMenuId: existing._id.toString(),
                balanceQty: existing.balanceQty
            });

            return res.status(200).json({ message: 'Pre-order updated successfully', data: existing });
        }

        const masterItem = await MenuItem.findById(menuItemId);
        if (!masterItem) return res.status(404).json({ message: 'Master menu item not found' });

        const newPreOrderItem = new PreOrderMenu({
            userId,
            menuItemId,
            menuName: masterItem.menuName,
            maxQty,
            balanceQty: maxQty,
            availFrom,
            availTo,
            advanceNotice,
            basePrice,
            dealPrice
        });

        await newPreOrderItem.save();

        await publishEvent('public-updates', {
            event: 'ITEM_QTY_UPDATE',
            dailyMenuId: newPreOrderItem._id.toString(),
            balanceQty: newPreOrderItem.balanceQty
        });

        res.status(201).json({ message: 'Item added to pre-order successfully', data: newPreOrderItem });
    } catch (error) {
        console.error('Error adding to pre-order:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.getPreOrderMenus = async (req, res) => {
    try {
        const userId = req.user._id;
        const items = await PreOrderMenu.find({ userId }).populate('menuItemId');
        res.status(200).json({ data: items });
    } catch (error) {
        console.error('Error fetching pre-order menus:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.updatePreOrderMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const { maxQty } = req.body;

        // If updating maxQty, we should also update balanceQty
        if (maxQty !== undefined) {
            const current = await PreOrderMenu.findOne({ _id: id, userId });
            if (current) {
                req.body.balanceQty = maxQty - (current.soldQty || 0);
            }
        }

        const updated = await PreOrderMenu.findOneAndUpdate(
            { _id: id, userId },
            req.body,
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: 'Pre-order item not found' });
        }

        await publishEvent('public-updates', {
            event: 'ITEM_QTY_UPDATE',
            dailyMenuId: updated._id.toString(),
            balanceQty: updated.balanceQty
        });

        res.status(200).json({ message: 'Pre-order item updated', data: updated });
    } catch (error) {
        console.error('Error updating pre-order menu:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

exports.deletePreOrderMenu = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        await PreOrderMenu.findOneAndDelete({ _id: id, userId });

        await publishEvent('public-updates', { event: 'MENU_UPDATED', action: 'preorder_deleted', itemId: id });

        res.status(200).json({ message: 'Item removed from pre-order' });
    } catch (error) {
        console.error('Error removing from pre-order:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};

// --- Explore Menu (For Customers) ---

exports.getExploreMenu = async (req, res) => {
    try {
        const { type, date } = req.query; // type: 'today' | 'preorder' | 'all'
        let todayItems = [];
        let tomorrowItems = [];
        let preorderItems = [];

        // Helper to fetch menu items for a specific date/filter.
        // `requireKitchenOpen` is true ONLY for today's items — tomorrow and
        // preorder items remain visible even when the vendor's kitchen is
        // currently closed, because those are future orders.
        const fetchMenuForDate = async (startDate, endDate, requireKitchenOpen = true) => {
            const filter = {
                menuDate: { $gte: startDate, $lte: endDate },
                balanceQty: { $gt: 0 }
            };

            const rawItems = await TodayMenu.find(filter)
                .populate({
                    path: 'menuItemId',
                    select: 'menuName cuisine category menuItemType coverPicture otherPictures basePrice addOnsAvail addOns maxAddonsAllowed aboutItem'
                })
                .populate({
                    path: 'userId',
                    select: 'firstName lastName phone email'
                }).lean();

            const userIds = rawItems.map(i => i.userId._id);
            // Fetch Profile for business name, vendor location, delivery policy, kitchen status
            const profiles = await UserProfile.find({ userId: { $in: userIds } }).select('userId businessName vendorLocation deliveryPolicy vendorStatus kitchenOpen').lean();

            const profileMap = {};
            profiles.forEach(p => {
                let addr = '';
                if (p.vendorLocation) {
                    addr = `${p.vendorLocation.address1 || ''}, ${p.vendorLocation.city || ''}`;
                }
                profileMap[p.userId.toString()] = {
                    name: p.businessName,
                    addr: addr,
                    deliveryPolicy: p.deliveryPolicy,
                    vendorLocation: p.vendorLocation,
                    vendorStatus: p.vendorStatus,
                    kitchenOpen: p.kitchenOpen
                };
            });

            // Filter: vendor must be Active. Kitchen-open is only enforced for today.
            const filtered = rawItems.filter(item => {
                const profile = profileMap[item.userId._id.toString()];
                if (!profile || profile.vendorStatus !== 'Active') return false;
                if (requireKitchenOpen && profile.kitchenOpen !== true) return false;
                return true;
            });

            if (rawItems.length > filtered.length) {
                console.log(`[explore] dropped ${rawItems.length - filtered.length}/${rawItems.length} items (vendor inactive${requireKitchenOpen ? ' or kitchen closed' : ''})`);
            }

            return filtered.map(item => {
                const profile = profileMap[item.userId._id.toString()] || {};
                return {
                    ...item,
                    vendorName: profile.name || (item.userId.firstName + "'s Kitchen"),
                    vendorAddress: profile.addr || 'Location not available',
                    deliveryPolicy: profile.deliveryPolicy,
                    vendorLocation: profile.vendorLocation,
                    kitchenOpen: profile.kitchenOpen
                };
            });
        };

        if (!type || type === 'today' || type === 'all') {
            const startOfToday = date ? new Date(date) : new Date();
            startOfToday.setUTCHours(0, 0, 0, 0);
            const endOfToday = new Date(startOfToday);
            endOfToday.setUTCHours(23, 59, 59, 999);

            // Today: requires kitchen to be currently open.
            todayItems = (await fetchMenuForDate(startOfToday, endOfToday, true))
                .map(i => ({ ...i, menuTag: 'today' }));

            // Fetch Tomorrow's Items — visible regardless of kitchen-open today.
            const startOfTomorrow = new Date(startOfToday);
            startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
            startOfTomorrow.setUTCHours(0, 0, 0, 0);

            const endOfTomorrow = new Date(startOfTomorrow);
            endOfTomorrow.setUTCHours(23, 59, 59, 999);

            tomorrowItems = (await fetchMenuForDate(startOfTomorrow, endOfTomorrow, false))
                .map(i => ({ ...i, menuTag: 'tomorrow' }));
        }

        if (type === 'preorder' || type === 'all') {
            const rawItems = await PreOrderMenu.find({ balanceQty: { $gt: 0 } })
                .populate({
                    path: 'menuItemId',
                    select: 'menuName cuisine category menuItemType coverPicture otherPictures basePrice addOnsAvail addOns maxAddonsAllowed aboutItem'
                })
                .populate({
                    path: 'userId',
                    select: 'firstName lastName phone email'
                }).lean();

            const userIds = rawItems.map(i => i.userId._id);
            const profiles = await UserProfile.find({ userId: { $in: userIds } }).select('userId businessName vendorLocation deliveryPolicy vendorStatus kitchenOpen').lean();

            const profileMap = {};
            profiles.forEach(p => {
                let addr = '';
                if (p.vendorLocation) {
                    addr = `${p.vendorLocation.address1 || ''}, ${p.vendorLocation.city || ''}`;
                }
                profileMap[p.userId.toString()] = {
                    name: p.businessName,
                    addr: addr,
                    deliveryPolicy: p.deliveryPolicy,
                    vendorLocation: p.vendorLocation,
                    vendorStatus: p.vendorStatus,
                    kitchenOpen: p.kitchenOpen
                };
            });

            // Preorders are future orders — visible whenever the vendor is
            // Active, even if their kitchen is currently closed for today.
            const filteredPre = rawItems.filter(item => {
                const profile = profileMap[item.userId._id.toString()];
                return profile && profile.vendorStatus === 'Active';
            });

            if (rawItems.length > filteredPre.length) {
                console.log(`[explore] dropped ${rawItems.length - filteredPre.length}/${rawItems.length} preorder items (vendor inactive)`);
            }

            preorderItems = filteredPre.map(item => {
                const profile = profileMap[item.userId._id.toString()] || {};
                return {
                    ...item,
                    menuTag: 'preorder',
                    vendorName: profile.name || (item.userId.firstName + "'s Kitchen"),
                    vendorAddress: profile.addr || 'Location not available',
                    deliveryPolicy: profile.deliveryPolicy,
                    vendorLocation: profile.vendorLocation,
                    kitchenOpen: profile.kitchenOpen
                };
            });
        }

        console.log(`Explore Menu [${new Date().toISOString()}]: Found ${todayItems.length} today, ${tomorrowItems.length} tomorrow, ${preorderItems.length} preorder`);

        res.status(200).json({
            today: todayItems,
            tomorrow: tomorrowItems,
            preorder: preorderItems
        });
    } catch (error) {
        console.error('CRITICAL: Error in getExploreMenu:', error);
        res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
};
