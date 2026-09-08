# External PSP System

A standalone Payment Service Provider (PSP) portal that integrates with the CredMate financing platform via webhooks.

## 🎨 Features

- **Modern Greenish Theme**: Beautiful green gradient design to differentiate from CredMate's purple theme
- **Order Book Management**: Create and manage customer orders
- **Loan Requests**: Request financing from CredMate against orders via webhook
- **Dashboard**: Real-time statistics and recent orders overview
- **Secure Authentication**: JWT-based authentication with API key management

## 🚀 Getting Started

### Prerequisites

- Node.js (v16 or higher)
- MongoDB running
- CredMate backend server running on port 5000

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create environment file:
```bash
cp .env.example .env
```

3. Update `.env` with your configuration:
```
VITE_API_URL=http://localhost:5050/api
```

### Running the Application

Development mode:
```bash
npm run dev
```

The application will start on `http://localhost:5173` (or the next available port).

## 📋 How It Works

### System Architecture

```
External PSP Portal (React)
    ↓
External PSP API (/api/external-psp/*)
    ↓
Request Loan → Webhook to CredMate (/api/webhook/loan-request)
    ↓
CredMate validates → Calls back to External PSP read API
    ↓
Validates order data → Processes financing
    ↓
Repayment done on CredMate PSP Portal
```

### Workflow

1. **Register/Login**: External PSP registers and receives API credentials
2. **Create Orders**: PSP creates orders in their order book
3. **Request Financing**: PSP requests loan against an order
4. **Webhook Call**: System calls CredMate webhook with order details
5. **Validation**: CredMate validates order by calling external PSP's read API
6. **Processing**: If valid, CredMate processes the financing request
7. **Repayment**: PSP manages repayments through CredMate portal

## 🎯 Key Pages

### Login/Register
- Beautiful greenish gradient login screen
- Toggle between login and registration
- API credentials generated on registration

### Dashboard
- Statistics cards (Total Orders, Pending Loans, Approved Loans, Total Financed)
- Quick action buttons
- Recent orders table

### Order Book
- Create new orders
- View all orders with search and filter
- Direct loan request links
- Status badges for orders and loans

### Create Order
- Comprehensive form for order details
- Customer information
- Invoice details
- Settlement date

### Loan Request
- Select order from dropdown
- View order details
- Specify loan amount
- Submit to CredMate webhook
- Real-time status updates

## 🔐 Authentication

The system uses JWT for authentication:
- Tokens stored in sessionStorage
- Automatic token refresh
- Protected routes
- API key authentication for webhooks

## 🎨 Theme

The application uses a custom greenish theme:
- Primary Color: `#10b981` (Emerald Green)
- Accent Color: `#22c55e` (Green)
- Dark Background: Gradient from `#0f172a` to `#1e293b`
- Custom green shadows and glows
- Smooth transitions and animations

## 📱 Responsive Design

- Mobile-friendly sidebar
- Responsive tables
- Touch-friendly buttons
- Optimized for all screen sizes

## 🔧 Tech Stack

- **Frontend**: React 19, React Router, Tailwind CSS
- **HTTP Client**: Axios
- **Icons**: React Icons
- **Date Handling**: Day.js
- **Build Tool**: Vite

## 🌐 API Endpoints Used

### Authentication
- `POST /api/external-psp/auth/register` - Register
- `POST /api/external-psp/auth/login` - Login

### Order Book
- `GET /api/external-psp/orderbook` - Get all orders
- `POST /api/external-psp/orderbook` - Create order
- `GET /api/external-psp/orderbook/:orderId` - Get order (for validation)

### Loan Requests
- `POST /api/external-psp/request-loan` - Request loan (calls CredMate webhook)
- `GET /api/external-psp/loan-status/:orderId` - Check loan status

## 🔄 Integration with CredMate

The external PSP integrates with CredMate through:

1. **Webhook Endpoint**: `POST /api/webhook/loan-request`
   - Receives loan requests from external PSP
   - Validates order data
   - Creates financing request

2. **Validation Callback**: `GET /api/external-psp/orderbook/:orderId`
   - CredMate calls this to validate order data
   - Verifies order reference, customer name, amount
   - Ensures data authenticity

## 📝 Environment Variables

```bash
# Frontend (.env)
VITE_API_URL=http://localhost:5050/api

# Backend (server/.env)
CREDMATE_WEBHOOK_URL=http://localhost:5050/api/webhook/loan-request
EXTERNAL_PSP_API_URL=http://localhost:5050/api/external-psp
```

## 🐛 Troubleshooting

### Server Connection Issues
- Ensure CredMate backend is running on port 5000
- Check CORS settings in backend
- Verify API_URL in .env file

### Authentication Issues
- Clear sessionStorage and try logging in again
- Check if JWT_SECRET is set in backend .env
- Verify token hasn't expired

### Webhook Failures
- Check backend logs for detailed error messages
- Ensure external PSP API URL is accessible
- Verify API credentials are correct

## 📄 License

Part of the CredMate PSP Financing Platform
