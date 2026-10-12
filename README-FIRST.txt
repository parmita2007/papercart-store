PAPERCART FULL LOCAL TEST BUILD
===============================

WHAT THIS BUILD INCLUDES
- Responsive stationery storefront with search and category filters
- Cart and quantity controls
- Checkout with COD and UPI QR choice
- Orders saved to data/orders.json by the local server
- Admin login, order dashboard, order status updates, payment status updates, delete and CSV export
- No npm packages required; uses built-in Node.js modules only

RUN ON WINDOWS
1. Extract this ZIP using right-click > Extract All.
2. Open the extracted PaperCart-Full-Test folder.
3. Double-click START-PAPERCART.bat.
4. Keep the black terminal window open.
5. Open Chrome/Edge and visit http://localhost:3000
6. Place a test order with sample details.
7. Click Store Admin. Default local test password: ChangeThisAdminPass123!
8. The dashboard should show your order. Change status and export CSV to test.
9. Stop server with Ctrl+C in the black terminal window.

IF NODE IS NOT RECOGNIZED
The .bat file checks common Node.js install locations. If it still fails, Node.js may not be installed correctly. Reinstall the current LTS Windows x64 MSI from https://nodejs.org/en/download and ensure Node.js and npm are installed to the local hard drive / PATH.

CHANGE THE LOCAL ADMIN PASSWORD
For a one-time run, open Command Prompt in this folder and run:
  set PAPERCART_ADMIN_PASSWORD=your-long-private-password
  node server.js
Do not share the password. Do not use the demo password on a public server.

IMPORTANT LIMITATIONS
- This is a local test build, not a public live store. It listens only on 127.0.0.1.
- Orders persist in the local data/orders.json file, but only on this laptop. No remote database, multi-device access, backups, email/WhatsApp alerts, or online hosting are configured.
- The admin session is for local testing; do not expose this development build directly to the internet.
- UPI QR payment is not automatically verified. Verify actual payment in your bank/UPI app before marking it verified.
- COD is recorded as an order preference, not a courier booking or confirmed delivery.
- Products/prices are sample catalogue entries. Update them before a real launch.
- Use sample customer details for testing, not real sensitive customer information.

PUBLIC LAUNCH STILL NEEDS
A production database, proper admin account/session management, HTTPS hosting, environment-managed secrets, validation/rate limiting/backups, payment provider integration if automated payment verification is needed, notification provider setup, shipping/returns policies, and real-world testing. Hosting/domain cannot be activated without the owner's account choices and credentials.
