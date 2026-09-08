# Orderbook Scheduler

## Overview
The External PSP system now includes an **automatic orderbook generator** that creates realistic order entries every 15 seconds.

## Features

### Realistic Data Generation
- **Random Amounts**: Between $20,000 and $100,000
  - 70% of amounts are "round" numbers (multiples of $5,000)
  - 30% are more varied but rounded to nearest $100
- **Realistic Customer Names**: 40 first names × 40 last names combination
- **Realistic Emails**: Generated from customer names with various formats
- **Phone Numbers**: US format with realistic area codes
- **Service Types**: 20 different professional service descriptions
- **Order References**: Timestamp-based unique references (ORD-{timestamp}-{random})
- **Invoice Numbers**: Date-based format (INV-YYYYMM-{random})
- **Settlement Dates**: Between 7 and 45 days from order creation

## Implementation

### Files Created/Modified

1. **`/server/workers/orderbookGenerator.js`** (NEW)
   - Main worker file containing the generator logic
   - Functions for realistic data generation
   - Scheduler interval management

2. **`/server/config/scheduler.js`** (MODIFIED)
   - Integrated orderbook generator into scheduled jobs
   - Auto-starts when server initializes

## How It Works

1. **Auto-Start**: The scheduler starts automatically when the backend server starts
2. **Interval**: Creates one new order every 15 seconds (15,000ms)
3. **User Assignment**: Orders are created for the specific External PSP user:
   - **Email**: psp@credmate.com
   - **Company**: Acme
   - **User ID**: 697c8263f257b2dac63a69d2
4. **Database Storage**: All orders are saved to the `ExternalOrderBook` collection

## Console Output

You'll see logs like:
```
[Orderbook Generator] Starting orderbook scheduler (15 second interval)
[Orderbook Generator] Generating new orderbook entry...
[Orderbook Generator] Created order ORD-12345678-9012 for $45,000
```

## Functions Available

- `startOrderbookScheduler()`: Start the 15-second interval
- `stopOrderbookScheduler()`: Stop the scheduler
- `generateOrderbookEntry()`: Manually generate a single order
- `generateSingleOrder(userId)`: Create order for specific user

## Testing

The scheduler starts automatically. To verify:
1. Check server console logs for "[Orderbook Generator]" messages
2. Navigate to http://localhost:5173/orderbook
3. Watch as new orders appear every 15 seconds

## Order Status

All auto-generated orders have:
- **Status**: "Pending"
- **Loan Status**: "None" (no loan requested initially)
- **Notes**: Timestamp of when auto-generated

## Stopping the Scheduler

To stop the scheduler (if needed):
```javascript
const { stopOrderbookScheduler } = require('./workers/orderbookGenerator');
stopOrderbookScheduler();
```

## Future Enhancements

Potential improvements:
- Multi-user support (distribute orders across multiple PSPs)
- Variable intervals (e.g., more orders during business hours)
- Weighted distribution of amounts
- Occasionally auto-request loans on some orders
- Different status distributions (not just Pending)
