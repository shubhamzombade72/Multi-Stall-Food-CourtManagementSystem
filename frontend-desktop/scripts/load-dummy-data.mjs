/**
 * Fills a SEPARATE desktop profile with dummy data through the app's own API (every normal validation applies):
 * 50 stalls, 50 menu categories, 100 dishes (40 with long names), 40 floors with 1,000 tables, 50 raw materials,
 * 1,000 suppliers and 10,000 purchase orders (some received, some cancelled).
 *
 *   cd frontend-desktop && node scripts/load-dummy-data.mjs <profile root>
 *
 * The profile root holds the app profile and its own update folders, so an installed app and its updates are never
 * touched. The owner login is written to ../docs/dummy-data-login.md (docs/ is gitignored).
 */
import electronPath from 'electron';
import { _electron as electron } from 'playwright-core';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Give the profile root folder');
const PROFILE = join(ROOT, 'profile');
if (existsSync(join(PROFILE, 'server', 'foodcourt.sqlite'))) throw new Error(`${PROFILE} already has a database; choose an empty folder`);
mkdirSync(ROOT, { recursive: true });
const LOGIN_FILE = resolve(APP_DIR, '..', 'docs', 'dummy-data-login.md');

const EMAIL = 'dummy.owner@example.com';
const PASSWORD = `Demo-${randomBytes(6).toString('base64url')}9`;
const log = (m) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${m}`);

// ------------------------------------------------------------------ names
const stallNames = ['Spice Route', 'Tandoor Tales', 'Dosa Junction', 'Biryani House', 'Chaat Corner', 'Punjabi Dhaba', 'Mumbai Street', 'Chinese Wok', 'Pizza Point', 'Burger Barn', 'Momo Mania', 'Kerala Kitchen', 'Rajasthani Rasoi', 'Bengali Bhoj', 'Gujarati Thali', 'Hyderabadi Handi', 'Kebab Factory', 'Pav Bhaji Hub', 'Paratha Plaza', 'Idli Express', 'Rolls & Wraps', 'Sandwich Studio', 'Pasta Palace', 'Taco Town', 'Sushi Stop', 'Thai Taste', 'Lebanese Grill', 'Juice Junction', 'Chai Point', 'Coffee Culture', 'Shake Shack Desi', 'Ice Cream Igloo', 'Sweet Mithai', 'Bakery Bliss', 'Healthy Bowl', 'Salad Studio', 'Vada Pav Wala', 'Kathi Roll Co', 'Frankie Point', 'Andhra Meals', 'Chettinad Spice', 'Goan Fish Curry', 'Kashmiri Wazwan', 'Awadhi Dastarkhwan', 'Maharashtrian Misal', 'Bihari Litti', 'Assam Tea House', 'Coastal Catch', 'Street Noodles', 'Falooda Factory'];
const categoryNames = ['North Indian Mains', 'South Indian Breakfast', 'Biryani & Rice', 'Street Chaat', 'Tandoor Starters', 'Indo-Chinese', 'Pizzas', 'Burgers', 'Momos & Dumplings', 'Kerala Specials', 'Rajasthani Thali', 'Bengali Sweets', 'Gujarati Farsan', 'Hyderabadi Curries', 'Kebabs & Grills', 'Pav Bhaji', 'Stuffed Parathas', 'Idli & Vada', 'Rolls', 'Sandwiches', 'Pasta', 'Mexican', 'Japanese', 'Thai Curries', 'Middle Eastern', 'Fresh Juices', 'Tea & Chai', 'Hot Coffee', 'Milkshakes', 'Ice Creams', 'Indian Mithai', 'Cakes & Pastries', 'Healthy Bowls', 'Salads', 'Mumbai Snacks', 'Kathi Rolls', 'Frankies', 'Andhra Meals', 'Chettinad Curries', 'Goan Seafood', 'Kashmiri Dishes', 'Awadhi Kebabs', 'Misal & Usal', 'Litti Chokha', 'Assamese Dishes', 'Coastal Fry', 'Noodles', 'Falooda & Kulfi', 'Soups', 'Combo Meals'];
const shortDishes = ['Masala Dosa', 'Paneer Tikka', 'Veg Biryani', 'Pani Puri', 'Butter Naan', 'Dal Makhani', 'Veg Momos', 'Cold Coffee', 'Masala Chai', 'Vada Pav', 'Aloo Paratha', 'Idli Sambar', 'Chole Bhature', 'Pav Bhaji', 'Veg Burger', 'Margherita Pizza', 'Hakka Noodles', 'Gulab Jamun', 'Rasgulla', 'Mango Lassi', 'Lemon Soda', 'Medu Vada', 'Upma', 'Poha', 'Misal Pav', 'Dhokla', 'Kulfi', 'Samosa', 'Kachori', 'Jalebi', 'Fish Fry', 'Chicken 65', 'Egg Roll', 'Veg Sandwich', 'Penne Arrabiata', 'Tomato Soup', 'Spring Roll', 'Fried Rice', 'Rava Dosa', 'Onion Uttapam', 'Bhel Puri', 'Dahi Puri', 'Malai Kofta', 'Kadai Paneer', 'Rajma Chawal', 'Curd Rice', 'Lemon Rice', 'Filter Coffee', 'Oreo Shake', 'Brownie', 'Cheese Toast', 'Veg Frankie', 'Litti Chokha', 'Appam Stew', 'Puttu Kadala', 'Mirchi Bajji', 'Pesarattu', 'Sev Puri', 'Tea Biscuit', 'Fruit Salad'];
const longDishes = [
  'Hyderabadi Dum Chicken Biryani with Mirchi Ka Salan and Boondi Raita',
  'Paneer Butter Masala with Two Butter Naan, Jeera Rice and Green Salad',
  'Mysore Masala Dosa with Coconut Chutney, Tomato Chutney and Hot Sambar',
  'Special Punjabi Thali with Dal Makhani, Shahi Paneer, Roti, Rice and Gulab Jamun',
  'Crispy Cheese Burst Margherita Pizza with Extra Mozzarella and Oregano Dip',
  'Kolkata Style Mutton Kathi Roll with Double Egg, Onion and Green Chutney',
  'Kerala Appam with Vegetable Stew, Coconut Milk Gravy and Banana Chips',
  'Rajasthani Dal Baati Churma Platter with Garlic Chutney and Pure Desi Ghee',
  'Steamed Darjeeling Chicken Momos with Spicy Red Chilli Garlic Chutney',
  'Amritsari Kulcha with Pindi Chole, Pickled Onions and Sweet Lassi',
  'Chettinad Pepper Chicken Curry with Malabar Parotta and Onion Raita',
  'Goan Prawn Curry Rice Meal with Fried Kingfish and Sol Kadhi',
  'Mumbai Style Butter Pav Bhaji with Extra Cheese, Onion and Lemon Wedge',
  'Gujarati Farsan Platter with Khaman Dhokla, Khandvi, Fafda and Kadhi',
  'Awadhi Galouti Kebab with Ulte Tawe Ka Paratha and Mint Yoghurt Chutney',
  'Bengali Kosha Mangsho with Steamed Basmati Rice and Mishti Doi',
  'Kashmiri Rogan Josh with Saffron Pulao, Kahwa Tea and Phirni',
  'Andhra Spicy Gongura Mutton Meal with Pappu, Rasam, Curd and Papad',
  'Double Patty Smoked Paneer Burger with Peri Peri Fries and Cola',
  'Thai Green Curry with Jasmine Rice, Tofu, Basil and Fresh Vegetables',
  'Lebanese Chicken Shawarma Platter with Hummus, Pita, Pickles and Toum',
  'Creamy Alfredo Penne Pasta with Mushrooms, Broccoli and Garlic Bread',
  'Mexican Loaded Nachos with Cheese Sauce, Salsa, Jalapenos and Sour Cream',
  'Japanese Vegetable Sushi Platter with Wasabi, Pickled Ginger and Soy Sauce',
  'Indo-Chinese Chilli Paneer Dry with Hakka Noodles and Manchurian Gravy',
  'Royal Falooda with Rose Syrup, Basil Seeds, Vermicelli and Kulfi Scoop',
  'Belgian Chocolate Waffle with Vanilla Ice Cream, Nuts and Chocolate Sauce',
  'Maharashtrian Misal Pav with Farsan, Onion, Lemon and Extra Rassa',
  'Bihari Litti Chokha with Baingan Bharta, Aloo Chokha and Pure Ghee',
  'Assamese Fish Tenga with Joha Rice, Aloo Pitika and Green Salad',
  'Coastal Mangalore Chicken Ghee Roast with Neer Dosa and Kori Rotti',
  'Healthy Quinoa Power Bowl with Grilled Paneer, Avocado and Lemon Dressing',
  'South Indian Mini Tiffin with Idli, Vada, Mini Dosa, Pongal and Kesari',
  'Classic Cold Coffee with Hazelnut Syrup, Whipped Cream and Chocolate Chips',
  'Fresh Seasonal Fruit Juice Platter with Mosambi, Watermelon and Pineapple',
  'Tandoori Mixed Grill Platter with Chicken Tikka, Seekh Kebab and Fish Tikka',
  'Malai Kofta in Rich Cashew Gravy with Laccha Paratha and Jeera Rice',
  'Street Style Dahi Bhalla Papdi Chaat with Sweet and Green Chutneys',
  'Vegetable Manchow Soup with Crispy Fried Noodles and Spring Onion Garnish',
  'Hot Gulab Jamun with Vanilla Ice Cream, Rabri and Pistachio Topping',
];
const supplierWords = ['Annapurna', 'Shree Ganesh', 'Balaji', 'Krishna', 'Laxmi', 'Sai', 'Mahalaxmi', 'Om', 'Shiv Shakti', 'Durga', 'Gayatri', 'Jai Hind', 'Bharat', 'Sagar', 'Patel', 'Sharma', 'Gupta', 'Agarwal', 'Reddy', 'Nair', 'Joshi', 'Kulkarni', 'Deshmukh', 'Iyer', 'Menon'];
const supplierTrades = ['Traders', 'Wholesale', 'Agro Foods', 'Dairy', 'Spices', 'Vegetables', 'Oil Mills', 'Grains', 'Suppliers', 'Distributors', 'Enterprises', 'Food Products', 'Cold Storage', 'Bakery Supplies', 'Packaging'];
const towns = ['Pune', 'Mumbai', 'Nashik', 'Nagpur', 'Aurangabad', 'Kolhapur', 'Satara', 'Solapur', 'Thane', 'Ahmednagar'];
const rawMaterials = [['Basmati Rice', 'kg', 95], ['Wheat Flour', 'kg', 38], ['Maida', 'kg', 42], ['Besan', 'kg', 85], ['Toor Dal', 'kg', 140], ['Moong Dal', 'kg', 120], ['Urad Dal', 'kg', 130], ['Chana', 'kg', 90], ['Rajma', 'kg', 150], ['Sugar', 'kg', 44], ['Salt', 'kg', 20], ['Sunflower Oil', 'l', 150], ['Mustard Oil', 'l', 170], ['Ghee', 'kg', 620], ['Butter', 'kg', 520], ['Paneer', 'kg', 340], ['Milk', 'l', 60], ['Curd', 'kg', 70], ['Cheese', 'kg', 480], ['Cream', 'l', 260], ['Onion', 'kg', 30], ['Tomato', 'kg', 35], ['Potato', 'kg', 28], ['Ginger', 'kg', 120], ['Garlic', 'kg', 160], ['Green Chilli', 'kg', 80], ['Coriander', 'kg', 60], ['Capsicum', 'kg', 70], ['Cabbage', 'kg', 30], ['Carrot', 'kg', 45], ['Chicken', 'kg', 220], ['Mutton', 'kg', 720], ['Fish', 'kg', 380], ['Eggs', 'pcs', 6], ['Turmeric Powder', 'kg', 260], ['Red Chilli Powder', 'kg', 320], ['Garam Masala', 'kg', 640], ['Cumin Seeds', 'kg', 380], ['Tea Leaves', 'kg', 420], ['Coffee Powder', 'kg', 780], ['Noodles', 'packet', 25], ['Pav Bread', 'packet', 40], ['Pizza Base', 'pcs', 30], ['Burger Buns', 'packet', 45], ['Soya Sauce', 'l', 110], ['Tomato Ketchup', 'kg', 120], ['Coconut', 'pcs', 35], ['Lemon', 'kg', 90], ['Ice Cream', 'l', 240], ['Paper Plates', 'packet', 60]];

// Deterministic, so a rerun on another empty profile produces the same data
let seed = 20261107;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rnd() * list.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
const isoDay = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);

let API = '';
let TOKEN = '';
let requests = 0;
async function call(method, path, body) {
  for (let attempt = 1; ; attempt += 1) {
    requests += 1;
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status >= 300) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 300)}`), { status: res.status });
      return json;
    } catch (err) {
      if (err.status && err.status < 500) throw err;
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
const total = (json) => json?.data?.total ?? json?.meta?.total ?? (Array.isArray(json?.data) ? json.data.length : Array.isArray(json?.data?.data) ? json.data.data.length : null);

let app;
const env = { ...process.env, LOCALAPPDATA: join(ROOT, 'local'), FOODCOURT_USER_DATA_DIR: PROFILE, FOODCOURT_UPDATE_NO_TASK: '1', FOODCOURT_UPDATE_FIRST_CHECK_MS: '86400000', FOODCOURT_SMOKE_TEST: '', FOODCOURT_PIN_LOCK: 'off', FOODCOURT_API_URL: '' };
delete env.ELECTRON_RUN_AS_NODE;
try {
  app = await electron.launch({ executablePath: electronPath, args: [APP_DIR], env, timeout: 90000 });
  const page = await app.firstWindow();
  await page.getByText('Welcome', { exact: false }).first().waitFor({ timeout: 120000 });
  API = (await page.evaluate(() => window.desktop.getConfig())).apiBaseUrl.replace(/\/$/, '');
  log(`App started on its own profile; built-in server at ${API}`);

  const setup = await call('POST', '/setup/owner', { name: 'Dummy Data Owner', email: EMAIL, password: PASSWORD });
  TOKEN = setup.data.token;
  mkdirSync(dirname(LOGIN_FILE), { recursive: true });
  writeFileSync(LOGIN_FILE, [
    '# Dummy data account (test data only)',
    '',
    `Profile folder: \`${PROFILE}\``,
    '',
    `- Email: \`${EMAIL}\``,
    `- Password: \`${PASSWORD}\``,
    `- Recovery key: \`${setup.data.recovery_key}\``,
    '',
    'Open this profile with `frontend-desktop/scripts/open-dummy-data.ps1`. It never touches the installed app or its data.',
    '',
  ].join('\n'));
  log(`Owner created; login saved to ${LOGIN_FILE}`);

  // The built-in server answers one request at a time (about 1 s each), so the bulk goes straight into this profile's
  // database with the backend's own models and stock service while the app is closed
  await app.close();
  app = null;
  await new Promise((r) => setTimeout(r, 3000));

  // 40 of the 100 dishes get a long name, spread over the stalls
  const dishes = [];
  let longUsed = 0;
  let shortUsed = 0;
  for (let i = 0; i < 100; i += 1) dishes.push(i % 5 < 2 && longUsed < longDishes.length ? longDishes[longUsed++] : shortDishes[shortUsed++ % shortDishes.length]);
  const data = {
    stalls: stallNames.map((name, i) => ({ name, code: `S${String(i + 1).padStart(2, '0')}`, description: `${name} counter, dummy data`, contact_phone: `98${String(20000000 + i * 7919).slice(0, 8)}` })),
    categories: categoryNames,
    dishes,
    tables: Array.from({ length: 1000 }, (_, k) => {
      const f = Math.floor(k / 25) + 1;
      const t = (k % 25) + 1;
      return { table_number: `F${String(f).padStart(2, '0')}-T${String(t).padStart(2, '0')}`, capacity: pick([2, 2, 4, 4, 4, 6, 8]), section: `Floor ${f}` };
    }),
    raw_materials: rawMaterials,
    suppliers: Array.from({ length: 1000 }, (_, i) => ({
      name: `${supplierWords[i % supplierWords.length]} ${supplierTrades[Math.floor(i / supplierWords.length) % supplierTrades.length]} ${towns[i % towns.length]} ${String(i + 1).padStart(4, '0')}`,
      contact_person: `${pick(['Ramesh', 'Suresh', 'Mahesh', 'Priya', 'Anita', 'Vijay', 'Sunita', 'Rahul'])} ${pick(['Patil', 'Shah', 'Rao', 'Singh', 'Pawar'])}`,
      phone: `9${String(800000000 + i * 37).padStart(9, '0')}`,
      email: `supplier${i + 1}@example.com`,
      address: `Shop ${int(1, 200)}, Market Yard, ${towns[i % towns.length]}`,
      is_active: true,
    })),
  };
  const dataFile = join(ROOT, 'dummy-data.json');
  writeFileSync(dataFile, JSON.stringify(data));

  const serverDir = join(APP_DIR, 'build-server');
  const dataDir = join(PROFILE, 'server');
  const phpDir = join(serverDir, 'php');
  const ext = join(phpDir, 'ext');
  const phpEnv = {
    ...process.env, APP_ENV: 'production', APP_DEBUG: 'false', APP_KEY: readFileSync(join(dataDir, 'app.key'), 'utf8').trim(),
    DB_CONNECTION: 'sqlite', DB_DATABASE: join(dataDir, 'foodcourt.sqlite'), DB_FOREIGN_KEYS: 'true', CACHE_STORE: 'array', SESSION_DRIVER: 'array',
    QUEUE_CONNECTION: 'sync', BROADCAST_CONNECTION: 'null', LOG_CHANNEL: 'single', LOG_LEVEL: 'warning', FOODCOURT_EMBEDDED: 'true',
    LARAVEL_STORAGE_PATH: join(dataDir, 'storage'),
  };
  const phpArgs = ['-n', '-d', `extension_dir=${ext}`, '-d', 'extension=php_mbstring.dll', '-d', 'extension=php_openssl.dll', '-d', 'extension=php_pdo_sqlite.dll', '-d', 'extension=php_sqlite3.dll', '-d', 'extension=php_fileinfo.dll', '-d', 'memory_limit=1G', '-d', 'date.timezone=UTC'];
  log('Writing the bulk data into the profile database');
  const run = spawnSync(join(phpDir, 'php.exe'), [...phpArgs, join(APP_DIR, 'scripts', 'dummy-data.php'), join(serverDir, 'backend'), dataFile], { env: phpEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(run.stdout || '');
  if (run.status !== 0 || !/DONE/.test(run.stdout || '')) throw new Error(`Bulk load failed (exit ${run.status}): ${(run.stderr || run.stdout || '').slice(-1500)}`);

  // ---------------- open the app again and count everything back through its API
  app = await electron.launch({ executablePath: electronPath, args: [APP_DIR], env, timeout: 90000 });
  const again = await app.firstWindow();
  await again.waitForFunction(() => window.desktop && window.desktop.getConfig, null, { timeout: 120000 });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const cfg = await again.evaluate(() => window.desktop.getConfig());
    if (cfg.apiBaseUrl) {
      API = cfg.apiBaseUrl.replace(/\/$/, '');
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  TOKEN = '';
  TOKEN = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).data.token;

  // ---------------- count everything back
  const counts = {
    stalls: total(await call('GET', '/stalls')),
    categories: total(await call('GET', '/menu-categories')),
    dishes: total(await call('GET', '/menu')),
    floors: total(await call('GET', '/tables/sections')),
    tables: total(await call('GET', '/tables')),
    raw_materials: total(await call('GET', '/store/items')),
    suppliers: total(await call('GET', '/store/suppliers?per_page=1')),
    purchase_orders: total(await call('GET', '/store/purchases?per_page=1')),
    received: total(await call('GET', '/store/purchases?per_page=1&status=received')),
    cancelled: total(await call('GET', '/store/purchases?per_page=1&status=cancelled')),
  };
  const menu = await call('GET', '/menu');
  const dishList = Array.isArray(menu.data) ? menu.data : menu.data?.data ?? [];
  counts.long_dish_names = dishList.filter((d) => d.name.length >= 40).length;
  log(`COUNTS ${JSON.stringify(counts)} after ${requests} requests`);
} finally {
  if (app) await app.close().catch(() => undefined);
}
