# Database Seeding

## Overview

The seed file populates your MongoDB database with test users and sample data for development and testing.

## What Gets Seeded

### Users Created

1. **CRO (Chief Risk Officer)**
   - Email: `cro@credmate.com`
   - Password: `admin123`
   - Name: John Anderson

2. **CFO (Chief Financial Officer)**
   - Email: `cfo@credmate.com`
   - Password: `admin123`
   - Name: Sarah Martinez

3. **Sample PSP (Payment Service Provider)**
   - Email: `psp@credmate.com`
   - Password: `demo123`
   - Company: Acme Payments Ltd
   - Status: Approved (ready for testing financing flows)

### Sample Data

- **PSP Profile**: Complete profile with company info, business operations, and financial data
- **Order Book**: 10 sample orders with various statuses (Pending, Financed, Settled)

## How to Run

```bash
cd server
npm run seed
```

## Output

The script will:
1. Connect to MongoDB
2. Clear existing CRO and CFO users (keeps existing PSP data unless you uncomment the reset)
3. Create new users with hashed passwords
4. Create sample PSP profile and order book
5. Display login credentials

## Testing Workflow

After seeding, you can test:

1. **CRO Flow**:
   - Login as CRO
   - View pending applications
   - Approve applications (triggers smart contract deployment)

2. **CFO Flow**:
   - Login as CFO
   - View financial stats and exposure

3. **PSP Flow**:
   - Login as sample PSP
   - View order book
   - Request financing
   - Check pool status

## Customization

Edit `seed.js` to:
- Change passwords
- Add more PSP users
- Modify order book data
- Adjust PSP profile details

## Important Notes

- Passwords are hashed with bcrypt before storage
- The sample PSP has an approved credit line
- Order book includes some overdue orders for testing
- Run this on a development database only!
