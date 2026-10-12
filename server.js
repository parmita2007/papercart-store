"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
console.error("Set ADMIN_PASSWORD and SESSION_SECRET in environment variables.");
process.exit(1);
}

const PRODUCTS = [
{ id: "notebook", name: "Classic Ruled Notebook", category: "Notebooks", price: 79, emoji: "📓", desc: "Everyday notes, ideas and plans." },
{ id: "journal", name: "Premium Journal", category: "Notebooks", price: 199, emoji: "📔", desc: "A little space for big thoughts." },
{ id: "pens", name: "Smooth Gel Pen Set", category: "Pens", price: 99, emoji: "🖊️", desc: "A set of 5 smooth-writing pens." },
{ id: "markers", name: "Colour Marker Set", category: "Art Supplies", price: 149, emoji: "🖍️", desc: "Bright colours for creative projects." },
{ id: "pencils", name: "HB Pencil Pack", category: "Pens", price: 49, emoji: "✏️", desc: "Reliable pencils for school and sketching." },
{ id: "sticky", name: "Pastel Sticky Notes", category: "Desk Essentials", price: 69, emoji: "🗒️", desc: "Keep reminders where you can see them." },
{ id: "geometry", name: "Geometry Box", category: "School Supplies", price: 129, emoji: "📐", desc: "Everyday geometry tools in one box." },
{ id: "clips", name: "Desk Organiser Kit", category: "Desk Essentials", price: 179, emoji: "📎", desc: "Small essentials for a tidy desk." }
];

const sessions = new Map();
let orderQueue = Promise.resolve();

function send(res, status, data, type = "application/json; charset=utf-8") {
res.writeHead(status, {
"Content-Type": type,
"X-Content-Type-Options": "nosniff",
"Cache-Control": "no-store"
});
res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

function readBody(req) {
return new Promise((resolve, reject) => {
let body = "";
let size = 0;
let finished = false;

req.on("data", chunk => {
size += chunk.length;
if (size > 1024 * 1024) {
finished = true;
reject(new Error("Request body too large"));
req.destroy();
return;
}
body += chunk.toString("utf8");
});

req.on("end", () => {
if (finished) return;
try {
resolve(body ? JSON.parse(body) : {});
} catch {
reject(new Error("Invalid JSON"));
}
});

req.on("error", err => {
if (!finished) reject(err);
});
});
}

function ensureStorage() {
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) {
fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
}
}

function readOrders() {
ensureStorage();
const orders = JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
if (!Array.isArray(orders)) throw new Error("Invalid orders storage");
return orders;
}

function saveOrders(orders) {
ensureStorage();
const temp = ORDERS_FILE + ".tmp";
fs.writeFileSync(temp, JSON.stringify(orders, null, 2), "utf8");
fs.renameSync(temp, ORDERS_FILE);
}

function withOrderLock(fn) {
const task = orderQueue.then(fn);
orderQueue = task.catch(() => {});
return task;
}

function safeEqual(a, b) {
const x = Buffer.from(String(a));
const y = Buffer.from(String(b));
return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function createSession() {
const id = crypto.randomBytes(32).toString("hex");
const signature = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("hex");
sessions.set(id, Date.now() + 8 * 60 * 60 * 1000);
return id + "." + signature;
}

function getSession(req) {
const cookie = (req.headers.cookie || "")
.split(";")
.map(s => s.trim())
.find(s => s.startsWith("paperCartSession="));

if (!cookie) return null;

const token = decodeURIComponent(cookie.slice("paperCartSession=".length));
const parts = token.split(".");
if (parts.length !== 2) return null;

const [id, signature] = parts;
const expected = crypto.createHmac("sha256", SESSION_SECRET).update(id).digest("hex");

if (!safeEqual(signature, expected)) return null;

const expiry = sessions.get(id);
if (!expiry || expiry < Date.now()) {
sessions.delete(id);
return null;
}

return id;
}

function requireAdmin(req, res) {
if (!getSession(req)) {
send(res, 401, { error: "Admin login required" });
return false;
}
return true;
}

function csvEscape(value) {
let s = String(value ?? "");
if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
return '"' + s.replace(/"/g, '""') + '"';
}

function serveStatic(res, pathname, method) {
let decoded;
try {
decoded = decodeURIComponent(pathname);
} catch {
send(res, 400, { error: "Invalid path" });
return;
}

if (decoded.includes("\0") || decoded.includes("\\")) {
send(res, 400, { error: "Invalid path" });
return;
}

const relative = decoded === "/" ? "index.html" : decoded.slice(1);
const roots = [PUBLIC_DIR, ROOT];
let file = null;

for (const root of roots) {
const candidate = path.resolve(root, relative);
if (!candidate.startsWith(path.resolve(root) + path.sep)) continue;
if (candidate.startsWith(path.resolve(DATA_DIR) + path.sep)) continue;
if (["server.js", "orders.json"].includes(path.basename(candidate))) continue;

try {
if (fs.statSync(candidate).isFile()) {
file = candidate;
break;
}
} catch {}
}

if (!file) {
send(res, 404, { error: "Not found" });
return;
}

const types = {
".html": "text/html; charset=utf-8",
".css": "text/css; charset=utf-8",
".js": "text/javascript; charset=utf-8",
".json": "application/json; charset=utf-8",
".svg": "image/svg+xml",
".png": "image/png",
".jpg": "image/jpeg",
".jpeg": "image/jpeg",
".webp": "image/webp",
".ico": "image/x-icon"
};

const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";

fs.readFile(file, (err, data) => {
if (err) {
send(res, 500, { error: "Unable to read file" });
return;
}

res.writeHead(200, {
"Content-Type": type,
"X-Content-Type-Options": "nosniff",
"Cache-Control": "no-cache"
});
res.end(method === "HEAD" ? undefined : data);
});
}

async function handle(req, res) {
let url;
try {
url = new URL(req.url, "http://localhost");
} catch {
send(res, 400, { error: "Invalid URL" });
return;
}

const route = url.pathname;
const method = req.method;

if (method === "GET" && route === "/api/health") {
try {
send(res, 200, {
ok: true,
app: "PaperCart",
storage: "local JSON file",
ordersCount: readOrders().length
});
} catch {
send(res, 500, { ok: false, error: "Storage unavailable" });
}
return;
}

if (method === "GET" && route === "/api/products") {
send(res, 200, { products: PRODUCTS });
return;
}

if (method === "POST" && route === "/api/orders") {
let body;
try {
body = await readBody(req);
} catch (err) {
send(res, 400, { error: err.message });
return;
}

const customer = body.customer || body;
const name = String(customer.name || "").trim();
const phone = String(customer.phone || "").trim();
const address = String(customer.address || "").trim();
const paymentMethod = String(body.paymentMethod || body.payment || "").toUpperCase();

if (!name || !phone || !address) {
send(res, 400, { error: "Name, phone and address are required" });
return;
}

if (!/^[0-9+\s()-]{7,20}$/.test(phone)) {
send(res, 400, { error: "Invalid phone number" });
return;
}

if (!["COD", "UPI"].includes(paymentMethod)) {
send(res, 400, { error: "Choose COD or UPI" });
return;
}

if (!Array.isArray(body.items) || !body.items.length) {
send(res, 400, { error: "Cart is empty" });
return;
}

const items = [];
let total = 0;

for (const item of body.items) {
const product = PRODUCTS.find(p => p.id === String(item.id));
const quantity = Number(item.quantity);

if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
send(res, 400, { error: "Invalid product or quantity" });
return;
}

items.push({
id: product.id,
name: product.name,
price: product.price,
quantity
});
total += product.price * quantity;
}

const order = {
id: crypto.randomUUID(),
createdAt: new Date().toISOString(),
customer: { name, phone, address },
items,
total,
paymentMethod,
paymentStatus: paymentMethod === "COD" ? "Pending" : "Pending Verification",
status: "New",
notes: ""
};

try {
await withOrderLock(() => {
const orders = readOrders();
orders.push(order);
saveOrders(orders);
});
} catch {
send(res, 500, { error: "Unable to save order" });
return;
}

send(res, 201, {
message: "Order placed successfully",
order: {
id: order.id,
total: order.total,
status: order.status,
paymentStatus: order.paymentStatus
}
});
return;
}

if (route === "/api/admin/login" && method === "POST") {
let body;
try {
body = await readBody(req);
} catch {
send(res, 400, { error: "Invalid JSON" });
return;
}

if (!safeEqual(body.password || "", ADMIN_PASSWORD)) {
send(res, 401, { error: "Invalid admin password" });
return;
}

const token = createSession();
const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
res.setHeader(
"Set-Cookie",
`paperCartSession=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`
);
send(res, 200, { message: "Login successful" });
return;
}

if (route === "/api/admin/logout" && method === "POST") {
const id = getSession(req);
if (id) sessions.delete(id);

res.setHeader(
"Set-Cookie",
"paperCartSession=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
);
send(res, 200, { message: "Logged out" });
return;
}

if (route.startsWith("/api/admin/")) {
if (!requireAdmin(req, res)) return;

if (route === "/api/admin/orders" && method === "GET") {
try {
send(res, 200, { orders: readOrders() });
} catch {
send(res, 500, { error: "Unable to read orders" });
}
return;
}

if (route === "/api/admin/export.csv" && method === "GET") {
try {
const headers = [
"Order ID", "Date", "Customer", "Phone", "Address",
"Items", "Total", "Payment Method", "Payment Status",
"Order Status", "Notes"
];

const rows = readOrders().map(o => [
o.id, o.createdAt, o.customer.name, o.customer.phone,
o.customer.address,
o.items.map(i => `${i.name} x${i.quantity}`).join("; "),
o.total, o.paymentMethod, o.paymentStatus, o.status, o.notes
]);

const csv = [headers, ...rows]
.map(row => row.map(csvEscape).join(","))
.join("\r\n");

res.writeHead(200, {
"Content-Type": "text/csv; charset=utf-8",
"Content-Disposition": 'attachment; filename="papercart-orders.csv"',
"Cache-Control": "no-store"
});
res.end("\uFEFF" + csv);
} catch {
send(res, 500, { error: "CSV export failed" });
}
return;
}

const match = route.match(/^\/api\/admin\/orders\/([^/]+)$/);

if (match) {
const orderId = decodeURIComponent(match[1]);

if (method === "PATCH") {
let body;
try {
body = await readBody(req);
} catch {
send(res, 400, { error: "Invalid JSON" });
return;
}

try {
const updated = await withOrderLock(() => {
const orders = readOrders();
const order = orders.find(o => o.id === orderId);

if (!order) {
const e = new Error("Order not found");
e.status = 404;
throw e;
}

const statuses = ["New", "Processing", "Shipped", "Delivered", "Cancelled"];
const payments = ["Pending", "Paid", "Pending Verification", "Failed", "Refunded"];

if (body.status !== undefined) {
if (!statuses.includes(body.status)) {
const e = new Error("Invalid order status");
e.status = 400;
throw e;
}
order.status = body.status;
}

if (body.paymentStatus !== undefined) {
if (!payments.includes(body.paymentStatus)) {
const e = new Error("Invalid payment status");
e.status = 400;
throw e;
}
order.paymentStatus = body.paymentStatus;
}

if (body.notes !== undefined) {
if (typeof body.notes !== "string" || body.notes.length > 2000) {
const e = new Error("Invalid notes");
e.status = 400;
throw e;
}
order.notes = body.notes;
}

saveOrders(orders);
return order;
});

send(res, 200, { message: "Order updated", order: updated });
} catch (err) {
send(res, err.status || 500, { error: err.message });
}
return;
}

if (method === "DELETE") {
try {
await withOrderLock(() => {
const orders = readOrders();
const index = orders.findIndex(o => o.id === orderId);

if (index === -1) {
const e = new Error("Order not found");
e.status = 404;
throw e;
}

orders.splice(index, 1);
saveOrders(orders);
});
send(res, 200, { message: "Order deleted" });
} catch (err) {
send(res, err.status || 500, { error: err.message });
}
return;
}
}

send(res, 404, { error: "Admin route not found" });
return;
}

if (method === "GET" || method === "HEAD") {
serveStatic(res, route, method);
return;
}

send(res, 404, { error: "Not found" });
}

const server = http.createServer((req, res) => {
handle(req, res).catch(err => {
console.error("Request error:", err.message);
if (!res.headersSent) {
send(res, 500, { error: "Internal server error" });
} else {
res.end();
}
});
});

server.listen(PORT, "0.0.0.0", () => {
console.log(`PaperCart is running on port ${PORT}`);
});
