const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD =
process.env.PAPERCART_ADMIN_PASSWORD || 'ChangeThisAdminPass123!';

const sessions = new Map();

const products = [
{ id: 'notebook', name: 'Classic Ruled Notebook', category: 'Notebooks', price: 79, emoji: '📓', desc: 'Everyday notes, ideas and plans.' },
{ id: 'journal', name: 'Premium Journal', category: 'Notebooks', price: 199, emoji: '📔', desc: 'A little space for big thoughts.' },
{ id: 'pens', name: 'Smooth Gel Pen Set', category: 'Pens', price: 99, emoji: '🖊️', desc: 'A set of 5 smooth-writing pens.' },
{ id: 'markers', name: 'Colour Marker Set', category: 'Art Supplies', price: 149, emoji: '🖍️', desc: 'Bright colours for creative projects.' },
{ id: 'pencils', name: 'HB Pencil Pack', category: 'Pens', price: 49, emoji: '✏️', desc: 'Reliable pencils for school and sketching.' },
{ id: 'sticky', name: 'Pastel Sticky Notes', category: 'Desk Essentials', price: 69, emoji: '🗒️', desc: 'Keep reminders where you can see them.' },
{ id: 'geometry', name: 'Geometry Box', category: 'School Supplies', price: 129, emoji: '📐', desc: 'Everyday geometry tools in one box.' },
{ id: 'clips', name: 'Desk Organiser Kit', category: 'Desk Essentials', price: 179, emoji: '📎', desc: 'Small essentials for a tidy desk.' }
];

function ensureData() {
if (!fs.existsSync(DATA_DIR)) {
fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(ORDERS_FILE)) {
fs.writeFileSync(ORDERS_FILE, '[]');
}
}

function readOrders() {
ensureData();

try {
return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
} catch {
return [];
}
}

function writeOrders(orders) {
fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
res.writeHead(status, {
'Content-Type': type,
'X-Content-Type-Options': 'nosniff',
'Cache-Control': 'no-store',
...headers
});

res.end(
type.startsWith('application/json') ? JSON.stringify(body) : body
);
}

function parseCookies(req) {
return Object.fromEntries(
(req.headers.cookie || '')
.split(';')
.map(x => x.trim())
.filter(Boolean)
.map(x => {
const i = x.indexOf('=');
return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
})
);
}

function isAdmin(req) {
const sid = parseCookies(req).pc_admin;
return !!sid && sessions.has(sid);
}

function readBody(req) {
return new Promise((resolve, reject) => {
let s = '';
let tooLarge = false;

req.on('data', d => {
if (tooLarge) return;

s += d;

if (Buffer.byteLength(s, 'utf8') > 1e6) {
tooLarge = true;
reject(new Error('Request too large'));
req.destroy();
}
});

req.on('end', () => {
if (tooLarge) return;

try {
resolve(JSON.parse(s || '{}'));
} catch (e) {
reject(e);
}
});

req.on('error', reject);
});
}

function safeText(v, max = 200) {
return String(v || '').trim().replace(/[<>]/g, '').slice(0, max);
}

function serveStatic(req, res, urlPath) {
let p = urlPath === '/' ? '/index.html' : urlPath;
p = decodeURIComponent(p);

const file = path.resolve(PUBLIC, '.' + p);

if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) {
return send(res, 403, { error: 'Forbidden' });
}

fs.readFile(file, (err, buf) => {
if (err) {
return send(res, 404, { error: 'Not found' });
}

const ext = path.extname(file).toLowerCase();

const types = {
'.html': 'text/html; charset=utf-8',
'.css': 'text/css; charset=utf-8',
'.js': 'text/javascript; charset=utf-8',
'.jpeg': 'image/jpeg',
'.jpg': 'image/jpeg',
'.png': 'image/png',
'.svg': 'image/svg+xml'
};

send(res, 200, buf, types[ext] || 'application/octet-stream');
});
}

const server = http.createServer(async (req, res) => {
let url;

try {
url = new URL(
req.url,
`http://${req.headers.host || 'localhost'}`
);
} catch {
return send(res, 400, { error: 'Invalid URL' });
}

const p = url.pathname;

try {
if (req.method === 'GET' && p === '/api/products') {
return send(res, 200, { products });
}

if (req.method === 'GET' && p === '/api/health') {
return send(res, 200, {
ok: true,
app: 'PaperCart',
storage: 'local JSON file',
ordersCount: readOrders().length
});
}

if (req.method === 'POST' && p === '/api/orders') {
const b = await readBody(req);

const name = safeText(b.name, 100);
const phone = safeText(b.phone, 30);
const address = safeText(b.address, 500);
const payment = safeText(b.payment, 20);
const items = Array.isArray(b.items) ? b.items : [];

if (
!name ||
!phone ||
!address ||
!items.length ||
!['COD', 'UPI'].includes(payment)
) {
return send(res, 400, {
error: 'Please fill all required details and select a payment method.'
});
}

const cleanItems = [];
let total = 0;

for (const it of items) {
const product = products.find(x => x.id === it.id);
const qty = Math.max(
1,
Math.min(50, Math.floor(Number(it.qty) || 1))
);

if (!product) continue;

cleanItems.push({
id: product.id,
name: product.name,
price: product.price,
qty,
lineTotal: product.price * qty
});

total += product.price * qty;
}

if (!cleanItems.length) {
return send(res, 400, {
error: 'No valid products in order.'
});
}

const orders = readOrders();

const order = {
id: 'PC-' +
Date.now().toString().slice(-8) +
'-' +
crypto.randomBytes(2).toString('hex').toUpperCase(),
createdAt: new Date().toISOString(),
name,
phone,
address,
payment,
items: cleanItems,
total,
status: 'New',
paymentStatus: payment === 'COD'
? 'Pay on delivery'
: 'Awaiting manual UPI verification',
notes: ''
};

orders.unshift(order);
writeOrders(orders);

return send(res, 201, {
ok: true,
order: {
id: order.id,
total: order.total,
payment: order.payment,
paymentStatus: order.paymentStatus
}
});
}

if (req.method === 'POST' && p === '/api/admin/login') {
const b = await readBody(req);
const submitted = Buffer.from(String(b.password || ''));
const expected = Buffer.from(ADMIN_PASSWORD);

if (
submitted.length !== expected.length ||
!crypto.timingSafeEqual(submitted, expected)
) {
return send(res, 401, { error: 'Incorrect password' });
}

const sid = crypto.randomBytes(32).toString('hex');
sessions.set(sid, { created: Date.now() });

return send(
res,
200,
{ ok: true },
'application/json; charset=utf-8',
{
'Set-Cookie':
`pc_admin=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`
}
);
}

if (req.method === 'POST' && p === '/api/admin/logout') {
const sid = parseCookies(req).pc_admin;
sessions.delete(sid);

return send(
res,
200,
{ ok: true },
'application/json; charset=utf-8',
{
'Set-Cookie':
'pc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
}
);
}

if (p.startsWith('/api/admin/')) {
if (!isAdmin(req)) {
return send(res, 401, { error: 'Please log in again.' });
}

if (req.method === 'GET' && p === '/api/admin/orders') {
return send(res, 200, { orders: readOrders() });
}

const m = p.match(/^\/api\/admin\/orders\/([^/]+)$/);

if (req.method === 'PATCH' && m) {
const b = await readBody(req);

const allowedStatus = [
'New', 'Processing', 'Shipped', 'Delivered', 'Cancelled'
];

const allowedPay = [
'Awaiting manual UPI verification',
'UPI verified',
'Pay on delivery',
'COD collected',
'Refunded'
];

const orders = readOrders();
const order = orders.find(o => o.id === m[1]);

if (!order) {
return send(res, 404, { error: 'Order not found' });
}

if (b.status && allowedStatus.includes(b.status)) {
order.status = b.status;
}

if (b.paymentStatus && allowedPay.includes(b.paymentStatus)) {
order.paymentStatus = b.paymentStatus;
}

if (b.notes !== undefined) {
order.notes = safeText(b.notes, 500);
}

writeOrders(orders);
return send(res, 200, { ok: true, order });
}

if (req.method === 'DELETE' && m) {
const orders = readOrders();
const next = orders.filter(o => o.id !== m[1]);

if (next.length === orders.length) {
return send(res, 404, { error: 'Order not found' });
}

writeOrders(next);
return send(res, 200, { ok: true });
}

if (req.method === 'GET' && p === '/api/admin/export.csv') {
const orders = readOrders();
const esc = v =>
'"' + String(v ?? '').replace(/"/g, '""') + '"';

const rows = [
[
'Order ID', 'Created', 'Customer', 'Phone', 'Address',
'Payment', 'Payment status', 'Order status', 'Items', 'Total'
],
...orders.map(o => [
o.id,
o.createdAt,
o.name,
o.phone,
o.address,
o.payment,
o.paymentStatus,
o.status,
o.items.map(i => `${i.name} x${i.qty}`).join('; '),
o.total
])
];

return send(
res,
200,
rows.map(r => r.map(esc).join(',')).join('\r\n'),
'text/csv; charset=utf-8',
{
'Content-Disposition':
'attachment; filename="papercart-orders.csv"'
}
);
}
}

if (p.startsWith('/api/')) {
return send(res, 404, { error: 'API route not found' });
}

return serveStatic(req, res, p);
} catch (e) {
console.error(e);

if (!res.headersSent && !res.destroyed) {
return send(res, 500, {
error: 'Server error. Check the terminal window.'
});
}
}
});

server.listen(PORT, '0.0.0.0', () => {
ensureData();
console.log(`PaperCart is running on Port ${PORT}`);
});
